// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * SessionsTable + FilterToolbar + SessionDetail inventory wiring tests —
 * spec 006 + spec 043 §4 (task #36 redesign + #62/#63 shared layout adoption).
 *
 * The Sessions surface is now a dense full-width table (SessionsTable) grouped
 * by target (fixed — Group-by was removed: sessions contain 1–few frame types
 * by definition), with search in the shared top bar (PageTopBar +
 * FilterToolbar). The legacy frame-type filter was removed (sessions are
 * light frames). These tests target the new components.
 *
 * Spec 041 FR-051 (T076, Phase 13): sessions are derived, already-confirmed
 * inventory. The review-state column/filter and the Confirm/Re-open/Reject/
 * Ignore action tests were removed along with the review-state machine. The
 * Reveal action (FR-007) is unrelated to the review lifecycle and is retained.
 *
 * Tests (jsdom, mock @/features/sessions/store):
 *
 * 1. SessionsTable renders a target group header for each distinct target.
 * 2. SessionsTable renders session rows with filter content.
 * 3. SessionsTable renders empty-state when sources is empty.
 * 4-5. SessionsTable sort headers.
 * 6-8. FilterToolbar (Sessions toolbar): search, no frame-type filter, group-by.
 * 9. SessionDetail renders empty-state when session is null.
 * 10-11. SessionDetail Reveal action (contextual header action).
 * 12-15. SessionDetail Facts / Provenance / Linked sections.
 * 16-20. SessionsTable live fixture data + sort headers + footer.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { InventorySource, InventorySession } from '@/bindings/index';

// ── Hoist mocks ───────────────────────────────────────────────────────────────
// The store hook is fully mocked below, so the real IPC layer never runs; we
// only need the toast spy here (spec 037: no @/api/commands mock required).
// Spec 041 FR-051 (T076): the review-action dispatch/toast tests that needed
// to inspect toast calls are removed, so no hoisted addToast spy is needed.

vi.mock('@/shared/toast', () => ({
  addToast: vi.fn(),
  useToasts: () => ({ toasts: [], dismiss: vi.fn() }),
}));

// Store mock — gives us direct control over returned data.
const mockStoreState: {
  data: { sources: InventorySource[] } | undefined;
  loading: boolean;
  error: Error | undefined;
} = { data: undefined, loading: false, error: undefined };

vi.mock('../store', async (importOriginal) => {
  const original = await importOriginal<typeof import('../store')>();
  return {
    ...original,
    useInventorySources: vi.fn(() => mockStoreState),
    setInventoryFilters: vi.fn(),
    invalidateInventory: vi.fn(),
  };
});

vi.stubEnv('VITE_USE_MOCKS', 'true');

// ── Fixtures ──────────────────────────────────────────────────────────────────

import {
  INVENTORY_SOURCES,
  INVENTORY_LIST_RESPONSE,
} from '@/data/fixtures/inventory';

// Build a minimal session for use in specific tests.
function makeSession(overrides: Partial<InventorySession>): InventorySession {
  const base = INVENTORY_SOURCES[0].sessions[0];
  return { ...base, ...overrides };
}

// ── Import components after mocks are in place ────────────────────────────────

import { SessionsTable, DEFAULT_SESSION_SORT } from '../SessionsTable';
import { FilterToolbar } from '@/components';
import { SessionDetail } from '../SessionDetail';

// ── Helpers ───────────────────────────────────────────────────────────────────

const noop = () => undefined;

function renderList(
  props: Partial<React.ComponentProps<typeof SessionsTable>> = {},
) {
  return render(
    <SessionsTable
      sources={INVENTORY_LIST_RESPONSE.sources}
      selected={null}
      onSelect={noop}
      loading={false}
      sort={DEFAULT_SESSION_SORT}
      onSort={noop}
      dims={['target']}
      {...props}
    />,
  );
}

// Mirror the FilterToolbar configuration SessionsPage builds: a search box.
// Spec 041 FR-051 (T076): the review filter field is removed.
function renderToolbar(
  opts: { search?: string; onSearch?: (v: string) => void } = {},
) {
  return render(
    <FilterToolbar
      search={{
        value: opts.search ?? '',
        onChange: opts.onSearch ?? noop,
        ariaLabel: 'Search sessions',
        placeholder: 'Search target, filter, camera…',
      }}
    />,
  );
}

// SessionDetail no longer accepts review-action callbacks — only Reveal (FR-007).
// SessionDetail now mounts SessionFrameInventory/RawFrameCleanupSection
// (spec 048 T014/US3), which call useMutation — a QueryClientProvider is
// required in the tree even though neither fires an IPC call on mount.
function renderDetail(
  session: InventorySession | null,
  props: Partial<React.ComponentProps<typeof SessionDetail>> = {},
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SessionDetail session={session} {...props} />
    </QueryClientProvider>,
  );
}

// ── Tests: SessionsList ───────────────────────────────────────────────────────

describe('SessionsTable — target group headers and rows', () => {
  it('1. renders a target group header for each distinct target', () => {
    const { container } = renderList();
    // Scoped to the actual group-header label cell (SessionsTable.tsx's
    // `.pv-listgroup__label`, `data-testid="sessions-group-target-<key>"`)
    // rather than "this text appears anywhere on the page" — the prior
    // version would still pass even if grouping broke entirely and targets
    // only ever rendered in the per-row `.pv-sessions-cell--target` cell.
    const groupLabels = Array.from(
      container.querySelectorAll('.pv-listgroup__label'),
    ).map((el) => el.textContent);
    for (const target of ['NGC 7000', 'IC 1396', 'M31', 'M42']) {
      expect(groupLabels.some((label) => label?.includes(target))).toBe(true);
    }
  });

  it('2. renders session rows with filter content', () => {
    renderList();
    // A session's filter Pill (e.g. "Ha") is present for at least one row.
    expect(screen.getAllByText('Ha').length).toBeGreaterThan(0);
  });

  it('3. empty-state appears when sources array is empty', () => {
    renderList({ sources: [] });
    expect(screen.getByText(/No sessions match/)).toBeDefined();
  });

  it('4. sortable column headers are rendered as buttons', () => {
    renderList();
    expect(
      screen.getByRole('button', { name: /Sort by Target/ }),
    ).toBeDefined();
    expect(screen.getByRole('button', { name: /Sort by Night/ })).toBeDefined();
  });

  it('5. clicking a column header calls onSort with that column', () => {
    const onSort = vi.fn();
    renderList({ onSort });
    fireEvent.click(screen.getByRole('button', { name: /Sort by Frames/ }));
    expect(onSort).toHaveBeenCalledWith('frames');
  });
});

describe('FilterToolbar (Sessions toolbar) — search', () => {
  it('6. typing in search calls onChange', () => {
    const onSearch = vi.fn();
    renderToolbar({ onSearch });
    const input = screen.getByRole('searchbox', { name: /Search sessions/ });
    fireEvent.change(input, { target: { value: 'M31' } });
    expect(onSearch).toHaveBeenCalledWith('M31');
  });

  it('7. there is no frame-type filter in the Sessions toolbar', () => {
    renderToolbar();
    expect(screen.queryByRole('combobox', { name: /Frame/i })).toBeNull();
  });

  it('8. the "Group by" grouping control IS present in the Sessions toolbar', () => {
    render(
      <FilterToolbar
        search={{ value: '', onChange: noop, ariaLabel: 'Search sessions' }}
        grouping={{
          dimensions: [
            { value: 'target', label: 'Target' },
            { value: 'filter', label: 'Filter' },
          ],
          dims: ['target'],
          setSlot: noop,
        }}
      />,
    );
    // The grouping control renders multiple slots; the first has aria-label "Group by".
    // getAllByRole to handle multiple grouping selects in the toolbar.
    const groupBySelects = screen.getAllByRole('combobox', {
      name: /Group by/i,
    });
    expect(groupBySelects.length).toBeGreaterThan(0);
  });
});

// ── Tests: SessionDetail ──────────────────────────────────────────────────────

describe('SessionDetail — empty state', () => {
  it('9. renders empty-state when session is null', () => {
    renderDetail(null);
    expect(screen.getByText('Select a session')).toBeDefined();
  });
});

// Spec 041 FR-051 (T076): the Confirm/Re-open/Reject/Ignore contextual header
// actions are removed along with the review-state machine. Reveal (FR-007) is
// unrelated to the review lifecycle and is retained — it renders in the same
// SessionDetail header slot, gated by the `revealVisible` prop the page
// supplies (task #79).
describe('SessionDetail — contextual header actions (task #79)', () => {
  // T410/T411 (spec 006 FR-007): per-row Reveal. The button carries the shared
  // platform-native revealLabel(); jsdom reports no platform → Linux-generic.
  it('10. renders Reveal when revealVisible; clicking dispatches onReveal', () => {
    const onReveal = vi.fn();
    renderDetail(makeSession({}), {
      revealVisible: true,
      onReveal,
    });
    const btn = screen.getByRole('button', { name: /show in file manager/i });
    fireEvent.click(btn);
    expect(onReveal).toHaveBeenCalledTimes(1);
  });

  it('11. Reveal is absent when revealVisible is not set (no source path)', () => {
    renderDetail(makeSession({}));
    expect(
      screen.queryByRole('button', { name: /show in file manager/i }),
    ).toBeNull();
  });

  it('11b. Reveal label follows the platform (Windows and macOS)', () => {
    // Mock the platform source both ways: revealLabel() reads
    // navigator.platform (jsdom exposes no userAgentData).
    const setPlatform = (v: string) =>
      Object.defineProperty(window.navigator, 'platform', {
        value: v,
        configurable: true,
      });

    try {
      setPlatform('Win32');
      const { unmount } = renderDetail(makeSession({}), {
        revealVisible: true,
        onReveal: vi.fn(),
      });
      expect(
        screen.getByRole('button', { name: 'Show in File Explorer' }),
      ).toBeDefined();
      unmount();

      setPlatform('MacIntel');
      renderDetail(makeSession({}), { revealVisible: true, onReveal: vi.fn() });
      expect(
        screen.getByRole('button', { name: 'Reveal in Finder' }),
      ).toBeDefined();
    } finally {
      // Drop the instance override so later tests see jsdom's prototype default.
      delete (window.navigator as unknown as Record<string, unknown>).platform;
    }
  });
});

describe('SessionDetail — Facts section (spec 006 FR-005; task #79 provenance merge)', () => {
  // spec-030 Q16 (#620, #619, FR-135/FR-137): every fact field here is
  // applicable to a light session (data-model.md matrix — the Light column
  // is all-✓), so a missing value now renders the unresolved chip, not a
  // silent em-dash indistinguishable from "field doesn't apply here".
  it('12. renders the unresolved chip (not a bare em-dash) for missing fact values', () => {
    const session = makeSession({
      filter: null,
      exposure: null,
      camera: undefined,
    });
    renderDetail(session);
    const chips = screen.getAllByTestId('unresolved-chip');
    expect(chips.length).toBeGreaterThan(0);
  });

  // Task #79: the standalone Provenance section was removed. Inference is now
  // conveyed by the Facts table's SOURCE column — an inferred target/filter
  // reports "Inferred" instead of "FITS" on its fact row.
  it('13. no standalone Provenance section; inferred values show Inferred source badge', () => {
    const session = makeSession({
      target: 'NGC 7000',
      filter: 'Ha',
      provenance: { target: 'NGC 7000', filter: 'Ha', confirmedBy: 'user' },
    });
    renderDetail(session);
    expect(screen.queryByText('Provenance')).toBeNull();
    // The SOURCE column carries inferred-vs-explicit: inferred target/filter
    // surface an "Inferred" badge, and the confirmer surfaces a "User" badge.
    expect(screen.getAllByText('Inferred').length).toBeGreaterThan(0);
    expect(screen.getAllByText('User').length).toBeGreaterThan(0);
  });

  it('14. FITS-extracted (non-inferred) values show a FITS source badge, never Provenance', () => {
    const session = makeSession({ provenance: undefined });
    renderDetail(session);
    expect(screen.queryByText('Provenance')).toBeNull();
    expect(screen.getAllByText('FITS').length).toBeGreaterThan(0);
  });

  it('15. renders linked project names as visible elements', () => {
    const session = makeSession({
      linked: {
        projects: [
          { id: 'proj-1', name: 'NGC 7000 · HOO' },
          { id: 'proj-2', name: 'NGC 7000 · SHO' },
        ],
      },
    });
    renderDetail(session);
    expect(screen.getByText('NGC 7000 · HOO')).toBeDefined();
    expect(screen.getByText('NGC 7000 · SHO')).toBeDefined();
  });
});

// Spec 041 FR-051 (T076): `useSessionReview` and its action-dispatch/toast
// contract tests are removed along with the review-state machine — there is
// no review mutation left to dispatch.

// ── Tests: SessionsTable with live InventorySource data ───────────────────────

describe('SessionsTable — live inventory fixture data (T106)', () => {
  it('16. renders sessions from every fixture target', () => {
    const { container } = renderList({
      sources: INVENTORY_LIST_RESPONSE.sources,
    });
    // Scoped to the group-header label cell — see test 1's comment above for
    // why "appears anywhere on the page" isn't sufficient here.
    const groupLabels = Array.from(
      container.querySelectorAll('.pv-listgroup__label'),
    ).map((el) => el.textContent);
    for (const target of ['NGC 7000', 'M31', 'M42']) {
      expect(groupLabels.some((label) => label?.includes(target))).toBe(true);
    }
  });

  it('17. selected session row has selected styling marker', () => {
    const session = INVENTORY_LIST_RESPONSE.sources[0].sessions[0];
    const { container } = renderList({ selected: session.id });
    const selectedRow = container.querySelector(
      '.pv-sessions-table__row--selected',
    );
    expect(selectedRow).not.toBeNull();
  });

  it('18. clicking a session row calls onSelect with its id', () => {
    const onSelect = vi.fn();
    const session = INVENTORY_LIST_RESPONSE.sources[0].sessions[0];
    const { container } = renderList({ onSelect });
    const row = container.querySelector('.pv-sessions-table__row');
    expect(row).not.toBeNull();
    fireEvent.click(row as Element);
    expect(onSelect).toHaveBeenCalled();
    void session;
  });

  it('19. no in-table footer count line (count moved to the bottom status bar, task #80)', () => {
    // The total count moved to the bottom status bar; the table no longer
    // renders a footer count line, even during load.
    const { container } = renderList({
      sources: INVENTORY_LIST_RESPONSE.sources,
      loading: true,
    });
    expect(container.querySelector('.pv-sessions-table__footer')).toBeNull();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('20. dims=["camera"] headlines groups by camera instead of target', () => {
    const camera = INVENTORY_LIST_RESPONSE.sources[0].sessions.find(
      (s) => s.camera,
    )?.camera;
    expect(camera).toBeTruthy();
    renderList({ sources: INVENTORY_LIST_RESPONSE.sources, dims: ['camera'] });
    // The camera value heads a group row (data-testid sessions-group-camera-<camera>).
    expect(
      screen.getAllByText(new RegExp(camera as string)).length,
    ).toBeGreaterThan(0);
  });
});

// ── Tests: Inbox-parity (spec 043 §4 — Sessions ⇄ Inbox interaction parity) ────

describe('SessionsTable — Inbox-parity (spec 043 §4)', () => {
  it('21. FLAT (default) rows show the target identity in the Target cell', () => {
    const { container } = renderList({ dims: [] });
    // No group headers in flat mode…
    expect(
      container.querySelector('[data-testid^="sessions-group-"]'),
    ).toBeNull();
    // …yet every distinct target is still readable per row (the row headline).
    for (const target of ['NGC 7000', 'M31', 'M42']) {
      expect(screen.getAllByText(new RegExp(target)).length).toBeGreaterThan(0);
    }
  });

  it('22. rows carry a stable per-row testid (sessions-row-<id>)', () => {
    const session = INVENTORY_LIST_RESPONSE.sources[0].sessions[0];
    renderList({ dims: [] });
    expect(
      screen.getByTestId(`sessions-row-${session.id}`),
    ).toBeInTheDocument();
  });

  it('23. renders inside the shared .pv-listtable viewport with a windowed scroll container', () => {
    renderList({ dims: [] });
    expect(screen.getByTestId('sessions-list')).toBeInTheDocument();
    // The shared Table's virtualized scroll wrapper (padding-spacer windowing).
    expect(screen.getByTestId('sessions-virtual-sizer')).toBeInTheDocument();
  });

  it('24. grouping-state hint footer names the active dimensions when grouped', () => {
    renderList({ dims: ['target', 'filter'] });
    expect(screen.getByTestId('sessions-grouping-hint').textContent).toMatch(
      /Target › Filter/,
    );
  });

  it('25. no grouping hint footer in the flat default', () => {
    renderList({ dims: [] });
    expect(screen.queryByTestId('sessions-grouping-hint')).toBeNull();
  });
});

// ── Tests: aria-sort emission on the <th> (a11y — shared Table + ariaSortFor) ─

describe('SessionsTable — aria-sort on the column header <th>', () => {
  it('26. exactly one th carries aria-sort: the active column, with its direction', () => {
    const { container } = renderList({
      dims: [],
      sort: { col: 'night', dir: 'desc' },
    });
    const marked = container.querySelectorAll('th[aria-sort]');
    expect(marked.length).toBe(1);
    expect(marked[0].getAttribute('aria-sort')).toBe('descending');
    expect(marked[0].textContent).toMatch(/Night/);
  });

  it('27. ascending sort maps to aria-sort="ascending"', () => {
    const { container } = renderList({
      dims: [],
      sort: { col: 'frames', dir: 'asc' },
    });
    const th = container.querySelector('th[aria-sort]');
    expect(th).not.toBeNull();
    expect(th?.getAttribute('aria-sort')).toBe('ascending');
    expect(th?.textContent).toMatch(/Frames/);
  });
});

// ── Tests: SessionsPage toolbar field filters (Inbox-parity helpers) ──────────

import { filterSources, fieldOptions } from '../SessionsPage';

describe('SessionsPage — field-filter helpers (Inbox-parity toolbar)', () => {
  it('28. filterSources narrows by optical filter and camera', () => {
    const all = INVENTORY_LIST_RESPONSE.sources;
    const somefilter = all.flatMap((s) => s.sessions).find((s) => s.filter)
      ?.filter as string;
    const filtered = filterSources(all, '', somefilter, '');
    expect(filtered.length).toBeGreaterThan(0);
    for (const src of filtered) {
      for (const s of src.sessions) expect(s.filter).toBe(somefilter);
    }
    // A camera value that exists must keep only its sessions.
    const someCamera = all.flatMap((s) => s.sessions).find((s) => s.camera)
      ?.camera as string;
    const byCam = filterSources(all, '', '', someCamera);
    for (const src of byCam) {
      for (const s of src.sessions) expect(s.camera).toBe(someCamera);
    }
  });

  it('29. fieldOptions derives unique sorted options from the response', () => {
    const opts = fieldOptions(INVENTORY_LIST_RESPONSE.sources, (s) => s.filter);
    const values = opts.map((o) => o.value);
    expect(values.length).toBeGreaterThan(0);
    expect(new Set(values).size).toBe(values.length);
    expect([...values].sort((a, b) => a.localeCompare(b))).toEqual(values);
  });
});
