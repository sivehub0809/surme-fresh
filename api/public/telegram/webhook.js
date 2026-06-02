const TELEGRAM_API = 'https://api.telegram.org/bot'
const crypto = require('node:crypto')
const { supabaseFetch } = require('../../_lib/supabase')
const { generateGeminiText } = require('../../_lib/gemini')

const MAX_TELEGRAM_MESSAGE = 3800
const DEFAULT_TIMEZONE = 'Asia/Phnom_Penh'
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
  const caption = message && typeof message.caption === 'string' ? message.caption.trim() : ''
  const hasPhoto = Boolean(message && Array.isArray(message.photo) && message.photo.length)

  if (!chatId || (!text && !caption && !hasPhoto)) {
    return res.status(200).json({ ok: true, ignored: true })
  }

  try {
    const linked = await resolveTelegramUser(chatId, message.from, text || caption || '')
    if (!linked.ok) {
      await sendTelegramMessage(chatId, linked.message)
      return res.status(200).json({ ok: true, linked: false })
    }

    const chat = linked.chat || (await loadTelegramChat(chatId))
    const replyResult = await buildReply({
      text: text || caption || '',
      chat,
      userId: linked.user_id,
      chatId,
      message,
    })
    const reply = clampTelegramMessage(replyResult.text)

    await sendTelegramMessage(chatId, reply)
    void persistTelegramTurn({
      userId: linked.user_id,
      chatId,
      userText: text || caption || '[photo]',
      assistantText: reply,
      chat,
      pendingAction: replyResult.pendingAction || null,
      pendingPayload: replyResult.pendingPayload || null,
    }).catch((error) => console.error('Failed to persist telegram turn:', error))

    return res.status(200).json({ ok: true })
  } catch (error) {
    console.error('Telegram webhook failed:', error)
    await logRuntimeEvent({
      eventType: 'telegram_webhook_failed',
      chatId,
      success: false,
      errorMessage: error.message || 'Telegram webhook failed',
      metadata: { text },
    }).catch((logError) => console.error('Failed to log webhook failure:', logError))
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

async function buildReply({ text, chat, userId, chatId, message }) {
  const cleanText = String(text || '').trim()

  if (cleanText.startsWith('/start')) {
    return {
      text: [
        'SurMe is connected.',
        '',
        'Send me a task like:',
        '- Schedule a meeting tomorrow at 2 PM',
        '- Draft an email follow-up',
        '- Research flight options for next week',
      ].join('\n'),
      pendingAction: null,
      pendingPayload: null,
    }
  }

  if (message && Array.isArray(message.photo) && message.photo.length) {
    return await buildImageReply({ message, text: cleanText, userId, chatId })
  }

  const pendingReply = await resumePendingSchedule({ text: cleanText, chat, userId, chatId })
  if (pendingReply) return pendingReply

  const scheduleIntent = parseScheduleIntent(cleanText, chat)
  if (scheduleIntent?.needsFollowUp) {
    return {
      text: scheduleIntent.question,
      pendingAction: 'schedule_meeting',
      pendingPayload: scheduleIntent.payload,
    }
  }

  if (scheduleIntent?.readyToCreate) {
    const calendarResult = await createCalendarEventForSchedule({
      userId,
      chatId,
      schedule: scheduleIntent.payload,
      topic: scheduleIntent.topic,
    })
    return {
      text: calendarResult.message,
      pendingAction: null,
      pendingPayload: null,
    }
  }

  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    await logRuntimeEvent({
      eventType: 'telegram_ai_failed',
      userId,
      chatId,
      success: false,
      errorMessage: 'GOOGLE_GEMINI_API_KEY is not configured',
      metadata: { reason: 'missing_gemini_key', text: cleanText },
    })
    return {
      text: buildHelpfulFallbackReply(cleanText),
      pendingAction: null,
      pendingPayload: null,
    }
  }

  const persona = await loadPersona()
  const prompt = buildConversationPrompt(chat, cleanText)
  const systemInstruction = buildTelegramSystemInstruction(persona)

  try {
    const reply = await generateGeminiText({
      systemInstruction,
      prompt,
      temperature: 0.55,
      maxOutputTokens: 320,
      thinkingBudget: 0,
      timeoutMs: 9000,
    })
    return {
      text: clampTelegramMessage(reply || buildHelpfulFallbackReply(cleanText)),
      pendingAction: null,
      pendingPayload: null,
    }
  } catch (error) {
    console.error('Gemini request failed:', error)
    await logRuntimeEvent({
      eventType: 'telegram_ai_failed',
      userId,
      chatId,
      success: false,
      errorMessage: error.message || 'Gemini request failed',
      metadata: { text: cleanText },
    })
    return {
      text: buildHelpfulFallbackReply(cleanText),
      pendingAction: null,
      pendingPayload: null,
    }
  }
}

async function resumePendingSchedule({ text, chat, userId, chatId }) {
  if (String(chat?.pending_action || '') !== 'schedule_meeting') return null

  const pending = normalizePendingPayload(chat?.pending_payload)
  const followUp = normalizeScheduleTopic(text)

  if (pending.missing === 'topic' && isGenericAcknowledge(followUp)) {
    return {
      text: 'What’s the meeting about?',
      pendingAction: 'schedule_meeting',
      pendingPayload: pending,
    }
  }

  if (!followUp || isGenericAcknowledge(followUp)) {
    const question =
      pending.missing === 'date'
        ? 'What day should I use?'
        : pending.missing === 'time'
          ? 'What time should I use?'
          : "What’s the meeting about?"
    return {
      text: question,
      pendingAction: 'schedule_meeting',
      pendingPayload: pending,
    }
  }

  const topic = followUp || pending.topic || 'Meeting'
  const result = await createCalendarEventForSchedule({
    userId,
    chatId,
    schedule: pending,
    topic,
  })

  return {
    text: result.message,
    pendingAction: null,
    pendingPayload: null,
  }
}

function parseScheduleIntent(text, chat) {
  const normalized = String(text || '').trim().toLowerCase()
  if (!/(schedule|set up|set a meeting|book|calendar|meeting)/i.test(normalized)) return null

  const timezone = extractScheduleTimezone(normalized) || chat?.timezone || DEFAULT_TIMEZONE
  const dateParts = extractScheduleDateParts(normalized, timezone)
  const timeRange = extractScheduleTimeRange(normalized)
  const topic = extractScheduleTopic(text)
  const attendeesText = extractScheduleAttendees(text)

  const missing = []
  if (!dateParts) missing.push('date')
  if (!timeRange) missing.push('time')
  if (!topic) missing.push('topic')

  const payload = {
    timezone,
    dateParts,
    timeRange,
    topic,
    attendeesText,
    sourceText: text,
    missing: missing[0] || null,
  }

  if (missing.length) {
    return {
      needsFollowUp: true,
      question:
        missing[0] === 'topic'
          ? "What’s the meeting about?"
          : missing[0] === 'time'
            ? 'What time should I use?'
            : 'What day should I use?',
      payload,
    }
  }

  return {
    readyToCreate: true,
    payload,
    topic,
  }
}

function extractScheduleTimezone(text) {
  if (!text) return null
  if (text.includes('phnom') || text.includes('cambodia') || text.includes('gmt+7') || text.includes('utc+7') || text.includes('asia/bangkok')) {
    return DEFAULT_TIMEZONE
  }
  return null
}

function extractScheduleDateParts(text, timeZone) {
  const current = getZonedDateParts(new Date(), timeZone)
  if (!current) return null

  if (text.includes('tomorrow')) return addDaysToDateParts(current, 1)
  if (text.includes('today')) return current

  const weekdayMatch = text.match(/\b(next\s+)?(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/)
  if (weekdayMatch) {
    const target = weekdayIndex(weekdayMatch[2])
    const currentIndex = weekdayIndex(current.weekday)
    const baseAhead = (target - currentIndex + 7) % 7 || 7
    return addDaysToDateParts(current, weekdayMatch[1] ? baseAhead + 7 : baseAhead)
  }

  return null
}

function extractScheduleTimeRange(text) {
  const normalized = String(text || '').toLowerCase()
  const rangeMatch = normalized.match(/(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|to|till|until|through)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/)
  if (rangeMatch) {
    return {
      start: normalizeClock(rangeMatch[1], rangeMatch[2], rangeMatch[3]),
      end: normalizeClock(rangeMatch[4], rangeMatch[5], rangeMatch[6], true),
    }
  }

  const singleMatch = normalized.match(/\b(?:at\s*)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
  if (singleMatch) {
    const start = normalizeClock(singleMatch[1], singleMatch[2], singleMatch[3])
    return { start, end: { hour: (start.hour + 1) % 24, minute: start.minute } }
  }

  return null
}

function extractScheduleTopic(text) {
  const maybe = String(text || '').trim()
  if (!maybe) return null

  const explicit = maybe.match(/\b(?:about|regarding|for)\s+(.+?)(?:[.?!,]|$)/i)
  if (!explicit?.[1]) return null

  const topic = normalizeScheduleTopic(explicit[1])
    .replace(/\bwith\s+.+$/i, '')
    .replace(/\b(?:tomorrow|today|tonight|this\s+week|next\s+week)\b/i, '')
    .replace(/\b(?:at\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?|from\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\s*(?:to|till|until)\s*\d{1,2}(?::\d{2})?\s*(?:am|pm)?)\b/i, '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!topic || topic.length < 2 || isGenericAcknowledge(topic)) return null
  return topic
}

function extractScheduleAttendees(text) {
  const match = String(text || '').match(/\bwith\s+(.+?)(?:\s+(?:tomorrow|today|on|at|this|next)\b|$)/i)
  if (!match) return null
  const raw = match[1].trim()
  if (!raw) return null
  return raw.replace(/^me and\s+/i, '').replace(/\band\b/gi, ', ').trim()
}

function normalizeScheduleTopic(text) {
  return String(text || '')
    .replace(/^\s*(about|regarding|for)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
}

function normalizePendingPayload(payload) {
  const data = payload && typeof payload === 'object' ? payload : {}
  return {
    timezone: data.timezone || DEFAULT_TIMEZONE,
    dateParts: data.dateParts || null,
    timeRange: data.timeRange || null,
    topic: data.topic || null,
    attendeesText: data.attendeesText || null,
    sourceText: data.sourceText || '',
    missing: data.missing || null,
  }
}

function isGenericAcknowledge(text) {
  const value = String(text || '').trim().toLowerCase()
  return ['yes', 'yep', 'sure', 'okay', 'ok', 'alright', 'yea', 'yeah', 'bro', 'lol', 'hmm', 'cool'].includes(value)
}

function getZonedDateParts(date, timeZone) {
  try {
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      weekday: 'long',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
    const parts = formatter.formatToParts(date)
    const year = Number(parts.find((item) => item.type === 'year')?.value)
    const month = Number(parts.find((item) => item.type === 'month')?.value)
    const day = Number(parts.find((item) => item.type === 'day')?.value)
    const weekday = parts.find((item) => item.type === 'weekday')?.value || 'monday'
    if (!year || !month || !day) return null
    return { year, month, day, weekday }
  } catch {
    return null
  }
}

function addDaysToDateParts(parts, days) {
  const utc = new Date(Date.UTC(parts.year, parts.month - 1, parts.day))
  utc.setUTCDate(utc.getUTCDate() + Number(days || 0))
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
    weekday: utc.toLocaleDateString('en-US', { weekday: 'long', timeZone: 'UTC' }),
  }
}

function weekdayIndex(value) {
  return {
    sunday: 0,
    monday: 1,
    tuesday: 2,
    wednesday: 3,
    thursday: 4,
    friday: 5,
    saturday: 6,
  }[String(value || '').toLowerCase()] ?? 0
}

function normalizeClock(hourRaw, minuteRaw, meridiemRaw, allowMidnightWrap = false) {
  let hour = Number(hourRaw || 0)
  const minute = Number(minuteRaw || 0)
  const meridiem = String(meridiemRaw || '').toLowerCase()

  if (meridiem === 'pm' && hour < 12) hour += 12
  if (meridiem === 'am' && hour === 12) hour = 0
  if (allowMidnightWrap && hour === 0) hour = 12

  return { hour, minute }
}

function buildDateTimeInTimezone(dateParts, clock, timeZone) {
  const utc = Date.UTC(dateParts.year, dateParts.month - 1, dateParts.day, clock.hour, clock.minute, 0)
  const offsetMinutes = getTimeZoneOffsetMinutes(timeZone, new Date(utc))
  return new Date(utc - offsetMinutes * 60 * 1000).toISOString()
}

function getTimeZoneOffsetMinutes(timeZone, date) {
  try {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hour12: false,
      timeZoneName: 'shortOffset',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    }).formatToParts(date)
    const token = parts.find((item) => item.type === 'timeZoneName')?.value || 'GMT+0'
    const match = token.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/i)
    if (!match) return 0
    const sign = match[1] === '-' ? -1 : 1
    const hours = Number(match[2] || 0)
    const minutes = Number(match[3] || 0)
    return sign * (hours * 60 + minutes)
  } catch {
    return 0
  }
}

function buildMeetingTitle(topic, attendeesText) {
  const cleanedTopic = String(topic || '').trim()
  const cleanedAttendees = String(attendeesText || '').trim()
  const base = cleanedTopic ? `Meeting about ${cleanedTopic}` : 'Meeting'
  return cleanedAttendees ? `${base} with ${cleanedAttendees}` : base
}

async function createCalendarEventForSchedule({ userId, chatId, schedule, topic }) {
  const tokenRow = await loadGoogleToken(userId)
  if (!tokenRow) {
    return {
      ok: false,
      message: 'Connect Google Calendar in the Web App first, then send the scheduling request again.',
    }
  }

  const profile = await loadUserProfile(userId)
  const timeZone = schedule.timezone || profile?.timezone || DEFAULT_TIMEZONE
  const startAt = schedule.startAt || buildDateTimeInTimezone(schedule.dateParts, schedule.timeRange.start, timeZone)
  const endAt =
    schedule.endAt || buildDateTimeInTimezone(schedule.dateParts, schedule.timeRange.end || { hour: (schedule.timeRange.start.hour + 1) % 24, minute: schedule.timeRange.start.minute }, timeZone)
  const summary = buildMeetingTitle(topic, schedule.attendeesText)

  const event = {
    summary,
    description: `Created from Telegram.\n\nOriginal request:\n${schedule.sourceText || summary}`,
    start: { dateTime: startAt, timeZone },
    end: { dateTime: endAt, timeZone },
  }

  const createResponse = await googleCalendarRequest({
    accessToken: tokenRow.access_token,
    refreshToken: tokenRow.refresh_token,
    userId,
    chatId,
    path: '/calendar/v3/calendars/primary/events',
    method: 'POST',
    body: event,
  })

  if (!createResponse.ok) {
    return {
      ok: false,
      message: createResponse.message || 'I could not create the calendar event right now.',
    }
  }

  const startLabel = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(startAt))

  return {
    ok: true,
    message: `Done. I added "${summary}" to your calendar for ${startLabel}.`,
  }
}

async function googleCalendarRequest({ accessToken, refreshToken, userId, chatId, path, method, body }) {
  const doRequest = async (token) => {
    return fetch(`https://www.googleapis.com${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    })
  }

  let response = await doRequest(accessToken)
  if (response.status === 401 && refreshToken) {
    const refreshed = await refreshGoogleAccessToken(refreshToken)
    if (refreshed?.access_token) {
      response = await doRequest(refreshed.access_token)
      if (response.ok) {
        await supabaseFetch('/rest/v1/google_oauth_tokens?user_id=eq.' + userId, {
          method: 'PATCH',
          service: true,
          body: JSON.stringify({
            access_token: refreshed.access_token,
            refresh_token: refreshed.refresh_token || refreshToken,
            expiry: refreshed.expiry || null,
            scope: refreshed.scope || null,
          }),
        })
      }
    }
  }

  if (!response.ok) {
    const errorText = await response.text()
    await logRuntimeEvent({
      eventType: 'telegram_ai_failed',
      userId,
      chatId,
      success: false,
      errorMessage: `Google Calendar request failed: ${response.status}`,
      metadata: { path, method, errorText },
    }).catch((error) => console.error('Failed to log calendar error:', error))
    return { ok: false, message: 'I could not create the calendar event right now. Please try again.' }
  }

  return { ok: true, data: await response.json().catch(() => ({})) }
}

async function refreshGoogleAccessToken(refreshToken) {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) return null
  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID,
      client_secret: process.env.GOOGLE_CLIENT_SECRET,
      refresh_token: refreshToken,
      grant_type: 'refresh_token',
    }),
  })
  if (!response.ok) return null
  const token = await response.json()
  return {
    access_token: token.access_token,
    refresh_token: token.refresh_token || refreshToken,
    expiry: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
    scope: token.scope || null,
  }
}

async function loadUserProfile(userId) {
  const response = await supabaseFetch(`/rest/v1/user_profiles?user_id=eq.${userId}&select=*`, { service: true })
  const rows = response.ok ? await response.json() : []
  return rows[0] || null
}

async function loadGoogleToken(userId) {
  const response = await supabaseFetch(`/rest/v1/google_oauth_tokens?user_id=eq.${userId}&select=*`, { service: true })
  const rows = response.ok ? await response.json() : []
  return rows[0] || null
}

async function buildImageReply({ message, text, userId, chatId }) {
  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    return {
      text: 'I can read the image, but image analysis is not connected yet.',
      pendingAction: null,
      pendingPayload: null,
    }
  }

  const photoPart = await getTelegramPhotoPart(message)
  if (!photoPart) {
    return {
      text: buildHelpfulFallbackReply(text || 'photo'),
      pendingAction: null,
      pendingPayload: null,
    }
  }

  const persona = await loadPersona()
  const imagePrompt = [
    'The user sent an image in Telegram.',
    text ? `User text or caption: ${text}` : 'No caption was provided.',
    'Describe the image, extract any visible useful details, and answer the user naturally.',
    'If the image contains a screenshot or document, summarize the important text and context.',
    'If the image is ambiguous, ask one short clarifying question.',
  ].join('\n')

  try {
    const reply = await generateGeminiText({
      systemInstruction: buildTelegramSystemInstruction(persona),
      parts: [{ text: imagePrompt }, photoPart],
      temperature: 0.35,
      maxOutputTokens: 320,
      thinkingBudget: 0,
      timeoutMs: 12000,
    })
    return {
      text: clampTelegramMessage(reply || 'I can see the image, but I need another try.'),
      pendingAction: null,
      pendingPayload: null,
    }
  } catch (error) {
    await logRuntimeEvent({
      eventType: 'telegram_ai_failed',
      userId,
      chatId,
      success: false,
      errorMessage: error.message || 'Telegram image analysis failed',
      metadata: { image: true, text },
    })
    return {
      text: buildHelpfulFallbackReply(text || 'photo'),
      pendingAction: null,
      pendingPayload: null,
    }
  }
}

async function getTelegramPhotoPart(message) {
  const photos = Array.isArray(message?.photo) ? message.photo : []
  if (!photos.length || !process.env.TELEGRAM_BOT_TOKEN) return null

  const best = photos[photos.length - 1]
  const fileResponse = await fetch(`${TELEGRAM_API}${process.env.TELEGRAM_BOT_TOKEN}/getFile?file_id=${encodeURIComponent(best.file_id)}`)
  if (!fileResponse.ok) return null
  const fileJson = await fileResponse.json()
  const filePath = fileJson?.result?.file_path
  if (!filePath) return null

  const imageResponse = await fetch(`https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${filePath}`)
  if (!imageResponse.ok) return null
  const arrayBuffer = await imageResponse.arrayBuffer()
  const base64 = Buffer.from(arrayBuffer).toString('base64')
  return {
    inlineData: {
      mimeType: 'image/jpeg',
      data: base64,
    },
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
    `Default timezone: ${DEFAULT_TIMEZONE}.`,
    'For scheduling, ask at most one clarification before creating the event.',
    'If enough scheduling details exist, create the calendar event immediately.',
    'If a scheduling request has the date, time, and attendees but is missing the topic, ask exactly one question: "What’s the meeting about?"',
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
  if (!task) return "I'm here. Send me the task again and I'll help."

  const lower = task.toLowerCase()

  if (['hi', 'hello', 'hey', 'yo', 'sup', 'good morning', 'good afternoon', 'good evening'].some((greeting) => lower === greeting || lower.startsWith(`${greeting} `))) {
    return "Hey. I'm here and ready. What do you want to do?"
  }

  if (lower === 'yes' || lower === 'yep' || lower === 'sure' || lower === 'okay' || lower === 'ok' || lower === 'alright') {
    return "Got it. Send me the exact time, timezone, and who should be invited."
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
      'What’s the meeting about?',
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
    'I’m here.',
    '',
    "Send me the result you want, and I'll help step by step.",
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
    await logRuntimeEvent({
      eventType: 'telegram_webhook_failed',
      chatId,
      success: false,
      errorMessage: `Telegram sendMessage failed: ${response.status}`,
      metadata: { text: clampTelegramMessage(text) },
    }).catch((error) => console.error('Failed to log telegram send error:', error))
    return false
  }

  return true
}

async function logRuntimeEvent({ eventType, userId = null, chatId = null, success = false, errorMessage = null, metadata = {} }) {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return
  await supabaseFetch('/rest/v1/runtime_events', {
    method: 'POST',
    service: true,
    body: JSON.stringify({
      source: 'telegram',
      event_type: eventType,
      user_id: userId,
      telegram_chat_id: chatId,
      success,
      error_message: errorMessage,
      metadata,
    }),
  })
}

function clampTelegramMessage(text) {
  const value = String(text || '').trim()
  if (value.length <= MAX_TELEGRAM_MESSAGE) return value
  return `${value.slice(0, MAX_TELEGRAM_MESSAGE - 3).trimEnd()}...`
}
