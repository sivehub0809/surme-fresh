const { env, supabaseFetch } = require('../_lib/supabase')

module.exports = async function googleCallback(req, res) {
  const { code, state } = req.query || {}
  if (!code || !state) return renderPage(res, {
    title: 'Google Calendar connection failed',
    message: 'Missing Google OAuth code or state. Please return to SurMe and try connecting Google Calendar again.',
    accent: 'error',
  })

  const stateResponse = await supabaseFetch(`/rest/v1/google_oauth_states?state=eq.${encodeURIComponent(state)}&select=*`, { service: true })
  const states = stateResponse.ok ? await stateResponse.json() : []
  const row = states[0]
  if (!row || new Date(row.expires_at).getTime() < Date.now()) {
    return renderPage(res, {
      title: 'Google Calendar connection expired',
      message: 'Your Google authorization window expired. Go back to SurMe, start Google Calendar connect again, and approve it once more.',
      accent: 'error',
    })
  }

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

  if (!tokenResponse.ok) {
    return renderPage(res, {
      title: 'Google Calendar connection failed',
      message: 'Google did not return a usable token. Please go back to SurMe and try connecting Calendar again.',
      detail: await tokenResponse.text(),
      accent: 'error',
    })
  }
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

  const returnUrl = process.env.PUBLIC_APP_URL || '/'
  return renderPage(res, {
    title: 'Google Calendar connected',
    message: 'Success, you are connected now. You can close this tab and return to SurMe.',
    detail: `Your account is linked and SurMe can now use Google Calendar from ${userInfo.email || 'your Google account'}.`,
    actionLabel: 'Back to SurMe',
    actionUrl: returnUrl,
    accent: 'success',
  })
}

function renderPage(res, { title, message, detail, actionLabel, actionUrl, accent }) {
  const isSuccess = accent === 'success'
  const bg = isSuccess ? '#dff4ff' : '#fff1f0'
  const border = isSuccess ? '#8cc7e8' : '#f0a6a0'
  const button = isSuccess ? '#2f7bd8' : '#b24a43'
  const text = isSuccess ? '#163a5a' : '#6b2d2a'
  res.status(isSuccess ? 200 : 400).setHeader('Content-Type', 'text/html; charset=utf-8')
  res.send(`<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(title)}</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: linear-gradient(180deg, #e7f4ff 0%, #f7fbff 100%);
        color: ${text};
      }
      .card {
        width: min(560px, calc(100vw - 32px));
        padding: 28px;
        border: 1px solid ${border};
        border-radius: 20px;
        background: rgba(255,255,255,0.86);
        box-shadow: 0 24px 80px rgba(24, 32, 31, 0.12);
      }
      .eyebrow {
        margin: 0 0 12px;
        font-size: 12px;
        font-weight: 800;
        letter-spacing: .14em;
        text-transform: uppercase;
      }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(32px, 5vw, 48px);
        line-height: 1;
      }
      p {
        margin: 0 0 14px;
        line-height: 1.5;
      }
      .detail {
        padding: 14px 16px;
        border-radius: 14px;
        background: ${bg};
      }
      .actions {
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
        margin-top: 20px;
      }
      a, button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        min-height: 44px;
        padding: 0 16px;
        border-radius: 12px;
        border: 0;
        text-decoration: none;
        cursor: pointer;
        font: inherit;
        font-weight: 700;
      }
      .primary {
        background: ${button};
        color: #fff;
      }
      .secondary {
        background: transparent;
        color: ${text};
        border: 1px solid ${border};
      }
    </style>
  </head>
  <body>
    <main class="card">
      <p class="eyebrow">SurMe</p>
      <h1>${escapeHtml(title)}</h1>
      <p>${escapeHtml(message)}</p>
      ${detail ? `<p class="detail">${escapeHtml(detail)}</p>` : ''}
      <div class="actions">
        ${actionUrl ? `<a class="primary" href="${escapeAttr(actionUrl)}">${escapeHtml(actionLabel || 'Continue')}</a>` : ''}
        <button class="secondary" type="button" onclick="window.close()">Close tab</button>
      </div>
    </main>
    <script>
      setTimeout(() => {
        try { window.close() } catch (e) {}
      }, 1200)
    </script>
  </body>
</html>`)
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;')
}
