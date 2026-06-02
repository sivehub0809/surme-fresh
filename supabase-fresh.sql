create extension if not exists pgcrypto;

create table if not exists public.user_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  full_name text,
  primary_role text,
  timezone text default 'Asia/Phnom_Penh',
  work_hours text,
  tone_preference text,
  travel_preferences text,
  goals text[] default '{}',
  contacts jsonb default '[]',
  calendar_habits text,
  personality_notes text,
  onboarding_done boolean default false,
  onboarding_answers jsonb default '{}',
  telegram_chat_id bigint,
  google_email text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.telegram_link_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  telegram_chat_id bigint,
  created_at timestamptz default now()
);

create table if not exists public.telegram_chats (
  id uuid primary key default gen_random_uuid(),
  telegram_chat_id bigint not null unique,
  telegram_user_id bigint,
  user_id uuid references auth.users(id) on delete set null,
  display_name text,
  history jsonb default '[]',
  user_message_count int default 0,
  last_message_at timestamptz default now(),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  telegram_chat_id bigint,
  source text default 'web',
  title text,
  created_at timestamptz default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid references public.conversations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  telegram_chat_id bigint,
  role text not null,
  content text not null,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create table if not exists public.user_memories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  category text not null,
  fact text not null,
  created_at timestamptz default now()
);

create table if not exists public.google_oauth_states (
  state text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  expires_at timestamptz not null,
  created_at timestamptz default now()
);

create table if not exists public.google_oauth_tokens (
  user_id uuid primary key references auth.users(id) on delete cascade,
  email text,
  access_token text not null,
  refresh_token text,
  expiry timestamptz,
  scope text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.oauth_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete set null,
  provider text default 'google',
  event_type text,
  success boolean default false,
  error_message text,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create table if not exists public.runtime_events (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'telegram',
  event_type text not null,
  user_id uuid references auth.users(id) on delete set null,
  telegram_chat_id bigint,
  success boolean default false,
  error_message text,
  metadata jsonb default '{}',
  created_at timestamptz default now()
);

create table if not exists public.surme_settings (
  id int primary key default 1,
  system_prompt text not null default 'You are SurMe, a personal AI assistant powered by Nilaamio. You remember the user, execute useful actions, and confirm before irreversible or sensitive actions.',
  behavior_prompt text default '',
  onboarding_questions jsonb default '[]',
  telegram_commands jsonb default '[]',
  knowledge jsonb default '[]',
  site_text jsonb default '{}',
  updated_at timestamptz default now()
);

create table if not exists public.telegram_scheduled_greetings (
  id int primary key default 1,
  enabled boolean default true,
  timezone text default 'Asia/Phnom_Penh',
  morning_time time default '06:00',
  morning_text text default 'Good morning. Want me to line up your day?',
  afternoon_time time default '12:00',
  afternoon_text text default 'Midday check-in. Anything you want me to handle?',
  evening_time time default '17:00',
  evening_text text default 'Evening wrap-up. I can help close loops.',
  night_time time default '21:30',
  night_text text default 'Want me to prep tomorrow before you sleep?',
  updated_at timestamptz default now()
);

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists user_profiles_touch on public.user_profiles;
create trigger user_profiles_touch before update on public.user_profiles for each row execute function public.touch_updated_at();

drop trigger if exists telegram_chats_touch on public.telegram_chats;
create trigger telegram_chats_touch before update on public.telegram_chats for each row execute function public.touch_updated_at();

drop trigger if exists google_tokens_touch on public.google_oauth_tokens;
create trigger google_tokens_touch before update on public.google_oauth_tokens for each row execute function public.touch_updated_at();

alter table public.user_profiles enable row level security;
alter table public.telegram_link_codes enable row level security;
alter table public.telegram_chats enable row level security;
alter table public.conversations enable row level security;
alter table public.messages enable row level security;
alter table public.user_memories enable row level security;
alter table public.google_oauth_states enable row level security;
alter table public.google_oauth_tokens enable row level security;
alter table public.oauth_events enable row level security;
alter table public.runtime_events enable row level security;
alter table public.surme_settings enable row level security;
alter table public.telegram_scheduled_greetings enable row level security;

drop policy if exists profiles_owner on public.user_profiles;
create policy profiles_owner on public.user_profiles for all to authenticated using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists conversations_owner on public.conversations;
create policy conversations_owner on public.conversations for select to authenticated using (auth.uid() = user_id);

drop policy if exists messages_owner on public.messages;
create policy messages_owner on public.messages for select to authenticated using (auth.uid() = user_id);

drop policy if exists memories_owner on public.user_memories;
create policy memories_owner on public.user_memories for select to authenticated using (auth.uid() = user_id);

drop policy if exists google_tokens_owner on public.google_oauth_tokens;
create policy google_tokens_owner on public.google_oauth_tokens for select to authenticated using (auth.uid() = user_id);

insert into public.surme_settings (id)
values (1)
on conflict (id) do nothing;

insert into public.telegram_scheduled_greetings (id)
values (1)
on conflict (id) do nothing;
