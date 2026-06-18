import { registerRootBatch } from '@/api/commands';

const STORAGE_KEY = 'alm-setup-wizard-state';

export type SourceKind = 'light_frames' | 'dark' | 'flat' | 'bias' | 'project' | 'inbox';
export type ScanDepth = 'recursive' | 'single';

export const ALL_SOURCE_KINDS: SourceKind[] = [
  'light_frames',
  'dark',
  'flat',
  'bias',
  'project',
  'inbox',
];

export const SOURCE_KIND_LABELS: Record<SourceKind, string> = {
  light_frames: 'Light frames',
  dark: 'Darks',
  flat: 'Flats',
  bias: 'Bias',
  project: 'Projects',
  inbox: 'Inbox',
};

export const REQUIRED_KINDS: SourceKind[] = ['light_frames', 'project', 'inbox'];

export interface SourceEntry {
  path: string;
  kind: SourceKind;
  scanDepth: ScanDepth;
}

/** Flat array of source entries — replaces the old per-kind object shape. */
export type SourcesState = SourceEntry[];

export interface DeduplicationResult {
  ok: boolean;
  /** Warning: same path already exists within this kind. */
  sameKindDuplicate?: boolean;
  /** Error: same path registered under a different kind. */
  crossKindConflict?: SourceKind;
}

export interface FlushRowResult {
  kind: SourceKind;
  path: string;
  success: boolean;
  error?: string;
}

export interface FlushResult {
  results: FlushRowResult[];
  allSucceeded: boolean;
}

export interface ValidationError {
  code: string;
  message: string;
}

/** Error code to user-facing message map for roots.register contract errors. */
const ERROR_MESSAGES: Record<string, string> = {
  'path.not_exists': 'This directory does not exist',
  'path.not_directory': 'This path is not a directory',
  'path.permission_denied': 'Cannot read this directory — check permissions',
  'path.already_registered': 'This directory is already registered',
  'path.already_registered.different_kind': 'This directory is registered under a different category',
};

/** Load sources state from localStorage. */
export function loadSources(): SourcesState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.sources)) {
        return parsed.sources.filter(
          (e: unknown): e is SourceEntry =>
            typeof e === 'object' &&
            e !== null &&
            typeof (e as SourceEntry).path === 'string' &&
            typeof (e as SourceEntry).kind === 'string' &&
            ALL_SOURCE_KINDS.includes((e as SourceEntry).kind),
        );
      }
    }
  } catch {
    // corrupt state -- start fresh
  }
  return [];
}

/** Persist sources state to localStorage under the wizard state key. */
export function saveSources(sources: SourcesState): void {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const existing = raw ? JSON.parse(raw) : {};
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...existing, sources }));
  } catch {
    // storage full -- proceed without persistence
  }
}

/** Check whether adding a path to a kind would create duplicates. */
export function checkDeduplication(
  sources: SourcesState,
  kind: SourceKind,
  path: string,
): DeduplicationResult {
  const normalizedPath = path.toLowerCase();

  const sameKindDuplicate = sources.some(
    (entry) => entry.kind === kind && entry.path.toLowerCase() === normalizedPath,
  );

  let crossKindConflict: SourceKind | undefined;
  for (const entry of sources) {
    if (entry.kind !== kind && entry.path.toLowerCase() === normalizedPath) {
      crossKindConflict = entry.kind;
      break;
    }
  }

  return {
    ok: !sameKindDuplicate && !crossKindConflict,
    sameKindDuplicate: sameKindDuplicate || undefined,
    crossKindConflict,
  };
}

/** Add a source entry, returning updated state. */
export function addSource(
  sources: SourcesState,
  kind: SourceKind,
  path: string,
  scanDepth: ScanDepth = 'recursive',
): SourcesState {
  return [...sources, { path, kind, scanDepth }];
}

/** Remove a source entry by index, returning updated state. */
export function removeSource(
  sources: SourcesState,
  _kind: SourceKind,
  index: number,
): SourcesState {
  return sources.filter((_, i) => i !== index);
}

/** Get sources for a specific kind. */
export function getSourcesByKind(sources: SourcesState, kind: SourceKind): SourceEntry[] {
  return sources.filter((e) => e.kind === kind);
}

/** Check which required kinds are missing from the current sources. */
export function getMissingRequiredKinds(sources: SourcesState): SourceKind[] {
  return REQUIRED_KINDS.filter(
    (kind) => !sources.some((e) => e.kind === kind),
  );
}

/**
 * Validate a single path client-side. Does NOT register the source —
 * registration only happens at flush time via flushToDB().
 * Returns null on success, or a ValidationError on failure.
 */
export function validatePath(
  sources: SourcesState,
  path: string,
  kind: SourceKind,
): ValidationError | null {
  if (!path || !path.trim()) {
    return { code: 'path.empty', message: 'Path cannot be empty' };
  }

  const dedup = checkDeduplication(sources, kind, path);
  if (dedup.sameKindDuplicate) {
    return { code: 'path.already_registered', message: ERROR_MESSAGES['path.already_registered'] };
  }
  if (dedup.crossKindConflict) {
    return {
      code: 'path.already_registered.different_kind',
      message: `${ERROR_MESSAGES['path.already_registered.different_kind']} (${dedup.crossKindConflict})`,
    };
  }

  return null;
}

/**
 * Flush all sources to the database via roots.register.batch.
 * Returns per-row success/failure results.
 */
export async function flushToDB(sources: SourcesState): Promise<FlushResult> {
  const isMockMode = import.meta.env.VITE_USE_MOCKS === 'true';
  const validSources = sources.filter((s) => s.path);

  if (isMockMode) {
    return {
      results: validSources.map((s) => ({ kind: s.kind, path: s.path, success: true })),
      allSucceeded: true,
    };
  }

  try {
    const batchResult = await registerRootBatch({
      sources: validSources.map((s) => ({
        kind: s.kind,
        path: s.path,
        scan_depth: s.scanDepth,
      })),
    });

    const results: FlushRowResult[] = batchResult.results.map((item) => {
      if (item.success) {
        return { kind: item.kind as SourceKind, path: item.path, success: true };
      }
      const errorCode = item.error ?? 'unknown';
      const message = ERROR_MESSAGES[errorCode] ?? `Registration failed: ${errorCode}`;
      return { kind: item.kind as SourceKind, path: item.path, success: false, error: message };
    });

    return { results, allSucceeded: results.every((r) => r.success) };
  } catch (err: unknown) {
    return {
      results: validSources.map((s) => ({
        kind: s.kind,
        path: s.path,
        success: false,
        error: `Batch registration failed: ${String(err)}`,
      })),
      allSucceeded: false,
    };
  }
}
