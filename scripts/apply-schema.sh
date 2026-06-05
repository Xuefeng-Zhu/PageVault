#!/usr/bin/env bash
# scripts/apply-schema.sh
# ─────────────────────────────────────────────────────────────────────────────
# Apply db/schema.sql to the linked InsForge project, statement by statement.
#
# Why this exists
# ---------------
# `npx @insforge/cli db import db/schema.sql` silently drops multi-statement
# DDL chunks that include `ALTER TABLE ... ADD COLUMN` and certain policy
# re-create blocks.  See the "Multi-statement DDL doesn't persist via
# `db query`" pitfall in the insforge-cli skill.  The result is a partially
# applied schema that LOOKS successful ("Query executed successfully") but is
# missing the columns / policies / RPC helpers that the import path dropped.
#
# The fix
# --------
# Split db/schema.sql into one statement per chunk and apply each chunk with
# a separate `npx @insforge/cli db query "$chunk"` call.  The single-
# statement path is unaffected by the multi-statement DDL pitfall.
#
# The Python splitter (`scripts/_split_sql.py`) understands Postgres quoting
# rules — `$$ ... $$` dollar-quoted PL/pgSQL bodies, `/* ... */` block
# comments, `-- ...` line comments, `'...'` string literals with `''` escapes,
# and `"..."` identifiers — so it never breaks a CREATE FUNCTION / DO $$ ...
# $$; body on the `;` characters inside it.
#
# Idempotency
# -----------
# db/schema.sql is already idempotent (CREATE IF NOT EXISTS, ALTER TABLE ...
# ENABLE RLS, CREATE OR REPLACE for functions, DO blocks for policy drops).
# Re-running this script on top of an already-applied schema must succeed
# end-to-end.  The script does not need to know that — it just calls the
# CLI, and the schema handles the "already there" case.
#
# Usage
# -----
#   scripts/apply-schema.sh                  # apply to the linked project
#   scripts/apply-schema.sh --dry-run        # print chunks, do not execute
#   scripts/apply-schema.sh --schema PATH    # apply a different SQL file
#                                            # (default: db/schema.sql)
#   scripts/apply-schema.sh --help
#
# Exit codes
# ----------
#   0 — every chunk applied (or printed in --dry-run).
#   1 — a `npx` call failed; the failing chunk is printed to stderr and
#       its first 200 chars are also echoed to stdout so it shows up in
#       CI logs.
#   2 — prerequisite missing (Python 3 not found, schema.sql not found,
#       or the workspace is not linked to an InsForge project).
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
SCHEMA_PATH="$REPO_ROOT/db/schema.sql"
DRY_RUN=0

for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    --schema)
      shift
      SCHEMA_PATH="$1"
      ;;
    --schema=*)
      SCHEMA_PATH="${arg#--schema=}"
      ;;
    -h|--help)
      sed -n '2,50p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown argument: $arg" >&2
      echo "Run with --help for usage." >&2
      exit 1
      ;;
  esac
done

# Prereqs
if ! command -v python3 >/dev/null 2>&1; then
  echo "::error::python3 is required (for the SQL splitter)" >&2
  exit 2
fi

if ! command -v npx >/dev/null 2>&1; then
  echo "::error::npx is required (to invoke @insforge/cli)" >&2
  exit 2
fi

if [ ! -f "$SCHEMA_PATH" ]; then
  echo "::error::Schema file not found: $SCHEMA_PATH" >&2
  exit 2
fi

# In real (non-dry-run) mode, verify the project is linked so the operator
# gets a clear error before we apply 55 chunks to the wrong project.
if [ "$DRY_RUN" -eq 0 ]; then
  if [ ! -f "$REPO_ROOT/.insforge/project.json" ]; then
    echo "::error::No InsForge project linked at $REPO_ROOT/.insforge/project.json" >&2
    echo "Run: npx @insforge/cli link --project-id <id>" >&2
    exit 2
  fi
fi

# Split the schema.  Output is a JSON array of {index, sql} objects on stdout.
SPLITTER="$SCRIPT_DIR/_split_sql.py"
if [ ! -f "$SPLITTER" ]; then
  echo "::error::Splitter not found: $SPLITTER" >&2
  exit 2
fi

# shellcheck disable=SC2086  # we intentionally word-split paths
CHUNKS_JSON="$(python3 "$SPLITTER" "$SCHEMA_PATH")"
CHUNK_COUNT="$(printf '%s' "$CHUNKS_JSON" | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")"

if [ -z "$CHUNK_COUNT" ] || [ "$CHUNK_COUNT" -eq 0 ]; then
  echo "::error::Splitter produced 0 chunks for $SCHEMA_PATH" >&2
  exit 2
fi

echo "Applying $CHUNK_COUNT chunks from $SCHEMA_PATH"
if [ "$DRY_RUN" -eq 1 ]; then
  echo "(dry-run mode — chunks will be printed, not executed)"
fi
echo

# Apply each chunk.  We iterate by index because the SQL can contain
# newlines, single quotes, and `$$` markers that break naive `for chunk in
# $(...)` loops.  Re-parse the JSON in the loop body to extract one chunk
# at a time.
i=1
while [ "$i" -le "$CHUNK_COUNT" ]; do
  CHUNK="$(printf '%s' "$CHUNKS_JSON" | python3 -c "
import json, sys
data = json.load(sys.stdin)
print(data[$((i - 1))]['sql'], end='')
")"
  # First non-blank, non-comment line of the chunk for the log line.
  PRETTY="$(printf '%s' "$CHUNK" | grep -m1 -vE '^\s*(--|$)' | head -c 100)"
  echo "  [$i/$CHUNK_COUNT] $PRETTY"

  if [ "$DRY_RUN" -eq 0 ]; then
    # `db query` takes the SQL as a single positional argument.  Use
    # stdin-friendly form: write the chunk to a temp file and let the
    # CLI read it via $(cat tmpfile) — the CLI's `db query` parses one
    # statement at a time and the splitter has already guaranteed that
    # this chunk is exactly one statement.
    TMP_CHUNK="$(mktemp -t apply-schema.XXXXXX.sql)"
    trap 'rm -f "$TMP_CHUNK"' EXIT
    printf '%s' "$CHUNK" > "$TMP_CHUNK"

    if ! npx --no-install @insforge/cli db query "$(cat "$TMP_CHUNK")" >/dev/null 2>"$TMP_CHUNK.err"; then
      echo "::error::Chunk $i failed to apply." >&2
      echo "----- failing chunk (first 2000 chars) -----" >&2
      printf '%s' "$CHUNK" | head -c 2000 >&2
      echo >&2
      echo "----- CLI stderr -----" >&2
      cat "$TMP_CHUNK.err" >&2
      rm -f "$TMP_CHUNK" "$TMP_CHUNK.err"
      exit 1
    fi
    rm -f "$TMP_CHUNK" "$TMP_CHUNK.err"
    trap - EXIT
  fi
  i=$((i + 1))
done

echo
if [ "$DRY_RUN" -eq 1 ]; then
  echo "Dry run complete: $CHUNK_COUNT chunks parsed from $SCHEMA_PATH"
else
  echo "All $CHUNK_COUNT chunks applied successfully."
fi
