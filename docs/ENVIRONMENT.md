# Environment Variables

> **Last updated:** 2026-06-02 · view this against commit `3b0f2ca` for accuracy.
> **Source of truth:** [`.env.example`](../.env.example) and the credential
> detectors in [`lib/env.ts`](../lib/env.ts).

## The full list

| Var | Required? | Mode when set | Mode when unset | Default in dev |
|---|---|---|---|---|
| `INSFORGE_API_URL` | **yes** (prod) | Real Postgres backend | `throw` at startup | `https://wga6k9at.us-east.insforge.app` |
| `INSFORGE_SERVICE_ROLE_KEY` | **yes** (prod) | Full DB read/write via service role | `lib/notifications.ts` uses anon instead | — |
| `INSFORGE_ANON_KEY` | **yes** (prod) | Public read access for the SDK | SDK init throws at startup | — |
| `NEXTAUTH_SECRET` | **yes** (prod) | JWTs signed with a real secret | **Throws at startup** unless `INSFORGE_DEV_INSECURE_SECRET=1` | — |
| `NEXTAUTH_URL` | recommended | Canonical URL of the deployment | derived from `VERCEL_URL` / request | — |
| `INSFORGE_DEV_INSECURE_SECRET` | dev only | Auto-generate a random per-process JWT secret | normal behaviour (throws on missing `NEXTAUTH_SECRET`) | not set |
| `APIFY_API_TOKEN` | optional | Real Apify crawler | Direct `fetch()` + HTML→Markdown fallback | not set |
| `APIFY_ACTOR_ID` | optional | Which Apify Actor to call | Required if `APIFY_API_TOKEN` is set | — |
| `OPENAI_API_KEY` | optional | OpenAI Chat Completions | Falls back to `OPENROUTER_API_KEY` if both are set | — |
| `OPENAI_BASE_URL` | optional | Override the OpenAI base URL (for OpenRouter, custom endpoints) | `https://api.openai.com/v1` | `https://openai.com/v1` |
| `OPENAI_MODEL` | optional | Which model the analyzer calls | `anthropic/claude-3.5-haiku` (via OpenRouter) or `gpt-4o-mini` (via OpenAI) | `gpt-4o-mini` |
| `OPENROUTER_API_KEY` | optional | Used when `OPENAI_API_KEY` is missing/placeholder | — | — |
| `NEXT_PUBLIC_INSFORGE_URL` | optional | Client-visible InsForge URL | derived from `INSFORGE_API_URL` | — |
| `NEXT_PUBLIC_INSFORGE_ANON_KEY` | optional | Client-visible anon key | — | — |
| `CRON_SHARED_SECRET` | **yes** (prod, if cron is on) | Cron endpoints accept requests with matching `x-cron-secret` header | All cron requests are rejected | — |
| `INSFORGE_API_URL` (lib/scan.ts duplicate check) | **yes** | — | `lib/scan.ts:runScan` throws at import time | — |

> **The "Duplicate" row at the bottom is intentional.** `lib/scan.ts`
> reads `INSFORGE_API_URL` directly (not via `getInsforgeBaseUrl()`)
> because it also uses the SDK via dynamic import. Both code paths must
> agree. See [SECURITY.md](../SECURITY.md) for why this duplication
> exists.

## Per-feature behaviour

### InsForge (Postgres backend)

| Var | Effect of missing |
|---|---|
| `INSFORGE_API_URL` | The app refuses to start. The error message names this var explicitly. |
| `INSFORGE_ANON_KEY` | The SDK init throws on first call. |
| `INSFORGE_SERVICE_ROLE_KEY` | The cron worker (notification-worker) can read but not write. The scan pipeline uses this for inserts, so `runScan` will fail. The app still works for read-only operations. |

The credential detector in `lib/env.ts:isPresent()` treats a value as
"present" only when it's a non-empty string after trimming. A
malformed value (e.g. one with a trailing newline) is still treated as
present — it'll surface as a real-call error, not a missing-credential
fallback.

### NextAuth

| Var | Effect of missing |
|---|---|
| `NEXTAUTH_SECRET` | **Throws at startup.** No silent fallback. The `INSFORGE_DEV_INSECURE_SECRET=1` opt-in generates a per-process random secret. Sessions are invalidated on every process restart (intended dev behaviour). |
| `NEXTAUTH_URL` | NextAuth tries to derive it from `VERCEL_URL` (in Vercel deploys) or the request's `Host` header. Misconfigured in some reverse-proxy setups — set it explicitly. |
| `INSFORGE_DEV_INSECURE_SECRET=1` | Dev only. **Never set in production.** The opt-in is a separate env var so a misconfigured production deploy cannot accidentally enable it. |

**Generating a production secret:**
```bash
openssl rand -base64 32
```

### Apify (crawl plane)

Both `APIFY_API_TOKEN` **and** `APIFY_ACTOR_ID` must be set. If only
one is set, `lib/scan.ts:crawlOne()` treats it the same as neither (no
clear error, just falls through to the direct-fetch path).

When Apify is configured, the request is:

```
POST https://api.apify.com/v2/acts/<APIFY_ACTOR_ID>/run-sync-get-dataset-items?token=<APIFY_API_TOKEN>
Body: { "urls": ["<url>"] }
```

We expect a single dataset item back, with `title`, `markdown` (or
`text`), and `capturedAt` fields. The recommended Actor is
`apify/website-content-crawler`.

### LLM (analyze plane)

The `callLlm()` function in `lib/scan.ts` follows this key-selection
logic:

1. Use `OPENAI_API_KEY` if it's a real key (length ≥ 30, no `...`
   placeholder).
2. Otherwise use `OPENROUTER_API_KEY` (set by `npx @insforge/cli ai
   setup`).
3. The base URL and model also swap:
   - With a real `OPENAI_API_KEY`: `https://api.openai.com/v1`, model
     = `OPENAI_MODEL` (default `gpt-4o-mini`).
   - With `OPENROUTER_API_KEY`: `https://openrouter.ai/api/v1`, model
     = `anthropic/claude-3.5-haiku` (unless `OPENAI_MODEL` is set).

**Generating an OpenAI key:** <https://platform.openai.com/api-keys>
**Generating an OpenRouter key:** <https://openrouter.ai/keys>

The model selection rationale, with benchmarks, is in
[LLM_MODEL_RESEARCH.md](LLM_MODEL_RESEARCH.md).

### Cron auth

| Var | Effect of missing |
|---|---|

| `CRON_SHARED_SECRET` | All cron requests get 401. The schedules fire
but the work is rejected. This is a safe-by-default posture for
unconfigured deployments. |

**Generating a secret:**
```bash
openssl rand -hex 32
```

The constant-time comparison in `lib/cron-auth.ts:requireCronSecret()`
prevents timing attacks.

## `.env.local` (your local file, gitignored)

```bash
# .env.local — local development only. NEVER commit.
# Copy .env.example to .env.local and fill these in.

INSFORGE_API_URL=https://wga6k9at.us-east.insforge.app
INSFORGE_SERVICE_ROLE_KEY=<from .insforge/project.json>
INSFORGE_ANON_KEY=<from .insforge/project.json>
NEXT_PUBLIC_INSFORGE_URL=https://wga6k9at.us-east.insforge.app
NEXT_PUBLIC_INSFORGE_ANON_KEY=<from .insforge/project.json>

# Either OpenAI or OpenRouter — pick one
OPENAI_API_KEY=sk-...                       # 30+ chars
# OPENROUTER_API_KEY=sk-or-...              # set by `npx @insforge/cli ai setup`
# OPENAI_BASE_URL=https://api.openai.com/v1  # default
# OPENAI_MODEL=gpt-4o-mini                  # default

# Apify (optional — leave unset to use the direct-fetch crawler)
# APIFY_API_TOKEN=apify_api_...
# APIFY_ACTOR_ID=apify/website-content-crawler

# NextAuth (REQUIRED — generate per-environment)
NEXTAUTH_SECRET=<openssl rand -base64 32>
NEXTAUTH_URL=http://localhost:3000

# Dev-only: auto-generate a random NEXTAUTH_SECRET if missing.
# NEVER set this in production.
# INSFORGE_DEV_INSECURE_SECRET=1

# Cron shared secret (required if you want the cron worker to run locally)
# CRON_SHARED_SECRET=<openssl rand -hex 32>
```

## Verifying your config locally

```bash
# 1. Confirm tsc + build pass with your env
npx tsc --noEmit && npx next build

# 2. Start the dev server
npm run dev

# 3. Hit the health surface (after signing in)
curl -sS http://localhost:3000/api/rooms | head -50

# 4. Test the cron auth path
curl -i -X POST http://localhost:3000/api/cron/notification-worker \
  -H "x-cron-secret: $CRON_SHARED_SECRET"
# Expected: 200 {"processed":0,"succeeded":0,"failed":0}
# Without header or wrong secret: 401
```

## Production checklist

- [ ] `NEXTAUTH_SECRET` is set; **not** committed to `.env.example`
- [ ] `INSFORGE_DEV_INSECURE_SECRET` is **not** set
- [ ] `CRON_SHARED_SECRET` is set
- [ ] `INSFORGE_API_URL` points at the production InsForge project
- [ ] `INSFORGE_SERVICE_ROLE_KEY` is the production SRK, not the
      staging one
- [ ] `NEXTAUTH_URL` is the canonical production URL
- [ ] At least one of `OPENAI_API_KEY` / `OPENROUTER_API_KEY` is set
- [ ] The `tsconfig.tsbuildinfo` and `.next/` are gitignored (they are)
- [ ] `npm audit` is clean (`next@14.2.5` has CVEs — bump to
      `>=14.2.32` before going live)
