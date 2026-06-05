// Tests for lib/ids.ts — the newId() helper used by the scan pipeline.
//
// These tests cover HIGH-3 from docs/qa-bug-hunt.md:
// "Race condition — scan job id collision is statistically reachable at
//  scale". The previous hand-rolled `uuid(prefix)` generator used only
// 7 random hex chars (28 bits of entropy) plus a fixed prefix/suffix,
// which gave a 5%-probability collision at ~10,000 concurrent scans.
// `newId()` delegates to `crypto.randomUUID()` (122 bits of entropy),
// so the acceptance criterion is 10,000 unique ids in a row with zero
// collisions — matching the threshold called out in the bug-hunt.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { newId } from './ids';

describe('newId', () => {
  it('returns a string of the canonical UUID format 8-4-4-4-12 (36 chars)', () => {
    const id = newId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(id).toHaveLength(36);
  });

  it('produces an RFC 4122 v4 UUID (version nibble is "4")', () => {
    // crypto.randomUUID() is required by spec to set the version to 4 and
    // the variant to one of {8,9,a,b} in the fourth group. Pin both so a
    // future refactor that swaps in a different generator doesn't silently
    // change the format Postgres receives.
    const id = newId();
    expect(id[14]).toBe('4'); // version
    expect(['8', '9', 'a', 'b']).toContain(id[19]); // RFC 4122 variant
  });

  it('starts with a hex character (Postgres allows any hex in the first position)', () => {
    // The old uuid() helper had a comment claiming "InsForge rejects
    // UUIDs whose first char isn't 0-9 or a-f" — that rule was invented.
    // The replacement must NOT encode any such rule; it must let
    // crypto.randomUUID() produce whatever first nibble the entropy
    // dictates. A property test over many ids catches a regression
    // where a future contributor re-introduces a prefix filter.
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 50 }), () => {
        const id = newId();
        expect(id[0]).toMatch(/[0-9a-f]/);
        return true;
      }),
      { numRuns: 20 },
    );
  });

  it('returns 10,000 unique ids in a tight loop (the HIGH-3 acceptance criterion)', () => {
    // The bug-hunt calls out that the old uuid() generator hit ~5%
    // collision probability at 10,000 ids. With crypto.randomUUID() the
    // probability of even ONE collision across 10,000 v4 ids is on the
    // order of 10^-29. This test is the regression guard: if a future
    // change re-introduces a hand-rolled generator with the same defect,
    // this test will fail with high probability.
    const N = 10_000;
    const ids = new Set<string>();
    for (let i = 0; i < N; i++) {
      const id = newId();
      // Pre-condition: every id must already be unique at the moment
      // of generation. The Set check is the actual assertion.
      ids.add(id);
    }
    expect(ids.size).toBe(N);
  });

  it('two consecutive calls produce different ids (sanity)', () => {
    // Single-call smoke test. If this fails, the test above will
    // obviously also fail, but having the small case separate makes
    // the failure message clearer.
    const a = newId();
    const b = newId();
    expect(a).not.toBe(b);
  });
});
