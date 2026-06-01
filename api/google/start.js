const crypto = require('node:crypto')
const { env, requireUser, supabaseFetch } = require('../_lib/supabase')

module.exports = async function googleStart(req, res) {
  const auth = await requireUser(req, res)
  if (!auth) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const state = crypto.randomBytes(24).toString('base64url')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()
  await supabaseFetch('/rest/v1/google_oauth_states', {
    method: 'POST',
    service: true,
    body: JSON.stringify({ state, user_id: auth.user.id, expires_at: expiresAt }),
  })

  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.PUBLIC_APP_URL}/api/google/callback`
  const params = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: [
      'openid',
      'email',
      'profile',
      'https://www.googleapis.com/auth/calendar.events',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  })

  return res.status(200).json({ ok: true, url: `https://accounts.google.com/o/oauth2/v2/auth?${params}` })
}
