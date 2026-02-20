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

const SYSTEM_PROMPT = `You are a receipt analyzer. You MUST respond with ONLY a valid JSON object — no markdown, no explanation, no code blocks, no extra text.

Analyze the receipt/bill image and return exactly this JSON structure:
{
  "merchant": "store or restaurant name",
  "date": "date shown on receipt",
  "items": [
    {"name": "item description", "price": 0.00}
  ],
  "subtotal": 0.00,
  "tax": 0.00,
  "tip": 0.00,
  "total": 0.00,
  "currency": "USD"
}

Rules:
- All price values must be numbers, never strings
- Include every individual line item (do NOT include subtotal/tax/tip/total in items array)
- Combine quantity into name if applicable e.g. "2× Burger"
- If merchant or date are not visible, use "Unknown"
- If tax, tip, or subtotal are not present, use 0`

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
