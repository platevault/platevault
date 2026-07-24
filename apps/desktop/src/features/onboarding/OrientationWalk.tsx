// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * First-run orientation walk (spec 056, T013/T014; US1, FR-001…FR-005).
 *
 * A modal, page-by-page tour built on the T009 joyride adapter. The adapter
 * already owns modality (focus trap kept: `disableFocusTrap` defaults false),
 * the `role="status"` aria-live announcer, and Escape-to-dismiss (default
 * `dismissKeyAction: 'close'`) — this module only drives step progression,
 * real route navigation per stop, and completion.
 *
 * Controlled mode: we own `stepIndex`; the adapter passes it to joyride, whose
 * `usePropSync` sets the absolute index. On each `step:after` we move our index
 * by the button direction; route navigation is a `useEffect` on `stepIndex`, so
 * navigation stays decoupled from joyride's event vocabulary. joyride's own
 * enum imports are confined to the adapter (research R2) — we match on the wire
 * strings and derive the event type from the adapter's prop.
 *
 * Auto-run gate (FR-001/FR-004): fires once per session when first-run is
 * complete, the backend `orientationDone` flag is false, and onboarding is not
 * suppressed. Finishing or skipping calls `onboarding.orientation.complete`,
 * which flips the backend flag so it never auto-runs again. Closing the app
 * mid-walk persists nothing, leaving it not-done. Replay (T015) is deliberately
 * independent of the flag.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { usePreference } from '@/data/preferences';
import {
  OnboardingJoyride,
  type OnboardingStep,
  type OnboardingJoyrideProps,
} from './joyrideAdapter';
import {
  useOnboardingState,
  isOnboardingSuppressed,
  completeOrientation,
  startOnboardingStateSync,
  consumeOrientationReplay,
  useOrientationReplayPending,
} from './store';
import { ORIENTATION_STOPS } from './orientationSteps';
import type { OnboardingOrientationOutcome } from '@/bindings/index';

/** The walk-event payload, sourced from the adapter so joyride stays confined. */
type WalkEvent = Parameters<NonNullable<OnboardingJoyrideProps['onEvent']>>[0];

// react-joyride EVENTS/ACTIONS wire strings (mirrored — imports live in the
// adapter). Kept minimal: only the values this walk reacts to.
const EV_STEP_AFTER = 'step:after';
const EV_TOUR_END = 'tour:end';
const EV_TARGET_NOT_FOUND = 'error:target_not_found';
const AC_PREV = 'prev';
const AC_CLOSE = 'close';
const AC_SKIP = 'skip';
const ST_SKIPPED = 'skipped';

export function OrientationWalk() {
  const navigate = useNavigate();
  const [setupCompleted] = usePreference('setupCompleted');
  const onboarding = useOnboardingState();
  // Subscribe to the replay signal so this effect re-runs when the Settings →
  // Advanced button fires requestOrientationReplay (T015). The component is
  // always mounted once setup completes, so there is no mount-timing race.
  const replayPending = useOrientationReplayPending();

  const [active, setActive] = useState(false);
  const [stepIndex, setStepIndex] = useState(0);
  const finishedRef = useRef(false);
  const autoLaunchedRef = useRef(false);

  // Hydrate the backend projection once (idempotent) so `orientationDone` and,
  // later, the checklists have state to read.
  useEffect(() => {
    void startOnboardingStateSync();
  }, []);

  const launch = useCallback(() => {
    finishedRef.current = false;
    setStepIndex(0);
    setActive(true);
  }, []);

  // Auto-run (FR-001/FR-004) + replay (T015).
  // For replay: when replayPending becomes true, consumeOrientationReplay()
  // clears it (preventing a second fire) and launches. The walk is always
  // mounted once setup completes so consume runs inside a stable component —
  // there is no Shell-level unmount race.
  useEffect(() => {
    if (active) return;
    if (!setupCompleted || !onboarding || isOnboardingSuppressed()) return;
    if (replayPending && consumeOrientationReplay()) {
      // Replay path: ignore orientationDone, allow re-launch after a finish.
      autoLaunchedRef.current = true;
      launch();
    } else if (!autoLaunchedRef.current && !onboarding.flags.orientationDone) {
      autoLaunchedRef.current = true;
      launch();
    }
  }, [setupCompleted, onboarding, active, replayPending, launch]);

  // Navigate to the current stop's real page (FR-002). Absent route = stay.
  useEffect(() => {
    if (!active) return;
    const route = ORIENTATION_STOPS[stepIndex]?.route;
    if (route) void navigate({ to: route });
  }, [active, stepIndex, navigate]);

  const finish = useCallback((outcome: OnboardingOrientationOutcome) => {
    if (finishedRef.current) return;
    finishedRef.current = true;
    setActive(false);
    void completeOrientation(outcome).catch((err) => {
      console.warn('[onboarding] orientation complete failed:', err);
    });
  }, []);

  const handleEvent = useCallback(
    (data: WalkEvent) => {
      if (finishedRef.current) return;
      const { type, action, index, status } = data;
      const isLast = index >= ORIENTATION_STOPS.length - 1;

      if (type === EV_STEP_AFTER) {
        if (action === AC_CLOSE || action === AC_SKIP) {
          finish('skipped'); // Escape routes here too (dismissKeyAction 'close').
        } else if (action === AC_PREV) {
          setStepIndex(index - 1);
        } else if (isLast) {
          finish('finished'); // Next on the final stop.
        } else {
          setStepIndex(index + 1);
        }
      } else if (type === EV_TOUR_END) {
        finish(status === ST_SKIPPED ? 'skipped' : 'finished');
      } else if (type === EV_TARGET_NOT_FOUND) {
        // Never wedge on a missing anchor (e.g. the section stop before T018
        // lands): finish at the end, otherwise step past it.
        if (isLast) finish('finished');
        else setStepIndex(index + (action === AC_PREV ? -1 : 1));
      }
    },
    [finish],
  );

  if (!active) return null;

  const steps: OnboardingStep[] = ORIENTATION_STOPS.map((stop) => ({
    target: stop.target,
    title: stop.title(),
    content: stop.body(),
    placement: stop.placement,
  }));

  return (
    <OnboardingJoyride
      steps={steps}
      stepIndex={stepIndex}
      continuous
      onEvent={handleEvent}
    />
  );
}
