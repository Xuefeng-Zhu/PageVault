#!/usr/bin/env bash
# scripts/dev-setup.sh
# ─────────────────────────────────────────────────────────────────────────────
# One-command dev environment bootstrap for PageVault.
#
# What it does, in order:
#   1. Verifies Node ≥ 20 (the project's minimum — Next 15 + Vitest 1 require it).
#   2. Verifies npm is available.
#   3. Copies .env.example → .env.local (skips if .env.local already exists).
#   4. Runs `npm install` (skipped if node_modules/ is already populated).
#   5. Prints a clear summary of next steps and the URLs you can hit.
#
# Idempotent: re-running it is safe. It will not overwrite a real .env.local
# and will not re-install a clean node_modules.
#
# Usage:
#     ./scripts/dev-setup.sh
#     ./scripts/dev-setup.sh --reinstall   # blow away node_modules and reinstall
#     ./scripts/dev-setup.sh --reset-env   # overwrite .env.local with .env.example
#
# Exit codes:
#     0 — setup completed (or was already complete).
#     1 — prerequisite missing (Node < 20, no npm, no .env.example).
#     2 — install failed (npm exited non-zero).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

# Resolve the repo root (the parent of the scripts/ directory), regardless
# of where the script is invoked from. Realpath + cd handles symlinked
# invocations and relative paths.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$REPO_ROOT"

REINSTALL=0
RESET_ENV=0
for arg in "$@"; do
  case "$arg" in
    --reinstall) REINSTALL=1 ;;
    --reset-env) RESET_ENV=1 ;;
    -h|--help)
      sed -n '2,22p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

# Pretty output (degrades gracefully on terminals without color).
if [ -t 1 ] && command -v tput >/dev/null 2>&1 && [ "$(tput colors 2>/dev/null || echo 0)" -ge 8 ]; then
  C_BOLD='\033[1m'; C_DIM='\033[2m'; C_GREEN='\033[32m'; C_YELLOW='\033[33m'; C_RED='\033[31m'; C_RESET='\033[0m'
else
  C_BOLD=''; C_DIM=''; C_GREEN=''; C_YELLOW=''; C_RED=''; C_RESET=''
fi

step() { printf '\n%s▶ %s%s\n' "$C_BOLD" "$1" "$C_RESET"; }
ok()   { printf '  %s✓%s %s\n' "$C_GREEN" "$C_RESET" "$1"; }
warn() { printf '  %s!%s %s\n' "$C_YELLOW" "$C_RESET" "$1"; }
err()  { printf '  %s✗%s %s\n' "$C_RED" "$C_RESET" "$1" >&2; }

# ─── 1. Node version ─────────────────────────────────────────────────────────
step "Checking prerequisites"
if ! command -v node >/dev/null 2>&1; then
  err "Node.js is not on PATH."
  echo "    Install Node 20 LTS or newer: https://nodejs.org/en/download" >&2
  echo "    (or use a version manager: nvm, fnm, volta, asdf)" >&2
  exit 1
fi

# node prints "vX.Y.Z" on `node --version`. Strip the 'v' and parse the major.
NODE_VERSION_RAW="$(node --version)"
# Parse "vX.Y.Z" → X. We use the major number for the version-floor check.
NODE_MAJOR="${NODE_VERSION_RAW#v}"
NODE_MAJOR="${NODE_MAJOR%%.*}"

if [ "${NODE_MAJOR:-0}" -lt 20 ]; then
  err "Node $NODE_VERSION_RAW is too old. PageVault requires Node 20+ (we test on 20 and 22)."
  echo "    Update with your version manager, e.g.: nvm install 20 && nvm use 20" >&2
  exit 1
fi
ok "Node $NODE_VERSION_RAW (≥ 20)"

# ─── 2. npm ──────────────────────────────────────────────────────────────────
if ! command -v npm >/dev/null 2>&1; then
  err "npm is not on PATH (it ships with Node — try reinstalling Node)."
  exit 1
fi
NPM_VERSION="$(npm --version)"
ok "npm $NPM_VERSION"

# ─── 3. .env.example presence ────────────────────────────────────────────────
if [ ! -f .env.example ]; then
  err ".env.example is missing from $REPO_ROOT."
  echo "    This file is the source of truth for env vars. It should be in git." >&2
  exit 1
fi

# ─── 4. .env.local ───────────────────────────────────────────────────────────
step "Setting up .env.local"
ENV_JUST_CREATED=0
if [ -f .env.local ] && [ "$RESET_ENV" -eq 0 ]; then
  warn ".env.local already exists — leaving it alone. (Pass --reset-env to overwrite.)"
elif [ -f .env.local ] && [ "$RESET_ENV" -eq 1 ]; then
  cp .env.example .env.local
  ENV_JUST_CREATED=1
  ok "Reset .env.local from .env.example (existing file was overwritten)"
else
  cp .env.example .env.local
  ENV_JUST_CREATED=1
  ok "Created .env.local from .env.example"
fi

# ─── 4b. Auto-enable dev opt-ins on a fresh clone ───────────────────────────
# Goal: `./scripts/dev-setup.sh` on a fresh clone + `npm run dev` should boot
# end-to-end without the operator having to edit .env.local by hand.
#
# What this does:
#   • If we JUST created .env.local (or --reset-env'd it), the NEXTAUTH_SECRET
#     and CRON_SHARED_SECRET are empty placeholders. The app would refuse to
#     start in that state (lib/auth.ts throws when NEXTAUTH_SECRET is unset).
#   • We auto-append the dev opt-ins INSFORGE_DEV_INSECURE_SECRET=1 and
#     INSFORGE_DEV_DEMO_AUTH=1 so the dev workflow works out of the box.
#   • If .env.local PRE-EXISTED (the operator already has real values in it),
#     we leave it alone — they know what they're doing.
#
# Why not always-on: the dev opt-ins are gated by NODE_ENV=development in
# lib/auth.ts, so they are safe in a dev VM / container. They MUST never be
# set in production.
#
# We write a clearly-labelled block at the end of .env.local so the operator
# can see what was added and remove it for any non-dev environment.
if [ "$ENV_JUST_CREATED" -eq 1 ]; then
  step "Enabling dev-only auth opt-ins"
  # Use ISO date for the marker so it's clear when the block was added.
  # A subsequent run of the script with --reset-env overwrites the block
  # with a new timestamp; without --reset-env the block is left alone.
  RUN_DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  cat >> .env.local <<DEV_OPTS_EOF

# ─── Added by ./scripts/dev-setup.sh on ${RUN_DATE} ────────────────────────
# Dev-only opt-ins so \`npm run dev\` boots end-to-end on a fresh clone.
# lib/auth.ts gates these on NODE_ENV=development, so they are no-ops in
# production. DELETE THIS BLOCK for any environment that needs stable
# sessions (staging, preview, prod) and set real NEXTAUTH_SECRET +
# CRON_SHARED_SECRET values instead.
INSFORGE_DEV_INSECURE_SECRET=1
INSFORGE_DEV_DEMO_AUTH=1
NODE_ENV=development
# ─── End dev-setup.sh block ─────────────────────────────────────────────────
DEV_OPTS_EOF
  ok "Appended dev opt-ins to .env.local. (Delete this block for non-dev environments.)"
else
  warn "Skipped dev opt-in auto-append because .env.local pre-existed. If you want a self-bootstrapping first run, pass --reset-env."
fi

# ─── 5. npm install ─────────────────────────────────────────────────────────
step "Installing dependencies"
if [ -d node_modules ] && [ "$REINSTALL" -eq 0 ]; then
  warn "node_modules/ already present — skipping install. (Pass --reinstall to force.)"
else
  if [ "$REINSTALL" -eq 1 ] && [ -d node_modules ]; then
    warn "--reinstall passed; removing node_modules/ and reinstalling."
    rm -rf node_modules
  fi
  # `npm install` prints a lot; show the last 20 lines on success and the
  # full output on failure (with `||`).
  if ! npm install 2>&1 | tail -20; then
    err "npm install failed. See the output above."
    exit 2
  fi
  ok "Installed dependencies"
fi

# ─── 6. Done ────────────────────────────────────────────────────────────────
step "Dev environment ready"
cat <<EOF

${C_BOLD}Next steps${C_RESET}

  1. Start the dev server:

         ${C_GREEN}npm run dev${C_RESET}

     The app will be on ${C_BOLD}http://localhost:3000${C_RESET} (or the next free
     port if 3000 is in use). In Codespaces / behind a tunnel, the proxy
     URL is the one to share with collaborators.

  2. Sign in.

     If this is a fresh clone, the script just appended the dev-only
     auth opt-ins to .env.local, so the login page accepts the demo
     credentials: ${C_BOLD}admin@example.com / demo123${C_RESET}.

     If .env.local pre-existed (and you didn't pass --reset-env), the
     dev opt-ins were NOT appended — the script leaves real keys alone.
     In that case, sign in with whatever credentials your InsForge
     project has, or temporarily append the opt-ins from the
     "Dev-only opt-ins" section of .env.example.

  3. ${C_DIM}(optional)${C_RESET} Open ${C_BOLD}.env.local${C_RESET} and fill in real keys
     for the integrations you want to use (InsForge project, Apify
     token, OpenAI/OpenRouter key, CRON shared secret). Routes that
     need a key you haven't set will return 5xx at request time but
     the rest of the app still works. See ${C_DIM}.env.example${C_RESET}
     for what each var does and where to get it.

  4. Verify the rest of the toolchain:

         ${C_GREEN}npm run typecheck${C_RESET}    # tsc --noEmit
         ${C_GREEN}npm run lint${C_RESET}         # next lint
         ${C_GREEN}npm test${C_RESET}             # vitest run

  Full developer reference: ${C_DIM}docs/DEVELOPMENT.md${C_RESET}
  Env var contract:          ${C_DIM}docs/ENVIRONMENT.md${C_RESET}
  Architecture overview:     ${C_DIM}docs/ARCHITECTURE.md${C_RESET}

EOF
