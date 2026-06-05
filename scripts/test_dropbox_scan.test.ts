// Regression test for CRITICAL-3 (docs/qa-bug-hunt.md).
//
// scripts/test_dropbox_scan.ts used to call `require('crypto').createHash(...)`
// inline, mixing CommonJS into a file that otherwise uses top-level ESM
// `import` statements. The file is run with `npx tsx` and is part of the
// TypeScript surface that Next.js / Vitest compile — the CommonJS require()
// was fragile under Turbopack, broke tree-shaking, and would fail outright
// under strict ESM. The fix is the same shape as CRITICAL-3 in lib/auth.ts:
// hoist a top-level `import { createHash } from 'node:crypto'` and replace
// the inline `require('crypto').createHash(...)` call with the imported
// binding.
//
// This test guards against a regression to the bug by asserting the file's
// source shape:
//
//   1. No CommonJS `require(` call (after stripping line/block comments, so
//      future regression notes in comments can't mask a real call site).
//   2. A top-level `import { ... createHash ... } from 'node:crypto'`
//      statement (the ESM replacement).
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const SCRIPT_PATH = resolve(__dirname, 'test_dropbox_scan.ts');
const scriptSource = readFileSync(SCRIPT_PATH, 'utf-8');

function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '') // block comments
    .replace(/(^|[^:])\/\/.*$/gm, '$1'); // line comments (skip `://` from URLs)
}

describe('CRITICAL-3: scripts/test_dropbox_scan.ts uses ESM imports, not require()', () => {
  it('does not contain a CommonJS require() call', () => {
    const stripped = stripComments(scriptSource);
    expect(stripped).not.toMatch(/\brequire\s*\(/);
  });

  it('imports createHash from node:crypto at the top level', () => {
    expect(scriptSource).toMatch(
      /^\s*import\s*\{[^}]*\bcreateHash\b[^}]*\}\s*from\s*['"]node:crypto['"]/m
    );
  });
});
