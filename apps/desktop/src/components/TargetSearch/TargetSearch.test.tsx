/// <reference types="@testing-library/jest-dom" />
/**
 * TargetSearch tests — spec 035 US1 (T013) + US3 long-tail SIMBAD (T022/T023).
 *
 * Covers:
 *   1. Debounced query triggers `target.search` with the typed query + limit.
 *   2. Suggestions render primary designation, secondary name, and type/source badges.
 *   3. commonName falls back to matchedAlias and is omitted gracefully when absent.
 *   4. Clicking a suggestion fires onSelect with the canonical targetId.
 *   5. Keyboard navigation (ArrowDown + Enter) selects a suggestion.
 *   6. A failed command surfaces an inline error.
 *   7. (US3) Long-tail resolve result is merged + de-duped into local hits.
 *   8. (US3) Cancel-in-flight: a stale resolve cannot overwrite current results.
 *   9. (US3) `unresolved` (offline / disabled) is non-fatal — no error shown.
 */

import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { mockSearchTargets, mockResolveTarget } = vi.hoisted(() => ({
  mockSearchTargets: vi.fn(),
  mockResolveTarget: vi.fn(),
}));

vi.mock('@/api/commands', () => ({
  searchTargets: mockSearchTargets,
  resolveTarget: mockResolveTarget,
  TARGET_SEARCH_CONTRACT_VERSION: '1.0',
}));

import { TargetSearch } from './TargetSearch';
import type { TargetSuggestion, ResolvedTarget } from '@/api/commands';

/** Build an `unresolved` resolve response (the offline / disabled default). */
function unresolved(reason = 'offline') {
  return { contractVersion: '1.0', requestId: 'r', status: 'unresolved', target: null, unresolvedReason: reason, error: null };
}

/** Build a `resolved` response wrapping a `ResolvedTarget`. */
function resolved(target: ResolvedTarget) {
  return { contractVersion: '1.0', requestId: 'r', status: 'resolved', target, unresolvedReason: null, error: null };
}

const M31: TargetSuggestion = {
  targetId: 'tgt-m31',
  primaryDesignation: 'M 31',
  commonName: 'Andromeda Galaxy',
  objectType: 'galaxy',
  matchedAlias: 'Andromeda',
  source: 'seed',
};

const NGC7000: TargetSuggestion = {
  targetId: 'tgt-ngc7000',
  primaryDesignation: 'NGC 7000',
  commonName: null,
  objectType: 'emission_nebula',
  matchedAlias: 'North America Nebula',
  source: 'resolved',
};

const NO_SECONDARY: TargetSuggestion = {
  targetId: 'tgt-x',
  primaryDesignation: 'IC 1396',
  commonName: null,
  objectType: 'open_cluster',
  matchedAlias: null,
  source: 'resolved',
};

const SIMBAD_LBN: ResolvedTarget = {
  targetId: 'tgt-lbn',
  simbadOid: 12345,
  primaryDesignation: 'LBN 552',
  commonName: 'Dusty region',
  objectType: 'reflection_nebula',
  raDeg: 10,
  decDeg: 20,
  aliases: ['LBN 552'],
  source: 'resolved',
};

beforeEach(() => {
  vi.useFakeTimers();
  mockSearchTargets.mockReset();
  mockResolveTarget.mockReset();
  // Default: the long-tail resolver returns nothing (offline / not found).
  mockResolveTarget.mockResolvedValue(unresolved());
});

afterEach(() => {
  vi.runOnlyPendingTimers();
  vi.useRealTimers();
});

/** Flush the debounce + both async phases (search → resolve) to completion. */
async function typeAndFlush(input: HTMLElement, value: string) {
  fireEvent.change(input, { target: { value } });
  await act(async () => {
    vi.advanceTimersByTime(300);
    // Drain enough microtask turns to settle both pipeline phases.
    for (let i = 0; i < 8; i++) await Promise.resolve();
  });
}

describe('TargetSearch', () => {
  it('debounces and calls target.search with the query + limit', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31],
    });
    render(<TargetSearch onSelect={vi.fn()} limit={20} />);
    const input = screen.getByRole('combobox');

    fireEvent.change(input, { target: { value: 'andr' } });
    expect(mockSearchTargets).not.toHaveBeenCalled(); // debounced

    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });

    expect(mockSearchTargets).toHaveBeenCalledTimes(1);
    expect(mockSearchTargets).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'andr', limit: 20, contractVersion: '1.0' }),
    );
  });

  it('renders designation, common name, and type/source badges', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31],
    });
    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'm31');

    const option = screen.getByRole('option');
    expect(option).toHaveTextContent('M 31');
    expect(option).toHaveTextContent('Andromeda Galaxy');
    expect(option).toHaveTextContent('Galaxy');
    expect(option).toHaveTextContent('seed');
  });

  it('falls back to matchedAlias when commonName is absent', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [NGC7000],
    });
    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'na');

    const option = screen.getByRole('option');
    expect(option).toHaveTextContent('NGC 7000');
    expect(option).toHaveTextContent('North America Nebula');
  });

  it('renders without a secondary line when no name/alias exists', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [NO_SECONDARY],
    });
    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'ic');

    const option = screen.getByRole('option');
    expect(option).toHaveTextContent('IC 1396');
    expect(option.querySelector('.alm-target-search__secondary')).toBeNull();
  });

  it('calls onSelect with the suggestion (targetId) on click', async () => {
    const onSelect = vi.fn();
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31, NGC7000],
    });
    render(<TargetSearch onSelect={onSelect} />);
    await typeAndFlush(screen.getByRole('combobox'), 'm');

    const options = screen.getAllByRole('option');
    fireEvent.mouseDown(options[1]);
    expect(onSelect).toHaveBeenCalledWith(NGC7000);
    const selected = onSelect.mock.calls[0][0] as TargetSuggestion;
    expect(selected.targetId).toBe('tgt-ngc7000');
  });

  it('supports keyboard navigation (ArrowDown + Enter)', async () => {
    const onSelect = vi.fn();
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31, NGC7000],
    });
    render(<TargetSearch onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    await typeAndFlush(input, 'm');

    screen.getAllByRole('option');
    fireEvent.keyDown(input, { key: 'ArrowDown' }); // active 0 -> 1
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSelect).toHaveBeenCalledWith(NGC7000);
  });

  it('surfaces an inline error when the command rejects', async () => {
    mockSearchTargets.mockRejectedValue('db.error');
    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'm31');

    expect(screen.getByRole('alert')).toHaveTextContent('db.error');
  });

  // ── US3 (T022/T023): SIMBAD long-tail merge + dedupe + cancel-in-flight ──────

  it('merges a long-tail SIMBAD result into the local hits (appended)', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31],
    });
    mockResolveTarget.mockResolvedValue(resolved(SIMBAD_LBN));

    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'lbn 552');

    expect(mockResolveTarget).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'lbn 552', contractVersion: '1.0' }),
    );
    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent('M 31'); // local hit first
    expect(options[1]).toHaveTextContent('LBN 552'); // long-tail appended
  });

  it('does not duplicate a long-tail result already present locally', async () => {
    // Same physical object: same designation, different row id from the cache.
    const resolvedDup: ResolvedTarget = {
      ...SIMBAD_LBN,
      targetId: 'tgt-other-id',
      primaryDesignation: 'M 31',
    };
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31],
    });
    mockResolveTarget.mockResolvedValue(resolved(resolvedDup));

    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'm 31');

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('M 31');
  });

  it('does not fire the long-tail resolve below the min query length', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [NO_SECONDARY],
    });
    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'ic'); // 2 chars < 3

    expect(mockSearchTargets).toHaveBeenCalled();
    expect(mockResolveTarget).not.toHaveBeenCalled();
  });

  it('treats unresolved (offline / disabled) as non-fatal — no error, local hits stay', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31],
    });
    mockResolveTarget.mockResolvedValue(unresolved('offline'));

    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'm31');

    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getAllByRole('option')).toHaveLength(1);
    expect(screen.getByRole('option')).toHaveTextContent('M 31');
  });

  it('cancel-in-flight: a stale resolve cannot overwrite the current query results', async () => {
    // Local search resolves instantly for both queries.
    mockSearchTargets.mockImplementation(({ query }: { query: string }) =>
      Promise.resolve({
        contractVersion: '1.0',
        requestId: 'r',
        suggestions: query === 'first' ? [M31] : [NGC7000],
      }),
    );

    // First query's resolve is *slow* (deferred); second query's is fast.
    let releaseStaleResolve: (() => void) | null = null;
    const staleResolved = resolved({ ...SIMBAD_LBN, primaryDesignation: 'STALE OBJ' });
    mockResolveTarget
      .mockImplementationOnce(
        () =>
          new Promise((res) => {
            releaseStaleResolve = () => res(staleResolved);
          }),
      )
      .mockResolvedValueOnce(unresolved());

    render(<TargetSearch onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox');

    // Type the first query — local hits render, resolve hangs.
    await typeAndFlush(input, 'first');
    expect(screen.getByRole('option')).toHaveTextContent('M 31');

    // Type the second query — supersedes the first; its local hits render.
    await typeAndFlush(input, 'second');
    expect(screen.getByRole('option')).toHaveTextContent('NGC 7000');

    // Now release the *stale* first-query resolve. It must be discarded.
    await act(async () => {
      releaseStaleResolve?.();
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('NGC 7000');
    expect(screen.queryByText('STALE OBJ')).toBeNull();
  });
});
