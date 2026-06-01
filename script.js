const ADMIN_EMAIL = 'nilaademo@gmail.com'

const demos = {
  schedule: {
    user: 'Move my 2 PM check-in to tomorrow morning and keep the team updated.',
    assistant:
      'I found your check-in, checked your morning availability, and drafted the calendar update. I will ask before notifying attendees.',
    trace: ['Load calendar context', 'Find matching event', 'Check free slots', 'Prepare confirmation'],
  },
  travel: {
    user: 'Find a flight to Tokyo next week and suggest places near my hotel.',
    assistant:
      'I built a Tokyo flight brief, found your travel preferences, and queued place recommendations by distance, vibe, and timing.',
    trace: ['Read travel preferences', 'Search flight options', 'Rank nearby places', 'Create trip draft'],
  },
  email: {
    user: 'Draft a warm follow-up to Alex about the investor notes.',
    assistant:
      'I drafted a concise email in your usual tone. Sending stays locked until you approve the final text.',
    trace: ['Load tone memory', 'Draft message', 'Check recipient context', 'Wait for approval'],
  },
  research: {
    user: 'Research the best AI scheduling tools for founders and summarize the tradeoffs.',
    assistant:
      'I prepared a research plan, grouped sources by category, and will return a cited synthesis with next steps.',
    trace: ['Plan search angles', 'Collect sources', 'Synthesize findings', 'Attach citations'],
  },
}

let supabaseClient = null
let authMode = 'login'
let currentSession = null

const feed = document.querySelector('[data-chat-feed]')
const trace = document.querySelector('[data-action-trace]')
const chips = document.querySelectorAll('[data-demo]')
const toast = document.querySelector('[data-toast]')
const header = document.querySelector('[data-header]')
const authModal = document.querySelector('[data-auth-modal]')
const adminModal = document.querySelector('[data-admin-modal]')
const dashboardModal = document.querySelector('[data-dashboard-modal]')
const authForm = document.querySelector('[data-auth-form]')
const onboardingForm = document.querySelector('[data-onboarding-form]')
const authSubmit = document.querySelector('[data-auth-submit]')
const passwordRow = document.querySelector('[data-password-row]')
const authLabel = document.querySelector('[data-auth-label]')
const authStatus = document.querySelector('[data-auth-status]')
const signOutButton = document.querySelector('[data-sign-out]')
const adminButton = document.querySelector('[data-open-admin]')
const personaDraft = document.querySelector('[data-persona-draft]')
const personaOutput = document.querySelector('[data-persona-output]')

function renderDemo(key) {
  const demo = demos[key]
  feed.innerHTML = `
    <div class="bubble user">${demo.user}</div>
    <div class="bubble assistant">${demo.assistant}</div>
  `
  trace.innerHTML = demo.trace.map((item) => `<div class="trace-item">${item}</div>`).join('')
}

chips.forEach((chip) => {
  chip.addEventListener('click', () => {
    chips.forEach((item) => item.classList.remove('active'))
    chip.classList.add('active')
    renderDemo(chip.dataset.demo)
  })
})

document.querySelectorAll('[data-form]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const formData = new FormData(form)
    const kind = form.dataset.form
    const entry = {
      kind,
      createdAt: new Date().toISOString(),
      values: Object.fromEntries(formData.entries()),
    }

    const existing = JSON.parse(localStorage.getItem('surme-site-submissions') || '[]')
    existing.push(entry)
    localStorage.setItem('surme-site-submissions', JSON.stringify(existing))
    form.reset()
    showToast(kind === 'waitlist' ? 'You are on the SurMe waitlist.' : 'Message saved locally for this prototype.')
  })
})

document.querySelector('[data-open-auth]').addEventListener('click', () => {
  if (currentSession) {
    showToast(`Signed in as ${currentSession.user.email}`)
    return
  }
  openModal(authModal)
})

document.querySelector('[data-close-auth]').addEventListener('click', () => closeModal(authModal))
document.querySelector('[data-close-admin]').addEventListener('click', () => closeModal(adminModal))
adminButton.addEventListener('click', openAdminPanel)
document.querySelector('[data-open-dashboard]').addEventListener('click', openDashboard)
document.querySelector('[data-close-dashboard]').addEventListener('click', () => closeModal(dashboardModal))

document.querySelectorAll('[data-auth-mode]').forEach((button) => {
  button.addEventListener('click', () => setAuthMode(button.dataset.authMode))
})

document.querySelector('[data-google-login]').addEventListener('click', async () => {
  if (!supabaseClient) return showToast('Supabase is not configured yet.')
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
    },
  })
  if (error) showToast(error.message)
})

authForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  if (!supabaseClient) return showToast('Supabase is not configured yet.')

  const formData = new FormData(authForm)
  const email = String(formData.get('email') || '').trim()
  const password = String(formData.get('password') || '')

  if (authMode === 'reset') {
    const { error } = await supabaseClient.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    })
    showToast(error ? error.message : 'Password reset email sent.')
    return
  }

  const action =
    authMode === 'signup'
      ? supabaseClient.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
      : supabaseClient.auth.signInWithPassword({ email, password })

  const { error } = await action
  if (error) {
    showToast(error.message)
    return
  }

  showToast(authMode === 'signup' ? 'Check your email to confirm your account.' : 'Signed in.')
  closeModal(authModal)
})

signOutButton.addEventListener('click', async () => {
  if (!supabaseClient) return
  await supabaseClient.auth.signOut()
  closeModal(authModal)
  showToast('Signed out.')
})

onboardingForm.addEventListener('submit', async (event) => {
  event.preventDefault()
  const token = await getAccessToken()
  if (!token) {
    openModal(authModal)
    return showToast('Please sign in first.')
  }

  const body = Object.fromEntries(new FormData(onboardingForm).entries())
  const response = await fetch('/api/user/onboarding', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })
  const json = await response.json()
  showToast(response.ok ? 'Onboarding saved.' : json.error || 'Could not save onboarding.')
})

document.querySelector('[data-connect-google]').addEventListener('click', async () => {
  const token = await getAccessToken()
  if (!token) {
    openModal(authModal)
    return showToast('Please sign in first.')
  }
  const response = await fetch('/api/google/start', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await response.json()
  if (!response.ok) return showToast(json.error || 'Could not start Google connection.')
  window.location.href = json.url
})

document.querySelector('[data-create-telegram-link]').addEventListener('click', async () => {
  const token = await getAccessToken()
  if (!token) {
    openModal(authModal)
    return showToast('Please sign in first.')
  }
  const response = await fetch('/api/telegram/create-link', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await response.json()
  if (!response.ok) return showToast(json.error || 'Could not create Telegram key.')
  document.querySelector('[data-telegram-result]').hidden = false
  document.querySelector('[data-telegram-token]').textContent = json.token
  const telegramUrl = document.querySelector('[data-telegram-url]')
  telegramUrl.href = json.telegram_url
  showToast('Telegram key created. It expires in 15 minutes.')
})

document.querySelector('[data-structure-persona]').addEventListener('click', async () => {
  const draft = personaDraft.value.trim()
  if (!draft) return showToast('Write an admin instruction first.')
  const token = await getAccessToken()
  if (!token) return showToast('Please sign in as admin first.')

  const response = await fetch('/api/admin/persona', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'structure', draft }),
  })

  const json = await response.json()
  if (!response.ok) return showToast(json.error || 'Could not structure persona.')
  personaOutput.value = json.system_prompt
  showToast('Persona structured.')
})

document.querySelector('[data-save-persona]').addEventListener('click', async () => {
  const systemPrompt = personaOutput.value.trim()
  if (!systemPrompt) return showToast('Create or write a system prompt first.')
  const token = await getAccessToken()
  if (!token) return showToast('Please sign in as admin first.')

  const response = await fetch('/api/admin/persona', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action: 'save', system_prompt: systemPrompt }),
  })

  const json = await response.json()
  if (!response.ok) return showToast(json.error || 'Could not save persona.')
  showToast('AI persona saved.')
})

function setAuthMode(mode) {
  authMode = mode
  document.querySelectorAll('[data-auth-mode]').forEach((button) => {
    button.classList.toggle('active', button.dataset.authMode === mode)
  })
  passwordRow.hidden = mode === 'reset'
  passwordRow.querySelector('input').required = mode !== 'reset'
  authSubmit.textContent = mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset email' : 'Log in'
  document.querySelector('#auth-title').textContent =
    mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Reset password' : 'Sign in'
}

async function openAdminPanel() {
  if (!isAdmin()) return showToast('Admin access is only enabled for nilaademo@gmail.com.')
  openModal(adminModal)
  const token = await getAccessToken()
  const response = await fetch('/api/admin/persona', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await response.json()
  personaOutput.value = json.system_prompt || ''
}

async function openDashboard() {
  if (!currentSession) {
    openModal(authModal)
    return showToast('Please sign in to open your dashboard.')
  }
  openModal(dashboardModal)
  const token = await getAccessToken()
  const response = await fetch('/api/user/onboarding', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await response.json().catch(() => ({}))
  if (json.profile) fillOnboarding(json.profile)
}

function fillOnboarding(profile) {
  for (const element of onboardingForm.elements) {
    if (!element.name || profile[element.name] == null) continue
    element.value = Array.isArray(profile[element.name]) ? profile[element.name].join(', ') : profile[element.name]
  }
}

async function initSupabase() {
  try {
    const response = await fetch('/api/config')
    const config = await response.json()
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) {
      if (authStatus) {
        authStatus.hidden = false
        authStatus.textContent =
          'Sign-in is not connected yet. Add the Supabase URL and anon key in Vercel, then redeploy so login can talk to the database.'
      }
      updateAuthState(null)
      return
    }

    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })

    const { data } = await supabaseClient.auth.getSession()
    updateAuthState(data.session)

    supabaseClient.auth.onAuthStateChange((_event, session) => {
      currentSession = session
      updateAuthState(session)
    })
  } catch (error) {
    console.warn(error)
    if (authStatus) {
      authStatus.hidden = false
      authStatus.textContent =
        'Sign-in is not connected yet. Check the Supabase env vars and redeploy before testing login.'
    }
    updateAuthState(null)
  }
}

function updateAuthState(session) {
  currentSession = session
  const email = session && session.user && session.user.email
  authLabel.textContent = email ? email.split('@')[0] : 'Sign in'
  signOutButton.hidden = !email
  adminButton.classList.toggle('admin-visible', email === ADMIN_EMAIL)
  adminButton.classList.toggle('admin-hidden', email !== ADMIN_EMAIL)
  if (authStatus) authStatus.hidden = Boolean(email)
}

function isAdmin() {
  return currentSession && currentSession.user && currentSession.user.email === ADMIN_EMAIL
}

async function getAccessToken() {
  if (!supabaseClient) return null
  const { data } = await supabaseClient.auth.getSession()
  return data.session && data.session.access_token
}

function openModal(modal) {
  modal.hidden = false
}

function closeModal(modal) {
  modal.hidden = true
}

function showToast(message) {
  toast.textContent = message
  toast.classList.add('visible')
  window.clearTimeout(showToast.timeout)
  showToast.timeout = window.setTimeout(() => toast.classList.remove('visible'), 3200)
}

window.addEventListener('scroll', () => {
  header.style.boxShadow = window.scrollY > 16 ? '0 12px 30px rgba(24, 32, 31, 0.08)' : 'none'
})

renderDemo('schedule')
setAuthMode('login')
initSupabase()
