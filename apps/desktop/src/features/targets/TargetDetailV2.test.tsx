/// <reference types="@testing-library/jest-dom" />
/**
 * TargetDetailV2 component tests — spec 036 gen-3 detail pane + spec 023 US2/US3/US4.
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
 * 13. Sessions empty-state renders when no linked sessions.
 * 14. Projects empty-state renders when no linked projects.
 * 15. Reloads detail after successful alias add.
 * 16. Reloads detail after successful alias remove.
 * 17. Display-alias Set/Edit button is visible.
 * 18. Setting display alias updates effectiveLabel.
 * 19. Clearing display alias reverts effectiveLabel to primaryDesignation.
 * 20. (US2) Linked sessions list renders date and frameCount.
 * 21. (US2) Clicking session row navigates to /sessions with selected=id.
 * 22. (US3) Linked projects list renders name and lifecycle.
 * 23. (US3) Clicking project row navigates to /projects with search: { selected: id }.
 * 24. (US4) Observing notes: empty state renders placeholder.
 * 25. (US4) Observing notes: existing notes body renders.
 * 26. (US4) Edit → save calls updateTargetNote and reflects result.
 * 27. (US4) Edit → cancel restores original notes.
 * 28. (US4) Save error shows banner message.
 */

import { configure, render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Windows-CI headroom (same flake class as PR #412's settings hydration races):
// every test in this file waits on content that only renders after mocked async
// hydration (detail/sessions/projects/notes effects). The waits are already
// deterministic — they target non-default, post-hydration content — but the
// RTL default asyncUtilTimeout (1s) and vitest default testTimeout (5s) are
// too tight for the very slow windows-latest runners (test 21 flaked there
// while identical siblings passed). Raise both file-wide instead of per-test
// so no sibling is left behind on tight defaults. Both settings are scoped to
// this file (vitest isolates test files; vi.setConfig is per-runtime).
configure({ asyncUtilTimeout: 10_000 });
vi.setConfig({ testTimeout: 15_000 });

// ── Hoist mocks ───────────────────────────────────────────────────────────────

const {
  mockGetTargetDetail,
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
  mockGetTargetDetail: vi.fn(),
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
    targetGet: mockGetTargetDetail,
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

const mockNavigate = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
  // Minimal stub: the no-site banner's "Add a site" link (spec 044 US3) just
  // needs to render as a link, not exercise real routing under test.
  Link: ({ children, to, ...rest }: { children?: import('react').ReactNode; to: string }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
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
  mockNavigate.mockResolvedValue(undefined);
  mockGetTargetDetail.mockResolvedValue(ok(makeDetail()));
  mockAddTargetAlias.mockResolvedValue(ok({
    alias: { id: 'alias-user-new', alias: 'New Alias', kind: 'user' },
  }));
  mockRemoveTargetAlias.mockResolvedValue(ok({ removed: true }));
  mockSetDisplayAlias.mockResolvedValue(ok(makeDetail({ displayAlias: 'My NGC 7000' })));
  mockClearDisplayAlias.mockResolvedValue(ok(makeDetail({ displayAlias: null })));
  // US2/US3/US4 defaults: empty lists, no notes.
  mockListTargetSessions.mockResolvedValue(ok([]));
  mockListTargetProjects.mockResolvedValue(ok([]));
  mockGetTargetNote.mockResolvedValue(ok({ notes: null }));
  mockUpdateTargetNote.mockResolvedValue(ok({ notes: null }));
  mockAstroFormatBatch.mockResolvedValue(
    ok({ formatted: [{ id: TARGET_ID, raSexagesimal: '20:59:00', decSexagesimal: '+44:22:12' }] }),
  );
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
    mockGetTargetDetail.mockResolvedValue(ok(makeDetail({ displayAlias: 'My NGC 7000' })));
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
    mockGetTargetDetail.mockResolvedValueOnce(ok(makeDetail())).mockResolvedValueOnce(ok(updated));

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
    mockGetTargetDetail.mockResolvedValueOnce(ok(makeDetail())).mockResolvedValueOnce(ok(updated));

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
      .mockResolvedValueOnce(ok(makeDetail()))
      .mockResolvedValueOnce(ok(makeDetail({ displayAlias: 'My NGC 7000' })));

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
    mockGetTargetDetail.mockResolvedValue(ok(makeDetail({ displayAlias: 'My NGC 7000' })));
    mockClearDisplayAlias.mockResolvedValue(ok(makeDetail({ displayAlias: null })));

    render(<TargetDetailV2 targetId={TARGET_ID} />);
    // Wait for at least one Edit button (display-alias + notes may both show Edit)
    await waitFor(() =>
      expect(screen.getAllByRole('button', { name: /^edit$/i }).length).toBeGreaterThanOrEqual(1),
    );

    // The display-alias Edit button is the first in DOM order
    fireEvent.click(screen.getAllByRole('button', { name: /^edit$/i })[0]);
    await waitFor(() => screen.getByRole('button', { name: /^clear$/i }));

    fireEvent.click(screen.getByRole('button', { name: /^clear$/i }));

    await waitFor(() =>
      expect(mockClearDisplayAlias).toHaveBeenCalledWith({ targetId: TARGET_ID }),
    );
  });

  // ── US2: Linked sessions ───────────────────────────────────────────────────

  it('20. (US2) sessions empty-state renders "No linked sessions yet."', async () => {
    mockListTargetSessions.mockResolvedValue(ok([]));
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() =>
      expect(screen.getByText(/No linked sessions yet/i)).toBeInTheDocument(),
    );
  });

  it('21. (US2) linked session rows render date and frameCount', async () => {
    mockListTargetSessions.mockResolvedValue(ok([
      {
        id: 'sess-1',
        sessionKey: '{}',
        createdAt: '2026-03-15T22:00:00Z',
        frameCount: 42,
      },
    ]));
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    // Slow-runner headroom now comes from the file-wide configure/setConfig
    // above (this test flaked on windows-latest while 22 below passed).
    await waitFor(() => expect(screen.getByText(/42 frames/i)).toBeInTheDocument());
  });

  it('22. (US2) clicking session row navigates to /sessions with selected=id', async () => {
    mockListTargetSessions.mockResolvedValue(ok([
      {
        id: 'sess-abc',
        sessionKey: '{}',
        createdAt: '2026-03-15T22:00:00Z',
        frameCount: 5,
      },
    ]));
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => expect(screen.getByText(/5 frames/i)).toBeInTheDocument());

    fireEvent.click(screen.getByText(/5 frames/i).closest('button')!);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/sessions',
        search: { selected: 'sess-abc' },
      }),
    );
  });

  // ── US3: Linked projects ───────────────────────────────────────────────────

  it('23. (US3) projects empty-state renders "No projects linked."', async () => {
    mockListTargetProjects.mockResolvedValue(ok([]));
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() =>
      expect(screen.getAllByText(/No projects linked/i).length).toBeGreaterThanOrEqual(1),
    );
  });

  it('24. (US3) linked project rows render name and lifecycle', async () => {
    mockListTargetProjects.mockResolvedValue(ok([
      { id: 'proj-1', name: 'Horsehead 2026', lifecycle: 'ready' },
    ]));
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() =>
      expect(screen.getAllByText('Horsehead 2026').length).toBeGreaterThanOrEqual(1),
    );
    expect(screen.getAllByText('ready').length).toBeGreaterThanOrEqual(1);
  });

  it('25. (US3) clicking project row navigates to /projects with selected=id (mid-page link row)', async () => {
    mockListTargetProjects.mockResolvedValue(ok([
      { id: 'proj-1', name: 'Horsehead 2026', lifecycle: 'ready' },
    ]));
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() =>
      expect(screen.getAllByText('Horsehead 2026').length).toBeGreaterThanOrEqual(1),
    );

    // Click the first project button (mid-page link row)
    fireEvent.click(screen.getAllByText('Horsehead 2026')[0].closest('button')!);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/projects',
        search: { selected: 'proj-1' },
      }),
    );
  });

  it('25b. (US3) clicking project row in bottom section navigates to /projects with selected=id', async () => {
    mockListTargetProjects.mockResolvedValue(ok([
      { id: 'proj-1', name: 'Horsehead 2026', lifecycle: 'ready' },
    ]));
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() =>
      expect(screen.getAllByText('Horsehead 2026').length).toBeGreaterThanOrEqual(1),
    );

    // Click the last project button (bottom Projects section)
    const btns = screen.getAllByText('Horsehead 2026').map((el) => el.closest('button')!);
    fireEvent.click(btns[btns.length - 1]);

    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith({
        to: '/projects',
        search: { selected: 'proj-1' },
      }),
    );
  });

  // ── US4: Observing notes ───────────────────────────────────────────────────

  it('26. (US4) notes empty placeholder renders when no notes', async () => {
    mockGetTargetNote.mockResolvedValue(ok({ notes: null }));
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId('target-notes-empty')).toBeInTheDocument(),
    );
    expect(screen.getByTestId('target-notes-empty')).toHaveTextContent('No notes yet.');
  });

  it('27. (US4) existing notes body renders', async () => {
    mockGetTargetNote.mockResolvedValue(ok({ notes: 'Great transparency last night.' }));
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() =>
      expect(screen.getByTestId('target-notes-body')).toHaveTextContent(
        'Great transparency last night.',
      ),
    );
  });

  it('28. (US4) edit → save calls updateTargetNote and reflects result', async () => {
    mockGetTargetNote.mockResolvedValue(ok({ notes: 'Old note' }));
    mockUpdateTargetNote.mockResolvedValue(ok({ notes: 'Updated note' }));
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByTestId('target-notes-body'));

    // Click Edit button (label reuses projects_detail_edit_btn = "Edit")
    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await waitFor(() => screen.getByTestId('target-notes-textarea'));

    fireEvent.change(screen.getByTestId('target-notes-textarea'), {
      target: { value: 'Updated note' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(mockUpdateTargetNote).toHaveBeenCalledWith({
        targetId: TARGET_ID,
        notes: 'Updated note',
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('target-notes-body')).toHaveTextContent('Updated note'),
    );
  });

  it('29. (US4) edit → cancel restores original notes without calling update', async () => {
    mockGetTargetNote.mockResolvedValue(ok({ notes: 'Original note' }));
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByTestId('target-notes-body'));

    fireEvent.click(screen.getByRole('button', { name: /^edit$/i }));
    await waitFor(() => screen.getByTestId('target-notes-textarea'));

    fireEvent.change(screen.getByTestId('target-notes-textarea'), {
      target: { value: 'Changed but cancelled' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^cancel$/i }));

    await waitFor(() =>
      expect(screen.getByTestId('target-notes-body')).toHaveTextContent('Original note'),
    );
    expect(mockUpdateTargetNote).not.toHaveBeenCalled();
  });

  it('30. (US4) save error shows banner message', async () => {
    mockGetTargetNote.mockResolvedValue(ok({ notes: null }));
    mockUpdateTargetNote.mockRejectedValue(new Error('db error'));
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => screen.getByTestId('target-notes-empty'));

    // Open edit with the notes "Edit" button (last Edit button on page is notes section)
    const editBtns = screen.getAllByRole('button', { name: /^edit$/i });
    fireEvent.click(editBtns[editBtns.length - 1]);
    await waitFor(() => screen.getByTestId('target-notes-textarea'));

    fireEvent.change(screen.getByTestId('target-notes-textarea'), {
      target: { value: 'some notes' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));

    await waitFor(() =>
      expect(screen.getByText('Failed to save notes.')).toBeInTheDocument(),
    );
  });
});

// ── spec 044 Track B: US6/T015 no-site prompt, T018 tests ──────────────────────

describe('TargetDetailV2 — no-site prompt (US6/T015/T018)', () => {
  beforeEach(async () => {
    const { __setObservingStateForTest } = await import('./observing-sites/site-store');
    __setObservingStateForTest({});
  });

  it('31. shows a no-site prompt in the Tonight column when there is no active site', async () => {
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => {
      const els = screen.getAllByText(/Add an observing site.*see tonight's real altitude/i);
      expect(els.length).toBeGreaterThanOrEqual(1);
    });
  });

  it('32. hides the no-site prompt and shows real tonight stats once a site is active', async () => {
    const { __setObservingStateForTest } = await import('./observing-sites/site-store');
    __setObservingStateForTest({
      sites: [
        {
          id: 'site-1',
          name: 'Test Site',
          latitudeDeg: 52.37,
          longitudeDeg: 4.9,
          elevationM: 0,
          timezone: 'Europe/Amsterdam',
          twilight: 'astronomical',
          minHorizonAltDeg: 0,
        },
      ],
      activeSiteId: 'site-1',
      defaultSiteId: 'site-1',
    });
    render(<TargetDetailV2 targetId={TARGET_ID} />);
    await waitFor(() => {
      expect(
        screen.queryByText(/Add an observing site.*see tonight's real altitude/i),
      ).not.toBeInTheDocument();
      // Real max-alt stat renders once a site is active.
      expect(screen.getByText(/^Max alt/)).toBeInTheDocument();
    });
  });
});
