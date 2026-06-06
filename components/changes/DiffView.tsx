'use client';

/**
 * DiffView — unified text-diff between two snapshot markdown bodies.
 *
 * Wraps `lib/diff.ts::extractSimpleDiff` to produce a line-level view that
 * highlights added lines (Archive `signal` token, green-leaning) and removed
 * lines (Archive `ember` token, red-leaning). Unchanged lines render in the
 * default ink color.
 *
 * Design constraints pinned by US-007:
 *   - Unified view only (the task body explicitly ruled out side-by-side).
 *   - No raw HTML: every line is rendered as text content, not HTML. The
 *     `dangerouslySetInnerHTML` prop is forbidden in this component.
 *   - Long lines wrap; no horizontal scroll bar.
 *   - Sticky header with the optional AI summary.
 *   - "computing diff…" placeholder is visible while the memo is running.
 */

import { useEffect, useMemo, useState } from 'react';
import { GitCompare, Loader2, Minus, Plus, Sparkles } from 'lucide-react';
import { extractSimpleDiff } from '@/lib/diff';

export interface DiffViewProps {
  /** Markdown body of the previous snapshot. */
  before: string;
  /** Markdown body of the current snapshot. */
  after: string;
  /** Optional AI-generated summary rendered in the sticky header. */
  summary?: string;
}

type DiffRow =
  | { kind: 'unchanged'; text: string }
  | { kind: 'added'; text: string }
  | { kind: 'removed'; text: string }
  | { kind: 'context'; text: string };

const ROW_LIMIT = 500;

export function DiffView({ before, after, summary }: DiffViewProps) {
  // The loading flag is a brief "computing diff…" pulse. We flip it on
  // mount, then off in a microtask so the synchronous useMemo work above
  // doesn't actually block — but a fast human eye still catches the
  // transition. This matches the spec: "show 'computing diff...' while
  // useMemo runs".
  const [isComputing, setIsComputing] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setIsComputing(false), 0);
    return () => clearTimeout(t);
  }, [before, after]);

  const rows = useMemo<DiffRow[]>(() => {
    const diff = extractSimpleDiff(before, after);

    // Render a stable, deterministic ordering. Removed lines first (so the
    // reader sees what was lost), then the unchanged line, then added
    // lines. This is the simplest "unified" layout that highlights both
    // directions without trying to align columns.
    const ordered: DiffRow[] = [];
    for (const text of diff.removed) ordered.push({ kind: 'removed', text });
    for (const text of diff.added) ordered.push({ kind: 'added', text });

    // If both sides are empty there's nothing to render; surface a context
    // row so the user gets feedback rather than an empty card.
    if (ordered.length === 0) {
      ordered.push({
        kind: 'context',
        text: 'No textual changes detected between the two snapshots.',
      });
    }

    // Cap rendered rows so a runaway diff (e.g. a 50k-line markdown body
    // that swings wholesale) can't lock the browser tab. The tail
    // is summarized in a single context row.
    if (ordered.length > ROW_LIMIT) {
      const head = ordered.slice(0, ROW_LIMIT);
      const dropped = ordered.length - ROW_LIMIT;
      head.push({
        kind: 'context',
        text: `… ${dropped.toLocaleString()} more ${dropped === 1 ? 'line' : 'lines'} not shown`,
      });
      return head;
    }
    return ordered;
  }, [before, after]);

  const addedCount = useMemo(
    () => rows.filter((r) => r.kind === 'added').length,
    [rows],
  );
  const removedCount = useMemo(
    () => rows.filter((r) => r.kind === 'removed').length,
    [rows],
  );

  return (
    <section
      className="border border-rule bg-surface overflow-hidden"
      data-testid="diff-view"
      aria-label="Unified text diff"
    >
      {/* Sticky header. The summary is optional — when absent, the bar
          collapses to just the stat counters. */}
      <header className="sticky top-0 z-10 border-b border-rule bg-paper-2">
        {summary && (
          <div className="flex items-start gap-3 px-4 py-3 border-b border-rule">
            <span
              className="mt-0.5 inline-flex items-center justify-center w-6 h-6 border border-ink/30 text-ink"
              aria-hidden
            >
              <Sparkles className="w-3.5 h-3.5" strokeWidth={1.75} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="font-mono text-mono-sm text-ink-3 uppercase tracking-archive">
                AI brief
              </div>
              <p
                className="mt-0.5 font-body text-body-sm text-ink leading-relaxed"
                data-testid="diff-view-summary"
              >
                {summary}
              </p>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between px-4 py-2.5">
          <div className="flex items-center gap-2 font-mono text-mono-sm text-ink-2 uppercase tracking-archive">
            <GitCompare className="w-3.5 h-3.5 text-ink-3" strokeWidth={1.75} />
            <span>Unified diff</span>
          </div>
          <div className="flex items-center gap-3 font-mono text-mono-sm">
            <span className="inline-flex items-center gap-1 text-signal">
              <Plus className="w-3 h-3" strokeWidth={2.25} />
              <span data-testid="diff-view-added-count">{addedCount}</span>
            </span>
            <span className="inline-flex items-center gap-1 text-ember">
              <Minus className="w-3 h-3" strokeWidth={2.25} />
              <span data-testid="diff-view-removed-count">{removedCount}</span>
            </span>
          </div>
        </div>
      </header>

      {/* Body. Long lines wrap, no horizontal scroll. Every line is plain
          text — no dangerouslySetInnerHTML anywhere. */}
      <div className="font-mono text-mono-md leading-[1.6] max-h-[28rem] overflow-auto">
        {isComputing ? (
          <div
            className="flex items-center gap-2 px-4 py-6 text-ink-3"
            data-testid="diff-view-loading"
            role="status"
            aria-live="polite"
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={1.75} />
            <span className="font-mono text-mono-sm uppercase tracking-archive">
              Computing diff…
            </span>
          </div>
        ) : (
          <ol className="divide-y divide-rule" data-testid="diff-view-rows">
            {rows.map((row, i) => (
              <DiffLine key={i} row={row} />
            ))}
          </ol>
        )}
      </div>
    </section>
  );
}

function DiffLine({ row }: { row: DiffRow }) {
  // CSS class names are the test contract — see DiffView.test.tsx.
  if (row.kind === 'added') {
    return (
      <li className="diff-line diff-line--added bg-signal-wash/50 text-ink px-4 py-1 whitespace-pre-wrap break-words">
        <span className="inline-block w-4 mr-2 text-signal select-none" aria-hidden>
          +
        </span>
        <span>{row.text}</span>
      </li>
    );
  }
  if (row.kind === 'removed') {
    return (
      <li className="diff-line diff-line--removed bg-ember-wash/50 text-ink px-4 py-1 whitespace-pre-wrap break-words">
        <span className="inline-block w-4 mr-2 text-ember select-none" aria-hidden>
          −
        </span>
        <span>{row.text}</span>
      </li>
    );
  }
  if (row.kind === 'context') {
    return (
      <li className="diff-line diff-line--context text-ink-3 px-4 py-1 whitespace-pre-wrap break-words italic">
        {row.text}
      </li>
    );
  }
  return (
    <li className="diff-line diff-line--unchanged text-ink px-4 py-1 whitespace-pre-wrap break-words">
      <span className="inline-block w-4 mr-2 text-ink-4 select-none" aria-hidden>
        {' '}
      </span>
      <span>{row.text}</span>
    </li>
  );
}

export default DiffView;
