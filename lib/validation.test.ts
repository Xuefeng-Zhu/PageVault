// Tests for lib/validation.ts — pure input-validation functions.
// Covers the cases flagged in the audit: URL regex edge cases, 200-char
// cap on label/name, page-type normalization, batch validation (1-100).
import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  normalizeCategory,
  normalizePageType,
  validateRoomField,
  validateUrlEntry,
  validateUrlBatch,
  buildWatchedUrlRows,
} from './validation';

describe('normalizeCategory', () => {
  it('returns "competitor" for missing/empty/whitespace', () => {
    expect(normalizeCategory(undefined)).toBe('competitor');
    expect(normalizeCategory(null)).toBe('competitor');
    expect(normalizeCategory('')).toBe('competitor');
    expect(normalizeCategory('   ')).toBe('competitor');
  });

  it('returns the value unchanged for known categories', () => {
    for (const v of ['competitor', 'vendor', 'policy', 'docs', 'custom'] as const) {
      expect(normalizeCategory(v)).toBe(v);
    }
  });

  it('passes through unknown categories as-is (caller must validate if needed)', () => {
    expect(normalizeCategory('rocket')).toBe('rocket');
  });
});

describe('normalizePageType', () => {
  it('returns "unknown" for missing/empty/whitespace', () => {
    expect(normalizePageType(undefined)).toBe('unknown');
    expect(normalizePageType(null)).toBe('unknown');
    expect(normalizePageType('')).toBe('unknown');
    expect(normalizePageType('   ')).toBe('unknown');
  });

  it('lowercases and accepts all 9 valid values', () => {
    for (const v of [
      'homepage', 'pricing', 'docs', 'changelog', 'careers',
      'terms', 'privacy', 'trust', 'unknown',
    ] as const) {
      expect(normalizePageType(v)).toBe(v);
      expect(normalizePageType(v.toUpperCase())).toBe(v);
      expect(normalizePageType(`  ${v}  `)).toBe(v);
    }
  });

  it('returns "unknown" for any non-recognized value', () => {
    expect(normalizePageType('blog')).toBe('unknown');
    expect(normalizePageType('about-us')).toBe('unknown');
    expect(normalizePageType('Product')).toBe('unknown');
  });
});

describe('validateRoomField', () => {
  it('rejects undefined/null', () => {
    const r1 = validateRoomField(undefined, 'name');
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.message).toMatch(/required/);

    const r2 = validateRoomField(null, 'targetName');
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.field).toBe('targetName');
  });

  it('rejects whitespace-only', () => {
    const r = validateRoomField('   ', 'name');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/empty/);
  });

  it('rejects strings over 200 chars', () => {
    const r = validateRoomField('a'.repeat(201), 'name');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/200/);
  });

  it('accepts exactly 200 chars and trims', () => {
    const r = validateRoomField('  ' + 'a'.repeat(200), 'name');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('a'.repeat(200));
    expect(r.value.length).toBe(200);
  });

  it('trims surrounding whitespace on success', () => {
    const r = validateRoomField('  hello  ', 'name');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value).toBe('hello');
  });

  it('uses the field name in the error message', () => {
    const r = validateRoomField('', 'targetName');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('targetName');
  });
});

describe('validateUrlEntry', () => {
  it('rejects empty/missing url', () => {
    expect(validateUrlEntry({ url: '' }).ok).toBe(false);
    expect(validateUrlEntry({ url: '   ' }).ok).toBe(false);
  });

  it('accepts http and https', () => {
    expect(validateUrlEntry({ url: 'http://example.com' }).ok).toBe(true);
    expect(validateUrlEntry({ url: 'https://example.com/path?q=1' }).ok).toBe(true);
  });

  it('rejects non-http schemes and bare hostnames', () => {
    for (const bad of [
      'ftp://example.com',
      'javascript:alert(1)',
      'example.com',
      '//example.com',
      'data:text/html,foo',
      'file:///etc/passwd',
    ]) {
      const r = validateUrlEntry({ url: bad });
      expect(r.ok, `expected reject: ${bad}`).toBe(false);
    }
  });

  it('rejects urls containing whitespace', () => {
    const r = validateUrlEntry({ url: 'https://example.com/foo bar' });
    expect(r.ok).toBe(false);
  });

  it('rejects labels over 200 chars', () => {
    const r = validateUrlEntry({ url: 'https://example.com', label: 'x'.repeat(201) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('label');
  });

  it('trims label on success', () => {
    const r = validateUrlEntry({ url: 'https://example.com', label: '  acme  ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.label).toBe('acme');
  });

  it('trims url on success', () => {
    const r = validateUrlEntry({ url: '  https://example.com  ' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.url).toBe('https://example.com');
  });
});

describe('validateUrlBatch', () => {
  it('rejects non-arrays', () => {
    expect(validateUrlBatch(undefined).ok).toBe(false);
    expect(validateUrlBatch(null).ok).toBe(false);
    expect(validateUrlBatch('not-an-array' as unknown as never).ok).toBe(false);
  });

  it('rejects empty arrays', () => {
    expect(validateUrlBatch([]).ok).toBe(false);
  });

  it('rejects arrays over 100', () => {
    const arr = Array.from({ length: 101 }, () => ({ url: 'https://example.com' }));
    const r = validateUrlBatch(arr);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toMatch(/100/);
  });

  it('accepts arrays of 1 to 100 valid entries', () => {
    expect(validateUrlBatch([{ url: 'https://example.com' }]).ok).toBe(true);
    const arr100 = Array.from({ length: 100 }, (_, i) => ({
      url: `https://example.com/${i}`,
    }));
    expect(validateUrlBatch(arr100).ok).toBe(true);
  });

  it('is all-or-nothing: one bad entry fails the whole batch', () => {
    const arr = [
      { url: 'https://example.com' },
      { url: 'not-a-url' },
      { url: 'https://example.com/3' },
    ];
    const r = validateUrlBatch(arr);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.field).toBe('url');
  });
});

describe('buildWatchedUrlRows', () => {
  it('produces one row per entry, normalized, with the given roomId', () => {
    const rows = buildWatchedUrlRows('room-1', [
      { url: '  https://example.com  ', label: '  acme  ', pageType: 'PRICING' },
      { url: 'https://other.com', pageType: 'unknown-string' },
    ]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      roomId: 'room-1',
      url: 'https://example.com',
      label: 'acme',
      pageType: 'pricing',
    });
    expect(rows[1].label).toBeNull();
    expect(rows[1].pageType).toBe('unknown');
  });
});

describe('validation property checks', () => {
  it('arbitrary long whitespace strings never validate as urls', () => {
    fc.assert(
      fc.property(fc.string(), (s) => {
        if (s.trim().length === 0) return true; // empty case is handled by the empty check
        const r = validateUrlEntry({ url: s });
        // If the input has any whitespace anywhere, the regex must reject it.
        if (/\s/.test(s)) {
          return !r.ok;
        }
        return true;
      }),
      { numRuns: 50 }
    );
  });

  it('arbitrary valid http(s) URLs round-trip', () => {
    fc.assert(
      fc.property(
        fc.webUrl({ validSchemes: ['http', 'https'] }),
        (url) => {
          const r = validateUrlEntry({ url });
          expect(r.ok).toBe(true);
          if (r.ok) {
            expect(r.value.url).toBe(url);
          }
        }
      ),
      { numRuns: 50 }
    );
  });
});
