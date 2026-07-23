// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { Fragment } from "react";

export interface StepperStep {
  id: string;
  label: string;
}

export interface StepperProps {
  steps: StepperStep[];
  currentStepId: string;
  caption?: string;
}

/**
 * Horizontal lifecycle stepper. Used in entity drawer headers (Projects, Plans).
 * Plain dots + labels, no fancy chrome.
 */
export function Stepper({ steps, currentStepId, caption }: StepperProps) {
  const currentIndex = steps.findIndex((s) => s.id === currentStepId);
  return (
    <div>
      <div className="alm-stepper" role="list" aria-label="Lifecycle">
        {steps.map((step, idx) => {
          const status =
            idx < currentIndex ? "done" : idx === currentIndex ? "current" : "upcoming";
          return (
            <Fragment key={step.id}>
              <span className="alm-stepper__step" role="listitem" data-status={status}>
                <span className="alm-stepper__dot" aria-hidden="true" />
                <span>{step.label}</span>
              </span>
              {idx < steps.length - 1 ? (
                <span className="alm-stepper__sep" aria-hidden="true">
                  —
                </span>
              ) : null}
            </Fragment>
          );
        })}
      </div>
      {caption ? <div className="alm-stepper__caption">{caption}</div> : null}
    </div>
  );
}
