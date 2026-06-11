/// <reference types="@testing-library/jest-dom" />
/**
 * BlockedBanner tests — spec 009 US4-2 / US4-3.
 *
 * Tests:
 * 1. Each reason kind renders the correct message text.
 * 2. Resolve button is present and triggers onResolve with the correct edge.
 * 3. Resolve button is disabled when disabled=true.
 * 4. resolveEdgeForReason maps reasons to the correct recovery edges.
 * 5. blockedReasonMessage formats each kind correctly.
 */

import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import {
  BlockedBanner,
  blockedReasonMessage,
  resolveEdgeForReason,
} from './BlockedBanner';
import type { BlockedReason } from './BlockedBanner';

// ── blockedReasonMessage ──────────────────────────────────────────────────────

describe('blockedReasonMessage', () => {
  it('formats source_missing with inventoryId', () => {
    const reason: BlockedReason = { kind: 'source_missing', inventoryId: 'inv-abc' };
    expect(blockedReasonMessage(reason)).toBe('Source missing: inv-abc');
  });

  it('formats prepared_source_stale', () => {
    const reason: BlockedReason = { kind: 'prepared_source_stale', preparedId: 'ps-1' };
    expect(blockedReasonMessage(reason)).toBe('Prepared source out of date');
  });

  it('formats tool_unconfigured with tool name', () => {
    const reason: BlockedReason = { kind: 'tool_unconfigured', tool: 'PixInsight' };
    expect(blockedReasonMessage(reason)).toBe('Tool path not configured: PixInsight');
  });

  it('formats calibration_unmatched', () => {
    const reason: BlockedReason = {
      kind: 'calibration_unmatched',
      calibrationSetId: 'cal-1',
    };
    expect(blockedReasonMessage(reason)).toBe('Calibration set missing');
  });

  it('formats user with the note', () => {
    const reason: BlockedReason = { kind: 'user', note: 'custom block reason' };
    expect(blockedReasonMessage(reason)).toBe('custom block reason');
  });
});

// ── resolveEdgeForReason ──────────────────────────────────────────────────────

describe('resolveEdgeForReason', () => {
  it('routes source_missing to setup_incomplete', () => {
    expect(resolveEdgeForReason({ kind: 'source_missing', inventoryId: 'x' })).toBe(
      'setup_incomplete',
    );
  });

  it('routes tool_unconfigured to setup_incomplete', () => {
    expect(resolveEdgeForReason({ kind: 'tool_unconfigured', tool: 'PI' })).toBe(
      'setup_incomplete',
    );
  });

  it('routes prepared_source_stale to ready', () => {
    expect(resolveEdgeForReason({ kind: 'prepared_source_stale', preparedId: 'p' })).toBe('ready');
  });

  it('routes calibration_unmatched to ready', () => {
    expect(
      resolveEdgeForReason({ kind: 'calibration_unmatched', calibrationSetId: 'c' }),
    ).toBe('ready');
  });

  it('routes user reason to ready', () => {
    expect(resolveEdgeForReason({ kind: 'user', note: 'manual' })).toBe('ready');
  });
});

// ── BlockedBanner component ───────────────────────────────────────────────────

describe('BlockedBanner', () => {
  it('renders the reason message for source_missing', () => {
    render(
      <BlockedBanner
        reason={{ kind: 'source_missing', inventoryId: 'inv-123' }}
        onResolve={vi.fn()}
      />,
    );
    expect(screen.getByTestId('blocked-reason-message')).toHaveTextContent(
      'Source missing: inv-123',
    );
  });

  it('renders the reason message for tool_unconfigured', () => {
    render(
      <BlockedBanner
        reason={{ kind: 'tool_unconfigured', tool: 'Siril' }}
        onResolve={vi.fn()}
      />,
    );
    expect(screen.getByTestId('blocked-reason-message')).toHaveTextContent(
      'Tool path not configured: Siril',
    );
  });

  it('renders the reason message for user reason', () => {
    render(
      <BlockedBanner
        reason={{ kind: 'user', note: 'Something broke' }}
        onResolve={vi.fn()}
      />,
    );
    expect(screen.getByTestId('blocked-reason-message')).toHaveTextContent('Something broke');
  });

  it('calls onResolve with the correct edge for source_missing', () => {
    const onResolve = vi.fn();
    render(
      <BlockedBanner
        reason={{ kind: 'source_missing', inventoryId: 'inv-999' }}
        onResolve={onResolve}
      />,
    );
    fireEvent.click(screen.getByTestId('blocked-resolve-btn'));
    expect(onResolve).toHaveBeenCalledWith('setup_incomplete');
  });

  it('calls onResolve with ready for user reason', () => {
    const onResolve = vi.fn();
    render(
      <BlockedBanner
        reason={{ kind: 'user', note: 'manual block' }}
        onResolve={onResolve}
      />,
    );
    fireEvent.click(screen.getByTestId('blocked-resolve-btn'));
    expect(onResolve).toHaveBeenCalledWith('ready');
  });

  it('disables the resolve button when disabled=true', () => {
    render(
      <BlockedBanner
        reason={{ kind: 'user', note: 'blocked' }}
        onResolve={vi.fn()}
        disabled
      />,
    );
    expect(screen.getByTestId('blocked-resolve-btn')).toBeDisabled();
  });

  it('does not call onResolve when button is disabled', () => {
    const onResolve = vi.fn();
    render(
      <BlockedBanner
        reason={{ kind: 'user', note: 'blocked' }}
        onResolve={onResolve}
        disabled
      />,
    );
    fireEvent.click(screen.getByTestId('blocked-resolve-btn'));
    expect(onResolve).not.toHaveBeenCalled();
  });
});
