import { useEffect } from 'react';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { usePreferences } from '@/data/preferences';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { LogPanel } from './LogPanel';
import { CommandPalette } from './CommandPalette';
import { LogPanelProvider, useLogPanel } from './LogPanelContext';
import { OperationStatusProvider } from './OperationStatusContext';
import { TourProvider } from '@/features/tour/TourProvider';
import { ToastContainer } from '@/ui/ToastContainer';

function ShellInner() {
  const prefs = usePreferences();
  const { expanded } = useLogPanel();
  const navigate = useNavigate();

  // Redirect to /setup if first-run setup is not completed
  useEffect(() => {
    if (!prefs.setupCompleted) {
      navigate({ to: '/setup' });
    }
  }, [prefs.setupCompleted, navigate]);

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
      <ToastContainer />
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
