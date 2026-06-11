/// <reference types="@testing-library/jest-dom" />
/**
 * TargetDetailV2 component tests — spec 023 wired detail pane.
 *
 * Tests:
 *  1. Shows loading state while fetch is in flight.
 *  2. Renders primary designation on successful load.
 *  3. Renders alias chips from the response.
 *  4. Renders catalog ref chips.
 *  5. Renders notes textarea populated with existing note.
 *  6. Notes textarea is editable (change fires onChange).
 *  7. Alias add button calls addTargetAlias with correct args.
 *  8. Alias add Enter keydown triggers addTargetAlias.
 *  9. Alias remove (×) button calls removeTargetAlias with correct alias.
 * 10. Make-primary (↑) button calls renameTargetPrimary with correct args.
 * 11. alias.duplicate error shows inline error message.
 * 12. alias.is_primary error shows inline error message.
 * 13. designation.not_in_aliases error shows inline error message.
 * 14. Shows error state when getTargetIdentity rejects.
 * 15. Shows sessions empty-state when sessions array is empty.
 * 16. Shows projects empty-state when projects array is empty.
 * 17. Reloads detail after successful alias add (re-calls getTargetIdentity).
 * 18. Reloads detail after successful alias remove.
 * 19. Reloads detail after successful primary rename.
 */

import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const {
  mockGetTargetIdentity,
  mockUpdateTargetNote,
  mockAddTargetAlias,
  mockRemoveTargetAlias,
  mockRenameTargetPrimary,
} = vi.hoisted(() => ({
  mockGetTargetIdentity: vi.fn(),
  mockUpdateTargetNote: vi.fn(),
  mockAddTargetAlias: vi.fn(),
  mockRemoveTargetAlias: vi.fn(),
  mockRenameTargetPrimary: vi.fn(),
}));

vi.mock('@/api/commands', () => ({
  getTargetIdentity: mockGetTargetIdentity,
  updateTargetNote: mockUpdateTargetNote,
  addTargetAlias: mockAddTargetAlias,
  removeTargetAlias: mockRemoveTargetAlias,
  renameTargetPrimary: mockRenameTargetPrimary,
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockRejectedValue(new Error('no tauri in tests')),
}));

// ── Import under test (after mocks) ──────────────────────────────────────────

import { TargetDetailV2 } from './TargetDetailV2';

// ── Fixtures ──────────────────────────────────────────────────────────────────

const TARGET_ID = '550e8400-e29b-41d4-a716-446655440201';

const makeResult = (overrides?: {
  aliases?: string[];
  notes?: string | null;
  catalogRefs?: Array<{ catalogId: string; catalogDisplay: string; designation: string }>;
}) => ({
  target: {
    id: TARGET_ID,
    primaryDesignation: 'NGC 7000',
    aliases: overrides?.aliases ?? ['North America Nebula', 'Caldwell 20'],
    catalogRefs: overrides?.catalogRefs ?? [
      { catalogId: 'openngc', catalogDisplay: 'OpenNGC', designation: 'NGC 7000' },
    ],
    notes: overrides?.notes !== undefined ? overrides.notes : 'Some observing note',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
  },
  sessions: [],
  projects: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTargetIdentity.mockResolvedValue(makeResult());
  mockUpdateTargetNote.mockResolvedValue({ targetId: TARGET_ID, updatedAt: '2026-06-11T00:00:00Z' });
  mockAddTargetAlias.mockResolvedValue({ targetId: TARGET_ID, added: true });
  mockRemoveTargetAlias.mockResolvedValue({
    targetId: TARGET_ID,
    removedAlias: 'north america nebula',
    auditId: 'audit-001',
  });
  mockRenameTargetPrimary.mockResolvedValue({
    targetId: TARGET_ID,
    priorPrimary: 'NGC 7000',
    newPrimary: 'North America Nebula',
    auditId: 'audit-002',
  });
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TargetDetailV2', () => {
  it('1. shows loading state while fetch is in flight', () => {
    // Never resolve to keep it in loading state
    mockGetTargetIdentity.mockReturnValue(new Promise(() => {}));
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('2. renders primary designation on successful load', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => expect(screen.getByText('NGC 7000')).toBeInTheDocument());
  });

  it('3. renders alias chips from the response', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => {
      expect(screen.getByText('North America Nebula')).toBeInTheDocument();
      expect(screen.getByText('Caldwell 20')).toBeInTheDocument();
    });
  });

  it('4. renders catalog ref chips', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => {
      expect(screen.getByText('OpenNGC: NGC 7000')).toBeInTheDocument();
    });
  });

  it('5. notes textarea is populated with existing note', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => {
      const textarea = screen.getByRole('textbox', { name: /target notes/i });
      expect(textarea).toHaveValue('Some observing note');
    });
  });

  it('6. notes textarea is editable', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByRole('textbox', { name: /target notes/i }));
    const textarea = screen.getByRole('textbox', { name: /target notes/i });
    fireEvent.change(textarea, { target: { value: 'Updated note text' } });
    expect(textarea).toHaveValue('Updated note text');
  });

  it('7. alias add button calls addTargetAlias with correct args', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByRole('textbox', { name: /new alias/i }));

    fireEvent.change(screen.getByRole('textbox', { name: /new alias/i }), {
      target: { value: 'Pelican Nebula Neighbor' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() =>
      expect(mockAddTargetAlias).toHaveBeenCalledWith({
        targetId: TARGET_ID,
        alias: 'Pelican Nebula Neighbor',
      }),
    );
  });

  it('8. alias add Enter keydown triggers addTargetAlias', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByRole('textbox', { name: /new alias/i }));

    fireEvent.change(screen.getByRole('textbox', { name: /new alias/i }), {
      target: { value: 'Pelican Region' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: /new alias/i }), { key: 'Enter' });

    await waitFor(() =>
      expect(mockAddTargetAlias).toHaveBeenCalledWith({
        targetId: TARGET_ID,
        alias: 'Pelican Region',
      }),
    );
  });

  it('9. alias remove × button calls removeTargetAlias with correct alias', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByLabelText('Remove alias North America Nebula'));

    fireEvent.click(screen.getByLabelText('Remove alias North America Nebula'));

    await waitFor(() =>
      expect(mockRemoveTargetAlias).toHaveBeenCalledWith({
        targetId: TARGET_ID,
        alias: 'North America Nebula',
      }),
    );
  });

  it('10. make-primary ↑ button calls renameTargetPrimary with correct alias', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByLabelText('Make North America Nebula primary'));

    fireEvent.click(screen.getByLabelText('Make North America Nebula primary'));

    await waitFor(() =>
      expect(mockRenameTargetPrimary).toHaveBeenCalledWith({
        targetId: TARGET_ID,
        newPrimaryDesignation: 'North America Nebula',
      }),
    );
  });

  it('11. alias.duplicate error shows inline error message', async () => {
    mockAddTargetAlias.mockRejectedValueOnce({
      code: 'alias.duplicate',
      message: 'dup',
    });
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByRole('textbox', { name: /new alias/i }));

    fireEvent.change(screen.getByRole('textbox', { name: /new alias/i }), {
      target: { value: 'NGC 224' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() =>
      expect(
        screen.getByText('This alias is already used by a different target.'),
      ).toBeInTheDocument(),
    );
  });

  it('12. alias.is_primary error shows inline error message', async () => {
    mockRemoveTargetAlias.mockRejectedValueOnce({
      code: 'alias.is_primary',
      message: 'is primary',
    });
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByLabelText('Remove alias North America Nebula'));

    fireEvent.click(screen.getByLabelText('Remove alias North America Nebula'));

    await waitFor(() =>
      expect(
        screen.getByText('Cannot remove the primary name. Rename primary first.'),
      ).toBeInTheDocument(),
    );
  });

  it('13. designation.not_in_aliases error shows inline error message', async () => {
    mockRenameTargetPrimary.mockRejectedValueOnce({
      code: 'designation.not_in_aliases',
      message: 'not in aliases',
    });
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByLabelText('Make North America Nebula primary'));

    fireEvent.click(screen.getByLabelText('Make North America Nebula primary'));

    await waitFor(() =>
      expect(
        screen.getByText('New primary must already be an alias. Add it first.'),
      ).toBeInTheDocument(),
    );
  });

  it('14. shows error state when getTargetIdentity rejects', async () => {
    mockGetTargetIdentity.mockRejectedValueOnce(new Error('network error'));
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() =>
      expect(screen.getByText('Failed to load target.')).toBeInTheDocument(),
    );
  });

  it('15. shows sessions empty-state when sessions array is empty', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() =>
      expect(screen.getByText('No sessions linked')).toBeInTheDocument(),
    );
  });

  it('16. shows projects empty-state when projects array is empty', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() =>
      expect(screen.getByText('No projects linked')).toBeInTheDocument(),
    );
  });

  it('17. reloads detail after successful alias add', async () => {
    // After add, getTargetIdentity is called again with updated data
    const updated = makeResult({ aliases: ['North America Nebula', 'Caldwell 20', 'New Alias'] });
    mockGetTargetIdentity
      .mockResolvedValueOnce(makeResult())
      .mockResolvedValueOnce(updated);

    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByRole('textbox', { name: /new alias/i }));

    fireEvent.change(screen.getByRole('textbox', { name: /new alias/i }), {
      target: { value: 'New Alias' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(mockGetTargetIdentity).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('New Alias')).toBeInTheDocument());
  });

  it('18. reloads detail after successful alias remove', async () => {
    const updated = makeResult({ aliases: ['Caldwell 20'] });
    mockGetTargetIdentity
      .mockResolvedValueOnce(makeResult())
      .mockResolvedValueOnce(updated);

    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByLabelText('Remove alias North America Nebula'));

    fireEvent.click(screen.getByLabelText('Remove alias North America Nebula'));

    await waitFor(() => expect(mockGetTargetIdentity).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText('North America Nebula')).not.toBeInTheDocument(),
    );
  });

  it('19. reloads detail after successful primary rename', async () => {
    const updated = makeResult({
      aliases: ['NGC 7000'],
    });
    updated.target.primaryDesignation = 'North America Nebula';
    mockGetTargetIdentity
      .mockResolvedValueOnce(makeResult())
      .mockResolvedValueOnce(updated);

    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByLabelText('Make North America Nebula primary'));

    fireEvent.click(screen.getByLabelText('Make North America Nebula primary'));

    await waitFor(() => expect(mockGetTargetIdentity).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.getByText('North America Nebula')).toBeInTheDocument(),
    );
  });
});
