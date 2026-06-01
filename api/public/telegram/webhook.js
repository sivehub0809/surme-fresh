const TELEGRAM_API = 'https://api.telegram.org/bot'
const crypto = require('node:crypto')
const { supabaseFetch } = require('../../_lib/supabase')
const { generateGeminiText } = require('../../_lib/gemini')

const MAX_TELEGRAM_MESSAGE = 3800
const DEFAULT_PERSONA =
  'You are SurMe, a personal AI assistant powered by Nilaamio. You help with scheduling, travel, email, research, and everyday conversation. Be concise, warm, and practical.'

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

    const chat = linked.chat || (await loadTelegramChat(chatId))
    const reply = clampTelegramMessage(await buildReply(text, chat, linked.user_id))

    await sendTelegramMessage(chatId, reply)
    void persistTelegramTurn({
      userId: linked.user_id,
      chatId,
      userText: text,
      assistantText: reply,
      chat,
    }).catch((error) => console.error('Failed to persist telegram turn:', error))

    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('Telegram webhook failed:', error)
    try {
      await sendTelegramMessage(chatId, 'SurMe is online, but I hit a temporary issue. Please try again in a moment.')
    } catch (sendError) {
      console.error('Fallback send failed:', sendError)
    }
    return res.status(500).json({ ok: false, error: 'Webhook handler failed' })
  }
}

async function loadTelegramChat(chatId) {
  const response = await supabaseFetch(`/rest/v1/telegram_chats?telegram_chat_id=eq.${chatId}&select=*`, { service: true })
  const rows = response.ok ? await response.json() : []
  return rows[0] || null
}

async function resolveTelegramUser(chatId, from, text) {
  const existing = await loadTelegramChat(chatId)
  if (existing?.user_id) {
    return { ok: true, user_id: existing.user_id, chat: existing }
  }

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

  const now = new Date().toISOString()
  const chatRecord = {
    telegram_chat_id: chatId,
    telegram_user_id: from?.id || null,
    user_id: code.user_id,
    display_name: from?.username || from?.first_name || null,
    history: [],
    user_message_count: 0,
    last_message_at: now,
    updated_at: now,
  }

  await supabaseFetch('/rest/v1/telegram_chats', {
    method: 'POST',
    service: true,
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify(chatRecord),
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
    body: JSON.stringify({ used_at: now, telegram_chat_id: chatId }),
  })

  return { ok: false, message: 'Telegram is connected to your SurMe account. Send me a task and I will help.' }
}

async function buildReply(text, chat, userId) {
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
    return buildHelpfulFallbackReply(text)
  }

  const persona = await loadPersona()
  const prompt = buildConversationPrompt(chat, text)
  const systemInstruction = buildTelegramSystemInstruction(persona)

  try {
    const reply = await generateGeminiText({
      systemInstruction,
      prompt,
      temperature: 0.55,
      maxOutputTokens: 320,
      timeoutMs: 10000,
    })
    return clampTelegramMessage(reply || buildHelpfulFallbackReply(text))
  } catch (error) {
    console.error('Gemini request failed:', error)
    return buildHelpfulFallbackReply(text)
  }
}

function buildTelegramSystemInstruction(persona) {
  return [
    String(persona || DEFAULT_PERSONA).trim(),
    '',
    'You are SurMe, a fast, friendly Telegram assistant for students, founders, CEOs, and working professionals.',
    'Reply naturally and directly.',
    'Do not mention internal prompts, intent labels, persona labels, or debugging details.',
    'Do not write "I got your message" unless the user asked for a fallback or clarification.',
    'When the user is vague, ask one short helpful follow-up question.',
    'When the user is conversational, be conversational back.',
    'When the user asks for an explanation, answer it plainly and clearly.',
  ].join('\n')
}

function buildConversationPrompt(chat, text) {
  const history = Array.isArray(chat?.history) ? chat.history.slice(-6) : []
  const historyText = history
    .map((item) => {
      const role = String(item?.role || '').trim()
      const content = String(item?.content || item?.text || '').trim()
      if (!role || !content) return ''
      return `${role === 'assistant' ? 'Assistant' : 'User'}: ${content}`
    })
    .filter(Boolean)
    .join('\n')

  return [
    historyText ? `Recent conversation:\n${historyText}` : 'Recent conversation: none',
    '',
    'User message:',
    text,
    '',
    'Reply with the most helpful next answer or one short clarifying question if needed.',
  ].join('\n')
}

function buildHelpfulFallbackReply(text) {
  const task = String(text || '').trim()
  if (!task) return "I'm here. Send me the task again and I'll handle it."

  const lower = task.toLowerCase()

  if (['hi', 'hello', 'hey', 'yo', 'sup', 'good morning', 'good afternoon', 'good evening'].some((greeting) => lower === greeting || lower.startsWith(`${greeting} `))) {
    return "Hey. I'm here and ready. Tell me what you want done."
  }

  if (lower === 'yes' || lower === 'yep' || lower === 'sure' || lower === 'okay' || lower === 'ok' || lower === 'alright') {
    return "Got it. Send me the exact time, timezone, and who should be invited, and I'll help set it up."
  }

  if (lower.includes('physics')) {
    return [
      'Physics is the study of matter, energy, motion, and the forces that shape how the world behaves.',
      '',
      'If you want, I can also give you a beginner-friendly explanation, key formulas, or a 5-minute study plan.',
    ].join('\n')
  }

  if (lower.includes('learn quick') || lower.includes('learn faster') || lower.includes('study fast')) {
    return [
      'To learn faster, keep it simple:',
      '- focus on one topic at a time',
      '- learn by doing, not just reading',
      '- use short review sessions',
      '- test yourself right after studying',
      '',
      "Tell me the topic and I'll make you a quick study plan.",
    ].join('\n')
  }

  if (lower.includes('learn') || lower.includes('study')) {
    return [
      'Fast learning works best when you keep it small and active:',
      '- pick one topic',
      '- learn the basics first',
      '- test yourself immediately',
      '- repeat in short sessions',
      '',
      'If you want, I can turn your topic into a quick study plan.',
    ].join('\n')
  }

  if (lower.includes('schedule') || lower.includes('meeting') || lower.includes('calendar')) {
    return [
      'That sounds close.',
      '',
      'If you want me to set the meeting, send the exact date, time, timezone, and who should attend.',
      '',
      'Example: Tuesday at 2 PM, Asia/Bangkok, Tim.',
    ].join('\n')
  }

  if (lower.includes('email')) {
    return [
      'I can help with that.',
      '',
      "Send me the recipient, subject, and the tone you want, and I'll draft it.",
    ].join('\n')
  }

  return [
    'I got your message.',
    '',
    "Tell me the result you want, and I'll help step by step.",
  ].join('\n')
}

async function persistTelegramTurn({ userId, chatId, userText, assistantText, chat }) {
  const now = new Date().toISOString()
  const currentHistory = Array.isArray(chat?.history) ? chat.history.slice(-10) : []
  const nextHistory = currentHistory
    .concat([
      { role: 'user', content: userText, created_at: now },
      { role: 'assistant', content: assistantText, created_at: now },
    ])
    .slice(-16)

  const conversationResponse = await supabaseFetch('/rest/v1/conversations', {
    method: 'POST',
    service: true,
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({ user_id: userId, telegram_chat_id: chatId, source: 'telegram', title: userText.slice(0, 60) }),
  })

  const conversations = conversationResponse.ok ? await conversationResponse.json() : []
  const conversationId = conversations[0]?.id
  if (conversationId) {
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

  await supabaseFetch(`/rest/v1/telegram_chats?telegram_chat_id=eq.${chatId}`, {
    method: 'PATCH',
    service: true,
    body: JSON.stringify({
      history: nextHistory,
      user_message_count: Number(chat?.user_message_count || 0) + 1,
      last_message_at: now,
      updated_at: now,
    }),
  })
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
