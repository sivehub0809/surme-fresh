# SurMe Vercel Deployment

## 1. Deploy the website

Install and log in to Vercel:

```powershell
npm i -g vercel
vercel login
```

From this folder:

```powershell
vercel
vercel --prod
```

The static site is served from:

```text
/
```

The Telegram webhook is served from:

```text
/api/public/telegram/webhook
```

## 2. Add Vercel environment variables

In Vercel Project Settings -> Environment Variables, add:

```text
TELEGRAM_BOT_TOKEN=<token from BotFather>
TELEGRAM_WEBHOOK_SECRET=<long random string>
TELEGRAM_BOT_USERNAME=surme1_bot
SETUP_SECRET=<long random string used only for webhook setup>
PUBLIC_APP_URL=https://your-vercel-domain.vercel.app
OPENAI_API_KEY=<enables AI replies and admin persona structuring>
AI_MODEL=gpt-5
SUPABASE_URL=<from Supabase project settings>
SUPABASE_ANON_KEY=<from Supabase API settings>
SUPABASE_SERVICE_ROLE_KEY=<server-only key from Supabase API settings>
GOOGLE_CLIENT_ID=<Google Cloud OAuth client>
GOOGLE_CLIENT_SECRET=<Google Cloud OAuth secret>
GOOGLE_REDIRECT_URI=https://your-vercel-domain.vercel.app/api/google/callback
AI_PERSONA=<optional fallback persona>
```

Redeploy after adding env vars.

Telegram webhook only requires `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME`, and `SETUP_SECRET`.
`PUBLIC_APP_URL` is strongly recommended so the webhook setup endpoint registers the exact production URL.
Login, Google sign-in, forgot password, saved sessions, onboarding, and admin persona editing require the three Supabase vars.
Google Calendar connect requires the three Google vars.

## 2.1 Prepare Supabase Auth

In Supabase:

1. Create a project.
2. Go to SQL Editor and run `supabase-fresh.sql`.
3. Go to Authentication -> Providers -> Email and enable email/password.
4. Go to Authentication -> Providers -> Google and enable Google OAuth.
5. Add your Vercel URL to Authentication -> URL Configuration:
   - Site URL: `https://your-vercel-domain.vercel.app`
   - Redirect URL: `https://your-vercel-domain.vercel.app`
6. Create the admin account with email `nilaademo@gmail.com`.

## 3. Register the Telegram webhook

After production deploy, call the protected setup endpoint:

```powershell
curl.exe -X POST "https://your-vercel-domain.vercel.app/api/public/telegram/set-webhook" `
  -H "Authorization: Bearer YOUR_SETUP_SECRET"
```

Expected response:

```json
{ "ok": true, "webhookUrl": "https://your-vercel-domain.vercel.app/api/public/telegram/webhook" }
```

## 4. Check bot status

```powershell
curl.exe "https://api.telegram.org/bot%TELEGRAM_BOT_TOKEN%/getWebhookInfo"
```

If `last_error_message` appears, Telegram is reaching the webhook but the function or environment variables need attention.

## 5. Local preview

The static local preview can be started with:

```powershell
python -m http.server 4173 --bind 127.0.0.1
```

Open:

```text
http://127.0.0.1:4173
```

The Telegram webhook will not work against this local static preview unless you expose it through Vercel dev or a public tunnel.
