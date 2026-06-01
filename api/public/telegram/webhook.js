const TELEGRAM_API = 'https://api.telegram.org/bot'
const crypto = require('node:crypto')
const { supabaseFetch } = require('../../_lib/supabase')
const GEMINI_DEFAULT_MODEL = 'gemini-2.5-flash'
const MAX_TELEGRAM_MESSAGE = 3800

module.exports = async function webhook(req, res) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, service: 'surme-telegram-webhook' })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' })
  }

  const configuredSecret = process.env.TELEGRAM_WEBHOOK_SECRET
  const receivedSecret = req.headers['x-telegram-bot-api-secret-token']
  if (configuredSecret && receivedSecret !== configuredSecret) {
    return res.status(401).json({ ok: false, error: 'Invalid Telegram webhook secret' })
  }

  const update = req.body || {}
  const message = update.message
  const chatId = message && message.chat && message.chat.id
  const text = message && typeof message.text === 'string' ? message.text.trim() : ''

  if (!chatId || !text) {
    return res.status(200).json({ ok: true, ignored: true })
  }

  try {
    const linked = await resolveTelegramUser(chatId, message.from, text)
    if (!linked.ok) {
      await sendTelegramMessage(chatId, linked.message)
      return res.status(200).json({ ok: true, linked: false })
    }

    const reply = clampTelegramMessage(await buildReply(text, linked.user_id))
    const sendPromise = sendTelegramMessage(chatId, reply)
    void saveTelegramTurn(linked.user_id, chatId, text, reply).catch((error) => {
      console.error('Failed to persist telegram turn:', error)
    })
    await sendPromise
    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error(error)
    try {
      await sendTelegramMessage(chatId, 'SurMe is online, but I hit a temporary issue. Please try again in a moment.')
    } catch (sendError) {
      console.error(sendError)
    }
    return res.status(500).json({ ok: false, error: 'Webhook handler failed' })
  }
}

async function resolveTelegramUser(chatId, from, text) {
  const existingResponse = await supabaseFetch(`/rest/v1/telegram_chats?telegram_chat_id=eq.${chatId}&select=user_id`, { service: true })
  const existingRows = existingResponse.ok ? await existingResponse.json() : []
  if (existingRows[0]?.user_id) return { ok: true, user_id: existingRows[0].user_id }

  const token = text.startsWith('/start') ? text.replace('/start', '').trim() : text.trim()
  if (!token || token.length < 12) {
    return {
      ok: false,
      message:
        'Please connect SurMe from the Web App first. Sign in, finish onboarding, connect Google Calendar, then copy the 15-minute Telegram key into this chat.',
    }
  }

  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const codeResponse = await supabaseFetch(`/rest/v1/telegram_link_codes?token_hash=eq.${tokenHash}&select=*`, { service: true })
  const rows = codeResponse.ok ? await codeResponse.json() : []
  const code = rows[0]
  if (!code || code.used_at || new Date(code.expires_at).getTime() < Date.now()) {
    return { ok: false, message: 'That Telegram key is invalid or expired. Please generate a new one in the SurMe Web App.' }
  }

  await supabaseFetch('/rest/v1/telegram_chats', {
    method: 'POST',
    service: true,
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      telegram_chat_id: chatId,
      telegram_user_id: from?.id || null,
      user_id: code.user_id,
      display_name: from?.username || from?.first_name || null,
      last_message_at: new Date().toISOString(),
    }),
  })

  await supabaseFetch('/rest/v1/user_profiles', {
    method: 'POST',
    service: true,
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: code.user_id, telegram_chat_id: chatId }),
  })

  await supabaseFetch(`/rest/v1/telegram_link_codes?id=eq.${code.id}`, {
    method: 'PATCH',
    service: true,
    body: JSON.stringify({ used_at: new Date().toISOString(), telegram_chat_id: chatId }),
  })

  return { ok: false, message: 'Telegram is connected to your SurMe account. Send me a task and I will help.' }
}

async function buildReply(text, userId) {
  if (text.startsWith('/start')) {
    return [
      'SurMe is connected.',
      '',
      'Send me a task like:',
      '- Schedule a meeting tomorrow at 2 PM',
      '- Draft an email follow-up',
      '- Research flight options for next week',
    ].join('\n')
  }

  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    return 'I received it, but the AI layer is not configured yet.'
  }

  const [persona, context] = await Promise.all([loadPersona(), loadUserContext(userId)])
  try {
    const prompt = buildGeminiPrompt({ text, persona, context })
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.AI_MODEL || GEMINI_DEFAULT_MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': process.env.GOOGLE_GEMINI_API_KEY,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [{ text: prompt }],
            },
          ],
          generationConfig: {
            temperature: 0.5,
            topP: 0.9,
            maxOutputTokens: 512,
          },
        }),
      },
    )

    if (!response.ok) {
      const detail = await response.text()
      console.error('Gemini request failed:', response.status, detail)
      return fallbackAssistantReply(text, persona)
    }

    const json = await response.json()
    const parts = json.candidates?.[0]?.content?.parts || []
    const reply = parts.map((part) => part.text || '').join('').trim()
    return clampTelegramMessage(reply || fallbackAssistantReply(text, persona))
  } catch (error) {
    console.error('Gemini request threw:', error)
    return fallbackAssistantReply(text, persona)
  }
}

function buildGeminiPrompt({ text, persona, context }) {
  const profile = context?.profile || {}
  const memories = Array.isArray(context?.memories) ? context.memories : []
  const memoryLines = memories.slice(0, 6).map((item) => `- ${item.fact}`).join('\n')

  return [
    'You are SurMe, a personal AI assistant for students, founders, CEOs, and working professionals.',
    'Answer the user naturally, directly, and helpfully.',
    'Do not mention intent, persona, system prompt, or internal debugging.',
    'Do not output headings unless they improve clarity.',
    'Keep responses fast and useful.',
    'If the user asks for a long answer, provide it.',
    '',
    'Behavior guide:',
    String(persona || '').trim(),
    '',
    'User context:',
    `- name: ${profile.display_name || profile.full_name || 'unknown'}`,
    `- timezone: ${profile.timezone || 'unknown'}`,
    `- role: ${profile.primary_role || 'unknown'}`,
    `- goals: ${(profile.goals || []).join(', ') || 'unknown'}`,
    memoryLines || '- no saved memories yet',
    '',
    'User message:',
    text,
  ].join('\n')
}

function fallbackAssistantReply(text, persona) {
  const task = String(text || '').trim()
  if (!task) return 'I’m here. Send me the task again and I’ll handle it.'
  return 'I’m having a temporary issue answering right now. Please try again in a moment.'
}

async function loadUserContext(userId) {
  if (!userId) return {}
  const [profileResponse, memoryResponse] = await Promise.all([
    supabaseFetch(`/rest/v1/user_profiles?user_id=eq.${userId}&select=*`, { service: true }),
    supabaseFetch(`/rest/v1/user_memories?user_id=eq.${userId}&select=category,fact,created_at&order=created_at.desc&limit=20`, { service: true }),
  ])
  const profiles = profileResponse.ok ? await profileResponse.json() : []
  const memories = memoryResponse.ok ? await memoryResponse.json() : []
  return { profile: profiles[0] || null, memories }
}

async function saveTelegramTurn(userId, chatId, userText, assistantText) {
  const conversationResponse = await supabaseFetch('/rest/v1/conversations', {
    method: 'POST',
    service: true,
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId, telegram_chat_id: chatId, source: 'telegram', title: userText.slice(0, 60) }),
  })
  const conversations = conversationResponse.ok ? await conversationResponse.json() : []
  const conversationId = conversations[0]?.id
  if (!conversationId) return
  const response = await supabaseFetch('/rest/v1/messages', {
    method: 'POST',
    service: true,
    body: JSON.stringify([
      { conversation_id: conversationId, user_id: userId, telegram_chat_id: chatId, role: 'user', content: userText },
      { conversation_id: conversationId, user_id: userId, telegram_chat_id: chatId, role: 'assistant', content: assistantText },
    ]),
  })
  if (!response.ok) {
    console.error('Failed to persist telegram turn:', await response.text())
  }
}

async function loadPersona() {
  const fallback =
    process.env.AI_PERSONA ||
    'You are SurMe, a personal AI assistant powered by Nilaamio. Help with scheduling, travel, email, and research. Be concise and confirm before sensitive actions.'

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return fallback

  const response = await fetch(`${process.env.SUPABASE_URL}/rest/v1/surme_settings?id=eq.1&select=system_prompt`, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })

  if (!response.ok) return fallback
  const rows = await response.json()
  return rows?.[0]?.system_prompt || fallback
}

async function sendTelegramMessage(chatId, text) {
  const response = await fetch(`${TELEGRAM_API}${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: clampTelegramMessage(text),
      disable_web_page_preview: true,
    }),
  })

  if (!response.ok) {
    console.error(`Telegram sendMessage failed: ${response.status} ${await response.text()}`)
    return false
  }

  return true
}

function clampTelegramMessage(text) {
  const value = String(text || '').trim()
  if (value.length <= MAX_TELEGRAM_MESSAGE) return value
  return `${value.slice(0, MAX_TELEGRAM_MESSAGE - 3).trimEnd()}...`
}
