// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

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

const { mockSearchTargets, mockResolveTarget, mockResolveExplicit } =
  vi.hoisted(() => ({
    mockSearchTargets: vi.fn(),
    mockResolveTarget: vi.fn(),
    mockResolveExplicit: vi.fn(),
  }));

// Mock the generated bindings: adapt each hoisted mock's raw response into the
// generated `{ status: 'ok', data }` Result shape the real `unwrap` consumes,
// so the existing mockResolvedValue/mockRejectedValue sites stay unchanged.
vi.mock('@/bindings/index', () => ({
  commands: {
    targetSearch: (req: unknown) =>
      Promise.resolve(mockSearchTargets(req)).then((data) => ({
        status: 'ok',
        data,
      })),
    targetResolve: (req: unknown) =>
      Promise.resolve(mockResolveTarget(req)).then((data) => ({
        status: 'ok',
        data,
      })),
    targetResolveExplicit: (req: unknown) =>
      Promise.resolve(mockResolveExplicit(req)).then((data) => ({
        status: 'ok',
        data,
      })),
  },
}));

vi.mock('@/api/ipc', () => ({
  unwrap: <T,>(r: { status: string; data?: T; error?: unknown }) => {
    if (r.status === 'error') throw r.error;
    return r.data as T;
  },
}));

import { TargetSearch } from './TargetSearch';
import type { TargetSuggestion, ResolvedTarget } from '@/bindings/aliases';

/**
 * Build an `unresolved` resolve response. Defaults to `"unknown"` (a generic
 * not-found miss) so tests that don't care about the specific reason keep
 * exercising the "search more catalogues" fallback; pass `"offline"`
 * explicitly to simulate the network-down / resolver-disabled case (#694).
 */
function unresolved(reason = 'unknown') {
  return {
    contractVersion: '1.0',
    requestId: 'r',
    status: 'unresolved',
    target: null,
    unresolvedReason: reason,
    error: null,
  };
}

/** Build a `resolved` response wrapping a `ResolvedTarget`. */
function resolved(target: ResolvedTarget) {
  return {
    contractVersion: '1.0',
    requestId: 'r',
    status: 'resolved',
    target,
    unresolvedReason: null,
    error: null,
  };
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
  mockResolveExplicit.mockReset();
  // Default: the long-tail resolver returns a generic not-found miss.
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
      expect.objectContaining({
        query: 'andr',
        limit: 20,
        contractVersion: '1.0',
      }),
    );
  });

  // ── #818: retry a Phase-1 miss while the backend reports a cache warm ──────

  it('retries the local search while the backend reports the resolve cache still warming', async () => {
    let call = 0;
    mockSearchTargets.mockImplementation(() => {
      call += 1;
      // First answer lands mid-warm: legitimately empty, warm still running.
      if (call === 1) {
        return {
          contractVersion: '1.0',
          requestId: 'r',
          suggestions: [],
          cacheWarming: true,
        };
      }
      // The warm has since committed: the object is there after all.
      return {
        contractVersion: '1.0',
        requestId: 'r',
        suggestions: [M31],
        cacheWarming: false,
      };
    });

    render(<TargetSearch onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'm31' },
    });
    await act(async () => {
      vi.advanceTimersByTime(300); // debounce
      await Promise.resolve();
    });

    expect(mockSearchTargets).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('option')).toBeNull();

    // The retry interval (250ms, mirroring WARM_RETRY_INTERVAL_MS).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });

    expect(mockSearchTargets).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('option')).toHaveTextContent('M 31');
  });

  it('never retries an ordinary (non-warming) miss', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [],
      cacheWarming: false,
    });

    render(<TargetSearch onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'zzz' },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    // Advancing well past one retry interval must not trigger a second call:
    // a settled empty answer is final, not a warm to wait out.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });

    expect(mockSearchTargets).toHaveBeenCalledTimes(1);
  });

  it('gives up retrying once the warm-retry budget elapses, keeping the empty result', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [],
      cacheWarming: true, // never settles within this test
    });

    render(<TargetSearch onSelect={vi.fn()} />);
    fireEvent.change(screen.getByRole('combobox'), {
      target: { value: 'm31' },
    });
    await act(async () => {
      vi.advanceTimersByTime(300);
      await Promise.resolve();
    });
    // Advance past the retry budget (30000ms, mirroring WARM_RETRY_BUDGET_MS).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_200);
    });

    expect(screen.queryByRole('option')).toBeNull();
    // Bounded: the retry loop must stop polling once the budget is spent,
    // not keep firing target.search forever.
    const callsAtBudget = mockSearchTargets.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(mockSearchTargets).toHaveBeenCalledTimes(callsAtBudget);
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

    expect(screen.getByRole('alert')).toHaveTextContent('Target search failed');
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
    await typeAndFlush(screen.getByRole('combobox'), 'i'); // 1 char < 2

    expect(mockSearchTargets).toHaveBeenCalled();
    expect(mockResolveTarget).not.toHaveBeenCalled();
  });

  // ── #843: MIN_RESOLVE_LEN=2 lets legitimate 2-char designations through ────

  it('fires the long-tail resolve for a 2-char query like "M1"', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [],
    });
    mockResolveTarget.mockResolvedValue(
      resolved({
        targetId: 'tgt-m1',
        simbadOid: 1,
        primaryDesignation: 'M 1',
        commonName: 'Crab Nebula',
        objectType: 'supernova_remnant',
        raDeg: 83.6,
        decDeg: 22.0,
        aliases: ['M 1'],
        source: 'resolved',
      }),
    );

    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'M1');

    expect(mockResolveTarget).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'M1' }),
    );
    expect(screen.getByRole('option')).toHaveTextContent('M 1');
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
    const staleResolved = resolved({
      ...SIMBAD_LBN,
      primaryDesignation: 'STALE OBJ',
    });
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

    fireEvent.change(screen.getByLabelText('Type'), {
      target: { value: 'galaxy' },
    });
    fireEvent.change(screen.getByLabelText('Catalogue'), {
      target: { value: 'messier' },
    });

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
    expect(
      screen.getByRole('button', { name: /set "m31" to M 31/i }),
    ).toBeInTheDocument();
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

    render(
      <TargetSearch
        onSelect={vi.fn()}
        enableOverride
        onOverride={onOverride}
      />,
    );
    await typeAndFlush(screen.getByRole('combobox'), 'andromeda');

    const overrideBtn = screen.getByRole('button', {
      name: /set "andromeda" to M 31/i,
    });
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

  // ── "Search more catalogues" (spec 052 P2, FR-008/FR-009) ──────────────────

  it('never calls target.resolve_explicit during ordinary typeahead', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31],
    });
    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'm31');

    expect(mockResolveExplicit).not.toHaveBeenCalled();
  });

  it('offers "search more catalogues" only once both phases come up empty', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [],
    });
    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'zzz-unknown');

    expect(
      screen.getByRole('button', {
        name: 'Search more catalogues (NED/VizieR)',
      }),
    ).toBeInTheDocument();
    // Still not fired automatically — only rendering the affordance.
    expect(mockResolveExplicit).not.toHaveBeenCalled();
  });

  it('does not offer "search more catalogues" while local/long-tail hits exist', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31],
    });
    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'm31');

    expect(
      screen.queryByRole('button', {
        name: 'Search more catalogues (NED/VizieR)',
      }),
    ).toBeNull();
  });

  it('clicking "search more catalogues" calls target.resolve_explicit and merges the hit', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [],
    });
    mockResolveExplicit.mockResolvedValue(resolved(SIMBAD_LBN));

    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'lbn 552');

    const btn = screen.getByRole('button', {
      name: 'Search more catalogues (NED/VizieR)',
    });
    await act(async () => {
      fireEvent.click(btn);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });

    expect(mockResolveExplicit).toHaveBeenCalledTimes(1);
    expect(mockResolveExplicit).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'lbn 552', override: null }),
    );
    // The debounced typeahead resolve (target.resolve) must never be asked to
    // fall back — only the explicit command was consulted.
    expect(mockResolveTarget).not.toHaveBeenCalledWith(
      expect.objectContaining({ override: expect.anything() }),
    );
    expect(screen.getByRole('option')).toHaveTextContent('LBN 552');
    expect(
      screen.queryByRole('button', {
        name: 'Search more catalogues (NED/VizieR)',
      }),
    ).toBeNull();
  });

  // ── "Search more catalogues" hybrid UX (spec 052 P2UX) ─────────────────────

  it('frames the zero-result state as a next step, inline with the fallback button', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [],
    });
    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'zzz-unknown');

    expect(screen.getByText('No matches in SIMBAD —')).toBeInTheDocument();
    expect(
      screen.getByRole('button', {
        name: 'Search more catalogues (NED/VizieR)',
      }),
    ).toBeInTheDocument();
    // The old bare "no matches" message is superseded by the inline framing.
    expect(screen.queryByText('No matching targets.')).toBeNull();
  });

  it('shows a "keep typing" hint (not "no matching targets") below the resolve minimum length (#843)', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [],
    });
    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'i'); // 1 char < 2

    // No search for Phase 2 has actually run yet below the threshold, so
    // claiming a miss ("No matching targets.") would be misleading.
    expect(screen.getByText('Keep typing to search…')).toBeInTheDocument();
    expect(screen.queryByText('No matching targets.')).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: 'Search more catalogues (NED/VizieR)',
      }),
    ).toBeNull();
  });

  it('shows "Searching more catalogues…" while the explicit fallback is in flight', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [],
    });
    let releaseExplicit: (() => void) | null = null;
    mockResolveExplicit.mockImplementation(
      () =>
        new Promise((res) => {
          releaseExplicit = () => res(resolved(SIMBAD_LBN));
        }),
    );

    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'lbn 552');

    const btn = screen.getByRole('button', {
      name: 'Search more catalogues (NED/VizieR)',
    });
    await act(async () => {
      fireEvent.click(btn);
      await Promise.resolve();
    });

    expect(screen.getByText('Searching more catalogues…')).toBeInTheDocument();

    await act(async () => {
      releaseExplicit?.();
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(
      screen.queryByText('Searching more catalogues…'),
    ).not.toBeInTheDocument();
  });

  it('Enter fires the explicit fallback exactly once when it is the only actionable thing (0 results)', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [],
    });
    mockResolveExplicit.mockResolvedValue(resolved(SIMBAD_LBN));

    render(<TargetSearch onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox');
    await typeAndFlush(input, 'lbn 552');

    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });

    expect(mockResolveExplicit).toHaveBeenCalledTimes(1);
    expect(mockResolveExplicit).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'lbn 552', override: null }),
    );

    // A second Enter after resolving must not re-fire (harderState left idle).
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve();
    });
    expect(mockResolveExplicit).toHaveBeenCalledTimes(1);
  });

  it('Enter keeps the input value and the popup visible through the whole fallback (#697 regression)', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [],
    });
    let releaseExplicit: (() => void) | null = null;
    mockResolveExplicit.mockImplementation(
      () =>
        new Promise((res) => {
          releaseExplicit = () => res(resolved(SIMBAD_LBN));
        }),
    );

    render(<TargetSearch onSelect={vi.fn()} />);
    const input = screen.getByRole('combobox');
    await typeAndFlush(input, 'lbn 552');
    expect(input).toHaveValue('lbn 552');
    expect(
      screen.getByRole('button', {
        name: 'Search more catalogues (NED/VizieR)',
      }),
    ).toBeInTheDocument();

    // Base UI's own Enter handling must never win the race and clear/close.
    await act(async () => {
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve();
    });
    expect(input).toHaveValue('lbn 552');
    expect(mockResolveExplicit).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Searching more catalogues…')).toBeInTheDocument();

    await act(async () => {
      releaseExplicit?.();
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });
    expect(input).toHaveValue('lbn 552');
    expect(screen.getByRole('option')).toHaveTextContent('LBN 552');
  });

  it('Enter does NOT fire the explicit fallback when suggestions are present — it selects the highlighted option', async () => {
    const onSelect = vi.fn();
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [M31, NGC7000],
    });
    render(<TargetSearch onSelect={onSelect} />);
    const input = screen.getByRole('combobox');
    await typeAndFlush(input, 'm');

    await act(async () => {
      fireEvent.keyDown(input, { key: 'ArrowDown' }); // highlight M31
      fireEvent.keyDown(input, { key: 'Enter' });
      await Promise.resolve();
    });

    expect(onSelect).toHaveBeenCalledWith(M31);
    expect(mockResolveExplicit).not.toHaveBeenCalled();
  });

  it('shows "still no matching targets" when the explicit fallback also misses', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [],
    });
    mockResolveExplicit.mockResolvedValue(unresolved('unknown'));

    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'zzz-unknown');

    const btn = screen.getByRole('button', {
      name: 'Search more catalogues (NED/VizieR)',
    });
    await act(async () => {
      fireEvent.click(btn);
      for (let i = 0; i < 8; i++) await Promise.resolve();
    });

    expect(screen.getByText('Still no matching targets.')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', {
        name: 'Search more catalogues (NED/VizieR)',
      }),
    ).toBeNull();
  });

  // ── Offline / resolver-disabled empty state (#694) ─────────────────────────

  it('explains that online resolution is off instead of rendering nothing, and skips the (also online) fallback', async () => {
    mockSearchTargets.mockResolvedValue({
      contractVersion: '1.0',
      requestId: 'r',
      suggestions: [],
    });
    mockResolveTarget.mockResolvedValue(unresolved('offline'));

    render(<TargetSearch onSelect={vi.fn()} />);
    await typeAndFlush(screen.getByRole('combobox'), 'ugc 12588');

    expect(
      screen.getByText(
        'Online resolution is off — only the bundled seed and local cache are used. Unknown objects are marked unresolved.',
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText('No matches in SIMBAD —')).toBeNull();
    expect(
      screen.queryByRole('button', {
        name: 'Search more catalogues (NED/VizieR)',
      }),
    ).toBeNull();
  });
});
