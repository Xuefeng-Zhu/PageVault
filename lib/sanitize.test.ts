// Tests for HIGH-1: snapshot text sanitization (lib/sanitize.ts).
//
// These are pure-function tests — no fetch, no DB, no React. They pin
// the contract:
//
//   - <script>...</script> blocks (case-insensitive, with attributes)
//     are removed from both titles and markdown text.
//   - HTML comments are removed.
//   - Stray HTML tag shapes (<tag>, </tag>) are removed from markdown.
//   - Titles additionally have *all* angle brackets stripped (legitimate
//     titles never contain literal < or >).
//   - Control characters other than \t \n \r are stripped.
//   - The length caps (500 for titles, 50_000 for markdown) are
//     enforced by the sanitizer, not by a slice at the call site.
//   - The function is a no-op on benign input.
import { describe, it, expect } from 'vitest';
import {
  sanitizeTitle,
  sanitizeMarkdown,
  TITLE_MAX_CHARS,
  MARKDOWN_MAX_CHARS,
} from './sanitize';

describe('sanitizeTitle', () => {
  it('returns empty string for non-string input', () => {
    // Defensive: the sanitizer should never throw on a non-string;
    // a malformed crawl row could conceivably be anything.
    expect(sanitizeTitle(undefined as unknown as string)).toBe('');
    expect(sanitizeTitle(null as unknown as string)).toBe('');
    expect(sanitizeTitle(42 as unknown as string)).toBe('');
  });

  it('passes through benign titles unchanged', () => {
    expect(sanitizeTitle('AWS Lambda Pricing')).toBe('AWS Lambda Pricing');
    expect(sanitizeTitle('Plain text — no HTML & no scripts')).toBe(
      'Plain text — no HTML & no scripts',
    );
    expect(sanitizeTitle('  Padded   title  ')).toBe('Padded title');
  });

  it('strips a literal <script>alert(1)</script> from the title (HIGH-1 acceptance)', () => {
    const out = sanitizeTitle('<script>alert(1)</script>');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out.toLowerCase()).not.toContain('script');
    // The body is gone too, so an alert(1) doesn't survive as text.
    expect(out).not.toContain('alert(1)');
  });

  it('strips script blocks even with attributes and surrounding whitespace', () => {
    const out = sanitizeTitle('Hello <SCRIPT type="text/javascript">evil()</SCRIPT> World');
    expect(out).toBe('Hello World');
  });

  it('strips script blocks even with mixed case and newlines in the body', () => {
    const out = sanitizeTitle('A <ScRiPt>\nfoo();\nbar();\n</SCRipt > B');
    expect(out).toBe('A B');
  });

  it('removes every angle bracket from titles (legitimate titles never have them)', () => {
    expect(sanitizeTitle('A < B > C')).toBe('A B C');
    expect(sanitizeTitle('Compare 5 < 10 and 10 > 5')).toBe(
      'Compare 5 10 and 10 5',
    );
  });

  it('strips HTML comments', () => {
    expect(sanitizeTitle('Title <!-- hidden payload --> here')).toBe(
      'Title here',
    );
  });

  it('strips control characters (NUL, BEL, etc.) but keeps \\t \\n \\r', () => {
    // \x00 NUL, \x07 BEL, \x1F US, \x7F DEL — all removed (NOT
    // replaced with spaces — they simply disappear).
    // \t, \r are turned into single spaces. \n and its
    // surrounding whitespace become a single space. So the title
    // whitespace pass normalizes all whitespace to single spaces.
    // Note: a control char between two visible characters does
    // NOT introduce a space, so "F\x1FG" → "FG", not "F G".
    const dirty = 'A\x00B\x07C\tD\nE\rF\x1FG';
    const out = sanitizeTitle(dirty);
    expect(out).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
    expect(out).toBe('ABC D E FG');
  });

  it('caps the result at TITLE_MAX_CHARS characters', () => {
    const big = 'x'.repeat(TITLE_MAX_CHARS + 1000);
    const out = sanitizeTitle(big);
    expect(out.length).toBe(TITLE_MAX_CHARS);
    expect(out).toBe('x'.repeat(TITLE_MAX_CHARS));
  });

  it('handles a title that is ALL payload (entirely strippable)', () => {
    expect(sanitizeTitle('<script>x</script>')).toBe('');
    expect(sanitizeTitle('<><><>')).toBe('');
  });
});

describe('sanitizeMarkdown', () => {
  it('passes through benign markdown', () => {
    const md = '# Heading\n\nSome **bold** and *italic* text.\n\n- bullet one\n- bullet two';
    expect(sanitizeMarkdown(md)).toBe(md);
  });

  it('strips a literal <script>alert(1)</script> from the body (HIGH-1 acceptance)', () => {
    const out = sanitizeMarkdown('Hello <script>alert(1)</script> world');
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out.toLowerCase()).not.toContain('script');
    // The body is gone too, so an alert(1) doesn't survive as text.
    expect(out).not.toContain('alert(1)');
    // The words "Hello" and "world" survive; whitespace around the
    // removed block leaves a double space — accepted.
    expect(out).toContain('Hello');
    expect(out).toContain('world');
  });

  it('strips script blocks with attributes, whitespace, and multi-line bodies', () => {
    const out = sanitizeMarkdown(
      'Before <script type = "text/javascript" >\n  evil();\n  moreEvil();\n</script > After',
    );
    expect(out).toContain('Before');
    expect(out).toContain('After');
    expect(out.toLowerCase()).not.toContain('script');
    expect(out).not.toContain('evil');
    expect(out).not.toContain('moreEvil');
  });

  it('strips stray HTML tag shapes from markdown (defense in depth)', () => {
    const out = sanitizeMarkdown('A <span>word</span> B <em>and</em> C');
    // The text inside the tags survives; the tag brackets do not.
    expect(out).toBe('A word B and C');
  });

  it('strips closing tags too', () => {
    const out = sanitizeMarkdown('foo</span>bar');
    expect(out).toBe('foobar');
  });

  it('strips self-closing tags', () => {
    const out = sanitizeMarkdown('foo<br/>bar<br />baz');
    expect(out).toBe('foobarbaz');
  });

  it('strips HTML comments', () => {
    // Comments are removed entirely; the spaces on either side of
    // the removed block survive, so the result has a double space.
    expect(sanitizeMarkdown('A <!-- hidden --> B')).toBe('A  B');
  });

  it('strips multi-line HTML comments', () => {
    expect(sanitizeMarkdown('A <!--\nmulti\nline\n--> B')).toBe('A  B');
  });

  it('strips control characters but preserves \\t \\n \\r', () => {
    // Control chars (NUL, BEL, US) are removed; \t \n \r survive
    // and are not collapsed. The run "A\x00B\x07C" therefore
    // becomes "ABC" (no inserted spaces) — not "A B C".
    const out = sanitizeMarkdown('A\x00B\x07C\tD\nE\rF\x1FG');
    expect(out).not.toMatch(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/);
    expect(out).toBe('ABC\tD\nE\rFG');
  });

  it('collapses runs of three or more newlines to a single blank line', () => {
    expect(sanitizeMarkdown('A\n\n\nB\n\n\n\nC')).toBe('A\n\nB\n\nC');
  });

  it('caps the result at MARKDOWN_MAX_CHARS characters', () => {
    const big = 'a'.repeat(MARKDOWN_MAX_CHARS + 5000);
    const out = sanitizeMarkdown(big);
    expect(out.length).toBe(MARKDOWN_MAX_CHARS);
  });

  it('combined payload: <script>, comment, control chars, length cap', () => {
    const dirty =
      'Title' +
      '\x00' +
      '<script>alert(1)</script>' +
      ' <!-- secret -->' +
      ' middle ' +
      '<span>html</span>' +
      ' trailing';
    const out = sanitizeMarkdown(dirty);
    // No '<' or '>' should remain, the script body (alert(1)) is
    // gone, the HTML comment ("<!-- secret -->") is gone, and the
    // NUL control char is removed without inserting a space. The
    // literal "html" survives because it was *text inside* a <span>
    // tag, not a script. (Double spaces around removed blocks are
    // an accepted whitespace contract — the markdown is then
    // normalized in the broader pipeline.)
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out).not.toContain('alert(1)');
    expect(out).not.toContain('secret');
    expect(out).not.toContain('\x00');
    // The "html" text and the surrounding words survive.
    expect(out).toContain('Title');
    expect(out).toContain('middle');
    expect(out).toContain('html');
    expect(out).toContain('trailing');
  });

  it('script-block removal is total: the body text inside the script is also gone', () => {
    // Common mistake: replace "<script>" with "" but leave the body
    // text behind. Our regex must remove the whole span.
    const out = sanitizeMarkdown('safe <script>unsafe-body</script> end');
    // A space on each side of the removed block survives, so the
    // result is "safe  end" (two spaces) — the important contract
    // is that the body text ("unsafe-body") is gone and there is
    // no < or > in the output.
    expect(out).not.toContain('<');
    expect(out).not.toContain('>');
    expect(out.toLowerCase()).not.toContain('script');
    expect(out).not.toContain('unsafe-body');
    expect(out).toContain('safe');
    expect(out).toContain('end');
  });

  it('handles a body that is ALL payload (entirely strippable) without throwing', () => {
    expect(sanitizeMarkdown('<script>x</script>')).toBe('');
    expect(sanitizeMarkdown('<!-- nothing -->')).toBe('');
    expect(sanitizeMarkdown('<tag>only-tag</tag>')).toBe('only-tag');
  });

  it('preserves "5 < 10" comparison text (the < is not a tag)', () => {
    // The HTML_TAG_RE only matches `<\/?[a-zA-Z]…>` (must look like
    // a tag — letter or slash-letter, then content, then `>`). The
    // prose "5 < 10" is followed by a digit, not a letter, so the
    // regex leaves it alone. This is intentional: legitimate prose
    // can contain `<` and we don't want to over-strip.
    const out = sanitizeMarkdown('5 < 10 means ten is greater');
    expect(out).toBe('5 < 10 means ten is greater');
  });
});

describe('length-cap constants', () => {
  it('TITLE_MAX_CHARS is 500 (matches the HIGH-1 suggestion)', () => {
    expect(TITLE_MAX_CHARS).toBe(500);
  });

  it('MARKDOWN_MAX_CHARS is 50_000 (matches the existing schema cap)', () => {
    expect(MARKDOWN_MAX_CHARS).toBe(50_000);
  });
});
