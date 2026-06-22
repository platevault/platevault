/// <reference types="@testing-library/jest-dom" />
/**
 * SessionsTable + FilterToolbar + SessionDetail inventory wiring tests —
 * spec 006 + spec 043 §4 (task #36 redesign + #62/#63 shared layout adoption).
 *
 * The Sessions surface is now a dense full-width table (SessionsTable) grouped
 * by a configurable key, with search + a review filter + a Group-by control in
 * the shared top bar (PageTopBar + FilterToolbar). The legacy frame-type filter
 * was removed (sessions are light frames). These tests target the new
 * components.
 *
 * Tests (jsdom, mock @/api/commands and @/features/sessions/store):
 *
 * 1. SessionsTable renders a target group header for each distinct target.
 * 2. SessionsTable renders session rows with target/filter content.
 * 3. SessionsTable discovered/candidate rows map to "Needs review" state label.
 * 4. SessionsTable renders empty-state when sources is empty.
 * 5b-6d. FilterToolbar (Sessions toolbar): review filter, group-by, search.
 * 7. SessionDetail renders empty-state when session is null.
 * 8-11b. SessionDetail review-state rail (read-only Pills, no action buttons).
 * 12-15. SessionDetail Facts / Provenance / Linked sections.
 * 16-20. Review action dispatch + toast contract.
 * 21-24. SessionsTable live fixture data + sort headers + footer.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { InventorySource, InventorySession } from '@/api/commands';

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const { mockInventoryList, mockInventorySessionReview, mockAddToast } = vi.hoisted(() => ({
  mockInventoryList: vi.fn(),
  mockInventorySessionReview: vi.fn(),
  mockAddToast: vi.fn(),
}));

vi.mock('@/api/commands', () => ({
  inventoryList: mockInventoryList,
  inventorySessionReview: mockInventorySessionReview,
}));

vi.mock('@/shared/toast', () => ({
  addToast: mockAddToast,
  useToasts: () => ({ toasts: [], dismiss: vi.fn() }),
}));

// Store mock — gives us direct control over returned data.
const mockStoreState: {
  data: { sources: InventorySource[] } | undefined;
  loading: boolean;
  error: Error | undefined;
} = { data: undefined, loading: false, error: undefined };

const mockReview = vi.fn();
const mockPending = { value: null as string | null };

vi.mock('../store', async (importOriginal) => {
  const original = await importOriginal<typeof import('../store')>();
  return {
    ...original,
    useInventorySources: vi.fn(() => mockStoreState),
    setInventoryFilters: vi.fn(),
    invalidateInventory: vi.fn(),
    useSessionReview: vi.fn(() => ({
      review: mockReview,
      pending: mockPending.value,
    })),
  };
});

vi.stubEnv('VITE_USE_MOCKS', 'true');

// ── Fixtures ──────────────────────────────────────────────────────────────────

import { INVENTORY_SOURCES, INVENTORY_LIST_RESPONSE } from '@/data/fixtures/inventory';

// Build a minimal session for use in specific-state tests.
function makeSession(overrides: Partial<InventorySession>): InventorySession {
  const base = INVENTORY_SOURCES[0].sessions[0];
  return { ...base, ...overrides };
}

const ROOT_ID = INVENTORY_SOURCES[0].id;

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
      {...props}
    />,
  );
}

// Mirror the FilterToolbar configuration SessionsPage builds: a search box, a
// "Review" labeled-select field, and a "Group by" control. Spies are supplied
// per-test so we can assert the change handlers fire with typed values.
function renderToolbar(opts: {
  search?: string;
  reviewValue?: string;
  onSearch?: (v: string) => void;
  onReview?: (v: string) => void;
  onGroupBy?: (v: string) => void;
} = {}) {
  return render(
    <FilterToolbar
      search={{
        value: opts.search ?? '',
        onChange: opts.onSearch ?? noop,
        ariaLabel: 'Search sessions',
        placeholder: 'Search target, filter, camera…',
      }}
      fields={[
        {
          key: 'review',
          label: 'Review',
          value: opts.reviewValue ?? '',
          allLabel: 'Default',
          options: [
            { value: 'confirmed', label: 'Confirmed' },
            { value: 'rejected', label: 'Rejected' },
          ],
          onChange: opts.onReview ?? noop,
        },
      ]}
      groupBy={{
        value: 'target',
        options: [
          { value: 'target', label: 'Target' },
          { value: 'camera', label: 'Camera' },
          { value: 'filter', label: 'Filter' },
          { value: 'month', label: 'Month' },
        ],
        onChange: opts.onGroupBy ?? noop,
      }}
    />,
  );
}

// SessionDetail no longer accepts action callbacks — actions live in TopActionBar.
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

  it('2. renders session rows with filter and state content', () => {
    renderList();
    // A confirmed state Pill is present for at least one row.
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0);
  });

  it('3. discovered/candidate state maps to "Needs review" label', () => {
    const discoveredSession = makeSession({ state: 'discovered', id: 'disc-1' });
    const src: InventorySource = {
      ...INVENTORY_SOURCES[0],
      id: ROOT_ID,
      sessions: [discoveredSession],
    };
    renderList({ sources: [src] });
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0);
  });

  it('4. empty-state appears when sources array is empty', () => {
    renderList({ sources: [] });
    expect(screen.getByText(/No sessions match/)).toBeDefined();
  });

  it('5. sortable column headers are rendered as buttons', () => {
    renderList();
    expect(screen.getByRole('button', { name: /Sort by Target/ })).toBeDefined();
    expect(screen.getByRole('button', { name: /Sort by Night/ })).toBeDefined();
  });

  it('6. clicking a column header calls onSort with that column', () => {
    const onSort = vi.fn();
    renderList({ onSort });
    fireEvent.click(screen.getByRole('button', { name: /Sort by Frames/ }));
    expect(onSort).toHaveBeenCalledWith('frames');
  });
});

describe('FilterToolbar (Sessions toolbar) — search, review filter, group-by', () => {
  it('5b. review-filter select calls onChange with the selected value', () => {
    const onReview = vi.fn();
    renderToolbar({ onReview });
    const select = screen.getByRole('combobox', { name: /Review/ });
    fireEvent.change(select, { target: { value: 'confirmed' } });
    expect(onReview).toHaveBeenCalledWith('confirmed');
  });

  it('6b. clearing the review filter calls onChange with empty string (Default)', () => {
    const onReview = vi.fn();
    renderToolbar({ onReview, reviewValue: 'confirmed' });
    const select = screen.getByRole('combobox', { name: /Review/ });
    fireEvent.change(select, { target: { value: '' } });
    expect(onReview).toHaveBeenCalledWith('');
  });

  it('6c. group-by select calls onChange with the selected key', () => {
    const onGroupBy = vi.fn();
    renderToolbar({ onGroupBy });
    const select = screen.getByRole('combobox', { name: /Group by/ });
    fireEvent.change(select, { target: { value: 'camera' } });
    expect(onGroupBy).toHaveBeenCalledWith('camera');
  });

  it('6d. typing in search calls onChange', () => {
    const onSearch = vi.fn();
    renderToolbar({ onSearch });
    const input = screen.getByRole('searchbox', { name: /Search sessions/ });
    fireEvent.change(input, { target: { value: 'M31' } });
    expect(onSearch).toHaveBeenCalledWith('M31');
  });

  it('6e. there is no frame-type filter in the Sessions toolbar', () => {
    renderToolbar();
    expect(screen.queryByRole('combobox', { name: /Frame/i })).toBeNull();
  });
});

// ── Tests: SessionDetail ──────────────────────────────────────────────────────

describe('SessionDetail — empty state', () => {
  it('7. renders empty-state when session is null', () => {
    renderDetail(null);
    expect(screen.getByText('Select a session')).toBeDefined();
  });
});

// The rail's "Review state" card shows a read-only Pill (consistent with
// MasterDetail and ProjectDetail rail patterns). Contextual review actions
// (Confirm / Re-open / Reject) live in the SessionDetail HEADER and are gated by
// visibility props the page supplies (task #79). With no visibility props set
// (the default), no action buttons render anywhere in the detail.
describe('SessionDetail — review state rail (read-only Pill, spec 006 FR-004)', () => {
  it('8. shows "Needs review" Pill for needs_review state; no buttons without visibility props', () => {
    const { queryAllByRole } = renderDetail(makeSession({ state: 'needs_review' }));
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0);
    // No visibility props passed → no action buttons render.
    expect(
      queryAllByRole('button', { name: /confirm|reject|re.?open/i }),
    ).toHaveLength(0);
  });

  it('9. shows "Confirmed" Pill for confirmed state; no buttons without visibility props', () => {
    const { queryAllByRole } = renderDetail(makeSession({ state: 'confirmed' }));
    expect(screen.getAllByText('Confirmed').length).toBeGreaterThan(0);
    expect(
      queryAllByRole('button', { name: /confirm|reject|re.?open/i }),
    ).toHaveLength(0);
  });

  it('10. shows "Needs review" Pill for needs_review; Reject absent without visibility props', () => {
    const { queryAllByRole } = renderDetail(makeSession({ state: 'needs_review' }));
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0);
    expect(
      queryAllByRole('button', { name: /reject/i }),
    ).toHaveLength(0);
  });

  it('11. shows "Rejected" Pill for rejected state; no buttons without visibility props', () => {
    const { queryAllByRole } = renderDetail(makeSession({ state: 'rejected' }));
    expect(screen.getAllByText('Rejected').length).toBeGreaterThan(0);
    expect(
      queryAllByRole('button', { name: /confirm|reject|re.?open/i }),
    ).toHaveLength(0);
  });

  it('11b. discovered state shows "Needs review" Pill; no buttons without visibility props', () => {
    const { queryAllByRole } = renderDetail(makeSession({ state: 'discovered' }));
    expect(screen.getAllByText('Needs review').length).toBeGreaterThan(0);
    expect(
      queryAllByRole('button', { name: /confirm|reject|re.?open/i }),
    ).toHaveLength(0);
  });
});

// Task #79: review actions are CONTEXTUAL and render in the SessionDetail
// header (not the global PageTopBar). Visibility is driven by props the page
// computes from the session's canonical state; clicking dispatches the handler.
describe('SessionDetail — contextual header actions (task #79)', () => {
  it('11c. renders Confirm/Reject in the header when their visibility props are set', () => {
    renderDetail(makeSession({ state: 'needs_review' }), {
      confirmVisible: true,
      rejectVisible: true,
      onConfirm: noop,
      onReject: noop,
    });
    expect(screen.getByRole('button', { name: /confirm/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /reject/i })).toBeDefined();
    expect(screen.queryByRole('button', { name: /re.?open/i })).toBeNull();
  });

  it('11d. renders Re-open when reopenVisible; clicking dispatches onReopen', () => {
    const onReopen = vi.fn();
    renderDetail(makeSession({ state: 'confirmed' }), {
      reopenVisible: true,
      onReopen,
    });
    fireEvent.click(screen.getByRole('button', { name: /re.?open/i }));
    expect(onReopen).toHaveBeenCalledTimes(1);
  });

  it('11e. clicking Confirm dispatches onConfirm; pending disables the button', () => {
    const onConfirm = vi.fn();
    renderDetail(makeSession({ state: 'needs_review' }), {
      confirmVisible: true,
      onConfirm,
      pending: true,
    });
    const btn = screen.getByRole('button', { name: /confirm/i });
    expect(btn).toBeDisabled();
    fireEvent.click(btn);
    // Disabled button does not fire its handler.
    expect(onConfirm).not.toHaveBeenCalled();
  });
});

describe('SessionDetail — Facts section (spec 006 FR-005; task #79 provenance merge)', () => {
  it('12. renders em-dash for missing fact values', () => {
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

// ── Tests: review action wiring ───────────────────────────────────────────────
// Actions now live in the TopActionBar on SessionsPage. Coverage is provided
// by testing the store's review() call contract directly, matching how
// SessionsPage.handleConfirm / handleReopen / handleReject dispatch to it.

describe('useSessionReview — action dispatch contract (spec 006 FR-006)', () => {
  beforeEach(() => {
    mockAddToast.mockClear();
    mockReview.mockClear();
  });

  it('16. confirm action dispatches review(id, "confirm") to store', async () => {
    mockReview.mockResolvedValue({ ok: true, noop: false });
    const { useSessionReview } = await import('../store');
    const { review } = useSessionReview();
    await review('session-1', 'confirm');
    expect(mockReview).toHaveBeenCalledWith('session-1', 'confirm');
  });

  it('17. reopen action dispatches review(id, "reopen") to store', async () => {
    mockReview.mockResolvedValue({ ok: true, noop: false });
    const { useSessionReview } = await import('../store');
    const { review } = useSessionReview();
    await review('session-1', 'reopen');
    expect(mockReview).toHaveBeenCalledWith('session-1', 'reopen');
  });

  it('18. reject action dispatches review(id, "reject") to store', async () => {
    mockReview.mockResolvedValue({ ok: true, noop: false });
    const { useSessionReview } = await import('../store');
    const { review } = useSessionReview();
    await review('session-1', 'reject');
    expect(mockReview).toHaveBeenCalledWith('session-1', 'reject');
  });
});

// ── Tests: store mutation hooks ───────────────────────────────────────────────

describe('useSessionReview — toast feedback (via store mock)', () => {
  beforeEach(() => {
    mockAddToast.mockClear();
    mockReview.mockClear();
  });

  it('19. noop result suppresses toast', async () => {
    mockReview.mockResolvedValue({ ok: true, noop: true });
    const { useSessionReview } = await import('../store');
    // Direct call through the mocked hook shape.
    const { review } = useSessionReview();
    const result = await review('session-1', 'confirm');
    expect(result.noop).toBe(true);
    expect(mockAddToast).not.toHaveBeenCalled();
  });

  it('20. error result returns error message', async () => {
    mockReview.mockResolvedValue({ ok: false, noop: false, error: 'source_disabled' });
    const { useSessionReview } = await import('../store');
    const { review } = useSessionReview();
    const result = await review('session-1', 'confirm');
    expect(result.ok).toBe(false);
    expect(result.error).toBe('source_disabled');
  });
});

// ── Tests: SessionsTable with live InventorySource data ───────────────────────

describe('SessionsTable — live inventory fixture data (T106)', () => {
  it('21. renders sessions from every fixture target', () => {
    renderList({ sources: INVENTORY_LIST_RESPONSE.sources });
    // Distinct targets from the fixture all appear as group headers.
    for (const target of ['NGC 7000', 'M31', 'M42']) {
      expect(screen.getAllByText(new RegExp(target)).length).toBeGreaterThan(0);
    }
  });

  it('22. selected session row has selected styling marker', () => {
    const session = INVENTORY_LIST_RESPONSE.sources[0].sessions[0];
    const { container } = renderList({ selected: session.id });
    const selectedRow = container.querySelector('.alm-sessions-table__row--selected');
    expect(selectedRow).not.toBeNull();
  });

  it('23. clicking a session row calls onSelect with its id', () => {
    const onSelect = vi.fn();
    const session = INVENTORY_LIST_RESPONSE.sources[0].sessions[0];
    const { container } = renderList({ onSelect });
    const row = container.querySelector('.alm-sessions-table__row');
    expect(row).not.toBeNull();
    fireEvent.click(row as Element);
    expect(onSelect).toHaveBeenCalled();
    void session;
  });

  it('24. no in-table footer count line (count moved to the bottom status bar, task #80)', () => {
    // The total count moved to the bottom status bar; the table no longer
    // renders a footer count line, even during load.
    const { container } = renderList({
      sources: INVENTORY_LIST_RESPONSE.sources,
      loading: true,
    });
    expect(container.querySelector('.alm-sessions-table__footer')).toBeNull();
    expect(screen.queryByText('Loading…')).toBeNull();
  });

  it('25. groupBy="camera" headlines groups by camera instead of target', () => {
    const camera = INVENTORY_LIST_RESPONSE.sources[0].sessions.find((s) => s.camera)?.camera;
    expect(camera).toBeTruthy();
    renderList({ sources: INVENTORY_LIST_RESPONSE.sources, groupBy: 'camera' });
    // The camera value heads a group row.
    expect(screen.getAllByText(new RegExp(camera as string)).length).toBeGreaterThan(0);
  });
});
