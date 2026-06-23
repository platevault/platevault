import { forwardRef } from 'react';
import { m } from '@/lib/i18n';
import type { ReactNode, HTMLAttributes } from 'react';

export interface WizardStep {
  label: string;
  completed?: boolean;
}

export interface WizardShellProps extends HTMLAttributes<HTMLDivElement> {
  steps: WizardStep[];
  currentStep: number;
  children: ReactNode;
  /** Optional navigation footer pinned to the bottom (setup wizard style). */
  footer?: ReactNode;
  /** Optional summary sidebar on the right (project wizard style). */
  summary?: ReactNode;
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
  function WizardShell({ steps, currentStep, children, footer, summary, className, ...rest }, ref) {
    const hasSidebar = summary != null;
    const hasCenteredFooter = footer != null;
    const cls = ['alm-wizard', className].filter(Boolean).join(' ');

    return (
      <div
        ref={ref}
        className={cls}
        {...rest}
      >
        {/* Step progress bar */}
        {hasCenteredFooter && !hasSidebar ? (
          // Centered bar rendered inside scrollable body below
          null
        ) : (
          <nav
            className="alm-wizard__rail"
            aria-label={m.ui_wizard_progress_aria()}
          >
            {steps.map((step, i) => (
              <div
                key={step.label}
                className="alm-wizard__step"
                aria-current={i === currentStep ? 'step' : undefined}
              >
                <span
                  className="alm-wizard__step-badge"
                  // eslint-disable-next-line no-restricted-syntax -- dynamic: step-badge conditional token colors (active/completed/pending)
                  style={
                    i === currentStep
                      ? { background: 'var(--alm-ink)', color: 'var(--alm-on-accent)' }
                      : step.completed
                        ? { background: 'var(--alm-chip)', color: 'var(--alm-text-secondary)' }
                        : { background: 'transparent', border: '1.5px solid var(--alm-border)', color: 'var(--alm-text-faint)' }
                  }
                >
                  {step.completed && i !== currentStep ? '✓' : i + 1}
                </span>
                <span
                  className={'alm-wizard__step-label' + (i === currentStep ? ' alm-wizard__step-label--active' : '')}
                >
                  {step.label}
                </span>
                {i < steps.length - 1 && (
                  <span className="alm-wizard__step-connector" />
                )}
              </div>
            ))}
          </nav>
        )}

        {/* Body */}
        {hasSidebar ? (
          /* Sidebar layout (project wizard) */
          <div className="alm-wizard__body--sidebar">
            <div className="alm-wizard__content--sidebar">
              {children}
            </div>
            <aside className="alm-wizard__summary">
              {summary}
            </aside>
          </div>
        ) : (
          /* Centered layout (setup wizard) */
          <>
            <div className="alm-wizard__scroll">
              <div className="alm-wizard__content--centered">
                {/* Inline step bar for centered mode */}
                <nav
                  className="alm-wizard__steps-bar"
                  aria-label={m.ui_wizard_setup_progress_aria()}
                >
                  {steps.map((step, i) => {
                    const isActive = i === currentStep;
                    const isPast = i < currentStep;
                    return (
                      <div
                        key={step.label}
                        className={
                          'alm-wizard__steps-card' +
                          (isActive ? ' alm-wizard__steps-card--active' : isPast ? ' alm-wizard__steps-card--past' : '')
                        }
                        aria-current={isActive ? 'step' : undefined}
                      >
                        {i + 1}. {step.label}
                      </div>
                    );
                  })}
                </nav>

                {children}
              </div>
            </div>

            {/* Pinned navigation footer */}
            {hasCenteredFooter && (
              <div className="alm-wizard__footer">
                <div className="alm-wizard__footer-inner">
                  {footer}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    );
  }
);
WizardShell.displayName = 'WizardShell';
