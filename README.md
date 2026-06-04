# PageVault — AI Memory Layer for the Web

> **Apify captures the web. Box stores the memory. AI explains the change.**

PageVault is a Next.js (App Router) + TypeScript full-stack application that monitors public web pages using Apify, stores every snapshot and report as evidence in Box, persists metadata in an Insforge Postgres backend, and uses an OpenAI-compatible LLM to explain what changed and why it matters.

## Documentation

The full developer reference lives in [`docs/00-INDEX.md`](docs/00-INDEX.md).
Start with the index, then read in this order for the fastest onboarding:

1. **[Architecture](docs/ARCHITECTURE.md)** — how the five planes (browser,
   InsForge, Apify, LLM, Storage, Schedules) fit together
2. **[Data model](docs/DATA_MODEL.md)** — every table, every column, ER
   diagram
3. **[Environment](docs/ENVIRONMENT.md)** — every env var, what enables
   which mode
4. **[API reference](docs/API.md)** — every route, every auth check,
   every error code
5. **[Component reference](docs/COMPONENTS.md)** — every component,
   props, when to use it
6. **[Development](docs/DEVELOPMENT.md)** — local setup, common tasks,
   debugging
7. **[Deployment](docs/DEPLOYMENT.md)** — Vercel + InsForge Schedules
8. **[Operations](docs/OPERATIONS.md)** — incident response
9. **[Security](SECURITY.md)** — reporting vulns, threat model

Additional reference material in `docs/`: the LLM model-selection
research ([`docs/LLM_MODEL_RESEARCH.md`](docs/LLM_MODEL_RESEARCH.md)),
the codebase audit
([`docs/audits/2026-06-02-codebase-audit.md`](docs/audits/2026-06-02-codebase-audit.md)),
and the implementation plans in `docs/plans/`. The original
architectural spec is at the repo root:
[`SYSTEM_DESIGN.md`](SYSTEM_DESIGN.md).

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

### Demo Mode

The application runs fully without any third-party credentials:

- Missing Apify credentials → deterministic mock crawl results
- Missing Box credentials → mock folder/file identifiers and URLs
- Missing AI credentials → deterministic mock analysis
- Missing Insforge credentials → `InsforgeUnavailableError` with setup instructions

## Environment Variables

Copy `.env.example` to `.env.local` and configure:

```bash
# Insforge (Postgres backend) — required for persistence
INSFORGE_API_URL=https://your-insforge-instance.com
INSFORGE_SERVICE_ROLE_KEY=your-service-role-key
# OR
INSFORGE_ANON_KEY=your-anon-key

# Apify (web crawling) — optional, enables real web scraping
APIFY_API_TOKEN=your-apify-token
APIFY_ACTOR_ID=your-actor-id

# Box (evidence storage) — optional, enables durable storage
BOX_DEVELOPER_TOKEN=your-box-token
# OR
BOX_CLIENT_ID=your-box-client-id
BOX_CLIENT_SECRET=your-box-client-secret

# OpenAI-compatible LLM (change analysis) — optional, enables AI analysis
OPENAI_API_KEY=your-api-key
OPENAI_BASE_URL=https://openai.com/v1  # optional, defaults to OpenAI
OPENAI_MODEL=gpt-4o-mini  # optional

# Box root folder ID (optional, defaults to root "0")
BOX_ROOT_FOLDER_ID=0
```

Without any credentials, the application runs in **Demo Mode** with in-memory storage and mock integrations.

## Quick Start

The fastest way to bootstrap a fresh clone is the one-command setup
script:

```bash
./scripts/dev-setup.sh
```

It checks your Node version (>= 20), copies `.env.example` to
`.env.local` (and auto-enables the `INSFORGE_DEV_*` opt-ins on a fresh
clone so the login page accepts the demo creds out of the box), runs
`npm install`, and prints the next steps. It is idempotent: re-running
it is safe, it will not clobber an existing `.env.local`, and it skips
`npm install` when `node_modules/` is already present. Pass
`--reinstall` to force a clean install or `--reset-env` to overwrite
`.env.local` from `.env.example`.

Prefer the manual path? The standard npm flow works too:

```bash
# Install dependencies
npm install

# Copy the env template and fill in your values
cp .env.example .env.local
$EDITOR .env.local

# Run in development mode (http://localhost:3000)
npm run dev

# Type check
npm run typecheck

# Run tests
npm run test

# Build for production
npm run build

# Start production server
npm start
```

For the full developer workflow (debugging, conventions, common tasks,
and the list of every env var) see
[`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md) and
[`docs/ENVIRONMENT.md`](docs/ENVIRONMENT.md).

### GitHub Codespaces / VS Code Dev Containers

A `.devcontainer/devcontainer.json` is included for one-click Codespaces
and VS Code "Reopen in Container" workflows. Open the repo in
Codespaces (or run "Reopen in Container" in VS Code) and the dev
environment is provisioned automatically: Node 20 base image, the
setup script runs on create, typecheck runs as a smoke test, and port
3000 is forwarded and labelled.

## Demo Mode

Demo mode is removed. To populate the database with realistic seed data:

```bash
python3 scripts/seed_via_api.py
```

This uses the InsForge service role key to write projects, tracked pages, snapshot jobs, snapshots, and AI explanations directly to the database. Navigate to `http://localhost:3000` to see the data.

```bash
npx ts-node scripts/seed-demo.ts
```

### Demo Content

The demo seeds a complete **DemoCo** competitor room with:

- 5 watched URLs (Homepage, Pricing, Security Docs, Changelog, Careers)
- Before/after snapshot pairs showing:
  - Pricing changed from "Unlimited projects" to "10 projects" on Starter
  - SSO moved from Starter to Enterprise tier
  - API access moved from Starter to Pro tier
  - Homepage positioning shifted from "small teams" to "modern enterprises"
  - New "Enterprise Account Executive" job posting
- Change analyses with severity ratings and recommended actions

## API Routes

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/rooms` | List all rooms with stats |
| POST | `/api/rooms` | Create a new room |
| GET | `/api/rooms/[roomId]` | Get room detail with URLs, scan, changes |
| POST | `/api/rooms/[roomId]/urls` | Add watched URLs to a room |
| POST | `/api/rooms/[roomId]/scan` | Run a scan on a room |
| GET | `/api/rooms/[roomId]/changes` | Get changes timeline for a room |
| GET | `/api/changes/[changeId]` | Get change analysis detail |
| POST | `/api/demo/seed` | Seed demo data |

## Project Structure

```
pagevault/
├── app/                      # Next.js App Router pages and API routes
│   ├── api/                  # API route handlers
│   │   ├── rooms/            # Rooms CRUD + URLs + scan + changes
│   │   ├── changes/          # Change detail
│   │   └── demo/seed/        # Demo seed
│   ├── rooms/                # Room pages (dashboard, detail, create)
│   ├── changes/              # Change detail page
│   └── page.tsx             # Home page
├── components/              # React components
│   ├── layout/              # Header, TaglineBanner, SetupBanner
│   ├── rooms/               # RoomCard, CreateRoomForm, WatchedUrlList, ScanStatus
│   ├── changes/             # SeverityBadge, ChangeCard, ChangeTimeline, EvidenceTable, RecommendedActions
│   └── ui/                  # Button, Modal, Badge, Card, EmptyState
├── lib/                     # Integration and logic libraries
│   ├── insforge.ts          # Database access (typed helpers)
│   ├── apify.ts             # Web crawl with mock fallback
│   ├── box.ts               # Evidence storage with mock fallback
│   ├── ai.ts                # LLM analysis with mock fallback
│   ├── diff.ts              # Content hashing and change detection
│   ├── scan.ts              # Scan orchestration pipeline
│   ├── seed.ts              # Demo seed data
│   ├── env.ts               # Credential detection
│   └── validation.ts        # Input validation
├── types/                   # Shared TypeScript types
├── db/                      # Database migration SQL
├── scripts/                 # Standalone seed runner
└── .env.example             # Environment variables template
```

## Scan Pipeline

1. **Create scan run** — status `running`, `started_at` = now
2. **Load watched URLs** — if none, mark `completed` with zero counts
3. **Crawl URLs** — via Apify (or mock)
4. **Upload raw results** — to Box as `raw-apify-results.json`
5. **For each URL**:
   - Insert snapshot with content hash
   - Upload snapshot markdown to Box
   - Find previous snapshot
   - If content changed: request AI analysis, insert change analysis, upload report
6. **Complete scan run** — with `snapshotsCaptured` and `changesCreated` counts

On any failure after step 1, the run is marked `failed` with an error message.

## Database Schema

See `db/migration.sql` for the full schema. Five tables:

- `memory_rooms` — the rooms you create
- `watched_urls` — URLs being monitored per room
- `scan_runs` — scan execution records
- `page_snapshots` — captured page content with hashes
- `change_analyses` — AI-generated change interpretations

## Running Tests

```bash
# Run all tests
npm run test

# Run with coverage
npm run test:coverage

# Run in watch mode
npm run test:watch
```