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

const { mockList, mockExport } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockExport: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    auditList: mockList,
    auditExport: mockExport,
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
  mockList.mockResolvedValue({ status: 'ok', data: { entries: ENTRIES, total: ENTRIES.length } });
  mockExport.mockResolvedValue({ status: 'ok', data: ENTRIES.map((e) => JSON.stringify(e)).join('\n') });
});

describe('AuditLog', () => {
  it('loads audit entries via auditList and renders them', async () => {
    render(<AuditLog />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    expect(screen.getByText('session.confirmed')).toBeInTheDocument();
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

    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-05-01' } });
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(
        { from: new Date('2026-05-01').toISOString() },
        { limit: 8, offset: 0 },
      ),
    );

    fireEvent.change(screen.getByLabelText('To'), { target: { value: '2026-05-10' } });
    await waitFor(() =>
      expect(mockList).toHaveBeenLastCalledWith(
        {
          from: new Date('2026-05-01').toISOString(),
          to: new Date(new Date('2026-05-10').getTime() + 86400000).toISOString(),
        },
        { limit: 8, offset: 0 },
      ),
    );
  });

  it('advances pagination.offset on Next', async () => {
    mockList.mockResolvedValue({ status: 'ok', data: { entries: ENTRIES, total: 20 } });
    render(<AuditLog />);
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    fireEvent.click(screen.getByText('Next'));

    await waitFor(() => expect(mockList).toHaveBeenLastCalledWith(null, { limit: 8, offset: 8 }));
  });

  it('shows the load-error banner when auditList fails', async () => {
    mockList.mockResolvedValue({
      status: 'error',
      error: { code: 'internal.database', message: 'db down', severity: 'fatal', retryable: true },
    });
    render(<AuditLog />);

    await waitFor(() =>
      expect(screen.getByText(/Could not load audit events/)).toBeInTheDocument(),
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
            detail: 'edge (project, ready -> prepared) requires an approved FilesystemPlan',
            detailCode: 'plan.required',
            detailParams: { entityType: 'project', fromState: 'ready', toState: 'prepared' },
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
            detail: 'edge (project, prepared -> processing) requires reviewed provenance on 2 field(s)',
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
    await waitFor(() => expect(mockList).toHaveBeenCalled());

    expect(screen.getByTitle(
      'Transition ready → prepared for project requires an approved filesystem plan',
    )).toBeInTheDocument();
    expect(screen.getByTitle(
      '2 fields require review before this transition',
    )).toBeInTheDocument();
    expect(screen.getByTitle('Target resolved from query “M 31”')).toBeInTheDocument();
    // Fallback: no usable template → stored English detail, byte-identical.
    expect(screen.getByTitle('some legacy free-form refusal reason')).toBeInTheDocument();
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

    fireEvent.click(screen.getByText('Export'));

    await waitFor(() => expect(mockExport).toHaveBeenCalledWith(null));
    await waitFor(() => expect(clickSpy).toHaveBeenCalled());
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');

    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
});
