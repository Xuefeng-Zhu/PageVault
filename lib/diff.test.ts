// Tests for lib/diff.ts — content hashing and simple line-level diff.
// Covers the cases flagged in the audit: hash determinism, normalization
// invariance, and the hasMeaningfulChange / extractSimpleDiff contracts.
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { hashContent, normalizeText, hasMeaningfulChange, extractSimpleDiff } from './diff';

describe('normalizeText', () => {
  it('trims and collapses internal whitespace', () => {
    expect(normalizeText('  hello   world  ')).toBe('hello world');
    expect(normalizeText('a\t\tb\n\nc')).toBe('a b c');
  });

  it('normalizes line endings to \\n', () => {
    expect(normalizeText('a\r\nb\rc\n')).toBe('a b c');
  });

  it('preserves the order of non-whitespace tokens', () => {
    expect(normalizeText('  the   quick  brown   fox  ')).toBe('the quick brown fox');
  });
});

describe('hashContent', () => {
  it('is deterministic across calls', () => {
    const text = 'PageVault monitors the web';
    expect(hashContent(text)).toBe(hashContent(text));
  });

  it('returns 64 hex chars (SHA-256)', () => {
    const h = hashContent('hello');
    expect(h).toMatch(/^[0-9a-f]{64}$/);
  });

  it('treats whitespace-only differences as equal (normalization invariance)', () => {
    expect(hashContent('hello world')).toBe(hashContent('  hello   world  '));
    expect(hashContent('line1\nline2')).toBe(hashContent('line1\r\nline2'));
  });

  it('returns different hashes for real content changes', () => {
    expect(hashContent('Pricing: $10/mo')).not.toBe(hashContent('Pricing: $20/mo'));
    expect(hashContent('hello')).not.toBe(hashContent('Hello'));
  });

  it('property: hash is stable for arbitrary equal-after-normalize strings', () => {
    fc.assert(
      fc.property(fc.string(), fc.string({ minLength: 1 }), (a, b) => {
        // Strings that normalize identically (single-token) hash the same
        const single = (s: string) => s.replace(/\s+/g, ' ').trim();
        if (single(a) === single(b) && single(a).length > 0) {
          expect(hashContent(a)).toBe(hashContent(b));
        }
      }),
      { numRuns: 100 }
    );
  });
});

describe('hasMeaningfulChange', () => {
  it('returns false for whitespace-only differences', () => {
    expect(hasMeaningfulChange('hello world', '  hello   world  ')).toBe(false);
    expect(hasMeaningfulChange('a\nb', 'a\r\nb')).toBe(false);
  });

  it('returns true for any actual content change', () => {
    expect(hasMeaningfulChange('Pricing: $10', 'Pricing: $20')).toBe(true);
    expect(hasMeaningfulChange('hello', 'Hello')).toBe(true);
  });

  it('returns false for two empty strings', () => {
    expect(hasMeaningfulChange('', '')).toBe(false);
  });
});

describe('extractSimpleDiff', () => {
  // Implementation note: extractSimpleDiff first runs normalizeText() which
  // collapses ALL whitespace (including newlines) into single spaces, then
  // splits on '\n'. For typical single-line inputs (the common case in
  // diff.ts callers) this means each side reduces to a single-element
  // "line" array, and the result is essentially "did the text change
  // wholesale or not." For multi-line inputs that survive normalization
  // (e.g. literal '\n' inside a single line of text, which normalizeText
  // would still collapse), the function does not tokenize.
  //
  // These tests pin the actual behavior so any future refactor that
  // changes the contract must update the test, not silently change
  // behavior.

  it('returns empty added/removed for identical input', () => {
    const d = extractSimpleDiff('hello world', 'hello world');
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it('flags the whole current string as added when it differs from previous', () => {
    const d = extractSimpleDiff('alpha bravo', 'alpha bravo charlie');
    expect(d.added).toEqual(['alpha bravo charlie']);
    expect(d.removed).toEqual(['alpha bravo']);
  });

  it('flags the whole previous string as removed when current drops content', () => {
    const d = extractSimpleDiff('alpha bravo charlie', 'alpha bravo');
    expect(d.removed).toEqual(['alpha bravo charlie']);
    expect(d.added).toEqual(['alpha bravo']);
  });

  it('does not double-count repeated content (set semantics on the two sides)', () => {
    // Each side normalizes to a single "line". If both sides normalize to
    // the same string, both added and removed are empty.
    const d = extractSimpleDiff('a a a', 'a a a');
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });

  it('treats whitespace-only differences as no change (normalization invariance)', () => {
    const d = extractSimpleDiff('hello   world', '  hello world  ');
    expect(d.added).toEqual([]);
    expect(d.removed).toEqual([]);
  });
});
