// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * GuidedOverlay — anchor-absence coverage (spec 010, FR-007; #723).
 *
 * The react-joyride rewrite (D6, spec 033 T030) dropped the old hand-rolled
 * MutationObserver deferred-hint handling. `GuidedOverlay.tsx` has no
 * explicit anchor-presence check of its own — react-joyride's own
 * `TARGET_NOT_FOUND` handling is what's supposed to keep the coach from
 * crashing or leaving a stuck spotlight when the anchor DOM node isn't on
 * the current route. Every other GuidedOverlay test mocks react-joyride
 * (see `GuidedOverlay.test.tsx`), so this path was never actually exercised.
 * This file uses the REAL react-joyride to close that gap.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { GuidedOverlay } from '../GuidedOverlay';
import type { GuidedFlowStateDto } from '../store';

const now = new Date().toISOString();

function makeState(
  overrides: Partial<GuidedFlowStateDto> = {},
): GuidedFlowStateDto {
  return {
    currentStep: 'inbox.confirm_first',
    completedSteps: [],
    dismissed: false,
    dismissedAt: null,
    updatedAt: now,
    ...overrides,
  };
}

describe('GuidedOverlay anchor-absence (real react-joyride, FR-007)', () => {
  afterEach(() => {
    cleanup();
  });

  it('does not throw when the current step anchor is not mounted anywhere', () => {
    // No element with data-guide-anchor="inbox.confirm-row" exists in the DOM
    // (the InboxPage route is not rendered in this test).
    expect(() => {
      render(
        <GuidedOverlay
          guidedState={makeState({ currentStep: 'inbox.confirm_first' })}
          onDismiss={() => {}}
        />,
      );
    }).not.toThrow();
  });

  it('does not leave an orphan spotlight/overlay when the anchor is absent', () => {
    render(
      <GuidedOverlay
        guidedState={makeState({ currentStep: 'project.create_first' })}
        onDismiss={() => {}}
      />,
    );

    // react-joyride portals its overlay/spotlight onto document.body. With no
    // matching target it must never render a stuck full-page spotlight.
    expect(document.querySelectorAll('.react-joyride__overlay').length).toBe(0);
    expect(document.querySelectorAll('.react-joyride__spotlight').length).toBe(
      0,
    );
  });

  it('does not throw across every registered step id when its anchor is absent', () => {
    for (const stepId of [
      'inbox.confirm_first',
      'project.create_first',
      'tool.open_first',
    ]) {
      expect(() => {
        const { unmount } = render(
          <GuidedOverlay
            guidedState={makeState({ currentStep: stepId })}
            onDismiss={() => {}}
          />,
        );
        unmount();
      }).not.toThrow();
    }
  });
});
