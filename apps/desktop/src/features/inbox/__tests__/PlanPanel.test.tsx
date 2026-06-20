/**
 * PlanPanel component tests (spec 041, US1 T013 + US7 T041).
 *
 * Covers:
 * - Renders actions + count summary.
 * - Destructive control shown only when a destructive action is present.
 * - Destructive control defaults to archive.
 * - Stale banner renders when plan.stale is true.
 * - Apply / Cancel / Apply-all callbacks fire.
 * - Buttons disabled when busy.
 * - Null plan → no plan message shown, Apply disabled.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { PlanPanel } from '../PlanPanel';
import type { PlanView, PlanActionView, DestructiveDestination } from '../PlanPanel';

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeAction(
  overrides: Partial<PlanActionView> = {},
): PlanActionView {
  return {
    index: 0,
    action: 'move',
    fromPath: '/root/lights/img001.fits',
    toPath: '/dest/lights/img001.fits',
    destinationPreview: '/dest/lights/img001.fits',
    requiresDestructiveConfirm: false,
    ...overrides,
  };
}

function makePlan(overrides: Partial<PlanView> = {}): PlanView {
  return {
    planId: 'plan-1',
    state: 'open',
    stale: false,
    actions: [makeAction()],
    ...overrides,
  };
}

// ── Default props ─────────────────────────────────────────────────────────────

function renderPanel(
  planOverride: PlanView | null,
  {
    destructiveDestination = 'archive' as DestructiveDestination,
    onDestructiveDestinationChange = vi.fn(),
    onApply = vi.fn(),
    onApplyAll = undefined as (() => void) | undefined,
    onCancel = vi.fn(),
    busy = false,
  } = {},
) {
  return render(
    <PlanPanel
      plan={planOverride}
      destructiveDestination={destructiveDestination}
      onDestructiveDestinationChange={onDestructiveDestinationChange}
      onApply={onApply}
      onApplyAll={onApplyAll}
      onCancel={onCancel}
      busy={busy}
    />,
  );
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('PlanPanel', () => {
  let onApply: ReturnType<typeof vi.fn>;
  let onCancel: ReturnType<typeof vi.fn>;
  let onDestructiveChange: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    onApply = vi.fn();
    onCancel = vi.fn();
    onDestructiveChange = vi.fn();
  });

  // ── Renders actions + counts ──────────────────────────────────────────────

  it('renders the panel header', () => {
    renderPanel(makePlan());
    expect(screen.getByTestId('plan-panel')).toBeDefined();
    expect(screen.getByText('Planned actions')).toBeDefined();
  });

  it('renders the count summary for multiple action kinds', () => {
    const plan = makePlan({
      actions: [
        makeAction({ index: 0, action: 'move' }),
        makeAction({ index: 1, action: 'move' }),
        makeAction({ index: 2, action: 'catalogue' }),
      ],
    });
    renderPanel(plan);
    // Summary should contain "2 move · 1 catalogue" (sorted by kind label).
    expect(screen.getByText(/2 move/)).toBeDefined();
    expect(screen.getByText(/1 catalogue/)).toBeDefined();
  });

  it('renders the file basename in each row', () => {
    const plan = makePlan({
      actions: [makeAction({ fromPath: '/some/deep/path/ngc1234.fits' })],
    });
    renderPanel(plan);
    expect(screen.getByText('ngc1234.fits')).toBeDefined();
  });

  it('renders the destination preview when present', () => {
    const plan = makePlan({
      actions: [makeAction({ destinationPreview: '/dest/lights/ngc1234.fits' })],
    });
    renderPanel(plan);
    expect(screen.getByText('/dest/lights/ngc1234.fits')).toBeDefined();
  });

  it('renders "computed on confirm" when destinationPreview is null', () => {
    const plan = makePlan({
      actions: [makeAction({ destinationPreview: null })],
    });
    renderPanel(plan);
    expect(screen.getByText('computed on confirm')).toBeDefined();
  });

  it('shows "No plan generated yet." when plan is null', () => {
    renderPanel(null);
    expect(screen.getByText('No plan generated yet.')).toBeDefined();
  });

  // ── Destructive control ───────────────────────────────────────────────────

  it('does NOT show the destructive control when no action requires destructive confirm', () => {
    const plan = makePlan({
      actions: [makeAction({ requiresDestructiveConfirm: false })],
    });
    renderPanel(plan);
    expect(screen.queryByTestId('plan-destructive-archive')).toBeNull();
    expect(screen.queryByTestId('plan-destructive-trash')).toBeNull();
  });

  it('shows the destructive control when at least one action requires destructive confirm', () => {
    const plan = makePlan({
      actions: [makeAction({ requiresDestructiveConfirm: true })],
    });
    renderPanel(plan);
    expect(screen.getByTestId('plan-destructive-archive')).toBeDefined();
    expect(screen.getByTestId('plan-destructive-trash')).toBeDefined();
  });

  it('defaults the destructive destination to archive (radio checked)', () => {
    const plan = makePlan({
      actions: [makeAction({ requiresDestructiveConfirm: true })],
    });
    renderPanel(plan, { destructiveDestination: 'archive' });
    const archiveRadio = screen.getByTestId('plan-destructive-archive') as HTMLInputElement;
    const trashRadio   = screen.getByTestId('plan-destructive-trash') as HTMLInputElement;
    expect(archiveRadio.checked).toBe(true);
    expect(trashRadio.checked).toBe(false);
  });

  it('calls onDestructiveDestinationChange when os_trash is selected', () => {
    const plan = makePlan({
      actions: [makeAction({ requiresDestructiveConfirm: true })],
    });
    renderPanel(plan, {
      destructiveDestination: 'archive',
      onDestructiveDestinationChange: onDestructiveChange,
    });
    const trashRadio = screen.getByTestId('plan-destructive-trash');
    fireEvent.click(trashRadio);
    expect(onDestructiveChange).toHaveBeenCalledWith('os_trash');
  });

  it('shows a one-line explanation near the destructive options', () => {
    const plan = makePlan({
      actions: [makeAction({ requiresDestructiveConfirm: true })],
    });
    renderPanel(plan);
    expect(
      screen.getByText(/Archive folder keeps a recoverable copy/),
    ).toBeDefined();
  });

  // ── Stale banner ──────────────────────────────────────────────────────────

  it('shows stale banner when plan.stale is true', () => {
    const plan = makePlan({ stale: true });
    renderPanel(plan);
    expect(screen.getByText(/Source files changed/)).toBeDefined();
  });

  it('does NOT show stale banner when plan.stale is false', () => {
    const plan = makePlan({ stale: false });
    renderPanel(plan);
    expect(screen.queryByText(/Source files changed/)).toBeNull();
  });

  // ── Callbacks ─────────────────────────────────────────────────────────────

  it('calls onApply when Apply button is clicked', () => {
    renderPanel(makePlan(), { onApply });
    fireEvent.click(screen.getByTestId('plan-apply'));
    expect(onApply).toHaveBeenCalledOnce();
  });

  it('calls onCancel when Cancel button is clicked', () => {
    renderPanel(makePlan(), { onCancel });
    fireEvent.click(screen.getByTestId('plan-cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });

  it('renders Apply all button when onApplyAll is provided and calls it', () => {
    const onApplyAll = vi.fn();
    renderPanel(makePlan(), { onApply, onApplyAll });
    const btn = screen.getByTestId('plan-apply-all');
    expect(btn).toBeDefined();
    fireEvent.click(btn);
    expect(onApplyAll).toHaveBeenCalledOnce();
  });

  it('does NOT render Apply all button when onApplyAll is not provided', () => {
    renderPanel(makePlan(), { onApply });
    expect(screen.queryByTestId('plan-apply-all')).toBeNull();
  });

  // ── Disabled when busy ────────────────────────────────────────────────────

  it('disables Apply and Apply-all when busy is true', () => {
    const onApplyAll = vi.fn();
    renderPanel(makePlan(), { busy: true, onApply, onApplyAll });
    const applyBtn    = screen.getByTestId('plan-apply') as HTMLButtonElement;
    const applyAllBtn = screen.getByTestId('plan-apply-all') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
    expect(applyAllBtn.disabled).toBe(true);
  });

  it('disables Cancel when busy is true', () => {
    renderPanel(makePlan(), { busy: true, onCancel });
    const cancelBtn = screen.getByTestId('plan-cancel') as HTMLButtonElement;
    expect(cancelBtn.disabled).toBe(true);
  });

  it('disables Apply when plan is null', () => {
    renderPanel(null, { onApply });
    const applyBtn = screen.getByTestId('plan-apply') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });

  it('disables Apply when plan is stale', () => {
    renderPanel(makePlan({ stale: true }), { onApply });
    const applyBtn = screen.getByTestId('plan-apply') as HTMLButtonElement;
    expect(applyBtn.disabled).toBe(true);
  });

  it('shows Applying… label when busy', () => {
    renderPanel(makePlan(), { busy: true });
    expect(screen.getByText('Applying…')).toBeDefined();
  });
});
