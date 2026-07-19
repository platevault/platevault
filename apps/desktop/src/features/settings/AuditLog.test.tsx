// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />
/**
 * AuditLog tests — spec-043 P2 (wire Audit Log settings screen to real
 * backend).
 *
 * Covers:
 *   1. Loads and renders audit entries via `commands.auditList`.
 *   2. The search box is debounced (no per-keystroke IPC), then maps to
 *      `filters.search` on the next `auditList` call.
 *   3. Date-range inputs map to `filters.from` / `filters.to`.
 *   4. Pagination (Next) advances `pagination.offset` by the page size.
 *   5. A load failure surfaces via the load-error banner (errMessage).
 *   6. Export calls `commands.auditExport` with the current filters and
 *      triggers a file download.
 *   7. Detail localization (D23 upgrade): entries carrying a stable
 *      `detailCode` + `detailParams` render a catalog message in the entity
 *      tooltip; entries without a code (or without the params the template
 *      needs) fall back to the stored English `detail`.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const { mockList, mockExport, mockNavigate } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockExport: vi.fn(),
  mockNavigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => mockNavigate,
}));

// #803 entity-name resolution calls these per-row; default to a "not found"
// error so unrelated tests keep seeing the raw `entityType · entityId` text.
vi.mock('@/bindings/index', () => ({
  commands: {
    auditList: mockList,
    auditExport: mockExport,
    projectsGet: vi.fn().mockResolvedValue({
      status: 'error',
      error: {
        code: 'entity.not_found',
        message: 'not found',
        severity: 'warning',
        retryable: false,
      },
    }),
    targetsGet: vi.fn().mockResolvedValue({
      status: 'error',
      error: {
        code: 'entity.not_found',
        message: 'not found',
        severity: 'warning',
        retryable: false,
      },
    }),
    plansGet: vi.fn().mockResolvedValue({
      status: 'error',
      error: {
        code: 'entity.not_found',
        message: 'not found',
        severity: 'warning',
        retryable: false,
      },
    }),
  },
}));

import { AuditLog } from './AuditLog';

const ENTRIES = [
  {
    id: 'audit-001',
    timestamp: '2026-05-20T22:15:00Z',
    eventType: 'session.confirmed',
    entityType: 'session',
    entityId: 'ses-001',
    fromState: 'needs_review',
    toState: 'confirmed',
    actor: 'user',
    outcome: 'applied',
    detail: 'User confirmed session',
  },
  {
    id: 'audit-002',
    timestamp: '2026-05-19T21:00:00Z',
    eventType: 'plan.approved',
    entityType: 'plan',
    entityId: 'plan-001',
    fromState: 'ready_for_review',
    toState: 'approved',
    actor: 'user',
    outcome: 'applied',
    detail: 'Plan approved',
  },
];

beforeEach(() => {
  mockList.mockReset();
  mockExport.mockReset();
  mockNavigate.mockReset();
  mockList.mockResolvedValue({
    status: 'ok',
    data: { entries: ENTRIES, total: ENTRIES.length },
  });
  mockExport.mockResolvedValue({
    status: 'ok',
    data: ENTRIES.map((e) => JSON.stringify(e)).join('\n'),
  });
});

describe('AuditLog', () => {
  it('loads audit entries via auditList and renders them', async () => {
    render(<AuditLog />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    // findBy, not getBy: rows render behind `{!loading && …}` (AuditLog.tsx)
    // and `loading` only clears once auditList's promise RESOLVES — the
    // waitFor above only proves the call was made. A sync getBy therefore
    // races the "Loading…" row on a contended runner (#1083).
    expect(await screen.findByText('session.confirmed')).toBeInTheDocument();
    expect(screen.getByText('plan.approved')).toBeInTheDocument();
    // First call has no filters (nothing typed yet).
    expect(mockList).toHaveBeenCalledWith(null, { limit: 8, offset: 0 });
  });

  it('debounces the search box, then maps it to filters.search', async () => {
    render(<AuditLog />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());
    const callsBeforeTyping = mockList.mock.calls.length;

    fireEvent.change(screen.getByLabelText('Search audit events'), {
      target: { value: 'plan.approved' },
    });

    // Debounced: the keystroke does not fire an immediate IPC round-trip.
    expect(mockList).toHaveBeenCalledTimes(callsBeforeTyping);

    // After the 300ms debounce the query lands as filters.search.
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(
        { search: 'plan.approved' },
        { limit: 8, offset: 0 },
      ),
    );
  });

  it('maps the date-range inputs to filters.from / filters.to', async () => {
    render(<AuditLog />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('From'), {
      target: { value: '2026-05-01' },
    });
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(
        { from: new Date('2026-05-01').toISOString() },
        { limit: 8, offset: 0 },
      ),
    );

    fireEvent.change(screen.getByLabelText('To'), {
      target: { value: '2026-05-10' },
    });
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(
        {
          from: new Date('2026-05-01').toISOString(),
          to: new Date(
            new Date('2026-05-10').getTime() + 86400000,
          ).toISOString(),
        },
        { limit: 8, offset: 0 },
      ),
    );
  });

  it('advances pagination.offset on Next', async () => {
    mockList.mockResolvedValue({
      status: 'ok',
      data: { entries: ENTRIES, total: 20 },
    });
    render(<AuditLog />);
    // Wait for the initial load to RESOLVE, not merely for auditList to have been
    // called: the Next button is disabled until `total` is set (totalPages > 1),
    // so clicking while the load promise is still pending is a no-op that leaves
    // offset at 0 (the source of the parallel-run flake). Rows only render after
    // loading flips false, so finding an entry proves total=20 landed and Next
    // is enabled.
    await screen.findByText('session.confirmed');
    const nextBtn = screen.getByText('Next');
    expect(nextBtn).toBeEnabled();

    fireEvent.click(nextBtn);

    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(null, { limit: 8, offset: 8 }),
    );
  });

  it('shows the load-error banner when auditList fails', async () => {
    mockList.mockResolvedValue({
      status: 'error',
      error: {
        code: 'internal.database',
        message: 'db down',
        severity: 'fatal',
        retryable: true,
      },
    });
    render(<AuditLog />);

    await waitFor(() =>
      expect(
        screen.getByText(/Could not load audit events/),
      ).toBeInTheDocument(),
    );
  });

  it('localizes detail tooltips from detailCode + detailParams, with English fallback', async () => {
    mockList.mockResolvedValue({
      status: 'ok',
      data: {
        entries: [
          {
            id: 'audit-101',
            timestamp: '2026-07-01T10:00:00Z',
            eventType: 'project: ready -> prepared',
            entityType: 'project',
            entityId: 'proj-001',
            fromState: 'ready',
            toState: null,
            actor: 'user',
            outcome: 'refused',
            detail:
              'edge (project, ready -> prepared) requires an approved FilesystemPlan',
            detailCode: 'plan.required',
            detailParams: {
              entityType: 'project',
              fromState: 'ready',
              toState: 'prepared',
            },
          },
          {
            id: 'audit-102',
            timestamp: '2026-07-01T11:00:00Z',
            eventType: 'project: prepared -> processing',
            entityType: 'project',
            entityId: 'proj-002',
            fromState: 'prepared',
            toState: null,
            actor: 'user',
            outcome: 'refused',
            detail:
              'edge (project, prepared -> processing) requires reviewed provenance on 2 field(s)',
            detailCode: 'provenance.unreviewed',
            detailParams: { count: '2' },
          },
          {
            id: 'audit-103',
            timestamp: '2026-07-01T12:00:00Z',
            eventType: 'target.resolved',
            entityType: 'canonical_target',
            entityId: 'tgt-001',
            fromState: null,
            toState: null,
            actor: 'user',
            outcome: 'applied',
            detail: 'target.resolved (M 31)',
            detailCode: 'target.resolved',
            detailParams: { query: 'M 31' },
          },
          {
            // Old row (pre-D23-upgrade): ambiguous code, no params → the
            // stored English message must render unchanged.
            id: 'audit-104',
            timestamp: '2026-07-01T13:00:00Z',
            eventType: 'project: processing -> completed',
            entityType: 'project',
            entityId: 'proj-003',
            fromState: 'processing',
            toState: null,
            actor: 'user',
            outcome: 'refused',
            detail: 'some legacy free-form refusal reason',
            detailCode: 'transition.refused',
            detailParams: null,
          },
        ],
        total: 4,
      },
    });

    render(<AuditLog />);

    // waitFor on rendered content (not just "mockList was called") — the
    // list call resolves asynchronously, so asserting immediately after only
    // the call-count race with the re-render that actually paints the rows
    // (observed flaky on a loaded CI runner: assertion ran while the table
    // still showed "Loading…"). Detail is now a visible column (#749), not
    // a hover-only tooltip.
    await waitFor(() =>
      expect(
        screen.getByText(
          'Transition ready → prepared for project requires an approved filesystem plan',
        ),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByText('2 fields require review before this transition'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Target resolved from query “M 31”'),
    ).toBeInTheDocument();
    // Fallback: no usable template → stored English detail, byte-identical.
    expect(
      screen.getByText('some legacy free-form refusal reason'),
    ).toBeInTheDocument();
  });

  it('exports via auditExport with the current filters and triggers a download', async () => {
    const createObjectURL = vi.fn(() => 'blob:mock-url');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });
    const clickSpy = vi.fn();
    const originalCreateElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = originalCreateElement(tag);
      if (tag === 'a') el.click = clickSpy;
      return el;
    });

    render(<AuditLog />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    // The Export button is `disabled={exporting || loading}` (AuditLog.tsx),
    // and `loading` only clears once auditList's promise RESOLVES — the
    // waitFor above only proves the call was made. fireEvent.click on a
    // disabled button is a silent no-op, so clicking synchronously here
    // races the load on slow runners: auditExport is simply never invoked
    // and the assertion below fails with "Number of calls: 0" (observed on
    // macos-latest). Wait for the button to actually be enabled first.
    const exportBtn = await screen.findByRole('button', {
      name: 'Export audit events to a file',
    });
    await waitFor(() => expect(exportBtn).toBeEnabled());
    fireEvent.click(exportBtn);

    await waitFor(() => expect(mockExport).toHaveBeenCalledWith(null));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('renders the state-change column (#749)', async () => {
    render(<AuditLog />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    // findBy: rows are gated on `loading` clearing, which the waitFor above
    // does not prove (#1083).
    expect(
      await screen.findByText('needs_review → confirmed'),
    ).toBeInTheDocument();
    expect(screen.getByText('ready_for_review → approved')).toBeInTheDocument();
  });

  it('maps the outcome and entity-type selects to structured filters (#749)', async () => {
    render(<AuditLog />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    fireEvent.change(screen.getByLabelText('Outcome'), {
      target: { value: 'refused' },
    });
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(
        { outcome: 'refused' },
        { limit: 8, offset: 0 },
      ),
    );

    fireEvent.change(screen.getByLabelText('Entity'), {
      target: { value: 'project' },
    });
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(
        { outcome: 'refused', entityType: 'project' },
        { limit: 8, offset: 0 },
      ),
    );
  });

  it('navigates to the entity page when a linked row is clicked (#831)', async () => {
    render(<AuditLog />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    // ENTRIES[0] is entityType 'session', which has a real /sessions/:id route.
    // findBy: the row only exists once `loading` clears (#1083); clicking a
    // row that hasn't rendered would throw rather than navigate.
    fireEvent.click(await screen.findByText('session.confirmed'));

    expect(mockNavigate).toHaveBeenCalledWith({ to: '/sessions/ses-001' });
  });

  it('does not link entity types without a destination page (#626 reasoning, #831)', async () => {
    render(<AuditLog />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    // ENTRIES[1] is entityType 'plan' — no /plans/:id route exists yet.
    // findBy: without it a still-loading table makes this pass vacuously —
    // the click never lands, so "navigate was not called" proves nothing
    // about the no-route behaviour (#1083).
    fireEvent.click(await screen.findByText('plan.approved'));

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('resolves a project entity to its display name (#803)', async () => {
    const { commands } = await import('@/bindings/index');
    vi.mocked(commands.projectsGet).mockResolvedValueOnce({
      status: 'ok',
      data: { id: 'proj-abc', name: 'J5 Lifecycle Test' } as never,
    });
    mockList.mockResolvedValue({
      status: 'ok',
      data: {
        entries: [
          {
            id: 'audit-201',
            timestamp: '2026-07-14T10:00:00Z',
            eventType: 'project.archive_refused',
            entityType: 'project',
            entityId: 'proj-abc',
            fromState: null,
            toState: null,
            actor: 'system',
            outcome: 'refused',
            detail: 'Archive refused',
          },
        ],
        total: 1,
      },
    });

    render(<AuditLog />);

    await waitFor(() => {
      expect(screen.getByText('J5 Lifecycle Test')).toBeInTheDocument();
    });
    expect(screen.queryByText('project · proj-abc')).not.toBeInTheDocument();
  });
});
