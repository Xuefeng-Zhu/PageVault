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

### Demo Mode

The application runs fully without any third-party credentials:
- Missing Apify credentials → deterministic mock crawl results
- Missing Box credentials → mock folder/file identifiers and URLs
- Missing AI credentials → deterministic mock analysis
- Missing Insforge credentials → `InsforgeUnavailableError` with setup instructions

## Environment Variables

See `.env.example` for all configuration options. Missing credentials enable Demo_Mode.

## Setup

```bash
npm install
npm run dev
```

## Demo Mode

Without any credentials, the application runs in Demo Mode. Use "Load Demo" on the home page to seed a complete demonstration room with before/after data and change analyses.

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