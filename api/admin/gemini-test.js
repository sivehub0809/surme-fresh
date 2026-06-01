const { requireAdmin } = require('../_lib/supabase')
const { generateGeminiText } = require('../_lib/gemini')
const DEFAULT_MODEL = 'gemini-2.5-flash'

module.exports = async function geminiTest(req, res) {
  const auth = await requireAdmin(req, res)
  if (!auth) return

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const body = req.body || {}
  const message = String(body.message || 'Reply with a short friendly hello.').trim()
  const persona =
    String(body.persona || '')
      .trim() ||
    'You are SurMe, a personal AI assistant powered by Nilaamio. Reply naturally, warmly, and directly.'

  try {
    const reply = await generateGeminiText({
      systemInstruction: persona,
      prompt: message,
      temperature: 0.55,
      maxOutputTokens: 128,
      timeoutMs: 10000,
    })
    return res.status(200).json({
      ok: true,
      reply,
      model: String(process.env.AI_MODEL || DEFAULT_MODEL).trim(),
    })
  } catch (error) {
    console.error('Gemini test failed:', error)
    return res.status(500).json({
      ok: false,
      error: error.message || 'Gemini test failed',
      model: String(process.env.AI_MODEL || DEFAULT_MODEL).trim(),
    })
  }
}
