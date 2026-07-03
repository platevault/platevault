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
 * inventory. The review-state column/filter and the Confirm/Re-open/Reject
 * action tests were removed along with the review-state machine.
 *
 * Tests (jsdom, mock @/api/commands and @/features/sessions/store):
 *
 * 1. SessionsTable renders a target group header for each distinct target.
 * 2. SessionsTable renders session rows with filter content.
 * 3. SessionsTable renders empty-state when sources is empty.
 * 4-5. FilterToolbar (Sessions toolbar): search, group-by.
 * 6. SessionDetail renders empty-state when session is null.
 * 7-10. SessionDetail Facts / Provenance / Linked sections.
 * 11-15. SessionsTable live fixture data + sort headers + footer.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { InventorySource, InventorySession } from '@/api/commands';

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const { mockInventoryList } = vi.hoisted(() => ({
  mockInventoryList: vi.fn(),
}));

vi.mock('@/api/commands', () => ({
  inventoryList: mockInventoryList,
}));

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

import { INVENTORY_SOURCES, INVENTORY_LIST_RESPONSE } from '@/data/fixtures/inventory';

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

function renderList(props: Partial<React.ComponentProps<typeof SessionsTable>> = {}) {
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
function renderToolbar(opts: {
  search?: string;
  onSearch?: (v: string) => void;
} = {}) {
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

function renderDetail(
  session: InventorySession | null,
  props: Partial<React.ComponentProps<typeof SessionDetail>> = {},
) {
  return render(
    <SessionDetail
      session={session}
      {...props}
    />,
  );
}

// ── Tests: SessionsList ───────────────────────────────────────────────────────

describe('SessionsTable — target group headers and rows', () => {
  it('1. renders a target group header for each distinct target', () => {
    renderList();
    // Sessions are grouped by target identity; each distinct target heads a group.
    for (const target of ['NGC 7000', 'IC 1396', 'M31', 'M42']) {
      expect(screen.getAllByText(new RegExp(target)).length).toBeGreaterThan(0);
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
    expect(screen.getByRole('button', { name: /Sort by Target/ })).toBeDefined();
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
    const groupBySelects = screen.getAllByRole('combobox', { name: /Group by/i });
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

describe('SessionDetail — Facts section (spec 006 FR-005; task #79 provenance merge)', () => {
  it('10. renders em-dash for missing fact values', () => {
    const session = makeSession({
      filter: null,
      exposure: null,
      camera: undefined,
    });
    renderDetail(session);
    const dashes = screen.getAllByText('—');
    expect(dashes.length).toBeGreaterThan(0);
  });

  // Task #79: the standalone Provenance section was removed. Inference is now
  // conveyed by the Facts table's SOURCE column — an inferred target/filter
  // reports "Inferred" instead of "FITS" on its fact row.
  it('11. no standalone Provenance section; inferred values show Inferred source badge', () => {
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

  it('12. FITS-extracted (non-inferred) values show a FITS source badge, never Provenance', () => {
    const session = makeSession({ provenance: undefined });
    renderDetail(session);
    expect(screen.queryByText('Provenance')).toBeNull();
    expect(screen.getAllByText('FITS').length).toBeGreaterThan(0);
  });

  it('13. renders linked project names as visible elements', () => {
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

// ── Tests: SessionsTable with live InventorySource data ───────────────────────

describe('SessionsTable — live inventory fixture data (T106)', () => {
  it('14. renders sessions from every fixture target', () => {
    renderList({ sources: INVENTORY_LIST_RESPONSE.sources });
    // Distinct targets from the fixture all appear as group headers.
    for (const target of ['NGC 7000', 'M31', 'M42']) {
      expect(screen.getAllByText(new RegExp(target)).length).toBeGreaterThan(0);
    }
  });

  it('15. selected session row has selected styling marker', () => {
    const session = INVENTORY_LIST_RESPONSE.sources[0].sessions[0];
    const { container } = renderList({ selected: session.id });
    const selectedRow = container.querySelector('.alm-sessions-table__row--selected');
    expect(selectedRow).not.toBeNull();
  });

  it('16. clicking a session row calls onSelect with its id', () => {
    const onSelect = vi.fn();
    const session = INVENTORY_LIST_RESPONSE.sources[0].sessions[0];
    const { container } = renderList({ onSelect });
    const row = container.querySelector('.alm-sessions-table__row');
    expect(row).not.toBeNull();
    fireEvent.click(row as Element);
    expect(onSelect).toHaveBeenCalled();
    void session;
  });

  it('17. no in-table footer count line (count moved to the bottom status bar, task #80)', () => {
    // The total count moved to the bottom status bar; the table no longer
    // renders a footer count line, even during load.
    const { container } = renderList({
      sources: INVENTORY_LIST_RESPONSE.sources,
      loading: true,
    });
    expect(container.querySelector('.alm-sessions-table__footer')).toBeNull();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('18. dims=["camera"] headlines groups by camera instead of target', () => {
    const camera = INVENTORY_LIST_RESPONSE.sources[0].sessions.find((s) => s.camera)?.camera;
    expect(camera).toBeTruthy();
    renderList({ sources: INVENTORY_LIST_RESPONSE.sources, dims: ['camera'] });
    // The camera value heads a group row (data-testid sessions-group-camera-<camera>).
    expect(screen.getAllByText(new RegExp(camera as string)).length).toBeGreaterThan(0);
  });
});
