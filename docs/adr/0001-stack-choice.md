---
status: accepted
date: 2026-06-04
decision-makers: PageVault engineering
consulted: PageVault PRD reviewers
informed: all contributors
---

# Stack choice: Next.js + InsForge + Apify + OpenAI-compatible LLM + InsForge Storage

## Context and Problem Statement

PageVault needs to (1) accept URLs from a single user (Maya, a PM doing
competitor monitoring) and on a schedule (2) capture the rendered content
of each URL, (3) detect changes, (4) ask an LLM to explain the change in
plain English, and (5) keep the raw evidence (the original page text) for
auditing and re-analysis. The product must be shippable in days, not
months, and the team is one engineer.

Key constraints surfaced during PRD review:

- **Single-user MVP** — multi-tenant auth, RBAC, and per-org quotas are
  explicitly out of scope (see `docs/PRD.md` §5 Out-of-scope).
- **Time-to-first-signal < 6 hours** — Maya needs a competitor pricing
  change to land in her inbox before the next planning meeting.
- **Cost ceiling < $0.05 per URL per scan** — the unit economics must hold
  on a hobbyist budget, not a startup seed round.
- **Evidence durability** — once a snapshot is captured, it must not
  silently disappear if a third-party service degrades.
- **Solo-operator deploy** — no DevOps engineer on the team. The
  deploy path is "git push and click a button," not a Kubernetes cluster.

## Decision Drivers

- D1: Time to ship. A working MVP beats a perfect one.
- D2: Operability by a single engineer (no 3 a.m. pages for
  infrastructure).
- D3: Vendor lock-in is acceptable for the MVP; portability is a future
  concern, not a current one.
- D4: The evidence plane must be more durable than the analysis plane —
  a bad LLM call is recoverable, a lost snapshot is not.
- D5: LLM and crawl vendors are swappable; the persistence and app
  framework are not (for the MVP).

## Considered Options

1. **Next.js + InsForge + Apify + OpenAI-compatible LLM + InsForge
   Storage** *(chosen)*
2. **Next.js + Supabase + Apify + OpenAI + AWS S3**
3. **Remix + Neon Postgres + Bright Data + Anthropic API + Cloudflare R2**
4. **Pure serverless on Vercel + Upstash Redis + a single Cloudflare Worker
   for crawls + OpenAI**

## Decision Outcome

Chosen option: **"Next.js + InsForge + Apify + OpenAI-compatible LLM +
InsForge Storage"**, because it is the only combination that meets
**D1** and **D2** simultaneously: every component has a managed
hosting tier with a one-page setup, and the persistence plane and the
evidence plane share an auth model (InsForge anon key), which means
one credential to rotate instead of two.

The OpenAI-compatible contract (rather than a vendor-specific SDK) is
load-bearing: the same code path works against OpenAI, OpenRouter, the
InsForge AI gateway, or a self-hosted llama.cpp instance. We pin
`gpt-4o-mini` for the MVP because the PRD's cost ceiling of
$0.05/URL/scan is met at that model tier.

### Consequences

Good:

- One backend (InsForge) for Postgres *and* storage means one key
  rotation, one outage domain, and one dashboard for the operator.
- Apify's `website-content-crawler` actor handles JS-rendered pages,
  anti-bot detection, and PDF extraction out of the box — features
  that would otherwise take weeks to build in-house.
- The OpenAI-compatible contract means we can move from
  `gpt-4o-mini` → `anthropic/claude-3.5-haiku` (via OpenRouter) →
  a self-hosted model without code changes, only an env-var swap.
- Vercel + InsForge Schedules is a single deploy target: `git push`
  to ship, two cron jobs (`scan-all`, `notification-worker`) on the
  same backend to run the loop.

Bad:

- Tight coupling to InsForge as the persistence plane. If InsForge has
  a multi-day outage, Maya sees nothing. Mitigated by the evidence
  being independently addressable (raw markdown in storage, fetchable
  by key) so a one-time re-ingest from cold storage is possible.
- Apify's per-actor billing is a second cost dimension beyond the
  LLM token bill. The `gpt-4o-mini` cost ceiling assumed in the PRD
  does not include Apify minutes; we need a separate cost guardrail
  (see ADR-0003, which puts the evidence plane under a different cost
  regime).
- Vendor lock-in on Next.js App Router. We are betting that RSC + the
  route-handler pattern remains the dominant Next.js paradigm for the
  next 18 months.

Neutral:

- We accept that the MVP is single-region (us-east-1 / us-east.insforge).
  Multi-region is out of scope (see `docs/PRD.md` §5).

## Pros and Cons of the Options

### Option 1: Next.js + InsForge + Apify + OpenAI + InsForge Storage *(chosen)*

- Good, because the entire stack has a free or hobbyist tier and a
  one-page setup. Maya can run a clone of the app for $0/month on
  Vercel's hobby plan and InsForge's free Postgres + Storage.
- Good, because InsForge is a single vendor for both Postgres *and*
  object storage with one SDK and one key, removing a whole class of
  "did I rotate the storage key" outages.
- Good, because the InsForge AI gateway exposes the OpenAI-compatible
  contract — so the LLM client code is identical whether we route
  through the gateway, hit OpenAI directly, or fall back to a local
  model.
- Bad, because InsForge is a relatively young platform. If it goes
  away or pivots, the migration cost is real (re-do the SDK calls,
  re-write the RLS policies).
- Bad, because the SDK is moving fast — `@insforge/sdk` is pre-1.0 in
  some transitive areas. We pin to a known-good version and re-test
  on upgrade.

### Option 2: Next.js + Supabase + Apify + OpenAI + AWS S3

- Good, because Supabase has a longer track record than InsForge and
  a larger community.
- Good, because S3 is the lingua franca of object storage and most
  tooling understands it.
- Bad, because we now have *three* credentials to manage
  (Supabase URL + service key, AWS access key + secret, plus the
  optional OpenAI/Apify keys) instead of two. The single-engineer
  operator cost of rotating three secrets quarterly is real.
- Bad, because S3's IAM model is more complex than InsForge Storage's
  bucket-and-key model. We would have to write policy documents
  before our first upload, not after.

### Option 3: Remix + Neon Postgres + Bright Data + Anthropic + Cloudflare R2

- Good, because Neon has a generous free tier and scales to zero.
- Good, because Anthropic's Claude family has strong long-context
  performance for full-page comparison.
- Bad, because Remix's server-first model costs us the Vercel-native
  RSC experience our team is already fluent in. The training cost
  is real.
- Bad, because Anthropic's API is *not* OpenAI-compatible, so the
  portability we get from Option 1 is lost. A future switch from
  Claude to GPT would mean a rewrite of the LLM client.

### Option 4: Pure serverless on Vercel + Upstash Redis + a Cloudflare Worker for crawls + OpenAI

- Good, because there is no always-on server to pay for. Cost is
  purely per-request.
- Bad, because crons on Vercel are limited to one per deployment
  tier and have coarse-grained scheduling. The PRD requires a
  schedule-per-room story, which this stack cannot deliver.
- Bad, because the storage story (Upstash is a key-value store, not
  object storage) means raw evidence lives in a Redis key, which is
  the wrong abstraction. We would end up building a "put a file
  somewhere" library that InsForge Storage already gives us for free.

## More Information

- `docs/PRD.md` — the product requirements that drove the constraint
  set in this ADR.
- `docs/ARCHITECTURE.md` — the implementation view of the same
  five-plane architecture this ADR describes at the decision level.
- `docs/LLM_MODEL_RESEARCH.md` — the model-selection research that
  settled on the OpenAI-compatible contract.
- `SYSTEM_DESIGN.md` — the original design intent (pre-InsForge),
  kept at repo root for historical reference.
