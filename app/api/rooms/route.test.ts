// Static regression test: pins that the CRITICAL-4 fix in
// app/api/rooms/route.ts (docs/qa-bug-hunt.md) is not silently
// re-introduced. The previous version shell-out to
// `npx @insforge/cli schedules ...` with string interpolation.
//
// We pin the *absence* of certain dangerous APIs at the file level
// because the route's runtime side effects (DB inserts, storage
// folder creation) make a full end-to-end test expensive and
// orthogonal to the security property. If anyone re-adds
// `execAsync(`, `execFile(`, `child_process`, or `npx @insforge/cli`
// in this file, this test fails.
//
// Note: comments mentioning those APIs (explaining what was
// removed) are allowed — we only flag actual code.

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadRouteSource(): string {
  return readFileSync(
    resolve(__dirname, './route.ts'),
    'utf8',
  );
}

// Strip /* ... */ block comments and // line comments before
// scanning. The CRITICAL-4 fix file legitimately mentions the
// removed APIs in comments; we want to catch code, not prose.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

describe('CRITICAL-4: app/api/rooms/route.ts contains no shell-out primitives', () => {
  it('does not import child_process', () => {
    const code = stripComments(loadRouteSource());
    expect(code).not.toMatch(/from\s+['"]node:child_process['"]/);
    expect(code).not.toMatch(/from\s+['"]child_process['"]/);
    expect(code).not.toMatch(/require\(['"]child_process['"]\)/);
  });

  it('does not call execAsync / execFile / exec / spawn / spawnSync', () => {
    const code = stripComments(loadRouteSource());
    expect(code).not.toMatch(/\bexecAsync\s*\(/);
    expect(code).not.toMatch(/\bexecFile\s*\(/);
    // Match `exec(` only when not preceded by another word char
    // (e.g. avoid matching `process.exec(`). We don't use `process.exec`
    // anywhere in this file, so the simpler check is fine.
    expect(code).not.toMatch(/(^|[^a-zA-Z])exec\s*\(/);
    expect(code).not.toMatch(/\bspawn\s*\(/);
    expect(code).not.toMatch(/\bspawnSync\s*\(/);
  });

  it('does not invoke npx or @insforge/cli', () => {
    const code = stripComments(loadRouteSource());
    expect(code).not.toMatch(/\bnpx\b/);
    expect(code).not.toMatch(/@insforge\/cli/);
  });
});
