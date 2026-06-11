/**
 * AppErrorBoundary — spec 028 C2.
 *
 * React class component error boundary. Catches uncaught render errors in the
 * component tree and shows a recoverable fallback instead of a white screen.
 *
 * Usage:
 *   - App shell: wraps <RouterProvider /> in main.tsx
 *   - Per-route: can be used around any lazy-loaded page component
 *
 * React error boundaries must be class components (hooks cannot catch errors).
 */

import { Component } from 'react';
import type { ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  /** Optional custom fallback. Receives the error for display. */
  fallback?: (error: Error, reset: () => void) => ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class AppErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Log to console so dev tools and the bottom log viewer can surface it.
    console.error('[AppErrorBoundary] Uncaught render error:', error, info.componentStack);
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    const { hasError, error } = this.state;
    const { children, fallback } = this.props;

    if (hasError && error) {
      if (fallback) {
        return fallback(error, this.handleReset);
      }
      return (
        <div
          role="alert"
          data-testid="app-error-boundary-fallback"
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            height: '100vh',
            gap: 'var(--alm-sp-4)',
            padding: 'var(--alm-sp-6)',
            fontFamily: 'var(--alm-font-sans)',
            color: 'var(--alm-text)',
            background: 'var(--alm-bg)',
          }}
        >
          <h1
            style={{
              fontSize: 'var(--alm-text-xl)',
              fontWeight: 'var(--alm-weight-semibold)',
              color: 'var(--alm-danger)',
              margin: 0,
            }}
          >
            Something went wrong
          </h1>
          <p
            style={{
              fontSize: 'var(--alm-text-base)',
              color: 'var(--alm-text-secondary)',
              margin: 0,
              maxWidth: 480,
              textAlign: 'center',
            }}
          >
            An unexpected error occurred in the application. You can try reloading the view or
            restarting the app if the problem persists.
          </p>
          {error.message && (
            <pre
              style={{
                fontSize: 'var(--alm-text-xs)',
                color: 'var(--alm-text-muted)',
                background: 'var(--alm-surface)',
                border: '1px solid var(--alm-border)',
                borderRadius: 'var(--alm-radius-sm)',
                padding: 'var(--alm-sp-3)',
                maxWidth: 480,
                overflow: 'auto',
                margin: 0,
              }}
            >
              {error.message}
            </pre>
          )}
          <button
            type="button"
            onClick={this.handleReset}
            data-testid="app-error-boundary-reset"
            style={{
              padding: 'var(--alm-sp-2) var(--alm-sp-4)',
              background: 'var(--alm-accent)',
              color: 'var(--alm-on-accent)',
              border: 'none',
              borderRadius: 'var(--alm-radius-sm)',
              cursor: 'pointer',
              fontSize: 'var(--alm-text-base)',
              fontWeight: 'var(--alm-weight-medium)',
            }}
          >
            Try again
          </button>
        </div>
      );
    }

    return children;
  }
}
