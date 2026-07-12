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
 *
 * Spec 043 single-column alignment (8–13): ONE search box (no sidebar
 * duplicate), full-width sortable table with per-row testids + th aria-sort,
 * wired search filtering, detail docked only on selection, and the Reveal
 * stub disabled instead of the old enabled no-op button.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ArchiveEntry } from '@/bindings/index';

const { mockSendToTrash, mockPermanentlyDelete } = vi.hoisted(() => ({
  mockSendToTrash: vi.fn(),
  mockPermanentlyDelete: vi.fn(),
}));

const archiveListState: {
  data: ArchiveEntry[] | undefined;
  loading: boolean;
  error: Error | undefined;
} = {
  data: [],
  loading: false,
  error: undefined,
};

vi.mock('./store', () => ({
  useArchiveList: () => archiveListState,
  useArchiveAudit: () => ({ data: [], loading: false, error: undefined }),
  useSendToTrash: () => ({ mutate: mockSendToTrash, isPending: false }),
  usePermanentlyDelete: () => ({
    mutate: mockPermanentlyDelete,
    isPending: false,
  }),
}));

const mockNavigate = vi.fn();
const mockSelectedId = { current: undefined as string | undefined };

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  useSearch: () => ({ selected: mockSelectedId.current }),
}));

import { ArchivePage } from './ArchivePage';

function makeEntry(
  overrides: Partial<ArchiveEntry> & { id: string },
): ArchiveEntry {
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
    expect(
      screen.getByText('Could not load archived items.'),
    ).toBeInTheDocument();
  });

  it('3. empty state renders when there are no archived projects', () => {
    render(<ArchivePage />);
    expect(screen.getByText('No archived projects yet')).toBeInTheDocument();
  });

  it('4. renders entries and selecting one shows the detail pane', () => {
    archiveListState.data = [
      makeEntry({ id: 'proj-1', name: 'NGC 7000 · HOO (v1)' }),
    ];
    render(<ArchivePage />);
    fireEvent.click(screen.getByText('NGC 7000 · HOO (v1)'));
    expect(mockNavigate).toHaveBeenCalled();
  });

  it('5. management buttons are disabled when archivedViaPlanId is null', () => {
    archiveListState.data = [
      makeEntry({ id: 'proj-1', archivedViaPlanId: null }),
    ];
    mockSelectedId.current = 'proj-1';
    render(<ArchivePage />);
    expect(screen.getByText('Send to trash').closest('button')).toBeDisabled();
    expect(
      screen.getByText('Delete permanently').closest('button'),
    ).toBeDisabled();
  });

  it('6. send to trash calls the mutation with the plan id', () => {
    archiveListState.data = [
      makeEntry({ id: 'proj-1', archivedViaPlanId: 'plan-001' }),
    ];
    mockSelectedId.current = 'proj-1';
    render(<ArchivePage />);
    fireEvent.click(screen.getByText('Send to trash'));
    expect(mockSendToTrash).toHaveBeenCalledWith('plan-001');
  });

  it('7. delete permanently gates on typing DELETE, then calls the mutation', async () => {
    archiveListState.data = [
      makeEntry({ id: 'proj-1', archivedViaPlanId: 'plan-001' }),
    ];
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

describe('ArchivePage — spec 043 single-column layout', () => {
  it('8. exactly one search box (the top-bar FilterToolbar; no sidebar duplicate)', () => {
    archiveListState.data = [makeEntry({ id: 'proj-1' })];
    render(<ArchivePage />);
    expect(screen.getAllByRole('searchbox')).toHaveLength(1);
  });

  it('9. rows carry archive-row-<id> testids in the full-width table', () => {
    archiveListState.data = [
      makeEntry({ id: 'proj-1' }),
      makeEntry({ id: 'proj-2', name: 'M31 · LRGB' }),
    ];
    render(<ArchivePage />);
    expect(screen.getByTestId('archive-row-proj-1')).toBeInTheDocument();
    expect(screen.getByTestId('archive-row-proj-2')).toBeInTheDocument();
  });

  it('10. the active sort column th emits aria-sort (Archived desc by default)', () => {
    archiveListState.data = [makeEntry({ id: 'proj-1' })];
    const { container } = render(<ArchivePage />);
    const marked = container.querySelectorAll('th[aria-sort]');
    expect(marked).toHaveLength(1);
    expect(marked[0].getAttribute('aria-sort')).toBe('descending');
    expect(marked[0].textContent).toMatch(/Archived/);
  });

  it('11. the search box FILTERS the table rows', () => {
    archiveListState.data = [
      makeEntry({ id: 'proj-1', name: 'NGC 7000 · HOO (v1)' }),
      makeEntry({ id: 'proj-2', name: 'M31 · LRGB' }),
    ];
    render(<ArchivePage />);
    fireEvent.change(screen.getByRole('searchbox'), {
      target: { value: 'M31' },
    });
    expect(screen.queryByTestId('archive-row-proj-1')).toBeNull();
    expect(screen.getByTestId('archive-row-proj-2')).toBeInTheDocument();
  });

  it('12. the detail panel mounts ONLY when an entry is selected (no empty dashboard)', () => {
    archiveListState.data = [makeEntry({ id: 'proj-1' })];
    const { unmount } = render(<ArchivePage />);
    expect(screen.queryByText('Audit history')).toBeNull();
    unmount();

    mockSelectedId.current = 'proj-1';
    render(<ArchivePage />);
    expect(screen.getByText('Audit history')).toBeInTheDocument();
  });

  it('13. Reveal is a DISABLED stub with the platform-native label', () => {
    archiveListState.data = [makeEntry({ id: 'proj-1' })];
    mockSelectedId.current = 'proj-1';
    render(<ArchivePage />);
    const reveal = screen.getByTestId('archive-reveal-btn');
    expect(reveal).toBeDisabled();
    expect(reveal).toHaveAttribute('title');
    // jsdom reports no platform → the Linux-generic label.
    expect(reveal).toHaveTextContent('Show in file manager');
  });
});
