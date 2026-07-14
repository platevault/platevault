// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Artifact store helpers — spec 012 T008/T020/T022/T023.
 *
 * Provides:
 * - `useArtifacts(projectId)` — reactive query over `artifact.list`.
 * - `useArtifactClassify()` — mutation hook wrapping `artifact.classify`.
 * - `useArtifactMarkResolved()` — mutation hook wrapping `artifact.mark_resolved`.
 * - `useProjectArtifactWatcher(projectId)` — attaches the filesystem watcher on
 *   mount and detaches it on unmount/projectId change (T008: project drawer
 *   open/close lifecycle).
 * - `groupArtifactsByLaunch()` — pure grouping helper for the accordion (T023).
 */

import { useState, useCallback, useEffect } from 'react';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type {
  ArtifactSummary,
  ArtifactListRequest,
  ArtifactListResponse,
  ArtifactClassifyRequest,
  ArtifactClassifyResponse,
  ArtifactMarkResolvedRequest,
  ArtifactWatcherRequest,
} from '@/bindings/index';
import { errMessage } from '@/lib/errors';

// Local IPC helpers — migrated off the hand-written @/api/commands wrappers
// (spec 037) onto the generated bindings.

async function artifactList(
  request: ArtifactListRequest,
): Promise<ArtifactListResponse> {
  return unwrap(await commands.artifactList(request));
}

async function artifactClassify(
  request: ArtifactClassifyRequest,
): Promise<ArtifactClassifyResponse> {
  return unwrap(await commands.artifactClassify(request));
}

async function artifactMarkResolved(
  request: ArtifactMarkResolvedRequest,
): Promise<void> {
  unwrap(await commands.artifactMarkResolved(request));
}

async function artifactWatcherAttach(
  request: ArtifactWatcherRequest,
): Promise<void> {
  unwrap(await commands.artifactWatcherAttach(request));
}

async function artifactWatcherDetach(
  request: ArtifactWatcherRequest,
): Promise<void> {
  unwrap(await commands.artifactWatcherDetach(request));
}

// ── Grouping types ─────────────────────────────────────────────────────────────

/** Artifacts grouped under a single tool launch or the "Unattributed" bucket. */
export interface ArtifactGroup {
  /** Tool launch id, or null for the "Unattributed" group. */
  toolLaunchId: string | null;
  artifacts: ArtifactSummary[];
}

/**
 * Group artifacts by `toolLaunchId`.
 *
 * Ordering (data-model §Derived View: ProcessingArtifactSummary):
 * 1. Bucket by `toolLaunchId`.
 * 2. Within a bucket, sort by `detectedAt` ascending.
 * 3. Attributed buckets sort by the bucket's earliest detection descending.
 * 4. Unattributed artifacts collect in a single bucket at the end.
 *
 * `launchOrder` is an optional ordered list of launch ids (newest first) used
 * to sort attributed buckets — pass the `tool_launches` list from spec 011.
 */
export function groupArtifactsByLaunch(
  artifacts: ArtifactSummary[],
  launchOrder: string[] = [],
): ArtifactGroup[] {
  const buckets = new Map<string, ArtifactSummary[]>();
  const unattributed: ArtifactSummary[] = [];

  for (const art of artifacts) {
    if (art.toolLaunchId == null) {
      unattributed.push(art);
    } else {
      const bucket = buckets.get(art.toolLaunchId) ?? [];
      bucket.push(art);
      buckets.set(art.toolLaunchId, bucket);
    }
  }

  // Sort each bucket by detectedAt ascending.
  for (const bucket of buckets.values()) {
    bucket.sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));
  }
  unattributed.sort((a, b) => a.detectedAt.localeCompare(b.detectedAt));

  // Order attributed buckets: prefer caller-supplied launch order, then by
  // earliest detection descending.
  const attributedGroups: ArtifactGroup[] = [...buckets.entries()]
    .map(([toolLaunchId, arts]) => ({ toolLaunchId, artifacts: arts }))
    .sort((a, b) => {
      const ia = launchOrder.indexOf(a.toolLaunchId);
      const ib = launchOrder.indexOf(b.toolLaunchId);
      // Both in launch order list → use that order.
      if (ia !== -1 && ib !== -1) return ia - ib;
      // One is in list → that one first.
      if (ia !== -1) return -1;
      if (ib !== -1) return 1;
      // Neither in list → fall back to earliest detection descending.
      const da = a.artifacts[0]?.detectedAt ?? '';
      const db = b.artifacts[0]?.detectedAt ?? '';
      return db.localeCompare(da);
    });

  const result: ArtifactGroup[] = [...attributedGroups];
  if (unattributed.length > 0) {
    result.push({ toolLaunchId: null, artifacts: unattributed });
  }
  return result;
}

// ── useArtifacts ──────────────────────────────────────────────────────────────

export interface ArtifactsState {
  artifacts: ArtifactSummary[];
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/**
 * Reactive query hook for artifact list.
 *
 * Fetches `["present", "missing"]` states by default.
 */
export function useArtifacts(projectId: string): ArtifactsState {
  const [artifacts, setArtifacts] = useState<ArtifactSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!projectId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    artifactList({ projectId, includeStates: [] })
      .then((resp: ArtifactListResponse) => {
        if (!cancelled) {
          setArtifacts(resp.artifacts ?? []);
          setLoading(false);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(errMessage(err));
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId, tick]);

  return { artifacts, loading, error, reload };
}

// ── useProjectArtifactWatcher ─────────────────────────────────────────────────

/**
 * Attach the project's filesystem artifact watcher on mount, detach it on
 * unmount or when `projectId` changes (spec 012 T008).
 *
 * This mirrors the project drawer's own mount lifecycle: `ProjectDetailContent`
 * only exists while a project is selected, so the effect naturally fires once
 * per drawer-open and cleans up on drawer-close/project-switch. Attach runs an
 * on-attach reconciliation pass on the backend before starting the live watch,
 * so files written while the drawer was closed are still detected.
 *
 * Best-effort: attach/detach failures are logged, not surfaced as UI errors —
 * artifact observation is a background enhancement, not a blocking operation.
 */
export function useProjectArtifactWatcher(projectId: string): void {
  useEffect(() => {
    if (!projectId) return undefined;

    let cancelled = false;
    artifactWatcherAttach({ projectId }).catch((err: unknown) => {
      if (!cancelled) {
        console.warn('artifact watcher attach failed', errMessage(err));
      }
    });

    return () => {
      cancelled = true;
      artifactWatcherDetach({ projectId }).catch((err: unknown) => {
        console.warn('artifact watcher detach failed', errMessage(err));
      });
    };
  }, [projectId]);
}

// ── useArtifactClassify ────────────────────────────────────────────────────────

export interface ClassifyState {
  working: boolean;
}

export interface UseArtifactClassifyResult {
  state: ClassifyState;
  classify: (request: ArtifactClassifyRequest) => Promise<void>;
}

/** Mutation hook for classifying / overriding an artifact. */
export function useArtifactClassify(
  onSuccess?: () => void,
): UseArtifactClassifyResult {
  const [working, setWorking] = useState(false);

  const classify = useCallback(
    async (request: ArtifactClassifyRequest) => {
      setWorking(true);
      try {
        await artifactClassify(request);
        onSuccess?.();
      } finally {
        setWorking(false);
      }
    },
    [onSuccess],
  );

  return { state: { working }, classify };
}

// ── useArtifactMarkResolved ────────────────────────────────────────────────────

/** Mutation hook for marking a missing artifact as user-resolved. */
export function useArtifactMarkResolved(onSuccess?: () => void) {
  const [working, setWorking] = useState(false);

  const markResolved = useCallback(
    async (projectId: string, artifactId: string) => {
      setWorking(true);
      try {
        await artifactMarkResolved({ projectId, artifactId });
        onSuccess?.();
      } finally {
        setWorking(false);
      }
    },
    [onSuccess],
  );

  return { working, markResolved };
}
