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
import { PageStatusProvider } from './PageStatusContext';
import { ToastContainer } from '@/ui/ToastContainer';
import { GuidedOverlay } from '@/features/guided/GuidedOverlay';
import { useGuidedFlow } from '@/features/guided/useGuidedFlow';
import {
  startGuidedEventBridge,
  stopGuidedEventBridge,
} from '@/features/guided/eventBridge';
import { loadObservingState } from '@/features/targets/observing-sites/site-store';
import {
  startUpdateSubscription,
  stopUpdateSubscription,
} from '@/data/updateSubscription';

function ShellInner() {
  const prefs = usePreferences();
  const { expanded } = useLogPanel();
  const navigate = useNavigate();

  // Redirect to /setup if first-run setup is not completed
  useEffect(() => {
    if (!prefs.setupCompleted) {
      void navigate({ to: '/setup' });
    }
  }, [prefs.setupCompleted, navigate]);

  // Spec 044 Track B: hydrate the observing-site live cache once per app
  // session so `useActiveSite()`/`useObservingState()` reflect the persisted
  // sites/threshold immediately (without this, every planner consumer would
  // be stuck on the no-site EMPTY_STATE forever, since nothing else in the
  // app currently calls `loadObservingState()`).
  useEffect(() => {
    if (!prefs.setupCompleted) return;
    void loadObservingState();
  }, [prefs.setupCompleted]);

  // Guided first-project-flow coach (spec 010).
  const guided = useGuidedFlow(prefs.setupCompleted);

  // Spec 033 US2/T029: drive guided auto-advance off real domain events.
  useEffect(() => {
    if (!prefs.setupCompleted) return undefined;
    void startGuidedEventBridge();
    return () => stopGuidedEventBridge();
  }, [prefs.setupCompleted]);

  // Spec 051 US10 (T058): listen for the backend's startup `update-available`
  // event for the whole app session, so it's captured even if the user
  // hasn't opened Settings > Advanced yet.
  useEffect(() => {
    void startUpdateSubscription();
    return () => stopUpdateSubscription();
  }, []);

  // Spec 051 US5 (T033): native "Settings…" application-menu item — no
  // native dialog of its own, so the backend emits an event and this
  // listener navigates to the existing Settings route. In mock/test mode
  // (VITE_USE_MOCKS=true) there's no native menu to listen for, matching the
  // convention already used by logSubscription.ts/updateSubscription.ts.
  useEffect(() => {
    if (import.meta.env.VITE_USE_MOCKS === 'true') return undefined;

    let unlisten: (() => void) | undefined;
    let cancelled = false;
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        const fn = await listen('menu:open-settings', () => {
          void navigate({ to: '/settings' });
        });
        if (cancelled) {
          fn();
        } else {
          unlisten = fn;
        }
      } catch (err) {
        console.warn('[Shell] menu:open-settings listen failed:', err);
      }
    })();
    return () => {
      cancelled = true;
      unlisten?.();
    };
  }, [navigate]);

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
      <PageStatusProvider>
        <LogPanelProvider>
          <ShellInner />
        </LogPanelProvider>
      </PageStatusProvider>
    </OperationStatusProvider>
  );
}
