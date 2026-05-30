// Box integration for PageVault
// Creates folders, uploads files, and produces Box URLs; returns mock identifiers when credentials are absent
import { hasBoxCreds } from './env';
import { BoxSystemError } from '@/types';

// Box API base URLs
const BOX_API_BASE = 'https://api.box.com/2.0';
const BOX_UPLOAD_URL = 'https://upload.box.com/api/2.0/files/content';

// Root folder ID (0 means root in Box)
const BOX_ROOT_FOLDER_ID = process.env.BOX_ROOT_FOLDER_ID ?? '0';

/**
 * Sanitize a filename for Box upload.
 * Removes CR/LF and escapes quotes.
 */
function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[\r\n]/g, '').replace(/"/g, '\\"');
}

// Generate a mock folder ID from a name
function mockFolderId(name: string, index: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  return `mock-folder-${slug}-${index}`;
}

// Generate a mock file ID from a name
function mockFileId(name: string, index: number): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-');
  return `mock-file-${slug}-${index}`;
}

/**
 * Create a Box folder.
 * Real mode: calls Box API to create the folder.
 * Mock mode: returns a deterministic mock folder ID when credentials are absent.
 * When credentials are present but the operation fails, propagates BoxSystemError.
 */
export async function createBoxFolder(name: string, parentFolderId?: string): Promise<string> {
  if (!hasBoxCreds()) {
    const mockIndex = name.length + (parentFolderId?.length ?? 0);
    return mockFolderId(name, mockIndex);
  }

  const token = process.env.BOX_DEVELOPER_TOKEN!;
  const parentId = parentFolderId ?? BOX_ROOT_FOLDER_ID;

  try {
    const response = await fetch(`${BOX_API_BASE}/folders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name,
        parent: { id: parentId },
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new BoxSystemError(`Box folder creation failed: ${response.status} ${errorText}`);
    }

    const data = await response.json() as { id?: string };
    if (!data.id) {
      throw new BoxSystemError('Box API did not return a folder ID');
    }
    return data.id;
  } catch (error) {
    if (error instanceof BoxSystemError) {
      throw error;
    }
    throw new BoxSystemError(`Box folder creation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Upload a text file to Box.
 * Real mode: uses multipart upload with attributes before the file part.
 * Mock mode: returns a deterministic mock file ID when credentials are absent.
 * When credentials are present but the operation fails, propagates BoxSystemError.
 */
export async function uploadTextFileToBox(
  folderId: string,
  fileName: string,
  content: string
): Promise<string> {
  if (!hasBoxCreds()) {
    const mockIndex = fileName.length + folderId.length;
    return mockFileId(fileName, mockIndex);
  }

  const token = process.env.BOX_DEVELOPER_TOKEN!;
  const sanitizedFileName = sanitizeFileName(fileName);

  try {
    // Multipart form data: attributes part first, then file part
    const boundary = `boundary_${Date.now()}`;
    const attributesPart = `--${boundary}\r\nContent-Disposition: form-data; name="attributes"\r\nContent-Type: application/json\r\n\r\n${JSON.stringify({
      name: sanitizedFileName,
      parent: { id: folderId },
    })}\r\n`;

    const filePart = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${sanitizedFileName}"\r\nContent-Type: text/plain\r\n\r\n${content}\r\n--${boundary}--\r\n`;

    const body = attributesPart + filePart;

    const response = await fetch(BOX_UPLOAD_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new BoxSystemError(`Box file upload failed: ${response.status} ${errorText}`);
    }

    const data = await response.json() as { entries?: Array<{ id?: string }> };
    const entry = data.entries?.[0];
    if (!entry?.id) {
      throw new BoxSystemError('Box API did not return a file ID');
    }
    return entry.id;
  } catch (error) {
    if (error instanceof BoxSystemError) {
      throw error;
    }
    throw new BoxSystemError(`Box file upload failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  }
}

/**
 * Get the Box folder URL for a folder ID.
 */
export function getBoxFolderUrl(folderId: string): string {
  if (folderId.startsWith('mock-')) {
    return `https://app.box.com/folder/mock-${folderId}`;
  }
  return `https://app.box.com/folder/${folderId}`;
}

/**
 * Get the Box file URL for a file ID.
 */
export function getBoxFileUrl(fileId: string): string {
  if (fileId.startsWith('mock-')) {
    return `https://app.box.com/file/mock-${fileId}`;
  }
  return `https://app.box.com/file/${fileId}`;
}