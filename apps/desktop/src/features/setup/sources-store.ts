import { registerRoot } from '@/api/commands';

const STORAGE_KEY = 'alm-setup-wizard-state';

export type SourceKind = 'raw' | 'calibration' | 'project' | 'inbox';
export type ScanDepth = 'recursive' | 'single';

export interface SourceEntry {
  path: string;
  scanDepth: ScanDepth;
}

export interface SourcesState {
  raw: SourceEntry[];
  calibration: SourceEntry[];
  project: SourceEntry[];
  inbox: SourceEntry[];
}

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

function getDefaultState(): SourcesState {
  return {
    raw: [],
    calibration: [],
    project: [],
    inbox: [],
  };
}

/** Load sources state from localStorage. */
export function loadSources(): SourcesState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed?.sources && typeof parsed.sources === 'object') {
        return {
          raw: Array.isArray(parsed.sources.raw) ? parsed.sources.raw : [],
          calibration: Array.isArray(parsed.sources.calibration) ? parsed.sources.calibration : [],
          project: Array.isArray(parsed.sources.project) ? parsed.sources.project : [],
          inbox: Array.isArray(parsed.sources.inbox) ? parsed.sources.inbox : [],
        };
      }
    }
  } catch {
    // corrupt state -- start fresh
  }
  return getDefaultState();
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

  // Check same-kind duplicate
  const sameKindDuplicate = sources[kind].some(
    (entry) => entry.path.toLowerCase() === normalizedPath,
  );

  // Check cross-kind conflict
  let crossKindConflict: SourceKind | undefined;
  const allKinds: SourceKind[] = ['raw', 'calibration', 'project', 'inbox'];
  for (const k of allKinds) {
    if (k === kind) continue;
    if (sources[k].some((entry) => entry.path.toLowerCase() === normalizedPath)) {
      crossKindConflict = k;
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
  return {
    ...sources,
    [kind]: [...sources[kind], { path, scanDepth }],
  };
}

/** Remove a source entry by index, returning updated state. */
export function removeSource(
  sources: SourcesState,
  kind: SourceKind,
  index: number,
): SourcesState {
  return {
    ...sources,
    [kind]: sources[kind].filter((_, i) => i !== index),
  };
}

/** Get sources for a specific kind. */
export function getSources(sources: SourcesState, kind: SourceKind): SourceEntry[] {
  return sources[kind];
}

/** Get all sources as a flat array with kind labels. */
export function getAllSources(
  sources: SourcesState,
): Array<SourceEntry & { kind: SourceKind }> {
  const allKinds: SourceKind[] = ['raw', 'calibration', 'project', 'inbox'];
  const result: Array<SourceEntry & { kind: SourceKind }> = [];
  for (const kind of allKinds) {
    for (const entry of sources[kind]) {
      result.push({ ...entry, kind });
    }
  }
  return result;
}

/**
 * Validate a single path by calling roots.register on the backend.
 * Returns null on success, or a ValidationError on failure.
 */
export async function validatePath(
  path: string,
  kind: SourceKind,
): Promise<ValidationError | null> {
  const isMockMode = import.meta.env.VITE_USE_MOCKS === 'true';
  if (isMockMode) {
    // In mock mode, always succeed
    return null;
  }

  try {
    await registerRoot({ path, category: kind, scan_settings: {} });
    return null;
  } catch (err: unknown) {
    const errorCode = extractErrorCode(err);
    const message = ERROR_MESSAGES[errorCode] ?? `Registration failed: ${errorCode}`;
    return { code: errorCode, message };
  }
}

/**
 * Flush all sources to the database via roots.register.
 * Returns per-row success/failure results.
 */
export async function flushToDB(sources: SourcesState): Promise<FlushResult> {
  const isMockMode = import.meta.env.VITE_USE_MOCKS === 'true';
  const allSources = getAllSources(sources);
  const results: FlushRowResult[] = [];

  for (const source of allSources) {
    if (!source.path) continue;

    try {
      if (isMockMode) {
        // In mock mode, simulate success
        results.push({ kind: source.kind, path: source.path, success: true });
      } else {
        await registerRoot({
          path: source.path,
          category: source.kind,
          scan_settings: { scan_depth: source.scanDepth },
        });
        results.push({ kind: source.kind, path: source.path, success: true });
      }
    } catch (err: unknown) {
      const errorCode = extractErrorCode(err);
      const message = ERROR_MESSAGES[errorCode] ?? `Registration failed: ${errorCode}`;
      results.push({
        kind: source.kind,
        path: source.path,
        success: false,
        error: message,
      });
    }
  }

  return {
    results,
    allSucceeded: results.every((r) => r.success),
  };
}

/** Extract a dotted error code from a Tauri invoke error. */
function extractErrorCode(err: unknown): string {
  if (err && typeof err === 'object') {
    // Tauri contract errors may have a code field
    if ('code' in err && typeof (err as Record<string, unknown>).code === 'string') {
      return (err as Record<string, unknown>).code as string;
    }
    // Or a message that contains the error code
    if ('message' in err && typeof (err as Record<string, unknown>).message === 'string') {
      const msg = (err as Record<string, unknown>).message as string;
      // Try to extract dotted code from message (e.g., "path.not_exists: ...")
      const match = msg.match(/^([\w.]+?)(?:\s*:|$)/);
      if (match) return match[1];
      return msg;
    }
  }
  return String(err);
}
