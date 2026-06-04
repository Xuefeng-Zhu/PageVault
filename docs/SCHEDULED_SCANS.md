# Scheduled Scans

Each PageVault room can be automatically scanned on a recurring schedule. When a scan fires, every watched URL in the room is crawled, the markdown is hashed, and (if the hash changed) the LLM is called to interpret the diff. New snapshots and (if applicable) AI explanations are saved.

The schedule has **two parts that both need to be set up** for a scan to actually fire:

1. **`public.scan_schedules` (database row)** — stores the intent: "this room should run on cron X". Created automatically when a room is created.
2. **InsForge `schedules` (cron entry)** — the actual managed cron that calls the worker. Created automatically when a room is created (with the same cron as the DB row).

If either is missing, the schedule is incomplete. Both are managed together — creating or editing a room or its schedule via the UI / API keeps them in sync.

## Cron presets

| Preset | Cron | Fires |
|---|---|---|
| Off | _(empty)_ | Never — only manual scans |
| Hourly | `0 * * * *` | Every hour on the hour |
| Every 6 hours | `0 */6 * * *` | 00:00, 06:00, 12:00, 18:00 UTC |
| Daily (3am) | `0 3 * * *` | 03:00 UTC every day (default for new rooms) |
| Weekly (Sun midnight) | `0 0 * * 0` | 00:00 UTC every Sunday |

Custom cron expressions are supported via the "Edit" pencil button on the room page. Use standard 5-field cron syntax (`minute hour day-of-month month day-of-week`). InsForge also accepts sub-minute intervals (e.g. `30 seconds`) for tight loops, but a per-room scan is typically hourly or slower.

## How scheduled scans work

When the cron fires, the InsForge schedule calls `POST /api/cron/scan-room/{roomId}` with an `x-cron-secret` header. The endpoint:

1. Verifies the secret against `CRON_SHARED_SECRET` in the server's environment
2. Loads the one room (404 if missing)
3. Looks up the matching enabled `scan_schedules` row. **If none exists** (the user disabled the schedule, or `DELETE /api/rooms/[id]/schedule` removed it), the endpoint returns `{ roomId, wrapperStatus: 'skipped', reason: 'no_enabled_schedule' }` and does NOT run the scan. This means a stale InsForge cron tick that survives a disable is a no-op rather than a wasted crawl/AI run.
4. Calls `runScan(room)` — same pipeline as the manual Run Scan button
5. Updates `last_run_at` on the matching `scan_schedules` row
6. Returns the summary

The per-room `runScan()` walks the room's watched URLs, fetches each (Apify if creds are configured, otherwise direct HTTP fetch), SHA-256 hashes the new markdown, compares to the previous snapshot, and if the hash differs:

- Inserts a `snapshot_jobs` row (status: succeeded)
- Inserts a `snapshot` row
- Calls the LLM to interpret the change
- Inserts an `ai_explanations` row with severity, summary, business interpretation, recommended actions, and confidence
- Enqueues a notification into `notification_outbox` (see `NOTIFICATIONS.md`)

The hash-dedup is a key cost-saver: if the page content didn't change, the LLM is **not** called and the system only writes a new snapshot row. You can scan the same URL every hour all day and the LLM only fires when something actually moves.

## Default schedule for new rooms

When you create a new room via the wizard, the new-room form asks for a frequency. That selection is translated to a cron expression via `lib/validation.ts:frequencyToCronExpression`:

| Frequency in form | Cron | Why |
|---|---|---|
| `daily` (default) | `0 3 * * *` | Low-noise baseline that catches overnight changes |
| `hourly` | `0 * * * *` | For high-cadence pages (pricing, status) |
| `every_6_hours` | `0 */6 * * *` | Balanced |
| `weekly` | `0 0 * * 0` | Slow-moving content (docs, policies) |
| `off` | _(none)_ | Manual scans only |

The new-room POST handler:
1. Creates the `projects` row (the room)
2. Inserts a `scan_schedules` row with the chosen cron and `enabled = true`
3. Registers an InsForge `schedules` entry named `pagevault-room-{roomId}` that calls `/api/cron/scan-room/{roomId}` with the cron secret
4. PATCHes the InsForge schedule ID back into `scan_schedules.insforge_schedule_id` for later update/delete

If the InsForge registration fails (CLI error, missing creds), the room is still created and the DB row exists — the per-room schedule route can retry the InsForge registration when the user next visits the room.

## UI: changing the schedule

Open any room at `/dashboard/rooms/{roomId}`. The "SCHEDULE:" combobox appears right under the header, between the Run Scan button and the Vital Signs section.

- Pick a preset from the dropdown → the room's schedule is updated (DB row + InsForge cron)
- Click the edit pencil → enter a custom 5-field cron expression → Save
- The "Next run" indicator below the dropdown updates on the next page load

A scan fires automatically based on the chosen cadence. To trigger one immediately, click "Run scan" in the room header.

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/api/rooms/{id}/schedule` | Session | Get the room's current schedule (`{ schedule: { roomId, cronExpression, enabled, insforgeScheduleId } }` or `{ schedule: null }`) |
| `POST` | `/api/rooms/{id}/schedule` | Session + owner | Create or update. Body: `{ cronExpression, enabled }`. Validates `CRON_REGEX = /^(\S+\s+){4}\S+$/` (basic 5-field check). InsForge cli is invoked, DB is updated, returned schedule ID is persisted. |
| `DELETE` | `/api/rooms/{id}/schedule` | Session + owner | Removes the DB row AND the InsForge schedule |

All three endpoints enforce room ownership via `authorizeRoom()` (404 if room missing or not the session user's room — does not leak room existence).

The cron worker is at `POST /api/cron/scan-room/{roomId}` and is **only callable with the shared secret**, not by signed-in users. The secret is in `.env.local` as `CRON_SHARED_SECRET` and is sent as the `x-cron-secret` header by InsForge Schedules.

The legacy `POST /api/cron/scan-all` endpoint (scans every enabled room in one tick, parallel cap=3) is still available for manual "scan everything now" use cases and is not used by any InsForge schedule by default.

## Costs

Each scheduled scan consumes:

- **1 Apify Actor run per watched URL** (if `APIFY_API_TOKEN` is set), OR 1 direct `fetch` per URL (free)
- **0–1 LLM calls** — the hash-dedup skips the LLM when the page content hasn't changed
- **0–1 InsForge Storage uploads** — the raw markdown gets written to `pagevault-evidence` for the evidence chain
- **0–1 InsForge Postgres writes** for `snapshot_jobs`, `snapshots`, and `ai_explanations`
- **0–1 webhook deliveries** (if you have any notification subscriptions — see `NOTIFICATIONS.md`)

For 1,000 calls per day with ~2,200 tokens each (haiku class):
- Pure haiku: ~$60/month
- 30% escalated to Sonnet: ~$270/month
- Cascade with Gemini Flash fallback: ~$80/month realistic

Daily 3am is suitable for most use cases (overnight diff catches most business events). Hourly or 6-hourly is for high-cadence pages (live pricing, status dashboards, breaking news).

## Verifying a scan ran

Three places to check:

1. **In the room page UI**: `LAST SCAN` updates to today's date; `HEALTH` stays `Nominal` (or `Pending` until the first successful scan). The "Recent changes" section shows the new diff.
2. **In the database**: `SELECT last_run_at FROM scan_schedules WHERE project_id = '<roomId>'` — updates after each successful run.
3. **In InsForge schedules**: `npx @insforge/cli schedules list` — each room gets a `pagevault-room-{id}` entry. The `Next Run` column shows when the cron will fire next.

## What happens if a scan fails

The cron worker is best-effort per room — a failure in one room doesn't stop the others. For a specific room:

- The `snapshot_jobs` row gets `status = 'failed'` and an error message
- The `last_run_at` doesn't update (so the UI keeps showing the previous successful scan time)
- The error is logged to stderr but not surfaced to the user

Common failure modes:
- **Apify rate limit (429)** — the per-URL try/catch skips that URL and continues with others. The scan completes for the other URLs.
- **LLM rate limit (429)** — caught by the LLM call's retry logic; if all retries fail, the snapshot is saved but `ai_explanations` is empty for that URL. The user sees the snapshot with no interpretation.
- **Network error** — the URL is skipped; other URLs still scan.

## Disabling the schedule

Two ways:

1. **From the UI**: Open the room, pick "Off" from the SCHEDULE dropdown, or click the X button next to it (if you have an option for that — currently the dropdown is the way).
2. **From the API**: `DELETE /api/rooms/{id}/schedule` with the session cookie.

Disabling sets `enabled = false` on the DB row AND deletes the InsForge `schedules` entry. The room is preserved (all its snapshots, changes, URLs remain intact) — only the auto-scan is paused. You can re-enable at any time by selecting a new frequency.
