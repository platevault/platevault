/**
 * Hierarchical, tuple-based query key factory for TanStack Query.
 *
 * Each key is a const tuple to enable fine-grained or prefix-based invalidation.
 * Import `queryKeys` and call the relevant factory in `useQuery`/`useMutation`.
 */

export const queryKeys = {
  projects: {
    all: () => ['projects'] as const,
    detail: (id: string) => ['projects', id] as const,
  },
  inventory: {
    all: (filters?: object) => ['inventory', filters] as const,
  },
  sessions: {
    all: () => ['sessions'] as const,
    calendar: (start: string, end: string) =>
      ['sessions', 'calendar', start, end] as const,
  },
  inbox: {
    list: (rootId: string) => ['inbox', rootId] as const,
    metadata: (itemId: string) => ['inbox', 'metadata', itemId] as const,
  },
  calibration: {
    masters: () => ['calibration', 'masters'] as const,
    master: (id: string) => ['calibration', 'masters', id] as const,
    matches: (sid: string) => ['calibration', 'matches', sid] as const,
  },
  guided: {
    state: () => ['guided'] as const,
  },
  setup: {
    sources: () => ['setup', 'sources'] as const,
  },
  status: {
    summary: () => ['status'] as const,
  },
  archive: {
    list: () => ['archive'] as const,
    audit: (entityId: string) => ['archive', 'audit', entityId] as const,
  },
  plans: {
    detail: (id: string) => ['plans', 'detail', id] as const,
  },
} as const;
