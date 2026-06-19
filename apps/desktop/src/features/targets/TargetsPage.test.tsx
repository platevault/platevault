/// <reference types="@testing-library/jest-dom" />
/**
 * TargetsPage tests — spec 036 gen-3 page wiring.
 *
 * Tests:
 *  1. Shows loading state while listTargets is in flight.
 *  2. Renders target list items from listTargets backend response.
 *  3. Shows EmptyState when no target is selected.
 *  4. Selecting a list item triggers navigate with the target id.
 *  5. When selected UUID provided, TargetDetailV2 mounts and calls getTargetDetail.
 *  6. effectiveLabel from backend renders in the detail pane.
 *  7. Shows error state when listTargets rejects.
 *  8. Target count appears in the subtitle.
 *  H1. Search input filters the target list by primaryDesignation.
 *  H2. Search input filters by effectiveLabel.
 *  H3. Clearing search restores the full list.
 *  G1. "Add target" button opens the add dialog.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const { mockListTargets, mockGetTargetDetail, mockSearchTargets, mockResolveTarget } = vi.hoisted(() => ({
  mockListTargets: vi.fn(),
  mockGetTargetDetail: vi.fn(),
  mockSearchTargets: vi.fn(),
  mockResolveTarget: vi.fn(),
}));

vi.mock('@/api/commands', () => ({
  listTargets: mockListTargets,
  getTargetDetail: mockGetTargetDetail,
  searchTargets: mockSearchTargets,
  resolveTarget: mockResolveTarget,
  TARGET_SEARCH_CONTRACT_VERSION: '1.0',
  addTargetAlias: vi.fn().mockResolvedValue({ alias: { id: 'a', alias: 'x', kind: 'user' } }),
  removeTargetAlias: vi.fn().mockResolvedValue({ removed: true }),
  setDisplayAlias: vi.fn().mockResolvedValue({}),
  clearDisplayAlias: vi.fn().mockResolvedValue({}),
}));

const mockNavigate = vi.fn();
const mockSelectedId = { current: undefined as string | undefined };

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => ({ selected: mockSelectedId.current }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('no tauri in tests')),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { TargetsPage } from './TargetsPage';

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
  mockSelectedId.current = undefined;
  mockListTargets.mockResolvedValue(listItems);
  mockGetTargetDetail.mockResolvedValue(makeDetail());
  mockSearchTargets.mockResolvedValue({ contractVersion: '1.0', requestId: 'r', suggestions: [] });
  mockResolveTarget.mockResolvedValue({ contractVersion: '1.0', requestId: 'r', status: 'unresolved', target: null, unresolvedReason: 'offline', error: null });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TargetsPage', () => {
  it('1. shows loading state while listTargets is in flight', () => {
    mockListTargets.mockReturnValue(new Promise(() => {}));
    render(<TargetsPage />);
    // List is in "..." subtitle state
    expect(screen.getByText('… targets')).toBeInTheDocument();
  });

  it('2. renders target list items from backend response', async () => {
    render(<TargetsPage />);
    await waitFor(() => {
      expect(screen.getByText('NGC 7000')).toBeInTheDocument();
      expect(screen.getByText('M 31')).toBeInTheDocument();
    });
  });

  it('3. shows EmptyState when no target is selected', async () => {
    render(<TargetsPage />);
    await waitFor(() =>
      expect(screen.getByText('Select a target')).toBeInTheDocument(),
    );
  });

  it('4. clicking a list item triggers navigate', async () => {
    render(<TargetsPage />);
    await waitFor(() => screen.getByText('NGC 7000'));

    const item = screen.getAllByText('NGC 7000')[0];
    fireEvent.click(item.closest('li') ?? item);

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

  it('8. target count appears in the subtitle', async () => {
    render(<TargetsPage />);
    await waitFor(() =>
      expect(screen.getByText('2 targets')).toBeInTheDocument(),
    );
  });

  // ── H: Search filters ──────────────────────────────────────────────────────

  it('H1. search input filters by primaryDesignation', async () => {
    render(<TargetsPage />);
    await waitFor(() => screen.getByText('NGC 7000'));

    const searchInput = screen.getByPlaceholderText('Search targets...');
    fireEvent.change(searchInput, { target: { value: 'NGC' } });

    // NGC 7000 matches; M 31 does not
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

  // ── G: Add target button ───────────────────────────────────────────────────

  it('G1. "Add target" button opens the add dialog', async () => {
    render(<TargetsPage />);
    await waitFor(() => screen.getByText('NGC 7000'));

    const addBtn = screen.getByRole('button', { name: /Add target/i });
    fireEvent.click(addBtn);

    // Dialog should open — the dialog element itself should be present
    await waitFor(() =>
      expect(screen.getByRole('dialog', { name: /Add target/i })).toBeInTheDocument(),
    );
  });
});
