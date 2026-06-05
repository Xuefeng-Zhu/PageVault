// Tests for components/changes/DiffView.tsx — US-007 acceptance criteria.
//
// Pins the four behaviors the task body calls out:
//   1. Empty diff (before === after) renders no add/remove lines.
//   2. One added line renders with the "added" CSS class.
//   3. One removed line renders with the "removed" CSS class.
//   4. The AI summary appears in the sticky header.
//
// Notes for future maintainers:
//   - The component shows a "Computing diff…" placeholder for one tick on
//     mount (intentional, per the spec). We use `waitFor` to wait for the
//     rows to materialize before asserting on them. This keeps the test
//     deterministic in jsdom without flakiness around useEffect ordering.
//   - extractSimpleDiff in lib/diff.ts runs normalizeText first, which
//     collapses all whitespace. We pick inputs that survive normalization
//     in the form we want (a single line on the side that should change).
import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { DiffView } from './DiffView';

describe('DiffView', () => {
  it('renders with empty diff (before === after) and shows no add/remove lines', async () => {
    const { container } = render(
      <DiffView before="unchanged content" after="unchanged content" />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('diff-view-loading')).toBeNull();
    });

    expect(container.querySelectorAll('.diff-line--added')).toHaveLength(0);
    expect(container.querySelectorAll('.diff-line--removed')).toHaveLength(0);
  });

  it('renders one added line with the "added" CSS class', async () => {
    const { container } = render(
      <DiffView before="" after="a new line appeared" />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('diff-view-loading')).toBeNull();
    });

    const added = container.querySelectorAll('.diff-line--added');
    expect(added).toHaveLength(1);
    // The line text must come from the `after` prop and be rendered as
    // text content (no dangerouslySetInnerHTML involved).
    expect(added[0].textContent).toContain('a new line appeared');
    // And there should be no removed lines in this case.
    expect(container.querySelectorAll('.diff-line--removed')).toHaveLength(0);
  });

  it('renders one removed line with the "removed" CSS class', async () => {
    const { container } = render(
      <DiffView before="this line is going away" after="" />,
    );

    await waitFor(() => {
      expect(screen.queryByTestId('diff-view-loading')).toBeNull();
    });

    const removed = container.querySelectorAll('.diff-line--removed');
    expect(removed).toHaveLength(1);
    expect(removed[0].textContent).toContain('this line is going away');
    expect(container.querySelectorAll('.diff-line--added')).toHaveLength(0);
  });

  it('renders the AI summary in the sticky header', async () => {
    render(
      <DiffView
        before="old"
        after="new"
        summary="Pricing jumped 20% — match with the Q2 announcement"
      />,
    );

    const summary = await screen.findByTestId('diff-view-summary');
    expect(summary.textContent).toContain(
      'Pricing jumped 20% — match with the Q2 announcement',
    );

    // The summary should be inside the <header> for it to be sticky.
    expect(summary.closest('header')).not.toBeNull();
  });
});
