-- db/migrations/2026-06-02-notification-tables.sql
-- Adds the notification_subscriptions and notification_outbox tables.

create table if not exists public.notification_subscriptions (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  channel text not null default 'webhook' check (channel in ('webhook')),
  config jsonb not null,
  severity_threshold text not null default 'medium'
                                   check (severity_threshold in ('low','medium','high')),
  enabled boolean not null default true,
  consecutive_failures integer not null default 0,
  failure_window_start timestamptz,
  last_triggered_at timestamptz,
  last_failure_at timestamptz,
  last_failure_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_notif_subscriptions_room
  on public.notification_subscriptions(project_id, enabled);

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references public.notification_subscriptions(id) on delete cascade,
  ai_explanation_id uuid not null references public.ai_explanations(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','delivered','failed')),
  attempts integer not null default 0,
  last_error text,
  next_attempt_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  delivered_at timestamptz
);

create index if not exists idx_outbox_pending
  on public.notification_outbox(status, next_attempt_at)
  where status = 'pending';
