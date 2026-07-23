// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Sessions / Inventory store — spec 006, TanStack Query.
 *
 * Wraps inventoryList behind a useQuery hook. Filter changes invalidate the
 * inventory key so the page re-fetches.
 *
 * Spec 041 FR-051 (T076, Phase 13): sessions are derived, already-confirmed
 * inventory. The `inventorySessionReview` mutation (and the
 * useSessionReview/useInventorySessionReview hooks that wrapped it) were
 * removed along with the review-state machine.
 */

import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import { ipcArgs } from '@/lib/ipc-args';
import type {
  InventoryListResponse,
  InventoryListRequest,
  InventoryFrameType,
  SessionNotesUpdateResult,
} from '@/bindings/index';

export type { InventoryListResponse };
export type { InventorySource, InventorySession } from '@/bindings/index';

// Local IPC helper — migrated off the hand-written @/api/commands wrapper
// (spec 037) onto the generated bindings. unwrap() turns the generated Result
// into the throw-on-error contract the hooks below rely on.
async function inventoryList(
  req: InventoryListRequest,
): Promise<InventoryListResponse> {
  return unwrap(
    await commands.inventoryList(ipcArgs<typeof commands.inventoryList>(req)),
  );
}

/**
 * Persist post-hoc notes for an inventory session (#773). Empty/whitespace
 * `notes` clears the field server-side. Throws the mapped `ContractError` on
 * `note.content_too_large` / `session.not_found` / database error.
 */
export async function saveSessionNote(
  sessionId: string,
  notes: string,
): Promise<SessionNotesUpdateResult> {
  return unwrap(
    await commands.inventorySessionNotesUpdate(
      ipcArgs<typeof commands.inventorySessionNotesUpdate>({
        sessionId,
        notes,
      }),
    ),
  );
}

/**
 * Id of the first session in the (unfiltered) inventory ledger, or `null` when
 * the library has none yet.
 *
 * The onboarding find spotlight needs one: the note field it points at lives on
 * a session's detail pane, not on the sessions list, so it has to deep-link to
 * a real session. `fetchQuery` reuses a warm cache and only hits IPC when the
 * sessions page has never loaded.
 */
export async function fetchFirstSessionId(
  queryClient: QueryClient,
): Promise<string | null> {
  const response = await queryClient.fetchQuery({
    queryKey: queryKeys.inventory.all(),
    queryFn: () => inventoryList(makeRequest()),
  });
  for (const source of response.sources) {
    const first = source.sessions[0];
    if (first) return first.id;
  }
  return null;
}

// Filters shape

export interface InventoryFilters {
  sourceFilter?: string;
  frameFilter?: InventoryFrameType;
}

// Query state shape (matches old QueryState<T> surface for backward compat)

export interface QueryState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | undefined;
}

function makeRequest(filters?: InventoryFilters): InventoryListRequest {
  return {
    contractVersion: '2.0.0',
    requestId: crypto.randomUUID(),
    filters: filters && Object.keys(filters).length > 0 ? filters : undefined,
  };
}

/** Subscribe to the grouped inventory ledger. */
export function useInventorySources(
  filters?: InventoryFilters,
): QueryState<InventoryListResponse> {
  const { data, isFetching, error } = useQuery({
    queryKey: queryKeys.inventory.all(filters),
    queryFn: () => inventoryList(makeRequest(filters)),
  });
  return {
    data,
    loading: isFetching,
    error: error ?? undefined,
  };
}

/** Invalidate the inventory list. */
export function useInvalidateInventory() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: queryKeys.inventory.all() });
  }, [queryClient]);
}

// spec 041 FR-051 (T076): `useSessionReview` and the review-action machinery
// it drove are removed along with the session review-state column — sessions
// are derived, already-confirmed inventory with no review gate to mutate.
// Compat shims: old code called setInventoryFilters / invalidateInventory at
// module level. Those callers now pass filters via useInventorySources(filters)
// and invalidate via useInvalidateInventory(). Provide stubs so any remaining
// static call sites compile without change until they are migrated.

/** @deprecated Pass filters directly to useInventorySources(filters). */
export function setInventoryFilters(_filters: InventoryFilters): void {
  // no-op: filters are now embedded as query key params
}

/** @deprecated Use useInvalidateInventory() hook inside a component. */
export function invalidateInventory(): void {
  // no-op stub for legacy callers; invalidation is query-client-driven
}
