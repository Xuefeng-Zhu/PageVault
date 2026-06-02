# Scheduled Scans — Design

**Date:** 2026-06-02
**Status:** Approved (pending user review)
**Author:** Hermes (brainstorming + grill-me sessions)
**Project:** PageVault

## Goal

Today, scans are manual — the user clicks "Run Scan" in a room and waits ~10s. This feature adds **scheduled scans**: per-room cron expressions that automatically crawl, diff, and analyze changes on a recurring schedule.

## Decisions (from brainstorming + grill-me)

| Question | Answer |
|---|---|
| Per-room vs global schedule? | **Per-room with a sensible default** (new rooms auto-scheduled, opt-out by disabling) |
| How to run the cron? | **InsForge Schedules** (managed cron) calling our API endpoint |
| Auth on the cron endpoint? | **`x-cron-secret` header** (v1, not deferred) — billing safety |
| Where does the secret live? | **`.env.local`** as `CRON_SHARED_SECRET` |
| Secret rotation? | **Best-effort** — re-edit room schedules after rotating |
| What if one room fails? | **Parallel with cap=3, skip-on-error** per room |
| What if a URL within a room fails? | Already handled by `lib/scan.ts` (try/catch per URL) |

## Architecture

```
┌──────────────────┐   cron    ┌──────────────────┐   HTTP    ┌──────────────────┐
│  InsForge         │──────────▶│  /api/cron/       │──────────▶│  Per-room scan   │
│  Schedules        │  every    │  scan-all         │           │  (existing       │
│  (managed cron)   │  minute   │  (parallel cap=3) │           │   lib/scan.ts)   │
└──────────────────┘           └──────────────────┘           └──────────────────┘
        ▲                                                              │
        │                                                              ▼
        └─────── auto-created/deleted via `npx @insforge/cli schedules` ◀─── UI toggle
```

## Data model

```sql
create table public.scan_schedules (
  id uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects(id) on delete cascade,
  cron_expression text not null,        -- e.g. "0 3 * * *" (5-field cron)
  enabled boolean not null default true,
  insforge_schedule_id text,            -- the InsForge schedule UUID
  last_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create index idx_schedules_enabled on public.scan_schedules(enabled) where enabled = true;
```

RATIONALE:
- One row per project (1:1 with `projects` table)
- `unique (project_id)` constraint enforces one schedule per room
- `insforge_schedule_id` tracks which InsForge cron job to delete on disable
- Partial index on `enabled` because most queries are "get all enabled schedules"

## API routes

### `POST /api/rooms/{roomId}/schedule`

Create or update a room's schedule. (Auth: session)

**Request body:**
```json
{
  "cronExpression": "0 3 * * *",
  "enabled": true
}
```

**Behavior:**
- Validates the cron expression (5-field check)
- UPSERTs the `scan_schedules` row
- If `enabled=true`, calls `npx @insforge/cli schedules create` (or `update` if a schedule already exists) and stores the returned schedule ID
- If `enabled=false` and a schedule exists, calls `npx @insforge/cli schedules delete`
- **Auth on the cron URL:** passes `--headers '{"x-cron-secret": "<CRON_SHARED_SECRET>"}'`

**Response:** `{ schedule, insforgeScheduleId }`

### `DELETE /api/rooms/{roomId}/schedule`

Removes the schedule.

### `POST /api/cron/scan-all` (NEW)

The endpoint that InsForge Schedules calls. **Auth: `x-cron-secret` header matches `process.env.CRON_SHARED_SECRET`.** Returns 401 otherwise.

**Behavior:**
- Query all `scan_schedules WHERE enabled = true`
- For each room, run `runScan` (existing) with concurrency cap=3
- For each room, update `last_run_at = now()`
- Per-room try/catch — failures don't stop the batch

**Response:**
```json
{
  "scanned": 3,
  "results": [
    { "roomId": "...", "snapshotsCaptured": 5, "changesCreated": 2, "status": "completed" },
    { "roomId": "...", "error": "Apify 429", "status": "failed" }
  ]
}
```

## Concurrency implementation

```typescript
// app/api/cron/scan-all/route.ts
import { NextResponse } from 'next/server';
import { requireCronSecret } from '@/lib/cron-auth';

export async function POST(request: NextRequest) {
  if (!requireCronSecret(request)) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const schedules = await dbGetActiveSchedules();
  const queue = [...schedules];
  const results = [];
  const MAX = 3;

  const workers = Array.from({ length: Math.min(MAX, queue.length) }, async () => {
    while (queue.length > 0) {
      const sched = queue.shift();
      if (!sched) break;
      try {
        const room = await getRoom(sched.project_id);
        if (!room) {
          results.push({ roomId: sched.project_id, status: 'skipped', reason: 'room_not_found' });
          continue;
        }
        const summary = await runScan(room);
        await updateScheduleLastRun(sched.id, new Date());
        results.push({ roomId: sched.project_id, ...summary });
      } catch (err) {
        results.push({
          roomId: sched.project_id,
          status: 'failed',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });
  await Promise.all(workers);

  return NextResponse.json({ scanned: results.length, results });
}
```

## Cron auth helper (shared with notifications spec)

```typescript
// lib/cron-auth.ts
import { NextRequest } from 'next/server';

export function requireCronSecret(request: NextRequest): boolean {
  const expected = process.env.CRON_SHARED_SECRET;
  if (!expected) return false;  // No secret configured = no cron access
  const got = request.headers.get('x-cron-secret');
  if (!got || got.length !== expected.length) return false;
  // Constant-time comparison to prevent timing attacks
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) {
    mismatch |= expected.charCodeAt(i) ^ got.charCodeAt(i);
  }
  return mismatch === 0;
}
```

**Failure mode:** if `CRON_SHARED_SECRET` is not set in env, the endpoint rejects all requests (returns 401). This means an unconfigured deployment is safe-by-default — no cron can run until the secret is set.

**The same helper is used by both `/api/cron/scan-all` and `/api/cron/notification-worker` (from the notifications spec).** Single source of truth.

## InsForge schedule lifecycle

When a user enables a schedule via `POST /api/rooms/{roomId}/schedule`:

```bash
npx @insforge/cli schedules create \
  --name "pagevault-room-{roomId}" \
  --cron "{expression}" \
  --url "{APP_URL}/api/cron/scan-all" \
  --method POST \
  --headers '{"x-cron-secret": "<CRON_SHARED_SECRET>"}'
```

The CLI returns a schedule ID. Stored in `scan_schedules.insforge_schedule_id`.

On disable/update:
- Disable: `npx @insforge/cli schedules delete {id}` + set `enabled=false`
- Update cron: `npx @insforge/cli schedules update {id} --cron "new cron"`

**Secret rotation:** if `CRON_SHARED_SECRET` changes, existing InsForge schedules still use the old secret in their `--headers`. The user must re-edit each room's schedule to recreate it. Documented in the spec, not auto-handled in v1.

## Defaults for new rooms

When a new room is created, the API route inserts a `scan_schedules` row with `cron_expression = '0 3 * * *'`, `enabled = true` and creates the InsForge schedule.

## Error handling

| Failure | Behavior |
|---|---|
| InsForge CLI fails (network, auth) | Log error, return 500, don't persist the schedule |
| Cron tick fails (single room) | `try/catch` per room, log to `snapshot_jobs.error_message`, continue |
| Cron tick fails (batch-wide) | 5xx from underlying call is logged by InsForge Schedules; next call's `last_run_at` shows when it last succeeded |
| LLM rate limit | Today's scan already skips that URL and continues; same applies to scheduled runs |
| Apify down | Per-URL try/catch, the URL fails but other URLs continue |

## UI

In `/dashboard/rooms/{roomId}`:

```
┌────────────────────────────────────────────────────┐
│  AWS Infrastructure Monitor                          │
│  ...                                                │
│  [Run Scan]  [Schedule: every 6h ▼] [Edit]         │
│  Last scanned: 6/2/2026 07:39 AM                    │
│  Next scheduled: 6/2/2026 01:39 PM                 │
└────────────────────────────────────────────────────┘
```

**Components:**
- **Schedule dropdown**: `Off` / `Hourly` / `Every 6 hours` / `Daily` / `Weekly` / `Custom (cron)`
- **Edit button**: opens a modal with a cron text input + validation + "Save" button
- **Next run display**: computed from the cron expression; shown only when enabled

Cron expression presets (UI):
- `0 * * * *` — every hour
- `0 */6 * * *` — every 6 hours
- `0 3 * * *` — daily at 3am
- `0 0 * * 0` — weekly on Sunday at midnight

## What I'm NOT doing in v1

- **Per-URL schedules** (all URLs in a room scan together) — deferred
- **Distributed locking** for overlapping ticks — deferred (InsForge Schedules doesn't fire overlapping ticks by default; if the worker takes longer than the cron interval, InsForge skips the next tick)
- **Backoff / retries on LLM rate limits** — deferred
- **Auth secret rotation automation** — deferred (user re-edits room schedules)
- **Pause when no changes for N days** — deferred
- **Slack/email notifications on change** — out of scope (separate notifications feature)

## Files to add/modify

- `db/migrations/2026-06-02-scan-schedules.sql` — new table
- `app/api/rooms/[roomId]/schedule/route.ts` — create/update/delete
- `app/api/cron/scan-all/route.ts` — the cron tick endpoint
- `lib/cron-auth.ts` — shared `requireCronSecret` helper (also used by notifications)
- `lib/insforge.ts` — add `getActiveSchedules`, `updateScheduleLastRun`, `createRoomWithDefaults`
- `app/api/rooms/route.ts` — wire new rooms to create a default schedule
- `app/dashboard/rooms/[roomId]/page.tsx` — add schedule UI section
- `components/dashboard/SchedulePicker.tsx` — new component for the dropdown

## Estimated scope

- 1 SQL migration (~30 lines)
- 2 new API routes (~100 lines each)
- 1 new shared lib module `lib/cron-auth.ts` (~30 lines, also used by notifications)
- 1 new UI component (~80 lines)
- Modifications to 2 existing files (~50 lines total)
- ~360 LOC of new code

## Acceptance criteria

1. A user can toggle "Schedule: every 6 hours" in any room
2. After 6 hours, the room shows "Last scanned: <recent>" without any user action
3. Creating a new room auto-schedules it for daily 3am
4. Disabling a room's schedule removes the InsForge schedule
5. If one room's scan fails, other rooms still scan
6. The UI surfaces scan failures via `last_run_at` not updating
7. `npx tsc --noEmit` passes
8. The dev server's manual "Run Scan" still works (no regression)
9. `POST /api/cron/scan-all` without a valid `x-cron-secret` returns 401
10. `POST /api/cron/scan-all` with a valid secret scans all enabled rooms and returns the results
