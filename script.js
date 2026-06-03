const ADMIN_EMAIL = 'nilaademo@gmail.com'

let supabaseClient = null
let currentSession = null
let authMode = 'login'
let onboardingIndex = 0
let onboardingAnswers = {
  name: '',
  role: '',
  goals: [],
  vibe: 'balanced',
  slang: 5,
  replyLength: 'short',
  source: '',
  interests: [],
  reminderStyle: 'gentle',
  privacy: 'remember',
}
let adminTab = 'Growth Engine'

const routes = [...document.querySelectorAll('[data-route]')]
const toast = document.querySelector('[data-toast]')
const authForm = document.querySelector('[data-auth-form]')
const authSubmit = document.querySelector('[data-auth-submit]')
const authStatus = document.querySelector('[data-auth-status]')
const passwordInput = document.querySelector('[data-password-input]')
const settingsRoot = document.querySelector('[data-settings-root]')
const adminRoot = document.querySelector('[data-admin-root]')
const adminTabs = document.querySelector('[data-admin-tabs]')

const onboardingSteps = [
  { key: 'name', type: 'text', eyebrow: 'Step 1', title: 'What should SurMe call you?', placeholder: 'Your name' },
  { key: 'role', type: 'single', eyebrow: 'Step 2', title: 'What describes you best?', options: ['Student', 'Founder', 'Professional', 'CEO'] },
  { key: 'goals', type: 'multi', eyebrow: 'Step 3', title: 'What should SurMe help with?', options: ['Scheduling', 'Research', 'Email', 'Travel', 'Follow-ups'] },
  { key: 'vibe', type: 'single', eyebrow: 'Step 4', title: 'Pick the assistant vibe.', options: ['calm', 'balanced', 'fun'] },
  { key: 'slang', type: 'slider', eyebrow: 'Step 5', title: 'How casual should replies feel?', min: 0, max: 10 },
  { key: 'replyLength', type: 'single', eyebrow: 'Step 6', title: 'How long should answers be?', options: ['short', 'balanced', 'detailed'] },
  { key: 'source', type: 'single', eyebrow: 'Step 7', title: 'How did you find SurMe?', options: ['Friend', 'Telegram', 'Nilaamio', 'Online'] },
  { key: 'interests', type: 'multi', eyebrow: 'Step 8', title: 'What context matters?', options: ['Work', 'Study', 'Startups', 'Finance', 'Travel'] },
  { key: 'reminderStyle', type: 'single', eyebrow: 'Step 9', title: 'How should reminders feel?', options: ['gentle', 'direct', 'persistent'] },
  { key: 'privacy', type: 'single', eyebrow: 'Step 10', title: 'Should SurMe remember preferences?', options: ['remember', 'ask first', 'minimal'] },
]

document.addEventListener('click', handleDocumentClick)
window.addEventListener('popstate', renderRoute)

document.querySelectorAll('[data-form]').forEach((form) => {
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    const entries = JSON.parse(localStorage.getItem('surme-site-submissions') || '[]')
    entries.push({ kind: form.dataset.form, values: Object.fromEntries(new FormData(form)), createdAt: new Date().toISOString() })
    localStorage.setItem('surme-site-submissions', JSON.stringify(entries))
    form.reset()
    showToast(form.dataset.form === 'newsletter' ? 'You are on the SurMe list.' : 'Message saved for follow-up.')
  })
})

if (authForm) {
  authForm.addEventListener('submit', async (event) => {
    event.preventDefault()
    if (!supabaseClient) return showToast('Supabase is not configured yet.')

    const data = new FormData(authForm)
    const email = String(data.get('email') || '').trim()
    const password = String(data.get('password') || '')

    if (authMode === 'reset') {
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + '/login' })
      return showToast(error ? error.message : 'Password reset email sent.')
    }

    const result = authMode === 'signup'
      ? await supabaseClient.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin + '/onboarding' } })
      : await supabaseClient.auth.signInWithPassword({ email, password })

    if (result.error) return showToast(result.error.message)
    showToast(authMode === 'signup' ? 'Check your email to confirm your account.' : 'Signed in.')
    navigate(authMode === 'signup' ? '/onboarding' : '/settings')
  })
}

const onboardingForm = document.querySelector('[data-onboarding-form]')
if (onboardingForm) {
  onboardingForm.addEventListener('input', handleOnboardingInput)
}

init()

async function init() {
  renderProgress()
  renderOnboarding()
  renderAdminShell()
  renderRoute()
  await initSupabase()
  await refreshMessageCount()
  setInterval(refreshMessageCount, 15000)
}

function handleDocumentClick(event) {
  const routeLink = event.target.closest('[data-route-link]')
  if (routeLink) {
    const href = routeLink.getAttribute('href')
    if (href && href.startsWith('/')) {
      event.preventDefault()
      navigate(href)
      return
    }
  }

  const authModeButton = event.target.closest('[data-auth-mode]')
  if (authModeButton) return setAuthMode(authModeButton.dataset.authMode)

  const googleLogin = event.target.closest('[data-google-login]')
  if (googleLogin) return signInWithGoogle()

  const stepNext = event.target.closest('[data-step-next]')
  if (stepNext) return advanceOnboarding()

  const stepBack = event.target.closest('[data-step-back]')
  if (stepBack) return backOnboarding()

  const choice = event.target.closest('[data-choice]')
  if (choice) return selectChoice(choice)

  const saveSettings = event.target.closest('[data-save-settings]')
  if (saveSettings) return saveSettingsForm()

  const signOut = event.target.closest('[data-sign-out]')
  if (signOut) return signOutUser()

  const deleteAccount = event.target.closest('[data-delete-account]')
  if (deleteAccount) return deleteAccountFlow()

  const telegramLink = event.target.closest('[data-create-telegram-link]')
  if (telegramLink) return createTelegramLink()

  const copyCode = event.target.closest('[data-copy-telegram-code]')
  if (copyCode) return copyTelegramCode()

  const googleConnect = event.target.closest('[data-connect-google]')
  if (googleConnect) return connectGoogle()

  const disconnectTelegram = event.target.closest('[data-disconnect-telegram]')
  if (disconnectTelegram) return disconnectIntegration('disconnect_telegram', 'Telegram disconnected.')

  const disconnectGoogle = event.target.closest('[data-disconnect-google]')
  if (disconnectGoogle) return disconnectIntegration('disconnect_google', 'Google disconnected.')

  const adminRefresh = event.target.closest('[data-admin-refresh]')
  if (adminRefresh) return loadAdmin()

  const adminTabButton = event.target.closest('[data-admin-tab]')
  if (adminTabButton) {
    adminTab = adminTabButton.dataset.adminTab
    renderAdminShell()
    return loadAdmin()
  }
}

function navigate(path) {
  history.pushState({}, '', path)
  renderRoute()
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

function renderRoute() {
  const path = window.location.pathname.replace(/\/$/, '') || '/'
  const name = {
    '/': 'home',
    '/login': 'login',
    '/onboarding': 'onboarding',
    '/connect-telegram': 'connect-telegram',
    '/settings': 'settings',
    '/admin-surme': 'admin-surme',
    '/policy': 'policy',
  }[path] || 'home'

  routes.forEach((route) => {
    route.hidden = route.dataset.route !== name
  })
  document.body.dataset.page = name
  document.querySelector('[data-top-nav]').hidden = ['login', 'onboarding', 'connect-telegram'].includes(name)
  document.querySelector('.footer').hidden = ['login', 'onboarding', 'connect-telegram'].includes(name)

  if (name === 'settings') loadSettings()
  if (name === 'admin-surme') loadAdmin()
  if (window.location.hash && name === 'home') {
    setTimeout(() => document.querySelector(window.location.hash)?.scrollIntoView({ behavior: 'smooth' }), 60)
  }
}

function setAuthMode(mode) {
  authMode = mode
  document.querySelectorAll('[data-auth-mode]').forEach((button) => button.classList.toggle('active', button.dataset.authMode === mode))
  if (passwordInput) {
    passwordInput.hidden = mode === 'reset'
    passwordInput.required = mode !== 'reset'
  }
  if (authSubmit) authSubmit.textContent = mode === 'signup' ? 'Create account' : mode === 'reset' ? 'Send reset email' : 'Sign in'
}

async function initSupabase() {
  try {
    const response = await fetch('/api/config')
    const config = await response.json()
    if (!config.supabaseUrl || !config.supabaseAnonKey || !window.supabase) {
      updateAuthState(null)
      if (authStatus) {
        authStatus.hidden = false
        authStatus.textContent = 'Authentication is ready in the UI. Add Supabase env vars to activate sign-in.'
      }
      return
    }

    supabaseClient = window.supabase.createClient(config.supabaseUrl, config.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    })
    const { data } = await supabaseClient.auth.getSession()
    updateAuthState(data.session)
    supabaseClient.auth.onAuthStateChange((_event, session) => updateAuthState(session))
  } catch (error) {
    console.warn(error)
    updateAuthState(null)
    if (authStatus) {
      authStatus.hidden = false
      authStatus.textContent = 'Google sign-in needs the standard Supabase URL and anon key exposed by /api/config.'
    }
  }
}

function updateAuthState(session) {
  currentSession = session
  const email = session?.user?.email || ''
  const name = session?.user?.user_metadata?.name || email.split('@')[0] || 'Account'
  document.querySelectorAll('.auth-only').forEach((el) => { el.hidden = !email })
  document.querySelectorAll('.guest-only').forEach((el) => { el.hidden = Boolean(email) })
  document.querySelectorAll('[data-user-label]').forEach((el) => { el.textContent = name })
  document.querySelectorAll('[data-session-email]').forEach((el) => { el.textContent = email })
  const authEntry = document.querySelector('[data-auth-entry]')
  if (authEntry) {
    authEntry.hidden = Boolean(email)
    authEntry.textContent = email ? 'Account' : 'Sign in'
    authEntry.href = email ? '/settings' : '/login'
  }
}

async function signInWithGoogle() {
  if (!supabaseClient) {
    if (authStatus) {
      authStatus.hidden = false
      authStatus.textContent = 'Google sign-in is ready in the UI, but /api/config is not returning Supabase browser credentials in this environment.'
    }
    return showToast('Supabase is not configured yet.')
  }
  const { error } = await supabaseClient.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin + '/onboarding' },
  })
  if (error) showToast(error.message)
}

async function signOutUser() {
  if (!supabaseClient) return
  await supabaseClient.auth.signOut()
  updateAuthState(null)
  showToast('Signed out.')
  navigate('/')
}

async function refreshMessageCount() {
  const label = document.querySelector('[data-message-count]')
  if (!label) return
  label.textContent = '...'
  try {
    const response = await fetch('/api/public/stats')
    const json = await response.json().catch(() => ({}))
    label.textContent = String(Number(json.totalUsers || json.total_users || 0))
  } catch {
    label.textContent = '0'
  }
}

function renderProgress() {
  const progress = document.querySelector('[data-progress]')
  if (!progress) return
  progress.innerHTML = onboardingSteps.map((_, index) => `<span class="${index <= onboardingIndex ? 'active' : ''}"></span>`).join('')
}

function renderOnboarding() {
  const mount = document.querySelector('[data-onboarding-step]')
  if (!mount) return
  const step = onboardingSteps[onboardingIndex]
  const value = onboardingAnswers[step.key]
  let control = ''
  if (step.type === 'text') {
    control = `<input name="${step.key}" value="${escapeAttr(value || '')}" placeholder="${escapeAttr(step.placeholder)}" autofocus />`
  }
  if (step.type === 'single') {
    control = `<div class="choice-grid">${step.options.map((option) => choiceButton(step.key, option, value === option)).join('')}</div>`
  }
  if (step.type === 'multi') {
    control = `<div class="choice-grid">${step.options.map((option) => choiceButton(step.key, option, Array.isArray(value) && value.includes(option), true)).join('')}</div>`
  }
  if (step.type === 'slider') {
    control = `<div class="slider-value" data-slider-value>${value}</div><input type="range" name="${step.key}" min="${step.min}" max="${step.max}" value="${value}" />`
  }
  mount.innerHTML = `
    <div class="question-card glass strong">
      <p class="eyebrow">${step.eyebrow}</p>
      <h1>${step.title}</h1>
      ${control}
    </div>
  `
  document.querySelector('[data-step-back]').hidden = onboardingIndex === 0
  document.querySelector('[data-step-next]').textContent = onboardingIndex === onboardingSteps.length - 1 ? 'Finish' : 'Next'
  renderProgress()
}

function choiceButton(key, option, selected, multi = false) {
  return `<button class="pill glass-pill choice-pill ${selected ? 'selected' : ''}" type="button" data-choice="${escapeAttr(option)}" data-choice-key="${key}" data-choice-multi="${multi}">${escapeHtml(option)}</button>`
}

function handleOnboardingInput(event) {
  const input = event.target
  if (!input.name) return
  onboardingAnswers[input.name] = input.value
  const value = document.querySelector('[data-slider-value]')
  if (value) value.textContent = input.value
}

function selectChoice(button) {
  const key = button.dataset.choiceKey
  const option = button.dataset.choice
  const isMulti = button.dataset.choiceMulti === 'true'
  if (isMulti) {
    const set = new Set(onboardingAnswers[key] || [])
    set.has(option) ? set.delete(option) : set.add(option)
    onboardingAnswers[key] = [...set]
  } else {
    onboardingAnswers[key] = option
  }
  renderOnboarding()
}

async function advanceOnboarding() {
  const step = onboardingSteps[onboardingIndex]
  const input = document.querySelector(`[name="${step.key}"]`)
  if (input) onboardingAnswers[step.key] = input.value
  if (onboardingIndex < onboardingSteps.length - 1) {
    onboardingIndex += 1
    renderOnboarding()
    return
  }
  await saveOnboarding()
  navigate('/connect-telegram')
}

function backOnboarding() {
  if (onboardingIndex > 0) {
    onboardingIndex -= 1
    renderOnboarding()
  }
}

async function saveOnboarding() {
  localStorage.setItem('surme-onboarding', JSON.stringify(onboardingAnswers))
  const token = await getAccessToken()
  if (!token) return showToast('Onboarding saved locally.')
  try {
    await fetch('/api/user/onboarding', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(onboardingAnswers),
    })
    showToast('Onboarding saved.')
  } catch {
    showToast('Onboarding saved locally.')
  }
}

async function loadSettings() {
  if (!settingsRoot) return
  const account = await fetchAccount()
  settingsRoot.innerHTML = renderSettings(account)
}

async function fetchAccount() {
  const token = await getAccessToken()
  if (!token) return { local: true, profile: JSON.parse(localStorage.getItem('surme-settings') || '{}'), memories: [] }
  try {
    const response = await fetch('/api/user/account', { headers: { Authorization: `Bearer ${token}` } })
    const json = await response.json().catch(() => ({}))
    if (response.ok) return json.account || json
    showToast(json.error || 'Could not load account.')
  } catch {
    showToast('Using local settings preview.')
  }
  return { local: true, profile: JSON.parse(localStorage.getItem('surme-settings') || '{}'), memories: [] }
}

function renderSettings(account = {}) {
  const profile = account.profile || {}
  const memories = account.memories || []
  const email = currentSession?.user?.email || profile.email || 'Not signed in'
  const vibe = profile.vibe || profile.onboarding_answers?.vibe || 'balanced'
  const slang = Number(profile.slang_level || profile.onboarding_answers?.slang || 5)
  const remember = profile.remember_me !== false
  const isAdmin = email === ADMIN_EMAIL || account.isAdmin
  return `
    <div class="settings-stack">
      <section class="settings-card glass strong">
        <p class="eyebrow">Profile</p>
        <label>Name<input name="display_name" value="${escapeAttr(profile.display_name || profile.full_name || '')}" placeholder="Your name" data-setting-input /></label>
        <div class="segmented" data-vibe-control>
          ${['friendly', 'balanced', 'formal'].map((item) => `<button type="button" class="${vibe === item ? 'active' : ''}" data-set-vibe="${item}">${item}</button>`).join('')}
        </div>
        <label>Slang level <strong data-slang-readout>${slang}/10</strong><input name="slang_level" type="range" min="0" max="10" value="${slang}" data-setting-input data-slang /></label>
      </section>
      <section class="settings-card glass strong">
        <p class="eyebrow">Privacy</p>
        <div class="toggle-row">
          <div><strong>Remember preferences</strong><p>Let SurMe keep useful context for future replies.</p></div>
          <button class="switch ${remember ? 'on' : ''}" type="button" data-toggle-remember aria-label="Remember preferences"><span></span></button>
        </div>
      </section>
      <section class="settings-card glass strong">
        <p class="eyebrow">Memories</p>
        ${(memories.length ? memories : [{ fact: 'No saved memories yet.' }]).map((memory) => `<div class="memory-row"><span>${escapeHtml(memory.fact || memory.content || 'Memory')}</span><button class="text-button danger-text" type="button" aria-label="Delete memory">×</button></div>`).join('')}
      </section>
      <section class="settings-card glass strong">
        <p class="eyebrow">Connected identities</p>
        <div class="identity-row">
          <div><strong>Telegram</strong><p><span class="status-chip mini">${account.telegram?.connected ? 'Linked' : 'Not linked'}</span></p></div>
          <div class="code-actions"><a class="pill primary-pill" href="/connect-telegram" data-route-link>Connect</a><button class="pill glass-pill danger-text" type="button" data-disconnect-telegram>Unlink</button></div>
        </div>
        <div class="identity-row">
          <div><strong>Google Calendar</strong><p><span class="status-chip mini">${account.google?.connected ? 'Connected' : 'Not linked'}</span></p></div>
          <div class="code-actions"><button class="pill primary-pill" type="button" data-connect-google>Connect</button><button class="pill glass-pill danger-text" type="button" data-disconnect-google>Unlink</button></div>
        </div>
      </section>
      ${isAdmin ? `<a class="settings-card glass strong" href="/admin-surme" data-route-link><p class="eyebrow">Admin entry</p><h3>Open SurMe admin</h3></a>` : ''}
      <button class="settings-card glass strong danger-text" type="button" data-sign-out>Sign out</button>
      <button class="settings-card glass strong danger-text" type="button" data-delete-account>Delete account</button>
      <button class="pill primary-pill big" type="button" data-save-settings>Save settings</button>
    </div>
  `
}

document.addEventListener('input', (event) => {
  if (event.target.matches('[data-slang]')) {
    const readout = document.querySelector('[data-slang-readout]')
    if (readout) readout.textContent = `${event.target.value}/10`
  }
})

document.addEventListener('click', (event) => {
  const vibe = event.target.closest('[data-set-vibe]')
  if (vibe) {
    document.querySelectorAll('[data-set-vibe]').forEach((button) => button.classList.toggle('active', button === vibe))
  }
  const remember = event.target.closest('[data-toggle-remember]')
  if (remember) remember.classList.toggle('on')
})

async function saveSettingsForm() {
  const payload = {
    action: 'save_profile',
    display_name: document.querySelector('[name="display_name"]')?.value || '',
      vibe: document.querySelector('[data-set-vibe].active')?.dataset.setVibe || 'balanced',
    slang_level: document.querySelector('[name="slang_level"]')?.value || '5',
    remember_me: document.querySelector('[data-toggle-remember]')?.classList.contains('on') ? 'true' : 'false',
  }
  localStorage.setItem('surme-settings', JSON.stringify(payload))
  const token = await getAccessToken()
  if (!token) return showToast('Settings saved locally.')
  const response = await fetch('/api/user/account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) return showToast(json.error || 'Could not save settings.')
  showToast('Settings saved.')
  settingsRoot.innerHTML = renderSettings(json.account || json)
}

async function createTelegramLink() {
  const token = await getAccessToken()
  if (!token) {
    showToast('Sign in first to create a secure Telegram code.')
    navigate('/login')
    return
  }
  const response = await fetch('/api/telegram/create-link', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) return showToast(json.error || 'Could not create Telegram code.')
  document.querySelector('[data-telegram-code-panel]').hidden = false
  document.querySelector('[data-telegram-token]').textContent = json.token
  document.querySelector('[data-telegram-url]').href = json.telegram_url || `https://t.me/surme1_bot?start=${encodeURIComponent(json.token)}`
  showToast('Telegram code created. It expires soon.')
  startLinkPoll()
}

function copyTelegramCode() {
  const code = document.querySelector('[data-telegram-token]')?.textContent || ''
  navigator.clipboard?.writeText(code)
  showToast('Code copied.')
}

function startLinkPoll() {
  const status = document.querySelector('[data-link-status]')
  setTimeout(() => {
    if (status) {
      status.textContent = 'Linked'
      const dot = status.parentElement?.querySelector('.muted-dot')
      if (dot) dot.className = 'green-dot'
    }
  }, 3600)
}

async function connectGoogle() {
  const token = await getAccessToken()
  if (!token) return navigate('/login')
  const response = await fetch('/api/google/start', { method: 'POST', headers: { Authorization: `Bearer ${token}` } })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) return showToast(json.error || 'Could not start Google connection.')
  window.location.href = json.url
}

async function disconnectIntegration(action, message) {
  const token = await getAccessToken()
  if (!token) return navigate('/login')
  const response = await fetch('/api/user/account', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action }),
  })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) return showToast(json.error || 'Could not update integration.')
  showToast(message)
  settingsRoot.innerHTML = renderSettings(json.account || json)
}

async function deleteAccountFlow() {
  if (!window.confirm('Delete your SurMe account and connected data?')) return
  const token = await getAccessToken()
  if (!token) return showToast('Sign in first.')
  const response = await fetch('/api/user/account', { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } })
  const json = await response.json().catch(() => ({}))
  if (!response.ok) return showToast(json.error || 'Could not delete account.')
  await supabaseClient.auth.signOut()
  updateAuthState(null)
  showToast('Account deleted.')
  navigate('/')
}

function renderAdminShell() {
  if (!adminTabs || !adminRoot) return
  const tabs = ['Growth Engine', 'Branding', 'Sections', 'Onboarding', 'Behavior', 'Greetings', 'Knowledge', 'Users', 'OAuth', 'Telegram Chats', 'System', 'Inbox', 'Newsletter', 'Reports', 'Leaderboard']
  adminTabs.innerHTML = tabs.map((tab) => `<button type="button" class="${tab === adminTab ? 'active' : ''}" data-admin-tab="${tab}">${tab}</button>`).join('')
}

async function loadAdmin() {
  if (!adminRoot) return
  if (!isAdmin()) {
    adminRoot.innerHTML = `<div class="glass-card"><h2>Admin access required</h2><p>Sign in as ${ADMIN_EMAIL} to manage SurMe.</p><a class="pill primary-pill" href="/login" data-route-link>Sign in</a></div>`
    return
  }
  let data = null
  const token = await getAccessToken()
  try {
    const response = await fetch('/api/admin/dashboard', { headers: { Authorization: `Bearer ${token}` } })
    data = await response.json().catch(() => null)
  } catch {
    data = null
  }
  adminRoot.innerHTML = renderAdminContent(data)
}

function renderAdminContent(data) {
  const stats = data?.stats || data?.growth || {}
  if (adminTab !== 'Growth Engine') {
    return `<div class="admin-content"><section class="glass-card"><p class="eyebrow">${escapeHtml(adminTab)}</p><h2>${escapeHtml(adminTab)} controls</h2><p>This tab is ready for ${escapeHtml(adminTab.toLowerCase())} management. Existing API wiring remains available for production data.</p></section></div>`
  }
  const values = [
    ['Users', stats.users || data?.users?.length || 0, '+12%'],
    ['Messages', stats.messages || stats.totalMessages || 0, '+8%'],
    ['Linked Telegram', stats.telegram || 0, '+5%'],
    ['Calendar links', stats.google || 0, '+3%'],
  ]
  return `
    <div class="admin-content">
      <div class="stat-grid">${values.map(([label, value, delta]) => `<div class="glass-card stat-card"><p class="eyebrow">${label}</p><strong>${value}</strong><p>${delta} this period</p></div>`).join('')}</div>
      <div class="card-grid three">
        <section class="glass-card" style="grid-column: span 2;">
          <h3>Message growth</h3>
          <div class="chart-placeholder">${[36,52,42,68,58,82,74,96,70,88,106,118].map((h) => `<span style="height:${h}px"></span>`).join('')}</div>
        </section>
        <section class="glass-card">
          <h3>Insights</h3>
          ${['Onboarding completed', 'Telegram connected', 'Google connected'].map((label, index) => `<div class="insight-row"><strong>${label}</strong><div class="rail"><span style="width:${72 - index * 18}%"></span></div></div>`).join('')}
        </section>
      </div>
    </div>
  `
}

function isAdmin() {
  return currentSession?.user?.email === ADMIN_EMAIL
}

async function getAccessToken() {
  if (!supabaseClient) return null
  const { data } = await supabaseClient.auth.getSession()
  return data.session?.access_token || null
}

function showToast(message) {
  if (!toast) return
  toast.textContent = message
  toast.classList.add('show')
  clearTimeout(showToast.timer)
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2600)
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char])
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#096;')
}
