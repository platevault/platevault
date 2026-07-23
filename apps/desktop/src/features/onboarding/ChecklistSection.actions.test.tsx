// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/// <reference types="@testing-library/jest-dom" />

import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { OnboardingItemDto } from '@/bindings/index';

const { setItemState, toggleFind } = vi.hoisted(() => ({
  setItemState: vi.fn(),
  toggleFind: vi.fn(),
}));

vi.mock('./store', () => ({
  setOnboardingItemState: setItemState,
}));

vi.mock('./FindSpotlight', () => ({
  clearFind: vi.fn(),
  FindSpotlight: () => null,
  toggleFind,
  useActiveFindItem: () => null,
}));

import {
  ChecklistItemRow,
  completedChecklistItems,
  isChecklistGroupSettled,
} from './ChecklistSection';

function item(hasAutoTick: boolean): OnboardingItemDto {
  return {
    itemId: hasAutoTick ? 'inbox.confirm_first' : 'sessions.review_first',
    page: hasAutoTick ? 'inbox' : 'sessions',
    state: 'unchecked',
    at: '2026-07-22T00:00:00Z',
    source: 'seed',
    prerequisite: null,
    hasAutoTick,
  };
}

describe('ChecklistItemRow actions', () => {
  beforeEach(() => {
    setItemState.mockReset();
    toggleFind.mockReset();
  });

  it('does not expose manual completion or dismiss for an automatic item', () => {
    render(
      <ChecklistItemRow
        item={item(true)}
        idPrefix="test"
        completing={false}
        onJump={vi.fn()}
      />,
    );

    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: /^Dismiss:/ }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /^Show me where:/ }),
    ).toHaveAttribute('aria-describedby', 'test-tt-inbox_confirm_first');
  });

  it('lets a manual item be checked, dismissed, or found', () => {
    const manual = item(false);
    render(
      <ChecklistItemRow
        item={manual}
        idPrefix="test"
        completing={false}
        onJump={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox'));
    fireEvent.click(screen.getByRole('button', { name: /^Dismiss:/ }));
    fireEvent.click(screen.getByRole('button', { name: /^Show me where:/ }));

    expect(setItemState).toHaveBeenNthCalledWith(
      1,
      manual.itemId,
      'manually_checked',
    );
    expect(setItemState).toHaveBeenNthCalledWith(2, manual.itemId, 'dismissed');
    expect(toggleFind).toHaveBeenCalledWith(manual);
  });

  it('lets a blocked manual item be dismissed but not completed', () => {
    const blocked = {
      ...item(false),
      prerequisite: {
        upstreamItemId: 'inbox.confirm_first',
        met: false,
        reasonKey: 'onboarding.prerequisite.inbox.confirm_first',
        jumpPage: 'inbox' as const,
      },
    };
    render(
      <ChecklistItemRow
        item={blocked}
        idPrefix="test"
        completing={false}
        onJump={vi.fn()}
      />,
    );

    expect(screen.getByRole('checkbox')).toBeDisabled();
    const dismiss = screen.getByRole('button', { name: /^Dismiss:/ });
    expect(dismiss).toBeEnabled();
    fireEvent.click(dismiss);

    expect(setItemState).toHaveBeenCalledWith(blocked.itemId, 'dismissed');
  });

  it('settles but does not complete a dismissed item', () => {
    const dismissed = { ...item(false), state: 'dismissed' as const };

    expect(isChecklistGroupSettled([dismissed])).toBe(true);
    expect(completedChecklistItems([dismissed])).toEqual([]);
  });
});
