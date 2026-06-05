---
status: accepted
date: 2026-06-04
decision-makers: PageVault engineering
consulted: PageVault PRD reviewers
informed: all contributors
---

# Mock fallback strategy: credential-driven, opt-in, never silent

## Context and Problem Statement

PageVault integrates with three external services — Apify (web crawl),
an OpenAI-compatible LLM, and InsForge Storage. Two of those (Apify
and the LLM) are *analysis* paths: if they are unavailable, the
system should degrade gracefully and produce a *useful placeholder*
so the developer iterating on the app is not blocked. One of them
(InsForge Storage) is the *evidence* path: if it is unavailable or
the call fails, the system must surface the failure rather than
silently lose the snapshot.

We also need the application to run end-to-end on a fresh laptop with
zero credentials configured, so that a new contributor can `npm run
dev` and see a working UI in under a minute. This is the "Demo Mode"
property called out in the README and the AGENTS.md.

The question is: what is the contract for "no credentials present" vs
"credentials present but the third-party call failed"?

## Decision Drivers

- D1: The first-run experience must work with **no** credentials.
  `git clone && npm install && npm run dev` must produce a usable UI.
- D2: When a credential is missing, the user must be told clearly
  *which* credential is missing and *where* to put it. Silent fallback
  is the wrong default for production-shaped runs.
- D3: When a credential is present but the upstream call fails
  (network error, quota, 5xx), the system must not pretend the call
  succeeded. The error must propagate to the caller.
- D4: Mock responses must be **deterministic** — same input must give
  the same output, so tests are reproducible and screenshots in
  documentation don't drift.
- D5: The mock surface must match the real surface closely enough that
  swapping in a real credential requires no code change in the
  consumer (e.g. a route handler).

## Considered Options

1. **Credential-driven mock fallback, with explicit error on call
   failure** *(chosen)*
2. **Always-call-the-real-API, with a `DRY_RUN` flag for development**
3. **In-memory adapters only; require credentials for any non-trivial
   work**
4. **VCR-style recorded fixtures, replayed on demand**

## Decision Outcome

Chosen option: **"Credential-driven mock fallback, with explicit error
on call failure"**, implemented in `lib/env.ts`, `lib/scan.ts`, and
`lib/storage.ts`. The decision is *not* uniform across the three
integrations:

| Integration | No credentials | Credentials present, call fails |
|---|---|---|
| Apify (crawl) | `htmlToMarkdown` baseline extractor returns a deterministic stub | Error propagates as `ApifyError` |
| OpenAI-compatible LLM | Returns a deterministic mock explanation derived from the URL hash | Error propagates as `AiError` |
| InsForge Storage | Hard error: "Set `INSFORGE_API_URL` and `INSFORGE_ANON_KEY`" | Error propagates as `Error`; **never** falls back to a fake URL |

The third row is the load-bearing part of this ADR. See ADR-0003 for
the durability rationale.

The detection primitive is a single helper in `lib/env.ts`:

```ts
export function isPresent(value: string | undefined | null): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
```

`hasApifyCreds()`, `hasAiCreds()`, and `hasStorageCreds()` compose on
top of `isPresent()` so the *only* place we define "is this credential
set" is one function. A malformed value (e.g. a token with whitespace
weirdness) is still treated as present — the real-call path will
surface a real error and the operator gets a clearer signal than
"silently mocked because we didn't like the look of the value."

### Consequences

Good:

- **One mental model for new contributors.** "If the env var is set
  and the call works, you get the real thing. If the env var is unset
  you get a deterministic mock. If the env var is set and the call
  fails, you get an error." That is the entire rule.
- **Demos and tests share the same code path.** A test that runs
  without credentials exercises the mock path; a test that
  injects credentials via `vi.stubEnv()` exercises the real path.
  The two diverge only in the adapter chosen, not in the orchestrator
  logic.
- **The error message is actionable.** `createStorageFolder()` in
  `lib/storage.ts` does not just say "storage failed" — it enumerates
  which key is missing and explicitly notes that
  `INSFORGE_SERVICE_ROLE_KEY` is not sufficient for the storage SDK
  (a footgun we hit and fixed once already).

Bad:

- **The mock for the LLM can be confused with the real thing.** A new
  contributor looking at a "this URL changed and here is the
  analysis" screen during Demo Mode might not realize the analysis is
  a hash-derived stub. Mitigation: a visible banner in Demo Mode
  reads "Mock analysis — set `OPENAI_API_KEY` to enable real AI
  summaries."
- **`htmlToMarkdown()` is a thin shim, not a real crawler.** It works
  for static HTML; it does not handle SPAs, JS-rendered content, or
  anti-bot challenges. A user who expects Apify-quality output from
  the mock will be disappointed. This is an acceptable trade-off for
  the MVP because the alternative is a much heavier dependency for
  the dev-only path.
- **The decision is asymmetric across integrations.** Future readers
  of `lib/env.ts` may wonder why storage doesn't fall back. The
  answer is in this ADR and ADR-0003, but discoverability relies on
  the reader clicking through.

Neutral:

- We are explicitly *not* gating the mock behind a `NODE_ENV !==
  'production'` check. The mock is a credential-driven feature, not
  an environment-driven one. A user who has a partial credential set
  in production (e.g. InsForge but not OpenAI) will see real InsForge
  behaviour and mock LLM behaviour in production. This is a
  deliberate choice — see D1.

## Pros and Cons of the Options

### Option 1: Credential-driven mock fallback, with explicit error on call failure *(chosen)*

- Good, because D1 is met trivially: the absence of any env var
  produces a working app.
- Good, because the *same orchestrator code* (e.g. the scan pipeline
  in `lib/scan.ts`) runs in both modes; the adapter choice is below
  it.
- Good, because the error envelope is uniform — when something goes
  wrong, the route handler always sees an `Error` instance, not a
  "fake success" object.
- Bad, because the contract has to be learned once. The asymmetry
  between storage and the other two integrations is a real source of
  "why is this different?" for the next reader.

### Option 2: Always-call-the-real-API, with a `DRY_RUN` flag for development

- Good, because there is no mock surface to keep in sync with the
  real one.
- Bad, because D1 is violated. A fresh clone cannot run without
  credentials, and the contributor setup story gets much worse.
- Bad, because a `DRY_RUN` flag in production is a footgun: a
  misconfigured env var could turn real production traffic into mock
  responses.
- Bad, because the `DRY_RUN` toggle has to be threaded through every
  call site, which is more code than a credential check at the
  adapter level.

### Option 3: In-memory adapters only; require credentials for any non-trivial work

- Good, because the failure mode is honest — "no credentials, no
  work."
- Bad, because D1 is violated. The first-run experience is broken
  for every new contributor.
- Bad, because the in-memory adapters become a second class of code
  to maintain alongside the real adapters, with no shared shape
  enforced.

### Option 4: VCR-style recorded fixtures, replayed on demand

- Good, because the recorded responses are byte-identical to the real
  ones, so consumer code is exercised exactly as it would be in
  production.
- Bad, because the fixtures are coupled to specific URLs and
  timestamps. Any change to a fixture's URL invalidates the
  recording. A new contributor who adds a watched URL cannot test
  it without first recording a new fixture.
- Bad, because VCR-style fixtures add a non-trivial test dependency
  and an opinionated test-time convention that the rest of the
  codebase does not share.

## More Information

- `lib/env.ts` — the `isPresent` primitive and the `has*Creds()`
  composition layer.
- `lib/scan.ts` — the consumer-side orchestrator that runs in both
  modes without branching on `NODE_ENV`.
- `lib/storage.ts` — the asymmetry anchor: the one integration that
  does not fall back.
- `docs/ARCHITECTURE.md` — the "Key Design Patterns" section
  introduces the credential-driven mock fallback in narrative form.
- ADR-0003 — the durability guarantee that justifies the storage
  exception.
