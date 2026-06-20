import './styles/reset.css';
import './styles/tokens.css';
import './styles/components.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './app/router';
import { AppErrorBoundary } from './app/AppErrorBoundary';

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
if (import.meta.env.VITE_E2E) {
  void import('./api/ipc').then(({ invoke }) => {
    (window as unknown as { __ALM_E2E__?: { invoke: typeof invoke } }).__ALM_E2E__ =
      { invoke };
  });
}

const root = document.getElementById('root')!;

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <RouterProvider router={router} />
    </AppErrorBoundary>
  </StrictMode>,
);
