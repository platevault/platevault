/// <reference types="@testing-library/jest-dom" />
/**
 * TargetsPage tests — spec 043 shared list-page adoption (task #73).
 *
 * The page now uses the shared layout system: a pinned PageTopBar (FilterToolbar
 * with My Targets filter + search + catalogues + group-by) over a ListPageLayout
 * whose primary content is the full-width TargetsTable, with TargetDetailV2 in
 * the detail pane that mounts only on selection.
 *
 * Tests:
 *  1. Shows a loading footer while listTargets is in flight.
 *  2. Renders target rows from listTargets backend response.
 *  3. Detail pane mounts only on selection (no empty centered dashboard).
 *  4. Clicking a row triggers navigate with the target id.
 *  5. When selected UUID provided, TargetDetailV2 mounts and calls getTargetDetail.
 *  6. effectiveLabel from backend renders in the detail pane.
 *  7. Shows error state when listTargets rejects.
 *  8. Target count appears in the table footer.
 *  P1. "All targets" (default) filters to allowed planner catalogs.
 *  P2. Selecting "My Targets" shows a STUB empty state (no backend linkage).
 *  H1/H2/H3. Toolbar search filters the table by designation / label.
 *  H4. Search "M31" matches "M 31" (alias-aware whitespace normalization). (#103b)
 *  H5. Search "m31" matches "M 31" (case + whitespace insensitive). (#103b)
 *  MT1. My Targets filter toggle activates and deactivates via the select. (#91)
 *  G1. "Add target" button opens the add dialog.
 *  S1. Clicking a column header sorts the table.
 */

import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const {
  mockListTargets,
  mockGetTargetDetail,
  mockSearchTargets,
  mockResolveTarget,
  mockAddTargetAlias,
  mockRemoveTargetAlias,
  mockSetDisplayAlias,
  mockClearDisplayAlias,
  mockListTargetSessions,
  mockListTargetProjects,
  mockGetTargetNote,
  mockUpdateTargetNote,
  mockAstroFormatBatch,
} = vi.hoisted(() => ({
  mockListTargets: vi.fn(),
  mockGetTargetDetail: vi.fn(),
  mockSearchTargets: vi.fn(),
  mockResolveTarget: vi.fn(),
  mockAddTargetAlias: vi.fn(),
  mockRemoveTargetAlias: vi.fn(),
  mockSetDisplayAlias: vi.fn(),
  mockClearDisplayAlias: vi.fn(),
  mockListTargetSessions: vi.fn(),
  mockListTargetProjects: vi.fn(),
  mockGetTargetNote: vi.fn(),
  mockUpdateTargetNote: vi.fn(),
  mockAstroFormatBatch: vi.fn(),
}));

/** Wrap a value in the generated `{ status: 'ok' }` Result envelope. */
const ok = <T,>(data: T) => ({ status: 'ok' as const, data });

vi.mock('@/bindings/index', () => ({
  commands: {
    targetList: mockListTargets,
    targetGet: mockGetTargetDetail,
    targetSearch: mockSearchTargets,
    targetResolve: mockResolveTarget,
    targetAliasAdd: mockAddTargetAlias,
    targetAliasRemove: mockRemoveTargetAlias,
    targetDisplayAliasSet: mockSetDisplayAlias,
    targetDisplayAliasClear: mockClearDisplayAlias,
    targetSessionsList: mockListTargetSessions,
    targetProjectsList: mockListTargetProjects,
    targetNoteGet: mockGetTargetNote,
    targetNoteUpdate: mockUpdateTargetNote,
    targetAstroFormatBatch: mockAstroFormatBatch,
  },
}));

mockAddTargetAlias.mockResolvedValue(ok({ alias: { id: 'a', alias: 'x', kind: 'user' } }));
mockRemoveTargetAlias.mockResolvedValue(ok({ removed: true }));
mockSetDisplayAlias.mockResolvedValue(ok({}));
mockClearDisplayAlias.mockResolvedValue(ok({}));
mockListTargetSessions.mockResolvedValue(ok([]));
mockListTargetProjects.mockResolvedValue(ok([]));
mockGetTargetNote.mockResolvedValue(ok({ notes: null }));
mockUpdateTargetNote.mockResolvedValue(ok({ notes: null }));
mockAstroFormatBatch.mockResolvedValue(ok({ formatted: [] }));

const mockNavigate = vi.fn();
const mockSelectedId = { current: undefined as string | undefined };

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => ({ selected: mockSelectedId.current }),
  // The no-site banner (spec 044 US3) links to Settings via `Link`, which
  // needs a router context this test doesn't provide. Stub it as a plain
  // anchor, consistent with TargetsTable.test.tsx/TargetDetailV2.test.tsx.
  Link: ({ children, to, ...rest }: { children?: import('react').ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('no tauri in tests')),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { TargetsPage } from './TargetsPage';
import { __setSiteExistsForTest } from './site-gate';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TARGET_ID = '550e8400-e29b-41d4-a716-446655440201';

const listItems = [
  {
    id: TARGET_ID,
    effectiveLabel: 'NGC 7000',
    primaryDesignation: 'NGC 7000',
    objectType: 'emission_nebula',
  },
  {
    id: '550e8400-e29b-41d4-a716-446655440202',
    effectiveLabel: 'M 31',
    primaryDesignation: 'M 31',
    objectType: 'galaxy',
  },
];

function makeDetail() {
  return {
    id: TARGET_ID,
    primaryDesignation: 'NGC 7000',
    effectiveLabel: 'NGC 7000',
    objectType: 'emission_nebula',
    raDeg: 314.75,
    decDeg: 44.37,
    simbadOid: 2_222_222,
    source: 'resolved',
    aliases: [],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  __setSiteExistsForTest(null); // default to the real (false) site binding
  mockSelectedId.current = undefined;
  mockListTargets.mockResolvedValue(ok(listItems));
  mockGetTargetDetail.mockResolvedValue(ok(makeDetail()));
  mockSearchTargets.mockResolvedValue(ok({ contractVersion: '1.0', requestId: 'r', suggestions: [] }));
  mockResolveTarget.mockResolvedValue(ok({ contractVersion: '1.0', requestId: 'r', status: 'unresolved', target: null, unresolvedReason: 'offline', error: null }));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TargetsPage', () => {
  it('1. shows a loading footer while listTargets is in flight', () => {
    mockListTargets.mockReturnValue(new Promise(() => {}));
    render(<TargetsPage />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('2. renders target rows from backend response', async () => {
    render(<TargetsPage />);
    await waitFor(() => {
      expect(screen.getByText('NGC 7000')).toBeInTheDocument();
      expect(screen.getByText('M 31')).toBeInTheDocument();
    });
  });

  it('3. detail pane mounts only when a target is selected', async () => {
    const { rerender } = render(<TargetsPage />);
    await waitFor(() => screen.getByText('NGC 7000'));
    // No selection → no detail pane region.
    expect(screen.queryByRole('complementary', { name: 'Target details' })).not.toBeInTheDocument();

    mockSelectedId.current = TARGET_ID;
    rerender(<TargetsPage />);
    await waitFor(() =>
      expect(screen.getByRole('complementary', { name: 'Target details' })).toBeInTheDocument(),
    );
  });

  it('4. clicking a row triggers navigate', async () => {
    render(<TargetsPage />);
    await waitFor(() => screen.getByText('NGC 7000'));

    const cell = screen.getByText('NGC 7000');
    fireEvent.click(cell.closest('tr') ?? cell);

    expect(mockNavigate).toHaveBeenCalled();
  });

  it('5. when selected UUID provided, getTargetDetail is called', async () => {
    mockSelectedId.current = TARGET_ID;
    render(<TargetsPage />);
    await waitFor(() =>
      expect(mockGetTargetDetail).toHaveBeenCalledWith({ targetId: TARGET_ID }),
    );
  });

  it('6. effectiveLabel from backend renders in detail pane', async () => {
    mockSelectedId.current = TARGET_ID;
    render(<TargetsPage />);
    await waitFor(() => {
      const items = screen.getAllByText('NGC 7000');
      expect(items.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('7. shows error message when listTargets rejects', async () => {
    mockListTargets.mockRejectedValue(new Error('db error'));
    render(<TargetsPage />);
    await waitFor(() =>
      expect(screen.getByText('Failed to load targets.')).toBeInTheDocument(),
    );
  });

  it('8. target count appears in the table footer', async () => {
    render(<TargetsPage />);
    // Default tab is Planner; both NGC 7000 and M 31 are allowed catalogs.
    await waitFor(() => expect(screen.getByText('2 targets')).toBeInTheDocument());
  });

  // ── P: My Targets vs Planner filter (task #40, task #91) ────────────────────

  it('P1. "All targets" (default) filters to allowed planner catalogs', async () => {
    mockListTargets.mockResolvedValue(ok([
      ...listItems,
      // double-star dump entries that must NOT show in the Planner
      { id: 'hd1', effectiveLabel: 'HD 1', primaryDesignation: 'HD 1', objectType: 'double_star' },
      { id: 'wds1', effectiveLabel: 'WDS J1', primaryDesignation: 'WDS J00057+4549', objectType: 'double_star' },
    ]));
    render(<TargetsPage />);
    await waitFor(() => expect(screen.getByText('NGC 7000')).toBeInTheDocument());

    expect(screen.getByText('M 31')).toBeInTheDocument();
    expect(screen.queryByText('HD 1')).not.toBeInTheDocument();
    expect(screen.queryByText('WDS J1')).not.toBeInTheDocument();
    // footer counts only the catalog targets
    expect(screen.getByText('2 targets')).toBeInTheDocument();
  });

  it('P2. selecting "My Targets" shows a STUB empty state (no backend linkage)', async () => {
    render(<TargetsPage />);
    await waitFor(() => screen.getByText('NGC 7000'));

    // The "Show" select is the My Targets filter; select the 'my' option.
    const showSelect = screen.getByRole('combobox', { name: 'Show' });
    fireEvent.change(showSelect, { target: { value: 'my' } });

    // task #18: new empty message when no favourites are starred
    expect(screen.getByText(/No favourites yet/i)).toBeInTheDocument();
    // Planner-only catalog items are gone from the list
    expect(screen.queryByText('NGC 7000')).not.toBeInTheDocument();
  });

  // ── H: Toolbar search filters ────────────────────────────────────────────────

  it('H1. search input filters by primaryDesignation', async () => {
    render(<TargetsPage />);
    await waitFor(() => screen.getByText('NGC 7000'));

    const searchInput = screen.getByPlaceholderText('Search targets...');
    fireEvent.change(searchInput, { target: { value: 'NGC' } });

    expect(screen.getByText('NGC 7000')).toBeInTheDocument();
    expect(screen.queryByText('M 31')).not.toBeInTheDocument();
  });

  it('H2. search input filters by effectiveLabel (case-insensitive)', async () => {
    render(<TargetsPage />);
    await waitFor(() => screen.getByText('M 31'));

    const searchInput = screen.getByPlaceholderText('Search targets...');
    fireEvent.change(searchInput, { target: { value: 'm 31' } });

    expect(screen.getByText('M 31')).toBeInTheDocument();
    expect(screen.queryByText('NGC 7000')).not.toBeInTheDocument();
  });

  it('H3. clearing search restores the full list', async () => {
    render(<TargetsPage />);
    await waitFor(() => screen.getByText('NGC 7000'));

    const searchInput = screen.getByPlaceholderText('Search targets...');
    fireEvent.change(searchInput, { target: { value: 'NGC' } });
    expect(screen.queryByText('M 31')).not.toBeInTheDocument();

    fireEvent.change(searchInput, { target: { value: '' } });
    expect(screen.getByText('NGC 7000')).toBeInTheDocument();
    expect(screen.getByText('M 31')).toBeInTheDocument();
  });

  it('H4. search "M31" matches "M 31" (alias-aware whitespace normalization)', async () => {
    render(<TargetsPage />);
    await waitFor(() => screen.getByText('M 31'));

    const searchInput = screen.getByPlaceholderText('Search targets...');
    fireEvent.change(searchInput, { target: { value: 'M31' } });

    expect(screen.getByText('M 31')).toBeInTheDocument();
    expect(screen.queryByText('NGC 7000')).not.toBeInTheDocument();
  });

  it('H5. search "m31" matches "M 31" (case + whitespace insensitive)', async () => {
    render(<TargetsPage />);
    await waitFor(() => screen.getByText('M 31'));

    const searchInput = screen.getByPlaceholderText('Search targets...');
    fireEvent.change(searchInput, { target: { value: 'm31' } });

    expect(screen.getByText('M 31')).toBeInTheDocument();
    expect(screen.queryByText('NGC 7000')).not.toBeInTheDocument();
  });

  // ── MT: My Targets filter (#91) ──────────────────────────────────────────────

  it('MT1. My Targets filter toggles between full catalog and stub empty state', async () => {
    render(<TargetsPage />);
    await waitFor(() => screen.getByText('NGC 7000'));

    const showSelect = screen.getByRole('combobox', { name: 'Show' });

    // Default: "All targets" (empty value) — catalog rows visible.
    expect(screen.getByText('NGC 7000')).toBeInTheDocument();

    // Switch to My Targets — stub empty state (task #18: favourites not yet starred).
    fireEvent.change(showSelect, { target: { value: 'my' } });
    expect(screen.queryByText('NGC 7000')).not.toBeInTheDocument();
    expect(screen.getByText(/No favourites yet/i)).toBeInTheDocument();

    // Switch back to All — catalog rows return.
    fireEvent.change(showSelect, { target: { value: '' } });
    await waitFor(() => expect(screen.getByText('NGC 7000')).toBeInTheDocument());
  });

  // ── G: Add target button ───────────────────────────────────────────────────

  it('G1. "Add target" button opens the add dialog', async () => {
    render(<TargetsPage />);
    await waitFor(() => screen.getByText('NGC 7000'));

    const addBtn = screen.getByRole('button', { name: /Add target/i });
    fireEvent.click(addBtn);

    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /Add target/i })).toBeInTheDocument(),
    );
  });

  // ── S: Sortable column headers ───────────────────────────────────────────────

  it('S1. clicking a column header sorts the table rows', async () => {
    render(<TargetsPage />);
    await waitFor(() => screen.getByText('NGC 7000'));

    const table = screen.getByRole('table');
    const designationHeader = screen.getByRole('button', { name: 'Sort by Designation' });

    // Default sort is designation asc → "M 31" before "NGC 7000".
    let rowText = within(table).getAllByText(/NGC 7000|M 31/);
    expect(rowText[0]).toHaveTextContent('M 31');

    // Toggle to desc → "NGC 7000" first.
    fireEvent.click(designationHeader);
    rowText = within(table).getAllByText(/NGC 7000|M 31/);
    expect(rowText[0]).toHaveTextContent('NGC 7000');
  });

  // ── Site gate (spec 047 D7) ───────────────────────────────────────────────

  it('SG1. shows the observing-site prompt when no site exists (gated off)', async () => {
    __setSiteExistsForTest(false);
    render(<TargetsPage />);
    await waitFor(() => screen.getByText('NGC 7000'));
    // The planner bar shows the set-up-site prompt, not the Moon summary.
    expect(screen.getByTestId('planner-site-prompt')).toBeInTheDocument();
    expect(screen.queryByTestId('moon-summary')).not.toBeInTheDocument();
    expect(screen.getByText('Set up your observing site')).toBeInTheDocument();
  });

  it('SG2. renders the Moon summary when a site exists (gate open)', async () => {
    __setSiteExistsForTest(true);
    render(<TargetsPage />);
    await waitFor(() => screen.getByText('NGC 7000'));
    // Astronomy renders: the Moon summary is present, the prompt is gone.
    expect(screen.getByTestId('moon-summary')).toBeInTheDocument();
    expect(screen.queryByTestId('planner-site-prompt')).not.toBeInTheDocument();
  });

  // ── Filter-by-recommendation (spec 047 US3, FR-011) ──────────────────────────

  it('FR1. filtering to "Unknown" keeps only targets without coordinates', async () => {
    __setSiteExistsForTest(true);
    // NGC 7000 gets real coordinates; M 31 has none — its recommendation is
    // deterministically 'unknown' regardless of tonight's real Moon state.
    mockListTargets.mockResolvedValue(
      ok([
        { ...listItems[0], raDeg: 314.75, decDeg: 44.37 },
        { ...listItems[1], raDeg: null, decDeg: null },
      ]),
    );
    render(<TargetsPage />);
    await waitFor(() => screen.getByText('NGC 7000'));

    fireEvent.click(screen.getByLabelText('Unknown'));

    await waitFor(() => {
      expect(screen.queryByText('NGC 7000')).not.toBeInTheDocument();
      expect(screen.getByText('M 31')).toBeInTheDocument();
    });
  });

  it('FR2. deselecting the recommendation filter restores the full list', async () => {
    __setSiteExistsForTest(true);
    mockListTargets.mockResolvedValue(
      ok([
        { ...listItems[0], raDeg: 314.75, decDeg: 44.37 },
        { ...listItems[1], raDeg: null, decDeg: null },
      ]),
    );
    render(<TargetsPage />);
    await waitFor(() => screen.getByText('NGC 7000'));

    const unknownCheckbox = screen.getByLabelText('Unknown');
    fireEvent.click(unknownCheckbox);
    await waitFor(() => expect(screen.queryByText('NGC 7000')).not.toBeInTheDocument());

    fireEvent.click(unknownCheckbox);
    await waitFor(() => {
      expect(screen.getByText('NGC 7000')).toBeInTheDocument();
      expect(screen.getByText('M 31')).toBeInTheDocument();
    });
  });
});
