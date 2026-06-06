// Live scan orchestration for PageVault.
//
// Pipeline:
//   1. Load the room's watched URLs from InsForge Postgres
//   2. For each URL, fetch the page (direct HTTP fetch, or Apify if creds set)
//   3. SHA-256 hash the fetched markdown; if unchanged from previous snapshot,
//      skip LLM call (cost-saver per design §3.3)
//   4. Call the LLM via OpenAI-compatible API (InsForge AI gateway → OpenRouter
//      when OPENAI_BASE_URL is set)
//   5. Insert snapshot_job (running → succeeded), snapshot, ai_explanations
//   6. Upload raw markdown to InsForge Storage for evidence chain
//
// Idempotency: snapshot_jobs uses `trigger_type` + `apify_run_id` semantics; we
// generate a unique `jobId` per run. The previous-snapshot lookup is by
// (tracked_page_id, observed_at desc) so re-running won't double-insert.
import { createHash } from 'node:crypto';
import dns from 'node:dns/promises';
import http from 'node:http';
import https from 'node:https';
import type { LookupFunction } from 'node:net';
import { enqueueNotification } from './notifications';
import type {
  MemoryRoom,
  PageSnapshot,
  ScanSummary,
  WatchedUrl,
  ChangeAnalysisResult,
  NewChangeAnalysis,
} from '@/types';

// Lightweight HTML→Markdown-ish extractor. We avoid pulling in a heavy
// readability library — for the Apify-equivalent baseline this is enough:
// strip tags, drop scripts/styles/nav, collapse whitespace, preserve line breaks.
function htmlToMarkdown(html: string): { title: string; markdown: string; text: string } {
  // Extract <title>
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].trim() : '';

  // Drop script/style/nav blocks
  let body = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav\b[^>]*>[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header\b[^>]*>[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer\b[^>]*>[\s\S]*?<\/footer>/gi, ' ');

  // Convert headings, lists, paragraphs to markdown-ish
  body = body
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, '\n# $1\n')
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, '\n## $1\n')
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, '\n### $1\n')
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, '\n#### $1\n')
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '\n- $1')
    .replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, '\n$1\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '') // strip remaining tags
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();

  const text = body.replace(/[#*\->`]/g, '').replace(/\s+/g, ' ').trim();
  return { title, markdown: body, text };
}

// SSRF guard: validateCrawlUrl rejects URLs that point at internal,
// private, loopback, link-local, or cloud-metadata addresses before any
// fetch() is issued. crawlOne() always goes through this first.
//
// We block by inspecting the parsed hostname, and (for hostnames that
// aren't literal IPs) we DNS-resolve and block if *any* returned address
// is in a denied range. The DNS step defeats classic DNS-rebinding where
// a public hostname resolves to an internal IP at fetch time.
//
// Exported helpers (isBlockedAddress, validateCrawlUrl) are covered by
// lib/scan.test.ts. They are the public security boundary.

/** True if the address is in any range we refuse to crawl. */
export function isBlockedAddress(addr: string): boolean {
  if (!addr) return false;
  // Normalize IPv4-mapped IPv6 to their v4 form so the v4 blocklist
  // catches them. Accepts all three common forms:
  //   ::ffff:127.0.0.1   (dotted-quad; the form new URL() emits for
  //                       many resolvers)
  //   ::ffff:7f00:1      (compressed hex; what new URL() emits for
  //                       the dotted-quad form when the trailing bytes
  //                       contain leading zeros)
  //   ::ffff:0:0:7f00:1  (fully expanded)
  // node's `dns.lookup` returns these in mixed form depending on the
  // resolver, so we expand the address to its full 8-group form first
  // (via expandIPv6ForMapping), then detect the ::ffff: prefix and
  // pull the 32-bit v4 address out of the trailing groups. The dotted-
  // quad form is handled in a separate case from the hex form.
  if (addr.includes(':')) {
    const expanded = expandIPv6ForMapping(addr);
    // Case 1: trailing dotted-quad in the last group, e.g.
    //   "0000:0000:0000:0000:0000:0000:ffff:127.0.0.1" (6 leading zeros)
    //   "0000:0000:0000:0000:0000:ffff:127.0.0.1"     (5 leading zeros,
    //                                                   the canonical
    //                                                   "::ffff:127.0.0.1" form)
    // The `(?:0+:)+` pattern is non-capturing (so the dotted-quad in
    // group 1 is the only captured group) and matches one or more
    // `0xxx:` groups (the leading zero run), then requires the literal
    // `ffff:`. (A plain `^0+:` won't work because regex quantifiers
    // don't backtrack across colons — each `0+` greedily consumes the
    // trailing colon of its group, so the next match attempt starts
    // at the next group's `0`, never at the `f` of `ffff:`.)
    const dottedMatch = /^(?:0+:)+ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/i.exec(expanded);
    if (dottedMatch) {
      return isBlockedAddress(dottedMatch[1]);
    }
    // Case 2: trailing hex form (two 16-bit groups, e.g.
    //   "0000:0000:0000:0000:0000:ffff:7f00:1"     (compressed)
    //   "0000:0000:0000:0000:0000:ffff:0:7f00:1"   (expanded with one
    //                                                     leading zero)
    // The v4 address is split as `7f00` / `1` = (a, b) where the
    // dotted form is a.b.c.d and a = 7f, b = 00, c = 00, d = 01.
    // Both `7f00` and `1` (or `0` / `7f00` in the expanded form) are
    // captured as non-capturing groups so group 1 / group 2 are
    // unambiguous.
    const hexMatch = /^(?:0+:)+ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i.exec(expanded);
    if (hexMatch) {
      const a = parseInt(hexMatch[1], 16);
      const b = parseInt(hexMatch[2], 16);
      const dot = `${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`;
      return isBlockedAddress(dot);
    }
  }

  // IPv6
  if (addr.includes(':')) {
    const lc = addr.toLowerCase();
    if (lc === '::' || lc === '::1') return true;          // unspecified + loopback
    if (lc.startsWith('fc') || lc.startsWith('fd')) return true; // unique-local fc00::/7
    if (lc.startsWith('fe8') || lc.startsWith('fe9') ||
        lc.startsWith('fea') || lc.startsWith('feb')) return true; // link-local fe80::/10
    if (lc.startsWith('ff')) return true;                  // multicast ff00::/8
    return false;
  }

  // IPv4
  const parts = addr.split('.').map(Number);
  if (parts.length !== 4 || parts.some((p) => !Number.isFinite(p) || p < 0 || p > 255)) {
    return false; // not a parseable IPv4 — let the URL-level validator reject
  }
  const [a, b] = parts;
  if (a === 0) return true;                              // 0.0.0.0/8
  if (a === 10) return true;                             // 10.0.0.0/8
  if (a === 127) return true;                            // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true;               // 169.254.0.0/16 link-local (incl. 169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true;      // 172.16.0.0/12 RFC1918
  if (a === 192 && b === 168) return true;               // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true;     // 100.64.0.0/10 CGNAT
  if (a >= 224 && a <= 239) return true;                 // 224.0.0.0/4 multicast
  if (a >= 240) return true;                             // 240.0.0.0/4 reserved + 255.255.255.255
  return false;
}

/**
 * Validate a URL before we crawl it. Throws on any blocked / malformed URL.
 * The error message intentionally includes the offending host so that
 * operators can debug "why was this URL rejected?" from a single stack
 * line.
 */
export async function validateCrawlUrl(input: string): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(input);
  } catch {
    throw new Error(`Refusing to crawl: invalid URL "${input}"`);
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      `Refusing to crawl "${input}": protocol "${parsed.protocol}" is not http(s)`,
    );
  }
  const hostname = parsed.hostname; // URL.hostname is the lowercased, bracket-stripped host
  if (!hostname) {
    throw new Error(`Refusing to crawl "${input}": missing hostname`);
  }

  // URL.hostname returns literal IPv6 hostnames with surrounding brackets
  // (e.g. "[::1]") but lowercased. Strip them so the literal-IP probe
  // and the blocklist see the bare address.
  const bareHost = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;

  // Treat `localhost` and other well-known hostnames that should never be
  // reached from the server's network as blocked without a DNS lookup.
  const lcHost = bareHost.toLowerCase();
  if (
    lcHost === 'localhost' ||
    lcHost.endsWith('.localhost') ||
    lcHost.endsWith('.local') ||
    lcHost.endsWith('.internal') ||
    lcHost.endsWith('.intranet')
  ) {
    throw new Error(
      `Refusing to crawl "${input}": hostname "${bareHost}" points at loopback / internal namespace`,
    );
  }

  // If the hostname is a literal IP, the blocklist is sufficient — no DNS
  // is needed and a malicious client can't rebind a literal IP.
  if (isLiteralIPv4(bareHost) || isLiteralIPv6(bareHost)) {
    if (isBlockedAddress(bareHost)) {
      throw new Error(
        `Refusing to crawl "${input}": hostname "${bareHost}" is a blocked private/internal address`,
      );
    }
    return input;
  }

  // Hostname is a DNS name — resolve it and check every returned address.
  // dns.lookup with { all: true } returns all A + AAAA records.
  let addrs: Array<{ address: string }>;
  try {
    addrs = await dns.lookup(bareHost, { all: true, verbatim: true });
  } catch (err) {
    throw new Error(
      `Refusing to crawl "${input}": DNS lookup failed for "${bareHost}" — ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
  if (addrs.length === 0) {
    throw new Error(`Refusing to crawl "${input}": DNS lookup returned no addresses for "${bareHost}"`);
  }
  for (const { address } of addrs) {
    if (isBlockedAddress(address)) {
      throw new Error(
        `Refusing to crawl "${input}": hostname "${bareHost}" resolves to blocked private/internal address "${address}"`,
      );
    }
  }
  return input;
}

/**
 * Like validateCrawlUrl, but also returns the IP address(es) the
 * hostname resolves to at validation time. Callers MUST use the
 * returned IP for the outbound request (via a transport lookup override)
 * to prevent DNS rebinding — if the request is sent by hostname with the
 * default resolver, the second resolution can land on a different
 * (attacker-controlled) IP than the one the guard validated.
 *
 * For literal-IP hostnames, returns the literal IP as a single-entry
 * array (the caller can pin to it).
 *
 * Returns a structured object { url, ips } so the caller has both
 * the canonical URL and the pinned addresses to use in the fetch.
 */
type ResolvedCrawlAddress = { address: string; family: 4 | 6 };

export async function resolveAndValidateCrawlUrl(input: string): Promise<{ url: string; ips: ResolvedCrawlAddress[] }> {
  const validated = await validateCrawlUrl(input);
  const parsed = new URL(validated);
  const bareHost = parsed.hostname.startsWith('[') && parsed.hostname.endsWith(']')
    ? parsed.hostname.slice(1, -1)
    : parsed.hostname;
  if (isLiteralIPv4(bareHost) || isLiteralIPv6(bareHost)) {
    return { url: validated, ips: [{ address: bareHost, family: isLiteralIPv6(bareHost) ? 6 : 4 }] };
  }
  // Already validated by validateCrawlUrl above; lookup again to get
  // the IPs (validateCrawlUrl only checked them, didn't return them).
  // Re-check this second result too: a DNS answer can change between
  // the validation lookup and the pinning lookup.
  const addrs = await dns.lookup(bareHost, { all: true, verbatim: true });
  if (addrs.length === 0) {
    throw new Error(`Refusing to crawl "${input}": DNS lookup returned no addresses for "${bareHost}"`);
  }
  for (const { address } of addrs) {
    if (isBlockedAddress(address)) {
      throw new Error(
        `Refusing to crawl "${input}": hostname "${bareHost}" resolves to blocked private/internal address "${address}"`,
      );
    }
  }
  return {
    url: validated,
    ips: addrs.map((a) => ({
      address: a.address,
      family: a.family === 6 ? 6 : 4,
    })),
  };
}

/**
 * Expand an IPv6 address to its full 8-group colon-hex form. Returns
 * the input unchanged if it doesn't look like an IPv6 address. Handles
 * the `::` shorthand by computing the missing zero groups. Used by
 * isBlockedAddress() to normalize ::ffff: mappings before checking
 * the v4 blocklist. (new URL() sometimes normalizes the dotted-quad
 * form ::ffff:127.0.0.1 to the compressed hex form ::ffff:7f00:1,
 * and the uncompressed form ::ffff:0:0:7f00:1 is also seen in the
 * wild; we accept all three.)
 */
function expandIPv6ForMapping(addr: string): string {
  if (!addr.includes(':')) return addr;
  const lc = addr.toLowerCase();
  // The `::` shorthand: split on the first `::` and pad to 8 groups.
  const dci = lc.indexOf('::');
  if (dci !== -1) {
    const head = lc.slice(0, dci);
    const tail = lc.slice(dci + 2);
    const headParts = head === '' ? [] : head.split(':');
    const tailParts = tail === '' ? [] : tail.split(':');
    const missing = 8 - headParts.length - tailParts.length;
    if (missing < 0) return addr; // malformed; let downstream reject
    const full = [...headParts, ...Array(missing).fill('0'), ...tailParts];
    return full.map((g) => g.padStart(4, '0')).join(':');
  }
  // No `::` shorthand: just zero-pad each group.
  return lc.split(':').map((g) => g.padStart(4, '0')).join(':');
}

function isLiteralIPv4(host: string): boolean {
  const parts = host.split('.');
  if (parts.length !== 4) return false;
  return parts.every((p) => /^\d{1,3}$/.test(p) && Number(p) >= 0 && Number(p) <= 255);
}

function isLiteralIPv6(host: string): boolean {
  // A literal IPv6 (after URL.hostname strip-bracket normalization) must
  // contain at least one colon and consist of hex / colon / dot-quad chars.
  if (!host.includes(':')) return false;
  return /^[0-9a-fA-F:.]{2,}$/.test(host);
}

// Direct HTTP fetch timeout. A user-supplied tracked page could point at
// a server that accepts the TCP connection but never sends a response
// (a "slowloris" target, an IP that's actually a captive portal holding
// the socket open, etc.). Without a timeout, the next.js worker would be
// pinned indefinitely — the scan queue would fill up and never drain.
// Default is 10s; operators can override per-environment with the
// PAGEVAULT_FETCH_TIMEOUT_MS env var (e.g. 2000 in tests, 30000 over a
// slow WAN). The same abort signal applies to every hop in the
// redirect chain so the total wall-clock for one crawl is bounded.
const DEFAULT_FETCH_TIMEOUT_MS = 10_000;
function getFetchTimeoutMs(): number {
  const raw = process.env.PAGEVAULT_FETCH_TIMEOUT_MS;
  if (!raw) return DEFAULT_FETCH_TIMEOUT_MS;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_FETCH_TIMEOUT_MS;
  return parsed;
}

type DirectCrawlResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
};

function getResponseHeader(headers: http.IncomingHttpHeaders, name: string): string | null {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function makeAbortError(): Error {
  const err = new Error('AbortError');
  err.name = 'AbortError';
  return err;
}

function fetchPinnedCrawlUrl(
  url: string,
  pin: ResolvedCrawlAddress,
  signal: AbortSignal,
): Promise<DirectCrawlResponse> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'https:' ? https : http;
    const chunks: Buffer[] = [];
    let settled = false;

    const lookup: LookupFunction = (_hostname, _options, callback) => {
      const cb = callback as (err: NodeJS.ErrnoException | null, address: string, family: number) => void;
      if (isBlockedAddress(pin.address)) {
        cb(new Error(`Refusing to crawl: pinned address "${pin.address}" is blocked`), '', 0);
        return;
      }
      cb(null, pin.address, pin.family);
    };

    const req = client.request(parsed, {
      method: 'GET',
      headers: {
        'User-Agent': 'PageVault/1.0 (https://pagevault.app; +contact@pagevault.app)',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      },
      lookup,
    }, (res) => {
      res.on('data', (chunk: Buffer | string) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      res.on('end', () => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        const body = Buffer.concat(chunks).toString('utf8');
        resolve({
          ok: Boolean(res.statusCode && res.statusCode >= 200 && res.statusCode < 300),
          status: res.statusCode ?? 0,
          statusText: res.statusMessage ?? '',
          headers: {
            get(name: string) {
              return getResponseHeader(res.headers, name);
            },
          },
          text: async () => body,
        });
      });
      res.on('error', (err) => {
        if (settled) return;
        settled = true;
        signal.removeEventListener('abort', abort);
        reject(err);
      });
    });

    const abort = () => {
      if (settled) return;
      req.destroy(makeAbortError());
    };

    req.on('error', (err) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', abort);
      reject(err);
    });

    if (signal.aborted) {
      abort();
    } else {
      signal.addEventListener('abort', abort, { once: true });
    }
    req.end();
  });
}

// Direct HTTP fetch as a baseline crawler. Tries the Apify run-sync API
// directly if creds are present, otherwise falls back to a plain fetch()
// with HTML→Markdown extraction.
//
// Exported (not just module-local) so unit tests in lib/scan.test.ts
// can drive the timeout / abort path with a controlled fetch mock
// without standing up the full runScan() / DB / Apify stack.
export async function crawlOne(url: string): Promise<{
  url: string; title: string; markdown: string; text: string; capturedAt: string;
  apifyRunId: string | null;
}> {
  // HIGH-4: SSRF guard. The URL is user-supplied (lives in
  // tracked_pages.source_url) and any fetch() in this function is from
  // the Next.js server's network. Reject private / loopback / link-local /
  // cloud-metadata targets before issuing a single byte of outbound
  // traffic, and follow DNS resolution to defeat DNS-rebinding.
  await validateCrawlUrl(url);

  const apifyToken = process.env.APIFY_API_TOKEN;
  const apifyActorId = process.env.APIFY_ACTOR_ID;

  if (apifyToken && apifyActorId) {
    // Real Apify path
    const r = await fetch(
      `https://api.apify.com/v2/acts/${apifyActorId}/run-sync-get-dataset-items?token=${apifyToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: [url] }),
      }
    );
    if (r.ok) {
      const data = await r.json() as { items?: Array<Record<string, unknown>> };
      const item = data.items?.[0];
      if (item) {
        return {
          url,
          title: String(item.title ?? ''),
          markdown: String(item.markdown ?? item.text ?? ''),
          text: String(item.text ?? ''),
          capturedAt: String(item.capturedAt ?? new Date().toISOString()),
          apifyRunId: String(item.runId ?? r.headers.get('x-apify-run-id') ?? '') || null,
        };
      }
    }
    // Fall through to direct fetch on Apify error
    console.warn(`[scan] Apify call failed for ${url}, falling back to direct fetch`);
  }

  // Direct fetch path. We use redirect: 'manual' so we can
  // re-validate every Location header against the SSRF blocklist;
  // the default 'follow' would silently redirect a public URL
  // to http://169.254.169.254/ (cloud metadata) or http://127.0.0.1/
  // (loopback) without re-running the private-address checks.
  //
  // DNS-rebinding defense: the SSRF guard above resolves the
  // hostname and checks every returned IP, but a plain fetch() would
  // perform its own DNS lookup later. Between the guard and the
  // request, a malicious authoritative DNS server can flip the answer
  // to a private IP. To prevent that, we keep the original URL host
  // (so HTTPS TLS/SNI and virtual-host routing still see the real
  // hostname) and override Node's lookup callback to return the
  // already-validated IP.
  const MAX_REDIRECTS = 5;
  const timeoutMs = getFetchTimeoutMs();
  // Single AbortController covers the entire redirect chain — a target
  // that hangs on hop 1 OR a chain of slow redirects that together
  // exceed the budget both get cut off at timeoutMs. The timer is
  // unref'd so a still-pending abort can't keep the event loop alive
  // past the caller's await.
  const abortController = new AbortController();
  const timeoutHandle = setTimeout(() => abortController.abort(), timeoutMs);
  timeoutHandle.unref?.();
  let currentUrl = url;
  let r: DirectCrawlResponse | null = null;
  try {
  for (let i = 0; i <= MAX_REDIRECTS; i++) {
    // SSRF guard + DNS-rebinding pin. resolveAndValidateCrawlUrl
    // returns the validated URL and the IP(s) the hostname resolves
    // to; we use the first IP in the transport lookup override and
    // keep the original hostname in the URL itself for TLS/SNI.
    const resolved = await resolveAndValidateCrawlUrl(currentUrl);
    currentUrl = resolved.url;
    const pin = resolved.ips[0];
    if (!pin) {
      throw new Error(`Refusing to crawl "${currentUrl}": DNS lookup returned no addresses`);
    }
    const res = await fetchPinnedCrawlUrl(currentUrl, pin, abortController.signal);
    // Non-redirect: we have the final response.
    if (res.status < 300 || res.status >= 400) {
      r = res;
      break;
    }
    // 3xx: read Location, loop. After a redirect, the next URL is
    // still hostname-based, and we re-resolve/re-pin on the next
    // iteration.
    const location = res.headers.get('location');
    if (!location) {
      // 3xx with no Location is malformed; treat as terminal.
      r = res;
      break;
    }
    // Resolve relative to the previous hostname URL. The next
    // iteration re-resolves and re-pins for the new hostname.
    currentUrl = new URL(location, currentUrl).toString();
  }
  } catch (err) {
    // Convert the AbortError from the timeout into a deterministic,
    // greppable error message. The original DOMException is preserved
    // on .cause for callers that want to inspect it.
    if (err instanceof Error && (err.name === 'AbortError' || abortController.signal.aborted)) {
      const e = new Error(`Fetch of ${url} aborted after ${timeoutMs}ms (PAGEVAULT_FETCH_TIMEOUT_MS)`);
      e.name = 'FetchTimeoutError';
      (e as Error & { cause?: unknown }).cause = err;
      throw e;
    }
    throw err;
  } finally {
    // Clear the timeout in every exit path — success, error, or
    // abort. Without this, the timer would keep the event loop
    // alive until it fires, and on success it would still call
    // abort() on a controller that's no longer in use.
    clearTimeout(timeoutHandle);
  }
  if (!r) {
    throw new Error(`Failed to fetch ${url}: too many redirects (limit ${MAX_REDIRECTS})`);
  }
  if (!r.ok) throw new Error(`Failed to fetch ${url}: ${r.status} ${r.statusText}`);
  const html = await r.text();
  const { title, markdown, text } = htmlToMarkdown(html);
  return {
    url,
    title,
    markdown,
    text,
    capturedAt: new Date().toISOString(),
    apifyRunId: null,
  };
}

// Call OpenAI-compatible chat completions (InsForge AI gateway → OpenRouter
// when OPENAI_BASE_URL is set; otherwise the configured provider).
async function callLlm(
  system: string,
  user: string,
  maxTokens = 1500,
): Promise<{ result: ChangeAnalysisResult; model: string }> {
  // Prefer the OpenRouter key (set by `npx @insforge/cli ai setup`) over
  // the placeholder OPENAI_API_KEY that may still be in .env.local.
  let apiKey = process.env.OPENAI_API_KEY;
  let baseUrl = process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1';
  let model = process.env.OPENAI_MODEL ?? 'gpt-4o-mini';

  const isPlaceholder = (k: string | undefined): boolean =>
    !k || k.includes('...') || k.length < 30;

  if (isPlaceholder(apiKey) && process.env.OPENROUTER_API_KEY) {
    apiKey = process.env.OPENROUTER_API_KEY;
    if (!process.env.OPENAI_BASE_URL || process.env.OPENAI_BASE_URL.includes('api.openai.com')) {
      baseUrl = 'https://openrouter.ai/api/v1';
    }
    // Prefer a strong cheap default on OpenRouter
    if (model === 'gpt-4o-mini' || isPlaceholder(process.env.OPENAI_MODEL)) {
      model = 'anthropic/claude-3.5-haiku';
    }
  }

  if (!apiKey) {
    throw new Error(
      'No LLM API key configured. Set OPENAI_API_KEY (with valid OpenAI key) ' +
      'or OPENROUTER_API_KEY (set by `npx @insforge/cli ai setup`).'
    );
  }

  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      temperature: 0.2,
      max_tokens: maxTokens,
      // response_format only honored by some providers (OpenAI, OpenRouter
      // via OpenAI). When the provider ignores it, the model still usually
      // returns valid JSON because the prompt asks for it.
      ...(baseUrl.includes('openai.com') || baseUrl.includes('openrouter.ai')
        ? { response_format: { type: 'json_object' } }
        : {}),
    }),
  });

  if (!r.ok) {
    const body = await r.text().catch(() => '');
    throw new Error(`LLM API error: ${r.status} ${r.statusText} — ${body.slice(0, 200)}`);
  }
  const data = await r.json() as {
    choices?: Array<{ message?: { content?: string } }>;
    usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
  };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new Error('LLM returned empty content');

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(content);
  } catch {
    // Try to recover from a slightly truncated JSON
    const recovered = content.replace(/,\s*$/, '').replace(/[^}\]]*$/, '') + '}}';
    try { parsed = JSON.parse(recovered); } catch {
      throw new Error(`LLM response was not valid JSON: ${content.slice(0, 200)}`);
    }
  }

  const severity = (parsed.severity as string) === 'medium' || parsed.severity === 'high'
    ? parsed.severity
    : 'low';
  const validTypes = ['pricing', 'positioning', 'feature', 'legal', 'security', 'hiring', 'docs', 'minor', 'unknown'];
  const changeType = validTypes.includes(parsed.change_type as string)
    ? (parsed.change_type as string) as ChangeAnalysisResult['changeType']
    : 'unknown';

  return {
    result: {
      severity: severity as ChangeAnalysisResult['severity'],
      changeType,
      summary: String(parsed.summary ?? 'Content changed'),
      businessInterpretation: String(parsed.business_interpretation ?? parsed.businessInterpretation ?? ''),
      evidence: Array.isArray(parsed.evidence)
        ? (parsed.evidence as Array<Record<string, string>>).map((e) => ({
            before: String(e.before ?? e.old ?? ''),
            after: String(e.after ?? e.new ?? ''),
            explanation: String(e.explanation ?? ''),
          }))
        : [],
      recommendedActions: Array.isArray(parsed.recommended_actions)
        ? (parsed.recommended_actions as string[])
        : Array.isArray(parsed.recommendedActions)
          ? (parsed.recommendedActions as string[])
          : [],
    },
    model,
  };
}

// Extract pricing/security/feature facts from markdown for a compact LLM prompt.
function extractExcerpt(md: string, maxChars = 1500): string {
  const lines = md.split('\n');
  const out: string[] = [];
  let total = 0;
  const re = /(\$[\d,.]+|GB-seconds?|free tier|requests? per|per million|memory|graviton|x86|arm|tier|premium|management fee|managed instance|reserved|iso|27001|storage|security|policy|terms|pricing|plan|feature|hire|career|launch|announce|integrate|api)/i;
  for (const line of lines) {
    const s = line.trim();
    if (re.test(s) && s.length > 5 && s.length < 250 && !s.startsWith('*') && !s.startsWith('[')) {
      out.push(s);
      total += s.length;
      if (total > maxChars) break;
    }
  }
  return out.join('\n');
}

const SYSTEM = `You are a PageVault analyst reviewing a web page change.

Given the previous and current text of a monitored page, analyze what changed and produce a structured analysis.

Return ONLY valid JSON with this exact structure:
{
  "changed": boolean,
  "severity": "low" | "medium" | "high",
  "change_type": "pricing" | "positioning" | "feature" | "legal" | "security" | "hiring" | "docs" | "minor" | "unknown",
  "summary": "one-sentence plain-English summary",
  "business_interpretation": "why this matters (1-2 sentences)",
  "recommended_actions": ["action 1", "action 2", "action 3"],
  "evidence": [
    {"before": "old text or null", "after": "new text", "explanation": "why this matters"}
  ],
  "confidence": number between 0 and 1
}

Rules:
- Use ONLY the provided evidence. Never invent missing text.
- If evidence is weak, return changed=false, confidence<=0.4.
- Quote at most 80 characters per evidence item to stay within output budget.
- 3 evidence items is plenty; don't fabricate more.`;

// ============================================================================
// InsForge REST helpers (server-side, use service role key for writes)
// ============================================================================

// No hardcoded URL fallback: a misconfigured deploy must fail loudly
// rather than silently route traffic to the wrong InsForge tenant.
const BASE_URL = process.env.INSFORGE_API_URL;
if (!BASE_URL) {
  throw new Error('INSFORGE_API_URL is not set. Refusing to run scans against an unknown InsForge tenant.');
}
const SRK = process.env.INSFORGE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY || '';
const ANON = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY || process.env.INSFORGE_ANON_KEY || '';

function uuid(prefix: string): string {
  // InsForge rejects UUIDs whose first char isn't 0-9 or a-f.
  // The body of the UUID must be exactly 32 hex chars: 8-4-4-4-12.
  // Format: <prefix><8 hex>-1111-0000-0000-000000000001
  //   prefix = single hex char (we use 'a' which is valid)
  //   group1 = 7 more hex chars = 8 total with prefix
  //   group2-4 = '1111', '0000', '0000' (the "v1-like" fake variant)
  //   group5 = 12 chars of zeros
  const chars = '0123456789abcdef';
  let group1 = '';
  for (let i = 0; i < 7; i++) {
    group1 += chars[Math.floor(Math.random() * 16)];
  }
  return `${prefix}${group1}-1111-0000-0000-000000000001`;
}

async function dbGet(path: string): Promise<unknown> {
  const r = await fetch(`${BASE_URL}/api/database/records/${path}`, {
    headers: { 'Authorization': `Bearer ${ANON}` },
  });
  if (!r.ok) throw new Error(`dbGet ${path} failed: ${r.status}`);
  return r.json();
}

async function dbInsert(table: string, body: Record<string, unknown>): Promise<unknown> {
  const r = await fetch(`${BASE_URL}/api/database/records/${table}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${SRK}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`dbInsert ${table} failed: ${r.status} ${errText.slice(0, 200)}`);
  }
  return r.json();
}

async function dbUpdate(table: string, id: string, body: Record<string, unknown>): Promise<void> {
  const r = await fetch(`${BASE_URL}/api/database/records/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'Authorization': `Bearer ${SRK}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const errText = await r.text().catch(() => '');
    throw new Error(`dbUpdate ${table} failed: ${r.status} ${errText.slice(0, 200)}`);
  }
}

// Upload evidence to InsForge Storage using the CLI as a proxy (the SDK
// `upload` is available too, but a direct REST call keeps the scan
// self-contained without requiring the @insforge/sdk in this file).
async function uploadEvidence(
  storageFolderPath: string,
  fileName: string,
  content: string,
): Promise<{ key: string; url: string } | null> {
  if (!storageFolderPath) return null;
  // Use the SDK via dynamic import to avoid bundling issues
  try {
    const { createClient } = await import('@insforge/sdk');
    const storageBaseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL || process.env.INSFORGE_API_URL;
    if (!storageBaseUrl) {
      throw new Error('INSFORGE_API_URL is not set; cannot upload evidence.');
    }
    const client = createClient({
      baseUrl: storageBaseUrl,
      anonKey: ANON,
    });
    const blob = new Blob([content], { type: 'text/markdown' });
    const key = `${storageFolderPath}/snapshots/${new Date().toISOString().slice(0, 10)}/${fileName}`;
    const { data, error } = await client.storage.from('pagevault-evidence').upload(key, blob);
    if (error) {
      console.warn(`[scan] storage upload failed for ${key}:`, error.message);
      return null;
    }
    if (!data) return null;
    return { key: data.key, url: data.url };
  } catch (err) {
    console.warn(`[scan] storage upload exception:`, err);
    return null;
  }
}

// ============================================================================
// Main entry point
// ============================================================================

export async function runScan(
  room: MemoryRoom,
  options: { triggerType?: 'manual' | 'schedule' | 'box_webhook' | 'retry' } = {},
): Promise<ScanSummary> {
  const triggerType = options.triggerType ?? 'manual';
  const jobId = uuid('a');
  const startedAt = new Date().toISOString();

  // 1. Load watched URLs
  const watchedUrls = (await dbGet(
    `tracked_pages?project_id=eq.${room.id}&active=eq.1&select=id,source_url&limit=50`,
  )) as Array<{ id: string; source_url: string }>;
  if (watchedUrls.length === 0) {
    return {
      scanRunId: jobId,
      status: 'completed',
      snapshotsCaptured: 0,
      changesCreated: 0,
    };
  }

  // 2. Insert the scan_job as running
  await dbInsert('snapshot_jobs', {
    id: jobId,
    tracked_page_id: watchedUrls[0].id, // one job per scan; pages are linked via snapshots
    trigger_type: triggerType,
    status: 'running',
    requested_at: startedAt,
  });

  let snapshotsCaptured = 0;
  let changesCreated = 0;

  try {
    for (const wp of watchedUrls) {
      try {
        const result = await scanOne(room, wp, jobId);
        if (result.snapshot) snapshotsCaptured += 1;
        if (result.change) changesCreated += 1;
      } catch (err) {
        console.error(`[scan] failed for ${wp.source_url}:`, err);
        // Continue with the next URL — one bad page shouldn't fail the whole scan
      }
    }

    // 3. Mark job succeeded
    await dbUpdate('snapshot_jobs', jobId, {
      status: 'succeeded',
      finished_at: new Date().toISOString(),
    });

    return {
      scanRunId: jobId,
      status: 'completed',
      snapshotsCaptured,
      changesCreated,
    };
  } catch (err) {
    await dbUpdate('snapshot_jobs', jobId, {
      status: 'failed',
      finished_at: new Date().toISOString(),
      error_message: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }
}

async function scanOne(
  room: MemoryRoom,
  wp: { id: string; source_url: string },
  jobId: string,
): Promise<{ snapshot: PageSnapshot | null; change: NewChangeAnalysis | null }> {
  // 1. Crawl the URL
  const crawled = await crawlOne(wp.source_url);
  const mdHash = createHash('sha256').update(crawled.markdown).digest('hex');

  // 2. Look up the previous snapshot for this page
  const prevRows = (await dbGet(
    `snapshots?tracked_page_id=eq.${wp.id}&order=observed_at.desc&limit=1&select=id,markdown_hash,markdown_text`,
  )) as Array<{ id: string; markdown_hash: string; markdown_text: string | null }>;
  const prev = prevRows[0];

  // 3. Skip if hash matches (no change → no snapshot, no LLM call)
  if (prev && prev.markdown_hash === mdHash) {
    return { snapshot: null, change: null };
  }

  // 4. Upload evidence to InsForge Storage (best-effort)
  const safeFileName = `snapshot-${Date.now()}.md`;
  const uploaded = await uploadEvidence(
    room.storageFolderPath ?? room.boxFolderId ?? '',
    safeFileName,
    crawled.markdown,
  );

  // 5. Insert the new snapshot
  const snapId = uuid('b');
  const observedAt = crawled.capturedAt;
  await dbInsert('snapshots', {
    id: snapId,
    tracked_page_id: wp.id,
    job_id: jobId,
    observed_at: observedAt,
    final_url: crawled.url,
    canonical_url: crawled.url,
    page_title: crawled.title || crawled.url,
    http_status: 200,
    markdown_hash: mdHash,
    markdown_text: crawled.markdown.slice(0, 50000), // cap at 50KB to keep rows small
    change_type: prev ? 'textual' : 'none', // refined by AI if change detected
    box_snapshot_folder_id: uploaded
      ? `pagevault/${(room.storageFolderPath || room.boxFolderId || '').replace(/^pagevault\//, '')}/snapshots/${observedAt.slice(0, 10)}/`
      : null,
  });

  // 6. If this is the first snapshot (no previous), or hash matches nothing
  // to analyze. Return now.
  if (!prev) {
    return {
      snapshot: {
        id: snapId,
        roomId: room.id,
        watchedUrlId: wp.id,
        scanRunId: jobId,
        url: crawled.url,
        title: crawled.title,
        textContent: crawled.text,
        contentHash: mdHash,
        storageKey: uploaded?.key ?? null,
        storageUrl: uploaded?.url ?? null,
        boxFileId: uploaded?.key ?? null,
        capturedAt: observedAt,
      },
      change: null,
    };
  }

  // 7. Call the LLM
  const prevExcerpt = extractExcerpt(prev.markdown_text || '', 800);
  const liveExcerpt = extractExcerpt(crawled.markdown, 1200);
  const userPrompt = `Tracked page: ${crawled.url}
Title: ${crawled.title || crawled.url}

=== PREVIOUS ===
${prevExcerpt || '(no previous text excerpt available)'}

=== CURRENT ===
${liveExcerpt}

Analyze the change. Return JSON only.`;
  // Call the LLM. callLlm returns the actual model used so we can persist it.
  let analysis: ChangeAnalysisResult;
  let llmModel = 'unknown';
  try {
    const result = await callLlm(SYSTEM, userPrompt, 1500);
    analysis = result.result;
    llmModel = result.model;
  } catch (err) {
    console.error(`[scan] LLM call failed for ${crawled.url}:`, err);
    // Record the snapshot but no change analysis
    return {
      snapshot: {
        id: snapId, roomId: room.id, watchedUrlId: wp.id, scanRunId: jobId,
        url: crawled.url, title: crawled.title, textContent: crawled.text,
        contentHash: mdHash, storageKey: uploaded?.key ?? null,
        storageUrl: uploaded?.url ?? null, boxFileId: uploaded?.key ?? null,
        capturedAt: observedAt,
      },
      change: null,
    };
  }

  // 8. Persist the ai_explanation. We embed the ChangeAnalysisResult into
  // output_json (severity, changeType, summary, business_interpretation,
  // recommended_actions, evidence, confidence) so the existing listChanges
  // query in lib/insforge.ts can read it back.
  const explId = uuid('c');
  const outputJson = {
    changed: true,
    severity: analysis.severity,
    changeType: analysis.changeType,
    summary: analysis.summary,
    businessInterpretation: analysis.businessInterpretation,
    recommendedActions: analysis.recommendedActions,
    evidence: analysis.evidence.map((e) => ({
      type: 'text',
      old: e.before || null,
      new: e.after || '',
      explanation: e.explanation,
    })),
    confidence: 0.85,
    crawlSource: process.env.APIFY_API_TOKEN ? 'apify' : 'direct-fetch',
  };

  await dbInsert('ai_explanations', {
    id: explId,
    snapshot_id: snapId,
    previous_snapshot_id: prev.id,
    model: llmModel,
    prompt_version: 'pagevault-scan-2026-06-02',
    output_json: JSON.stringify(outputJson),
    confidence: 0.85,
    created_at: new Date().toISOString(),
  });

  // 8a. Enqueue notification for the dispatcher (best-effort, never blocks scan)
  try {
    await enqueueNotification({ aiExplanationId: explId, projectId: room.id });
  } catch (notifErr) {
    console.error(`[scan] failed to enqueue notification for ${crawled.url}:`, notifErr);
  }

  // 9. Update the snapshot's change_type based on the analysis
  const changeTypeMap: Record<string, string> = {
    pricing: 'textual',
    positioning: 'textual',
    feature: 'structural',
    legal: 'textual',
    security: 'textual',
    hiring: 'textual',
    docs: 'textual',
    minor: 'textual',
    unknown: 'textual',
  };
  await dbUpdate('snapshots', snapId, {
    change_type: changeTypeMap[analysis.changeType] ?? 'textual',
  });

  return {
    snapshot: {
      id: snapId, roomId: room.id, watchedUrlId: wp.id, scanRunId: jobId,
      url: crawled.url, title: crawled.title, textContent: crawled.text,
      contentHash: mdHash, storageKey: uploaded?.key ?? null,
      storageUrl: uploaded?.url ?? null, boxFileId: uploaded?.key ?? null,
      capturedAt: observedAt,
    },
    change: {
      roomId: room.id,
      watchedUrlId: wp.id,
      previousSnapshotId: prev.id,
      currentSnapshotId: snapId,
      severity: analysis.severity,
      changeType: analysis.changeType,
      summary: analysis.summary,
      businessInterpretation: analysis.businessInterpretation,
      recommendedActions: analysis.recommendedActions,
      evidence: analysis.evidence.map((e) => ({
        before: e.before,
        after: e.after,
        explanation: e.explanation,
      })),
      storageKey: null,
      storageUrl: null,
    },
  };
}
