-- db/migrations/2026-06-04-shared-changes.sql
-- Adds the shared_changes table for US-013 (public read-only share link).
--
-- A "shared change" is a token-bearing link to a single change (an
-- ai_explanations row). The link can be created by the change's owner
-- and resolved by anyone with the token, without authenticating. The
-- RLS policy below restricts anon SELECT to non-revoked, non-expired
-- rows. All writes (INSERT / UPDATE / DELETE) are service-role-only
-- and happen from the Next.js API route, never from anon or
-- authenticated client code.
--
-- The changeId FK targets ai_explanations.id, NOT a hypothetical
-- public.changes table — the rest of the codebase calls an AI
-- explanation row a "change" (see app/dashboard/changes/[changeId]
-- and lib/insforge.ts:getChangeForUser).
--
-- Apply order: AFTER 2026-06-02-notification-advisory-lock.sql.
-- Append this file to the migration list in docs/DATA_MODEL.md
-- once the migration has run in the target environment.

create table if not exists public.shared_changes (
  id uuid primary key default gen_random_uuid(),
  change_id uuid not null references public.ai_explanations(id) on delete cascade,
  token text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id),
  expires_at timestamptz,
  revoked_at timestamptz
);

create index if not exists idx_shared_changes_token
  on public.shared_changes(token);
create index if not exists idx_shared_changes_change_id
  on public.shared_changes(change_id);

alter table public.shared_changes enable row level security;

-- Anon SELECT: only valid (non-revoked, non-expired) rows are visible.
-- No anon INSERT/UPDATE/DELETE — the API route uses the service role
-- to create and revoke, so a malicious anon caller cannot mint a token
-- or revoke someone else's link.
create policy shared_changes_select_anon on public.shared_changes
  for select to anon
  using (
    revoked_at is null
    and (expires_at is null or expires_at > now())
  );
