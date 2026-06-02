-- db/migrations/2026-06-02-scan-schedules.sql
-- Adds the scan_schedules table for per-room cron-based scan scheduling.

create table if not exists public.scan_schedules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  cron_expression text not null,
  enabled boolean not null default true,
  insforge_schedule_id text,
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create index if not exists idx_schedules_enabled
  on public.scan_schedules(enabled) where enabled = true;
