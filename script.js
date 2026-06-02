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

let adminState = {
  tab: 'behavior',
  data: null,
}

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

adminModal.addEventListener('click', async (event) => {
  const target = event.target.closest('[data-admin-tab-button], [data-admin-close], [data-admin-action], [data-user-action]')
  if (!target) return

  if (target.matches('[data-admin-close]')) {
    closeAdminPanel()
    return
  }

  if (target.matches('[data-admin-tab-button]')) {
    setAdminTab(target.dataset.adminTabButton)
    return
  }

  if (target.matches('[data-admin-action]')) {
    event.preventDefault()
    const action = target.dataset.adminAction
    if (action === 'refresh') return await openAdminPanel(true)
    if (action === 'test-behavior') return await runBehaviorTest()
    if (action === 'test-gemini') return await runGeminiSmokeTest()
    return
  }

  if (target.matches('[data-user-action]')) {
    event.preventDefault()
    await runUserAction(target.dataset.userAction, target.dataset.userId)
  }
})

adminModal.addEventListener('submit', async (event) => {
  const form = event.target.closest('[data-admin-form]')
  if (!form) return
  event.preventDefault()

  const token = await getAccessToken()
  if (!token) return showToast('Please sign in as admin first.')

  const action = form.dataset.adminForm
  const response = await fetch('/api/admin/dashboard', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(buildAdminPayload(action, form)),
  })
  const json = await response.json()
  if (!response.ok) return showToast(json.error || 'Could not save admin settings.')
  adminState.data = json.dashboard
  adminModal.innerHTML = renderAdminConsole(json.dashboard)
  setAdminTab(action === 'brand' ? 'brand' : action === 'users' ? 'users' : action === 'schedule' ? 'telegram' : adminState.tab)
  showToast('Admin settings saved.')
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

async function openAdminPanel(refresh = false) {
  if (!isAdmin()) return showToast('Admin access is only enabled for nilaademo@gmail.com.')
  if (!refresh) adminState.tab = 'behavior'
  const token = await getAccessToken()
  const response = await fetch('/api/admin/dashboard', {
    headers: { Authorization: `Bearer ${token}` },
  })
  const json = await response.json()
  adminState.data = json
  adminModal.innerHTML = renderAdminConsole(json)
  openModal(adminModal)
  document.body.classList.add('admin-open')
  setAdminTab(adminState.tab)
}

function closeAdminPanel() {
  closeModal(adminModal)
  document.body.classList.remove('admin-open')
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

function setAdminTab(tab) {
  adminState.tab = ['behavior', 'users', 'health'].includes(tab) ? tab : 'behavior'
  const panels = adminModal.querySelectorAll('[data-admin-panel]')
  const buttons = adminModal.querySelectorAll('[data-admin-tab-button]')
  panels.forEach((panel) => {
    panel.hidden = panel.dataset.adminPanel !== adminState.tab
  })
  buttons.forEach((button) => {
    button.classList.toggle('active', button.dataset.adminTabButton === adminState.tab)
  })
  const label = adminModal.querySelector('[data-admin-current-tab]')
  if (label) label.textContent = formatTabLabel(adminState.tab)
}

function formatTabLabel(tab) {
  return {
    behavior: 'Behavior',
    users: 'Users',
    health: 'Health',
  }[tab] || tab
}

function buildAdminPayload(action, form) {
  const data = Object.fromEntries(new FormData(form).entries())
  if (action === 'behavior') {
    return {
      action: 'save_behavior',
      persona: data.persona,
      followup_style: data.followup_style,
      safety_rules: data.safety_rules,
      output_length: data.output_length,
    }
  }
  if (action === 'onboarding') {
    return {
      action: 'save_onboarding',
      welcome_message: data.welcome_message,
      ask_name: data.ask_name,
      ask_age: data.ask_age,
      ask_goals: data.ask_goals,
      ask_calendar: data.ask_calendar,
      ask_source: data.ask_source,
      wrap_up_message: data.wrap_up_message,
      goal_options: data.goal_options,
      source_options: data.source_options,
    }
  }
  if (action === 'commands') {
    return {
      action: 'save_commands',
      commands: parseListField(data.commands_json),
    }
  }
  if (action === 'knowledge') {
    return {
      action: 'save_knowledge',
      knowledge: parseKnowledgeField(data.knowledge_json),
    }
  }
  if (action === 'brand') {
    return {
      action: 'save_brand',
      business_name: data.business_name,
      hero_headline: data.hero_headline,
      hero_subtitle: data.hero_subtitle,
      tagline: data.tagline,
      logo_url: data.logo_url,
      phone_logo_url: data.phone_logo_url,
      bg_image_url: data.bg_image_url,
    }
  }
  if (action === 'sections') {
    return {
      action: 'save_sections',
      sections: parseSectionsField(data.sections_json),
    }
  }
  if (action === 'schedule') {
    return {
      action: 'save_schedule',
      enabled: data.enabled === 'on',
      timezone: data.timezone,
      morning_time: data.morning_time,
      morning_text: data.morning_text,
      afternoon_time: data.afternoon_time,
      afternoon_text: data.afternoon_text,
      evening_time: data.evening_time,
      evening_text: data.evening_text,
      night_time: data.night_time,
      night_text: data.night_text,
    }
  }
  return { action }
}

async function runBehaviorTest() {
  const token = await getAccessToken()
  if (!token) return showToast('Please sign in as admin first.')
  const form = adminModal.querySelector('[data-admin-form="behavior"]')
  const message = adminModal.querySelector('[data-behavior-test-message]').value.trim()
  const response = await fetch('/api/admin/dashboard', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...buildAdminPayload('behavior', form),
      action: 'test_behavior',
      message,
    }),
  })
  const json = await response.json()
  const output = adminModal.querySelector('[data-behavior-test-output]')
  if (!response.ok) return showToast(json.error || 'Could not run test.')
  output.textContent = json.reply || 'Done.'
  showToast('Persona test complete.')
}

async function runGeminiSmokeTest() {
  const token = await getAccessToken()
  if (!token) return showToast('Please sign in as admin first.')
  const message = adminModal.querySelector('[data-behavior-test-message]').value.trim()
  const response = await fetch('/api/admin/gemini-test', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
    }),
  })
  const json = await response.json()
  const output = adminModal.querySelector('[data-behavior-test-output]')
  if (!response.ok) return showToast(json.error || 'Gemini test failed.')
  output.textContent = json.reply || 'Done.'
  showToast('Gemini smoke test complete.')
}

async function runUserAction(action, userId) {
  const token = await getAccessToken()
  if (!token) return showToast('Please sign in as admin first.')
  const response = await fetch('/api/admin/users', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, user_id: userId }),
  })
  const json = await response.json()
  if (!response.ok) return showToast(json.error || 'Could not update user.')
  await openAdminPanel(true)
  setAdminTab('users')
  showToast('User updated.')
}

function parseListField(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return String(value || '')
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean)
      .map((command) => ({ command, description: '', prompt: '', enabled: true }))
  }
}

function parseKnowledgeField(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parseSectionsField(value) {
  try {
    const parsed = JSON.parse(value || '[]')
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function renderAdminConsole(data) {
  const settings = data?.settings || {}
  const siteText = settings.site_text || {}
  const behavior = siteText.behavior || {}
  const health = data?.health || {}
  const users = data?.users || []
  const recentFailures = data?.recentFailures || []

  return `
    <div class="admin-console-shell">
      <div class="admin-topbar">
        <button class="admin-back" type="button" data-admin-close>&larr; Back to site</button>
        <div>
          <p class="eyebrow">Admin Console</p>
          <h2>SurMe system controller</h2>
          <p class="admin-meta">Visible only to <strong>nilaademo@gmail.com</strong>. Keep the MVP focused on behavior, users, and runtime health.</p>
        </div>
        <div class="admin-top-actions">
          <button class="button secondary" type="button" data-admin-action="refresh">Refresh</button>
          <span class="admin-pill">Privacy mode on</span>
        </div>
      </div>

      <div class="admin-metrics">
        ${metricCard('Total users', health.totalUsers ?? 0)}
        ${metricCard('Messages', health.totalMessages ?? 0)}
        ${metricCard('Active 24h', health.activeUsers ?? 0)}
        ${metricCard('Failed webhooks', health.failedWebhooks ?? 0)}
        ${metricCard('Failed AI replies', health.failedAiReplies ?? 0)}
        ${metricCard('OAuth failures', health.oauthFailures ?? 0)}
      </div>

      <div class="admin-nav" role="tablist" aria-label="Admin sections">
        ${adminTabButton('behavior', 'Behavior', true)}
        ${adminTabButton('users', 'Users')}
        ${adminTabButton('health', 'Health')}
      </div>

      <div class="admin-current-tab"><span data-admin-current-tab>Behavior</span></div>

      <section class="admin-panel" data-admin-panel="behavior" hidden>
        <div class="admin-card">
          <h3>Custom AI Behavior Prompt</h3>
          <p>This is the master prompt that the bot and web assistant use. Keep it calm, direct, and task-first.</p>
          <form data-admin-form="behavior" class="admin-form">
            <label>Persona
              <textarea name="persona" rows="9" placeholder="You are SurMe...">${escapeHtml(behavior.persona || settings.system_prompt || '')}</textarea>
            </label>
            <div class="admin-two-col">
              <label>Follow-up style
                <textarea name="followup_style" rows="5" placeholder="After every reply, end with a short question or next-step nudge.">${escapeHtml(behavior.followup_style || '')}</textarea>
              </label>
              <label>Output length
                <select name="output_length">
                  ${option('short', behavior.output_length || 'short')}
                  ${option('medium', behavior.output_length)}
                  ${option('long', behavior.output_length)}
                </select>
              </label>
            </div>
            <label>Safety rules
              <textarea name="safety_rules" rows="5" placeholder="Ask before sending email, booking travel, spending money, or deleting data.">${escapeHtml(behavior.safety_rules || '')}</textarea>
            </label>
            <div class="admin-actions">
              <button class="button secondary" type="button" data-admin-action="test-behavior">Persona test</button>
              <button class="button secondary" type="button" data-admin-action="test-gemini">Gemini test</button>
              <button class="button primary" type="submit">Save behavior</button>
            </div>
          </form>
          <label class="admin-test">
            Test message
            <textarea data-behavior-test-message rows="4" placeholder="Paste a sample user message..."></textarea>
          </label>
          <div class="admin-test-output" data-behavior-test-output>Save behavior, then run a test to preview the assistant response.</div>
        </div>
      </section>

      <section class="admin-panel" data-admin-panel="users" hidden>
        <div class="admin-card">
          <div class="admin-panel-header">
            <div>
              <h3>User management</h3>
              <p>View linked identities, message counts, and connection state. Disconnect Telegram, disconnect Google, or delete the account if needed.</p>
            </div>
            <button class="button secondary" type="button" data-admin-action="refresh">Refresh</button>
          </div>
          <input class="admin-search" type="search" placeholder="Search email, telegram, or name..." data-user-search />
          <div class="admin-user-list">
            ${users.length ? users.map(renderUserCard).join('') : '<p class="admin-empty">No users found yet.</p>'}
          </div>
        </div>
      </section>

      <section class="admin-panel" data-admin-panel="health" hidden>
        <div class="admin-card">
          <h3>System health</h3>
          <div class="admin-two-col health-grid">
            ${metricCard('Users total', health.totalUsers ?? 0)}
            ${metricCard('Messages total', health.totalMessages ?? 0)}
            ${metricCard('Active 24h', health.activeUsers ?? 0)}
            ${metricCard('Failed webhooks', health.failedWebhooks ?? 0)}
            ${metricCard('Failed AI replies', health.failedAiReplies ?? 0)}
            ${metricCard('OAuth failures', health.oauthFailures ?? 0)}
          </div>
          <div class="admin-log-list">
            ${recentFailures.length ? recentFailures.map((row) => `<div class="admin-log error"><strong>${escapeHtml(row.event_type || 'failure')}</strong><span>${escapeHtml(row.error_message || 'Unknown issue')}</span></div>`).join('') : '<p class="admin-empty">No recent failures.</p>'}
          </div>
        </div>
      </section>
    </div>
  `
}

function renderUserCard(user) {
  return `
    <div class="admin-user-card">
      <div class="admin-user-main">
        <strong>${escapeHtml(user.display_name || user.email || 'Unknown')}</strong>
        <span>${escapeHtml(user.email || 'No email')}</span>
        <small>Telegram: ${user.telegram_connected ? 'linked' : 'not linked'} · Telegram ID: ${escapeHtml(String(user.telegram_chat_id || '—'))}</small>
        <small>Calendar: ${user.google_connected ? 'linked' : 'not linked'}${user.google_email ? ` · ${escapeHtml(user.google_email)}` : ''}</small>
        <small>Messages: ${user.message_count || 0}${user.latest_oauth_error ? ` · OAuth note: ${escapeHtml(user.latest_oauth_error)}` : ''}</small>
      </div>
      <div class="admin-user-actions">
        <button class="button secondary" type="button" data-user-action="disconnect_telegram" data-user-id="${escapeAttr(user.user_id)}">Disconnect Telegram</button>
        <button class="button secondary" type="button" data-user-action="disconnect_google" data-user-id="${escapeAttr(user.user_id)}">Disconnect Google</button>
        <button class="button secondary danger" type="button" data-user-action="delete_account" data-user-id="${escapeAttr(user.user_id)}">Delete account</button>
      </div>
    </div>
  `
}

function adminTabButton(tab, label, active = false) {
  return `<button class="admin-tab${active ? ' active' : ''}" type="button" data-admin-tab-button="${tab}">${escapeHtml(label)}</button>`
}

function metricCard(label, value) {
  return `<div class="admin-mini-card"><span>${escapeHtml(label)}</span><strong>${escapeHtml(String(value ?? 0))}</strong></div>`
}

function option(value, current) {
  return `<option value="${escapeAttr(value)}"${String(value) === String(current || 'short') ? ' selected' : ''}>${escapeHtml(value)}</option>`
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function escapeAttr(value) {
  return escapeHtml(value).replace(/`/g, '&#96;')
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


