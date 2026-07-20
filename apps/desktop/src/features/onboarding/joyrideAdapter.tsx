// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * react-joyride v3 adapter (spec 056, T009; research R2/R3).
 *
 * The ONLY module that imports `react-joyride` — all engine state (item
 * registry, activation, ticks, walk progress) is library-agnostic in the
 * store/backend; joyride receives only derived `steps`/`stepIndex`. This keeps
 * the pre-approved `@floating-ui/react` fallback (R1) a one-module swap.
 *
 * Spike-verified binding rules (research R2, GO verdict):
 *  1. Our `tooltipComponent` MUST NOT spread joyride's `tooltipProps` — that
 *     spread is the ONLY source of `role="alertdialog"`/`aria-modal` in the
 *     DOM. We set our own `role="region"` + a `role="status"` aria-live
 *     announcer built from the step title/content instead (VC-002: no modal
 *     ARIA anywhere).
 *  2. Focus trap is ARIA-independent and set PER LAYER via `disableFocusTrap`:
 *     the modal orientation walk keeps the trap (`disableFocusTrap: false`);
 *     non-modal L3 spotlights pass `disableFocusTrap: true`. The trap
 *     autofocuses `[data-action=primary]`, so the primary button carries that
 *     attribute.
 *  3. Escape-to-dismiss is free via joyride's default `dismissKeyAction:
 *     'close'` — no custom key handling (FR-003/FR-023).
 *  4. Issue #1211: `run=true` at mount with async-hydrating steps renders
 *     nothing. Every mount MUST gate `run={steps.length > 0}` — done here so
 *     no consumer can forget.
 */

import type { ReactNode } from 'react';
import { Joyride } from 'react-joyride';
import type {
  EventData,
  Step,
  Styles,
  TooltipRenderProps,
} from 'react-joyride';
import { m } from '@/lib/i18n';
import { Btn } from '@/ui';
import './walk.css';

/** A library-agnostic onboarding step. Consumers build these; the adapter maps
 * them to joyride's `Step` so joyride's types never leak past this module. */
export interface OnboardingStep {
  /** CSS selector or element the spotlight targets. */
  target: string | HTMLElement;
  /** Localized short title (also the announced/region label). */
  title: string;
  /** Localized body — any React node (our chrome, not an HTML string). */
  content: ReactNode;
  placement?: Step['placement'];
  /**
   * Open the step immediately instead of showing joyride's click-to-open
   * beacon (v3 `skipBeacon`). The L4 find spotlight is a single step and must
   * appear on activation, so it sets this.
   */
  skipBeacon?: boolean;
}

function toJoyrideStep(step: OnboardingStep): Step {
  return {
    target: step.target,
    title: step.title,
    content: step.content,
    placement: step.placement,
    ...(step.skipBeacon !== undefined && { skipBeacon: step.skipBeacon }),
  };
}

/**
 * Custom tooltip: our own chrome + ARIA. Deliberately does NOT spread
 * `tooltipProps` (rule 1). The visually-hidden `role="status"` region
 * announces progress + title on each step (WCAG, R11). The primary button
 * carries `data-action="primary"` so the focus trap's autofocus lands on it
 * (rule 2).
 */
function OnboardingTooltip({
  step,
  index,
  size,
  isLastStep,
  backProps,
  primaryProps,
  skipProps,
  closeProps,
}: TooltipRenderProps): ReactNode {
  const title = typeof step.title === 'string' ? step.title : undefined;
  return (
    <div className="pv-onboarding-tooltip" role="region" aria-label={title}>
      <div className="pv-visually-hidden" role="status" aria-live="polite">
        {m.onboarding_announcer_progress({
          current: index + 1,
          total: size,
        })}
        {title ? ` — ${title}` : ''}
      </div>

      <div className="pv-onboarding-tooltip__header">
        {step.title ? (
          <h2 className="pv-onboarding-tooltip__title">{step.title}</h2>
        ) : null}
        <Btn
          variant="ghost"
          size="sm"
          className="pv-onboarding-tooltip__close"
          aria-label={closeProps['aria-label']}
          onClick={closeProps.onClick}
        >
          {m.onboarding_walk_close()}
        </Btn>
      </div>

      <div className="pv-onboarding-tooltip__body">{step.content}</div>

      <div className="pv-onboarding-tooltip__footer">
        <Btn
          variant="ghost"
          size="sm"
          className="pv-onboarding-tooltip__skip"
          onClick={skipProps.onClick}
        >
          {m.onboarding_walk_skip()}
        </Btn>
        <div className="pv-onboarding-tooltip__nav">
          {index > 0 ? (
            <Btn
              variant="ghost"
              size="sm"
              className="pv-onboarding-tooltip__back"
              onClick={backProps.onClick}
            >
              {m.onboarding_walk_back()}
            </Btn>
          ) : null}
          <Btn
            variant="primary"
            size="sm"
            data-action="primary"
            className="pv-onboarding-tooltip__primary"
            onClick={primaryProps.onClick}
          >
            {isLastStep ? m.onboarding_walk_finish() : m.onboarding_walk_next()}
          </Btn>
        </div>
      </div>
    </div>
  );
}

export interface OnboardingJoyrideProps {
  steps: OnboardingStep[];
  /** Controlled step index (walk drives this from the store). */
  stepIndex?: number;
  /** Sequential Next-button flow. Walk: true; single-step spotlight: false. */
  continuous?: boolean;
  /**
   * Per-layer focus trap (rule 2). Walk = false (KEEP the trap, modal by
   * design); L3 spotlight = true (non-modal, never steals focus).
   */
  disableFocusTrap?: boolean;
  /**
   * What clicking the dimmed overlay does (v3 `options.overlayClickAction`).
   * Undefined = joyride default (walk keeps it). The L4 find spotlight sets
   * `'close'` so "click anywhere else" dismisses (FR-023).
   */
  overlayClickAction?: 'close' | 'next' | 'replay' | false;
  /**
   * Whether the spotlit control is click-blocked (v3
   * `options.blockTargetInteraction`). The find spotlight leaves this false so
   * the user can click the real control through the cutout (FR-022).
   */
  blockTargetInteraction?: boolean;
  /** Spotlight outline styling (v3 `styles.spotlight`) — R11 static outline. */
  spotlightStyle?: Styles['spotlight'];
  /** Joyride lifecycle events (step change, close, skip) — passthrough. */
  onEvent?: (data: EventData) => void;
}

/**
 * The shared onboarding joyride mount. Always gates `run` on non-empty steps
 * (rule 4). Escape closes via joyride's default `dismissKeyAction` (rule 3) —
 * intentionally not overridden here.
 */
export function OnboardingJoyride({
  steps,
  stepIndex,
  continuous = true,
  disableFocusTrap = false,
  overlayClickAction,
  blockTargetInteraction,
  spotlightStyle,
  onEvent,
}: OnboardingJoyrideProps): ReactNode {
  const joyrideSteps = steps.map(toJoyrideStep);
  return (
    <Joyride
      steps={joyrideSteps}
      run={joyrideSteps.length > 0}
      stepIndex={stepIndex}
      continuous={continuous}
      tooltipComponent={OnboardingTooltip}
      options={{
        disableFocusTrap,
        ...(overlayClickAction !== undefined && { overlayClickAction }),
        ...(blockTargetInteraction !== undefined && {
          blockTargetInteraction,
        }),
      }}
      {...(spotlightStyle && { styles: { spotlight: spotlightStyle } })}
      onEvent={onEvent}
    />
  );
}
