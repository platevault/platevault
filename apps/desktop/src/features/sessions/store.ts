/**
 * Sessions / Inventory store — spec 006.
 *
 * Wraps `inventoryList` and `inventorySessionReview` from `@/api/commands`
 * behind reactive query+mutation hooks. The list store is a module-level
 * singleton; filter changes invalidate it so the page re-fetches.
 */

import { useState, useCallback } from 'react';
import { createQueryStore, useQuery, invalidateStores } from '@/data/store';
import { inventoryList, inventorySessionReview } from '@/api/commands';
import type {
  InventoryListResponse,
  InventoryListRequest,
  InventorySessionReviewRequest,
  InventorySessionReviewResponse,
  InventoryFrameType,
} from '@/api/commands';

export type { InventoryListResponse, InventorySessionReviewResponse };
export type { InventorySource, InventorySession } from '@/api/commands';

// ── Filters shape ─────────────────────────────────────────────────────────────

export interface InventoryFilters {
  sourceFilter?: string;
  frameFilter?: InventoryFrameType;
  reviewFilter?: string;
}

// ── Query store ───────────────────────────────────────────────────────────────

/** Build a request envelope from the current filter state. */
function makeRequest(filters?: InventoryFilters): InventoryListRequest {
  return {
    contractVersion: '2.0.0',
    requestId: crypto.randomUUID(),
    filters: filters && Object.keys(filters).length > 0 ? filters : undefined,
  };
}

/**
 * Module-level store. Filters are embedded in the fetcher closure; changing
 * filters requires calling `setInventoryFilters(newFilters)` which rebuilds
 * the store and triggers a fresh fetch.
 *
 * We keep a simple mutable ref so the store factory can close over it.
 * Components should use `useInventorySources` — not this store directly.
 */
let currentFilters: InventoryFilters = {};

export let inventoryStore = createQueryStore<InventoryListResponse>(() =>
  inventoryList(makeRequest(currentFilters)),
);

/** Update the active filters and invalidate the store to trigger a re-fetch. */
export function setInventoryFilters(filters: InventoryFilters): void {
  currentFilters = filters;
  // Rebuild the store so the new fetcher closes over the updated filters.
  inventoryStore = createQueryStore<InventoryListResponse>(() =>
    inventoryList(makeRequest(currentFilters)),
  );
  inventoryStore.fetch();
}

/** Invalidate the inventory list (call after a successful review action). */
export function invalidateInventory(): void {
  inventoryStore.invalidate();
}

// ── Query hooks ───────────────────────────────────────────────────────────────

/** Subscribe to the grouped inventory ledger. */
export function useInventorySources() {
  return useQuery(inventoryStore);
}

// ── Mutation hooks ────────────────────────────────────────────────────────────

export type ReviewAction = 'confirm' | 'reopen' | 'reject';

const REVIEW_NEXT_STATE: Record<ReviewAction, InventorySessionReviewRequest['nextState']> = {
  confirm: 'confirmed',
  reopen: 'needs_review',
  reject: 'rejected',
};

const REVIEW_LABEL: Record<ReviewAction, string> = {
  confirm: 'Confirmed',
  reopen: 'Re-opened review',
  reject: 'Rejected session',
};

/**
 * Hook that returns a callback to trigger a session review action.
 * Handles noop (no re-render), success (invalidates list), and error (returns message).
 */
export function useSessionReview() {
  const [pending, setPending] = useState<string | null>(null);

  const review = useCallback(
    async (
      sessionId: string,
      action: ReviewAction,
    ): Promise<{ ok: boolean; noop: boolean; error?: string }> => {
      setPending(sessionId);
      try {
        const resp = await inventorySessionReview({
          contractVersion: '2.0.0',
          requestId: crypto.randomUUID(),
          sessionId,
          nextState: REVIEW_NEXT_STATE[action],
          actionLabel: REVIEW_LABEL[action],
          actor: 'user',
        });
        if (resp.status === 'success') {
          invalidateInventory();
          return { ok: true, noop: false };
        }
        if (resp.status === 'noop') {
          // Idempotent re-application — no-op, no re-render needed.
          return { ok: true, noop: true };
        }
        return {
          ok: false,
          noop: false,
          error: resp.error?.message ?? 'Review failed',
        };
      } catch (err) {
        return {
          ok: false,
          noop: false,
          error: err instanceof Error ? err.message : String(err),
        };
      } finally {
        setPending(null);
      }
    },
    [],
  );

  return { review, pending };
}
