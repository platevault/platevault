import { Button } from '@base-ui-components/react/button';

export interface StepWelcomeProps {
  onNext: () => void;
}

export function StepWelcome({ onNext }: StepWelcomeProps) {
  return (
    <div style={{ maxWidth: 520, margin: '0 auto', textAlign: 'center', paddingTop: 'var(--alm-space-9)' }}>
      <h1 style={{ fontSize: 'var(--alm-text-xl)', fontWeight: 700, marginBottom: 'var(--alm-space-4)' }}>
        Welcome to Astro Library Manager
      </h1>
      <p style={{ fontSize: 'var(--alm-text-sm)', color: 'var(--alm-text-muted)', lineHeight: 1.6, marginBottom: 'var(--alm-space-7)' }}>
        Organize your astrophotography library, map sessions to targets and projects,
        prepare inputs for PixInsight, and safely plan filesystem changes — all without
        touching your raw files.
      </p>
      <p style={{ fontSize: 'var(--alm-text-xs)', color: 'var(--alm-text-muted)', marginBottom: 'var(--alm-space-7)' }}>
        This setup will help you register your library folders and configure initial scan
        settings. It takes about a minute.
      </p>
      <Button
        className="alm-btn alm-btn--primary"
        onClick={onNext}
      >
        Get started
      </Button>
    </div>
  );
}
