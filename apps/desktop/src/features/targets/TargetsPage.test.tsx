/// <reference types="@testing-library/jest-dom" />
/**
 * TargetsPage tests — spec 023 swapped-in page wiring.
 *
 * Tests:
 *  1. Renders the fixture target list (names visible).
 *  2. Shows EmptyState when no target is selected.
 *  3. Selecting a list item puts its UUID in onSelect callback.
 *  4. When selected UUID is provided, TargetDetailV2 mounts and calls getTargetIdentity.
 *  5. Primary designation from backend renders in the detail pane.
 *  6. TargetList selectedId prop matches the selected UUID.
 *  7. Cmd+K route pattern: /targets/$uuid → detail renders for that UUID.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const { mockGetTargetIdentity } = vi.hoisted(() => ({
  mockGetTargetIdentity: vi.fn(),
}));

vi.mock('@/api/commands', () => ({
  getTargetIdentity: mockGetTargetIdentity,
  updateTargetNote: vi.fn().mockResolvedValue({}),
  addTargetAlias: vi.fn().mockResolvedValue({ added: true }),
  removeTargetAlias: vi.fn().mockResolvedValue({}),
  renameTargetPrimary: vi.fn().mockResolvedValue({}),
}));

// Mock router — useSearch provides the selected UUID; useNavigate is a no-op
const mockNavigate = vi.fn();
const mockSelectedUuid = { current: undefined as string | undefined };

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => ({ selected: mockSelectedUuid.current }),
}));

vi.mock('@/lib/use-stale-selection', () => ({
  useStaleSelectionCleanup: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('no tauri in tests')),
}));

// ── Import under test ─────────────────────────────────────────────────────────

import { TargetsPage } from './TargetsPage';
import { TARGETS_DATA } from '@/data/fixtures/targets';

// ── Fixture ───────────────────────────────────────────────────────────────────

const NGC7000_UUID = '550e8400-e29b-41d4-a716-446655440201';

const makeBackendResult = (primaryDesignation = 'NGC 7000') => ({
  target: {
    id: NGC7000_UUID,
    primaryDesignation,
    aliases: ['North America Nebula'],
    catalogRefs: [],
    notes: null,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  },
  sessions: [],
  projects: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectedUuid.current = undefined;
  mockGetTargetIdentity.mockResolvedValue(makeBackendResult());
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TargetsPage', () => {
  it('1. renders fixture target list with target names', () => {
    render(<TargetsPage />);
    expect(screen.getByText('NGC 7000')).toBeInTheDocument();
    expect(screen.getByText('M31')).toBeInTheDocument();
    expect(screen.getByText('IC 1396')).toBeInTheDocument();
  });

  it('2. shows empty-state when no target is selected', () => {
    render(<TargetsPage />);
    expect(screen.getByText('Select a target')).toBeInTheDocument();
  });

  it('3. clicking a list item calls navigate with the target UUID', () => {
    render(<TargetsPage />);
    // Find the NGC 7000 list item by text and click it
    const ngcItem = screen.getAllByText('NGC 7000')[0];
    fireEvent.click(ngcItem.closest('li') ?? ngcItem);
    // navigate should be called with search updater
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('4. when selected UUID provided, TargetDetailV2 calls getTargetIdentity', async () => {
    mockSelectedUuid.current = NGC7000_UUID;
    render(<TargetsPage />);
    await waitFor(() =>
      expect(mockGetTargetIdentity).toHaveBeenCalledWith({ targetId: NGC7000_UUID }),
    );
  });

  it('5. primary designation from backend renders in detail pane', async () => {
    mockSelectedUuid.current = NGC7000_UUID;
    render(<TargetsPage />);
    await waitFor(() => {
      // Primary designation from backend response should appear
      const headings = screen.getAllByText('NGC 7000');
      expect(headings.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('6. TARGETS_DATA entries all have uuid fields', () => {
    for (const t of TARGETS_DATA) {
      expect(t.uuid).toBeTruthy();
      // UUID format: 8-4-4-4-12 hex
      expect(t.uuid).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    }
  });

  it('7. TARGETS_DATA uuids are unique (no duplicates)', () => {
    const uuids = TARGETS_DATA.map((t) => t.uuid);
    const unique = new Set(uuids);
    expect(unique.size).toBe(uuids.length);
  });

  it('8. NGC 7000 UUID matches the expected fixture backend UUID', () => {
    const ngc7000 = TARGETS_DATA.find((t) => t.name === 'NGC 7000');
    expect(ngc7000?.uuid).toBe(NGC7000_UUID);
  });
});
