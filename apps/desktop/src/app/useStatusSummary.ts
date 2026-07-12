import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/data/queryKeys';
import { commands } from '@/bindings/index';
import { unwrap } from '@/api/ipc';
import type { StatusSummary as StatusSummaryDto } from '@/bindings/index';

export interface StatusSummary {
  inboxCount: number;
  sessionCount: number;
  calibrationCount: number;
  targetCount: number;
  projectCount: number;
  cleanupReclaimableBytes: number;
  volumes: {
    path: string;
    freeBytes: number;
    totalBytes: number;
    warning: boolean;
  }[];
  roots: { id: string; path: string; kind: string; online: boolean }[];
}

const DEFAULT_SUMMARY: StatusSummary = {
  inboxCount: 0,
  sessionCount: 0,
  calibrationCount: 0,
  targetCount: 0,
  projectCount: 0,
  cleanupReclaimableBytes: 0,
  volumes: [],
  roots: [],
};

async function fetchStatusSummary(): Promise<StatusSummary> {
  // `result.data` is the generated `StatusSummary` DTO: `library`, `volumes`,
  // and `roots` are concretely typed and always present, so no loose
  // `Record<string, unknown>` coercion or `?? 0` fallbacks are needed
  // (spec 042 US7 T191).
  const d: StatusSummaryDto = unwrap(await commands.statusSummary());
  return {
    inboxCount: d.inboxCount,
    sessionCount: d.library.sessions,
    calibrationCount: d.library.calibrationSets,
    targetCount: d.library.targets,
    projectCount: d.library.projects,
    cleanupReclaimableBytes: d.cleanupReclaimableBytes,
    volumes: d.volumes.map((v) => ({
      path: v.path,
      freeBytes: v.freeBytes,
      totalBytes: v.totalBytes,
      warning: v.warning,
    })),
    roots: d.roots.map((r) => ({
      id: r.id,
      path: r.path,
      kind: r.kind,
      online: r.online,
    })),
  };
}

export function useStatusSummary(): StatusSummary {
  const { data } = useQuery({
    queryKey: queryKeys.status.summary(),
    queryFn: fetchStatusSummary,
    refetchInterval: 30_000,
    // Backend unavailable (mock mode, or status_summary not yet wired on this
    // platform) is common/expected — swallow via `retry: false` and keep the
    // default/last-known summary rather than retry-storming every poll tick.
    retry: false,
  });
  return data ?? DEFAULT_SUMMARY;
}
