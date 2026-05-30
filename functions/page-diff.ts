// InsForge Edge Function: GET /functions/page-diff?trackedPageId=<id>&snapshotId=<id>
// Returns normalized diff payload (read-only)
// Response: { diff: DiffPayload }

interface DiffPayload {
  trackedPageId: string;
  snapshotId: string;
  previousSnapshotId: string | null;
  changeType: 'none' | 'textual' | 'visual' | 'structural' | 'error';
  textDiff: TextDiffItem[];
  htmlDiff: HtmlDiffItem[];
  explanation: Explanation | null;
}

interface TextDiffItem {
  type: 'add' | 'remove' | 'change';
  before: string;
  after: string;
  xpath: string;
}

interface HtmlDiffItem {
  type: 'add' | 'remove' | 'change';
  tag: string;
  xpath: string;
  before: string;
  after: string;
}

interface Explanation {
  model: string;
  confidence: number;
  summary: string;
  businessInterpretation: string;
  changeType: string;
  severity: 'low' | 'medium' | 'high';
}

export default async function handler(req: Request): Promise<Response> {
  try {
    const url = new URL(req.url);
    const trackedPageId = url.searchParams.get('trackedPageId');
    const snapshotId = url.searchParams.get('snapshotId');

    if (!trackedPageId || !snapshotId) {
      return Response.json(
        { error: 'MISSING_FIELDS', message: 'trackedPageId and snapshotId query params are required' },
        { status: 400 }
      );
    }

    // In real mode: query snapshots and artifacts tables, compute diff
    // In demo mode: return empty diff
    const diff: DiffPayload = {
      trackedPageId,
      snapshotId,
      previousSnapshotId: null,
      changeType: 'none',
      textDiff: [],
      htmlDiff: [],
      explanation: null,
    };

    return Response.json({ diff }, { status: 200 });
  } catch (err) {
    console.error('page-diff error:', err);
    return Response.json(
      { error: 'INTERNAL_ERROR', message: 'Failed to get page diff' },
      { status: 500 }
    );
  }
}
