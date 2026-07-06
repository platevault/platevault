import './styles/reset.css';
import './styles/tokens.css';
import './styles/components.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { router } from './app/router';
import { AppErrorBoundary } from './app/AppErrorBoundary';
import { queryClient } from './data/queryClient';
import { initAppearance } from './data/theme';

// Apply the persisted theme + density to <html> before first paint, and wire
// OS light/dark changes for the `system` choice.
initAppearance();

// T075 / SC-002: Install the recording proxy at boot in dev-tools builds.
// VITE_DEV_TOOLS is statically "false" in release builds, so this branch and
// the bootRecorder/recorder chunks are tree-shaken by the bundler (FR-031).
if (import.meta.env.VITE_DEV_TOOLS === 'true') {
  void import('./dev/bootRecorder').then(({ installRecorder }) =>
    import('./dev/recorder').then(({ wrap }) => installRecorder(wrap)),
  );
}

// Feature 037 US3: expose a real IPC invoke bridge for the WebdriverIO E2E
// journeys. `withGlobalTauri` is off, so `window.__TAURI__` is unavailable in the
// webview; this gives the journeys a way to assert UI -> real-backend round-trips
// (e.g. `roots_list`) over the *real* IPC path. VITE_E2E is statically falsy in
// production builds, so this branch and the ipc chunk reference are tree-shaken
// out (mirrors the VITE_DEV_TOOLS gate above and the VITE_E2E path override).
//
// Fix-lane round 5 (PR #477, `inbox_ui_mixed_folder_splits_into_single_type_items`
// Windows-only failure): the same VITE_E2E gate also buffers uncaught
// errors/rejections into `window.__e2eErrors` and exposes the shared
// `queryClient` + a build-time marker on `window.__ALM_E2E__`, so a failing
// real-UI journey can dump (a) whether the UI's own IPC channel ever errored
// (vs. the diagnostic invoke, which bypasses the app's normal query path) and
// (c) whether the served dist is the commit under test. Installed
// synchronously (not inside the dynamic `import()` below) so it captures
// errors from the very first tick, before the ipc chunk resolves.
if (import.meta.env.VITE_E2E) {
  const e2eErrors: string[] = [];
  (window as Window & { __e2eErrors?: string[] }).__e2eErrors = e2eErrors;
  window.addEventListener('error', (event) => {
    e2eErrors.push(`error: ${event.message}`);
  });
  window.addEventListener('unhandledrejection', (event) => {
    e2eErrors.push(`unhandledrejection: ${String(event.reason)}`);
  });

  void import('./api/ipc').then(({ invoke }) => {
    (
      window as Window & {
        __ALM_E2E__?: {
          invoke: typeof invoke;
          queryClient: typeof queryClient;
          buildTime: string;
        };
      }
    ).__ALM_E2E__ = {
      invoke,
      queryClient,
      buildTime: String(import.meta.env.VITE_BUILD_TIME ?? 'unknown'),
    };
  });
}

const root = document.getElementById('root')!;

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AppErrorBoundary>
        <RouterProvider router={router} />
      </AppErrorBoundary>
    </QueryClientProvider>
  </StrictMode>,
);
