// Diff engine for PageVault - content hashing and change detection
import { createHash } from 'crypto';

/**
 * Normalize text content before hashing.
 * - Trim leading/trailing whitespace
 * - Collapse internal whitespace (spaces, tabs, newlines) to single spaces
 * - Normalize line endings to Unix-style \n
 * This ensures formatting noise doesn't register as change while real text differences do.
 */
export function normalizeText(text: string): string {
  return text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
}

/**
 * Compute a SHA-256 hex digest of normalized text content.
 * The hash is deterministic: equal inputs yield equal hashes.
 */
export function hashContent(text: string): string {
  const normalized = normalizeText(text);
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/**
 * Determine whether a meaningful change occurred between previous and current content.
 * Defined purely as hash inequality — consistent with stored content_hash comparison.
 */
export function hasMeaningfulChange(previous: string, current: string): boolean {
  return hashContent(previous) !== hashContent(current);
}

// Simple diff result type
export interface SimpleDiff {
  added: string[];
  removed: string[];
}

/**
 * Extract a simple line-level diff between previous and current text.
 * Lines present only in current are marked 'added'.
 * Lines present only in previous are marked 'removed'.
 * Useful for human-readable diff display.
 */
export function extractSimpleDiff(previous: string, current: string): SimpleDiff {
  const prevLines = normalizeText(previous).split('\n').filter(l => l.length > 0);
  const currLines = normalizeText(current).split('\n').filter(l => l.length > 0);

  const prevSet = new Set(prevLines);
  const currSet = new Set(currLines);

  const removed = prevLines.filter(l => !currSet.has(l));
  const added = currLines.filter(l => !prevSet.has(l));

  return { added, removed };
}