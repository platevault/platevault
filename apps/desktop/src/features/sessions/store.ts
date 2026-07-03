/**
 * Sessions / Inventory store — spec 006, TanStack Query.
 *
 * Wraps inventoryList and inventorySessionReview behind useQuery / useMutation
 * hooks. Filter changes invalidate the inventory key so the page re-fetches.
 */

import { useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/data/queryKeys";
import { commands } from "@/bindings/index";
import { unwrap } from "@/api/ipc";
import type {
  InventoryListResponse,
  InventoryListRequest,
  InventorySessionReviewRequest,
  InventorySessionReviewResponse,
  InventoryFrameType,
} from "@/bindings/index";
import { errMessage } from '@/lib/errors';
import { m } from '@/lib/i18n';

export type { InventoryListResponse, InventorySessionReviewResponse };
export type { InventorySource, InventorySession } from "@/bindings/index";

// Local IPC helpers — migrated off the hand-written @/api/commands wrappers
// (spec 037) onto the generated bindings. unwrap() turns the generated Result
// into the throw-on-error contract the hooks below rely on.
async function inventoryList(req: InventoryListRequest): Promise<InventoryListResponse> {
  return unwrap(await commands.inventoryList(req as Parameters<typeof commands.inventoryList>[0]));
}

async function inventorySessionReview(
  req: InventorySessionReviewRequest,
): Promise<InventorySessionReviewResponse> {
  return unwrap(
    await commands.inventorySessionReview(
      req as Parameters<typeof commands.inventorySessionReview>[0],
    ),
  );
}

// Filters shape

export interface InventoryFilters {
  sourceFilter?: string;
  frameFilter?: InventoryFrameType;
  reviewFilter?: string;
}

// Query state shape (matches old QueryState<T> surface for backward compat)

export interface QueryState<T> {
  data: T | undefined;
  loading: boolean;
  error: Error | undefined;
}

function makeRequest(filters?: InventoryFilters): InventoryListRequest {
  return {
    contractVersion: "2.0.0",
    requestId: crypto.randomUUID(),
    filters: filters && Object.keys(filters).length > 0 ? filters : undefined,
  };
}

/** Subscribe to the grouped inventory ledger. */
export function useInventorySources(filters?: InventoryFilters): QueryState<InventoryListResponse> {
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

/** Invalidate the inventory list (call after a successful review action). */
export function useInvalidateInventory() {
  const queryClient = useQueryClient();
  return useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["inventory"] });
  }, [queryClient]);
}

// Mutation hook

export type ReviewAction = "confirm" | "reopen" | "reject" | "ignore";

const REVIEW_NEXT_STATE: Record<ReviewAction, InventorySessionReviewRequest["nextState"]> = {
  confirm: "confirmed",
  reopen: "needs_review",
  reject: "rejected",
  ignore: "ignored",
};

/** Render-time factory (spec 046 #8b) so review action labels re-read the active locale. */
function reviewActionLabel(action: ReviewAction): string {
  switch (action) {
    case "confirm": return m.sessions_review_action_confirm();
    case "reopen": return m.sessions_review_action_reopen();
    case "reject": return m.sessions_review_action_reject();
    case "ignore": return m.sessions_review_action_ignore();
  }
}

/**
 * Hook that returns a callback to trigger a session review action.
 * Handles noop (no re-render), success (invalidates list), and error (returns message).
 */
export function useSessionReview() {
  const queryClient = useQueryClient();
  const [pending, setPending] = useState<string | null>(null);

  const review = useCallback(
    async (
      sessionId: string,
      action: ReviewAction,
    ): Promise<{ ok: boolean; noop: boolean; error?: string }> => {
      setPending(sessionId);
      try {
        const resp = await inventorySessionReview({
          contractVersion: "2.0.0",
          requestId: crypto.randomUUID(),
          sessionId,
          nextState: REVIEW_NEXT_STATE[action],
          actionLabel: reviewActionLabel(action),
          actor: "user",
        });
        if (resp.status === "success") {
          void queryClient.invalidateQueries({ queryKey: ["inventory"] });
          return { ok: true, noop: false };
        }
        if (resp.status === "noop") {
          return { ok: true, noop: true };
        }
        return {
          ok: false,
          noop: false,
          error: resp.error?.message ?? m.sessions_review_failed(),
        };
      } catch (err) {
        return {
          ok: false,
          noop: false,
          error: errMessage(err),
        };
      } finally {
        setPending(null);
      }
    },
    [queryClient],
  );

  return { review, pending };
}

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

// useMutation form for callers that want the full mutation API
export function useInventorySessionReview() {
  const queryClient = useQueryClient();
  return useMutation<
    InventorySessionReviewResponse,
    Error,
    { sessionId: string; action: ReviewAction }
  >({
    mutationFn: ({ sessionId, action }) =>
      inventorySessionReview({
        contractVersion: "2.0.0",
        requestId: crypto.randomUUID(),
        sessionId,
        nextState: REVIEW_NEXT_STATE[action],
        actionLabel: reviewActionLabel(action),
        actor: "user",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    },
  });
}
