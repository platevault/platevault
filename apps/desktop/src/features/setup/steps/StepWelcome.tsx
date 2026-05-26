export interface StepWelcomeProps {
  onNext: () => void;
}

/**
 * Step 1 — Welcome introduction.
 * The parent SetupWizard renders the step heading and navigation footer,
 * so this component only provides the step-specific content block.
 */
export function StepWelcome(_props: StepWelcomeProps) {
  return (
    <div style={{ maxWidth: 540 }}>
      <p
        style={{
          fontSize: 'var(--alm-text-sm)',
          color: 'var(--alm-text-muted)',
          lineHeight: 1.6,
          marginBottom: 'var(--alm-space-7)',
        }}
      >
        Organize your astrophotography library, map sessions to targets and projects,
        prepare inputs for PixInsight, and safely plan filesystem changes — all without
        touching your raw files.
      </p>
      <p
        style={{
          fontSize: 'var(--alm-text-xs)',
          color: 'var(--alm-text-muted)',
          lineHeight: 1.6,
        }}
      >
        This setup will help you register your library folders and configure initial scan
        settings. Nothing is moved or modified — and all choices are changeable later
        from Settings. It takes about a minute.
      </p>
    </div>
  );
}
