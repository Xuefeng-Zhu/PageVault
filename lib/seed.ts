// Demo seed for PageVault
// Creates a complete demonstration room with before/after data and change analyses
import { createRoom, addWatchedUrls, insertSnapshot, insertChangeAnalysis, createScanRun, completeScanRun } from './insforge';
import { createBoxFolder } from './box';
import { hashContent } from './diff';
import type { NewChangeAnalysis } from '@/types';

// Room configurations for real websites
const ROOMS = [
  {
    name: 'Cloud Infrastructure Monitor',
    targetName: 'aws.amazon.com',
    category: 'competitor',
    baseUrl: 'https://aws.amazon.com',
    status: 'Active' as const,
    urls: [
      { url: 'https://aws.amazon.com/', label: 'Homepage', pageType: 'homepage' },
      { url: 'https://aws.amazon.com/ec2/', label: 'EC2', pageType: 'product' },
      { url: 'https://aws.amazon.com/s3/', label: 'S3', pageType: 'product' },
      { url: 'https://aws.amazon.com/lambda/', label: 'Lambda', pageType: 'product' },
      { url: 'https://aws.amazon.com/iam/', label: 'IAM', pageType: 'product' },
    ],
  },
  {
    name: 'Automation Tools Tracker',
    targetName: 'apify.com',
    category: 'competitor',
    baseUrl: 'https://apify.com',
    status: 'Active' as const,
    urls: [
      { url: 'https://apify.com/', label: 'Homepage', pageType: 'homepage' },
      { url: 'https://apify.com/pricing', label: 'Pricing', pageType: 'pricing' },
      { url: 'https://apify.com/storage', label: 'Storage', pageType: 'product' },
      { url: 'https://apify.com/actor', label: 'Actor', pageType: 'product' },
    ],
  },
  {
    name: 'Enterprise SaaS Watch',
    targetName: 'box.com',
    category: 'competitor',
    baseUrl: 'https://www.box.com',
    status: 'Paused' as const,
    urls: [
      { url: 'https://www.box.com/', label: 'Homepage', pageType: 'homepage' },
      { url: 'https://www.box.com/security', label: 'Security', pageType: 'trust' },
      { url: 'https://www.box.com/integrations', label: 'Integrations', pageType: 'product' },
      { url: 'https://www.box.com/developers', label: 'Developers', pageType: 'docs' },
      { url: 'https://www.box.com/about', label: 'About', pageType: 'company' },
    ],
  },
];

// Demo snapshot content pairs for AWS Lambda (previous → current)
const DEMO_SNAPSHOTS: Record<string, { previous: string; current: string }> = {
  'https://aws.amazon.com/lambda/': {
    previous: `# AWS Lambda - Serverless Computing

## Pricing
- $0.20 per 1M requests
- $0.0000166667 per GB-second
- ARM-based functions: 20% cheaper

## Use Cases
- Web backends
- Data processing
- Real-time file processing
- IoT backends`,
    current: `# AWS Lambda - Serverless Computing

## Pricing
- $0.20 per 1M requests (x86)
- $0.17 per 1M requests (ARM) — NEW
- $0.0000166667 per GB-second (x86)
- $0.0000133334 per GB-second (ARM) — NEW 15% reduction
- ARM-based functions now 20% cheaper (increased from 20%) — UPDATED

## New ARM-based Pricing Tiers
- Functions using Graviton2 processors receive 15% additional discount
- Effective June 1, 2026

## Use Cases
- Web backends
- Data processing
- Real-time file processing
- IoT backends
- AI/ML inference — NEW`,
  },
  'https://apify.com/storage/': {
    previous: `# Apify Storage

## Free Tier
- 2TB storage included
- 100GB request bandwidth
- 30 days data retention

## Team Plan - $49/month
- 5TB storage
- 1TB request bandwidth
- 90 days data retention
- Priority support`,
    current: `# Apify Storage

## Free Tier — UPDATED
- 5TB storage included (was 2TB)
- 100GB request bandwidth
- 30 days data retention

## Team Plan - $49/month
- 10TB storage (was 5TB)
- 2TB request bandwidth (was 1TB)
- 90 days data retention
- Priority support`,
  },
  'https://www.box.com/security': {
    previous: `# Box Security

## Compliance
- SOC 2 Type II certified
- ISO 27001:2013 certified
- GDPR compliant

## Security Features
- Enterprise key management
- Box Shield for malware protection
- Two-factor authentication

## Controls
- 45 control objectives
- Annual audit`,
    current: `# Box Security — UPDATED

## Compliance
- SOC 2 Type II certified
- ISO 27001:2022 certified — UPDATED
- GDPR compliant
- CCPA compliant — NEW

## Security Features
- Enterprise key management
- Box Shield for malware protection
- Two-factor authentication
- AI Data Handling controls — NEW

## Controls — EXPANDED
- 57 control objectives (was 45)
- 12 new AI data handling controls — NEW
- Annual audit`,
  },
};

// Demo change analyses
const DEMO_ANALYSES = [
  {
    url: 'https://aws.amazon.com/lambda/',
    pageType: 'pricing' as const,
    summary: 'AWS Lambda Pricing Update — new pricing tiers for ARM-based functions',
    businessInterpretation: 'AWS announced a 15% reduction in Lambda pricing for ARM-based functions, effective June 1. This follows Google\'s similar move in March and could signal a broader price war in serverless computing.',
    severity: 'high' as const,
    changeType: 'pricing' as const,
  },
  {
    url: 'https://apify.com/storage/',
    pageType: 'product' as const,
    summary: 'Apify Storage Limits Changed — free tier expanded from 2TB to 5TB',
    businessInterpretation: 'Apify expanded its free storage tier from 2TB to 5TB. This is the first capacity increase since 2023, likely a response to competitor Playwright\'s enterprise push.',
    severity: 'medium' as const,
    changeType: 'feature' as const,
  },
  {
    url: 'https://www.box.com/security/',
    pageType: 'trust' as const,
    summary: 'Box Security Whitepaper Updated — SOC 2 and ISO 27001:2022 certification',
    businessInterpretation: 'Box updated their SOC 2 compliance certification. The new report covers ISO 27001:2022 requirements and adds 12 new control objectives for AI data handling.',
    severity: 'low' as const,
    changeType: 'security' as const,
  },
];

const RECOMMENDED_ACTIONS = [
  'Update competitive battlecards with new pricing tiers',
  'Monitor Google Cloud Functions for similar price adjustments',
  'Review serverless cost projections for Q3',
  'Share findings with infrastructure team for architecture decisions',
];

/**
 * Seed demo rooms with complete before/after data.
 * Creates three rooms (AWS, Apify, Box), watched URLs, snapshots, and change analyses.
 *
 * Returns the seeded room ids.
 */
export async function seedDemo(): Promise<{ roomIds: string[] }> {
  const roomIds: string[] = [];

  for (const roomConfig of ROOMS) {
    // Create Box folder
    let boxFolderId: string | null = null;
    try {
      boxFolderId = await createBoxFolder(`PageVault/${roomConfig.name}`);
    } catch {
      boxFolderId = `mock-folder-${roomConfig.name.toLowerCase().replace(/\s+/g, '-')}`;
    }

    const room = await createRoom({
      name: roomConfig.name,
      targetName: roomConfig.targetName,
      category: roomConfig.category,
      boxFolderId,
    });
    roomIds.push(room.id);

    // Create a scan run
    let scanRun = { id: `demo-scan-${room.id}` };
    try {
      scanRun = await createScanRun(room.id);
      await completeScanRun(scanRun.id);
    } catch {
      // Non-fatal if scan run creation fails
    }

    // Add watched URLs
    const urls = roomConfig.urls.map(u => ({
      roomId: room.id,
      url: u.url,
      label: u.label,
      pageType: u.pageType,
    }));

    const watchedUrls = await addWatchedUrls(room.id, urls);

    // Insert snapshots and analyses for URLs with demo content
    for (const watchedUrl of watchedUrls) {
      const snapshotPair = DEMO_SNAPSHOTS[watchedUrl.url];
      if (!snapshotPair) continue;

      try {
        const prevSnapshot = await insertSnapshot({
          roomId: room.id,
          watchedUrlId: watchedUrl.id,
          scanRunId: scanRun.id,
          url: watchedUrl.url,
          title: watchedUrl.label ?? '',
          textContent: snapshotPair.previous,
          contentHash: hashContent(snapshotPair.previous),
          boxFileId: null,
          capturedAt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
        });

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
                explanation: 'Content changed between versions',
              },
            ],
            reportBoxFileId: null,
          };
          await insertChangeAnalysis(analysis);
        }
      } catch (err) {
        console.error(`Demo seed: failed to create snapshot/analysis for ${watchedUrl.url}:`, err);
      }
    }
  }

  return { roomIds };
}