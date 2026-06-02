# Scheduled Scans — Design

**Date:** 2026-06-02
**Status:** Approved (pending user review of this spec)
**Author:** Hermes (brainstorming session)
**Project:** PageVault

## Goal

Today, scans are manual — the user clicks "Run Scan" in a room and waits ~10s. This feature adds **scheduled scans**: per-room cron expressions that automatically crawl, diff, and analyze changes on a recurring schedule.

## Decisions (from brainstorming)

| Question | Answer |
|---|---|
| Per-room vs global schedule? | **Per-room with a sensible default** (new rooms auto-scheduled, opt-out by disabling) |
| How to run the cron? | **InsForge Schedules** (managed cron, calls our API endpoint) |
| What if one room fails? | **Parallel with cap=3, skip-on-error** — failures logged, others continue |
| What if a URL within a room fails? | Already handled by `lib/scan.ts` (try/catch per URL) |

## Architecture

```
┌──────────────────┐   cron    ┌──────────────────┐   HTTP    ┌──────────────────┐
│  InsForge         │──────────▶│  /api/cron/       │──────────▶│  Per-room scan   │
│  Schedules        │           │  scan-all         │           │  (existing       │
│  (managed cron)   │           │  (parallel cap=3) │           │   lib/scan.ts)   │
└──────────────────┘           └──────────────────┘           └──────────────────┘
        ▲                                                              │
        │                                                              ▼
        └────────── auto-created/deleted via `npx @insforge/cli schedules` ←─── UI toggle
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
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_id)
);

create index idx_schedules_enabled on public.scan_schedules(enabled) where enabled = true;
```

RATIONALE:
- One row per project (1:1 with `projects` table)
- The `unique (project_id)` constraint enforces one schedule per room
- `insforge_schedule_id` tracks which InsForge cron job to delete on disable
- Partial index on `enabled` because most queries are "get all enabled schedules"

## API routes

### `POST /api/rooms/{roomId}/schedule`

Create or update a room's schedule.

**Request body:**
```json
{
  "cronExpression": "0 3 * * *",
  "enabled": true
}
```

**Behavior:**
- Validates the cron expression (basic 5-field check; full validation by InsForge when the schedule is created)
- UPSERTs the `scan_schedules` row
- If `enabled=true`, calls `npx @insforge/cli schedules create` (or `update` if a schedule already exists) and stores the returned schedule ID
- If `enabled=false` and a schedule exists, calls `npx @insforge/cli schedules delete` and nulls out the field

**Response:** `{ schedule: ScanSchedule, insforgeScheduleId: string | null }`

### `DELETE /api/rooms/{roomId}/schedule`

Removes the schedule. Same as `POST` with `enabled=false` + row deletion.

### `POST /api/cron/scan-all`

The endpoint that InsForge Schedules calls. **No auth required** for this endpoint (cron is internal; protected by being on a non-public URL — or add a shared secret header).

**Behavior:**
- Query all `scan_schedules WHERE enabled = true`
- For each room, run `runScan` (existing) with concurrency cap=3
- For each room, update `last_run_at = now()` and `next_run_at = computeNextCron(cron_expression)`
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

## Concurrency implementation

```typescript
// app/api/cron/scan-all/route.ts
import { NextResponse } from 'next/server';

const MAX_CONCURRENT = 3;

export async function POST(request: NextRequest) {
  // Optional: verify shared secret from header
  const auth = request.headers.get('x-cron-secret');
  if (process.env.CRON_SHARED_SECRET && auth !== process.env.CRON_SHARED_SECRET) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const schedules = await dbGetActiveSchedules();
  const queue = [...schedules];
  const results = [];

  const workers = Array.from({ length: Math.min(MAX_CONCURRENT, queue.length) }, async () => {
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

## InsForge schedule lifecycle

When a user enables a schedule via `POST /api/rooms/{roomId}/schedule`:

```bash
npx @insforge/cli schedules create \
  --name "pagevault-room-{roomId}" \
  --cron "0 3 * * *" \
  --url "{APP_URL}/api/cron/scan-all" \
  --method POST \
  --headers '{"x-cron-secret": "{CRON_SHARED_SECRET}"}'
```

The CLI returns a schedule ID. Stored in `scan_schedules.insforge_schedule_id`.

On disable/update:
- Disable: `npx @insforge/cli schedules delete {id}` + set `enabled=false`
- Update cron: `npx @insforge/cli schedules update {id} --cron "new cron"`

## Defaults for new rooms

When a new room is created (via `POST /api/rooms`), the API route will:
1. Insert a `scan_schedules` row with `cron_expression = '0 3 * * *'`, `enabled = true`
2. Create the InsForge schedule

The UI will show a small "Scheduled daily at 3:00 AM UTC" hint with a link to edit/disable.

## Error handling

| Failure | Behavior |
|---|---|
| InsForge CLI fails (network, auth) | Log error, return 500, don't persist the schedule |
| Cron tick fails (single room) | `try/catch` per room, log to `snapshot_jobs.error_message`, continue |
| Cron tick fails (batch-wide) | The 5xx from the underlying call is logged by InsForge Schedules; the UI shows "Last run failed" via the next call's `last_run_at` timestamp |
| LLM rate limit | Today's scan already skips that URL and continues; same applies to scheduled runs |
| Apify down | Same — per-URL try/catch, the URL fails but other URLs continue |

## Authentication

The cron endpoint accepts an `x-cron-secret` header that InsForge schedules sends. We generate a random secret at deploy time and store it in InsForge secrets. The schedule's `--headers` arg sends the secret on every invocation.

**Alternative (v1 simpler):** skip the secret for now since the URL is non-public. Add secret in v2 when we put it behind a real domain.

## Edge cases

- **Clock skew**: InsForge runs the schedule at the cron time in UTC. The UI shows next-run in the user's local timezone.
- **Concurrent ticks**: If a tick takes longer than the cron interval, InsForge may skip the next tick. This is fine — the design doesn't require strict adherence.
- **Many rooms with different cadences**: Each gets its own InsForge schedule (one per row in `scan_schedules`).
- **Room disabled but schedule exists**: `enabled=false` filter on `scan-all` query. Don't delete the InsForge schedule so the user can re-enable.

## Migration path

1. Create the `scan_schedules` table (via `npx @insforge/cli db migrate` or a new SQL file in `db/migrations/`)
2. Add the new API routes
3. Add the UI section
4. Add the InsForge schedule defaults to new-room creation
5. Test by manually invoking `npx @insforge/cli schedules create` for one room and verifying the endpoint gets hit

## What I'm NOT doing in v1

- **Per-URL schedules** (all URLs in a room scan together) — deferred
- **Distributed locking** (if two cron ticks overlap, both run) — deferred to v2 with Postgres advisory locks
- **Backoff / retries on LLM rate limits** — deferred
- **Auth secret rotation** — deferred
- **Pause when no changes for N days** — deferred
- **Slack/email notifications on change** — out of scope (different feature)

## Files to add/modify

- `db/migrations/2026-06-02_scan_schedules.sql` — new table
- `app/api/rooms/[roomId]/schedule/route.ts` — create/update/delete
- `app/api/cron/scan-all/route.ts` — the cron tick endpoint
- `lib/insforge.ts` — add `getActiveSchedules`, `updateScheduleLastRun`, `createRoomWithDefaults`
- `app/api/rooms/route.ts` — wire new rooms to create a default schedule
- `app/dashboard/rooms/[roomId]/page.tsx` — add schedule UI section
- `components/dashboard/SchedulePicker.tsx` — new component for the dropdown
- `scripts/seed_test_schedule.py` — one-off test script to verify the round-trip
- `docs/SCHEDULED_SCANS.md` — user-facing docs

## Estimated scope

- 1 SQL migration (~30 lines)
- 2 new API routes (~100 lines each)
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
