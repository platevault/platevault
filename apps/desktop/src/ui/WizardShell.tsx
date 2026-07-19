// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { forwardRef } from 'react';
import { m } from '@/lib/i18n';
import type { ReactNode, HTMLAttributes } from 'react';

export interface WizardStep {
  label: string;
  completed?: boolean;
  /**
   * When true, this step is not reachable from the current step (issue #512) —
   * the step control renders as a disabled button that can't be jumped to.
   * Only consulted when `onStepSelect` is provided.
   */
  disabled?: boolean;
}

export interface WizardShellProps extends HTMLAttributes<HTMLDivElement> {
  steps: WizardStep[];
  currentStep: number;
  children: ReactNode;
  /** Optional navigation footer pinned to the bottom (setup wizard style). */
  footer?: ReactNode;
  /** Optional summary sidebar on the right (project wizard style). */
  summary?: ReactNode;
  /**
   * When provided, the centered step bar becomes interactive (issue #512):
   * each step renders as a real focusable button that calls this with the
   * target step index. Unreachable steps (`step.disabled`) are disabled.
   * Omit to keep the step bar display-only.
   */
  onStepSelect?: (index: number) => void;
}

/**
 * Wizard shell with a horizontal numbered step progress bar.
 *
 * Two layout modes:
 * - **Centered** (setup wizard): when `footer` is provided and `summary` is not,
 *   content is centered at max-width 720px with a pinned navigation footer.
 * - **Sidebar** (project wizard): when `summary` is provided, content fills the
 *   left column with a 240px summary rail on the right.
 */
export const WizardShell = forwardRef<HTMLDivElement, WizardShellProps>(
  function WizardShell(
    {
      steps,
      currentStep,
      children,
      footer,
      summary,
      onStepSelect,
      className,
      ...rest
    },
    ref,
  ) {
    const hasSidebar = summary != null;
    const hasCenteredFooter = footer != null;
    const cls = ['pv-wizard', className].filter(Boolean).join(' ');

    return (
      <div ref={ref} className={cls} {...rest}>
        {/* Step progress bar */}
        {hasCenteredFooter &&
        !hasSidebar ? // Centered bar rendered inside scrollable body below
        null : (
          <nav
            className="pv-wizard__rail"
            aria-label={m.ui_wizard_progress_aria()}
          >
            {steps.map((step, i) => (
              <div
                key={step.label}
                className="pv-wizard__step"
                aria-current={i === currentStep ? 'step' : undefined}
              >
                <span
                  className="pv-wizard__step-badge"
                  // eslint-disable-next-line no-restricted-syntax -- dynamic: step-badge conditional token colors (active/completed/pending)
                  style={
                    i === currentStep
                      ? {
                          background: 'var(--pv-ink)',
                          color: 'var(--pv-on-accent)',
                        }
                      : step.completed
                        ? {
                            background: 'var(--pv-chip)',
                            color: 'var(--pv-text-secondary)',
                          }
                        : {
                            background: 'transparent',
                            border: '1.5px solid var(--pv-border)',
                            color: 'var(--pv-text-faint)',
                          }
                  }
                >
                  {step.completed && i !== currentStep ? '✓' : i + 1}
                </span>
                <span
                  className={
                    'pv-wizard__step-label' +
                    (i === currentStep ? ' pv-wizard__step-label--active' : '')
                  }
                >
                  {step.label}
                </span>
                {i < steps.length - 1 && (
                  <span className="pv-wizard__step-connector" />
                )}
              </div>
            ))}
          </nav>
        )}

        {/* Body */}
        {hasSidebar ? (
          /* Sidebar layout (project wizard) */
          <div className="pv-wizard__body--sidebar">
            <div className="pv-wizard__content--sidebar">{children}</div>
            <aside className="pv-wizard__summary">{summary}</aside>
          </div>
        ) : (
          /* Centered layout (setup wizard) */
          <>
            <div className="pv-wizard__scroll">
              <div className="pv-wizard__content--centered">
                {/* Inline step bar for centered mode */}
                <nav
                  className="pv-wizard__steps-bar"
                  aria-label={m.ui_wizard_setup_progress_aria()}
                >
                  {steps.map((step, i) => {
                    const isActive = i === currentStep;
                    const isPast = i < currentStep;
                    const cardClass =
                      'pv-wizard__steps-card' +
                      (isActive
                        ? ' pv-wizard__steps-card--active'
                        : isPast
                          ? ' pv-wizard__steps-card--past'
                          : '');
                    const label = `${i + 1}. ${step.label}`;
                    // Issue #512: when navigation is wired, render each step as
                    // a real focusable button so completed/reachable steps can
                    // be jumped to via mouse or keyboard; unreachable steps are
                    // disabled. Falls back to an inert div otherwise (e.g. the
                    // project wizard, which navigates only via Back/Continue).
                    return onStepSelect ? (
                      <button
                        key={step.label}
                        type="button"
                        className={cardClass}
                        aria-current={isActive ? 'step' : undefined}
                        disabled={step.disabled}
                        onClick={() => onStepSelect(i)}
                      >
                        {label}
                      </button>
                    ) : (
                      <div
                        key={step.label}
                        className={cardClass}
                        aria-current={isActive ? 'step' : undefined}
                      >
                        {label}
                      </div>
                    );
                  })}
                </nav>

                {children}
              </div>
            </div>

            {/* Pinned navigation footer */}
            {hasCenteredFooter && (
              <div className="pv-wizard__footer">
                <div className="pv-wizard__footer-inner">{footer}</div>
              </div>
            )}
          </>
        )}
      </div>
    );
  },
);
WizardShell.displayName = 'WizardShell';
