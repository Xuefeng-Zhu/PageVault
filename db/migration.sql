-- db/migration.sql
-- PageVault: 7 tables with uuid PKs, timestamptz defaults, cascading foreign keys, indexes
-- Schema from SYSTEM_DESIGN.md

create extension if not exists pgcrypto;

-- projects: user-owned monitoring workspaces
create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id),
  name text not null,
  box_root_folder_id text,
  created_at timestamptz not null default now()
);

-- tracked_pages: monitored pages per project
create table if not exists public.tracked_pages (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  source_url text not null,
  normalized_url text not null,
  slug text not null,
  box_page_folder_id text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (project_id, normalized_url)
);

-- snapshot_jobs: executions of crawl jobs
create table if not exists public.snapshot_jobs (
  id uuid primary key default gen_random_uuid(),
  tracked_page_id uuid not null references public.tracked_pages(id) on delete cascade,
  trigger_type text not null check (trigger_type in ('manual','schedule','box_webhook','retry')),
  status text not null check (status in ('queued','running','succeeded','failed','deduped')),
  apify_run_id text,
  apify_dataset_id text,
  error_code text,
  error_message text,
  requested_at timestamptz not null default now(),
  finished_at timestamptz
);

-- snapshots: captured versions of tracked pages
create table if not exists public.snapshots (
  id uuid primary key default gen_random_uuid(),
  tracked_page_id uuid not null references public.tracked_pages(id) on delete cascade,
  job_id uuid not null references public.snapshot_jobs(id) on delete cascade,
  observed_at timestamptz not null default now(),
  final_url text,
  canonical_url text,
  page_title text,
  http_status integer,
  markdown_hash text not null,
  html_hash text,
  screenshot_phash text,
  change_type text not null check (change_type in ('none','textual','visual','structural','error')),
  dedup_of_snapshot_id uuid references public.snapshots(id),
  box_snapshot_folder_id text
);

-- artifacts: stored evidence files (HTML, Markdown, PNG, JSON)
create table if not exists public.artifacts (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null references public.snapshots(id) on delete cascade,
  kind text not null check (kind in ('markdown','html','screenshot','snapshot_json','diff_json','explanation_json')),
  box_file_id text,
  box_file_version_id text,
  sha256 text not null,
  bytes bigint,
  mime_type text,
  box_path text
);

-- ai_explanations: LLM-generated change analysis
create table if not exists public.ai_explanations (
  id uuid primary key default gen_random_uuid(),
  snapshot_id uuid not null unique references public.snapshots(id) on delete cascade,
  previous_snapshot_id uuid references public.snapshots(id),
  model text not null,
  prompt_version text not null,
  output_json jsonb not null,
  confidence numeric(4,3),
  created_at timestamptz not null default now()
);

-- webhook_events: idempotency log for webhooks
create table if not exists public.webhook_events (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('apify','box')),
  external_event_id text not null,
  payload_sha256 text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  status text not null check (status in ('received','processed','ignored','failed')),
  unique (source, external_event_id)
);

-- Indexes
create index if not exists idx_projects_owner on public.projects(owner_id);
create index if not exists idx_tracked_pages_project on public.tracked_pages(project_id);
create index if not exists idx_jobs_page_requested on public.snapshot_jobs(tracked_page_id, requested_at desc);
create index if not exists idx_jobs_status_requested on public.snapshot_jobs(status, requested_at desc);
create index if not exists idx_snapshots_page_observed on public.snapshots(tracked_page_id, observed_at desc);
create index if not exists idx_snapshots_hashes on public.snapshots(markdown_hash);
create index if not exists idx_snapshots_change_type on public.snapshots(change_type);
create index if not exists idx_artifacts_snapshot_kind on public.artifacts(snapshot_id, kind);
create index if not exists idx_artifacts_box_file_id on public.artifacts(box_file_id);
create index if not exists idx_ai_model_created on public.ai_explanations(model, created_at desc);
create index if not exists idx_webhooks_source_received on public.webhook_events(source, received_at desc);

-- RLS policies
alter table public.projects enable row level security;
alter table public.tracked_pages enable row level security;
alter table public.snapshot_jobs enable row level security;
alter table public.snapshots enable row level security;
alter table public.artifacts enable row level security;
alter table public.ai_explanations enable row level security;

create policy projects_owner_select on public.projects
  for select using (owner_id = auth.uid());

create policy tracked_pages_owner_select on public.tracked_pages
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = tracked_pages.project_id
 and p.owner_id = auth.uid()
    )
  );
