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

Your job is to transcribe and structure receipt data exactly as written.
You must behave like an OCR system, not a reasoning assistant.

Return ONLY a valid JSON object.
Do not include explanations, markdown, comments, or extra text.

JSON structure:

{
"merchant": "store name",
"date": "date shown on receipt",
"items": [
{"name": "item text exactly as on receipt", "price": 0.00}
],
"subtotal": 0.00,
"tax": 0.00,
"tip": 0.00,
"total": 0.00,
"currency": "USD"
}

CRITICAL RULES

1. ITEM NAME RULE (NO GUESSING)

Item names must be copied exactly from the receipt text.

Do NOT:

* correct spelling
* expand abbreviations
* translate names
* infer product meaning

Example:
"OLIPOP LMNLM" must stay exactly "OLIPOP LMNLM"

Never convert it to "Olipop Lemon Lime" or "Olive Oil".

If text is unclear, copy the characters as best as possible.

You are transcribing, NOT interpreting.

2. DO NOT MERGE ITEMS

Each purchased item must appear as its own entry in the items array.

If the receipt lists the same item multiple times, include multiple separate entries.

Example:

GV BLK BEANS 0.86
GV BLK BEANS 0.86
GV BLK BEANS 0.86
GV BLK BEANS 0.86

Must produce:

{"name":"GV BLK BEANS","price":0.86}
{"name":"GV BLK BEANS","price":0.86}
{"name":"GV BLK BEANS","price":0.86}
{"name":"GV BLK BEANS","price":0.86}

Never combine them into one line.

3. WALMART MULTI-LINE ITEM LOGIC

Many Walmart items use multi-line pricing.

Example:

CUCUMBER
2 AT 1 FOR 0.63   1.26

Interpretation:

Name = "CUCUMBER 2 AT 1 FOR 0.63"
Price = 1.26

Rules:

If a line containing an item name is followed by a line with quantity pricing (AT / @ / lb / FOR), treat them as the same item.

The FINAL price on the right side is the item price.

Always use the FINAL price column.

4. WEIGHT-BASED PRODUCE

Example:

TOMATO
2.22 lb @ 1.00 lb / 0.92   2.04

Name should include the weight line:

"TOMATO 2.22 lb @ 1.00 lb / 0.92"

Price = 2.04

5. INCLUDE ALL ITEMS

Do not skip items.

If a line has a price on the right side, it must be included as an item.

Example items that MUST NOT be skipped:

HOT FOOD
PNAPLE DRINK
TACO SSN MIX

6. PRICE COLUMN RULE

The price is always the number aligned in the rightmost column.

Ignore intermediate numbers in the middle of the line.

Example:

2 AT 1 FOR 0.63   1.26

Price = 1.26

NOT 0.63

7. IGNORE NON-ITEM LINES

Never include the following as items:

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

8. NUMERIC FORMATTING

All prices must be numbers, not strings.

Correct:
"price": 1.26

Incorrect:
"price": "1.26"

9. DATE AND MERCHANT

Merchant is typically near the top of the receipt.

If not visible, return "Unknown".

Date should be extracted if present.
If missing, return "Unknown".

10. SUBTOTAL / TAX / TOTAL

Extract values from the totals section:

Example:

SUBTOTAL 21.95
TAX1 0.28
TOTAL 22.23

Return:

"subtotal": 21.95
"tax": 0.28
"total": 22.23

If a value does not exist, return 0.

11. VALIDATION

The sum of item prices should approximately match the subtotal.

If there is a small rounding difference, keep the item prices exactly as printed.

FINAL REQUIREMENT

Return ONLY the JSON object.

No markdown.
No explanation.
No text before or after the JSON.
`

const USER_PROMPT = `Analyze this receipt image and return the JSON.`

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
