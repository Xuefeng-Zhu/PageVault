# PageVault Documentation

This directory is the canonical developer reference for the PageVault codebase.
The top-level [`README.md`](../README.md) is the **entry point for new contributors**
and points here once you're past the quickstart.

> **Doc truthfulness:** Every doc here was generated from the source as of the
> last commit referenced at the top of each file. If you change a route, table,
> component, or env var, update the corresponding doc in the same commit. PRs
> that change source without updating docs will be flagged in review.

## Reading order

If you're new to PageVault, read in this order:

1. **[README.md](../README.md)** — what PageVault is, the one-paragraph
   architecture, the quickstart, the project-structure map.
2. **[ARCHITECTURE.md](ARCHITECTURE.md)** — the system view: how the Next.js
   app, the InsForge backend, the Apify crawler, the OpenAI-compatible LLM,
   and the cron worker fit together. Complement (don't duplicate)
   `SYSTEM_DESIGN.md` at the repo root.
3. **[DATA_MODEL.md](DATA_MODEL.md)** — every database table, every column,
   every relationship. Includes the ER diagram.
4. **[ENVIRONMENT.md](ENVIRONMENT.md)** — the canonical list of every env var,
   which mode it enables, what the safe-by-default behaviour is, and the
   secure generation command.
5. **[API.md](API.md)** — every API route, request and response shape, auth
   requirement, and error code.
6. **[COMPONENTS.md](COMPONENTS.md)** — every component in `components/`, its
   props, when to use it, and a code example.
7. **[DEVELOPMENT.md](DEVELOPMENT.md)** — local setup, common tasks (run,
   test, debug, lint, typecheck), conventions, troubleshooting.
8. **[DEPLOYMENT.md](DEPLOYMENT.md)** — production deploy via InsForge,
   scheduled-scan lifecycle, secret management, the cron worker.
9. **[OPERATIONS.md](OPERATIONS.md)** — monitoring, common incident responses,
   the four alerts that page someone.
10. **[SECURITY.md](../SECURITY.md)** — vulnerability reporting, threat model
    summary, how secrets are managed.

## Reference material in this directory

- **[LLM_MODEL_RESEARCH.md](LLM_MODEL_RESEARCH.md)** — the model-selection
  research behind the `lib/scan.ts` analyzer. Read this if you're tuning
  prompts, swapping models, or trying to understand the cascade architecture.
- **[runbook.md](runbook.md)** — the "what do I do when X breaks" doc.
  Topology, deploy procedure, rollback per layer, common errors, on-call
  posture, full DR runbook, secret rotation, incident response checklist.
  Read this before paging anyone.
- **[audits/2026-06-02-codebase-audit.md](audits/2026-06-02-codebase-audit.md)**
  — the security and maintainability audit. Every finding has a risk rating and
  a remediation plan. Several findings are already fixed in
  `security/p0-fixes`.
- **[plans/2026-06-02-scheduled-scans-and-notifications.md](plans/2026-06-02-scheduled-scans-and-notifications.md)**
  — the implementation plan for scheduled scans and notifications, with
  verification steps per task. Useful when reading the cron code.
- **[SCHEDULED_SCANS.md](SCHEDULED_SCANS.md)** — user-facing doc for the
  scheduled-scans feature. How cron presets work, what the scan pipeline
  does, costs, the API surface, and how to verify a scan ran.
- **[NOTIFICATIONS.md](NOTIFICATIONS.md)** — user-facing doc for outbound
  webhook notifications. Payload shape, HMAC signature verification,
  thresholds, auto-disable semantics, Slack example, reliability model.
- **[superpowers/specs/](../docs/superpowers/specs/)** — design specs for the
  same two features; what we wanted to build.
- **[SYSTEM_DESIGN.md](../SYSTEM_DESIGN.md)** *(repo root)* — the
  800-line architectural spec, Mermaid diagrams, and contract examples. This
  was the source of truth during initial design. The docs in this directory
  are the implementation view; SYSTEM_DESIGN is the design view.

## Doc conventions

- **File headers** carry a "Last updated" line referring to the commit that
  produced them. If you change a doc, update the line.
- **Code examples** are copy-pasteable. Every example has been tested against
  the current source.
- **Cross-references** use repo-relative paths (`docs/API.md`, not
  `https://...`).
- **Open questions / known gaps** are called out inline with a ⚠️ marker, not
  hidden in footers.

## When to update which doc

| You changed… | Update… |
|---|---|
| A file under `app/api/` | `API.md` |
| A file under `app/dashboard/` (pages) | `DEVELOPMENT.md` (if a new flow), `COMPONENTS.md` (if a new component) |
| A file under `components/` | `COMPONENTS.md` |
| A file under `lib/` | `ARCHITECTURE.md` (if behaviour changed), `DEVELOPMENT.md` (if a new helper) |
| A file under `db/migrations/` | `DATA_MODEL.md` |
| `.env.example` or any new env var | `ENVIRONMENT.md` |
| `package.json` (new dep or script) | `DEVELOPMENT.md` |
| A new cron endpoint or schedule | `DEPLOYMENT.md`, `OPERATIONS.md` |
| Auth or session logic | `SECURITY.md` |
| LLM prompt or model selection | `LLM_MODEL_RESEARCH.md` |
| The architecture as a whole | `ARCHITECTURE.md`, then `SYSTEM_DESIGN.md` |
