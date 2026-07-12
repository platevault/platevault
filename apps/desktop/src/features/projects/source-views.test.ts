/**
 * Vitest unit tests for spec 026 source-views helpers.
 *
 * Tests cover:
 * 1. viewStateLabel — all known states + unknown fallback.
 * 2. viewStateVariant — correct Pill variants.
 * 3. canRemoveView / canRegenerateView — action availability per state.
 * 4. listPreparedViews, removePreparedView, regeneratePreparedView
 *    — success path via mocked invoke.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  viewStateLabel,
  viewStateVariant,
  canRemoveView,
  canRegenerateView,
  canVerifyView,
  brokenItemStateLabel,
  observedStateLabel,
  listPreparedViews,
  removePreparedView,
  regeneratePreparedView,
  verifySourceView,
} from './source-views';
import type { PreparedViewSummary } from './source-views';

// ── Mock generated bindings (spec 037) ────────────────────────────────────────
// source-views now calls commands.preparedview* + unwrap; mock the bindings'
// Result envelope and let the real unwrap run.

const { mockList, mockRemove, mockRegenerate, mockVerify } = vi.hoisted(() => ({
  mockList: vi.fn(),
  mockRemove: vi.fn(),
  mockRegenerate: vi.fn(),
  mockVerify: vi.fn(),
}));

vi.mock('@/bindings/index', () => ({
  commands: {
    preparedviewList: mockList,
    preparedviewRemove: mockRemove,
    preparedviewRegenerate: mockRegenerate,
    sourceviewVerify: mockVerify,
  },
}));

beforeEach(() => {
  vi.resetAllMocks();
});

// ── viewStateLabel ────────────────────────────────────────────────────────────

describe('viewStateLabel', () => {
  it('returns "Current" for current', () => {
    expect(viewStateLabel('current')).toBe('Current');
  });

  it('returns "Stale" for stale', () => {
    expect(viewStateLabel('stale')).toBe('Stale');
  });

  it('returns "Missing" for missing', () => {
    expect(viewStateLabel('missing')).toBe('Missing');
  });

  it('returns "Removed" for removed', () => {
    expect(viewStateLabel('removed')).toBe('Removed');
  });

  it('returns "Failed" for failed', () => {
    expect(viewStateLabel('failed')).toBe('Failed');
  });

  it('returns resolution prompt for kind_diverged', () => {
    const label = viewStateLabel('kind_diverged');
    expect(label).toContain('resolve');
  });

  it('falls back to the raw state string for unknown values', () => {
    // Cast to bypass TypeScript to test the default branch
    expect(viewStateLabel('unknown_future_state' as never)).toBe(
      'unknown_future_state',
    );
  });
});

// ── viewStateVariant ──────────────────────────────────────────────────────────

describe('viewStateVariant', () => {
  it('returns ok for current', () => {
    expect(viewStateVariant('current')).toBe('ok');
  });

  it('returns warn for stale', () => {
    expect(viewStateVariant('stale')).toBe('warn');
  });

  it('returns warn for missing', () => {
    expect(viewStateVariant('missing')).toBe('warn');
  });

  it('returns neutral for removed', () => {
    expect(viewStateVariant('removed')).toBe('neutral');
  });

  it('returns danger for failed', () => {
    expect(viewStateVariant('failed')).toBe('danger');
  });

  it('returns danger for kind_diverged', () => {
    expect(viewStateVariant('kind_diverged')).toBe('danger');
  });
});

// ── canRemoveView / canRegenerateView ─────────────────────────────────────────

describe('canRemoveView', () => {
  it('allows removal for current', () => {
    expect(canRemoveView('current')).toBe(true);
  });

  it('allows removal for stale', () => {
    expect(canRemoveView('stale')).toBe(true);
  });

  it('blocks removal for removed', () => {
    expect(canRemoveView('removed')).toBe(false);
  });

  it('blocks removal for failed', () => {
    expect(canRemoveView('failed')).toBe(false);
  });

  it('blocks removal for kind_diverged', () => {
    expect(canRemoveView('kind_diverged')).toBe(false);
  });

  it('blocks removal for missing', () => {
    expect(canRemoveView('missing')).toBe(false);
  });
});

describe('canRegenerateView', () => {
  it('allows regeneration for removed', () => {
    expect(canRegenerateView('removed')).toBe(true);
  });

  it('allows regeneration for stale', () => {
    expect(canRegenerateView('stale')).toBe(true);
  });

  it('allows regeneration for missing (T014 sweep: whole view folder gone)', () => {
    expect(canRegenerateView('missing')).toBe(true);
  });

  it('blocks regeneration for current', () => {
    expect(canRegenerateView('current')).toBe(false);
  });

  it('blocks regeneration for failed', () => {
    expect(canRegenerateView('failed')).toBe(false);
  });

  it('blocks regeneration for kind_diverged', () => {
    expect(canRegenerateView('kind_diverged')).toBe(false);
  });
});

// ── canVerifyView / brokenItemStateLabel (spec 049 US4) ───────────────────────

describe('canVerifyView', () => {
  it('allows verification for current', () => {
    expect(canVerifyView('current')).toBe(true);
  });

  it('allows verification for stale', () => {
    expect(canVerifyView('stale')).toBe(true);
  });

  it('blocks verification for removed', () => {
    expect(canVerifyView('removed')).toBe(false);
  });

  it('blocks verification for failed', () => {
    expect(canVerifyView('failed')).toBe(false);
  });

  it('blocks verification for kind_diverged', () => {
    expect(canVerifyView('kind_diverged')).toBe(false);
  });
});

describe('brokenItemStateLabel', () => {
  it('describes missing', () => {
    expect(brokenItemStateLabel('missing')).toContain('missing');
  });

  it('describes moved', () => {
    expect(brokenItemStateLabel('moved')).toContain('moved');
  });

  it('describes unresolved_link', () => {
    expect(brokenItemStateLabel('unresolved_link')).toContain('resolve');
  });

  it('describes changed_kind', () => {
    expect(brokenItemStateLabel('changed_kind')).toContain('kind');
  });

  it('falls back to the raw state string for unknown values', () => {
    expect(brokenItemStateLabel('unknown_future_state' as never)).toBe(
      'unknown_future_state',
    );
  });
});

// ── observedStateLabel (spec 026 T014/T015/T016 stale-detection sweep) ────────

describe('observedStateLabel', () => {
  it('describes present', () => {
    expect(observedStateLabel('present')).toBe('present');
  });

  it('describes missing', () => {
    expect(observedStateLabel('missing')).toContain('missing');
  });

  it('describes changed_kind', () => {
    expect(observedStateLabel('changed_kind')).toContain('kind');
  });

  it('describes diverged', () => {
    expect(observedStateLabel('diverged')).toContain('diverged');
  });

  it('describes hash_diverged', () => {
    expect(observedStateLabel('hash_diverged')).toContain('content');
  });

  it('falls back to the raw state string for unknown values', () => {
    expect(observedStateLabel('unknown_future_state')).toBe(
      'unknown_future_state',
    );
  });
});

// ── API wrappers ──────────────────────────────────────────────────────────────

const sampleView: PreparedViewSummary = {
  id: 'view-1',
  projectId: 'proj-1',
  kind: 'symlink',
  state: 'current',
  createdAt: '2026-01-01T00:00:00Z',
  itemCount: 3,
  items: [],
};

const ok = <T>(data: T) => ({ status: 'ok' as const, data });

describe('listPreparedViews', () => {
  it('calls preparedview.list with projectId and returns views', async () => {
    mockList.mockResolvedValueOnce(ok({ views: [sampleView] }));

    const result = await listPreparedViews('proj-1');

    expect(mockList).toHaveBeenCalledWith('proj-1');
    expect(result.views).toHaveLength(1);
    expect(result.views[0].id).toBe('view-1');
  });

  it('returns empty views array when no views exist', async () => {
    mockList.mockResolvedValueOnce(ok({ views: [] }));

    const result = await listPreparedViews('proj-empty');
    expect(result.views).toHaveLength(0);
  });
});

describe('removePreparedView', () => {
  it('calls preparedview.remove with viewId and returns planId', async () => {
    mockRemove.mockResolvedValueOnce(ok({ planId: 'plan-abc' }));

    const result = await removePreparedView('view-1');

    expect(mockRemove).toHaveBeenCalledWith('view-1');
    expect(result.planId).toBe('plan-abc');
  });

  it('propagates errors from the backend', async () => {
    mockRemove.mockRejectedValueOnce({
      code: 'lifecycle.read_only',
      message: 'archived',
    });

    await expect(removePreparedView('view-arch')).rejects.toMatchObject({
      code: 'lifecycle.read_only',
    });
  });
});

describe('regeneratePreparedView', () => {
  it('calls preparedview.regenerate with viewId and returns planId + unresolvedCount', async () => {
    mockRegenerate.mockResolvedValueOnce(
      ok({ planId: 'plan-xyz', unresolvedItemCount: 2 }),
    );

    const result = await regeneratePreparedView('view-removed');

    expect(mockRegenerate).toHaveBeenCalledWith('view-removed');
    expect(result.planId).toBe('plan-xyz');
    expect(result.unresolvedItemCount).toBe(2);
  });

  it('surfaces view.not_found error', async () => {
    mockRegenerate.mockRejectedValueOnce({
      code: 'view.not_found',
      message: 'missing',
    });

    await expect(regeneratePreparedView('gone')).rejects.toMatchObject({
      code: 'view.not_found',
    });
  });
});

describe('verifySourceView', () => {
  it('calls sourceview.verify with viewId and returns a clean result', async () => {
    mockVerify.mockResolvedValueOnce(ok({ clean: true, brokenItems: [] }));

    const result = await verifySourceView('view-1');

    expect(mockVerify).toHaveBeenCalledWith('view-1');
    expect(result.clean).toBe(true);
    expect(result.brokenItems).toEqual([]);
  });

  it('returns broken items without throwing (read-only check)', async () => {
    mockVerify.mockResolvedValueOnce(
      ok({
        clean: false,
        brokenItems: [
          {
            inventoryItemId: 'frame-1',
            viewRelativePath: '/dest/light1.fits',
            state: 'moved',
          },
        ],
      }),
    );

    const result = await verifySourceView('view-broken');
    expect(result.clean).toBe(false);
    expect(result.brokenItems).toHaveLength(1);
    expect(result.brokenItems?.[0].state).toBe('moved');
  });

  it('surfaces view.not_found error', async () => {
    mockVerify.mockRejectedValueOnce({
      code: 'view.not_found',
      message: 'missing',
    });

    await expect(verifySourceView('gone')).rejects.toMatchObject({
      code: 'view.not_found',
    });
  });
});
