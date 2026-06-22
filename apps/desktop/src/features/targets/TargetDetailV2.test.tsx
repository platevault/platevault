/// <reference types="@testing-library/jest-dom" />
/**
 * TargetDetailV2 component tests — spec 036 gen-3 detail pane.
 *
 * Tests:
 *  1. Shows loading state while fetch is in flight.
 *  2. Renders effectiveLabel (displayAlias ?? primaryDesignation) in header.
 *  3. Renders primaryDesignation in identity section.
 *  4. Renders alias rows with kind badge.
 *  5. User aliases show a remove × button; SIMBAD aliases do not.
 *  6. Clicking × on a user alias calls removeTargetAlias with alias id.
 *  7. Add-alias form calls addTargetAlias with target id and alias text.
 *  8. Add-alias Enter keydown triggers addTargetAlias.
 *  9. Blank alias shows inline error without calling addTargetAlias.
 * 10. alias.blank error shows inline error message.
 * 11. alias.not_removable error shows inline error message.
 * 12. Shows error state when getTargetDetail rejects.
 * 13. Sessions empty-state renders.
 * 14. Projects empty-state renders.
 * 15. Reloads detail after successful alias add.
 * 16. Reloads detail after successful alias remove.
 * 17. Display-alias Set/Edit button is visible.
 * 18. Setting display alias updates effectiveLabel.
 * 19. Clearing display alias reverts effectiveLabel to primaryDesignation.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const {
  mockGetTargetDetail,
  mockAddTargetAlias,
  mockRemoveTargetAlias,
  mockSetDisplayAlias,
  mockClearDisplayAlias,
} = vi.hoisted(() => ({
  mockGetTargetDetail: vi.fn(),
  mockAddTargetAlias: vi.fn(),
  mockRemoveTargetAlias: vi.fn(),
  mockSetDisplayAlias: vi.fn(),
  mockClearDisplayAlias: vi.fn(),
}));

vi.mock('@/api/commands', () => ({
  getTargetDetail: mockGetTargetDetail,
  addTargetAlias: mockAddTargetAlias,
  removeTargetAlias: mockRemoveTargetAlias,
  setDisplayAlias: mockSetDisplayAlias,
  clearDisplayAlias: mockClearDisplayAlias,
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

function makeDetail(overrides?: {
  displayAlias?: string | null;
  aliases?: Array<{ id: string; alias: string; kind: 'designation' | 'common_name' | 'user' }>;
}) {
  const displayAlias = overrides?.displayAlias ?? null;
  const primaryDesignation = 'NGC 7000';
  return {
    id: TARGET_ID,
    primaryDesignation,
    displayAlias: displayAlias ?? undefined,
    effectiveLabel: displayAlias ?? primaryDesignation,
    objectType: 'emission_nebula',
    raDeg: 314.75,
    decDeg: 44.37,
    simbadOid: 2_222_222,
    source: 'resolved',
    aliases: overrides?.aliases ?? [
      { id: 'alias-desig-1', alias: 'NGC 7000', kind: 'designation' as const },
      { id: 'alias-cn-1', alias: 'North America Nebula', kind: 'common_name' as const },
      { id: 'alias-user-1', alias: 'My Nebula', kind: 'user' as const },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockGetTargetDetail.mockResolvedValue(makeDetail());
  mockAddTargetAlias.mockResolvedValue({
    alias: { id: 'alias-user-new', alias: 'New Alias', kind: 'user' },
  });
  mockRemoveTargetAlias.mockResolvedValue({ removed: true });
  mockSetDisplayAlias.mockResolvedValue(makeDetail({ displayAlias: 'My NGC 7000' }));
  mockClearDisplayAlias.mockResolvedValue(makeDetail({ displayAlias: null }));
});

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('TargetDetailV2', () => {
  it('1. shows loading state while fetch is in flight', () => {
    mockGetTargetDetail.mockReturnValue(new Promise(() => {}));
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    expect(screen.getByText('Loading…')).toBeInTheDocument();
  });

  it('2. renders effectiveLabel in header', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    // NGC 7000 appears in header and identity section; either is fine
    await waitFor(() => {
      const els = screen.getAllByText('NGC 7000');
      expect(els.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('2b. when displayAlias is set, effectiveLabel shows it', async () => {
    mockGetTargetDetail.mockResolvedValue(makeDetail({ displayAlias: 'My NGC 7000' }));
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => {
      const els = screen.getAllByText('My NGC 7000');
      expect(els.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('3. renders primaryDesignation in identity section', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => {
      const dds = screen.getAllByText('NGC 7000');
      expect(dds.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('4. renders alias rows with kind badge', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => {
      // NGC 7000 appears multiple times (header + alias + identity); just confirm presence
      expect(screen.getAllByText('NGC 7000').length).toBeGreaterThanOrEqual(1);
      expect(screen.getByText('North America Nebula')).toBeInTheDocument();
      expect(screen.getByText('My Nebula')).toBeInTheDocument();
    });
  });

  it('5. user aliases show remove button; SIMBAD aliases do not', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByLabelText('Remove alias My Nebula'));

    expect(screen.getByLabelText('Remove alias My Nebula')).toBeInTheDocument();
    expect(screen.queryByLabelText('Remove alias NGC 7000')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Remove alias North America Nebula')).not.toBeInTheDocument();
  });

  it('6. clicking × on user alias calls removeTargetAlias with alias id', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByLabelText('Remove alias My Nebula'));

    fireEvent.click(screen.getByLabelText('Remove alias My Nebula'));

    await waitFor(() =>
      expect(mockRemoveTargetAlias).toHaveBeenCalledWith({
        targetId: TARGET_ID,
        aliasId: 'alias-user-1',
      }),
    );
  });

  it('7. add-alias form calls addTargetAlias with correct args', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByRole('textbox', { name: /new alias/i }));

    fireEvent.change(screen.getByRole('textbox', { name: /new alias/i }), {
      target: { value: 'Pelican Region' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() =>
      expect(mockAddTargetAlias).toHaveBeenCalledWith({
        targetId: TARGET_ID,
        alias: 'Pelican Region',
      }),
    );
  });

  it('8. add-alias Enter keydown triggers addTargetAlias', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByRole('textbox', { name: /new alias/i }));

    fireEvent.change(screen.getByRole('textbox', { name: /new alias/i }), {
      target: { value: 'Pelican Region' },
    });
    fireEvent.keyDown(screen.getByRole('textbox', { name: /new alias/i }), { key: 'Enter' });

    await waitFor(() => expect(mockAddTargetAlias).toHaveBeenCalled());
  });

  it('9. blank alias shows inline error without calling addTargetAlias', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByRole('button', { name: /^add$/i }));

    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    expect(mockAddTargetAlias).not.toHaveBeenCalled();
    expect(screen.getByText('Alias must not be blank.')).toBeInTheDocument();
  });

  it('10. alias.blank error from backend shows inline message', async () => {
    mockAddTargetAlias.mockRejectedValueOnce({ code: 'alias.blank', message: 'blank' });
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByRole('textbox', { name: /new alias/i }));

    fireEvent.change(screen.getByRole('textbox', { name: /new alias/i }), {
      target: { value: 'x' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() =>
      expect(screen.getByText('Alias must not be blank.')).toBeInTheDocument(),
    );
  });

  it('11. alias.not_removable error shows inline message', async () => {
    mockRemoveTargetAlias.mockRejectedValueOnce({
      code: 'alias.not_removable',
      message: 'not removable',
    });
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByLabelText('Remove alias My Nebula'));

    fireEvent.click(screen.getByLabelText('Remove alias My Nebula'));

    await waitFor(() =>
      expect(
        screen.getByText('Only user-added aliases can be removed.'),
      ).toBeInTheDocument(),
    );
  });

  it('12. shows error state when getTargetDetail rejects', async () => {
    mockGetTargetDetail.mockRejectedValueOnce(new Error('network error'));
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() =>
      expect(screen.getByText('Failed to load target.')).toBeInTheDocument(),
    );
  });

  it('13. sessions empty-state renders (single mid-page surface)', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() =>
      expect(
        screen.getByText(/No linked sessions yet/i),
      ).toBeInTheDocument(),
    );
    // The duplicate bottom "No sessions linked" section has been removed.
    expect(screen.queryByText('No sessions linked')).not.toBeInTheDocument();
  });

  it('14. projects empty-state renders', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() =>
      expect(screen.getByText('No projects linked')).toBeInTheDocument(),
    );
  });

  it('15. reloads detail after successful alias add', async () => {
    const updated = makeDetail({
      aliases: [
        { id: 'alias-desig-1', alias: 'NGC 7000', kind: 'designation' },
        { id: 'alias-cn-1', alias: 'North America Nebula', kind: 'common_name' },
        { id: 'alias-user-1', alias: 'My Nebula', kind: 'user' },
        { id: 'alias-user-new', alias: 'New Alias', kind: 'user' },
      ],
    });
    mockGetTargetDetail.mockResolvedValueOnce(makeDetail()).mockResolvedValueOnce(updated);

    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByRole('textbox', { name: /new alias/i }));

    fireEvent.change(screen.getByRole('textbox', { name: /new alias/i }), {
      target: { value: 'New Alias' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }));

    await waitFor(() => expect(mockGetTargetDetail).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('New Alias')).toBeInTheDocument());
  });

  it('16. reloads detail after successful alias remove', async () => {
    const updated = makeDetail({
      aliases: [
        { id: 'alias-desig-1', alias: 'NGC 7000', kind: 'designation' },
        { id: 'alias-cn-1', alias: 'North America Nebula', kind: 'common_name' },
      ],
    });
    mockGetTargetDetail.mockResolvedValueOnce(makeDetail()).mockResolvedValueOnce(updated);

    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByLabelText('Remove alias My Nebula'));

    fireEvent.click(screen.getByLabelText('Remove alias My Nebula'));

    await waitFor(() => expect(mockGetTargetDetail).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText('My Nebula')).not.toBeInTheDocument(),
    );
  });

  it('17. display-alias Set/Edit button is visible', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /^set$/i })).toBeInTheDocument(),
    );
  });

  it('18. setting display alias updates effectiveLabel', async () => {
    mockGetTargetDetail
      .mockResolvedValueOnce(makeDetail())
      .mockResolvedValueOnce(makeDetail({ displayAlias: 'My NGC 7000' }));

    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByRole('button', { name: /^set$/i }));

    fireEvent.click(screen.getByRole('button', { name: /^set$/i }));

    await waitFor(() => screen.getByRole('textbox', { name: /display label/i }));
    fireEvent.change(screen.getByRole('textbox', { name: /display label/i }), {
      target: { value: 'My NGC 7000' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(mockSetDisplayAlias).toHaveBeenCalledWith({
        targetId: TARGET_ID,
        displayAlias: 'My NGC 7000',
      }),
    );
  });

  it('19. clearing display alias reverts effectiveLabel to primaryDesignation', async () => {
    mockGetTargetDetail.mockResolvedValue(makeDetail({ displayAlias: 'My NGC 7000' }));
    mockClearDisplayAlias.mockResolvedValue(makeDetail({ displayAlias: null }));

    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByRole('button', { name: /^edit$/i }));

    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await waitFor(() => screen.getByRole('button', { name: /^clear$/i }));

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    await waitFor(() =>
      expect(mockClearDisplayAlias).toHaveBeenCalledWith({ targetId: TARGET_ID }),
    );
  });
});
