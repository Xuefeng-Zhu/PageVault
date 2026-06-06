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
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { isBlockedAddress } from './scan';

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
    // Hex forms (the form new URL() normalizes the dotted-quad to when
    // the trailing bytes contain leading zeros). Without these, a URL
    // like http://[::ffff:127.0.0.1]/ was normalizeable to ::ffff:7f00:1
    // and slipped past the dotted-quad-only regex. Covers loopback,
    // private, and the cloud-metadata IP via the v4-mapped form.
    expect(isBlockedAddress('::ffff:7f00:1')).toBe(true);      // 127.0.0.1
    expect(isBlockedAddress('::ffff:0a0a:0a0a')).toBe(true);  // 10.10.10.10
    expect(isBlockedAddress('::ffff:c0a8:0101')).toBe(true);  // 192.168.1.1
    expect(isBlockedAddress('::ffff:a9fe:a9fe')).toBe(true);  // 169.254.169.254
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

describe('crawlOne (direct fetch — AbortController timeout, HIGH-4 part 2)', () => {
  // The HIGH-4 acceptance criteria require that a slow target be
  // aborted within the configured timeout (default 10s, overridable
  // via PAGEVAULT_FETCH_TIMEOUT_MS). crawlOne is not exported from
  // the production module, so we re-import via the same import the
  // production code uses and the test file already exercises.
  //
  // We mock globalThis.fetch because crawlOne uses the global
  // fetch() (Next.js runtime). vi.useRealTimers + a real setTimeout
  // gives us a deterministic wall-clock bound.
  let originalFetch: typeof globalThis.fetch;
  let originalTimeoutEnv: string | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    originalTimeoutEnv = process.env.PAGEVAULT_FETCH_TIMEOUT_MS;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalTimeoutEnv === undefined) {
      delete process.env.PAGEVAULT_FETCH_TIMEOUT_MS;
    } else {
      process.env.PAGEVAULT_FETCH_TIMEOUT_MS = originalTimeoutEnv;
    }
  });

  it('aborts a slow target within the configured timeout (50ms test budget)', async () => {
    // 50ms is well under the 10s default — guarantees this test
    // fails loudly if the abort plumbing is removed.
    process.env.PAGEVAULT_FETCH_TIMEOUT_MS = '50';
    dnsBehavior.responses.set('slow.example.com', ['93.184.216.34']);

    // Fetch that never resolves — simulates a slowloris target /
    // captive portal. The AbortController signal passed in by
    // crawlOne should fire within 50ms and reject the promise.
    const fetchSpy = vi.fn((_input: unknown, _init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        // Use the signal so we mirror the real fetch() contract —
        // when the caller aborts, this promise rejects with the
        // same AbortError the production fetch would throw.
        const init = _init as RequestInit | undefined;
        const signal = init?.signal;
        if (signal) {
          if (signal.aborted) {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
            return;
          }
          signal.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }
      }),
    );
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const { crawlOne } = await import('./scan');
    const start = Date.now();
    let err: unknown;
    try {
      await crawlOne('https://slow.example.com/');
    } catch (e) {
      err = e;
    }
    const elapsed = Date.now() - start;

    expect(err).toBeInstanceOf(Error);
    expect((err as Error).name).toBe('FetchTimeoutError');
    expect((err as Error).message).toMatch(/aborted after 50ms/);
    // The signal is the only mechanism that can produce this
    // rejection, so the fetch must have been called with a signal
    // (defense: catches regressions where someone removes signal:).
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const initArg = fetchSpy.mock.calls[0][1] as RequestInit | undefined;
    expect(initArg?.signal).toBeDefined();
    // Wall-clock bound: must be close to the 50ms budget (allow
    // generous slack for test env jitter, but not 10s).
    expect(elapsed).toBeLessThan(2000);
  });

  it('does not abort a fast target (a normal 200 OK still parses)', async () => {
    process.env.PAGEVAULT_FETCH_TIMEOUT_MS = '5000';
    dnsBehavior.responses.set('fast.example.com', ['93.184.216.34']);

    // Normal HTML response — no hang, no abort.
    const html =
      '<!doctype html><html><head><title>Hello</title></head>' +
      '<body><p>World</p></body></html>';
    const response = new Response(html, {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
    const fetchSpy = vi.fn((_input: unknown, _init?: RequestInit) =>
      Promise.resolve(response),
    );
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const { crawlOne } = await import('./scan');
    const result = await crawlOne('https://fast.example.com/');
    expect(result.title).toBe('Hello');
    expect(result.markdown).toContain('World');
    expect(result.apifyRunId).toBeNull();
  });

  it('falls back to the 10s default when PAGEVAULT_FETCH_TIMEOUT_MS is invalid (negative / non-numeric)', async () => {
    // The first test above already verifies the abort path with a
    // tiny 50ms budget. This test verifies the env-var parsing
    // path: an invalid value should be ignored and the 10s default
    // used. We assert this indirectly by reading the value off the
    // FetchTimeoutError message (the message includes the effective
    // timeoutMs). We trigger the abort by calling the signal abort
    // ourselves to avoid waiting 10s.
    process.env.PAGEVAULT_FETCH_TIMEOUT_MS = 'not-a-number';
    dnsBehavior.responses.set('medium.example.com', ['93.184.216.34']);

    const fetchSpy = vi.fn((_input: unknown, _init?: RequestInit) => {
      const init = _init as RequestInit | undefined;
      const signal = init?.signal;
      return new Promise<Response>((_resolve, reject) => {
        if (signal) {
          signal.addEventListener('abort', () => {
            const e = new Error('aborted');
            e.name = 'AbortError';
            reject(e);
          });
        }
      });
    });
    globalThis.fetch = fetchSpy as unknown as typeof globalThis.fetch;

    const { crawlOne } = await import('./scan');
    // Force the abort immediately (don't wait for the 10s default)
    // so the test doesn't run for 10 seconds.
    const pending = crawlOne('https://medium.example.com/');
    await new Promise((r) => setTimeout(r, 5));
    const initArg = fetchSpy.mock.calls[0]?.[1] as RequestInit | undefined;
    const signal = initArg?.signal as AbortSignal | undefined;
    expect(signal).toBeDefined();
    // Calling .abort() on a vi-cloned AbortSignal can fail under
    // jsdom-vitest, so dispatch the abort event directly. The
    // production code listens for the event via addEventListener
    // (matching the fetch() contract), so this is equivalent.
    signal?.dispatchEvent(new Event('abort'));
    await expect(pending).rejects.toThrow(/aborted after 10000ms/);
  });
});
