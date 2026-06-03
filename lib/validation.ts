// Input validation and normalization for PageVault
import type {
  Category,
  PageType,
  ValidationResult,
  NewWatchedUrl,
  UrlEntryInput,
} from '@/types';

// Valid category values
const VALID_CATEGORIES: Category[] = ['competitor', 'vendor', 'policy', 'docs', 'custom'];

// Valid page type values
const VALID_PAGE_TYPES: PageType[] = [
  'homepage',
  'pricing',
  'docs',
  'changelog',
  'careers',
  'terms',
  'privacy',
  'trust',
  'unknown',
];

// HTTP/HTTPS URL regex
const ABSOLUTE_URL_REGEX = /^https?:\/\/[^\s/$.?#].[^\s]*$/i;

/**
 * Normalize a category value.
 * Missing/empty/whitespace-only → 'competitor'
 * Otherwise returns the provided value unchanged (caller should validate against VALID_CATEGORIES if needed).
 */
export function normalizeCategory(category: string | undefined | null): Category {
  if (!category || (typeof category === 'string' && category.trim().length === 0)) {
    return 'competitor';
  }
  return category as Category;
}

/**
 * Normalize a page type value.
 * Missing/invalid → 'unknown'
 * Otherwise returns the provided value unchanged.
 */
export function normalizePageType(pageType: string | undefined | null): PageType {
  if (!pageType || (typeof pageType === 'string' && pageType.trim().length === 0)) {
    return 'unknown';
  }
  const trimmed = pageType.trim().toLowerCase() as PageType;
  if (VALID_PAGE_TYPES.includes(trimmed)) {
    return trimmed;
  }
  return 'unknown';
}

/**
 * Validate a room field (name or targetName).
 * Required, 1-200 chars after trim, not whitespace-only.
 * Returns the trimmed value on success.
 */
export function validateRoomField(
  value: string | undefined | null,
  fieldName: 'name' | 'targetName'
): ValidationResult<string> {
  if (value === undefined || value === null) {
    return { ok: false, field: fieldName, message: `${fieldName} is required` };
  }
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (trimmed.length === 0) {
    return { ok: false, field: fieldName, message: `${fieldName} cannot be empty or whitespace-only` };
  }
  if (trimmed.length > 200) {
    return { ok: false, field: fieldName, message: `${fieldName} must be 200 characters or less` };
  }
  return { ok: true, value: trimmed };
}

/**
 * Validate a URL entry.
 * - url: required, must be a valid absolute http/https URL
 * - label: optional, if present must be ≤200 chars
 * - pageType: validated/normalized to PageType
 */
export function validateUrlEntry(entry: UrlEntryInput): ValidationResult<UrlEntryInput> {
  if (!entry.url || typeof entry.url !== 'string' || entry.url.trim().length === 0) {
    return { ok: false, field: 'url', message: 'url is required' };
  }
  const trimmedUrl = entry.url.trim();
  if (!ABSOLUTE_URL_REGEX.test(trimmedUrl)) {
    return { ok: false, field: 'url', message: 'url must be a valid absolute HTTP or HTTPS URL' };
  }
  if (entry.label !== undefined && entry.label !== null && typeof entry.label === 'string' && entry.label.length > 200) {
    return { ok: false, field: 'label', message: 'label must be 200 characters or less' };
  }
  return {
    ok: true,
    value: {
      url: trimmedUrl,
      label: entry.label?.trim() ?? undefined,
      pageType: entry.pageType,
    },
  };
}

/**
 * Validate a batch of URL entries.
 * 1-100 entries, all-or-nothing.
 * Each entry: url required + valid absolute http/https URL, label ≤200 chars, pageType validated.
 */
export function validateUrlBatch(
  entries: UrlEntryInput[] | undefined | null
): ValidationResult<UrlEntryInput[]> {
  if (!entries || !Array.isArray(entries)) {
    return { ok: false, field: 'urls', message: 'urls must be a non-empty array of 1-100 entries' };
  }
  if (entries.length === 0) {
    return { ok: false, field: 'urls', message: 'urls must contain at least 1 entry' };
  }
  if (entries.length > 100) {
    return { ok: false, field: 'urls', message: 'urls cannot contain more than 100 entries' };
  }
  for (const entry of entries) {
    const result = validateUrlEntry(entry);
    if (!result.ok) {
      return result;
    }
  }
  return { ok: true, value: entries };
}

/**
 * Map a frequency preset (in hours) to a 5-field cron expression.
 * Returns null for unknown / missing values so callers can fall
 * back to a safe default. The cadence keys match the new-room
 * wizard: '1' hourly, '6' every 6h, '24' daily, '168' weekly.
 */
export function frequencyToCronExpression(
  frequency: string | undefined | null,
): string | null {
  switch ((frequency ?? '').trim()) {
    case '1':   return '0 * * * *';      // every hour
    case '6':   return '0 */6 * * *';    // every 6 hours
    case '24':  return '0 2 * * *';      // daily at 02:00 UTC
    case '168': return '0 2 * * 0';      // weekly on Sunday 02:00 UTC
    default:    return null;
  }
}

/**
 * Build normalized NewWatchedUrl records from a batch of URL entries.
 * Produces one normalized record per entry, each associated with the given room id.
 */
export function buildWatchedUrlRows(
  roomId: string,
  entries: UrlEntryInput[]
): NewWatchedUrl[] {
  return entries.map(entry => ({
    roomId,
    url: entry.url.trim(),
    label: entry.label?.trim() ?? null,
    pageType: normalizePageType(entry.pageType),
  }));
}