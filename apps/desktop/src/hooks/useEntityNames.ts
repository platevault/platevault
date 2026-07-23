// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * useEntityNames -- resolves `(entityType, entityId)` refs to display names.
 *
 * Extracted from AuditLog's per-row resolver (#803) so Audit Log, Projects
 * Sources, and the Calibration match panel share one implementation instead
 * of three ad hoc treatments (#809).
 *
 * - `project` / `target` / `plan`: one IPC round-trip per unseen id, cached
 *   module-wide since ids repeat across pages within a session.
 * - `session`: sessions have no cheap per-id name lookup (`sessions.get`
 *   returns session detail, not a display name), so names are read from the
 *   already-fetched inventory-sources query instead of adding a new IPC
 *   command -- the same batch data the Sessions page and Projects Sources
 *   view already warm (#663).
 *
 * Callers decide the fallback text for a ref that never resolves (unknown id,
 * lookup failed, or still pending) -- this hook only returns names it
 * actually resolved.
 */

import { useEffect, useRef, useState } from 'react';
import { commands } from '@/bindings/index';
import { useInventorySources } from '@/features/sessions/store';

export interface EntityNameRef {
  entityType: string;
  entityId: string;
}

/** Module-scope cache for the per-id IPC lookups (project/target/plan). */
const entityNameCache = new Map<string, string | null>();

export function entityNameKey(ref: EntityNameRef): string {
  return `${ref.entityType}:${ref.entityId}`;
}

export function useEntityNames(
  refs: readonly EntityNameRef[],
): Map<string, string> {
  const [, forceRender] = useState(0);
  const requested = useRef(new Set<string>());
  const { data: inventoryData } = useInventorySources();

  useEffect(() => {
    let cancelled = false;
    for (const ref of refs) {
      if (ref.entityType === 'session') continue;
      const cacheKey = entityNameKey(ref);
      if (entityNameCache.has(cacheKey) || requested.current.has(cacheKey)) {
        continue;
      }
      const fetcher =
        ref.entityType === 'project'
          ? commands
              .projectsGet(ref.entityId)
              .then((r) => (r.status === 'ok' ? r.data.name : null))
          : ref.entityType === 'target'
            ? commands
                .targetsGet(ref.entityId)
                .then((r) => (r.status === 'ok' ? r.data.name : null))
            : ref.entityType === 'plan'
              ? commands
                  .plansGet(ref.entityId)
                  .then((r) => (r.status === 'ok' ? r.data.title : null))
              : null;
      if (!fetcher) continue;
      requested.current.add(cacheKey);
      void fetcher
        .catch(() => null)
        .then((name) => {
          entityNameCache.set(cacheKey, name);
          if (!cancelled) forceRender((n) => n + 1);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [refs]);

  const sessionNames = new Map<string, string>();
  for (const source of inventoryData?.sources ?? []) {
    for (const session of source.sessions) {
      sessionNames.set(session.id, session.name);
    }
  }

  const names = new Map<string, string>();
  for (const ref of refs) {
    const cacheKey = entityNameKey(ref);
    if (ref.entityType === 'session') {
      const name = sessionNames.get(ref.entityId);
      if (name) names.set(cacheKey, name);
      continue;
    }
    const cached = entityNameCache.get(cacheKey);
    if (cached) names.set(cacheKey, cached);
  }
  return names;
}
