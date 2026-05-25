import { useEffect } from 'react';
import { Outlet, useNavigate, useLocation } from '@tanstack/react-router';
import { usePreferences } from '@/data/preferences';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { LogPanel } from './LogPanel';
import { CommandPalette } from './CommandPalette';
import { LogPanelProvider, useLogPanel } from './LogPanelContext';
import { OperationStatusProvider } from './OperationStatusContext';
import { TourProvider } from '@/features/tour/TourProvider';

function ShellInner() {
  const prefs = usePreferences();
  const { expanded } = useLogPanel();
  const navigate = useNavigate();
  const location = useLocation();

  // Redirect to /setup if first-run setup is not completed
  useEffect(() => {
    if (!prefs.setupCompleted && location.pathname !== '/setup') {
      navigate({ to: '/setup' });
    }
  }, [prefs.setupCompleted, location.pathname, navigate]);

  return (
    <div className={`alm-shell density-${prefs.density}`}>
      <div className="alm-shell__body">
        <Sidebar />
        <main className="alm-shell__main">
          <TourProvider>
            <Outlet />
          </TourProvider>
        </main>
      </div>
      {expanded && <LogPanel />}
      <StatusBar />
      <CommandPalette />
    </div>
  );
}

export function Shell() {
  return (
    <OperationStatusProvider>
      <LogPanelProvider>
        <ShellInner />
      </LogPanelProvider>
    </OperationStatusProvider>
  );
}
