const crypto = require('node:crypto')
const { requireAdmin, supabaseFetch } = require('../_lib/supabase')

const DEFAULT_PERSONA =
  'You are SurMe, a personal AI assistant powered by Nilaamio. You remember the user, execute useful actions, and confirm before irreversible or sensitive actions.'

module.exports = async function dashboard(req, res) {
  const auth = await requireAdmin(req, res)
  if (!auth) return

  if (req.method === 'GET') {
    const payload = await loadDashboard()
    return res.status(200).json({ ok: true, ...payload })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const body = req.body || {}
  const action = String(body.action || '').trim()

  try {
    switch (action) {
      case 'save_behavior':
        await saveBehavior(body)
        break
      case 'save_onboarding':
        await saveOnboarding(body)
        break
      case 'save_commands':
        await saveCommands(body)
        break
      case 'save_knowledge':
        await saveKnowledge(body)
        break
      case 'save_brand':
        await saveBrand(body)
        break
      case 'save_sections':
        await saveSections(body)
        break
      case 'save_schedule':
        await saveSchedule(body)
        break
      case 'test_behavior':
        return res.status(200).json({ ok: true, reply: await previewBehavior(String(body.message || '').trim(), body) })
      default:
        return res.status(400).json({ ok: false, error: 'Unknown action' })
    }
  } catch (error) {
    console.error(error)
    return res.status(500).json({ ok: false, error: error.message || 'Admin save failed' })
  }

  return res.status(200).json({ ok: true, dashboard: await loadDashboard() })
}

async function loadDashboard() {
  const [settingsRows, profilesRows, chatsRows, messagesRows, conversationsRows, oauthRows, tokensRows, scheduleRows] = await Promise.all([
    fetchRows('/rest/v1/surme_settings?id=eq.1&select=*', true),
    fetchRows('/rest/v1/user_profiles?select=*', true),
    fetchRows('/rest/v1/telegram_chats?select=*', true),
    fetchRows('/rest/v1/messages?select=role,user_id,telegram_chat_id,created_at', true),
    fetchRows('/rest/v1/conversations?select=source,user_id,telegram_chat_id,created_at,title', true),
    fetchRows('/rest/v1/oauth_events?select=*', true),
    fetchRows('/rest/v1/google_oauth_tokens?select=user_id,email,updated_at', true),
    fetchRows('/rest/v1/telegram_scheduled_greetings?id=eq.1&select=*', true),
  ])

  const settings = settingsRows[0] || emptySettings()
  const schedule = scheduleRows[0] || {}
  const profiles = profilesRows || []
  const chats = chatsRows || []
  const messages = messagesRows || []
  const conversations = conversationsRows || []
  const oauth = oauthRows || []
  const tokens = tokensRows || []

  const telegramMap = new Map(chats.map((row) => [String(row.user_id || ''), row]))
  const googleMap = new Map(tokens.map((row) => [String(row.user_id || ''), row]))
  const messageCounts = new Map()
  const lastMessageAt = new Map()

  for (const row of messages) {
    const key = String(row.user_id || '')
    if (!key) continue
    messageCounts.set(key, (messageCounts.get(key) || 0) + 1)
    const current = lastMessageAt.get(key)
    const rowDate = row.created_at ? new Date(row.created_at).getTime() : 0
    if (!current || rowDate > current) lastMessageAt.set(key, rowDate)
  }

  const userRows = profiles.map((profile) => {
    const key = String(profile.user_id || '')
    const telegram = telegramMap.get(key)
    const google = googleMap.get(key)
    return {
      user_id: profile.user_id,
      email: profile.email || google?.email || '',
      display_name: profile.display_name || profile.full_name || profile.email || 'Unknown',
      primary_role: profile.primary_role || '',
      timezone: profile.timezone || 'Asia/Tokyo',
      telegram_chat_id: profile.telegram_chat_id || telegram?.telegram_chat_id || null,
      google_email: profile.google_email || google?.email || null,
      telegram_connected: Boolean(telegram || profile.telegram_chat_id),
      google_connected: Boolean(google),
      message_count: messageCounts.get(key) || 0,
      last_message_at: lastMessageAt.get(key) ? new Date(lastMessageAt.get(key)).toISOString() : null,
    }
  })

  const totalUsers = profiles.length
  const totalMessages = messages.length
  const totalConversations = conversations.length
  const activeUsers = new Set(
    messages
      .filter((row) => row.created_at && Date.now() - new Date(row.created_at).getTime() < 24 * 60 * 60 * 1000)
      .map((row) => row.user_id || row.telegram_chat_id)
      .filter(Boolean)
  ).size
  const oauthFailures = oauth.filter((row) => !row.success).length
  const webMessages = conversations.filter((row) => row.source === 'web').length
  const telegramMessages = conversations.filter((row) => row.source === 'telegram').length

  return {
    settings,
    schedule,
    health: {
      totalUsers,
      totalMessages,
      totalConversations,
      activeUsers,
      oauthFailures,
      webMessages,
      telegramMessages,
    },
    users: userRows.sort((a, b) => b.message_count - a.message_count),
    oauthEvents: oauth.slice(0, 24),
    recentFailures: oauth.filter((row) => !row.success).slice(0, 10),
  }
}

async function saveBehavior(body) {
  const settings = await readSettings()
  const behavior = {
    persona: String(body.persona || '').trim(),
    followup_style: String(body.followup_style || '').trim(),
    safety_rules: String(body.safety_rules || '').trim(),
    output_length: String(body.output_length || 'short').trim(),
  }
  const prompt = composeSystemPrompt(behavior)
  await writeSettings({
    ...settings,
    system_prompt: prompt || DEFAULT_PERSONA,
    behavior_prompt: JSON.stringify(behavior, null, 2),
    site_text: mergeJson(settings.site_text, { behavior }),
  })
}

async function saveOnboarding(body) {
  const settings = await readSettings()
  const onboarding = {
    welcome_message: String(body.welcome_message || '').trim(),
    ask_name: String(body.ask_name || '').trim(),
    ask_age: String(body.ask_age || '').trim(),
    ask_goals: String(body.ask_goals || '').trim(),
    ask_calendar: String(body.ask_calendar || '').trim(),
    ask_source: String(body.ask_source || '').trim(),
    wrap_up_message: String(body.wrap_up_message || '').trim(),
    goal_options: splitLines(body.goal_options),
    source_options: splitLines(body.source_options),
  }
  await writeSettings({
    ...settings,
    onboarding_questions: onboarding,
    site_text: mergeJson(settings.site_text, { onboarding }),
  })
}

async function saveCommands(body) {
  const settings = await readSettings()
  const commands = Array.isArray(body.commands) ? body.commands : []
  await writeSettings({
    ...settings,
    telegram_commands: commands,
  })
}

async function saveKnowledge(body) {
  const settings = await readSettings()
  const knowledge = Array.isArray(body.knowledge) ? body.knowledge : []
  await writeSettings({
    ...settings,
    knowledge,
  })
}

async function saveBrand(body) {
  const settings = await readSettings()
  const brand = {
    business_name: String(body.business_name || '').trim(),
    hero_headline: String(body.hero_headline || '').trim(),
    hero_subtitle: String(body.hero_subtitle || '').trim(),
    tagline: String(body.tagline || '').trim(),
    logo_url: String(body.logo_url || '').trim(),
    phone_logo_url: String(body.phone_logo_url || '').trim(),
    bg_image_url: String(body.bg_image_url || '').trim(),
  }
  await writeSettings({
    ...settings,
    site_text: mergeJson(settings.site_text, { brand }),
  })
}

async function saveSections(body) {
  const settings = await readSettings()
  const sections = Array.isArray(body.sections) ? body.sections : []
  await writeSettings({
    ...settings,
    site_text: mergeJson(settings.site_text, { sections }),
  })
}

async function saveSchedule(body) {
  const schedule = {
    enabled: Boolean(body.enabled),
    timezone: String(body.timezone || 'Asia/Tokyo').trim(),
    morning_time: String(body.morning_time || '06:00').trim(),
    morning_text: String(body.morning_text || '').trim(),
    afternoon_time: String(body.afternoon_time || '12:00').trim(),
    afternoon_text: String(body.afternoon_text || '').trim(),
    evening_time: String(body.evening_time || '17:00').trim(),
    evening_text: String(body.evening_text || '').trim(),
    night_time: String(body.night_time || '21:30').trim(),
    night_text: String(body.night_text || '').trim(),
  }
  await supabaseFetch('/rest/v1/telegram_scheduled_greetings?id=eq.1', {
    method: 'PATCH',
    service: true,
    body: JSON.stringify(schedule),
  })
}

async function previewBehavior(message, body) {
  const behavior = {
    persona: String(body.persona || '').trim(),
    followup_style: String(body.followup_style || '').trim(),
    safety_rules: String(body.safety_rules || '').trim(),
    output_length: String(body.output_length || 'short').trim(),
  }
  const prompt = composeSystemPrompt(behavior)
  if (!message) return prompt
  if (!process.env.GOOGLE_GEMINI_API_KEY) {
    return `Gemini is not configured yet.\n\n${prompt}\n\nUser message: ${message}`
  }

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(process.env.AI_MODEL || 'gemini-2.5-flash')}:generateContent?key=${encodeURIComponent(process.env.GOOGLE_GEMINI_API_KEY)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      system_instruction: {
        parts: [{ text: prompt }],
      },
      contents: [{ parts: [{ text: message }] }],
    }),
  })

  if (!response.ok) throw new Error(`Gemini preview failed: ${response.status} ${await response.text()}`)
  const json = await response.json()
  return json.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || 'Done.'
}

async function readSettings() {
  const response = await supabaseFetch('/rest/v1/surme_settings?id=eq.1&select=*', { service: true })
  const rows = response.ok ? await response.json() : []
  return rows[0] || emptySettings()
}

async function writeSettings(row) {
  const response = await supabaseFetch('/rest/v1/surme_settings', {
    method: 'POST',
    service: true,
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      id: 1,
      ...row,
      updated_at: new Date().toISOString(),
    }),
  })
  if (!response.ok) throw new Error(`Saving admin settings failed: ${response.status} ${await response.text()}`)
}

async function fetchRows(path, service = false) {
  const response = await supabaseFetch(path, { service })
  return response.ok ? await response.json() : []
}

function emptySettings() {
  return {
    id: 1,
    system_prompt: DEFAULT_PERSONA,
    behavior_prompt: '',
    onboarding_questions: {},
    telegram_commands: [],
    knowledge: [],
    site_text: {},
  }
}

function mergeJson(base, patch) {
  return {
    ...(base && typeof base === 'object' ? base : {}),
    ...(patch && typeof patch === 'object' ? patch : {}),
  }
}

function composeSystemPrompt(behavior) {
  const pieces = [behavior.persona || DEFAULT_PERSONA]
  if (behavior.followup_style) pieces.push(`Follow-up style:\n${behavior.followup_style}`)
  if (behavior.safety_rules) pieces.push(`Safety rules:\n${behavior.safety_rules}`)
  if (behavior.output_length) pieces.push(`Output length preference: ${behavior.output_length}`)
  pieces.push('You are SurMe, a personal AI assistant powered by Nilaamio. Keep the experience calm, useful, and action-oriented.')
  return pieces.join('\n\n')
}

function splitLines(value) {
  const text = String(value || '')
  return text
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}
