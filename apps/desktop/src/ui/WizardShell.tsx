import type { ReactNode } from 'react';
import { clsx } from 'clsx';

export interface WizardStep {
  label: string;
  completed?: boolean;
}

export interface WizardShellProps {
  steps: WizardStep[];
  currentStep: number;
  summary: ReactNode;
  children: ReactNode;
}

export function WizardShell({ steps, currentStep, summary, children }: WizardShellProps) {
  return (
    <div className="alm-wizard" style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
      {/* Step rail */}
      <nav className="alm-wizard__rail" style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-space-3)', padding: 'var(--alm-space-5) var(--alm-space-7)', borderBottom: '1px solid var(--alm-border)' }}>
        {steps.map((step, i) => (
          <div
            key={step.label}
            className="alm-wizard__step"
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--alm-space-2)' }}
          >
            <span
              className={clsx('alm-wizard__indicator')}
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
            <span style={{ fontSize: 'var(--alm-text-xs)', color: i === currentStep ? 'var(--alm-text)' : 'var(--alm-text-muted)' }}>
              {step.label}
            </span>
            {i < steps.length - 1 && (
              <span style={{ width: 16, height: 1, background: 'var(--alm-gray-200)', display: 'inline-block' }} />
            )}
          </div>
        ))}
      </nav>

      {/* Body: content + summary */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        <div style={{ flex: 1, overflow: 'auto', padding: 'var(--alm-space-7)' }}>
          {children}
        </div>
        <aside style={{ width: 240, borderLeft: '1px solid var(--alm-border)', padding: 'var(--alm-space-7)', overflow: 'auto', background: 'var(--alm-surface)' }}>
          {summary}
        </aside>
      </div>
    </div>
  );
}
