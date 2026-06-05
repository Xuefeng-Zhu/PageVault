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
import { enqueueNotification } from './notifications';
import { newId } from './ids';
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

// Direct HTTP fetch as a baseline crawler. Tries the Apify run-sync API
// directly if creds are present, otherwise falls back to a plain fetch()
// with HTML→Markdown extraction.
async function crawlOne(url: string): Promise<{
  url: string; title: string; markdown: string; text: string; capturedAt: string;
  apifyRunId: string | null;
}> {
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

  // Direct fetch path
  const r = await fetch(url, {
    headers: {
      'User-Agent': 'PageVault/1.0 (https://pagevault.app; +contact@pagevault.app)',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    redirect: 'follow',
  });
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
const ANON = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY || '';

// NOTE: scan-row ids (snapshot_jobs.id, snapshots.id, ai_explanations.id)
// are generated by `newId()` in lib/ids.ts — see that file for the
// collision-resistance rationale. The previous hand-rolled
// `uuid(prefix)` helper used 7 random hex chars (28 bits of entropy) plus
// a fixed suffix, which made 5%-probability collisions reachable at
// ~10,000 concurrent scans. crypto.randomUUID() has 122 bits of entropy.

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
  const jobId = newId();
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
  const snapId = newId();
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
  const explId = newId();
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
