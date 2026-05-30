'use client';

interface DiffViewerProps {
  evidence: {
    before: string;
    after: string;
    explanation?: string;
  }[];
}

export function DiffViewer({ evidence }: DiffViewerProps) {
  return (
    <div className="space-y-6">
      {evidence.map((item, index) => (
        <div key={index} className="border border-outline-variant rounded-xl overflow-hidden">
          <div className="grid grid-cols-2">
            <div className="p-4 bg-red-50/50 border-r border-outline-variant">
              <div className="text-label-sm font-medium text-error mb-3 flex items-center gap-2">
                <span className="w-5 h-5 rounded bg-error/20 text-error flex items-center justify-center text-xs">−</span>
                Before
              </div>
              <pre className="text-body-sm text-on-surface font-mono whitespace-pre-wrap">{item.before}</pre>
            </div>
            <div className="p-4 bg-green-50/50">
              <div className="text-label-sm font-medium text-success mb-3 flex items-center gap-2">
                <span className="w-5 h-5 rounded bg-success/20 text-success flex items-center justify-center text-xs">+</span>
                After
              </div>
              <pre className="text-body-sm text-on-surface font-mono whitespace-pre-wrap">{item.after}</pre>
            </div>
          </div>
          {item.explanation && (
            <div className="px-4 py-3 bg-surface-container-low border-t border-outline-variant">
              <span className="text-label-sm text-on-surface-variant">Explanation: </span>
              <span className="text-body-sm text-on-surface">{item.explanation}</span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}