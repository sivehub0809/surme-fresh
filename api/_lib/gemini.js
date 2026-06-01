const DEFAULT_MODEL = 'gemini-2.5-flash'

function env(name, fallback = '') {
  return String(process.env[name] || fallback).trim()
}

async function generateGeminiText({
  prompt,
  systemInstruction,
  model,
  temperature = 0.5,
  maxOutputTokens = 512,
  thinkingBudget = 0,
  timeoutMs = 10000,
}) {
  const apiKey = env('GOOGLE_GEMINI_API_KEY')
  if (!apiKey) {
    throw new Error('GOOGLE_GEMINI_API_KEY is required')
  }

  const selectedModel = encodeURIComponent(model || env('AI_MODEL', DEFAULT_MODEL))
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error('Gemini request timed out')), timeoutMs)
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${selectedModel}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey,
    },
    signal: controller.signal,
    body: JSON.stringify({
      ...(String(systemInstruction || '').trim()
        ? {
            systemInstruction: {
              parts: [{ text: String(systemInstruction || '').trim() }],
            },
          }
        : {}),
      contents: [
        {
          role: 'user',
          parts: [{ text: String(prompt || '').trim() }],
        },
      ],
      generationConfig: {
        temperature,
        topP: 0.9,
        maxOutputTokens,
        thinkingConfig: {
          thinkingBudget,
        },
      },
    }),
  })

  try {
    const raw = await response.text()
    if (!response.ok) {
      throw new Error(`Gemini request failed: ${response.status} ${raw}`)
    }

    const json = JSON.parse(raw)
    const parts = json?.candidates?.[0]?.content?.parts || []
    const text = parts.map((part) => part.text || '').join('').trim()
    if (!text) throw new Error('Gemini returned an empty response')
    return text
  } finally {
    clearTimeout(timeout)
  }
}

module.exports = {
  generateGeminiText,
}
