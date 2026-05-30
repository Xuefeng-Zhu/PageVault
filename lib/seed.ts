// Demo seed for PageVault
// Creates a complete demonstration room with before/after data and change analyses
import { createRoom, addWatchedUrls, insertSnapshot, insertChangeAnalysis, createScanRun, completeScanRun } from './insforge';
import { createBoxFolder } from './box';
import { hashContent } from './diff';
import type { NewChangeAnalysis } from '@/types';

// Demo room configuration
const DEMO_ROOM_NAME = 'DemoCo';
const DEMO_TARGET_NAME = 'DemoCo Inc.';
const DEMO_CATEGORY = 'competitor';

// Demo URLs with labels and page types
const DEMO_URLS = [
  { url: 'https://democo.com/', label: 'Homepage', pageType: 'homepage' },
  { url: 'https://democo.com/pricing', label: 'Pricing', pageType: 'pricing' },
  { url: 'https://democo.com/security', label: 'Security Docs', pageType: 'docs' },
  { url: 'https://democo.com/changelog', label: 'Changelog', pageType: 'changelog' },
  { url: 'https://democo.com/careers', label: 'Careers', pageType: 'careers' },
];

// Demo snapshot content pairs (previous → current)
const DEMO_SNAPSHOTS: Record<string, { previous: string; current: string }> = {
  'https://democo.com/': {
    previous: `# DemoCo - For Small Teams

DemoCo helps small teams collaborate and ship faster. Our platform is designed for teams of up to 10 people, offering unlimited projects, SSO integration, and full API access on our Starter plan.

Trusted by over 10,000 small businesses worldwide.`,
    current: `# DemoCo - For Modern Enterprises

DemoCo helps modern enterprises scale efficiently. Our platform is designed for growing teams, offering 10 projects on Starter, SSO on Enterprise, and API access on Pro.

Trusted by over 10,000 companies worldwide.`,
  },
  'https://democo.com/pricing': {
    previous: `# Pricing Plans

## Starter Plan - $29/month
Unlimited projects included on Starter
SSO included
API access included
All features for small teams

## Enterprise Plan - $99/month
Unlimited everything
Advanced security
Priority support`,
    current: `# Pricing Plans

## Starter Plan - $49/month
10 projects included on Starter
SSO available on Enterprise
API access available on Pro
For teams with basic needs

## Enterprise Plan - $199/month
Unlimited everything
Advanced security
Priority support
SSO included`,
  },
  'https://democo.com/security': {
    previous: `# Security Documentation

## Authentication

DemoCo supports SSO with SAML 2.0 for all Starter plans. OAuth 2.0 is available for API access. Our security framework is SOC 2 Type II compliant.

## Data Privacy

All data is encrypted at rest and in transit. GDPR compliant.`,
    current: `# Security Documentation

## Authentication

DemoCo supports SSO with SAML 2.0 for Enterprise plans only. OAuth 2.0 is available for Pro plans. Our security framework is SOC 2 Type II compliant.

## Data Privacy

All data is encrypted at rest and in transit. GDPR compliant.`,
  },
  'https://democo.com/changelog': {
    previous: `# Changelog

## v2.1.0 - June 2024
- Performance improvements
- Bug fixes
- UI refinements

## v2.0.0 - May 2024
- Major platform update
- New dashboard design`,
    current: `# Changelog

## v2.2.0 - July 2024
- Pricing changes
- New enterprise features
- Performance improvements

## v2.1.0 - June 2024
- Performance improvements
- Bug fixes
- UI refinements`,
  },
  'https://democo.com/careers': {
    previous: `# Careers at DemoCo

We're always looking for talented people to join our team.

## Open Positions

- Senior Software Engineer
- Product Designer

## Benefits

- Competitive salary
- Health insurance
- Remote work options`,
    current: `# Careers at DemoCo

We're always looking for talented people to join our team.

## Open Positions

- Senior Software Engineer
- Product Designer
- Enterprise Account Executive

## Benefits

- Competitive salary
- Health insurance
- Remote work options
- Stock options`,
  },
};

// Demo change analyses (5 specific changes as per requirements)
const DEMO_ANALYSES = [
  {
    url: 'https://democo.com/pricing',
    pageType: 'pricing' as const,
    summary: 'Pricing plan changed - Starter plan project limit reduced from unlimited to 10 projects',
    businessInterpretation: 'DemoCo appears to be moving upmarket, shifting from unlimited Starter to a 10-project limit while gating SSO and API access to higher paid tiers. This suggests they are repositioning their entry tier to capture more revenue from growing teams.',
    severity: 'high' as const,
    changeType: 'pricing' as const,
  },
  {
    url: 'https://democo.com/security',
    pageType: 'docs' as const,
    summary: 'SSO availability moved from Starter to Enterprise tier',
    businessInterpretation: 'Security offering change detected - SSO moved to Enterprise tier suggests pricing restructuring. Existing Starter customers using SSO will need to upgrade or find alternative solutions.',
    severity: 'medium' as const,
    changeType: 'security' as const,
  },
  {
    url: 'https://democo.com/security',
    pageType: 'docs' as const,
    summary: 'API access moved from Starter to Pro tier',
    businessInterpretation: 'API access change suggests DemoCo is decoupling API access as a separate paid feature. Teams relying on API integration on Starter plan will need to upgrade.',
    severity: 'medium' as const,
    changeType: 'feature' as const,
  },
  {
    url: 'https://democo.com/',
    pageType: 'homepage' as const,
    summary: 'Market positioning changed from "for small teams" to "for modern enterprises"',
    businessInterpretation: 'Market positioning shift detected - moving from "small teams" to "modern enterprises" indicates target market change. DemoCo is clearly repositioning away from SMB toward mid-market/enterprise.',
    severity: 'medium' as const,
    changeType: 'positioning' as const,
  },
  {
    url: 'https://democo.com/careers',
    pageType: 'careers' as const,
    summary: 'New "Enterprise Account Executive" position added',
    businessInterpretation: 'New enterprise sales role added, supporting the positioning shift toward enterprise customers. DemoCo is building out enterprise sales capability.',
    severity: 'low' as const,
    changeType: 'hiring' as const,
  },
];

const RECOMMENDED_ACTIONS = [
  'Update the competitive battlecard to reflect new pricing tiers',
  'Review vendor renewal risk for DemoCo accounts',
  'Ask whether existing customers are grandfathered on unlimited Starter',
  'Monitor future pricing changes and communicate to customers',
];

/**
 * Seed the demo room with complete before/after data.
 * Creates the DemoCo room, 5 watched URLs, previous/current snapshots for each,
 * and 5 specific change analyses with the documented content.
 *
 * Returns the seeded room id.
 * Individual insert failures are logged and skipped; returns room id if room creation succeeded.
 */
export async function seedDemo(): Promise<{ roomId: string }> {
  // Create the demo room and its Box folder
  let boxFolderId: string | null = null;

  try {
    boxFolderId = await createBoxFolder(`PageVault/${DEMO_ROOM_NAME}`);
  } catch {
    // Box folder creation failure is non-fatal in demo mode
    boxFolderId = 'mock-folder-democo-1';
  }

  const room = await createRoom({
    name: DEMO_ROOM_NAME,
    targetName: DEMO_TARGET_NAME,
    category: DEMO_CATEGORY,
    boxFolderId,
  });

  // Create a scan run to have a valid scan run ID for snapshots
  let scanRun = { id: 'demo-scan-previous' };
  try {
    scanRun = await createScanRun(room.id);
    await completeScanRun(scanRun.id);
  } catch {
    // Non-fatal if scan run creation fails
  }

  // Add the 5 watched URLs
  const urls = DEMO_URLS.map(u => ({
    roomId: room.id,
    url: u.url,
    label: u.label,
    pageType: u.pageType,
  }));

  let watchedUrls = await addWatchedUrls(room.id, urls);

  // Insert snapshots and analyses for each URL with demo data
  for (let i = 0; i < watchedUrls.length; i++) {
    const watchedUrl = watchedUrls[i];
    const snapshotPair = DEMO_SNAPSHOTS[watchedUrl.url];

    if (!snapshotPair) {
      // URL without specific demo content - skip snapshot creation
      continue;
    }

    try {
      // Insert previous snapshot
      const prevSnapshot = await insertSnapshot({
        roomId: room.id,
        watchedUrlId: watchedUrl.id,
        scanRunId: scanRun.id,
        url: watchedUrl.url,
        title: watchedUrl.label ?? '',
        textContent: snapshotPair.previous,
        contentHash: hashContent(snapshotPair.previous),
        boxFileId: null,
        capturedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(), // 7 days ago
      });

      // Insert current snapshot
      const currSnapshot = await insertSnapshot({
        roomId: room.id,
        watchedUrlId: watchedUrl.id,
        scanRunId: scanRun.id,
        url: watchedUrl.url,
        title: watchedUrl.label ?? '',
        textContent: snapshotPair.current,
        contentHash: hashContent(snapshotPair.current),
        boxFileId: null,
        capturedAt: new Date().toISOString(),
      });

      // Find the change analysis config for this URL
      const analysisConfig = DEMO_ANALYSES.find(a => a.url === watchedUrl.url);
      if (analysisConfig) {
        const analysis: NewChangeAnalysis = {
          roomId: room.id,
          watchedUrlId: watchedUrl.id,
          previousSnapshotId: prevSnapshot.id,
          currentSnapshotId: currSnapshot.id,
          severity: analysisConfig.severity,
          changeType: analysisConfig.changeType,
          summary: analysisConfig.summary,
          businessInterpretation: analysisConfig.businessInterpretation,
          recommendedActions: RECOMMENDED_ACTIONS,
          evidence: [
            {
              before: snapshotPair.previous.split('\n').find(l => l.trim().length > 0) ?? snapshotPair.previous.slice(0, 100),
              after: snapshotPair.current.split('\n').find(l => l.trim().length > 0) ?? snapshotPair.current.slice(0, 100),
              explanation: 'Pricing and feature availability changed between versions',
            },
          ],
          reportBoxFileId: null,
        };
        await insertChangeAnalysis(analysis);
      }
    } catch (err) {
      console.error(`Demo seed: failed to create snapshot/analysis for ${watchedUrl.url}:`, err);
      // Continue with other URLs
    }
  }

  return { roomId: room.id };
}