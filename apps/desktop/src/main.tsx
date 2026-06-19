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

const root = document.getElementById('root')!;

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <RouterProvider router={router} />
    </AppErrorBoundary>
  </StrictMode>,
);
