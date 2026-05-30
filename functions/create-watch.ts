// InsForge Edge Function: POST /functions/create-watch
// Creates a tracked page, creates Box page folder
// Request: { projectId, url, crawlMode, selectorKeep, selectorRemove }
// Response: { trackedPageId, normalizedUrl, boxPageFolderId, status }

interface CreateWatchRequest {
  projectId: string;
  url: string;
  crawlMode?: 'visual' | 'text' | 'cheerio';
  selectorKeep?: string;
  selectorRemove?: string;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    // Remove trailing slash, query params, and hash
    let normalized = u.origin + u.pathname.replace(/\/$/, '');
    return normalized;
  } catch {
    return url;
  }
}

function slugify(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname.replace(/^\//, '').replace(/\/$/, '').replace(/\//g, '-') || 'index';
    return `${host}-${path}`.toLowerCase().replace(/[^a-z0-9-]/g, '-').replace(/-+/g, '-');
  } catch {
    return url.replace(/[^a-z0-9]/gi, '-').toLowerCase();
  }
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const body: CreateWatchRequest = await req.json();
    const { projectId, url, crawlMode = 'visual', selectorKeep, selectorRemove } = body;

    if (!projectId || !url) {
      return Response.json(
        { error: 'MISSING_FIELDS', message: 'projectId and url are required' },
        { status: 400 }
      );
    }

    const normalizedUrl = normalizeUrl(url);
    const slug = slugify(url);

    // Insert tracked page into DB
    // Note: In a real implementation, this would use the InsForge SDK to insert
    // For now, we return a mock response structure that matches the expected interface
    const trackedPageId = crypto.randomUUID();

    // Box folder creation would happen here via Box API
    // For demo mode, return a mock folder ID
    const boxPageFolderId = `box-folder-${trackedPageId.slice(0, 8)}`;

    return Response.json({
      trackedPageId,
      normalizedUrl,
      boxPageFolderId,
      status: 'created',
      crawlMode,
      selectorKeep: selectorKeep ?? null,
      selectorRemove: selectorRemove ?? null,
    }, { status: 201 });
  } catch (err) {
    console.error('create-watch error:', err);
    return Response.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to create watch' },
      { status: 500 }
    );
  }
}
