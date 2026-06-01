const ADMIN_EMAIL = 'nilaademo@gmail.com'
const DEFAULT_PROMPT =
  'You are SurMe, a personal AI assistant powered by Nilaamio. Help with scheduling, travel, email, and research. Be concise, friendly, and confirm before sensitive actions.'
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'

module.exports = async function persona(req, res) {
  const auth = await requireAdmin(req)
  if (!auth.ok) return res.status(auth.status).json({ ok: false, error: auth.error })

  if (req.method === 'GET') {
    const systemPrompt = await loadPersona()
    return res.status(200).json({ ok: true, system_prompt: systemPrompt })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const body = req.body || {}
  if (body.action === 'structure') {
    const systemPrompt = await structurePersona(String(body.draft || ''))
    return res.status(200).json({ ok: true, system_prompt: systemPrompt })
  }

  if (body.action === 'save') {
    const systemPrompt = String(body.system_prompt || '').trim()
    if (!systemPrompt) return res.status(400).json({ ok: false, error: 'system_prompt is required' })
    await savePersona(systemPrompt)
    return res.status(200).json({ ok: true, system_prompt: systemPrompt })
  }

  return res.status(400).json({ ok: false, error: 'Unknown persona action' })
}

async function requireAdmin(req) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_ANON_KEY) {
    return { ok: false, status: 500, error: 'Supabase env vars are not configured' }
  }

  const token = req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, '')
  if (!token) return { ok: false, status: 401, error: 'Missing bearer token' }

  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/user`, {
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: process.env.SUPABASE_ANON_KEY,
    },
  })

  if (!response.ok) return { ok: false, status: 401, error: 'Invalid Supabase session' }
  const user = await response.json()
  if (String(user.email || '').toLowerCase() !== ADMIN_EMAIL) {
    return { ok: false, status: 403, error: 'Admin access denied' }
  }

  return { ok: true, user }
}

async function structurePersona(draft) {
  const cleanDraft = draft.trim()
  if (!cleanDraft) return DEFAULT_PROMPT

  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    return [
      'You are SurMe, a personal AI assistant powered by Nilaamio.',
      '',
      'Admin persona direction:',
      cleanDraft,
      '',
      'Behavior rules:',
      '- Convert simple user intents into clear next actions.',
      '- Keep replies concise, warm, and practical.',
      '- Ask for confirmation before sending email, booking travel, spending money, changing attendee calendar events, or deleting data.',
      '- Preserve user privacy and only use integrations required for the task.',
      '- When the user asks for research, synthesize with useful tradeoffs and cite sources when available.',
    ].join('\n')
  }

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.AI_MODEL || GEMINI_DEFAULT_MODEL)}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GOOGLE_GEMINI_API_KEY,
      },
      body: JSON.stringify({
        system_instruction: {
          parts: [
            {
              text: 'Turn the admin instruction into a production system prompt for a personal AI assistant. Keep it specific, structured, safe, and concise.',
            },
          ],
        },
        contents: [
          {
            parts: [{ text: cleanDraft }],
          },
        ],
      }),
    })

    if (!response.ok) throw new Error(`Gemini persona structure failed: ${response.status} ${await response.text()}`)
    const json = await response.json()
    return json.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || DEFAULT_PROMPT
  } catch (error) {
    console.error('Persona structure failed, falling back to default prompt:', error)
    return [
      'You are SurMe, a personal AI assistant powered by Nilaamio.',
      '',
      'Admin persona direction:',
      cleanDraft,
      '',
      'Behavior rules:',
      '- Convert simple user intents into clear next actions.',
      '- Keep replies concise, warm, and practical.',
      '- Ask for confirmation before sending email, booking travel, spending money, changing attendee calendar events, or deleting data.',
      '- Preserve user privacy and only use integrations required for the task.',
      '- When the user asks for research, synthesize with useful tradeoffs and cite sources when available.',
    ].join('\n')
  }
}

async function loadPersona() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.AI_PERSONA || DEFAULT_PROMPT

  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/surme_settings?id=eq.1&select=system_prompt`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })

  if (!response.ok) return process.env.AI_PERSONA || DEFAULT_PROMPT
  const rows = await response.json()
  return rows?.[0]?.system_prompt || process.env.AI_PERSONA || DEFAULT_PROMPT
}

async function savePersona(systemPrompt) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required to save persona')
  }

  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/surme_settings`, {
    method: 'POST',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify({
      id: 1,
      system_prompt: systemPrompt,
      updated_at: new Date().toISOString(),
    }),
  })

  if (!response.ok) throw new Error(`Supabase persona save failed: ${response.status} ${await response.text()}`)
}
