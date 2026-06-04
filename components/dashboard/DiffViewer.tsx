'use client';

import { useState } from 'react';
import { GitBranch, FileText } from 'lucide-react';

interface DiffViewerProps {
  evidence: {
    before: string;
    after: string;
    explanation?: string;
  }[];
}

export function DiffViewer({ evidence }: DiffViewerProps) {
  const [view, setView] = useState<'split' | 'unified'>('split');

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-rule pb-3">
        <div className="flex items-center gap-3">
          <span className="font-mono text-label-md text-ink-3 uppercase tracking-archive">
            {evidence.length} {evidence.length === 1 ? 'diff' : 'diffs'}
          </span>
          <span className="h-3 w-px bg-rule" />
          <div className="inline-flex border border-rule">
            <button
              onClick={() => setView('split')}
              className={`px-2.5 py-1 font-mono text-mono-sm uppercase tracking-archive transition-colors ${
                view === 'split' ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'
              }`}
            >
              Split
            </button>
            <button
              onClick={() => setView('unified')}
              className={`px-2.5 py-1 font-mono text-mono-sm uppercase tracking-archive border-l border-rule transition-colors ${
                view === 'unified' ? 'bg-ink text-paper' : 'text-ink-2 hover:text-ink'
              }`}
            >
              Unified
            </button>
          </div>
        </div>
        <button
          className="inline-flex items-center gap-2 font-mono text-mono-sm text-ink-3 hover:text-ink transition-colors"
          aria-label="Export diff as file"
        >
          <FileText className="w-3.5 h-3.5" />
          Export
        </button>
      </div>

      {evidence.map((item, index) => (
        <div key={index} className="border border-rule bg-surface overflow-hidden">
          {/* Section header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-rule bg-paper-2">
            <div className="flex items-center gap-3">
              <GitBranch className="w-3.5 h-3.5 text-ink-3" strokeWidth={1.75} />
              <span className="font-mono text-mono-sm text-ink-2 uppercase tracking-archive">
                Diff #{String(index + 1).padStart(3, '0')}
              </span>
            </div>
            <span className="font-mono text-mono-sm text-ink-3">
              <span className="text-ember">−{item.before.length}c</span>
              {' '}
              <span className="text-signal">+{item.after.length}c</span>
            </span>
          </div>

          {/* Content */}
          {view === 'split' ? (
            <div className="grid grid-cols-2">
              <div className="border-r border-rule">
                <DiffColumn content={item.before} variant="before" />
              </div>
              <div>
                <DiffColumn content={item.after} variant="after" />
              </div>
            </div>
          ) : (
            <div className="divide-y divide-rule">
              <DiffRow content={item.before} variant="before" />
              <DiffRow content={item.after} variant="after" />
            </div>
          )}

          {/* Explanation */}
          {item.explanation && (
            <div className="border-t border-rule px-4 py-3 bg-paper-2 flex items-start gap-3">
              <span className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive shrink-0 mt-0.5">
                Note
              </span>
              <span className="font-body text-body-sm text-ink-2 leading-relaxed">
                {item.explanation}
              </span>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function DiffColumn({ content, variant }: { content: string; variant: 'before' | 'after' }) {
  const isBefore = variant === 'before';
  return (
    <div className={isBefore ? 'bg-ember-wash/40' : 'bg-signal-wash/40'}>
      <div
        className={[
          'flex items-center gap-2 px-4 py-2 border-b',
          isBefore
            ? 'border-ember/20 text-ember'
            : 'border-signal/20 text-signal',
        ].join(' ')}
      >
        <span
          className={[
            'inline-flex items-center justify-center w-5 h-5 font-mono text-[0.6875rem] font-semibold',
            isBefore ? 'bg-ember/15 text-ember' : 'bg-signal/15 text-signal',
          ].join(' ')}
        >
          {isBefore ? '−' : '+'}
        </span>
        <span className="font-mono text-mono-sm uppercase tracking-archive">
          {isBefore ? 'Before' : 'After'}
        </span>
        <span className="ml-auto font-mono text-mono-sm text-ink-3">
          {new Date().toLocaleDateString()}
        </span>
      </div>
      <pre className="p-4 font-mono text-mono-md text-ink whitespace-pre-wrap break-words leading-[1.6] max-h-96 overflow-auto">
        {content}
      </pre>
    </div>
  );
}

function DiffRow({ content, variant }: { content: string; variant: 'before' | 'after' }) {
  const isBefore = variant === 'before';
  return (
    <div className={isBefore ? 'bg-ember-wash/40' : 'bg-signal-wash/40'}>
      <div
        className={[
          'flex items-center gap-2 px-4 py-1.5',
          isBefore ? 'text-ember' : 'text-signal',
        ].join(' ')}
      >
        <span className="font-mono text-mono-sm font-semibold w-3 text-center">
          {isBefore ? '−' : '+'}
        </span>
        <span className="font-mono text-mono-sm uppercase tracking-archive">
          {isBefore ? 'Before' : 'After'}
        </span>
      </div>
      <pre className="px-4 pb-3 pt-1 font-mono text-mono-md text-ink whitespace-pre-wrap break-words leading-[1.6]">
        {content}
      </pre>
    </div>
  );
}
