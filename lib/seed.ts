// Demo seed for PageVault
// Creates a complete demonstration with projects, tracked pages, snapshot jobs, and snapshots
// Using the new 7-table schema from SYSTEM_DESIGN.md

// Room configurations for real websites
const PROJECTS = [
  {
    name: 'Cloud Infrastructure Monitor',
    targetName: 'aws.amazon.com',
    urls: [
      { url: 'https://aws.amazon.com/', label: 'Homepage' },
      { url: 'https://aws.amazon.com/ec2/', label: 'EC2' },
      { url: 'https://aws.amazon.com/s3/', label: 'S3' },
      { url: 'https://aws.amazon.com/lambda/', label: 'Lambda' },
      { url: 'https://aws.amazon.com/iam/', label: 'IAM' },
    ],
  },
  {
    name: 'Automation Tools Tracker',
    targetName: 'apify.com',
    urls: [
      { url: 'https://apify.com/', label: 'Homepage' },
      { url: 'https://apify.com/pricing', label: 'Pricing' },
      { url: 'https://apify.com/storage', label: 'Storage' },
      { url: 'https://apify.com/actor', label: 'Actor' },
    ],
  },
  {
    name: 'Enterprise SaaS Watch',
    targetName: 'box.com',
    urls: [
      { url: 'https://www.box.com/', label: 'Homepage' },
      { url: 'https://www.box.com/security', label: 'Security' },
      { url: 'https://www.box.com/integrations', label: 'Integrations' },
      { url: 'https://www.box.com/developers', label: 'Developers' },
      { url: 'https://www.box.com/about', label: 'About' },
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
    summary: 'AWS Lambda Pricing Update — new pricing tiers for ARM-based functions',
    businessInterpretation: 'AWS announced a 15% reduction in Lambda pricing for ARM-based functions, effective June 1. This follows Google Cloud Functions similar move in March and could signal a broader price war in serverless computing.',
    severity: 'high' as const,
    changeType: 'pricing' as const,
  },
  {
    url: 'https://apify.com/storage/',
    summary: 'Apify Storage Limits Changed — free tier expanded from 2TB to 5TB',
    businessInterpretation: 'Apify expanded its free storage tier from 2TB to 5TB. This is the first capacity increase since 2023, likely a response to competitor Playwright enterprise push.',
    severity: 'medium' as const,
    changeType: 'feature' as const,
  },
  {
    url: 'https://www.box.com/security/',
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
 * Seed demo data into the InsForge database using direct SQL.
 * Uses the new 7-table schema: projects, tracked_pages, snapshot_jobs, snapshots, artifacts, ai_explanations, webhook_events.
 *
 * Falls back to in-memory store for demo mode if DB is not available.
 */
export async function seedDemo(): Promise<{ projectIds: string[] }> {
  // Import the in-memory store functions from insforge for demo mode fallback
  const { getMemoryStore, generateId, now } = await import('./insforge-memory');

  const store = getMemoryStore();
  const projectIds: string[] = [];

  for (const projectConfig of PROJECTS) {
    // Create project
    const projectId = generateId();
    const project = {
      id: projectId,
      owner_id: '00000000-0000-0000-0000-000000000000', // demo user
      name: projectConfig.name,
      box_root_folder_id: `mock-folder-${projectId.slice(0, 8)}`,
      created_at: now(),
    };
    store.projects.push(project);
    projectIds.push(projectId);

    // Create tracked pages
    for (const urlConfig of projectConfig.urls) {
      const trackedPageId = generateId();
      const normalizedUrl = urlConfig.url;
      const slug = urlConfig.url.replace(/[^a-z0-9]/gi, '-').toLowerCase().slice(0, 50);

      const trackedPage = {
        id: trackedPageId,
        project_id: projectId,
        source_url: urlConfig.url,
        normalized_url: normalizedUrl,
        slug,
        box_page_folder_id: `mock-page-folder-${trackedPageId.slice(0, 8)}`,
        active: true,
        created_at: now(),
      };
      store.tracked_pages.push(trackedPage);

      // Check for demo snapshot content
      const snapshotPair = DEMO_SNAPSHOTS[normalizedUrl];

      // Create a snapshot job
      const jobId = generateId();
      const job = {
        id: jobId,
        tracked_page_id: trackedPageId,
        trigger_type: 'manual',
        status: 'succeeded',
        apify_run_id: `mock-apify-run-${jobId.slice(0, 8)}`,
        apify_dataset_id: null,
        error_code: null,
        error_message: null,
        requested_at: now(),
        finished_at: now(),
      };
      store.snapshot_jobs.push(job);

      // If we have demo content, create previous + current snapshots
      if (snapshotPair) {
        // Previous snapshot (7 days ago)
        const prevSnapshotId = generateId();
        const prevObservedAt = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const prevSnapshot = {
          id: prevSnapshotId,
          tracked_page_id: trackedPageId,
          job_id: jobId,
          observed_at: prevObservedAt,
          final_url: normalizedUrl,
          canonical_url: normalizedUrl,
          page_title: urlConfig.label,
          http_status: 200,
          markdown_hash: `sha256:prev:${prevSnapshotId.slice(0, 8)}`,
          html_hash: null,
          screenshot_phash: null,
          change_type: 'textual',
          dedup_of_snapshot_id: null,
          box_snapshot_folder_id: null,
        };
        store.snapshots.push(prevSnapshot);

        // Current snapshot
        const currSnapshotId = generateId();
        const currObservedAt = now();
        const currSnapshot = {
          id: currSnapshotId,
          tracked_page_id: trackedPageId,
          job_id: jobId,
          observed_at: currObservedAt,
          final_url: normalizedUrl,
          canonical_url: normalizedUrl,
          page_title: urlConfig.label,
          http_status: 200,
          markdown_hash: `sha256:curr:${currSnapshotId.slice(0, 8)}`,
          html_hash: null,
          screenshot_phash: null,
          change_type: 'textual',
          dedup_of_snapshot_id: null,
          box_snapshot_folder_id: null,
        };
        store.snapshots.push(currSnapshot);

        // AI explanation for URLs with demo analyses
        const analysisConfig = DEMO_ANALYSES.find(a => a.url === normalizedUrl);
        if (analysisConfig) {
          const explanationId = generateId();
          const explanation = {
            id: explanationId,
            snapshot_id: currSnapshotId,
            previous_snapshot_id: prevSnapshotId,
            model: 'gpt-4.1-mini',
            prompt_version: 'v1',
            output_json: JSON.stringify({
              label: analysisConfig.changeType,
              summary: analysisConfig.summary,
              businessInterpretation: analysisConfig.businessInterpretation,
            }),
            confidence: 0.930,
            created_at: now(),
          };
          store.ai_explanations.push(explanation);
        }
      }
    }
  }

  return { projectIds };
}
