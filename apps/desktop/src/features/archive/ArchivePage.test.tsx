/// <reference types="@testing-library/jest-dom" />
/**
 * ArchivePage smoke tests — spec 017 WP-B P3 (real backend wiring).
 *
 * The old ARCHIVE_DATA fixture is gone; the page now reads via
 * `useArchiveList()` / `useArchiveAudit()` (TanStack Query hooks over
 * `archive.list` / `audit.list`) and drives `archive.send_to_trash` /
 * `archive.permanently_delete` through `useSendToTrash()` /
 * `usePermanentlyDelete()`. This test mocks the store module directly
 * (matching the EditProjectPane.test.tsx convention) so no QueryClientProvider
 * or IPC fixtures are needed.
 *
 * Tests:
 * 1. Loading state renders a loading indicator in the list.
 * 2. Error state renders an error indicator in the list.
 * 3. Empty state renders when there are no archived projects.
 * 4. Renders entries and selecting one shows the detail pane.
 * 5. Management buttons are disabled when archivedViaPlanId is null.
 * 6. Send to trash calls the mutation with the plan id.
 * 7. Delete permanently opens a confirm modal; the confirm button stays
 *    disabled until "DELETE" is typed, then calls the mutation.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ArchiveEntry } from '@/bindings/index';

const { mockSendToTrash, mockPermanentlyDelete } = vi.hoisted(() => ({
  mockSendToTrash: vi.fn(),
  mockPermanentlyDelete: vi.fn(),
}));

const archiveListState: { data: ArchiveEntry[] | undefined; loading: boolean; error: Error | undefined } = {
  data: [],
  loading: false,
  error: undefined,
};

vi.mock('./store', () => ({
  useArchiveList: () => archiveListState,
  useArchiveAudit: () => ({ data: [], loading: false, error: undefined }),
  useSendToTrash: () => ({ mutate: mockSendToTrash, isPending: false }),
  usePermanentlyDelete: () => ({ mutate: mockPermanentlyDelete, isPending: false }),
}));

const mockNavigate = vi.fn();
const mockSelectedId = { current: undefined as string | undefined };

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => ({ selected: mockSelectedId.current }),
}));

import { ArchivePage } from './ArchivePage';

function makeEntry(overrides: Partial<ArchiveEntry> & { id: string }): ArchiveEntry {
  return {
    name: 'NGC 7000 · HOO (v1)',
    entityType: 'project',
    archivedAt: '2024-12-18',
    reason: 'Superseded by reprocess',
    originalPath: 'D:/Astro/Projects/NGC7000_HOO_v1',
    sizeBytes: 12_400_000_000,
    archivedViaPlanId: 'plan-001',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSelectedId.current = undefined;
  archiveListState.data = [];
  archiveListState.loading = false;
  archiveListState.error = undefined;
});

describe('ArchivePage (spec 017 WP-B)', () => {
  it('1. loading state renders a loading indicator', () => {
    archiveListState.loading = true;
    render(<ArchivePage />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('2. error state renders an error indicator', () => {
    archiveListState.error = new Error('db down');
    render(<ArchivePage />);
    expect(screen.getByText('Could not load archived items.')).toBeInTheDocument();
  });

  it('3. empty state renders when there are no archived projects', () => {
    render(<ArchivePage />);
    expect(screen.getByText('No archived projects yet')).toBeInTheDocument();
  });

  it('4. renders entries and selecting one shows the detail pane', () => {
    archiveListState.data = [makeEntry({ id: 'proj-1', name: 'NGC 7000 · HOO (v1)' })];
    render(<ArchivePage />);
    fireEvent.click(screen.getByText('NGC 7000 · HOO (v1)'));
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('5. management buttons are disabled when archivedViaPlanId is null', () => {
    archiveListState.data = [makeEntry({ id: 'proj-1', archivedViaPlanId: null })];
    mockSelectedId.current = 'proj-1';
    render(<ArchivePage />);
    expect(screen.getByText('Send to trash').closest('button')).toBeDisabled();
    expect(screen.getByText('Delete permanently').closest('button')).toBeDisabled();
  });

  it('6. send to trash calls the mutation with the plan id', () => {
    archiveListState.data = [makeEntry({ id: 'proj-1', archivedViaPlanId: 'plan-001' })];
    mockSelectedId.current = 'proj-1';
    render(<ArchivePage />);
    fireEvent.click(screen.getByText('Send to trash'));
    expect(mockSendToTrash).toHaveBeenCalledWith('plan-001');
  });

  it('7. delete permanently gates on typing DELETE, then calls the mutation', async () => {
    archiveListState.data = [makeEntry({ id: 'proj-1', archivedViaPlanId: 'plan-001' })];
    mockSelectedId.current = 'proj-1';
    render(<ArchivePage />);

    fireEvent.click(screen.getByText('Delete permanently'));
    const nodes = await screen.findAllByText('Delete permanently');
    const confirmBtn = nodes[nodes.length - 1].closest('button');
    expect(confirmBtn).not.toBeNull();
    expect(confirmBtn).toBeDisabled();

    const input = screen.getByLabelText('Type DELETE to confirm');
    fireEvent.change(input, { target: { value: 'DELETE' } });
    await waitFor(() => expect(confirmBtn).not.toBeDisabled());

    fireEvent.click(confirmBtn as HTMLButtonElement);
    expect(mockPermanentlyDelete).toHaveBeenCalledWith(
      'plan-001',
      expect.objectContaining({ onSuccess: expect.any(Function) }),
    );
  });
});
