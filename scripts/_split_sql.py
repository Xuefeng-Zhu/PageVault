#!/usr/bin/env python3
"""
Split a Postgres SQL file into a list of per-statement chunks.

Robust against the constructs present in db/schema.sql:
  - single-line comments (-- ...)
  - block comments (/* ... */), possibly nested in PL/pgSQL or not (we treat
    them as non-nested because Postgres does not nest them anyway)
  - single-quoted string literals with '' as the in-string escape
  - double-quoted identifiers (treated as opaque; no internal SQL semantics)
  - dollar-quoted strings: $$ ... $$, $tag$ ... $tag$, with the tag matching
    the opening delimiter.  These swallow all semicolons until the closer.

This is the splitter that scripts/apply-schema.sh pipes through.  Each chunk
is a single SQL statement (or a single CREATE OR REPLACE FUNCTION body, etc.)
that can be applied via `npx @insforge/cli db query "$chunk"` without losing
the multi-statement DDL chunks that the `db import` path silently drops
(multi-statement DDL pitfall — see the insforge-cli skill).

Usage:
  python3 _split_sql.py < input.sql > chunks.json
  python3 _split_sql.py input.sql > chunks.json

The output is a JSON array of objects: [{ "index": 1, "sql": "..." }, ...]
so the caller can iterate without having to reparse a custom format.
"""
from __future__ import annotations

import json
import re
import sys
from typing import List, Tuple


def split_sql(text: str) -> List[str]:
    """Return the SQL statements in ``text`` as a list of non-empty strings.

    Statements are separated by semicolons that are not inside a comment,
    string literal, dollar-quoted block, or identifier.
    """
    statements: List[str] = []
    buf: List[str] = []
    i = 0
    n = len(text)

    # Trackers — we don't keep a full per-character class set, we walk
    # the string and decide for each character whether it is a
    # "potential statement boundary" by looking at the context we are
    # in.  When in a state where `;` is a real terminator, we close the
    # current statement.
    in_line_comment = False
    in_block_comment = False
    in_single_quote = False
    in_double_quote = False
    # Dollar-quoted state: either None (not in one) or a (tag, start_pos)
    # tuple where tag is "" for plain $$ ... $$ or e.g. "tag" for $tag$...$tag$.
    in_dollar: Tuple[str, int] | None = None

    # Stack of open parens so we don't get fooled by `;` inside a function
    # call argument list.  We do NOT track BEGIN/END; those are inside
    # PL/pgSQL blocks which sit inside a dollar-quoted region, so the
    # dollar tracker already covers them.
    paren_depth = 0

    line_num = 1
    col_num = 1

    def advance(pos: int) -> None:
        nonlocal line_num, col_num
        if text[pos] == "\n":
            line_num += 1
            col_num = 1
        else:
            col_num += 1

    def emit() -> None:
        # Strip leading/trailing whitespace and a leading comment-only
        # line so we don't ship a "no-op" chunk.
        chunk = "".join(buf).strip()
        if chunk:
            # Drop chunks that are pure comments.
            stripped_lines = []
            for line in chunk.splitlines():
                t = line.strip()
                if t and not t.startswith("--"):
                    stripped_lines.append(line)
            if stripped_lines:
                statements.append("\n".join(stripped_lines).strip())
        buf.clear()

    while i < n:
        c = text[i]
        nxt = text[i + 1] if i + 1 < n else ""

        if in_line_comment:
            buf.append(c)
            advance(i)
            i += 1
            if c == "\n":
                in_line_comment = False
            continue

        if in_block_comment:
            buf.append(c)
            advance(i)
            i += 1
            if c == "*" and nxt == "/":
                buf.append(nxt)
                advance(i)
                i += 1
                in_block_comment = False
            continue

        if in_single_quote:
            buf.append(c)
            advance(i)
            i += 1
            if c == "'":
                if nxt == "'":
                    # Escaped quote inside string.
                    buf.append(nxt)
                    advance(i + 1)
                    i += 2
                else:
                    in_single_quote = False
            continue

        if in_double_quote:
            buf.append(c)
            advance(i)
            i += 1
            if c == '"':
                if nxt == '"':
                    buf.append(nxt)
                    advance(i + 1)
                    i += 2
                else:
                    in_double_quote = False
            continue

        if in_dollar is not None:
            tag, _start = in_dollar
            closer = f"${tag}$"
            buf.append(c)
            advance(i)
            i += 1
            # Check for the closing delimiter; it may have just completed
            # at this position.  We test against the last `len(closer)`
            # characters of buf so the closer can straddle a slice point.
            if len(buf) >= len(closer) and "".join(buf[-len(closer):]) == closer:
                in_dollar = None
            continue

        # --- Default (un-quoted) context ---

        if c == "-" and nxt == "-":
            in_line_comment = True
            buf.append(c)
            advance(i)
            i += 1
            continue

        if c == "/" and nxt == "*":
            in_block_comment = True
            buf.append(c)
            advance(i)
            i += 1
            continue

        if c == "'":
            in_single_quote = True
            buf.append(c)
            advance(i)
            i += 1
            continue

        if c == '"':
            in_double_quote = True
            buf.append(c)
            advance(i)
            i += 1
            continue

        if c == "$":
            # Try to match a dollar-quote opener.  Either $$ ... $$ or
            # $tag$ ... $tag$ where tag is a non-empty identifier-ish
            # string.
            m = re.match(r"\$([A-Za-z_][A-Za-z0-9_]*)?\$", text[i:])
            if m:
                tag = m.group(1) or ""
                in_dollar = (tag, i)
                for ch in m.group(0):
                    buf.append(ch)
                    advance(i)
                    i += 1
                continue

        if c == "(":
            paren_depth += 1
        elif c == ")":
            if paren_depth > 0:
                paren_depth -= 1

        if c == ";" and paren_depth == 0:
            buf.append(c)
            emit()
            advance(i)
            i += 1
            continue

        buf.append(c)
        advance(i)
        i += 1

    # Trailing content (no terminator) — emit it as a final statement
    # so we don't lose anything.
    if buf:
        emit()

    return statements


def main(argv: List[str]) -> int:
    if len(argv) > 2:
        sys.stderr.write("usage: _split_sql.py [path]\n")
        return 2

    if len(argv) == 2:
        with open(argv[1], "r", encoding="utf-8") as f:
            text = f.read()
    else:
        text = sys.stdin.read()

    chunks = split_sql(text)
    json.dump(
        [{"index": i + 1, "sql": c} for i, c in enumerate(chunks)],
        sys.stdout,
        ensure_ascii=False,
    )
    sys.stdout.write("\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
