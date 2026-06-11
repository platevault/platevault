/**
 * Shell -- main application shell with sidebar, main content area, status bar.
 * Route hybrid layout: Inbox and Projects get their own right sidebar
 * handling (built into their pages). Other routes use full-width main.
 */

import { useEffect } from 'react';
import { Outlet, useNavigate } from '@tanstack/react-router';
import { usePreferences } from '@/data/preferences';
import { Sidebar } from './Sidebar';
import { StatusBar } from './StatusBar';
import { LogPanel } from './LogPanel';
import { CommandPalette } from './CommandPalette';
import { LogPanelProvider, useLogPanel } from './LogPanelContext';
import { OperationStatusProvider } from './OperationStatusContext';
import { ToastContainer } from '@/ui/ToastContainer';
import { GuidedOverlay } from '@/features/guided/GuidedOverlay';
import { useGuidedFlow } from '@/features/guided/useGuidedFlow';

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

  // Guided first-project-flow coach (spec 010).
  const guided = useGuidedFlow(prefs.setupCompleted);

  return (
    <div className={`alm-frame density-${prefs.density}`}>
      <div className="alm-frame__body">
        <Sidebar />
        <main className="alm-frame__main">
          <Outlet />
        </main>
      </div>
      {expanded && <LogPanel />}
      <StatusBar />
      <CommandPalette />
      <ToastContainer />
      {/* Guided overlay — non-blocking, portal-rendered (spec 010 FR-002) */}
      <GuidedOverlay
        guidedState={guided.state}
        onDismiss={() => void guided.dismiss()}
      />
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
