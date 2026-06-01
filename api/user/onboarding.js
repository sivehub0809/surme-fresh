const { requireUser, supabaseFetch } = require('../_lib/supabase')

module.exports = async function onboarding(req, res) {
  const auth = await requireUser(req, res)
  if (!auth) return

  if (req.method === 'GET') {
    const response = await supabaseFetch(`/rest/v1/user_profiles?user_id=eq.${auth.user.id}&select=*`, { service: true })
    const rows = response.ok ? await response.json() : []
    return res.status(200).json({ ok: true, profile: rows[0] || null })
  }

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST')
    return res.status(405).json({ ok: false, error: 'Method not allowed' })
  }

  const body = req.body || {}
  const profile = {
    user_id: auth.user.id,
    email: auth.user.email,
    display_name: body.display_name || auth.user.user_metadata?.name || auth.user.email,
    full_name: body.full_name || auth.user.user_metadata?.full_name || null,
    primary_role: body.primary_role || null,
    timezone: body.timezone || 'Asia/Tokyo',
    work_hours: body.work_hours || null,
    tone_preference: body.tone_preference || null,
    travel_preferences: body.travel_preferences || null,
    goals: Array.isArray(body.goals) ? body.goals : String(body.goals || '').split(',').map((item) => item.trim()).filter(Boolean),
    contacts: body.contacts || [],
    calendar_habits: body.calendar_habits || null,
    personality_notes: body.personality_notes || null,
    onboarding_done: true,
    onboarding_answers: body,
  }

  const response = await supabaseFetch('/rest/v1/user_profiles', {
    method: 'POST',
    service: true,
    headers: { Prefer: 'resolution=merge-duplicates,return=representation' },
    body: JSON.stringify(profile),
  })

  if (!response.ok) return res.status(500).json({ ok: false, error: await response.text() })
  const rows = await response.json()
  return res.status(200).json({ ok: true, profile: rows[0] })
}
