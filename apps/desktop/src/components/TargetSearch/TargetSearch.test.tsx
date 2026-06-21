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

/**
 * The search input (a `combobox`). When `showFilters` is on, native `<select>`
 * elements also expose role `combobox`, so query by the input's accessible name.
 */
function getInput(): HTMLElement {
  return screen.getByRole('combobox', { name: 'Search for a target' });
}

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
    // Base UI Combobox selects an option on click (it manages the
    // mousedown→select sequencing internally; the prior hand-rolled list
    // used a raw mousedown).
    await act(async () => {
      fireEvent.click(options[1]);
      await Promise.resolve();
    });
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
    // Base UI starts with no option highlighted; the first ArrowDown highlights
    // index 0 (M31), the second highlights index 1 (NGC7000). Enter selects the
    // highlighted option. (The prior hand-rolled list pre-highlighted index 0,
    // so it only needed a single ArrowDown — same nav BEHAVIOR, different start.)
    await act(async () => {
      fireEvent.keyDown(input, { key: 'ArrowDown' }); // highlight 0 (M31)
      fireEvent.keyDown(input, { key: 'ArrowDown' }); // highlight 1 (NGC7000)
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve();
    });
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

  // ── T029 (US5): optional catalogue / type filter ────────────────────────────

  it('renders the filter control only when showFilters is set', () => {
    const { rerender } = render(<TargetSearch onSelect={vi.fn()} />);
    expect(screen.queryByLabelText('Search filters')).toBeNull();

    rerender(<TargetSearch onSelect={vi.fn()} showFilters />);
    expect(screen.getByLabelText('Search filters')).toBeInTheDocument();
    // Defaults to "all" — no filter selected.
    expect(screen.getByLabelText('Type')).toHaveValue('');
    expect(screen.getByLabelText('Catalogue')).toHaveValue('');
  });

  it('passes selected type + catalogue filters to target.search', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31],
    });
    render(<TargetSearch onSelect={vi.fn()} showFilters />);

    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'galaxy' } });
    fireEvent.change(screen.getByLabelText('Catalogue'), { target: { value: 'messier' } });

    await typeAndFlush(getInput(), 'm31');

    expect(mockSearchTargets).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: 'm31',
        typeFilter: ['galaxy'],
        catalogFilter: ['messier'],
      }),
    );
  });

  it('omits filters from the request when set to "all"', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31],
    });
    render(<TargetSearch onSelect={vi.fn()} showFilters />);
    await typeAndFlush(getInput(), 'm31');

    const call = mockSearchTargets.mock.calls[0][0] as {
      typeFilter?: unknown;
      catalogFilter?: unknown;
    };
    expect(call.typeFilter).toBeUndefined();
    expect(call.catalogFilter).toBeUndefined();
  });

  // ── T032 (US4/FR-014): manual "correct target" override ──────────────────────

  it('shows the override action only when enableOverride is set', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31],
    });
    const { rerender } = render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'm31');
    expect(screen.queryByRole('button', { name: /set "m31" to/i })).toBeNull();

    rerender(<TargetSearch onSelect={vi.fn()} enableOverride />);
    expect(screen.getByRole('button', { name: /set "m31" to M 31/i })).toBeInTheDocument();
  });

  it('override calls target.resolve with the override targetId and reports user-override', async () => {
    const onOverride = vi.fn();
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31],
    });
    // The override resolve returns the chosen target as user-override.
    mockResolveTarget.mockResolvedValue(
      resolved({
        targetId: 'tgt-m31',
        simbadOid: null,
        primaryDesignation: 'M 31',
        commonName: 'Andromeda Galaxy',
        objectType: 'galaxy',
        raDeg: null,
        decDeg: null,
        aliases: ['M 31'],
        source: 'user-override',
      }),
    );

    render(<TargetSearch onSelect={vi.fn()} enableOverride onOverride={onOverride} />);
    await typeAndFlush(screen.getByRole('combobox'), 'andromeda');

    const overrideBtn = screen.getByRole('button', { name: /set "andromeda" to M 31/i });
    // The override button fires its action on click (pointerDown is suppressed
    // so it never triggers the row's select-on-press).
    await act(async () => {
      fireEvent.click(overrideBtn);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });

    // Last resolve call carried the override directive bound to the typed query.
    expect(mockResolveTarget).toHaveBeenLastCalledWith(
      expect.objectContaining({
        query: 'andromeda',
        override: { targetId: 'tgt-m31' },
      }),
    );
    expect(onOverride).toHaveBeenCalledTimes(1);
    const result = onOverride.mock.calls[0][0] as TargetSuggestion;
    expect(result.targetId).toBe('tgt-m31');
    expect(result.source).toBe('user-override');
  });
});
