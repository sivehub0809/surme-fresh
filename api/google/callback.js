const { env, supabaseFetch } = require('../_lib/supabase')

module.exports = async function googleCallback(req, res) {
  const { code, state } = req.query || {}
  if (!code || !state) return res.status(400).send('Missing Google OAuth code or state')

  const stateResponse = await supabaseFetch(`/rest/v1/google_oauth_states?state=eq.${encodeURIComponent(state)}&select=*`, { service: true })
  const states = stateResponse.ok ? await stateResponse.json() : []
  const row = states[0]
  if (!row || new Date(row.expires_at).getTime() < Date.now()) return res.status(401).send('Google OAuth state expired')

  const redirectUri = process.env.GOOGLE_REDIRECT_URI || `${process.env.PUBLIC_APP_URL}/api/google/callback`
  const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  })

  if (!tokenResponse.ok) return res.status(500).send(await tokenResponse.text())
  const token = await tokenResponse.json()
  const userInfo = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  }).then((response) => response.json()).catch(() => ({}))

  await supabaseFetch('/rest/v1/google_oauth_tokens', {
    method: 'POST',
    service: true,
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({
      user_id: row.user_id,
      email: userInfo.email || null,
      access_token: token.access_token,
      refresh_token: token.refresh_token || null,
      expiry: token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
      scope: token.scope || null,
    }),
  })

  await supabaseFetch('/rest/v1/user_profiles', {
    method: 'POST',
    service: true,
    headers: { Prefer: 'resolution=merge-duplicates' },
    body: JSON.stringify({ user_id: row.user_id, google_email: userInfo.email || null }),
  })

  await supabaseFetch(`/rest/v1/google_oauth_states?state=eq.${encodeURIComponent(state)}`, {
    method: 'DELETE',
    service: true,
  })

  return res.redirect(302, `${process.env.PUBLIC_APP_URL || '/'}?google=connected`)
}
