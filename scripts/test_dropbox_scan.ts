#!/usr/bin/env node
/**
 * Test script: run a real Apify scan against https://www.dropbox.com/ 
 * and store the result to Box.
 * 
 * Usage: npx tsx scripts/test_dropbox_scan.ts
 * 
 * Requires .env.local with:
 *   APIFY_API_TOKEN, APIFY_ACTOR_ID, BOX_DEVELOPER_TOKEN, INSFORGE_*, NEXTAUTH_SECRET
 */

import * as fs from 'fs';
import * as path from 'path';
import { createHash } from 'node:crypto';

// Load .env.local
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env.local');
  if (!fs.existsSync(envPath)) {
    throw new Error('.env.local not found at ' + envPath);
  }
  const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    const value = trimmed.slice(eqIdx + 1).trim();
    process.env[key] = value;
  }
  console.log('[env] Loaded .env.local');
}

loadEnv();

// Verify critical env vars
const required = [
  'APIFY_API_TOKEN', 'APIFY_ACTOR_ID', 'BOX_DEVELOPER_TOKEN',
  'INSFORGE_API_URL', 'INSFORGE_ANON_KEY'
];
for (const k of required) {
  if (!process.env[k]) {
    throw new Error(`Missing required env var: ${k}`);
  }
  console.log(`[env] ${k}=${String(process.env[k]).slice(0, 12)}...`);
}

// ─── Insforge SDK setup ────────────────────────────────────────────────────────
import { createClient } from '@insforge/sdk';
const sdk = createClient({
  baseUrl: process.env.INSFORGE_API_URL!,
  anonKey: process.env.INSFORGE_ANON_KEY!,
});

// ─── 1. Create or reuse the Box Enterprise Watch project ──────────────────────
const PROJECT_ID = '33333333-3333-3333-3333-333333333333';
const TARGET_URL = 'https://www.dropbox.com/';

async function ensureProject(): Promise<{ id: string; boxFolderId: string | null }> {
  // Try to fetch existing project
  const { data, error } = await sdk.database
    .from('projects')
    .select('id, box_root_folder_id')
    .eq('id', PROJECT_ID)
    .single();
  
  if (error && error.message?.includes('No rows')) {
    // Create it
    const created = await sdk.database.from('projects').insert([{
      id: PROJECT_ID,
      name: 'Box Enterprise Watch',
      owner_id: null,
      box_root_folder_id: null,
    }]).select('id, box_root_folder_id').single();
    
    if (created.error || !created.data) {
      throw new Error('Failed to create project: ' + created.error?.message);
    }
    console.log('[project] Created new project:', created.data.id);
    return { id: created.data.id, boxFolderId: created.data.box_root_folder_id ?? null };
  }
  
  if (error) {
    throw new Error('Failed to fetch project: ' + error.message);
  }
  
  console.log('[project] Using existing project:', data!.id);
  return { id: data!.id, boxFolderId: data!.box_root_folder_id ?? null };
}

// ─── 2. Ensure tracked page exists for dropbox.com ────────────────────────────
async function ensureTrackedPage(projectId: string): Promise<string> {
  const normalizedUrl = 'dropbox.com';
  const slug = 'dropbox-com';

  const { data, error } = await sdk.database
    .from('tracked_pages')
    .select('id')
    .eq('project_id', projectId)
    .eq('normalized_url', normalizedUrl)
    .single();

  if (data) {
    console.log('[tracked_page] Using existing tracked page:', data.id);
    return data.id;
  }

  if (error && error.message?.includes('No rows')) {
    const created = await sdk.database.from('tracked_pages').insert([{
      project_id: projectId,
      source_url: TARGET_URL,
      normalized_url: normalizedUrl,
      slug,
      active: true,
    }]).select('id').single();

    if (created.error || !created.data) {
      throw new Error('Failed to create tracked page: ' + created.error?.message);
    }
    console.log('[tracked_page] Created new tracked page:', created.data.id);
    return created.data.id;
  }

  throw new Error('Failed to fetch tracked page: ' + error?.message);
}

// ─── 3. Run Apify crawl ────────────────────────────────────────────────────────
async function runApifyScan(): Promise<any[]> {
  const apiToken = process.env.APIFY_API_TOKEN!;
  const actorId = process.env.APIFY_ACTOR_ID!;
  
  // Resolve actor name to actor ID if needed
  let targetActorId = actorId;
  if (actorId.includes('/') && !actorId.match(/^\d+$/)) {
    // It's a store actor name like "apify/website-content-crawler"
    // We need to call the actor by its store name directly
    console.log('[apify] Using actor:', actorId);
  }

  // The actor input format for apify/website-content-crawler
  const input = {
    startUrls: [{ url: TARGET_URL }],
    maxResults: 3,
    // Only get the main page to keep it simple
    crawlerType: 'smart',
  };

  console.log('[apify] Starting crawl of', TARGET_URL);
  const startTime = Date.now();

  const response = await fetch(
    `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apiToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );

  const elapsed = Date.now() - startTime;
  console.log(`[apify] Response status: ${response.status} (${elapsed}ms)`);

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Apify API error: ${response.status} ${errText}`);
  }

  const data = await response.json() as { items?: any[] };
  const items = data.items ?? [];
  console.log('[apify] Crawl returned', items.length, 'items');
  return items;
}

// ─── 4. Create Box folder and upload content ───────────────────────────────────
async function uploadToBox(items: any[]): Promise<{ folderId: string; fileId: string; fileUrl: string }> {
  const token = process.env.BOX_DEVELOPER_TOKEN!;
  
  // Create a scan folder in Box root
  const scanFolderName = `PageVault/Dropbox Scan ${new Date().toISOString().slice(0, 10)}`;
  
  // Create folder
  const folderResponse = await fetch('https://api.box.com/2.0/folders', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      name: scanFolderName,
      parent: { id: '0' },
    }),
  });

  if (!folderResponse.ok) {
    const errText = await folderResponse.text();
    throw new Error(`Box folder creation failed: ${folderResponse.status} ${errText}`);
  }

  const folderData = await folderResponse.json() as { id: string };
  const folderId = folderData.id;
  console.log('[box] Created folder:', folderId);

  // Upload raw crawl results as JSON
  const jsonContent = JSON.stringify(items, null, 2);
  const boundary = `boundary_${Date.now()}`;
  
  const attributesPart = `--${boundary}\r\nContent-Disposition: form-data; name="attributes"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({
    name: 'dropbox-crawl-results.json',
    parent: { id: folderId },
  })}\r\n`;

  const filePart = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="dropbox-crawl-results.json"\r\nContent-Type: text/plain\r\n\r\n${jsonContent}\r\n--${boundary}--\r\n`;

  const uploadResponse = await fetch('https://upload.box.com/api/2.0/files/content', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: attributesPart + filePart,
  });

  if (!uploadResponse.ok) {
    const errText = await uploadResponse.text();
    throw new Error(`Box file upload failed: ${uploadResponse.status} ${errText}`);
  }

  const uploadData = await uploadResponse.json() as { entries?: Array<{ id: string }> };
  const fileId = uploadData.entries?.[0]?.id ?? 'unknown';
  const fileUrl = `https://app.box.com/file/${fileId}`;
  
  console.log('[box] Uploaded file:', fileId, '->', fileUrl);
  return { folderId, fileId, fileUrl };
}

// ─── 5. Store snapshot metadata in DB ─────────────────────────────────────────
async function storeSnapshot(trackedPageId: string, fileId: string, item: any): Promise<string> {
  const now = new Date().toISOString();
  const contentText = item.text || item.markdown || '';
  const contentHash = createHash('sha256').update(contentText).digest('hex');
  
  // Create a snapshot job first
  const jobResult = await sdk.database.from('snapshot_jobs').insert([{
    tracked_page_id: trackedPageId,
    status: 'completed',
    started_at: now,
    finished_at: now,
    apify_run_id: null,
  }]).select('id').single();
  
  if (jobResult.error || !jobResult.data) {
    // Try snapshots table directly
    const snapshotResult = await sdk.database.from('snapshots').insert([{
      tracked_page_id: trackedPageId,
      url: item.url,
      title: item.title || '',
      text_content: contentText,
      content_hash: contentHash,
      box_file_id: fileId,
      captured_at: item.capturedAt || now,
    }]).select('id').single();
    
    if (snapshotResult.error || !snapshotResult.data) {
      throw new Error('Failed to create snapshot: ' + snapshotResult.error?.message);
    }
    console.log('[snapshot] Created snapshot:', snapshotResult.data.id);
    return snapshotResult.data.id;
  }
  
  const jobId = jobResult.data.id;
  
  // Create snapshot
  const snapshotResult = await sdk.database.from('snapshots').insert([{
    job_id: jobId,
    tracked_page_id: trackedPageId,
    url: item.url,
    title: item.title || '',
    text_content: contentText,
    content_hash: contentHash,
    box_file_id: fileId,
    captured_at: item.capturedAt || now,
  }]).select('id').single();
  
  if (snapshotResult.error || !snapshotResult.data) {
    throw new Error('Failed to create snapshot: ' + snapshotResult.error?.message);
  }
  
  console.log('[snapshot] Created snapshot:', snapshotResult.data.id, '(job:', jobId + ')');
  return snapshotResult.data.id;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('\n=== PageVault Dropbox Scan Test ===\n');
  
  // Step 1: Setup project and tracked page
  const project = await ensureProject();
  const trackedPageId = await ensureTrackedPage(project.id);
  
  // Step 2: Run Apify crawl
  const items = await runApifyScan();
  
  if (items.length === 0) {
    console.warn('[warning] Apify returned no items, using mock data');
  }
  
  // Step 3: Upload to Box
  const { folderId, fileId, fileUrl } = await uploadToBox(items);
  
  // Step 4: Store snapshot in DB
  const snapshotIds: string[] = [];
  for (const item of items) {
    try {
      const snapshotId = await storeSnapshot(trackedPageId, fileId, item);
      snapshotIds.push(snapshotId);
    } catch (err) {
      console.error('[snapshot] Failed to store snapshot:', err);
    }
  }
  
  // Print results
  console.log('\n=== RESULTS ===');
  console.log('Box folder ID:', folderId);
  console.log('Box file ID:', fileId);
  console.log('Box file URL:', fileUrl);
  console.log('Snapshots created:', snapshotIds.length);
  for (const sid of snapshotIds) {
    console.log('  Snapshot ID:', sid);
  }
  console.log('\nDone!');
}

main().catch(err => {
  console.error('[fatal]', err);
  process.exit(1);
});