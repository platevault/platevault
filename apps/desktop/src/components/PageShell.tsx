/**
 * PageShell -- wraps every feature page with consistent loading, error,
 * and empty states.
 *
 * - `loading`: shows a loading message
 * - `error`: shows an error message
 * - `empty` + `hasData === false`: shows an EmptyState
 * - Otherwise: renders children
 *
 * Uses `.alm-page`, `.alm-page__loading`, `.alm-page__error` CSS classes.
 */

import type { ReactNode } from 'react';
import { EmptyState } from '@/ui';

export interface PageShellProps {
  testId: string;
  loading?: boolean;
  loadingMessage?: string;
  error?: Error | null;
  empty?: { title: string; description?: string; action?: ReactNode };
  hasData?: boolean;
  children: ReactNode;
}

export function PageShell({
  testId,
  loading,
  loadingMessage = 'Loading...',
  error,
  empty,
  hasData = true,
  children,
}: PageShellProps) {
  return (
    <div className="alm-page" data-testid={testId}>
      {loading ? (
        <div className="alm-page__loading" role="status">
          {loadingMessage}
        </div>
      ) : error ? (
        <div className="alm-page__error" role="alert">
          Error: {error.message}
        </div>
      ) : !hasData && empty ? (
        <EmptyState
          title={empty.title}
          description={empty.description}
          action={empty.action}
        />
      ) : (
        children
      )}
    </div>
  );
}
