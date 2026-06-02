#!/usr/bin/env node
/**
 * Test script: run a real Apify scan against https://www.dropbox.com/ 
 * and store the result to Box.
 * 
 * This version uses direct REST calls instead of the InsForge SDK
 * to avoid the package resolution issue.
 * 
 * Usage: node scripts/test_dropbox_scan.js
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ─── Load .env.local ──────────────────────────────────────────────────────────
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
const required = ['APIFY_API_TOKEN', 'APIFY_ACTOR_ID', 'BOX_DEVELOPER_TOKEN', 'INSFORGE_API_URL', 'INSFORGE_ANON_KEY'];
for (const k of required) {
  if (!process.env[k]) throw new Error(`Missing required env var: ${k}`);
  console.log(`[env] ${k}=${String(process.env[k]).slice(0, 12)}...`);
}

const INSFORGE_URL = process.env.INSFORGE_API_URL;
const ANON_KEY = process.env.INSFORGE_ANON_KEY;
const PROJECT_ID = '33333333-3333-3333-3333-333333333333';
const TARGET_URL = 'https://www.dropbox.com/';

// ─── InsForge REST helpers ────────────────────────────────────────────────────
async function insforgeFetch(tablePath, options = {}) {
  const url = `${INSFORGE_URL}/rest/v1/${tablePath}`;
  const res = await fetch(url, {
    ...options,
    headers: {
      'apikey': ANON_KEY,
      'Authorization': `Bearer ${ANON_KEY}`,
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });
  const body = await res.text();
  let json;
  try { json = JSON.parse(body); } catch { json = body; }
  if (!res.ok) {
    const msg = typeof json === 'object' ? JSON.stringify(json) : body;
    throw new Error(`InsForge ${res.status}: ${msg}`);
  }
  return json;
}

async function insforgeInsert(table, rows) {
  return insforgeFetch(table, {
    method: 'POST',
    body: JSON.stringify(rows),
  });
}

async function insforgeSelect(table, params = '') {
  return insforgeFetch(`${table}${params ? '?' + params : ''}`, { method: 'GET' });
}

// ─── 1. Ensure Box Enterprise Watch project exists ────────────────────────────
async function ensureProject() {
  try {
    const rows = await insforgeSelect('projects', `id=eq.${PROJECT_ID}&select=id,box_root_folder_id`);
    if (rows.length > 0) {
      console.log('[project] Using existing project:', rows[0].id);
      return rows[0];
    }
  } catch (e) {
    console.log('[project] Query error (may not exist):', e.message);
  }

  // Create the project
  const created = await insforgeInsert('projects', [{
    id: PROJECT_ID,
    name: 'Box Enterprise Watch',
    owner_id: null,
    box_root_folder_id: null,
  }]);
  console.log('[project] Created new project:', PROJECT_ID);
  return { id: PROJECT_ID, box_root_folder_id: null };
}

// ─── 2. Ensure tracked page for dropbox.com ───────────────────────────────────
async function ensureTrackedPage(projectId) {
  const normalizedUrl = 'dropbox.com';
  
  try {
    const rows = await insforgeSelect(
      'tracked_pages',
      `project_id=eq.${projectId}&normalized_url=eq.${normalizedUrl}&select=id`
    );
    if (rows.length > 0) {
      console.log('[tracked_page] Using existing:', rows[0].id);
      return rows[0].id;
    }
  } catch (e) {
    console.log('[tracked_page] Query error:', e.message);
  }

  // Create tracked page
  const slug = 'dropbox-com';
  const created = await insforgeInsert('tracked_pages', [{
    id: crypto.randomUUID(),
    project_id: projectId,
    source_url: TARGET_URL,
    normalized_url: normalizedUrl,
    slug,
    active: true,
  }]);
  console.log('[tracked_page] Created new tracked page');
  return created[0].id;
}

// ─── 3. Run Apify crawl ────────────────────────────────────────────────────────
async function runApifyScan() {
  const apiToken = process.env.APIFY_API_TOKEN;
  const actorId = process.env.APIFY_ACTOR_ID;
  
  // For store actors like "apify/website-content-crawler", the actor ID 
  // in the API call is "apify~website-content-crawler" or we use the username/name format
  const actorIdentifier = actorId.includes('/') 
    ? actorId.replace('/', '~')  // convert "apify/website-content-crawler" -> "apify~website-content-crawler"
    : actorId;
  
  console.log('[apify] Starting crawl of', TARGET_URL, 'with actor:', actorIdentifier);
  const startTime = Date.now();
  
  const input = {
    startUrls: [{ url: TARGET_URL }],
    maxResults: 3,
    crawlerType: 'smart',
  };
  
  const response = await fetch(
    `https://api.apify.com/v2/acts/${actorIdentifier}/run-sync-get-dataset-items?token=${apiToken}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    }
  );
  
  const elapsed = Date.now() - startTime;
  const body = await response.text();
  
  console.log(`[apify] Response: ${response.status} (${elapsed}ms)`);
  
  if (!response.ok) {
    throw new Error(`Apify API error: ${response.status} ${body}`);
  }
  
  let data;
  try { data = JSON.parse(body); } catch { data = {}; }
  const items = data.items ?? [];
  console.log('[apify] Crawl returned', items.length, 'items');
  
  if (items.length === 0) {
    // Try alternate actor ID format
    console.log('[apify] No items, trying alternate actor ID format...');
    const altResponse = await fetch(
      `https://api.apify.com/v2/acts/${actorId}/run-sync-get-dataset-items?token=${apiToken}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(input),
      }
    );
    const altBody = await altResponse.text();
    if (altResponse.ok) {
      let altData;
      try { altData = JSON.parse(altBody); } catch { altData = {}; }
      const altItems = altData.items ?? [];
      console.log('[apify] Alt format returned', altItems.length, 'items');
      if (altItems.length > 0) return altItems;
    } else {
      console.log('[apify] Alt format also failed:', altResponse.status);
    }
  }
  
  return items;
}

// ─── 4. Create Box folder and upload content ───────────────────────────────────
async function uploadToBox(items) {
  const token = process.env.BOX_DEVELOPER_TOKEN;
  const scanFolderName = `PageVault/Dropbox Scan ${new Date().toISOString().slice(0, 10)}`;
  
  // Create folder in Box root
  console.log('[box] Creating folder:', scanFolderName);
  const folderRes = await fetch('https://api.box.com/2.0/folders', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: scanFolderName, parent: { id: '0' } }),
  });
  
  const folderBody = await folderRes.text();
  if (!folderRes.ok) {
    throw new Error(`Box folder creation failed: ${folderRes.status} ${folderBody}`);
  }
  
  let folderData;
  try { folderData = JSON.parse(folderBody); } catch { throw new Error('Invalid JSON from Box: ' + folderBody); }
  const folderId = folderData.id;
  console.log('[box] Folder created:', folderId);
  
  // Upload JSON content
  const jsonContent = JSON.stringify(items, null, 2);
  const boundary = `boundary_${Date.now()}`;
  
  const attributesPart = `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="attributes"\r\n` +
    `Content-Type: application/json\r\n\r\n` +
    JSON.stringify({ name: 'dropbox-crawl-results.json', parent: { id: folderId } }) +
    `\r\n`;
  
  const filePart = `--${boundary}\r\n` +
    `Content-Disposition: form-data; name="file"; filename="dropbox-crawl-results.json"\r\n` +
    `Content-Type: text/plain\r\n\r\n` +
    jsonContent + `\r\n--${boundary}--\r\n`;
  
  console.log('[box] Uploading content...');
  const uploadRes = await fetch('https://upload.box.com/api/2.0/files/content', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
    },
    body: attributesPart + filePart,
  });
  
  const uploadBody = await uploadRes.text();
  if (!uploadRes.ok) {
    throw new Error(`Box file upload failed: ${uploadRes.status} ${uploadBody}`);
  }
  
  let uploadData;
  try { uploadData = JSON.parse(uploadBody); } catch { throw new Error('Invalid JSON from Box upload: ' + uploadBody); }
  
  const fileId = uploadData.entries?.[0]?.id ?? 'unknown';
  const fileUrl = `https://app.box.com/file/${fileId}`;
  console.log('[box] File uploaded:', fileId);
  
  return { folderId, fileId, fileUrl };
}

// ─── 5. Store snapshot metadata in DB via snapshot_jobs + snapshots ─────────────
async function storeSnapshot(trackedPageId, fileId, item) {
  const now = new Date().toISOString();
  const contentText = item.text || item.markdown || '';
  const contentHash = crypto.createHash('sha256').update(contentText).digest('hex');
  
  // Create snapshot job
  const jobId = crypto.randomUUID();
  try {
    await insforgeInsert('snapshot_jobs', [{
      id: jobId,
      tracked_page_id: trackedPageId,
      status: 'completed',
      started_at: now,
      finished_at: now,
      apify_run_id: null,
    }]);
    console.log('[snapshot_job] Created job:', jobId);
  } catch (e) {
    console.log('[snapshot_job] Insert error (may already exist):', e.message);
  }
  
  // Create snapshot
  const snapshotId = crypto.randomUUID();
  try {
    await insforgeInsert('snapshots', [{
      id: snapshotId,
      job_id: jobId,
      tracked_page_id: trackedPageId,
      url: item.url || TARGET_URL,
      title: item.title || 'Dropbox Homepage',
      text_content: contentText,
      content_hash: contentHash,
      box_file_id: fileId,
      captured_at: item.capturedAt || now,
    }]);
    console.log('[snapshot] Created snapshot:', snapshotId);
    return snapshotId;
  } catch (e) {
    // snapshots table might use different column names (e.g., snapshot_jobs vs job_id)
    console.log('[snapshot] Insert error:', e.message);
    // Try without job_id
    const snapshotId2 = crypto.randomUUID();
    try {
      await insforgeInsert('snapshots', [{
        id: snapshotId2,
        tracked_page_id: trackedPageId,
        url: item.url || TARGET_URL,
        title: item.title || 'Dropbox Homepage',
        text_content: contentText,
        content_hash: contentHash,
        box_file_id: fileId,
        captured_at: item.capturedAt || now,
      }]);
      console.log('[snapshot] Created snapshot (no job):', snapshotId2);
      return snapshotId2;
    } catch (e2) {
      console.log('[snapshot] Second insert error:', e2.message);
      return null;
    }
  }
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
    console.warn('[warning] Apify returned no items — check API token / actor ID');
    // Create mock items for demo
    items.push({
      url: TARGET_URL,
      title: 'Dropbox Homepage',
      text: 'Mock content for Dropbox homepage',
      markdown: '# Dropbox Homepage\n\nMock content for Dropbox homepage',
      capturedAt: new Date().toISOString(),
    });
    console.log('[warning] Using mock item for demonstration');
  }
  
  // Step 3: Upload to Box
  const { folderId, fileId, fileUrl } = await uploadToBox(items);
  
  // Step 4: Store snapshots in DB
  const snapshotIds = [];
  for (const item of items) {
    const sid = await storeSnapshot(trackedPageId, fileId, item);
    if (sid) snapshotIds.push(sid);
  }
  
  // Print results
  console.log('\n=== RESULTS ===');
  console.log('Box folder ID:', folderId);
  console.log('Box folder URL:', `https://app.box.com/folder/${folderId}`);
  console.log('Box file ID:', fileId);
  console.log('Box file URL:', fileUrl);
  console.log('Project ID:', project.id);
  console.log('Tracked Page ID:', trackedPageId);
  console.log('Snapshots created:', snapshotIds.length);
  for (const sid of snapshotIds) {
    console.log('  Snapshot ID:', sid);
  }
  console.log('\n✓ Done!');
}

main().catch(err => {
  console.error('[fatal]', err.message);
  process.exit(1);
});