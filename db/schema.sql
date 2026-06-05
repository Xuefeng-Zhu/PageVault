-- =============================================================================
-- PageVault — canonical InsForge Postgres schema
-- =============================================================================
-- Project:  PageVault (wga6k9at.us-east.insforge.app)
-- Source:   derived from db/migration.sql (the legacy 7-table scaffold) +
--           db/migrations/2026-06-02-*.sql (per-feature add-ons) + the
--           post-deploy additions made by the live scan pipeline
--           (snapshots.markdown_text — see lib/scan.ts:653).
-- Apply:    npx @insforge/cli db import db/schema.sql
--           (or run statement-by-statement via `db query` if `import` is
--            not available; this file is fully idempotent).
-- Idempotent: every CREATE uses IF NOT EXISTS, every ALTER uses IF NOT EXISTS
--             / DO blocks, and every CREATE OR REPLACE for functions. Safe
--             to re-run on top of an existing partial application.
-- =============================================================================
-- Schema inventory
--   Ten tables in the public schema, in the dependency order they must be
--   created in:
--
--     Core (user-owned) ────────────────────────────────────────────────
--       1.  projects                       (rooms)
--       2.  tracked_pages                  (watched_urls)
--       3.  snapshot_jobs                  (scans)
--       4.  snapshots
--       5.  artifacts                      (evidence)
--       6.  ai_explanations                (changes view layer + ai_analyses)
--
--     Scheduling (per-project) ─────────────────────────────────────────
--       7.  scan_schedules
--
--     Webhook delivery (per-project) ───────────────────────────────────
--       8.  notification_subscriptions
--       9.  notification_outbox
--
--     System-wide (no owner) ───────────────────────────────────────────
--      10.  webhook_events                 (inbound webhook idempotency log)
--
--   RPC helpers:
--       - acquire_notification_lock(integer)  wraps pg_try_advisory_lock
--       - release_notification_lock(integer) wraps pg_advisory_unlock
--       (See "Pitfalls" in the insforge-cli skill — PostgREST can not
--        address pg_catalog functions directly, so the wrappers live in
--        the public schema and are security-definer.)
--
-- =============================================================================
-- 0. Extensions
-- =============================================================================

create extension if not exists pgcrypto;       -- gen_random_uuid()


-- =============================================================================
-- 1. projects  (alias: rooms)
-- -----------------------------------------------------------------------------
-- A user-owned "memory room" — a watchlist of URLs the user wants monitored.
-- The UI says "room"; the schema says "project" (kept for back-compat with
-- the lib/insforge.ts code, the SDK, and PostgREST routes that all use
-- "projects").
-- =============================================================================

create table if not exists public.projects (
  id                   uuid        primary key default gen_random_uuid(),
  owner_id             uuid        not null references auth.users(id),
  name                 text        not null,
  -- The legacy Box root-folder id, repurposed for the InsForge Storage path
  -- (e.g. "pagevault/aws-infrastructure-monitor/"). Field name kept for
  -- back-compat with existing code, the SDK, and the seeded data.
  box_root_folder_id   text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);


-- =============================================================================
-- 2. tracked_pages  (alias: watched_urls)
-- -----------------------------------------------------------------------------
-- One URL inside a project. Uniqueness on (project_id, normalized_url)
-- prevents double-listing the same URL inside a room.
-- =============================================================================

create table if not exists public.tracked_pages (
  id                   uuid        primary key default gen_random_uuid(),
  project_id           uuid        not null references public.projects(id) on delete cascade,
  source_url           text        not null,
  normalized_url       text        not null,
  slug                 text        not null,
  -- Legacy Box page-folder id, repurposed for the InsForge Storage path
  -- for this page's snapshots.
  box_page_folder_id   text,
  -- Soft-delete flag — false means the URL is "paused" (still in the room
  -- but excluded from scans). Note: the live scan pipeline currently
  -- uses boolean true/false; do not switch to an integer enum.
  active               boolean     not null default true,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (project_id, normalized_url)
);


-- =============================================================================
-- 3. snapshot_jobs  (alias: scans)
-- -----------------------------------------------------------------------------
-- One row per scan invocation. A scan may produce many snapshots (one per
-- URL in the room), so trigger_type is per-job, not per-snapshot.
--
-- KNOWN DATA-MODEL SHORTCUT: the current scan pipeline in lib/scan.ts
-- reuses one snapshot_jobs row across all URLs in the scan, setting
-- tracked_page_id to the first URL's id. The schema supports one job per
-- URL; the code's reuse is a pipeline shortcut, not a schema requirement.
-- See ARCHITECTURE.md "Open questions" for the long-term plan.
-- =============================================================================

create table if not exists public.snapshot_jobs (
  id                   uuid        primary key default gen_random_uuid(),
  tracked_page_id      uuid        not null references public.tracked_pages(id) on delete cascade,
  trigger_type         text        not null check (trigger_type in ('manual','schedule','box_webhook','retry')),
  status               text        not null check (status in ('queued','running','succeeded','failed','deduped')),
  apify_run_id         text,
  apify_dataset_id     text,
  error_code           text,
  error_message        text,
  -- `requested_at` is the *event* time the job was requested (the
  -- scan pipeline sets this from the trigger; it is preserved across
  -- retries so re-running a failed job does not reset the clock).
  requested_at         timestamptz not null default now(),
  finished_at          timestamptz,
  -- `created_at` is the DB-row insert time. Distinct from requested_at
  -- so retries preserve the original request time as a stable audit
  -- signal — see lib/scan.ts:runScan for the retry semantics.
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);


-- =============================================================================
-- 4. snapshots
-- -----------------------------------------------------------------------------
-- A captured page version. markdown_hash is the cost-saver: if the hash
-- matches the previous snapshot for the same tracked_page, the scan
-- pipeline skips the LLM call (no ai_explanations row is written either).
--
-- markdown_text holds the live-crawled markdown body (capped at 50 KB by
-- the scan pipeline) so the next scan can diff against it. Without this
-- column the diff excerpt in lib/scan.ts:683 throws
-- "Cannot read properties of undefined (reading 'split')".
-- =============================================================================

create table if not exists public.snapshots (
  id                       uuid        primary key default gen_random_uuid(),
  tracked_page_id          uuid        not null references public.tracked_pages(id) on delete cascade,
  job_id                   uuid        not null references public.snapshot_jobs(id) on delete cascade,
  -- `observed_at` is the *event* time the crawl finished. Distinct
  -- from `created_at` so back-dated re-crawls (e.g. a manual re-scan
  -- of a 3-month-old page) keep the original observation time.
  observed_at              timestamptz not null default now(),
  final_url                text,
  canonical_url            text,
  page_title               text,
  http_status              integer,
  markdown_hash            text        not null,
  html_hash                text,
  screenshot_phash         text,
  change_type              text        not null check (change_type in ('none','textual','visual','structural','error')),
  -- When content is identical to a prior snapshot, this points to the
  -- canonical row. The scan pipeline uses this to skip the LLM call.
  dedup_of_snapshot_id     uuid        references public.snapshots(id),
  -- Legacy Box snapshot-folder id, repurposed for the InsForge Storage
  -- path for this snapshot's folder.
  box_snapshot_folder_id   text,
  -- Live-crawled markdown body, capped at 50 KB by lib/scan.ts. Nullable
  -- for older snapshots captured before the column was added.
  markdown_text            text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);


-- =============================================================================
-- 5. artifacts  (alias: evidence)
-- -----------------------------------------------------------------------------
-- Files linked to a snapshot: HTML, Markdown, screenshot, JSON diff, etc.
-- Currently unused by lib/scan.ts (the scan pipeline uploads evidence to
-- InsForge Storage but does not insert a row here). The table is reserved
-- for the future case where we want to record individual evidence files
-- separately from the snapshots row.
-- =============================================================================

create table if not exists public.artifacts (
  id                       uuid        primary key default gen_random_uuid(),
  snapshot_id              uuid        not null references public.snapshots(id) on delete cascade,
  kind                     text        not null check (kind in ('markdown','html','screenshot','snapshot_json','diff_json','explanation_json')),
  -- Legacy Box identifiers, repurposed for InsForge Storage
  -- (box_file_id == storage key, box_file_version_id == storage version id).
  box_file_id              text,
  box_file_version_id      text,
  sha256                   text        not null,
  bytes                    bigint,
  mime_type                text,
  box_path                 text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);


-- =============================================================================
-- 6. ai_explanations  (alias: ai_analyses, and the source for the "changes"
--                      join in lib/insforge.ts:listChanges)
-- -----------------------------------------------------------------------------
-- One row per snapshot that triggered an LLM call. output_json is the
-- strict JSON the model returned; confidence is the self-assessed
-- confidence field from the same JSON. The "changes" user-facing concept
-- is a JS-side join of ai_explanations with its snapshot, NOT a separate
-- SQL table — see lib/insforge.ts:listChanges and the ER diagram in
-- db/ER.md for the relationship.
--
-- The model field stores the actual model name returned by OpenRouter
-- (e.g. "anthropic/claude-3.5-haiku"), not the alias requested.
-- =============================================================================

create table if not exists public.ai_explanations (
  id                       uuid          primary key default gen_random_uuid(),
  -- One explanation per snapshot (UNIQUE constraint). When a snapshot is
  -- the result of a no-op (markdown_hash matches the previous snapshot),
  -- the pipeline writes a synthesized explanation with severity='low',
  -- change_type='none', confidence=0.95 — see lib/scan.ts:hash-dedup branch.
  snapshot_id              uuid          not null unique references public.snapshots(id) on delete cascade,
  previous_snapshot_id     uuid          references public.snapshots(id),
  model                    text          not null,
  prompt_version           text          not null,
  output_json              jsonb         not null,
  confidence               numeric(4,3),
  created_at               timestamptz   not null default now(),
  updated_at               timestamptz   not null default now()
);


-- =============================================================================
-- 7. scan_schedules
-- -----------------------------------------------------------------------------
-- Per-project cron metadata. The `insforge_schedule_id` column holds the
-- id returned by `npx @insforge/cli schedules create` so we can update
-- or delete the underlying schedule later (CLI `update` requires the
-- schedule id, not the name — see insforge-cli skill "Pitfalls").
-- =============================================================================

create table if not exists public.scan_schedules (
  id                       uuid        primary key default gen_random_uuid(),
  project_id               uuid        not null references public.projects(id) on delete cascade,
  cron_expression          text        not null,
  enabled                  boolean     not null default true,
  insforge_schedule_id     text,
  last_run_at              timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (project_id)
);


-- =============================================================================
-- 8. notification_subscriptions
-- -----------------------------------------------------------------------------
-- Per-project webhook subscription. config is a JSON blob whose shape
-- depends on channel (currently only 'webhook' is supported, holding
-- `{url, secret, hmac_alg}`). The cron worker reads from this table,
-- inserts into notification_outbox, and the delivery worker drains it.
-- =============================================================================

create table if not exists public.notification_subscriptions (
  id                       uuid        primary key default gen_random_uuid(),
  project_id               uuid        not null references public.projects(id) on delete cascade,
  channel                  text        not null default 'webhook' check (channel in ('webhook')),
  config                   jsonb       not null,
  severity_threshold       text        not null default 'medium'
                                         check (severity_threshold in ('low','medium','high')),
  enabled                  boolean     not null default true,
  consecutive_failures     integer     not null default 0,
  failure_window_start     timestamptz,
  last_triggered_at        timestamptz,
  last_failure_at          timestamptz,
  last_failure_error       text,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);


-- =============================================================================
-- 9. notification_outbox
-- -----------------------------------------------------------------------------
-- Per-subscription delivery queue. Rows are inserted by the notification
-- scheduler (cron) and drained by the delivery worker. status drives the
-- retry loop; the partial index (status='pending', next_attempt_at) is
-- what makes the cron poll cheap.
-- =============================================================================

create table if not exists public.notification_outbox (
  id                       uuid        primary key default gen_random_uuid(),
  subscription_id          uuid        not null references public.notification_subscriptions(id) on delete cascade,
  ai_explanation_id        uuid        not null references public.ai_explanations(id) on delete cascade,
  status                   text        not null default 'pending'
                                         check (status in ('pending','delivered','failed')),
  attempts                 integer     not null default 0,
  last_error               text,
  next_attempt_at          timestamptz not null default now(),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  delivered_at             timestamptz
);


-- =============================================================================
-- 10. webhook_events
-- -----------------------------------------------------------------------------
-- System-wide idempotency log for inbound webhooks (Apify dataset
-- notifications, Box file events). Unique (source, external_event_id)
-- so the edge function handler can INSERT ... ON CONFLICT DO NOTHING
-- to drop duplicate deliveries.
--
-- This is intentionally NOT user-scoped: a webhook event is owned by
-- the source system, not a PageVault user. RLS is therefore not enabled.
-- =============================================================================

create table if not exists public.webhook_events (
  id                       uuid        primary key default gen_random_uuid(),
  source                   text        not null check (source in ('apify','box')),
  external_event_id        text        not null,
  payload_sha256           text        not null,
  -- `received_at` is the time the source system dispatched the event
  -- (passed in the webhook body). Distinct from `created_at` (the
  -- DB insert time) so a delayed retry preserves the original
  -- dispatch time for audit.
  received_at              timestamptz not null default now(),
  processed_at             timestamptz,
  status                   text        not null check (status in ('received','processed','ignored','failed')),
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now(),
  unique (source, external_event_id)
);


-- =============================================================================
-- Indexes
-- =============================================================================

create index if not exists idx_projects_owner
  on public.projects (owner_id);

create index if not exists idx_tracked_pages_project
  on public.tracked_pages (project_id);

create index if not exists idx_tracked_pages_active
  on public.tracked_pages (project_id) where active = true;

create index if not exists idx_jobs_page_requested
  on public.snapshot_jobs (tracked_page_id, requested_at desc);

create index if not exists idx_jobs_status_requested
  on public.snapshot_jobs (status, requested_at desc);

create index if not exists idx_snapshots_page_observed
  on public.snapshots (tracked_page_id, observed_at desc);

create index if not exists idx_snapshots_hashes
  on public.snapshots (markdown_hash);

create index if not exists idx_snapshots_change_type
  on public.snapshots (change_type);

create index if not exists idx_snapshots_job
  on public.snapshots (job_id);

create index if not exists idx_artifacts_snapshot_kind
  on public.artifacts (snapshot_id, kind);

create index if not exists idx_artifacts_box_file_id
  on public.artifacts (box_file_id);

create index if not exists idx_ai_model_created
  on public.ai_explanations (model, created_at desc);

create index if not exists idx_ai_explanations_previous
  on public.ai_explanations (previous_snapshot_id);

create index if not exists idx_schedules_enabled
  on public.scan_schedules (enabled) where enabled = true;

create index if not exists idx_schedules_project
  on public.scan_schedules (project_id);

create index if not exists idx_notif_subscriptions_room
  on public.notification_subscriptions (project_id, enabled);

create index if not exists idx_outbox_pending
  on public.notification_outbox (status, next_attempt_at)
  where status = 'pending';

create index if not exists idx_outbox_subscription
  on public.notification_outbox (subscription_id);

create index if not exists idx_webhooks_source_received
  on public.webhook_events (source, received_at desc);


-- =============================================================================
-- RPC helpers — wrappers for pg_advisory_lock
-- -----------------------------------------------------------------------------
-- PostgREST cannot address pg_catalog functions directly. The advisory
-- lock helpers used by the notification delivery worker therefore need
-- a public-schema, security-definer wrapper. See the "PostgREST can't
-- address pg_catalog functions directly" section in the insforge-cli
-- skill for the full diagnosis.
-- =============================================================================

create or replace function public.acquire_notification_lock(arg integer)
  returns boolean
  language sql
  security definer
  set search_path = pg_catalog, public
as $$
  select pg_try_advisory_lock(arg);
$$;

create or replace function public.release_notification_lock(arg integer)
  returns void
  language sql
  security definer
  set search_path = pg_catalog, public
as $$
  select pg_advisory_unlock(arg);
$$;

revoke all on function public.acquire_notification_lock(integer) from public;
grant execute on function public.acquire_notification_lock(integer)
  to anon, authenticated, project_admin;

revoke all on function public.release_notification_lock(integer) from public;
grant execute on function public.release_notification_lock(integer)
  to anon, authenticated, project_admin;


-- =============================================================================
-- Row-Level Security policies
-- -----------------------------------------------------------------------------
-- RLS policies are enabled on every user-scoped table. They are
-- documented defensive-in-depth: in the current Next.js code path the
-- app uses anon/service-role keys that bypass RLS, so the actual access
-- boundary is the getRoom() / userId === session.user.id check in each
-- API route (see lib/insforge.ts:listRooms/getRoom/getChangeInternal).
-- If per-user JWT auth is added later, these policies activate as the
-- database-side enforcement.
--
-- The legacy db/migration.sql attempted to create these policies but
-- the multi-statement DDL pitfall (see insforge-cli skill) caused the
-- CREATE POLICY lines to silently no-op on the first apply. This block
-- drops any partial policies and re-creates them so the migration is
-- idempotent end-to-end.
-- =============================================================================

-- Enable RLS on the user-scoped tables. (webhook_events is system-wide
-- and intentionally left without RLS; the cron worker and edge functions
-- are the only writers.)
alter table public.projects                    enable row level security;
alter table public.tracked_pages               enable row level security;
alter table public.snapshot_jobs               enable row level security;
alter table public.snapshots                   enable row level security;
alter table public.artifacts                   enable row level security;
alter table public.ai_explanations             enable row level security;
alter table public.scan_schedules              enable row level security;
alter table public.notification_subscriptions  enable row level security;
alter table public.notification_outbox         enable row level security;

-- Drop and re-create policies so this block is idempotent. CREATE POLICY
-- has no IF NOT EXISTS, so DO blocks are the only safe pattern.
do $$
begin
  -- projects
  if exists (select 1 from pg_policies where schemaname='public' and tablename='projects' and policyname='projects_owner_all') then
    drop policy projects_owner_all on public.projects;
  end if;
  if exists (select 1 from pg_policies where schemaname='public' and tablename='projects' and policyname='projects_owner_select') then
    drop policy projects_owner_select on public.projects;
  end if;
  -- tracked_pages
  if exists (select 1 from pg_policies where schemaname='public' and tablename='tracked_pages' and policyname='tracked_pages_owner_all') then
    drop policy tracked_pages_owner_all on public.tracked_pages;
  end if;
  -- snapshot_jobs
  if exists (select 1 from pg_policies where schemaname='public' and tablename='snapshot_jobs' and policyname='snapshot_jobs_owner_all') then
    drop policy snapshot_jobs_owner_all on public.snapshot_jobs;
  end if;
  -- snapshots
  if exists (select 1 from pg_policies where schemaname='public' and tablename='snapshots' and policyname='snapshots_owner_all') then
    drop policy snapshots_owner_all on public.snapshots;
  end if;
  -- artifacts
  if exists (select 1 from pg_policies where schemaname='public' and tablename='artifacts' and policyname='artifacts_owner_all') then
    drop policy artifacts_owner_all on public.artifacts;
  end if;
  -- ai_explanations
  if exists (select 1 from pg_policies where schemaname='public' and tablename='ai_explanations' and policyname='ai_explanations_owner_all') then
    drop policy ai_explanations_owner_all on public.ai_explanations;
  end if;
  -- scan_schedules
  if exists (select 1 from pg_policies where schemaname='public' and tablename='scan_schedules' and policyname='scan_schedules_owner_all') then
    drop policy scan_schedules_owner_all on public.scan_schedules;
  end if;
  -- notification_subscriptions
  if exists (select 1 from pg_policies where schemaname='public' and tablename='notification_subscriptions' and policyname='notif_subs_owner_all') then
    drop policy notif_subs_owner_all on public.notification_subscriptions;
  end if;
  -- notification_outbox
  if exists (select 1 from pg_policies where schemaname='public' and tablename='notification_outbox' and policyname='notif_outbox_owner_all') then
    drop policy notif_outbox_owner_all on public.notification_outbox;
  end if;
end
$$;

-- Direct owner policy: projects.owner_id = auth.uid()
create policy projects_owner_all on public.projects
  for all
  using  (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Owner via parent: every downstream table checks the owning project.
-- tracked_pages.project_id → projects.id → projects.owner_id
create policy tracked_pages_owner_all on public.tracked_pages
  for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = tracked_pages.project_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = tracked_pages.project_id
        and p.owner_id = auth.uid()
    )
  );

-- snapshot_jobs.tracked_page_id → tracked_pages.id → project_id → owner_id
create policy snapshot_jobs_owner_all on public.snapshot_jobs
  for all
  using (
    exists (
      select 1
      from public.tracked_pages tp
      join public.projects p on p.id = tp.project_id
      where tp.id = snapshot_jobs.tracked_page_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.tracked_pages tp
      join public.projects p on p.id = tp.project_id
      where tp.id = snapshot_jobs.tracked_page_id
        and p.owner_id = auth.uid()
    )
  );

-- snapshots.tracked_page_id → tracked_pages → project → owner
create policy snapshots_owner_all on public.snapshots
  for all
  using (
    exists (
      select 1
      from public.tracked_pages tp
      join public.projects p on p.id = tp.project_id
      where tp.id = snapshots.tracked_page_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.tracked_pages tp
      join public.projects p on p.id = tp.project_id
      where tp.id = snapshots.tracked_page_id
        and p.owner_id = auth.uid()
    )
  );

-- artifacts.snapshot_id → snapshots → tracked_pages → project → owner
create policy artifacts_owner_all on public.artifacts
  for all
  using (
    exists (
      select 1
      from public.snapshots s
      join public.tracked_pages tp on tp.id = s.tracked_page_id
      join public.projects p on p.id = tp.project_id
      where s.id = artifacts.snapshot_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.snapshots s
      join public.tracked_pages tp on tp.id = s.tracked_page_id
      join public.projects p on p.id = tp.project_id
      where s.id = artifacts.snapshot_id
        and p.owner_id = auth.uid()
    )
  );

-- ai_explanations.snapshot_id → snapshots → tracked_pages → project → owner
create policy ai_explanations_owner_all on public.ai_explanations
  for all
  using (
    exists (
      select 1
      from public.snapshots s
      join public.tracked_pages tp on tp.id = s.tracked_page_id
      join public.projects p on p.id = tp.project_id
      where s.id = ai_explanations.snapshot_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.snapshots s
      join public.tracked_pages tp on tp.id = s.tracked_page_id
      join public.projects p on p.id = tp.project_id
      where s.id = ai_explanations.snapshot_id
        and p.owner_id = auth.uid()
    )
  );

-- scan_schedules.project_id → projects → owner
create policy scan_schedules_owner_all on public.scan_schedules
  for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = scan_schedules.project_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = scan_schedules.project_id
        and p.owner_id = auth.uid()
    )
  );

-- notification_subscriptions.project_id → projects → owner
create policy notif_subs_owner_all on public.notification_subscriptions
  for all
  using (
    exists (
      select 1 from public.projects p
      where p.id = notification_subscriptions.project_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.projects p
      where p.id = notification_subscriptions.project_id
        and p.owner_id = auth.uid()
    )
  );

-- notification_outbox.subscription_id → subscriptions → project → owner
create policy notif_outbox_owner_all on public.notification_outbox
  for all
  using (
    exists (
      select 1
      from public.notification_subscriptions ns
      join public.projects p on p.id = ns.project_id
      where ns.id = notification_outbox.subscription_id
        and p.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.notification_subscriptions ns
      join public.projects p on p.id = ns.project_id
      where ns.id = notification_outbox.subscription_id
        and p.owner_id = auth.uid()
    )
  );
