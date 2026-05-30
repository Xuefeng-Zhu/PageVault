// Scan orchestration for PageVault
// Orchestrates the end-to-end scan pipeline: crawl → snapshot → diff → analyze → store
import type {
  ApifyPageResult,
  MemoryRoom,
  NewChangeAnalysis,
  NewSnapshot,
  PageSnapshot,
  ScanSummary,
} from '@/types';
import { crawlUrls } from './apify';
import { createBoxFolder, uploadTextFileToBox, getBoxFolderUrl } from './box';
import { analyzePageChange } from './ai';
import { hashContent } from './diff';
import {
  createScanRun,
  completeScanRun,
  failScanRun,
  listWatchedUrls,
  insertSnapshot,
  findPreviousSnapshot,
  insertChangeAnalysis,
} from './insforge';
import { hasBoxCreds } from './env';

/**
 * Normalize content from an Apify page result.
 * Prefers markdown when present and non-empty; otherwise uses plain text.
 */
export function normalizeContent(result: ApifyPageResult): string {
  if (result.markdown && result.markdown.trim().length > 0) {
    return result.markdown;
  }
  return result.text ?? '';
}

/**
 * Build a snapshot input from an Apify result and room/scan context.
 * Title defaults to empty string when absent.
 */
export function buildSnapshotInput(
  result: ApifyPageResult,
  roomId: string,
  watchedUrlId: string,
  scanRunId: string,
  boxFileId: string | null
): NewSnapshot {
  return {
    roomId,
    watchedUrlId,
    scanRunId,
    url: result.url,
    title: result.title ?? '',
    textContent: normalizeContent(result),
    contentHash: hashContent(normalizeContent(result)),
    boxFileId,
    capturedAt: result.capturedAt,
  };
}

/**
 * Derive the timestamp segment for Box paths from a scan run's start time.
 * Uses the start time so the raw results and all snapshot markdown files
 * share the same folder path.
 */
export function deriveTimestampSegment(startedAt: string): string {
  return startedAt.replace(/[:.]/g, '-').slice(0, 19);
}

/**
 * Normalize a severity value to the valid enum.
 * Out-of-range values default to 'low'.
 */
export function normalizeSeverity(severity: string): 'low' | 'medium' | 'high' {
  if (severity === 'medium' || severity === 'high') return severity;
  return 'low';
}

/**
 * Normalize a change type value to the valid enum.
 * Out-of-range values default to 'unknown'.
 */
export function normalizeChangeType(changeType: string): import('@/types').ChangeType {
  const validTypes: import('@/types').ChangeType[] = [
    'pricing', 'positioning', 'feature', 'legal',
    'security', 'hiring', 'docs', 'minor', 'unknown',
  ];
  if (validTypes.includes(changeType as import('@/types').ChangeType)) {
    return changeType as import('@/types').ChangeType;
  }
  return 'unknown';
}

/**
 * Run a complete scan over a memory room's watched URLs.
 *
 * Pipeline:
 * 1. Create scan run (status=running, started_at=now)
 * 2. Load all watched URLs for the room
 * 3. If no URLs, mark completed and return zero counts
 * 4. Crawl all URLs via Apify
 * 5. Upload raw crawl results to Box
 * 6. For each result: insert snapshot, upload to Box, find previous snapshot, diff, analyze, insert analysis, upload report
 * 7. Mark scan run completed
 *
 * On any failure after step 1, marks the run as failed with error message.
 */
export async function runScan(room: MemoryRoom): Promise<ScanSummary> {
  let scanRunId: string;
  let startedAt: string;

  try {
    // Step 1: Create scan run before any crawl
    const scanRun = await createScanRun(room.id);
    scanRunId = scanRun.id;
    startedAt = scanRun.startedAt ?? new Date().toISOString();
  } catch (err) {
    // If we can't even create the scan run, propagate
    throw err;
  }

  try {
    // Step 2: Load all watched URLs
    const watchedUrls = await listWatchedUrls(room.id);

    // Step 3: No URLs = immediate completion with zero counts
    if (watchedUrls.length === 0) {
      await completeScanRun(scanRunId);
      return {
        scanRunId,
        status: 'completed',
        snapshotsCaptured: 0,
        changesCreated: 0,
      };
    }

    // Step 4: Crawl all URLs
    const urls = watchedUrls.map(w => w.url);
    const crawlResults = await crawlUrls(urls);

    // Step 5: Upload raw crawl results to Box
    // Use first watched URL's box_folder_id if available, otherwise use room's
    const boxFolderId = room.boxFolderId ?? 'mock-folder';
    const timestampSegment = deriveTimestampSegment(startedAt);

    let rawBoxFileId: string | null = null;
    if (hasBoxCreds()) {
      try {
        const rawResultsJson = JSON.stringify(crawlResults, null, 2);
        const snapshotFolder = `PageVault/${room.name}/snapshots/${timestampSegment}`;
        const folderId = await createBoxFolder(snapshotFolder, boxFolderId !== 'mock-folder' ? boxFolderId : undefined);
        rawBoxFileId = await uploadTextFileToBox(folderId, 'raw-apify-results.json', rawResultsJson);
      } catch (err) {
        console.error('Failed to upload raw crawl results to Box:', err);
        // Non-fatal: continue with scan
      }
    } else {
      // Mock mode: still compute the path for consistency
      rawBoxFileId = `mock-file-raw-${scanRunId}`;
    }

    // Step 6: Process each result
    let snapshotsCaptured = 0;
    let changesCreated = 0;

    for (let i = 0; i < crawlResults.length; i++) {
      const result = crawlResults[i];
      const watchedUrl = watchedUrls.find(w => w.url === result.url) ?? watchedUrls[0];

      // Insert snapshot with content hash
      const snapshot = await insertSnapshot({
        roomId: room.id,
        watchedUrlId: watchedUrl.id,
        scanRunId,
        url: result.url,
        title: result.title ?? '',
        textContent: normalizeContent(result),
        contentHash: hashContent(normalizeContent(result)),
        boxFileId: rawBoxFileId,
        capturedAt: result.capturedAt,
      });
      snapshotsCaptured++;

      // Upload snapshot markdown to Box
      if (hasBoxCreds() && room.boxFolderId && room.boxFolderId !== 'mock-folder') {
        try {
          const timestampSegment2 = deriveTimestampSegment(startedAt);
          const snapshotFolder = `PageVault/${room.name}/snapshots/${timestampSegment2}`;
          const folderId = await createBoxFolder(snapshotFolder, room.boxFolderId);
          const pageFileName = result.url.replace(/[^a-z0-9]/gi, '_').slice(0, 50) + '.md';
          await uploadTextFileToBox(folderId, pageFileName, normalizeContent(result));
        } catch (err) {
          console.error('Failed to upload snapshot to Box:', err);
        }
      }

      // Find previous snapshot for this watched URL
      const previousSnapshot = await findPreviousSnapshot(watchedUrl.id, result.capturedAt);

      // Only analyze if we have a previous snapshot and hashes differ
      if (previousSnapshot) {
        const hasChanged = previousSnapshot.contentHash !== snapshot.contentHash;

        if (hasChanged) {
          // Request AI analysis
          const analysisResult = await analyzePageChange({
            url: result.url,
            pageType: watchedUrl.pageType,
            previousText: previousSnapshot.textContent,
            currentText: snapshot.textContent,
          });

          // Normalize enums (out-of-range → low / unknown)
          const normalizedSeverity = normalizeSeverity(analysisResult.severity);
          const normalizedChangeType = normalizeChangeType(analysisResult.changeType);

          // Insert change analysis
          await insertChangeAnalysis({
            roomId: room.id,
            watchedUrlId: watchedUrl.id,
            previousSnapshotId: previousSnapshot.id,
            currentSnapshotId: snapshot.id,
            severity: normalizedSeverity,
            changeType: normalizedChangeType,
            summary: analysisResult.summary,
            businessInterpretation: analysisResult.businessInterpretation,
            recommendedActions: analysisResult.recommendedActions,
            evidence: analysisResult.evidence,
            reportBoxFileId: null,
          });
          changesCreated++;

          // Upload analysis report to Box
          if (hasBoxCreds() && room.boxFolderId && room.boxFolderId !== 'mock-folder') {
            try {
              const reportFolder = `PageVault/${room.name}/reports`;
              const folderId = await createBoxFolder(reportFolder, room.boxFolderId);
              const reportMarkdown = generateReportMarkdown(watchedUrl, analysisResult);
              const reportFileName = `change-${snapshot.id.slice(0, 8)}.md`;
              await uploadTextFileToBox(folderId, reportFileName, reportMarkdown);
            } catch (err) {
              console.error('Failed to upload report to Box:', err);
            }
          }
        }
      }
    }

    // Step 7: Complete the scan run
    await completeScanRun(scanRunId);

    return {
      scanRunId,
      status: 'completed',
      snapshotsCaptured,
      changesCreated,
    };
  } catch (err) {
    // Any failure after run creation marks the run as failed
    const errorMessage = err instanceof Error ? err.message : 'Unknown error during scan';
    await failScanRun(scanRunId, errorMessage);
    throw err;
  }
}

function generateReportMarkdown(
  watchedUrl: { id: string; url: string; label: string | null; pageType: string },
  analysis: {
    severity: string;
    changeType: string;
    summary: string;
    businessInterpretation: string;
    evidence: Array<{ before: string; after: string; explanation: string }>;
    recommendedActions: string[];
  }
): string {
  return `# Change Analysis Report

**URL:** ${watchedUrl.url}
**Page Type:** ${watchedUrl.pageType}
**Severity:** ${analysis.severity.toUpperCase()}
**Change Type:** ${analysis.changeType}

## Summary

${analysis.summary}

## Business Interpretation

${analysis.businessInterpretation}

## Evidence

${analysis.evidence.map((e, i) => `
### Change ${i + 1}

**Before:** ${e.before}
**After:** ${e.after}
**Explanation:** ${e.explanation}
`).join('\n')}

## Recommended Actions

${analysis.recommendedActions.map((a, i) => `${i + 1}. ${a}`).join('\n')}
`;
}