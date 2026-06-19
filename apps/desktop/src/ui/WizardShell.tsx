import { forwardRef } from 'react';
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
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          overflow: 'hidden',
        }}
        {...rest}
      >
        {/* Step progress bar */}
        {hasCenteredFooter && !hasSidebar ? (
          // Centered bar rendered inside scrollable body below
          null
        ) : (
          <nav
            className="alm-wizard__rail"
            aria-label="Wizard progress"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--alm-sp-3)',
              padding: 'var(--alm-sp-4) var(--alm-sp-5)',
              borderBottom: '1px solid var(--alm-border)',
              flexShrink: 0,
            }}
          >
            {steps.map((step, i) => (
              <div
                key={step.label}
                className="alm-wizard__step"
                aria-current={i === currentStep ? 'step' : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-sp-2)' }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    width: 20,
                    height: 20,
                    borderRadius: '50%',
                    fontSize: 'var(--alm-text-xs)',
                    fontWeight: 'var(--alm-weight-semibold)',
                    ...(i === currentStep
                      ? { background: 'var(--alm-ink)', color: 'var(--alm-on-accent)' }
                      : step.completed
                        ? { background: 'var(--alm-chip)', color: 'var(--alm-text-secondary)' }
                        : { background: 'transparent', border: '1.5px solid var(--alm-border)', color: 'var(--alm-text-faint)' }),
                  }}
                >
                  {step.completed && i !== currentStep ? '✓' : i + 1}
                </span>
                <span
                  style={{
                    fontSize: 'var(--alm-text-xs)',
                    color: i === currentStep ? 'var(--alm-text)' : 'var(--alm-text-muted)',
                  }}
                >
                  {step.label}
                </span>
                {i < steps.length - 1 && (
                  <span
                    style={{
                      width: 16,
                      height: 1,
                      background: 'var(--alm-border-subtle)',
                      display: 'inline-block',
                    }}
                  />
                )}
              </div>
            ))}
          </nav>
        )}

        {/* Body */}
        {hasSidebar ? (
          /* Sidebar layout (project wizard) */
          <div style={{ display: 'flex', flex: 1, minHeight: 0, overflow: 'hidden' }}>
            <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 'var(--alm-sp-5)' }}>
              {children}
            </div>
            <aside
              style={{
                width: 'var(--alm-rail-width)',
                borderLeft: '1px solid var(--alm-border)',
                padding: 'var(--alm-sp-5)',
                overflow: 'auto',
                background: 'var(--alm-surface)',
              }}
            >
              {summary}
            </aside>
          </div>
        ) : (
          /* Centered layout (setup wizard) */
          <>
            <div
              style={{
                flex: 1,
                minHeight: 0,
                overflow: 'auto',
                padding: 'var(--alm-sp-6) var(--alm-sp-5)',
              }}
            >
              <div style={{ maxWidth: 720, margin: '0 auto' }}>
                {/* Inline step bar for centered mode */}
                <nav
                  aria-label="Setup progress"
                  style={{
                    display: 'flex',
                    gap: 'var(--alm-sp-1)',
                    marginBottom: 'var(--alm-sp-6)',
                  }}
                >
                  {steps.map((step, i) => {
                    const isActive = i === currentStep;
                    const isPast = i < currentStep;
                    return (
                      <div
                        key={step.label}
                        aria-current={isActive ? 'step' : undefined}
                        style={{
                          flex: 1,
                          padding: 'var(--alm-sp-2) var(--alm-sp-3)',
                          border: '1px solid var(--alm-border)',
                          borderRadius: 'var(--alm-radius-sm)',
                          background: isPast || isActive ? 'var(--alm-surface)' : 'var(--alm-bg)',
                          fontSize: 'var(--alm-text-xs)',
                          textAlign: 'center',
                          color: isActive ? 'var(--alm-text)' : 'var(--alm-text-muted)',
                          fontWeight: isActive ? 'var(--alm-weight-semibold)' : 'var(--alm-weight-normal)',
                        }}
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
              <div
                style={{
                  borderTop: '1px solid var(--alm-border)',
                  padding: 'var(--alm-sp-4) var(--alm-sp-5)',
                  flexShrink: 0,
                  background: 'var(--alm-surface)',
                }}
              >
                <div
                  style={{
                    maxWidth: 720,
                    margin: '0 auto',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--alm-sp-4)',
                  }}
                >
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
