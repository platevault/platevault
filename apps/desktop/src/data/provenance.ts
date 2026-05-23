/**
 * `useProvenance` — additive React hook for spec 002 field-level provenance.
 *
 * This is the T023a seam introduced ahead of any component opt-in (T023b).
 * No existing component reads from this hook yet; the mock-shape inline
 * `InventorySession.provenance` (flat dict) and `PlanItem.provenance`
 * (`{label,value}[]`) keep working untouched.
 *
 * Runtime behavior:
 * - Inside the Tauri runtime: calls `readProvenance` from `../api/lifecycle`
 *   and returns its `ProvenanceField[]` payload.
 * - Outside the Tauri runtime (i.e. `pnpm dev` browser mockup): synthesises a
 *   `ProvenanceField[]` projection from `mock.ts` so the dev surface keeps
 *   rendering. THIS IS A DEV-MODE-ONLY SHIM; the projection is approximate
 *   and not contract-faithful (no real history, `sourceId` omitted, origin
 *   defaults to `observed`).
 *
 * Cache key is `assetType::assetId::sortedFieldPaths.join(",")`. Repeat
 * renders with the same key reuse the in-memory result; remount on key
 * change triggers a refetch.
 */

import { useEffect, useRef, useState } from "react";
import {
  NotInTauriRuntimeError,
  isTauriRuntime,
  readProvenance,
} from "../api/lifecycle";
import type { AssetType, ProvenanceField } from "../bindings";
import { getInventorySources } from "./store";
import { plans as seedPlans } from "./mock";

export interface UseProvenanceResult {
  data: ProvenanceField[] | undefined;
  loading: boolean;
  error: Error | undefined;
}

interface CacheEntry {
  data?: ProvenanceField[];
  error?: Error;
}

const cache = new Map<string, CacheEntry>();

function cacheKey(
  assetId: string,
  assetType: AssetType,
  fieldPaths?: string[],
): string {
  const fp = (fieldPaths ?? []).slice().sort().join(",");
  return `${assetType}::${assetId}::${fp}`;
}

/**
 * Build a dev-mode `ProvenanceField[]` projection from `mock.ts`.
 *
 * For inventory sessions: flatten `InventorySession.provenance` dict keys.
 * For plan items: map `PlanItem.provenance` `{label,value}[]` entries.
 * For anything else: return an empty list — the dev shim doesn't have a
 * plausible mock to project, and an empty array reads as "no provenance
 * recorded" rather than a fabrication.
 */
function synthesiseDevProvenance(
  assetId: string,
  assetType: AssetType,
  fieldPaths?: string[],
): ProvenanceField[] {
  const capturedAt = new Date().toISOString();
  let entries: Array<{ fieldPath: string; current: unknown }> = [];

  if (assetType === "acquisition_session" || assetType === "calibration_session") {
    for (const src of getInventorySources()) {
      const sess = src.sessions.find((s) => s.id === assetId);
      if (!sess) continue;
      const prov = sess.provenance ?? {};
      entries = Object.entries(prov)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => ({ fieldPath: k, current: v }));
      break;
    }
  } else if (assetType === "filesystem_plan") {
    // PlanItem provenance is per-item; assetId here is treated as a plan-item id.
    for (const plan of seedPlans) {
      const item = plan.items.find((it) => it.id === assetId);
      if (!item || !item.provenance) continue;
      entries = item.provenance.map((p) => ({
        fieldPath: p.label,
        current: p.value,
      }));
      break;
    }
  }

  const filtered = fieldPaths && fieldPaths.length > 0
    ? entries.filter((e) => fieldPaths.includes(e.fieldPath))
    : entries;

  return filtered.map<ProvenanceField>((e) => ({
    fieldPath: e.fieldPath,
    current: e.current,
    origin: "observed",
    capturedAt,
    history: [],
    historyTruncated: false,
  }));
}

/**
 * Read provenance for a single asset, with dev-mode fallback synthesis.
 *
 * No component currently consumes this hook — it's the seam introduced by
 * T023a so T023b can opt components in incrementally without a flag day.
 */
export function useProvenance(
  assetId: string,
  assetType: AssetType,
  fieldPaths?: string[],
): UseProvenanceResult {
  const key = cacheKey(assetId, assetType, fieldPaths);
  const cached = cache.get(key);

  const [state, setState] = useState<UseProvenanceResult>(() => {
    if (cached) {
      return { data: cached.data, loading: false, error: cached.error };
    }
    if (!isTauriRuntime()) {
      const data = synthesiseDevProvenance(assetId, assetType, fieldPaths);
      cache.set(key, { data });
      return { data, loading: false, error: undefined };
    }
    return { data: undefined, loading: true, error: undefined };
  });

  const lastKey = useRef<string>(key);

  useEffect(() => {
    if (lastKey.current !== key) {
      lastKey.current = key;
      const c = cache.get(key);
      if (c) {
        setState({ data: c.data, loading: false, error: c.error });
        return;
      }
      if (!isTauriRuntime()) {
        const data = synthesiseDevProvenance(assetId, assetType, fieldPaths);
        cache.set(key, { data });
        setState({ data, loading: false, error: undefined });
        return;
      }
      setState({ data: undefined, loading: true, error: undefined });
    }

    if (!isTauriRuntime()) return;
    if (cache.has(key)) return;

    let cancelled = false;
    (async () => {
      try {
        const response = await readProvenance({ assetId, assetType, fieldPaths });
        const data = (response.provenance ?? []) as ProvenanceField[];
        cache.set(key, { data });
        if (!cancelled) {
          setState({ data, loading: false, error: undefined });
        }
      } catch (err) {
        const error =
          err instanceof Error
            ? err
            : new Error(`useProvenance failed: ${String(err)}`);
        if (error instanceof NotInTauriRuntimeError) {
          // Race: runtime check changed between render and effect. Fall back
          // to the dev synthesis rather than surfacing the sentinel.
          const data = synthesiseDevProvenance(assetId, assetType, fieldPaths);
          cache.set(key, { data });
          if (!cancelled) {
            setState({ data, loading: false, error: undefined });
          }
          return;
        }
        cache.set(key, { error });
        if (!cancelled) {
          setState({ data: undefined, loading: false, error });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
    // fieldPaths is folded into `key`; including the array would re-run on
    // every parent render when callers pass an inline literal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return state;
}

/**
 * Test-only cache reset. Not part of the runtime API contract.
 * @internal
 */
export function __resetProvenanceCacheForTests(): void {
  cache.clear();
}
