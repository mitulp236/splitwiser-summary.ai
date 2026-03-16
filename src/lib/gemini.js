// ─────────────────────────────────────────────────────────────────────────────
// OpenAI API Configuration
// ─────────────────────────────────────────────────────────────────────────────

// Get OpenAI API key from localStorage
function getOpenAIKey() {
  return localStorage.getItem('OPENAI_API_KEY') || ''
}

// gpt-4o-mini: cheapest vision-capable model (~$0.003/image), great for personal projects
const OPENAI_MODEL = 'gpt-4o-mini'

const OPENAI_API_URL = 'https://api.openai.com/v1/chat/completions'

// ─────────────────────────────────────────────────────────────────────────────
// Prompts — customize these to change AI behavior
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a STRICT receipt OCR parser.

Your job is to transcribe receipt data exactly as written.
You must behave like an OCR engine, not a reasoning assistant.

Return ONLY a valid JSON object.
Do not include markdown, explanations, comments, or extra text.

JSON structure:

{
"merchant": "store name",
"date": "date shown on receipt",
"items": [
{"name": "item text exactly as printed", "price": 0.00}
],
"subtotal": 0.00,
"tax": 0.00,
"tip": 0.00,
"total": 0.00,
"currency": "USD"
}

CRITICAL EXTRACTION RULES

1. TRANSCRIBE ITEM NAMES EXACTLY

Item names must be copied exactly from the receipt.

Do NOT:

* guess the meaning
* fix spelling
* expand abbreviations
* convert to readable product names

Examples:

"OLIPOP LMNLM" must stay exactly:
"OLIPOP LMNLM"

"GVRDSM TC" must stay exactly:
"GVRDSM TC"

Never convert them to meaningful product names.

You are performing transcription only.

2. DO NOT MERGE IDENTICAL ITEMS

Each item row on the receipt must become its own JSON entry.

Example receipt:

GV BLK BEANS   0.86
GV BLK BEANS   0.86
GV BLK BEANS   0.86
GV BLK BEANS   0.86

JSON must contain four separate entries.

Never combine them into one.

3. WALMART MULTI-LINE ITEM STRUCTURE

Walmart receipts frequently split an item across two lines.

Example:

CUCUMBER
2 AT 1 FOR 0.63      1.26 N

Rules:

First line = item name
Second line = quantity or price details

Combine both lines into the item name.

Correct result:

"name": "CUCUMBER 2 AT 1 FOR 0.63"
"price": 1.26

The price is ALWAYS the rightmost number on the line.

Never use the middle price (0.63).

4. WEIGHT-BASED PRODUCE ITEMS

Example:

TOMATO
2.22 lb @ 1.00 lb / 0.92      2.04 N

Name should include the weight information:

"TOMATO 2.22 lb @ 1.00 lb / 0.92"

Price = 2.04

5. WALMART TAX STATUS LETTERS (IMPORTANT)

On Walmart receipts, a letter appears after the price:

N = Non-taxable item
X = Taxable item

Examples:

HOT FOOD           0.97 X
OLIPOP LMNLM       1.96 X
BELL PEPPER        0.86 N

These letters ONLY indicate tax status.

They are NOT part of the item price and NOT a reason to ignore the item.

Rules:

Always include items with both X and N.

Never skip taxable items.

Never set their price to 0.

The price is the number before the X or N.

Examples:

"HOT FOOD 0.97 X"
price = 0.97

"OLIPOP LMNLM 1.96 X"
price = 1.96

"BELL PEPPER 0.86 N"
price = 0.86

6. INCLUDE ALL ITEMS

Every line that ends with a price must be included.

Examples that must not be skipped:

HOT FOOD
PNAPLE DRINK
TACO SSN MIX
OLIPOP LMNLM

If a line contains a price in the rightmost column, it is an item.

7. PRICE COLUMN RULE

The item price is ALWAYS the rightmost number before the tax letter (X or N).

Example:

2 AT 1 FOR 0.63      1.26 N

Correct price = 1.26
Incorrect price = 0.63

8. IGNORE NON-ITEM SECTIONS

Never include these lines as items:

SUBTOTAL
TAX
TAX1
TOTAL
CHANGE DUE
CARD TEND
MASTERCARD
VISA
CASH
STORE ADDRESS
PHONE NUMBER
BARCODES
SURVEY LINKS

9. NUMERIC FORMAT

All prices must be numeric values.

Correct:

"price": 1.26

Incorrect:

"price": "1.26"

10. SUBTOTAL / TAX / TOTAL EXTRACTION

Extract values from the totals section.

Example:

SUBTOTAL   21.95
TAX1       0.28
TOTAL      22.23

Return:

"subtotal": 21.95
"tax": 0.28
"total": 22.23

If a field is missing, return 0.

11. DATE AND MERCHANT

Merchant is usually near the top of the receipt.

If not visible return:

"merchant": "Unknown"

If the receipt date is not visible return:

"date": "Unknown"

12. VALIDATION

The sum of item prices should approximately equal the subtotal.

However, do not modify item prices to force the match.

Always keep the exact price printed on the receipt.

FINAL REQUIREMENT

Return ONLY the JSON object.

Do not include explanations, markdown, comments, or text before or after the JSON.

`

const USER_PROMPT = `First identify the ITEM SECTION and TOTAL SECTION of the receipt.
Then read the item section line-by-line from top to bottom before extracting items. Analyze this receipt image and return the JSON.`

// ─────────────────────────────────────────────────────────────────────────────
// Core API call
// ─────────────────────────────────────────────────────────────────────────────

const HEIC_TYPES = ['image/heic', 'image/heif', 'image/heic-sequence', 'image/heif-sequence']

/**
 * Convert HEIC/HEIF file to JPEG blob using heic2any.
 */
async function heicToJpeg(file) {
  const heic2any = (await import('heic2any')).default
  const blob = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.92 })
  // heic2any may return an array for sequences — take the first
  return Array.isArray(blob) ? blob[0] : blob
}

/**
 * Normalise any image file to a JPEG/PNG data URL that OpenAI accepts.
 * HEIC/HEIF files are converted on the fly.
 */
async function fileToDataURL(file) {
  let blob = file

  const isHeic = HEIC_TYPES.includes(file.type?.toLowerCase()) ||
    /\.(heic|heif)$/i.test(file.name)

  if (isHeic) {
    blob = await heicToJpeg(file)
  }

  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.readAsDataURL(blob)
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
  })
}

/**
 * Send an image to OpenAI and return the AI-generated text response.
 *
 * @param {File} imageFile        - The image file selected by the user
 * @param {string} [systemPrompt] - Optional override for SYSTEM_PROMPT
 * @param {string} [userPrompt]   - Optional override for USER_PROMPT
 * @returns {Promise<string>}     - The AI response text
 */
export async function analyzeImageWithGemini(imageFile, systemPrompt, userPrompt) {
  const dataURL = await fileToDataURL(imageFile)

  const sysPrompt = systemPrompt?.trim() || SYSTEM_PROMPT
  const usrPrompt = userPrompt?.trim() || USER_PROMPT
  const OPENAI_API_KEY = getOpenAIKey()
  if (!OPENAI_API_KEY) throw new Error('OpenAI API key not set. Please add your key in Settings.')

  const requestBody = {
    model: OPENAI_MODEL,
    max_tokens: 2048,
    response_format: { type: 'json_object' },
    messages: [
      {
        role: 'system',
        content: sysPrompt,
      },
      {
        role: 'user',
        content: [
          { type: 'text', text: usrPrompt },
          {
            type: 'image_url',
            image_url: { url: dataURL, detail: 'auto' },
          },
        ],
      },
    ],
  }

  const response = await fetch(OPENAI_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify(requestBody),
  })

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}))
    const message = errorBody?.error?.message || `HTTP ${response.status}`
    throw new Error(`OpenAI API error: ${message}`)
  }

  const data = await response.json()
  const text = data?.choices?.[0]?.message?.content
  if (!text) throw new Error('No response text received from OpenAI.')
  return text
}
