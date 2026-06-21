import { useState, useEffect } from 'react';
import type { StatusSummary as StatusSummaryDto } from '@/bindings/index';

export interface StatusSummary {
  inboxCount: number;
  sessionCount: number;
  calibrationCount: number;
  targetCount: number;
  projectCount: number;
  cleanupReclaimableBytes: number;
  volumes: { path: string; freeBytes: number; totalBytes: number; warning: boolean }[];
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

export function useStatusSummary(): StatusSummary {
  const [summary, setSummary] = useState<StatusSummary>(DEFAULT_SUMMARY);

  useEffect(() => {
    let cancelled = false;

    async function fetch() {
      try {
        const { commands } = await import('@/bindings/index');
        const result = await commands.statusSummary();
        if (cancelled) return;
        if (result.status === 'ok') {
          // `result.data` is the generated `StatusSummary` DTO: `library`,
          // `volumes`, and `roots` are concretely typed and always present, so
          // no loose `Record<string, unknown>` coercion or `?? 0` fallbacks are
          // needed (spec 042 US7 T191).
          const d: StatusSummaryDto = result.data;
          setSummary({
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
          });
        }
      } catch (err) {
        // Backend unavailable (e.g. mock mode, or status_summary not yet wired
        // on this platform) — keep the default zeroed summary. Intentionally
        // swallowed: this poller runs every 30s and a transient failure must not
        // surface as an error to the user.
        void err;
      }
    }

    void fetch();
    const interval = setInterval(fetch, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return summary;
}
