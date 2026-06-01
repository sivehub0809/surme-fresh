const crypto = require('node:crypto')
const { requireUser, supabaseFetch } = require('../_lib/supabase')

module.exports = async function createTelegramLink(req, res) {
  const auth = await requireUser(req, res)
  if (!auth) return
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const token = crypto.randomBytes(18).toString('base64url')
  const tokenHash = crypto.createHash('sha256').update(token).digest('hex')
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString()

  const response = await supabaseFetch('/rest/v1/telegram_link_codes', {
    method: 'POST',
    service: true,
    headers: { Prefer: 'return=representation' },
    body: JSON.stringify({
      user_id: auth.user.id,
      token_hash: tokenHash,
      expires_at: expiresAt,
    }),
  })

  if (!response.ok) return res.status(500).json({ ok: false, error: await response.text() })
  return res.status(200).json({
    ok: true,
    token,
    expires_at: expiresAt,
    telegram_url: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME || 'surme1_bot'}?start=${token}`,
  })
}
