# Development Guide

> **Last updated:** 2026-06-02 · view this against commit `3b0f2ca` for accuracy.
> **Prerequisite reading:** [README.md](../README.md),
> [ENVIRONMENT.md](ENVIRONMENT.md).

## Local setup, end to end

```bash
# 1. Clone
git clone <your-fork-url> pagevault
cd pagevault

# 2. Install
npm install
# or: pnpm install / yarn

# 3. Set up env
cp .env.example .env.local
# Edit .env.local — see ENVIRONMENT.md for the full reference.
# Minimum: INSFORGE_API_URL, INSFORGE_ANON_KEY, NEXTAUTH_SECRET.
# Generate a dev NEXTAUTH_SECRET with: openssl rand -base64 32

# 4. Run migrations
# The project does not have a migration runner. Open the InsForge SQL
# editor for your project and run, in order:
#   - db/migration.sql
#   - db/migrations/2026-06-02-scan-schedules.sql
#   - db/migrations/2026-06-02-notification-tables.sql
#   - db/migrations/2026-06-02-notification-advisory-lock.sql

# 5. Run
npm run dev
# → http://localhost:3000

# 6. Sign in
# The login page (visible at /login) accepts demo creds:
#   admin@example.com / demo123
# These only work when INSFORGE_* is unset OR when the real InsForge
# /api/auth/sessions endpoint is unreachable. See lib/auth.ts.
```

## Day-to-day commands

| Command | What it does |
|---|---|
| `npm run dev` | Start the Next.js dev server (port 3000) |
| `npm run build` | Production build |
| `npm run start` | Run the production build (after `build`) |
| `npm run typecheck` | `tsc --noEmit` (no JS emit) |
| `npm run lint` | `next lint` |
| `npm test` | Run all Vitest tests once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run test:coverage` | Run tests with v8 coverage |

## Project structure (recap)

See [ARCHITECTURE.md](ARCHITECTURE.md) for the system view. The
folder-by-folder map:

```
app/                  Next.js App Router pages + API routes
  api/                Route handlers (every one needs an auth check)
  dashboard/          The authenticated app (server + client components)
  login/              The login page
  page.tsx            The marketing landing page
  layout.tsx          Root layout (ToastProvider, SessionProvider)
  globals.css         Design system tokens + components

components/           React components
  dashboard/          Domain components (used in /dashboard/*)
  providers/          React context providers
  ui/                 Primitives

lib/                  Server-side library code (non-React)
  auth.ts             NextAuth config
  apiAuth.ts          requireSession() helper
  cron-auth.ts        requireCronSecret() helper
  env.ts              InsForge client + credential detectors
  insforge.ts         All DB operations
  scan.ts             Scan orchestration
  diff.ts             Hash + simple-diff
  validation.ts       Input validation
  notifications.ts    Outbox dispatcher
  box.ts              InsForge Storage helpers
  ai.ts               (legacy, unused)
  apify.ts            (legacy, unused)

db/                   SQL migrations
  migration.sql       The 7 base tables
  migrations/         Per-feature migrations

types/index.ts        Shared TypeScript types

scripts/              One-off scripts (Python + TS, no runner)
functions/            InsForge Edge Functions (not currently deployed)
docs/                 This directory
```

## Conventions

### Commit messages

Conventional Commits. The scope is usually a layer: `feat(ui):`,
`fix(notif):`, `refactor:`, `fix(security):`, `chore:`.

Subject ≤ 72 chars, imperative, lowercase, no trailing period.
Body wraps at ~72 cols and explains **why**, not **what**.

### File names

- React components: `PascalCase.tsx` matching the export name.
- Lib helpers: `camelCase.ts` matching the primary export.
- Migrations: `YYYY-MM-DD-kebab-case.sql`.
- Docs: `UPPERCASE-WITH-HYPHENS.md`.

### Imports

- Use the `@/` alias for everything in `app/`, `components/`, `lib/`,
  `types/`. Never use relative paths that go up more than one level
  (`../../foo`).
- Order: external packages first (alphabetical), then `@/` imports
  (alphabetical), then relative imports. A blank line between groups.

### Server vs. client

- Default to server components. Add `'use client'` only when you need
  hooks, browser APIs, or event handlers.
- Page-level data fetching: prefer server components calling
  `lib/insforge.ts` directly when there's no need to refetch.
- Anything interactive (forms, buttons, dialogs) goes in
  `components/` as a client component.

### Styling

- Tailwind 3.4 utility classes for layout and spacing.
- CSS custom properties (`--ink`, `--paper`, `--signal`, `--ember`)
  for the design tokens — defined in `app/globals.css`.
- Component-level CSS lives in `app/globals.css` under a labelled
  section (e.g. `/* === AI brief === */`). Do not create
  per-component CSS files.
- For new components, prefer composing the existing primitives
  (`<Card>`, `<Badge>`, `<Button>`, `<SectionHeader>`) over writing
  new markup.

### TypeScript

- `strict: true` is on. Don't add `any` — use `unknown` and narrow.
- For domain entities, the canonical type lives in
  [`types/index.ts`](../types/index.ts). Don't redefine locally.
- For component props, define a `interface FooProps` above the
  component. Don't use inline `React.FC<>`.

## Common tasks

### Add a new API route

1. Create `app/api/<path>/route.ts` with the appropriate HTTP method
   exports.
2. **Always** call `requireSession()` at the top of the handler (for
   user routes) or `requireCronSecret(request)` (for cron routes).
3. Use the `ErrorResponse` envelope for errors (see
   [API.md](API.md)).
4. Update [API.md](API.md) with the new route.
5. If the route returns a new shape, add a type to
   `types/index.ts`.

### Add a new database column

1. Create a new file `db/migrations/YYYY-MM-DD-<name>.sql` with
   `ALTER TABLE ... ADD COLUMN ...`.
2. Apply it manually in the InsForge SQL editor.
3. Update the type in `types/index.ts`.
4. Update the converter function in `lib/insforge.ts` (e.g.
   `toMemoryRoom`) to read the new column.
5. Update [DATA_MODEL.md](DATA_MODEL.md).

### Add a new component

1. Decide which directory: `components/dashboard/` for domain
   components, `components/ui/` for primitives.
2. Define a `FooProps` interface.
3. Use existing primitives wherever possible.
4. Update [COMPONENTS.md](COMPONENTS.md) with the component's props
   and a usage example.

### Add a new env var

1. Add it to `.env.example` with a comment explaining its purpose.
2. Read it in `lib/env.ts` if it needs a credential detector.
3. Document it in [ENVIRONMENT.md](ENVIRONMENT.md).
4. If it's a secret, add it to [SECURITY.md](../SECURITY.md).

## Debugging

### "Why is my change not showing up?"

1. Check the dev server is running and your browser is hitting
   `http://localhost:3000` (not a tunnel).
2. Open the browser devtools, find the failing request, check the
   response. 401 = session expired, 404 = wrong id, 500 = server
   error.
3. For server errors, check the terminal where `npm run dev` is
   running. The Next.js dev server logs include the full stack.
4. If the call hits InsForge, the SQL is in the PostgREST error.
   `PGRST116` = "no rows", `PGRST202` = "function not in schema
   cache" (see [DATA_MODEL.md §RPC](DATA_MODEL.md)).

### "Why is the LLM call failing?"

1. Check `OPENAI_API_KEY` / `OPENROUTER_API_KEY` is set in
   `.env.local`.
2. Hit the LLM directly to verify the key:
   ```bash
   curl -sS https://openrouter.ai/api/v1/chat/completions \
     -H "Authorization: Bearer $OPENROUTER_API_KEY" \
     -H "Content-Type: application/json" \
     -d '{"model":"anthropic/claude-3.5-haiku","messages":[{"role":"user","content":"hi"}]}' | head -50
   ```
3. Check the error string in the scan summary response — the LLM
   call wraps API errors in `LLM API error: <status> <statusText> —
   <body>`. The body is truncated to 200 chars but it's almost always
   enough to diagnose.

### "Why is the cron worker not draining?"

1. Check `CRON_SHARED_SECRET` matches the secret configured on the
   InsForge Schedule.
2. Manually invoke the worker:
   ```bash
   curl -i -X POST http://localhost:3000/api/cron/notification-worker \
     -H "x-cron-secret: $CRON_SHARED_SECRET"
   ```
3. Check the response: `{processed: 0, succeeded: 0, failed: 0}` is
   normal if the outbox is empty. `0/0/0` with no error + no progress
   usually means the advisory lock is held by another worker — wait
   or restart.
4. For an outbox row stuck in `pending` for too long, check
   `last_error` and `attempts`:
   ```bash
   psql ... -c "SELECT id, attempts, last_error, next_attempt_at FROM notification_outbox WHERE status = 'pending';"
   ```

### "Why is the typecheck failing?"

- Run `npx tsc --noEmit` and read the errors. They're usually
  about: a missing import, a shape change in a returned type, or
  `as any` in a file that was recently touched.
- If the error is in `tsconfig.tsbuildinfo`, delete it and re-run
  (`rm tsconfig.tsbuildinfo && npx tsc --noEmit`).

## What's currently in flight

These are the known in-progress areas on the active branches. Check
`git log --oneline -20` before starting work in any of them.

- **`security/p0-fixes`** (current branch in the example
  environment): addresses findings S-1 through S-3 in the audit
  (`docs/audits/2026-06-02-codebase-audit.md`). The
  `lib/apiAuth.ts:requireSession()` helper exists but isn't called in
  every mutating route yet — that wiring is in progress.
- **Dead-code removal:** `lib/apify.ts` and `lib/ai.ts` are
  unreferenced. They should be deleted but the change is non-urgent.
- **CI:** the audit flagged "no CI" as HIGH. There is no GitHub
  Actions workflow. Adding one is on the roadmap.

## Getting help

1. Read the audit (`docs/audits/2026-06-02-codebase-audit.md`) for
   known issues.
2. Read the implementation plan for the feature you're touching
   (`docs/plans/2026-06-02-scheduled-scans-and-notifications.md`).
3. Grep for similar code in the repo before adding a new pattern.
4. When in doubt, mirror the existing code: if the room detail page
   already calls `requireSession()` in its `/api/rooms/[id]` route,
   do the same in any new route you add.

## Style / lint debt

- `npm run lint` (i.e. `next lint`) is configured but the audit noted
  it's not enforced. Run it before committing if you've touched
  TSX/TS files.
- `npm test` will exit with code 1 because there are no `.test.ts`
  files. The harness is configured (`vitest.config.ts`) and the
  `@testing-library/react` dev dep is installed, but no tests exist.
  Adding tests for the diff engine (`lib/diff.ts`) is the lowest-cost
  first step.
