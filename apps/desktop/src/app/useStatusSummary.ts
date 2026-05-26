import { useState, useEffect } from 'react';

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
          const d = result.data;
          setSummary({
            inboxCount: d.inboxCount ?? 0,
            sessionCount: d.library?.sessions ?? 0,
            calibrationCount: d.library?.calibrationSets ?? 0,
            targetCount: d.library?.targets ?? 0,
            projectCount: d.library?.projects ?? 0,
            cleanupReclaimableBytes: d.cleanupReclaimableBytes ?? 0,
            volumes: (d.volumes ?? []).map((v: Record<string, unknown>) => ({
              path: String(v.path ?? ''),
              freeBytes: Number(v.freeBytes ?? 0),
              totalBytes: Number(v.totalBytes ?? 0),
              warning: Boolean(v.warning),
            })),
            roots: (d.roots ?? []).map((r: Record<string, unknown>) => ({
              id: String(r.id ?? ''),
              path: String(r.path ?? ''),
              kind: String(r.kind ?? ''),
              online: Boolean(r.online),
            })),
          });
        }
      } catch {
        // Backend unavailable — keep defaults
      }
    }

    fetch();
    const interval = setInterval(fetch, 30_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  return summary;
}
