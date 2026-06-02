# SurMe UI Direction

SurMe should feel like a calm, premium, Telegram-first executive assistant.

The product should stay focused on these core surfaces only:
- Telegram assistant
- Web login
- Google Calendar connect
- Admin console
- Landing page
- Onboarding

Design goals:
- light theme only
- soft blue / sky gradient background
- glassy cards with rounded corners and gentle blur
- blue-to-indigo accent for emphasis and primary actions
- smooth motion without feeling busy
- mobile-first layout that still scales well to desktop
- no dead buttons, no untouchable sections, no decorative UI that does nothing

Behavior goals:
- Gemini answers normal chat first
- keep a quiet fallback only when Gemini truly fails
- scheduling should ask at most one clarification when a detail is missing
- if enough scheduling detail exists, create the calendar event automatically
- Telegram image messages should be understood naturally
- the admin prompt should control the assistant personality and behavior

Web app goals:
- visible sign in / log out control in the top-right header
- logged-in users should clearly see a different state
- onboarding should stay short and focused
- timezone should default to Asia/Phnom_Penh
- remove noisy onboarding fields that do not support the MVP

Admin goals:
- keep only Behavior, Users, Health in the main admin navigation
- remove broken or incomplete admin surfaces from the main experience
- focus the console on prompt editing, user management, and live system status

Landing page goals:
- keep the full landing structure, but every visible section and control should do something real
- hero should feel like a calm executive assistant
- large phone mockup
- rounded glass surfaces
- clean spacing and clear hierarchy
- `Nilaamio` should be a clickable blue-gradient link
- show a live message count in the top bar

Reference direction:
- inspired by the calm, airy, blue/sky visual language from the SurMe reference site
- premium but minimal
- friendly, polished, and easy to scan
