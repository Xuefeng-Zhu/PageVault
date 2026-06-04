# Contributing to PageVault

Thanks for contributing. This guide is short on purpose — the longer
developer reference lives in [`docs/DEVELOPMENT.md`](docs/DEVELOPMENT.md).

## Development setup

```bash
npm install
cp .env.example .env.local   # then fill in any credentials you have
npm run dev
```

Without credentials the app runs in **Demo Mode** (see the README).
Required: a working Node and a Postgres reachable via `@insforge/sdk`
(or run InsForge locally — see `docs/DEVELOPMENT.md`).

## Scripts

```bash
npm run dev          # next dev
npm run typecheck    # tsc --noEmit
npm run lint         # next lint
npm run test         # vitest run
npm run test:watch   # vitest
npm run build        # next build
```

## Branching & pull requests

- Branch off `main`. Use a short prefix: `feat/`, `fix/`, `chore/`, `docs/`,
  `refactor/`, `test/`, `ci/`.
- One logical change per PR. Split refactors from behavior changes.
- Fill in the PR template. The CI check must be green before review.
- `main` is protected: at least **one approving review** is required to merge.

## Conventional Commits

All commit subject lines **must** follow the [Conventional Commits](https://www.conventionalcommits.org/)
spec. The format is:

```
<type>(<optional-scope>): <short summary>

<optional body — explain WHY, not WHAT>

<optional footer — Closes #123, BREAKING CHANGE: ...>
```

### Allowed types

| Type       | When to use |
|------------|-------------|
| `feat`     | A new user-visible feature |
| `fix`      | A bug fix |
| `docs`     | Documentation only (no code change) |
| `style`    | Whitespace / formatting only (no logic change) |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `perf`     | Performance improvement |
| `test`     | Add or fix tests only |
| `build`    | Build system or external dependency change |
| `ci`       | CI configuration change |
| `chore`    | Other changes that don't modify `src` or tests (e.g. tooling, repo setup) |
| `revert`   | Revert a previous commit |

### Rules

- Subject is **imperative mood**, **no trailing period**, ≤ 72 chars.
  Good: `fix(rooms): validate room name length`
  Bad: `Fixed the bug.` / `WIP`
- Scope is optional. Use the affected area: `rooms`, `cron`, `api`, `ui`,
  `docs`, `ci`, etc.
- A **breaking change** must be called out with `!` after the type/scope
  AND a `BREAKING CHANGE:` footer explaining the migration.
  Example: `feat(api)!: require auth on /api/rooms`

### Examples

```
feat(rooms): add per-room scan schedule endpoint
fix(cron): gate scan on enabled schedule row
docs(readme): link docs/DEPLOYMENT.md under Setup
chore(repo): add LICENSE, CI workflow, and PR template
```

## Reporting bugs & security issues

- General bugs: open a GitHub issue using the **Bug report** template.
- Security vulnerabilities: **do not** open a public issue. Follow
  [`SECURITY.md`](SECURITY.md).

## Code of conduct

Be respectful. We're a small project — assume good intent, ask before
restructuring someone else's PR, and keep the conversation on the technical
merits.
