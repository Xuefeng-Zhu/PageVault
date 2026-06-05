// Regression test for HIGH-2 (docs/qa-bug-hunt.md):
// Dashboard "URLs watched" stat must equal the total number of actively
// watched URLs across all rooms — NOT the room count.
//
// Bug history: the original reducer was
//   activeUrls: data.reduce((sum) => sum + 1, 0)
// which lacks the room parameter and always returned `data.length`. With
// 5 rooms (each with 0 URLs) it showed 5; with 5 rooms (each with 10
// URLs) it also showed 5. This test pins the correct behaviour.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import type { RoomWithStats } from '@/types';
import DashboardPage from './page';

const makeRoom = (id: string, watchedUrls: string[]): RoomWithStats => ({
  id,
  userId: 'user-1',
  name: `Room ${id}`,
  targetName: `Target ${id}`,
  category: 'custom',
  storageFolderPath: null,
  boxFolderId: null,
  createdAt: '2026-06-01T00:00:00.000Z',
  highCount: 0,
  mediumCount: 0,
  lastScanAt: null,
  watchedUrls,
});

/**
 * Find the value rendered next to a given stat label.
 *
 * The StatCard component renders:
 *   <div class="...bg-surface border border-rule p-5...">   <-- card root
 *     <div class="flex items-start justify-between mb-3">   <-- header row
 *       <span class="font-mono ...">{label}</span>          <-- the label
 *       <span class="border border-rule">                  <-- icon slot
 *     </div>
 *     <div class="flex items-baseline gap-2 mb-2">          <-- value row
 *       <span class="font-display ...">{value}</span>       <-- the value
 *
 * Strategy: start at the label, walk up to the card root (the only
 * div with class "hover-lift"), then find the value span inside.
 * "hover-lift" is unique to StatCard in this page so it disambiguates
 * from the dashboard's bg-surface-raised wrappers.
 */
function getStatValue(labelText: string): string {
  const labelEl = screen.getByText(labelText);
  let card: HTMLElement | null = labelEl.parentElement;
  while (card && !card.className.includes('hover-lift')) {
    card = card.parentElement;
  }
  if (!card) throw new Error(`No StatCard root for label "${labelText}"`);
  const valueSpan = card.querySelector('span.font-display');
  if (!valueSpan) {
    throw new Error(`No value span in StatCard for "${labelText}"`);
  }
  return valueSpan.textContent?.trim() ?? '';
}

describe('DashboardPage — URLs watched stat (HIGH-2 regression)', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('sums watched URLs across rooms (3 rooms, 3 URLs total)', async () => {
    const rooms: RoomWithStats[] = [
      makeRoom('a', ['https://example.com', 'https://example.com/pricing']),
      makeRoom('b', ['https://other.com']),
      makeRoom('c', []), // room with zero URLs — used to break the old reducer
    ];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => rooms,
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/rooms', { cache: 'no-store' });
    });

    // Both happen to be 3 in this fixture — but for the right reason:
    // Rooms=3 (room count) and URLs watched=3 (2+1+0 URL sum).
    expect(getStatValue('Rooms')).toBe('3');
    expect(getStatValue('URLs watched')).toBe('3');
  });

  it('reports URL count, not room count, when they differ (2 rooms, 17 URLs)', async () => {
    // 2 rooms, 17 URLs total — would have been reported as 2 under
    // the old `sum + 1` reducer.
    const urls = Array.from({ length: 17 }, (_, i) => `https://example.com/page${i}`);
    const rooms: RoomWithStats[] = [
      makeRoom('a', urls.slice(0, 12)),
      makeRoom('b', urls.slice(12)),
    ];
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => rooms,
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    // Rooms stat → 2; URLs watched stat → 17. This is the regression
    // assertion: before the fix, "URLs watched" would have shown 2.
    expect(getStatValue('Rooms')).toBe('2');
    expect(getStatValue('URLs watched')).toBe('17');
  });

  it('reports 0 URLs watched when there are zero rooms', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });

    render(<DashboardPage />);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });

    expect(getStatValue('Rooms')).toBe('0');
    expect(getStatValue('URLs watched')).toBe('0');
  });

  it('does not crash on fetch failure; falls back to zeroed stats', async () => {
    // Defensive: even on a fetch error the page should not throw;
    // stats should fall back to the default (0, 0, 0).
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    render(<DashboardPage />);

    // Wait for the catch branch to settle: fetch was attempted, then
    // setLoading(false) ran in finally, which re-renders the stat
    // grid. Use findByText to poll past React's microtask delay.
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
    // findBy polls until the label appears (up to 1s default).
    expect(await screen.findByText('Rooms')).toBeTruthy();
    expect(await screen.findByText('URLs watched')).toBeTruthy();

    // Spinner is no longer showing (loading=false in finally), so the
    // stats row renders. Default values are 0/0/0.
    expect(getStatValue('Rooms')).toBe('0');
    expect(getStatValue('URLs watched')).toBe('0');

    consoleError.mockRestore();
  });
});
