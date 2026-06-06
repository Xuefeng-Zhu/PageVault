# PageVault — AI Memory Layer for the Web

PageVault is a Next.js (App Router) + TypeScript full-stack application that monitors public web pages using Apify, stores every snapshot and report as evidence in Box, persists metadata in an Insforge Postgres backend, and uses an OpenAI-compatible LLM to explain what changed and why it matters.

## Architecture

```
Browser → Next.js App Router → API Routes → Library Layer
                                              ├── lib/insforge  (Postgres via @insforge/sdk)
                                              ├── lib/apify     (Web crawl, mock fallback)
                                              ├── lib/box       (Evidence storage, mock fallback)
                                              ├── lib/ai        (LLM analysis, mock fallback)
                                              ├── lib/diff      (Content hashing)
                                              ├── lib/scan      (Scan orchestration)
                                              ├── lib/seed      (Demo seed)
                                              ├── lib/env       (Credential detection)
                                              └── lib/validation (Input validation)
```

## Tech Stack

| Concern | Choice |
|---------|--------|
| Framework | Next.js 14 App Router |
| Language | TypeScript |
| UI | React + Tailwind CSS 3.4 (pinned) |
| Database | Insforge Postgres via `@insforge/sdk` |
| Web crawl | Apify API |
| Evidence storage | Box API |
| Change analysis | OpenAI-compatible Chat Completions API |
| Testing | Vitest + fast-check |
| Hashing | Node `crypto` (SHA-256) |

## Key Design Patterns

### Credential-Driven Mock Fallback

Every integration library operates in two modes:
- **Real mode**: credentials present → real API call
- **Mock mode**: credentials absent → deterministic mock (never throws)

Box is the deliberate exception: when Box credentials are present but a Box operation fails, the error propagates as a `BoxSystemError` rather than falling back to mock. This ensures evidence durability is guaranteed when Box is configured.

### Demo Mode (mock fallbacks)

The application runs with deterministic mock data for each non-auth integration when its credentials are absent:
- Missing Apify credentials → deterministic mock crawl results
- Missing Box credentials → mock folder/file identifiers and URLs
- Missing AI credentials → deterministic mock analysis
- Missing Insforge credentials → `InsforgeUnavailableError` with setup instructions

These fallbacks exist for *data* integrations only. **Authentication is NOT in this list** — the auth path does NOT have a credential-less fallback. See [Authentication](#authentication) below.

## Environment Variables

See `.env.example` for all configuration options. Missing *data-integration* credentials enable the corresponding mock fallback; auth does not fall back to a default.

## Setup

```bash
npm install
npm run dev
```

## Demo Data

Without any data-integration credentials, the application runs with mock data so the UI is browsable. Use "Load Demo" on the home page to seed a complete demonstration room with before/after data and change analyses.

## Authentication

Authentication is handled by NextAuth.js with the InsForge credentials provider (`lib/auth.ts`). There is no credential-less fallback for auth. Production posture:

- **`NEXTAUTH_SECRET` is required.** Module load throws if it is unset in `NODE_ENV=production` (silent random would invalidate every JWT on restart). The only way to skip this is the dev-only opt-in `INSFORGE_DEV_INSECURE_SECRET=*** AND `NODE_ENV=development` — see `lib/auth.ts:resolveNextAuthSecret()` and `lib/auth.test.ts`.
- **No hardcoded demo creds.** Historically `lib/auth.ts` contained three branches that silently accepted `admin@example.com / admin123` and `admin@example.com / demo123` whenever InsForge was misconfigured, returned non-2xx, or returned non-JSON. That was CRITICAL-2 (docs/qa-bug-hunt.md): the `demo123` path authenticated as the canonical super-user (`00000000-0000-0000-0000-000000000001`) who owned every legacy project. All three branches have been removed.
- **Dev opt-in, if you really need it locally.** If you need to authenticate without a real InsForge backend, set BOTH `NODE_ENV=development` AND `INSFORGE_DEV_DEMO_AUTH=*** in `.env.local`. Only `admin@example.com / demo123` is accepted (the `admin123` variant is dead). Every successful demo auth logs a `console.warn` so the path is impossible to miss in dev server output. **Do not deploy with these set** — a stray `1` in production is a P0 auth bypass.
- **Login page does not advertise the demo creds.** `app/login/page.tsx` no longer renders a "Demo filing" hint card. The card is gone entirely (it was misleading: the server only accepts the creds when the opt-in is set, and it never accepted `admin123`).

## Project Structure

```
pagevault/
├── app/                      # Next.js App Router pages and API routes
│   ├── api/                  # API route handlers
│   ├── rooms/               # Room pages
│   ├── changes/             # Change detail page
│   └── page.tsx             # Home page
├── components/              # React components
│   ├── layout/              # Header, TaglineBanner, SetupBanner
│   ├── rooms/               # RoomCard, CreateRoomForm, WatchedUrlList, ScanStatus
│   ├── changes/             # SeverityBadge, ChangeCard, ChangeTimeline, EvidenceTable, RecommendedActions
│   └── ui/                  # Button, Modal, Badge, Card, EmptyState
├── lib/                     # Integration and logic libraries
├── types/                   # Shared TypeScript types
├── db/                      # Database migration SQL
└── scripts/                 # Standalone seed runner
```

<!-- INSFORGE:START -->
## InsForge backend

This project uses [InsForge](https://insforge.dev): an all-in-one, open-source Postgres-based backend (BaaS) that gives this app a database, authentication, file storage, edge functions, realtime, an AI model gateway, and payments through one platform.

- **Project:** **PageVault** (API base `https://wga6k9at.us-east.insforge.app`)
- **Skills:** these InsForge skills are installed for supported coding agents. Reach for them before implementing any InsForge feature instead of guessing the API:
  - `insforge`: app code with the `@insforge/sdk` client (database CRUD, auth, storage, edge functions, realtime, AI, email, and Stripe payments).
  - `insforge-cli`: backend and infrastructure via the `insforge` CLI (projects, SQL, migrations, RLS policies, storage buckets, functions, secrets, payment setup, schedules, deploys).
  - `insforge-debug`: diagnosing failures (SDK/HTTP errors, RLS denials, auth and OAuth issues) and running security or performance audits.
  - `insforge-integrations`: wiring external auth providers (Clerk, Auth0, WorkOS, Better Auth, etc.) for JWT-based RLS, or the OKX x402 payment facilitator.
  - `find-skills`: discovering additional skills on demand.
- **Credentials:** app code reads keys from `.env.local`; the CLI reads `.insforge/project.json`. Never hardcode or commit keys.

Key patterns:

- Database inserts take an array: `insert([{ ... }])`.
- Reference users with `auth.users(id)`; use `auth.uid()` in RLS policies.
- For storage uploads, persist both the returned `url` and `key`.
<!-- INSFORGE:END -->
