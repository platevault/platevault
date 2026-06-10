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
              gap: 'var(--alm-space-3)',
              padding: 'var(--alm-space-5) var(--alm-space-7)',
              borderBottom: '1px solid var(--alm-border)',
            }}
          >
            {steps.map((step, i) => (
              <div
                key={step.label}
                className="alm-wizard__step"
                aria-current={i === currentStep ? 'step' : undefined}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-space-2)' }}
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
                    fontWeight: 600,
                    ...(i === currentStep
                      ? { background: 'var(--alm-gray-900)', color: '#fff' }
                      : step.completed
                        ? { background: 'var(--alm-gray-200)', color: 'var(--alm-gray-600)' }
                        : { background: 'transparent', border: '1.5px solid var(--alm-gray-300)', color: 'var(--alm-gray-400)' }),
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
                      background: 'var(--alm-gray-200)',
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
          <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
            <div style={{ flex: 1, overflow: 'auto', padding: 'var(--alm-space-7)' }}>
              {children}
            </div>
            <aside
              style={{
                width: 240,
                borderLeft: '1px solid var(--alm-border)',
                padding: 'var(--alm-space-7)',
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
                overflow: 'auto',
                padding: 'var(--alm-space-9) var(--alm-space-7)',
              }}
            >
              <div style={{ maxWidth: 720, margin: '0 auto' }}>
                {/* Inline step bar for centered mode */}
                <nav
                  aria-label="Setup progress"
                  style={{
                    display: 'flex',
                    gap: 'var(--alm-space-1)',
                    marginBottom: 'var(--alm-space-9)',
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
                          padding: 'var(--alm-space-2) var(--alm-space-3)',
                          border: '1px solid var(--alm-border)',
                          borderRadius: 'var(--alm-radius-sm)',
                          background: isPast || isActive ? 'var(--alm-surface)' : 'var(--alm-bg)',
                          fontSize: 'var(--alm-text-xs)',
                          textAlign: 'center',
                          color: isActive ? 'var(--alm-text)' : 'var(--alm-text-muted)',
                          fontWeight: isActive ? 600 : 400,
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
                  padding: 'var(--alm-space-5) var(--alm-space-7)',
                }}
              >
                <div
                  style={{
                    maxWidth: 720,
                    margin: '0 auto',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--alm-space-4)',
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
