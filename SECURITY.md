# Security

> **Last updated:** 2026-06-02 · view this against commit `3b0f2ca` for accuracy.
> **Pair with:** [docs/audits/2026-06-02-codebase-audit.md](docs/audits/2026-06-02-codebase-audit.md)
> for the full audit findings and remediation plan.

## Reporting a vulnerability

**Please do not open a public GitHub issue for security findings.**

Email `security@pagevault.local` (replace with the real address once
one is provisioned) with:

- A description of the vulnerability and reproduction steps.
- The commit or version affected.
- Your assessment of impact and suggested fix, if any.

We aim to acknowledge within 2 business days and provide a
remediation timeline within 7 days. Coordinated disclosure is
appreciated but not required.

## Threat model (summary)

The app is a single-tenant Next.js application backed by a managed
Postgres (InsForge). The threat model focuses on:

| Threat | Mitigation in code | Status |
|---|---|---|
| **Unauthenticated access to a user's data via the API** | `requireSession()` in every mutating route | ⚠️ in progress — see audit S-1 |
| **Forged JWT sessions** | `NEXTAUTH_SECRET` required at startup, no hardcoded fallback | ✅ done |
| **Cron-endpoint abuse** | `x-cron-secret` header check, constant-time compare | ✅ done |
| **SQL injection** | PostgREST parameterized queries via `@insforge/sdk` | ✅ done (SDK handles parameterization) |
| **Cross-site scripting (XSS)** | React's default escaping + no `dangerouslySetInnerHTML` in the codebase | ✅ done |
| **Cross-site request forgery (CSRF)** | NextAuth's built-in CSRF tokens for the credentials provider | ✅ done |
| **Webhook receiver abuse (our side → receiver)** | The receiver URL is set by the user, so this is the user's problem. We sign payloads with the user's HMAC secret if they provide one. | ⚠️ partial — see audit finding |
| **Outbound notification abuse (attacker → our users via spoofed webhook)** | The `notification_outbox` only fires rows we wrote. The advisory lock prevents the worker from being triggered by a malicious caller (the lock id is server-side state). | ✅ done |
| **Dependency CVEs** | `npm audit` clean as a CI step | ⚠️ audit not enforced — see below |
| **Secrets in code** | No hardcoded secrets in source. `lib/auth.ts` deliberately throws when `NEXTAUTH_SECRET` is missing. | ✅ done |
| **Secrets in client bundle** | No service-role keys are referenced in any client component. `NEXT_PUBLIC_INSFORGE_*` are the anon keys by definition. | ✅ done |

## Known issues

The audit at
`docs/audits/2026-06-02-codebase-audit.md` identified the following.
The remediation is in progress in the `security/p0-fixes` branch.

- **S-1 (CRITICAL):** Unauthenticated mutation API routes. While
  `lib/apiAuth.ts:requireSession()` exists, not every mutating route
  calls it. The fix is in the `security/p0-fixes` branch.
- **S-2 (CRITICAL):** The hardcoded fallback for `NEXTAUTH_SECRET`
  was the original audit finding. The current code in `lib/auth.ts`
  no longer has the fallback — it throws if `NEXTAUTH_SECRET` is
  missing and `INSFORGE_DEV_INSECURE_SECRET` is not `***`**.

  > **Note:** this hardening was an intentional change. The current
  > `lib/auth.ts` on `main` (and the `3b0f2ca` commit referenced in this
  > doc) implements the safe behaviour.
- **S-3 (HIGH):** `lib/insforge.ts` previously had two parallel SDK
  clients with hardcoded anon keys. The current version routes
  through a single client from `lib/env.ts:getInsforgeClient()`.
- **S-4 (HIGH):** `next@14.2.5` has CVEs. Bump to `>=14.2.32`
  before going to production.
- **M-1 (HIGH):** No tests. The `vitest.config.ts` is configured and
  `@testing-library/react` is installed, but no test files exist.
  Add `lib/diff.test.ts` as a first step (it's pure functions, no
  dependencies).

## How secrets are managed

### In development

- `NEXTAUTH_SECRET` is in `.env.local` (gitignored). Generated with
  `openssl rand -base64 32`.
- `INSFORGE_*` keys are in `.env.local`. Pulled from
  `.insforge/project.json` (which is also gitignored).
- `OPENAI_API_KEY` / `OPENROUTER_API_KEY` / `APIFY_API_TOKEN` are in
  `.env.local`. None committed.

### In production

- Secrets are set in the deploy platform's secret store (Vercel
  environment variables, GitHub Actions secrets, or your platform's
  equivalent).
- The `CRON_SHARED_SECRET` is set as a per-InsForge-Schedule header
  via `npx @insforge/cli schedules create ... --headers '{...}'`.
  Each schedule has its own copy of the secret.
- `NEXTAUTH_SECRET` and the LLM keys are rotated on the same
  cadence as your other production secrets (90 days is a reasonable
  default).

### What to do if a secret leaks

1. **Rotate the secret immediately.** Treat the old value as
   compromised.
2. **Invalidate any session signed with the old `NEXTAUTH_SECRET`.**
   Restarting the app is enough — JWTs are stateless but verify
   against the current secret.
3. **For InsForge service-role keys:** rotate in the InsForge
   dashboard, update the env var, restart the app.
4. **For the LLM keys:** rotate in the provider's dashboard,
   update the env var, restart the app.
5. **For the cron shared secret:** rotate in the env var AND
   recreate the InsForge Schedules with the new secret in their
   `--headers` argument. The old schedules will 401 until you do.
6. **Audit the impact:** if the leaked secret had write access,
   review recent inserts/updates in the affected system.

## What we don't do (and why)

- **We don't rate-limit the user-facing API routes.** Low priority
  because the app is single-tenant and a single slow scan only
  blocks the requesting user. If multi-tenancy is added, this
  needs revisiting.
- **We don't log request bodies.** The logs only contain method,
  path, status, and (for errors) the error message. This is a
  privacy choice — request bodies may contain URLs that include
  user-supplied query strings.
- **We don't have a CSP header.** Next.js's defaults provide basic
  protections; a strict CSP would be a follow-up. Not a P0
  because the app doesn't load third-party scripts.
- **We don't have a Subresource Integrity (SRI) policy for the
  Google Fonts stylesheet.** `app/globals.css` loads Fraunces,
  Geist, and JetBrains Mono from Google Fonts. The fonts are
  loaded over HTTPS but the stylesheet is not SRI-pinned. Low
  risk (Google Fonts is a trusted source) but a follow-up.
