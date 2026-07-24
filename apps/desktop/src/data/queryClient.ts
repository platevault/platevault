// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import { QueryClient } from '@tanstack/react-query';

/**
 * Shared QueryClient singleton.
 *
 * Mounted in `main.tsx` via `QueryClientProvider`, and also imported by the
 * non-hook `call*` helpers in feature stores so they can invalidate queries
 * after a mutation. This restores the pre-TanStack 1:1 invalidation behaviour
 * for event-handler callers that use the async helpers instead of the
 * `use*Mutation` hooks (regression F1).
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Desktop app: alt-tabbing back must not refetch multi-MB target/session
      // queries. Queries that genuinely need fresh data on focus (e.g. status
      // health checks) already use refetchInterval and do not need this too.
      refetchOnWindowFocus: false,
    },
  },
});
