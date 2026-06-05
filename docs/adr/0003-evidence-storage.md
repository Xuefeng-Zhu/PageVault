---
status: accepted
date: 2026-06-04
decision-makers: PageVault engineering
consulted: PageVault PRD reviewers
informed: all contributors
---

# Evidence storage is the one exception: no mock fallback

## Context and Problem Statement

ADR-0002 establishes the credential-driven mock fallback as the
default pattern: when a credential is missing, the system returns a
deterministic mock response. The storage layer is the *one*
deliberate exception. When InsForge Storage is configured but a
storage operation fails, the error propagates to the caller. When
InsForge Storage is not configured at all, the call does **not** fall
back to a fake URL — it throws a hard error with setup instructions.

The question this ADR answers is: *why* is storage different from
every other integration?

The answer is **durability**. PageVault's product promise to Maya is
that when she is told "this URL changed and here is the analysis,"
she can also click through to the **raw markdown** that produced the
analysis. The raw evidence is what makes the change explanation
auditable, contestable, and re-runnable with a different LLM. Losing
the evidence while keeping the explanation would turn PageVault into
an LLM that says "trust me, bro" — and the PRD explicitly rejects
that posture.

## Decision Drivers

- D1: The raw evidence (page markdown at snapshot time) is the
  *primary* artifact. The change explanation is a *derived*
  artifact derived from it.
- D2: An LLM hallucination on a derived artifact is recoverable
  by re-running the LLM against the stored raw markdown. A loss
  of the raw markdown is not recoverable.
- D3: A fake URL in the evidence column is worse than a visible
  error. Fake URLs are the kind of failure that passes code review
  silently and surfaces six months later when a compliance auditor
  asks "where is the screenshot of this pricing change on 2026-09-04?"
- D4: The error envelope must be actionable — the operator must be
  told which key is missing, why a partial set of keys is
  insufficient, and what command to run to fix it.

## Considered Options

1. **Storage errors propagate; no mock fallback, ever** *(chosen)*
2. **Storage falls back to a local filesystem path under `.cache/`
   in development only**
3. **Storage falls back to a `data:` URL with the markdown
   inlined**
4. **Storage falls back to a `null` and the UI renders "evidence
   unavailable" instead of a link**

## Decision Outcome

Chosen option: **"Storage errors propagate; no mock fallback, ever."**
Implemented in `lib/storage.ts` and enforced by the type system —
there is no `MockStorage` class to instantiate, no `STORAGE_MODE`
flag to set, no code path in the storage module that returns a fake
URL.

The asymmetry is enforced at the *module* level, not at the call
site. The call site (`lib/scan.ts`) calls `createStorageFolder()`
unconditionally. The implementation either:

- succeeds (returns a real folder path under `pagevault-evidence/`)
- throws (with a message naming the missing keys, *and* the
  surprising case where `INSFORGE_SERVICE_ROLE_KEY` is set but
  `INSFORGE_ANON_KEY` is not — a real footgun we hit and patched
  the error message for)

The same posture applies to `upload()` and the other storage
operations: they either succeed against real InsForge Storage, or
they throw. The consumer code is not structured to handle a
"storage returned a fake URL" case because that case cannot occur.

### Why this is the one exception

The asymmetry is intentional and the rationale has three parts:

1. **Evidence is a primary artifact, not a derived one.** A scan
   run produces two outputs: a derived *change explanation* (an
   LLM response) and a primary *raw evidence* file (the page
   content at snapshot time). The LLM response is a function of
   the raw evidence; the raw evidence is not a function of the LLM
   response. Losing the raw evidence loses the ability to ever
   re-derive a correct explanation.

2. **The cost of a silent failure is not the next deploy — it is
   the next audit.** A pricing change that PageVault "explains" in
   September might be re-litigated in a quarterly business review in
   March. At that point, the only acceptable evidence is the actual
   page content from September, not a hash-derived stub.

3. **The cost of a loud failure is low.** Storage configuration
   errors are discovered on the first run, in the first
   `npm run dev` after the env vars are touched. A loud error in
   development is the *cheapest* place to discover a missing
   `INSFORGE_ANON_KEY`.

### Consequences

Good:

- The contract is impossible to misuse. There is no way to read a
  `url` field out of the database and not know whether it points to
  real evidence or a mock — the field is always real, because the
  code path that would write a fake URL does not exist.
- The error message in `createStorageFolder()` is the documentation
  for the storage configuration. A new operator reading the error
  learns: (a) which two keys are required, (b) why the
  service-role key is not enough on its own, and (c) what to do
  next.
- The change-explanation re-derivation path is uniform: the same
  raw markdown can be re-analyzed with `gpt-4o-mini` today and
  with `claude-3.5-haiku` tomorrow, and the answer to "what did
  the page look like on 2026-09-04" is always a real fetch from
  storage, never a reconstructed guess.

Bad:

- The first-run experience is *worse* for someone who has set
  `INSFORGE_API_URL` and `INSFORGE_SERVICE_ROLE_KEY` but forgotten
  `INSFORGE_ANON_KEY`. They will see a hard error instead of a
  working demo. This is a known cost — see the explicit note in
  the error message itself, which calls out the surprising
  insufficiency of the service-role key.
- A misconfigured storage key in production is a hard outage, not
  a degraded mode. There is no "evidence unavailable, change
  analysis only" fallback in the UI. We consider this a feature,
  not a bug — see D3.
- A future contributor who wants to add a "render a demo without
  storage" mode will be tempted to introduce a mock storage class.
  This ADR is the explicit reason not to.

Neutral:

- The same posture should apply to the *database* layer
  (`lib/insforge.ts`), which is also evidence-bearing. We rely on
  the `@insforge/sdk` client to surface its own errors rather than
  introducing a mock. There is no ADR for the database layer
  because it is a one-vendor dependency with no obvious mock
  surface; the storage ADR exists because there is a real
  temptation to mock it (file-on-disk, in-memory, etc.) that
  needed to be explicitly rejected.

## Pros and Cons of the Options

### Option 1: Storage errors propagate; no mock fallback, ever *(chosen)*

- Good, because the contract is unbreakable. There is no code path
  that produces a fake evidence URL.
- Good, because the durability guarantee is end-to-end: from
  `createStorageFolder()` through the storage bucket to the
  `url` column in `page_snapshots`.
- Bad, because it makes the first-run experience slightly worse
  for partially-configured environments.

### Option 2: Storage falls back to a local filesystem path under `.cache/`

- Good, because the developer experience is great — `npm run dev`
  with no InsForge credentials still produces a working UI with
  clickable evidence links pointing at `file://` URLs.
- Bad, because the local-cache URLs are not durable across
  machines, not durable across container restarts, and not
  shareable with another team member. They look like evidence but
  are not evidence.
- Bad, because the `.cache/` directory will eventually get
  committed by accident, and the URL in the database will resolve
  to a file that no longer exists.
- Bad, because the moment you write the code that distinguishes
  "this is a real evidence URL" from "this is a cached stub", you
  have a footgun — a future contributor could branch on that
  flag and produce silent failures.

### Option 3: Storage falls back to a `data:` URL with the markdown inlined

- Good, because the evidence is self-contained: the entire
  snapshot is in the URL itself, no separate fetch needed.
- Bad, because `data:` URLs in a Postgres column blow up row
  size, break query plans, and confuse the hell out of database
  tooling (pg_dump, RLS policies, index statistics).
- Bad, because a 100KB markdown page becomes a 130KB URL, and the
  hard limit on `text` columns in InsForge Postgres is not
  generous.
- Bad, because this is the worst version of the silent-failure
  failure mode: the URL is technically a URL, the UI technically
  renders something, and the operator has no signal that the
  evidence is a stub.

### Option 4: Storage falls back to `null` and the UI renders "evidence unavailable"

- Good, because the failure is visible in the UI — Maya sees
  "evidence unavailable" instead of a link.
- Bad, because it does not match the data model. The `url`
  column on `page_snapshots` is non-nullable; introducing
  nullable URLs forces a migration and a check constraint
  in every consumer.
- Bad, because "evidence unavailable" in the UI is a
  permanent state, not a transient one. Maya will eventually
  stop trusting the system, because some evidence is always
  unavailable and she cannot tell which is which.
- Bad, because it papers over the configuration error. The
  right answer when the storage key is missing is to fix the
  config, not to render a placeholder.

## More Information

- `lib/storage.ts` — the implementation. The error messages in
  `createStorageFolder()` are the executable documentation of this
  ADR.
- ADR-0002 — the credential-driven mock fallback pattern that
  storage is the exception to.
- `docs/ARCHITECTURE.md` — the system view, including the
  distinction between the analysis plane (mockable) and the
  evidence plane (not mockable).
- `docs/PRD.md` §3 (top success metrics) — the
  "explanation <6h" metric is meaningless if the explanation
  cannot be traced back to its evidence.
