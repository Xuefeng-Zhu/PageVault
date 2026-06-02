// Scan orchestration for PageVault
//
// Live scans (Apify crawl → diff → AI → store) are not yet implemented against
// the real InsForge tables (snapshot_jobs, snapshots, ai_explanations). Until
// that pipeline is built, use `scripts/seed_via_api.py` to populate the
// database with realistic change data for testing.
import type { MemoryRoom, ScanSummary } from '@/types';

/**
 * Stub scan runner. Throws because the live scan pipeline is not yet wired up
 * against the real InsForge tables. Seed data flows in via the REST API.
 */
export async function runScan(room: MemoryRoom): Promise<ScanSummary> {
  throw new Error(
    'runScan is not implemented: live scanning requires Apify + AI integration. ' +
    'Use scripts/seed_via_api.py to populate changes for testing.'
  );
}
