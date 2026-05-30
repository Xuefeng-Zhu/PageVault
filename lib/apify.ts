// Apify integration for PageVault
// Crawls URLs via the Apify API or returns deterministic mock results when credentials are absent
import type { ApifyPageResult } from '@/types';
import { hasApifyCreds } from './env';

// Mock content for before/after pricing page versions
const MOCK_BEFORE_PRICING = `Unlimited projects included on Starter
SSO included
API access included
All features for small teams`;

const MOCK_AFTER_PRICING = `10 projects included on Starter
SSO available on Enterprise
API access available on Pro
For modern enterprises only`;

// Deterministic mock results
function getMockResults(urls: string[]): ApifyPageResult[] {
  const now = new Date().toISOString();
  return urls.map((url, i) => {
    // First URL gets the pricing page mock with before/after versions
    if (i === 0 && (url.includes('pricing') || urls.length === 1)) {
      return [
        {
          url,
          title: 'Pricing - DemoCo',
          text: MOCK_BEFORE_PRICING,
          markdown: `# Pricing\n\n## Starter Plan\n\nUnlimited projects included on Starter\nSSO included\nAPI access included\n\nAll features for small teams`,
          html: '<html><head><title>Pricing - DemoCo</title></head><body><h1>Pricing</h1><p>Unlimited projects included on Starter</p></body></html>',
          capturedAt: now,
        },
        {
          url,
          title: 'Pricing - DemoCo',
          text: MOCK_AFTER_PRICING,
          markdown: `# Pricing\n\n## Starter Plan\n\n10 projects included on Starter\nSSO available on Enterprise\nAPI access available on Pro\n\nFor modern enterprises only`,
          html: '<html><head><title>Pricing - DemoCo</title></head><body><h1>Pricing</h1><p>10 projects included on Starter</p></body></html>',
          capturedAt: now,
        },
      ];
    }
    // Other URLs get a generic mock
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

/**
 * Crawl a list of URLs using the Apify API or return mock results.
 * Real mode: calls `run-sync-get-dataset-items` when credentials are present.
 * Mock mode: returns deterministic mock results when credentials are absent or the call fails.
 * Never throws - failures always fall back to mock results.
 */
export async function crawlUrls(urls: string[]): Promise<ApifyPageResult[]> {
  if (!hasApifyCreds() || urls.length === 0) {
    return getMockResults(urls);
  }

  try {
    const apiToken = process.env.APIFY_API_TOKEN!;
    const actorId = process.env.APIFY_ACTOR_ID!;

    const response = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apiToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls }),
      }
    );

    if (!response.ok) {
      console.error(`Apify API error: ${response.status} ${response.statusText}`);
      return getMockResults(urls);
    }

    const data = await response.json() as { items?: unknown[] };
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
  } catch (error) {
    console.error('Apify crawl failed, using mock results:', error);
    return getMockResults(urls);
  }
}

// Export mock content constants for testing
export const MOCK_BEFORE = MOCK_BEFORE_PRICING;
export const MOCK_AFTER = MOCK_AFTER_PRICING;