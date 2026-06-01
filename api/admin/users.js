const { requireAdmin, supabaseFetch } = require('../_lib/supabase')

module.exports = async function users(req, res) {
  const auth = await requireAdmin(req, res)
  if (!auth) return

  if (req.method === 'GET') {
    const payload = await loadUsers()
    return res.status(200).json({ ok: true, ...payload })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const body = req.body || {}
  const userId = String(body.user_id || '').trim()
  const action = String(body.action || '').trim()
  if (!userId || !action) return res.status(400).json({ ok: false, error: 'user_id and action are required' })

  try {
    if (action === 'disconnect_telegram') await disconnectTelegram(userId)
    else if (action === 'disconnect_google') await disconnectGoogle(userId)
    else if (action === 'delete_account') await deleteAccount(userId)
    else return res.status(400).json({ ok: false, error: 'Unknown action' })
  } catch (error) {
    console.error(error)
    return res.status(500).json({ ok: false, error: error.message || 'User action failed' })
  }

  return res.status(200).json({ ok: true, users: await loadUsers() })
}

async function loadUsers() {
  const [profiles, chats, tokens, messages, oauth] = await Promise.all([
    fetchRows('/rest/v1/user_profiles?select=*', true),
    fetchRows('/rest/v1/telegram_chats?select=*', true),
    fetchRows('/rest/v1/google_oauth_tokens?select=user_id,email,updated_at', true),
    fetchRows('/rest/v1/messages?select=user_id,telegram_chat_id,created_at', true),
    fetchRows('/rest/v1/oauth_events?select=*', true),
  ])

  const chatMap = new Map(chats.map((row) => [String(row.user_id || ''), row]))
  const tokenMap = new Map(tokens.map((row) => [String(row.user_id || ''), row]))
  const counts = new Map()
  const lastSeen = new Map()

  for (const row of messages) {
    const key = String(row.user_id || '')
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
    const ts = row.created_at ? new Date(row.created_at).getTime() : 0
    if (!lastSeen.get(key) || ts > lastSeen.get(key)) lastSeen.set(key, ts)
  }

  const list = profiles.map((profile) => {
    const key = String(profile.user_id || '')
    const chat = chatMap.get(key)
    const token = tokenMap.get(key)
    return {
      user_id: profile.user_id,
      email: profile.email || token?.email || '',
      display_name: profile.display_name || profile.full_name || profile.email || 'Unknown',
      telegram_chat_id: profile.telegram_chat_id || chat?.telegram_chat_id || null,
      telegram_user_id: chat?.telegram_user_id || null,
      google_email: profile.google_email || token?.email || null,
      telegram_connected: Boolean(chat || profile.telegram_chat_id),
      google_connected: Boolean(token),
      message_count: counts.get(key) || 0,
      last_seen_at: lastSeen.get(key) ? new Date(lastSeen.get(key)).toISOString() : null,
      latest_oauth_error: oauth.find((row) => String(row.user_id || '') === key && row.success === false)?.error_message || null,
    }
  })

  return {
    users: list.sort((a, b) => b.message_count - a.message_count),
  }
}

async function disconnectTelegram(userId) {
  await supabaseFetch(`/rest/v1/user_profiles?user_id=eq.${userId}`, {
    method: 'PATCH',
    service: true,
    body: JSON.stringify({ telegram_chat_id: null }),
  })
  await supabaseFetch(`/rest/v1/telegram_chats?user_id=eq.${userId}`, {
    method: 'PATCH',
    service: true,
    body: JSON.stringify({ user_id: null }),
  })
  await supabaseFetch(`/rest/v1/telegram_link_codes?user_id=eq.${userId}`, {
    method: 'DELETE',
    service: true,
  })
}

async function disconnectGoogle(userId) {
  await supabaseFetch(`/rest/v1/google_oauth_tokens?user_id=eq.${userId}`, {
    method: 'DELETE',
    service: true,
  })
}

async function deleteAccount(userId) {
  const response = await fetch(`${process.env.SUPABASE_URL}/auth/v1/admin/users/${userId}`, {
    method: 'DELETE',
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    },
  })
  if (!response.ok) throw new Error(`Auth user delete failed: ${response.status} ${await response.text()}`)
}

async function fetchRows(path, service = false) {
  const response = await supabaseFetch(path, { service })
  return response.ok ? await response.json() : []
}
