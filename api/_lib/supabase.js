const ADMIN_EMAIL = 'nilaademo@gmail.com'

function env(name) {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is required`)
  return value
}

async function supabaseFetch(path, options = {}) {
  const key = options.service ? env('SUPABASE_SERVICE_ROLE_KEY') : env('SUPABASE_ANON_KEY')
  const response = await fetch(`${env('SUPABASE_URL')}${path}`, {
    ...options,
    headers: {
      apikey: key,
      Authorization: `Bearer ${options.jwt || key}`,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  })
  return response
}

async function getUserFromRequest(req) {
  const token = req.headers.authorization && req.headers.authorization.replace(/^Bearer\s+/i, '')
  if (!token) return null

  const response = await supabaseFetch('/auth/v1/user', { jwt: token })
  if (!response.ok) return null
  const user = await response.json()
  return { user, token }
}

async function requireUser(req, res) {
  const auth = await getUserFromRequest(req)
  if (!auth) {
    res.status(401).json({ ok: false, error: 'Authentication required' })
    return null
  }
  return auth
}

async function requireAdmin(req, res) {
  const auth = await requireUser(req, res)
  if (!auth) return null
  if (String(auth.user.email || '').toLowerCase() !== ADMIN_EMAIL) {
    res.status(403).json({ ok: false, error: 'Admin access denied' })
    return null
  }
  return auth
}

module.exports = {
  ADMIN_EMAIL,
  env,
  supabaseFetch,
  getUserFromRequest,
  requireUser,
  requireAdmin,
}
