// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * GuidedOverlay — anchor-absence coverage (spec 010, FR-007; #723, #585).
 *
 * The react-joyride rewrite (D6, spec 033 T030) dropped the old hand-rolled
 * MutationObserver deferred-hint handling. `GuidedOverlay.tsx` has no
 * explicit anchor-presence check of its own — react-joyride's own
 * `TARGET_NOT_FOUND` handling is what's supposed to keep the coach from
 * crashing or leaving a stuck spotlight when the anchor DOM node isn't on
 * the current route. Every other GuidedOverlay test mocks react-joyride
 * (see `GuidedOverlay.test.tsx`), so this path was never actually exercised.
 * This file uses the REAL react-joyride to close that gap.
 *
 * #585: a stray pulsing "beacon" (`.react-joyride__beacon`) survived even
 * once the tour was complete — the prior test coverage here only asserted
 * `.react-joyride__overlay`/`.react-joyride__spotlight` absence, never the
 * beacon itself (a separate DOM node). Root cause: `Step.skipBeacon` was
 * never set (defaults to `false`), so every step showed the click-to-reveal
 * beacon; with no target to anchor to it fell back to the viewport origin
 * (top-left). Fixed via `skipBeacon: true` on every step + dismissing on
 * `EVENTS.TARGET_NOT_FOUND` in controlled mode.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { GuidedOverlay } from '../GuidedOverlay';
import type { GuidedFlowStateDto } from '../store';

function queryBeacons(): Element[] {
  return [
    ...document.querySelectorAll(
      '.react-joyride__beacon, [data-testid="button-beacon"]',
    ),
  ];
}

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

  it('does not leave an orphan spotlight/overlay/beacon when the anchor is absent', () => {
    render(
      <GuidedOverlay
        guidedState={makeState({ currentStep: 'project.create_first' })}
        onDismiss={() => {}}
      />,
    );

    // react-joyride portals its overlay/spotlight/beacon onto document.body.
    // With no matching target none of them may render (#585: the beacon is a
    // separate node from overlay/spotlight and previously leaked here).
    expect(document.querySelectorAll('.react-joyride__overlay').length).toBe(0);
    expect(document.querySelectorAll('.react-joyride__spotlight').length).toBe(
      0,
    );
    expect(queryBeacons().length).toBe(0);
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

  it('#585: never renders a beacon when the target anchor exists and the step is shown', () => {
    const anchor = document.createElement('div');
    anchor.setAttribute('data-guide-anchor', 'inbox.confirm-row');
    document.body.appendChild(anchor);

    render(
      <GuidedOverlay
        guidedState={makeState({ currentStep: 'inbox.confirm_first' })}
        onDismiss={() => {}}
      />,
    );

    // skipBeacon:true means the tooltip shows directly — no click-to-reveal
    // beacon at any point, target found or not.
    expect(queryBeacons().length).toBe(0);

    document.body.removeChild(anchor);
  });

  it('#585: no beacon/overlay/spotlight remains once the tour is complete (dismissed)', () => {
    render(
      <GuidedOverlay
        guidedState={makeState({
          currentStep: null,
          completedSteps: [
            'inbox.confirm_first',
            'project.create_first',
            'tool.open_first',
          ],
          dismissed: true,
          dismissedAt: now,
        })}
        onDismiss={() => {}}
      />,
    );

    expect(queryBeacons().length).toBe(0);
    expect(document.querySelectorAll('.react-joyride__overlay').length).toBe(0);
    expect(document.querySelectorAll('.react-joyride__spotlight').length).toBe(
      0,
    );
  });
});
