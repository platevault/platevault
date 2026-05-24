import { usePreference } from '@/data/preferences';
import { useNavigate } from '@tanstack/react-router';
import { useEffect } from 'react';
import { SetupWizard } from './SetupWizard';

export function SetupPage() {
  const [setupCompleted] = usePreference('setupCompleted');
  const navigate = useNavigate();

  // If setup is already completed, redirect away — wizard is one-time only
  useEffect(() => {
    if (setupCompleted) {
      navigate({ to: '/sessions' });
    }
  }, [setupCompleted, navigate]);

  if (setupCompleted) {
    return null;
  }

  return <SetupWizard />;
}
