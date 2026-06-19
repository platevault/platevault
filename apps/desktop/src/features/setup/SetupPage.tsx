import { usePreference } from '@/data/preferences';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { SetupWizard } from './SetupWizard';

export function SetupPage() {
  const [setupCompleted] = usePreference('setupCompleted');
  const navigate = useNavigate();
  const [checking, setChecking] = useState(!setupCompleted);

  useEffect(() => {
    if (setupCompleted) {
      void navigate({ to: '/inbox' });
      return;
    }

    const useMocks = import.meta.env.VITE_USE_MOCKS === 'true';
    if (useMocks) {
      setChecking(false);
      return;
    }

    let cancelled = false;
    import('@/bindings/index')
      .then(({ commands }) => commands.firstrunState())
      .then((result) => {
        if (cancelled) return;
        if (result.status === 'ok' && Boolean(result.data.completedAt)) {
          void navigate({ to: '/inbox' });
        } else {
          setChecking(false);
        }
      })
      .catch(() => {
        if (!cancelled) setChecking(false);
      });
    return () => { cancelled = true; };
  }, [setupCompleted, navigate]);

  if (setupCompleted || checking) {
    return (
      <div className="alm-page" style={{ justifyContent: 'center', alignItems: 'center', color: 'var(--alm-text-muted)' }}>
        Loading…
      </div>
    );
  }

  return (
    <div className="alm-page">
      <SetupWizard />
    </div>
  );
}
