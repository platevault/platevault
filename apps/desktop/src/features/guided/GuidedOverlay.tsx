/**
 * GuidedOverlay — controlled react-joyride coach overlay (spec 010, FR-011, spec 033 T030).
 *
 * Replaced the hand-rolled MutationObserver portal with a controlled <Joyride>
 * driven by `stepIndex`/`run` derived from the guided store (react-joyride 3.1 API).
 *
 * Key design decisions (D6):
 * - `blockTargetInteraction: false` per step — non-modal; user can interact with
 *   the app while the hint is visible (FR-011, equivalent to v2 `spotlightClicks: true`).
 * - `onEvent` callback drives dismiss on STATUS.FINISHED / STATUS.SKIPPED.
 * - Steps are derived from STEP_ORDER + STEP_HINT_TEXT + STEP_ANCHOR so the
 *   existing anchor constants (data-guide-anchor="…") remain in use.
 * - State machine, persistence, Settings restart, and store wiring are unchanged.
 *
 * Note: the dead `@media (prefers-reduced-motion: …)` inline style from the old
 * GuidedOverlay.tsx:188 has been removed (it was a no-op in React inline styles).
 */

import { Joyride, STATUS, type EventData, type Step } from 'react-joyride';
import { m } from '@/lib/i18n';
import {
  GUIDE_ANCHOR_ATTR,
  ANCHOR_INBOX_CONFIRM_ROW,
  ANCHOR_PROJECTS_CREATE_CTA,
  ANCHOR_PROJECT_OPEN_IN_TOOL,
} from './anchors';
import type { GuidedFlowStateDto } from './store';
import { STEP_HINT_TEXT, STEP_ORDER } from './store';

// ── Step → anchor id mapping ─────────────────────────────────────────────────

const STEP_ANCHOR: Record<string, string> = {
  'inbox.confirm_first': ANCHOR_INBOX_CONFIRM_ROW,
  'project.create_first': ANCHOR_PROJECTS_CREATE_CTA,
  'tool.open_first': ANCHOR_PROJECT_OPEN_IN_TOOL,
};

// ── Joyride step definitions ─────────────────────────────────────────────────

/**
 * Build the joyride Step array from STEP_ORDER + STEP_HINT_TEXT + STEP_ANCHOR.
 * The `target` uses the `data-guide-anchor` attribute selector so we reuse the
 * existing anchor constants without any DOM changes.
 * `blockTargetInteraction: false` makes each step non-modal (FR-011).
 */
function buildJoyrideSteps(): Step[] {
  return STEP_ORDER.map((id) => {
    const hint = STEP_HINT_TEXT[id] ?? { title: id, body: '' };
    const anchor = STEP_ANCHOR[id];
    return {
      target: anchor ? `[${GUIDE_ANCHOR_ATTR}="${anchor}"]` : 'body',
      title: hint.title,
      content: hint.body,
      // Non-modal: let the user click through the spotlight cutout (FR-011).
      blockTargetInteraction: false,
    };
  });
}

const JOYRIDE_STEPS: Step[] = buildJoyrideSteps();

// ── Props ────────────────────────────────────────────────────────────────────

export interface GuidedOverlayProps {
  /** Current coach state. Pass null to hide the overlay. */
  guidedState: GuidedFlowStateDto | null;
  /** Called when the user dismisses / finishes the guide. */
  onDismiss: () => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function GuidedOverlay({ guidedState, onDismiss }: GuidedOverlayProps) {
  const isDismissed = guidedState?.dismissed ?? true;
  const currentStep = guidedState?.currentStep ?? null;

  // `run` — joyride runs the tour when not dismissed and there is an active step.
  const run = !isDismissed && currentStep !== null;

  // `stepIndex` — derived from the current step id position in STEP_ORDER.
  const stepIndex = currentStep
    ? Math.max(
        0,
        STEP_ORDER.indexOf(currentStep as (typeof STEP_ORDER)[number]),
      )
    : 0;

  // onEvent: handle tour events in react-joyride 3.1 (replaces v2 `callback`).
  const handleEvent = (data: EventData) => {
    const { status } = data;

    if (status === STATUS.FINISHED || status === STATUS.SKIPPED) {
      onDismiss();
    }
  };

  if (!guidedState || isDismissed || currentStep === null) {
    return null;
  }

  return (
    <Joyride
      steps={JOYRIDE_STEPS}
      stepIndex={stepIndex}
      run={run}
      continuous={false}
      onEvent={handleEvent}
      options={{
        zIndex: 9000,
        primaryColor: 'var(--alm-accent, #7c6af7)',
        backgroundColor: 'var(--alm-surface, #1e1e2e)',
        textColor: 'var(--alm-text, #e2e2f0)',
        arrowColor: 'var(--alm-surface, #1e1e2e)',
        overlayColor: 'rgba(0,0,0,0.35)',
      }}
      locale={{
        skip: m.guided_coach_dismiss(),
        last: m.guided_coach_done(),
      }}
    />
  );
}
