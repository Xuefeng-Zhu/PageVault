// Storage integration for PageVault (backed by InsForge Storage).
//
// Storage is REQUIRED: it rides on the same InsForge client as the database.
// If InsForge credentials are missing or the storage call fails, the error
// propagates to the caller — there is no silent mock fallback.
//
// File paths are stored as keys in the `pagevault-evidence` bucket. Both the
// public URL and the key are returned from upload, so callers can persist
// whichever they need.
import { getInsforgeClient, isPresent } from './env';

// Bucket name where all evidence lives
export const EVIDENCE_BUCKET = 'pagevault-evidence';

// Root folder prefix for all PageVault files inside the bucket
export const STORAGE_ROOT = 'pagevault';

/**
 * Returned by upload operations. Both `url` (for display) and `key`
 * (for RLS-protected access) are persisted.
 */
export interface UploadedFile {
  key: string;
  url: string;
  bucket: string;
  size: number;
}

/**
 * Returns true when InsForge storage credentials are configured.
 * Storage has no separate "creds" — it rides on the InsForge client.
 */
export function hasStorageCreds(): boolean {
  return (
    isPresent(process.env.INSFORGE_API_URL) &&
    (isPresent(process.env.INSFORGE_SERVICE_ROLE_KEY) || isPresent(process.env.INSFORGE_ANON_KEY))
  );
}

/**
 * Sanitize a filename for storage. Removes CR/LF and trims whitespace.
 */
function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[\r\n]/g, '').trim();
}

/**
 * Create a "folder" in the storage bucket by uploading a placeholder file.
 * Real S3-style storage has no real folders; we emulate them with a `.keep`
 * sentinel at the desired path. Returns the folder path.
 *
 * Throws if InsForge credentials are missing or the upload fails.
 */
export async function createStorageFolder(name: string, parentPath?: string): Promise<string> {
  if (!hasStorageCreds()) {
    throw new Error(
      'InsForge storage is not configured. Set INSFORGE_API_URL and INSFORGE_SERVICE_ROLE_KEY ' +
      '(or INSFORGE_ANON_KEY) in your environment to enable evidence storage.'
    );
  }

  const folderPath = parentPath ? `${parentPath}/${name}` : `${STORAGE_ROOT}/${name}`;
  const client = getInsforgeClient();
  const keep = new Blob([`# PageVault evidence folder: ${name}\nCreated: ${new Date().toISOString()}\n`], {
    type: 'text/plain',
  });
  const { error } = await client.storage.from(EVIDENCE_BUCKET).upload(`${folderPath}/.keep`, keep);
  if (error) {
    throw new Error(`Storage folder creation failed: ${error.message}`);
  }
  return folderPath;
}

/**
 * Upload a text file to the storage bucket.
 * Returns the public URL and storage key (caller persists both).
 *
 * Throws if InsForge credentials are missing or the upload fails.
 */
export async function uploadTextFile(
  folderPath: string,
  fileName: string,
  content: string
): Promise<UploadedFile> {
  if (!hasStorageCreds()) {
    throw new Error(
      'InsForge storage is not configured. Set INSFORGE_API_URL and INSFORGE_SERVICE_ROLE_KEY ' +
      '(or INSFORGE_ANON_KEY) in your environment to enable evidence storage.'
    );
  }

  const safeName = sanitizeFileName(fileName);
  const key = `${folderPath}/${safeName}`;
  const client = getInsforgeClient();
  const blob = new Blob([content], { type: 'text/plain' });
  const { data, error } = await client.storage.from(EVIDENCE_BUCKET).upload(key, blob);
  if (error || !data) {
    throw new Error(`Storage upload failed: ${error?.message ?? 'no data returned'}`);
  }
  return {
    key: data.key,
    url: data.url,
    bucket: data.bucket ?? EVIDENCE_BUCKET,
    size: data.size ?? content.length,
  };
}

/**
 * Get the public URL for a stored file.
 * Throws if InsForge credentials are missing.
 */
export function getStorageFileUrl(key: string): string {
  if (!hasStorageCreds()) {
    throw new Error(
      'InsForge storage is not configured. Set INSFORGE_API_URL and INSFORGE_SERVICE_ROLE_KEY ' +
      '(or INSFORGE_ANON_KEY) in your environment to enable evidence storage.'
    );
  }
  const client = getInsforgeClient();
  return client.storage.from(EVIDENCE_BUCKET).getPublicUrl(key);
}

/**
 * Get a "folder" URL — storage is flat, so we synthesize a path-based URL
 * that resolves to the bucket prefix view. Returns the public URL of the
 * `.keep` sentinel so the link is always valid.
 */
export function getStorageFolderUrl(folderPath: string): string {
  if (!hasStorageCreds()) {
    throw new Error(
      'InsForge storage is not configured. Set INSFORGE_API_URL and INSFORGE_SERVICE_ROLE_KEY ' +
      '(or INSFORGE_ANON_KEY) in your environment to enable evidence storage.'
    );
  }
  const client = getInsforgeClient();
  return client.storage.from(EVIDENCE_BUCKET).getPublicUrl(`${folderPath}/.keep`);
}
