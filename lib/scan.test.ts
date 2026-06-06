// Tests for HIGH-4: SSRF guard on the direct HTTP crawler in lib/scan.ts.
//
// `crawlOne()` used to call `fetch(url)` with the user-supplied source URL.
// A malicious or careless `tracked_pages.source_url` could point at
// 127.0.0.1, RFC1918 ranges, or the cloud metadata service
// 169.254.169.254 — turning a tenant's scan into an SSRF pivot from
// the Next.js server's network. The fix adds validateCrawlUrl() (called
// before any outbound fetch) which rejects URLs whose hostname resolves
// to a private / loopback / link-local / cloud-metadata / multicast /
// reserved address.
//
// Also covers HIGH-1: persistence-layer sanitization. A page whose
// `<title>` or body contains `<script>alert(1)</script>` must have the
// payload stripped before it lands in `snapshots.markdown_text` or
// `page_title`. We test this by piping the HTML through
// `htmlToMarkdown` and then `sanitizeTitle` / `sanitizeMarkdown` — the
// same two calls `scanOne()` makes before `dbInsert`.
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest';
import { isBlockedAddress } from './scan';
import { sanitizeMarkdown, sanitizeTitle } from './sanitize';

// Importing lib/scan.ts at the top level triggers a module-load throw
// when INSFORGE_API_URL is unset (see lib/scan.ts line 444-446: the
// scan module refuses to load against an unknown InsForge tenant).
// The HIGH-1 tests in this file don't need the InsForge base URL —
// they only need `htmlToMarkdown` (an exported pure function) — so
// we set the env var to a placeholder before the dynamic import.
// The same trick is used by the existing SSRF tests, which also do
// their scan.ts work via dynamic import.
beforeAll(() => {
  if (!process.env.INSFORGE_API_URL) {
    process.env.INSFORGE_API_URL = 'https://test.invalid';
  }
});

async function loadHtmlToMarkdown(): Promise<typeof import('./scan').htmlToMarkdown> {
  const mod = await import('./scan');
  return mod.htmlToMarkdown;
}

// The URL-level tests (validateCrawlUrl) need to control what dns.lookup
// returns so they don't hit the real network. We use vi.hoisted() to share
// a mutable "what to return" between the test bodies and the mock factory,
// since vi.mock() is hoisted above all imports.
const dnsBehavior = vi.hoisted(() => ({
  // Each entry: hostname -> addresses to return (or null to throw ENOTFOUND)
  responses: new Map<string, string[]>(),
  // What was looked up
  looked: [] as string[],
}));

vi.mock('node:dns/promises', () => ({
  default: {
    async lookup(host: string, _opts: unknown) {
      dnsBehavior.looked.push(host);
      const r = dnsBehavior.responses.get(host);
      if (r === undefined) {
        const err = new Error(`getaddrinfo ENOTFOUND ${host}`) as Error & { code: string };
        err.code = 'ENOTFOUND';
        throw err;
      }
      return r.map((address) => ({ address, family: address.includes(':') ? 6 : 4 }));
    },
  },
}));

// Now import the function-under-test. The mock above will be applied
// when this import resolves. We import inside describe blocks because
// lib/scan.ts has top-level side effects (it throws if INSFORGE_API_URL
// is missing) — we don't need those for the pure-function tests but the
// import is still required to set up the module.
async function loadValidateCrawlUrl(): Promise<(url: string) => Promise<string>> {
  const mod = await import('./scan');
  return mod.validateCrawlUrl;
}

describe('isBlockedAddress', () => {
  it('blocks IPv4 loopback (127.0.0.0/8)', () => {
    expect(isBlockedAddress('127.0.0.1')).toBe(true);
    expect(isBlockedAddress('127.255.255.254')).toBe(true);
  });

  it('blocks IPv4 private RFC1918 ranges', () => {
    expect(isBlockedAddress('10.0.0.1')).toBe(true);
    expect(isBlockedAddress('10.255.255.255')).toBe(true);
    expect(isBlockedAddress('172.16.0.1')).toBe(true);
    expect(isBlockedAddress('172.31.255.255')).toBe(true);
    expect(isBlockedAddress('192.168.0.1')).toBe(true);
    expect(isBlockedAddress('192.168.255.255')).toBe(true);
  });

  it('blocks link-local 169.254.0.0/16 including AWS instance metadata 169.254.169.254', () => {
    expect(isBlockedAddress('169.254.0.1')).toBe(true);
    expect(isBlockedAddress('169.254.169.254')).toBe(true);
  });

  it('blocks 0.0.0.0/8 and 255.255.255.255', () => {
    expect(isBlockedAddress('0.0.0.0')).toBe(true);
    expect(isBlockedAddress('0.1.2.3')).toBe(true);
    expect(isBlockedAddress('255.255.255.255')).toBe(true);
  });

  it('blocks CGNAT 100.64.0.0/10', () => {
    expect(isBlockedAddress('100.64.0.1')).toBe(true);
    expect(isBlockedAddress('100.127.255.254')).toBe(true);
  });

  it('blocks multicast 224.0.0.0/4 and reserved 240.0.0.0/4', () => {
    expect(isBlockedAddress('224.0.0.1')).toBe(true);
    expect(isBlockedAddress('239.255.255.255')).toBe(true);
    expect(isBlockedAddress('240.0.0.1')).toBe(true);
    expect(isBlockedAddress('255.255.255.254')).toBe(true);
  });

  it('blocks IPv6 loopback (::1) and IPv4-mapped loopback (::ffff:127.0.0.1)', () => {
    expect(isBlockedAddress('::1')).toBe(true);
    expect(isBlockedAddress('::ffff:127.0.0.1')).toBe(true);
  });

  it('blocks IPv6 unique-local fc00::/7', () => {
    expect(isBlockedAddress('fc00::1')).toBe(true);
    expect(isBlockedAddress('fd12:3456:789a::1')).toBe(true);
  });

  it('blocks IPv6 link-local fe80::/10', () => {
    expect(isBlockedAddress('fe80::1')).toBe(true);
    expect(isBlockedAddress('febf:ffff::1')).toBe(true);
  });

  it('blocks IPv6 unspecified ::', () => {
    expect(isBlockedAddress('::')).toBe(true);
  });

  it('allows public IPv4 addresses', () => {
    expect(isBlockedAddress('8.8.8.8')).toBe(false);
    expect(isBlockedAddress('1.1.1.1')).toBe(false);
    expect(isBlockedAddress('93.184.216.34')).toBe(false);
  });

  it('allows public IPv6 addresses', () => {
    expect(isBlockedAddress('2606:4700:4700::1111')).toBe(false);
    expect(isBlockedAddress('2001:4860:4860::8888')).toBe(false);
  });

  it('returns false for unparseable input (validateCrawlUrl rejects these earlier)', () => {
    expect(isBlockedAddress('not-an-ip')).toBe(false);
    expect(isBlockedAddress('')).toBe(false);
  });
});

describe('validateCrawlUrl (URL-level rejections)', () => {
  it('throws on a non-URL string', async () => {
    const v = await loadValidateCrawlUrl();
    await expect(v('not-a-url')).rejects.toThrow(/invalid url/i);
  });

  it('throws on an empty string', async () => {
    const v = await loadValidateCrawlUrl();
    await expect(v('')).rejects.toThrow(/invalid url/i);
  });

  it('throws on non-http(s) protocols (file:, ftp:, gopher:, data:)', async () => {
    const v = await loadValidateCrawlUrl();
    await expect(v('file:///etc/passwd')).rejects.toThrow(/protocol/i);
    await expect(v('ftp://example.com/')).rejects.toThrow(/protocol/i);
    await expect(v('gopher://example.com/')).rejects.toThrow(/protocol/i);
    await expect(v('data:text/html,<h1>x</h1>')).rejects.toThrow(/protocol/i);
  });

  it('throws on the AWS instance metadata URL 169.254.169.254/latest/meta-data/', async () => {
    // The original finding: this URL must be rejected before any fetch.
    const v = await loadValidateCrawlUrl();
    await expect(v('http://169.254.169.254/latest/meta-data/'))
      .rejects.toThrow(/169\.254\.169\.254|blocked|internal/i);
  });

  it('throws on 127.0.0.1 with an explanatory error', async () => {
    const v = await loadValidateCrawlUrl();
    await expect(v('http://127.0.0.1/admin')).rejects.toThrow(/127\.0\.0\.1|loopback|blocked/i);
  });

  it('throws on RFC1918 private addresses', async () => {
    const v = await loadValidateCrawlUrl();
    await expect(v('http://10.0.0.1/internal')).rejects.toThrow(/private|blocked/i);
    await expect(v('http://192.168.1.1/router')).rejects.toThrow(/private|blocked/i);
    await expect(v('http://172.16.0.1/svc')).rejects.toThrow(/private|blocked/i);
  });

  it('throws on IPv6 loopback http://[::1]/', async () => {
    const v = await loadValidateCrawlUrl();
    await expect(v('http://[::1]/admin')).rejects.toThrow(/loopback|blocked/i);
  });

  it('throws on the localhost hostname', async () => {
    const v = await loadValidateCrawlUrl();
    await expect(v('http://localhost/admin')).rejects.toThrow(/localhost|loopback|blocked/i);
  });
});

describe('validateCrawlUrl (DNS rebinding defense)', () => {
  it('throws when DNS resolves a public hostname to a private IP', async () => {
    // Simulate a DNS rebinding attack: attacker.example.com resolves to
    // 10.0.0.5. The validator must follow the resolution and block.
    dnsBehavior.responses.set('attacker.example.com', ['10.0.0.5']);
    const v = await loadValidateCrawlUrl();
    await expect(v('http://attacker.example.com/'))
      .rejects.toThrow(/10\.0\.0\.5|private|blocked/i);
    expect(dnsBehavior.looked).toContain('attacker.example.com');
  });

  it('throws when DNS resolves to the cloud-metadata IP', async () => {
    dnsBehavior.responses.set('meta.attacker.example.com', ['169.254.169.254']);
    const v = await loadValidateCrawlUrl();
    await expect(v('http://meta.attacker.example.com/latest/meta-data/'))
      .rejects.toThrow(/169\.254\.169\.254|blocked|metadata/i);
  });

  it('throws when one of several resolved addresses is blocked (mixed A records)', async () => {
    // Realistic rebinding: a hostname has a public AND a private address.
    dnsBehavior.responses.set('mixed.example.com', ['93.184.216.34', '10.0.0.5']);
    const v = await loadValidateCrawlUrl();
    await expect(v('http://mixed.example.com/'))
      .rejects.toThrow(/10\.0\.0\.5|private|blocked/i);
  });

  it('accepts a hostname that resolves to a public IP', async () => {
    dnsBehavior.responses.set('example.com', ['93.184.216.34']);
    const v = await loadValidateCrawlUrl();
    await expect(v('http://example.com/')).resolves.toBe('http://example.com/');
  });

  it('rejects when DNS lookup fails (refuse to crawl an unresolvable target)', async () => {
    // nxdomain.example.com has no entry in dnsBehavior.responses,
    // so the mock throws ENOTFOUND.
    const v = await loadValidateCrawlUrl();
    await expect(v('http://nxdomain.example.com/'))
      .rejects.toThrow(/DNS lookup failed/i);
  });
});

describe('HIGH-1: snapshot text is sanitized before dbInsert (lib/scan.ts:scanOne)', () => {
  // The HIGH-1 acceptance criterion is: a crawled page with
  // `<script>alert(1)</script>` in the title or markdown has the
  // payload stripped before the dbInsert call.
  //
  // We test the *pipeline* the scan actually runs:
  //   HTML → htmlToMarkdown() → sanitizeTitle() + sanitizeMarkdown()
  //
  // That mirrors what scanOne() does in production (lib/scan.ts
  // scanOne step 1 → step "5. Insert the new snapshot"). If a future
  // refactor removes the sanitizer from the scan pipeline, this
  // test still passes (it's testing the two functions, not the
  // wiring) — the lint rule and the snapshot row format pin the
  // wiring separately. The point of this test is to assert the
  // *contract*: adversarial HTML in → safe plain text out.
  it('strips <script>alert(1)</script> from a malicious <title>', async () => {
    const htmlToMarkdown = await loadHtmlToMarkdown();
    const html = `<!doctype html>
<html>
  <head><title><script>alert(1)</script></title></head>
  <body><p>Hello</p></body>
</html>`;
    const { title } = htmlToMarkdown(html);
    // htmlToMarkdown takes the raw text between <title> and </title>,
    // which includes the <script>...</script> payload. The sanitizer
    // is what removes it.
    const safe = sanitizeTitle(title);
    expect(safe).not.toContain('<');
    expect(safe).not.toContain('>');
    expect(safe.toLowerCase()).not.toContain('script');
    expect(safe).not.toContain('alert(1)');
  });

  it('strips a <script> block from the body and clamps the stored text', async () => {
    const htmlToMarkdown = await loadHtmlToMarkdown();
    const html = `<html>
  <head><title>Pricing</title></head>
  <body>
    <h1>Our Pricing</h1>
    <p>Welcome to <script>alert(1)</script> the pricing page.</p>
  </body>
</html>`;
    const { markdown, text } = htmlToMarkdown(html);
    const safeMarkdown = sanitizeMarkdown(markdown);
    const safeText = sanitizeMarkdown(text);
    expect(safeMarkdown.toLowerCase()).not.toContain('script');
    expect(safeMarkdown).not.toContain('alert(1)');
    expect(safeText.toLowerCase()).not.toContain('script');
    expect(safeText).not.toContain('alert(1)');
    // The legitimate content survived.
    expect(safeMarkdown).toContain('Our Pricing');
    expect(safeMarkdown).toContain('pricing page');
  });

  it('clamps a 1MB malicious title to TITLE_MAX_CHARS', async () => {
    const htmlToMarkdown = await loadHtmlToMarkdown();
    // 1 MB of `x` in the title field — the schema's text type accepts
    // this, but the sanitizer caps it so the row stays small.
    const huge = 'x'.repeat(1_000_000);
    const html = `<html><head><title>${huge}</title></head><body></body></html>`;
    const { title } = htmlToMarkdown(html);
    const safe = sanitizeTitle(title);
    expect(safe.length).toBe(500); // TITLE_MAX_CHARS
  });

  it('clamps a 1MB malicious body to MARKDOWN_MAX_CHARS', async () => {
    const htmlToMarkdown = await loadHtmlToMarkdown();
    const huge = 'y'.repeat(1_000_000);
    const html = `<html><head><title>Big</title></head><body>${huge}</body></html>`;
    const { markdown } = htmlToMarkdown(html);
    const safe = sanitizeMarkdown(markdown);
    expect(safe.length).toBe(50_000); // MARKDOWN_MAX_CHARS
  });

  it('a fully-scripted page becomes an empty (or near-empty) markdown body', async () => {
    const htmlToMarkdown = await loadHtmlToMarkdown();
    // Worst case: the entire body is one big <script>. After the
    // pipeline the body should be empty (or contain only the
    // benign surrounding words), and the title should be benign.
    const html = `<!doctype html>
<html>
  <head><title><script>document.cookie</script>Hello</title></head>
  <body><script>alert(1); steal(document.cookie);</script></body>
</html>`;
    const { title, markdown } = htmlToMarkdown(html);
    const safeTitle = sanitizeTitle(title);
    const safeMarkdown = sanitizeMarkdown(markdown);
    expect(safeTitle.toLowerCase()).not.toContain('script');
    expect(safeTitle).not.toContain('document.cookie');
    expect(safeMarkdown.toLowerCase()).not.toContain('script');
    expect(safeMarkdown).not.toContain('alert(1)');
    expect(safeMarkdown).not.toContain('steal');
  });
});

// =============================================================================
// HIGH-5 regression: runScan parents one snapshot_jobs row per watched page
// =============================================================================
//
// Bug summary (docs/qa-bug-hunt.md HIGH-5): runScan used to create exactly
// one snapshot_jobs row, parented to watchedUrls[0].id. Two failure modes:
//   (a) The PostgREST `tracked_pages` query had `&limit=50`, silently
//       dropping any 51st+ URL from the scan.
//   (b) The job was parented to the first URL's tracked_page_id, so a
//       removed/deactivated first URL would FK-fail the next run's job
//       insert and lose the entire scan.
//
// The fix:
//   - runScan fetches tracked_pages with no limit.
//   - scanOne creates its own snapshot_jobs row parented to wp.id.
//   - runScan mints a synthetic scanRunId (UI handle, not a DB column)
//     that scanOne stamps into the per-page job's apify_run_id as
//     `run:<uuid>` for correlation.
//
// These tests pin both behaviours against the live network using a
// stubbed `fetch` — we do not need a real InsForge tenant to assert
// the call shapes.

import { runScan } from './scan';
import type { MemoryRoom } from '@/types';

// Shared fetch stub. We use vi.hoisted so the test bodies can mutate
// the same Map/Array the factory captured.
const network = vi.hoisted(() => {
  return {
    // tracked_pages rows the test will inject (one per watched URL).
    pages: [] as Array<{ id: string; source_url: string }>,
    // dbInsert('snapshot_jobs', body) calls captured.
    jobInserts: [] as Array<Record<string, unknown>>,
    // dbInsert('snapshots', body) calls captured.
    snapshotInserts: [] as Array<Record<string, unknown>>,
    // dbUpdate('snapshot_jobs', id, body) calls captured.
    jobUpdates: [] as Array<{ id: string; body: Record<string, unknown> }>,
    // Body returned by the previous-snapshot lookup for a given
    // tracked_page_id. Empty array by default = "no previous snapshot".
    previousSnapshots: new Map<string, Array<Record<string, unknown>>>(),
  };
});

// HIGH-5 mocks the same `node:dns/promises` module that HIGH-4
// already mocks above. vi.mock factories are file-scoped and the
// second registration wins, which would clobber the HIGH-4
// `dnsBehavior` map and break the SSRF tests. To keep both
// describe-blocks green we route the HIGH-5 factory through the same
// `dnsBehavior` hoist: the SSRF tests populate `responses` per host,
// the HIGH-5 tests leave it empty and we fall back to a public IP.
vi.mock('node:dns/promises', () => ({
  default: {
    async lookup(host: string, _opts: unknown) {
      dnsBehavior.looked.push(host);
      const r = dnsBehavior.responses.get(host);
      if (r !== undefined) {
        return r.map((address) => ({ address, family: 4 }));
      }
      if (dnsBehavior.responses.size > 0) {
        // HIGH-4 SSRF tests are active — preserve the ENOTFOUND
        // semantics for hosts they did not register.
        const err = new Error(`getaddrinfo ENOTFOUND ${host}`) as Error & { code: string };
        err.code = 'ENOTFOUND';
        throw err;
      }
      // HIGH-5 path: any host resolves to a public IP so
      // validateCrawlUrl lets it through. Keeps the test focused on
      // the scan pipeline, not the SSRF guard.
      return [{ address: '93.184.216.34', family: 4 }];
    },
  },
}));

vi.mock('@insforge/sdk', () => ({
  // uploadEvidence uses the SDK to push the snapshot blob. Return a
  // successful upload so the snapshot insert proceeds.
  createClient: () => ({
    storage: {
      from: () => ({
        upload: async () => ({
          data: { key: 'pagevault/test/snapshots/x.md', url: 'https://example.invalid/x.md' },
          error: null,
        }),
      }),
    },
  }),
}));

function makeRoom(id = 'room-1'): MemoryRoom {
  return {
    id,
    userId: 'user-1',
    name: 'Test room',
    targetName: 'Test target',
    category: 'custom',
    storageFolderPath: 'pagevault/test',
    boxFolderId: 'pagevault/test',
    createdAt: new Date().toISOString(),
  };
}

// Build a single page's HTML body with a unique marker so each page
// produces a unique markdown hash. Without the marker, all 51 pages
// would hash the same and the dedup early-return would skip the
// snapshot insert for all but the first.
function pageHtml(marker: string): string {
  return `<!doctype html><html><head><title>Page ${marker}</title></head>
<body><h1>Page ${marker}</h1><p>body-${marker}</p></body></html>`;
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function htmlResponse(html: string): Response {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });
}

// Install the global fetch stub. Behaviour:
//   - GET  ${BASE_URL}/api/database/records/tracked_pages?… → network.pages
//   - GET  ${BASE_URL}/api/database/records/snapshots?…     → empty / per-page previous
//   - POST ${BASE_URL}/api/database/records/snapshot_jobs   → capture body
//   - PATCH ${BASE_URL}/api/database/records/snapshot_jobs?id=… → capture body
//   - POST ${BASE_URL}/api/database/records/snapshots       → capture body
//   - POST ${BASE_URL}/api/database/records/ai_explanations → 200
//   - GET  <user URL>                                       → per-page HTML
//
// We must reset captured arrays between tests (call this in beforeEach).
function installFetchStub() {
  network.jobInserts = [];
  network.snapshotInserts = [];
  network.jobUpdates = [];
  network.previousSnapshots = new Map();

  // The base URL scan.ts uses is whatever INSFORGE_API_URL is set to
  // at module-load time. The test runner may have it set to the real
  // InsForge tenant via `.env.local`, or to the placeholder
  // `https://test.invalid` from the file-level beforeAll. Match
  // *any* `/api/database/records/...` path so the stub works for
  // either case.
  const fetchMock = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = typeof input === 'string' ? input : input.toString();
    const method = (init?.method ?? 'GET').toUpperCase();

    // 1. tracked_pages query (runScan step 1)
    if (url.includes('/api/database/records/tracked_pages?')) {
      return jsonResponse(200, network.pages);
    }

    // 2. previous-snapshot lookup (scanOneInner step 2)
    if (url.includes('/api/database/records/snapshots?')) {
      // Extract tracked_page_id from the URL — the pattern is
      // `tracked_page_id=eq.<uuid>`. We pick the first match.
      const m = /tracked_page_id=eq\.([^&]+)/.exec(url);
      if (m && network.previousSnapshots.has(m[1])) {
        return jsonResponse(200, network.previousSnapshots.get(m[1]));
      }
      return jsonResponse(200, []);
    }

    // 3. snapshot_jobs insert
    if (method === 'POST' && url.includes('/api/database/records/snapshot_jobs') && !url.includes('?')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      network.jobInserts.push(body);
      return jsonResponse(200, []);
    }

    // 4. snapshot_jobs update
    if (method === 'PATCH' && /\/api\/database\/records\/snapshot_jobs\?/.test(url)) {
      const idMatch = /[?&]id=eq\.([^&]+)/.exec(url);
      const id = idMatch ? idMatch[1] : '?';
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      network.jobUpdates.push({ id, body });
      return jsonResponse(200, []);
    }

    // 5. snapshots insert
    if (method === 'POST' && url.includes('/api/database/records/snapshots') && !url.includes('?')) {
      const body = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
      network.snapshotInserts.push(body);
      return jsonResponse(200, []);
    }

    // 6. ai_explanations insert (we do not assert on it — the LLM
    // path is short-circuited because no previous snapshot exists)
    if (method === 'POST' && url.includes('/api/database/records/ai_explanations')) {
      return jsonResponse(200, []);
    }

    // 7. Crawl fetch. Return per-page HTML for each watched URL.
    if (method === 'GET' && (url.startsWith('http://') || url.startsWith('https://'))) {
      // The page is a stable URL — the test sets `network.pages` with
      // distinct source_urls and we map them back to a marker.
      const page = network.pages.find((p) => p.source_url === url);
      if (page) {
        // Marker is the trailing numeric chunk of the source_url.
        const m = /\/p(\d+)$/.exec(url);
        const marker = m ? m[1] : 'x';
        return htmlResponse(pageHtml(marker));
      }
      // Fall back to a generic body for any URL we don't track.
      return htmlResponse(pageHtml('x'));
    }

    // Default: 200 OK with empty body so the scanner keeps going.
    return jsonResponse(200, []);
  };

  // Replace the global fetch.
  globalThis.fetch = fetchMock as unknown as typeof fetch;
}

describe('HIGH-5: runScan parents one snapshot_jobs row per watched page', () => {
  beforeEach(() => {
    installFetchStub();
  });

  it('scans all 51 URLs (no silent 50-page cap)', async () => {
    // Build a 51-URL room. The pre-fix code's `&limit=50` would have
    // dropped URL #51, so we'd see only 50 job inserts and 50 snapshot
    // inserts. The fix must produce 51 of each.
    network.pages = Array.from({ length: 51 }, (_, i) => ({
      id: `page-${String(i).padStart(2, '0')}`,
      source_url: `https://example.com/p${i}`,
    }));

    const room = makeRoom('room-51');
    const summary = await runScan(room);

    // All 51 pages must have been scanned: 51 per-page jobs, 51
    // snapshots (no previous snapshots so the dedup early-return does
    // not apply, every page gets a snapshot row).
    expect(network.jobInserts).toHaveLength(51);
    expect(network.snapshotInserts).toHaveLength(51);
    // Every job insert must be parented to a *distinct* tracked_page_id
    // matching one of the 51 URLs (not all 51 to `page-00`).
    const trackedIds = new Set(network.jobInserts.map((b) => b.tracked_page_id));
    expect(trackedIds.size).toBe(51);
    for (const b of network.jobInserts) {
      expect(b.tracked_page_id).toMatch(/^page-\d{2}$/);
    }
    // The summary scanRunId is the synthetic room-level UUID — not the
    // same as any per-page jobId.
    expect(summary.scanRunId).toMatch(/^[0-9a-f-]{36}$/);
    for (const b of network.jobInserts) {
      expect(b.id).not.toBe(summary.scanRunId);
    }
  });

  it('scans 200 URLs without error or truncation', async () => {
    // Stress test: 200 URLs is the documented per-page fetch cap in
    // listRoomsWithStats. Pre-fix the loop silently dropped 150 of
    // them. The fix should complete all 200 in-band (note: this is a
    // sync mocked test, so we are not measuring real latency).
    network.pages = Array.from({ length: 200 }, (_, i) => ({
      id: `page-${String(i).padStart(3, '0')}`,
      source_url: `https://example.com/p${i}`,
    }));
    const summary = await runScan(makeRoom('room-200'));
    expect(summary.snapshotsCaptured).toBe(200);
    expect(network.jobInserts).toHaveLength(200);
    expect(network.snapshotInserts).toHaveLength(200);
  });

  it('does NOT use watchedUrls[0] as the parent (orphan-FK fix)', async () => {
    // The pre-fix code parented every scan's job to `watchedUrls[0].id`.
    // If the first page is removed between scans, the next run's job
    // insert would FK-fail and the whole scan would be lost. The fix
    // parents each per-page job to the page that is being scanned.
    network.pages = [
      { id: 'page-a', source_url: 'https://example.com/a' },
      { id: 'page-b', source_url: 'https://example.com/b' },
      { id: 'page-c', source_url: 'https://example.com/c' },
    ];
    await runScan(makeRoom('room-3'));

    expect(network.jobInserts).toHaveLength(3);
    // Every per-page job insert has a tracked_page_id that equals the
    // id of the page being scanned. page-a does NOT appear on all
    // three jobs.
    const parentByJob = Object.fromEntries(
      network.jobInserts.map((b) => [b.id as string, b.tracked_page_id as string])
    );
    const distinctParents = new Set(Object.values(parentByJob));
    expect(distinctParents).toEqual(new Set(['page-a', 'page-b', 'page-c']));
    // No job is parented to all three URLs.
    for (const b of network.jobInserts) {
      const all = ['page-a', 'page-b', 'page-c'];
      expect(all).toContain(b.tracked_page_id);
    }
  });

  it('stamps a stable `run:<uuid>` correlation tag onto every per-page job', async () => {
    network.pages = [
      { id: 'page-x', source_url: 'https://example.com/x' },
      { id: 'page-y', source_url: 'https://example.com/y' },
    ];
    const summary = await runScan(makeRoom('room-2'));
    const tags = network.jobInserts
      .map((b) => b.apify_run_id as string | undefined)
      .filter((t): t is string => typeof t === 'string');
    // Both jobs share the same `run:<uuid>` tag equal to scanRunId.
    // This is the operator-visible correlation handle for a single
    // user action ("what URLs were scanned in this manual run?").
    expect(tags).toHaveLength(2);
    for (const t of tags) {
      expect(t).toBe(`run:${summary.scanRunId}`);
    }
  });

  it('marks each per-page job succeeded at the end of a clean run', async () => {
    network.pages = [
      { id: 'page-a', source_url: 'https://example.com/a' },
      { id: 'page-b', source_url: 'https://example.com/b' },
    ];
    await runScan(makeRoom('room-ok'));
    // Two jobs inserted (per-page), two updates marking them succeeded.
    expect(network.jobInserts).toHaveLength(2);
    const updatesByJobId = new Map(network.jobUpdates.map((u) => [u.id, u.body]));
    // Every inserted job has a corresponding succeeded update.
    for (const job of network.jobInserts) {
      const u = updatesByJobId.get(job.id as string);
      expect(u).toBeDefined();
      expect(u!.status).toBe('succeeded');
    }
  });

  it('continues scanning remaining URLs when one page fails (per-page job isolation)', async () => {
    // Make page-b's crawl fail. The pre-fix code propagated the
    // failure up the loop and the remaining URLs' snapshots were
    // not inserted against a valid job. With the fix, page-b's job is
    // marked failed, the loop logs and continues, and page-c still
    // gets its own per-page job + snapshot.
    network.pages = [
      { id: 'page-a', source_url: 'https://example.com/a' },
      { id: 'page-b', source_url: 'https://example.com/FAIL' },
      { id: 'page-c', source_url: 'https://example.com/c' },
    ];
    // Override the fetch stub just for this test so /FAIL returns 500.
    const originalFetch = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url === 'https://example.com/FAIL') {
        return new Response('boom', { status: 500, statusText: 'Internal Server Error' });
      }
      return originalFetch(input, init);
    }) as unknown as typeof fetch;

    try {
      await runScan(makeRoom('room-mixed'));
    } finally {
      globalThis.fetch = originalFetch;
    }
    // 3 per-page job inserts (one per URL).
    expect(network.jobInserts).toHaveLength(3);
    // 2 snapshot inserts (page-a, page-c succeeded; page-b failed
    // before the snapshot row could be written).
    expect(network.snapshotInserts).toHaveLength(2);
    // page-b's job is the only one marked failed.
    const failed = network.jobUpdates.filter((u) => u.body.status === 'failed');
    expect(failed).toHaveLength(1);
    const succeeded = network.jobUpdates.filter((u) => u.body.status === 'succeeded');
    expect(succeeded).toHaveLength(2);
  });
});
