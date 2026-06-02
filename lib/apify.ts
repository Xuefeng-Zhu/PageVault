// Apify integration for PageVault.
//
// Behavior:
//   - Missing APIFY_API_TOKEN / APIFY_ACTOR_ID  → throw a clear setup error
//                                                 (Apify is the only way to get
//                                                  real web content).
//   - Real call fails (network, quota, 4xx/5xx) → throw the underlying error.
//     Apify is the source of truth for crawled content; we do NOT fall back to
//     a mock on real-call failure, because a synthetic crawl would silently
//     contaminate the evidence chain.
//
// If you need a fixture for local UI development, use the `__dev__FALLBACK__`
// env var — when set to `1`, real-call failures return a small synthetic
// fixture. This is a developer escape hatch only and is not a demo mode.
import type { ApifyPageResult } from '@/types';
import { hasApifyCreds } from './env';

// Small fixture used ONLY when the dev escape hatch is on and a real call fails.
const FALLBACK_BEFORE_PRICING = `Unlimited projects included on Starter
SSO included
API access included
All features for small teams`;

const FALLBACK_AFTER_PRICING = `10 projects included on Starter
SSO available on Enterprise
API access available on Pro
For modern enterprises only`;

function buildFallbackFixture(urls: string[]): ApifyPageResult[] {
  const now = new Date().toISOString();
  return urls.map((url, i) => {
    if (i === 0 && (url.includes('pricing') || urls.length === 1)) {
      return [
        {
          url,
          title: 'Pricing - Fixture',
          text: FALLBACK_BEFORE_PRICING,
          markdown: `# Pricing\n\n## Starter Plan\n\nUnlimited projects included on Starter\nSSO included\nAPI access included\n\nAll features for small teams`,
          html: '<html><head><title>Pricing - Fixture</title></head><body><h1>Pricing</h1><p>Unlimited projects included on Starter</p></body></html>',
          capturedAt: now,
        },
        {
          url,
          title: 'Pricing - Fixture',
          text: FALLBACK_AFTER_PRICING,
          markdown: `# Pricing\n\n## Starter Plan\n\n10 projects included on Starter\nSSO available on Enterprise\nAPI access available on Pro\n\nFor modern enterprises only`,
          html: '<html><head><title>Pricing - Fixture</title></head><body><h1>Pricing</h1><p>10 projects included on Starter</p></body></html>',
          capturedAt: now,
        },
      ];
    }
    return [
      {
        url,
        title: `Page ${i + 1}`,
        text: `Content for ${url}`,
        markdown: `# Page ${i + 1}\n\nContent for ${url}`,
        html: `<html><head><title>Page ${i + 1}</title></head><body><h1>Page ${i + 1}</h1><p>Content for ${url}</p></body></html>`,
        capturedAt: now,
      },
    ];
  }).flat();
}

function devFallbackEnabled(): boolean {
  return process.env.__dev__FALLBACK__ === '1';
}

/**
 * Crawl a list of URLs using the Apify API.
 *
 * Throws if credentials are missing or the API call fails.
 * The dev escape hatch `__dev__FALLBACK__=1` returns a synthetic fixture on
 * real-call failure; this is for local UI work and is never the default.
 */
export async function crawlUrls(urls: string[]): Promise<ApifyPageResult[]> {
  if (urls.length === 0) return [];
  if (!hasApifyCreds()) {
    throw new Error(
      'Apify credentials are not configured. Set APIFY_API_TOKEN and APIFY_ACTOR_ID ' +
      'in your environment to crawl real web pages.'
    );
  }

  const apiToken = process.env.APIFY_API_TOKEN!;
  const actorId = process.env.APIFY_ACTOR_ID!;

  let response: Response;
  try {
    response = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apiToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      }
    );
  } catch (networkErr) {
    if (devFallbackEnabled()) {
      console.warn('[apify] real call failed, dev fallback engaged:', networkErr);
      return buildFallbackFixture(urls);
    }
    throw new Error(
      `Apify request failed: ${networkErr instanceof Error ? networkErr.message : 'network error'}`
    );
  }

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    if (devFallbackEnabled()) {
      console.warn(`[apify] ${response.status} ${response.statusText} — dev fallback engaged`);
      return buildFallbackFixture(urls);
    }
    throw new Error(
      `Apify API error: ${response.status} ${response.statusText}${body ? ` — ${body.slice(0, 200)}` : ''}`
    );
  }

  const data = (await response.json()) as { items?: unknown[] };
  const items = data.items ?? [];

  return items.map((item) => {
    const anyItem = item as Record<string, unknown>;
    return {
      url: String(anyItem.url ?? ''),
      title: anyItem.title ? String(anyItem.title) : undefined,
      text: anyItem.text ? String(anyItem.text) : undefined,
      html: anyItem.html ? String(anyItem.html) : undefined,
      markdown: anyItem.markdown ? String(anyItem.markdown) : undefined,
      capturedAt: anyItem.capturedAt ? String(anyItem.capturedAt) : new Date().toISOString(),
    } satisfies ApifyPageResult;
  });
}
