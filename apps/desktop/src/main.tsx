import './styles/reset.css';
import './styles/tokens.css';
import './styles/components.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from '@tanstack/react-router';
import { router } from './app/router';
import { AppErrorBoundary } from './app/AppErrorBoundary';

const root = document.getElementById('root')!;

createRoot(root).render(
  <StrictMode>
    <AppErrorBoundary>
      <RouterProvider router={router} />
    </AppErrorBoundary>
  </StrictMode>,
);
