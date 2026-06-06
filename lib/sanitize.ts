// Snapshot text sanitization (HIGH-1 in docs/qa-bug-hunt.md).
//
// The crawler fetches arbitrary user-supplied URLs and persists the
// resulting HTML→markdown text into `snapshots.markdown_text` and
// `snapshots.page_title`. While the page-rendering components do not
// currently use `dangerouslySetInnerHTML` (verified by grep at the time
// of writing), the LLM system prompt asks for "evidence" items that are
// direct quotes of the same markdown, and those are surfaced verbatim to
// the dashboard's <DiffViewer> and the change-detail page. If a future
// component switches to `dangerouslySetInnerHTML`, attacker-controlled
// HTML in the stored snapshot would land as XSS.
//
// This module is the persistence-layer defense against that. We strip:
//   - All control characters except \n, \r, \t
//   - Literal "<script>...</script>" blocks (case-insensitive, with
//     optional attributes and whitespace)
//   - All angle brackets in titles (titles are a single line of text;
//     legitimate titles never contain < or >)
//   - Lone angle brackets in markdown text that look like an HTML tag
//     start/end (anything that matches the HTML-comment shape or the
//     standard `<tag>` or `</tag>` shape). We do NOT strip every `<`
//     in markdown because legitimate content (code samples, math
//     comparisons) may contain them — but the most common XSS vector
//     (a <script> block) is gone.
//
// We also enforce the length caps in code, not just with a slice at the
// call site, so a misconfigured caller cannot bypass them.
//
// The cap constants are exported so tests and any future call site can
// reference the same value.

/** Max length of a stored page title (chars, not bytes). */
export const TITLE_MAX_CHARS = 500;

/** Max length of a stored markdown body (chars, not bytes). */
export const MARKDOWN_MAX_CHARS = 50_000;

// Matches a `<script ...>...</script>` block case-insensitively, allowing
// arbitrary attributes / whitespace between the tag name and the closing
// `>`. We do NOT try to match the body of the script — a self-closing or
// unterminated script tag is also caught because the regex requires the
// closing `</script>`. The `[\s\S]*?` makes `.` match newlines.
const SCRIPT_BLOCK_RE = /<script\b[^>]*>[\s\S]*?<\/script\s*>/gi;

// HTML comment block: `<!-- ... -->` (case-insensitive). Comments are
// sometimes used to hide payloads that get rendered when an HTML
// component is accidentally swapped in.
const HTML_COMMENT_RE = /<!--[\s\S]*?-->/g;

// A "<tag>" or "</tag>" shape. We do not match the contents of the tag
// here — htmlToMarkdown has already stripped most HTML — but we DO
// catch stray angle-bracket pairs that the markdown converter missed
// (e.g. inside fenced code blocks the user controls).
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;

// Catches U+0000–U+001F except \t (0x09), \n (0x0A), \r (0x0D), and
// U+007F (DEL). \t\n\r are the only control characters we preserve.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

/**
 * Normalize a page title for persistence.
 *
 * - Strips control characters (except \t\n\r)
 * - Removes `<script>...</script>` blocks (case-insensitive)
 * - Removes HTML comments
 * - Strips all remaining angle brackets (a legitimate page title never
 *   contains literal `<` or `>`)
 * - Collapses runs of whitespace to a single space
 * - Trims surrounding whitespace
 * - Caps the result at {@link TITLE_MAX_CHARS} characters
 *
 * Returns the empty string for an input that was entirely junk.
 */
export function sanitizeTitle(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(CONTROL_CHARS_RE, '')
    .replace(SCRIPT_BLOCK_RE, '')
    .replace(HTML_COMMENT_RE, '')
    .replace(/[<>]/g, '')
    .replace(/[\t\r]/g, ' ')        // tabs and carriage returns become a space
    .replace(/[ ]+/g, ' ')          // collapse runs of spaces
    .replace(/\s*\n\s*/g, ' ')      // newlines and their surrounding whitespace become a space
    .trim()
    .slice(0, TITLE_MAX_CHARS);
}

/**
 * Normalize a markdown body for persistence.
 *
 * - Strips control characters (except \t\n\r)
 * - Removes `<script>...</script>` blocks (case-insensitive)
 * - Removes HTML comments
 * - Removes stray HTML tag shapes (`<tag>`, `</tag>`) so the markdown
 *   can't carry executable HTML across into a future renderer
 * - Collapses runs of blank lines to a single blank line
 * - Trims surrounding whitespace
 * - Caps the result at {@link MARKDOWN_MAX_CHARS} characters
 *
 * Note: the markdown text coming out of `htmlToMarkdown` is a *plain-
 * text* representation (the HTML-to-text strip happens in lib/scan.ts
 * via `<[^>]+>`), so most HTML tags are already gone. The sanitizer
 * here is defense-in-depth: a future `htmlToMarkdown` rewrite that
 * preserves more HTML (or a different crawl source) still has a
 * layer between the network and the database.
 */
export function sanitizeMarkdown(input: string): string {
  if (typeof input !== 'string') return '';
  return input
    .replace(CONTROL_CHARS_RE, '')
    .replace(SCRIPT_BLOCK_RE, '')
    .replace(HTML_COMMENT_RE, '')
    .replace(HTML_TAG_RE, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .slice(0, MARKDOWN_MAX_CHARS);
}
