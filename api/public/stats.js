const { supabaseFetch } = require('../_lib/supabase')

module.exports = async function stats(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  try {
    const [messagesRows, profilesRows, conversationsRows, runtimeRows] = await Promise.all([
      fetchRows('/rest/v1/messages?select=id,user_id,created_at', true),
      fetchRows('/rest/v1/user_profiles?select=user_id', true),
      fetchRows('/rest/v1/conversations?select=id,source,user_id,telegram_chat_id,created_at', true),
      fetchRows('/rest/v1/runtime_events?select=success,event_type,created_at', true),
    ])

    const totalMessages = messagesRows.length
    const totalUsers = profilesRows.length
    const activeUsers = new Set(
      messagesRows
        .filter((row) => row.created_at && Date.now() - new Date(row.created_at).getTime() < 24 * 60 * 60 * 1000)
        .map((row) => row.user_id)
        .filter(Boolean)
    ).size

    const failedWebhooks = runtimeRows.filter((row) => !row.success && row.event_type === 'telegram_webhook_failed').length
    const failedAiReplies = runtimeRows.filter((row) => !row.success && row.event_type === 'telegram_ai_failed').length
    const totalConversations = conversationsRows.length
    const telegramConversations = conversationsRows.filter((row) => row.source === 'telegram').length

    return res.status(200).json({
      ok: true,
      totalMessages,
      totalUsers,
      activeUsers,
      totalConversations,
      telegramConversations,
      failedWebhooks,
      failedAiReplies,
    })
  } catch (error) {
    console.error('Stats endpoint failed:', error)
    return res.status(500).json({ ok: false, error: error.message || 'Stats failed' })
  }
}

async function fetchRows(path, service = false) {
  const response = await supabaseFetch(path, { service })
  return response.ok ? await response.json() : []
}
