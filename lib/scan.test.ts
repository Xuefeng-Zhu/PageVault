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
import { describe, it, expect, vi } from 'vitest';
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
