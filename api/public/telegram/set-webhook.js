module.exports = async function setWebhook(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const token = req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, '')
  if (!process.env.SETUP_SECRET || token !== process.env.SETUP_SECRET) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' })
  }

  if (!process.env.TELEGRAM_BOT_TOKEN) {
    return res.status(500).json({ ok: false, error: 'TELEGRAM_BOT_TOKEN is not configured' })
  }

  const origin = process.env.PUBLIC_APP_URL || `https://${req.headers.host}`
  const webhookUrl = `${origin.replace(/\/$/, '')}/api/public/telegram/webhook`

  const response = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/setWebhook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: webhookUrl,
      secret_token: process.env.TELEGRAM_WEBHOOK_SECRET,
      allowed_updates: ['message'],
    }),
  })

  const json = await response.json()
  if (!response.ok || !json.ok) {
    return res.status(500).json({ ok: false, webhookUrl, telegram: json })
  }

  return res.status(200).json({ ok: true, webhookUrl, telegram: json })
}
