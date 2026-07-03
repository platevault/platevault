import { registerRootBatch } from './registerSources';
import { m } from '@/lib/i18n';
import { errMessage } from '@/lib/errors';

const STORAGE_KEY = 'alm-setup-wizard-state';

// Per-image frame type (light/dark/flat/bias) is detected from image metadata
// (FITS IMAGETYP header) during scan/ingest — NOT inferred from which source
// folder the file is in. 'calibration' here is only a user-facing folder
// category that covers darks, flats, and bias frames together.
export type SourceKind = 'light_frames' | 'calibration' | 'project' | 'inbox';
export type ScanDepth = 'recursive' | 'single';
export type OrganizationState = 'organized' | 'unorganized';

export const ALL_SOURCE_KINDS: SourceKind[] = [
  'light_frames',
  'calibration',
  'project',
  'inbox',
];

// Values are render-time thunks so labels re-read the active locale (spec 046 #8).
export const SOURCE_KIND_LABELS: Record<SourceKind, () => string> = {
  light_frames: () => m.setup_kind_light_frames(),
  calibration: () => m.setup_kind_calibration(),
  project: () => m.common_projects(),
  inbox: () => m.settings_datasources_category_inbox(),
};

// spec 039: inbox is now optional — users do not need a dedicated drop folder
// to use the Inbox (which aggregates unacknowledged items across all roots).
export const REQUIRED_KINDS: SourceKind[] = ['light_frames', 'project'];

export interface SourceEntry {
  path: string;
  kind: SourceKind;
  scanDepth: ScanDepth;
  /** Organization state for this source (spec 041 R-7).
   *  Inbox kind is always 'unorganized'. Non-inbox defaults to 'organized' (local-first safe default).
   */
  organizationState: OrganizationState;
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
  /** The registered root's id (present on successful rows); used to scan the source. */
  rootId?: string;
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


/** Load sources state from localStorage. */
export function loadSources(): SourcesState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed?.sources)) {
        // Accept persisted entries; supply organizationState default for
      // entries written before this field existed (backward compat).
      return parsed.sources
        .filter(
          (e: unknown): e is Omit<SourceEntry, 'organizationState'> & { organizationState?: OrganizationState } =>
            typeof e === 'object' &&
            e !== null &&
            typeof (e as SourceEntry).path === 'string' &&
            typeof (e as SourceEntry).kind === 'string' &&
            ALL_SOURCE_KINDS.includes((e as SourceEntry).kind),
        )
        .map((e: Omit<SourceEntry, 'organizationState'> & { organizationState?: OrganizationState }) => ({
          ...e,
          organizationState: e.kind === 'inbox'
            ? 'unorganized' as OrganizationState
            : (e.organizationState ?? 'organized'),
        }));
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

/** Add a source entry, returning updated state.
 *  Inbox kind is always forced to 'unorganized'; non-inbox defaults to 'organized'.
 */
export function addSource(
  sources: SourcesState,
  kind: SourceKind,
  path: string,
  scanDepth: ScanDepth = 'recursive',
  organizationState?: OrganizationState,
): SourcesState {
  const state: OrganizationState =
    kind === 'inbox' ? 'unorganized' : (organizationState ?? 'organized');
  return [...sources, { path, kind, scanDepth, organizationState: state }];
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
    return { code: 'path.empty', message: m.setup_validate_path_empty() };
  }

  const dedup = checkDeduplication(sources, kind, path);
  if (dedup.sameKindDuplicate) {
    return { code: 'path.already_registered', message: m.err_path_already_registered() };
  }
  if (dedup.crossKindConflict) {
    return {
      code: 'path.already_registered.different_kind',
      message: `${m.err_path_already_registered_different_kind()} (${dedup.crossKindConflict})`,
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
      results: validSources.map((s) => ({
        kind: s.kind,
        path: s.path,
        success: true,
        rootId: s.path,
      })),
      allSucceeded: true,
    };
  }

  try {
    const batchResult = await registerRootBatch({
      sources: validSources.map((s) => ({
        kind: s.kind,
        path: s.path,
        // Backend RegisterSourceRequest is camelCase — must be `scanDepth`,
        // not `scan_depth`, or the whole batch arg fails to deserialize.
        scanDepth: s.scanDepth,
        // organizationState is required by the backend contract (spec 041 R-7).
        // Inbox is always unorganized; non-inbox carries the user's explicit choice.
        organizationState:
          s.kind === 'inbox' ? 'unorganized' : (s.organizationState ?? 'organized'),
      })),
    });

    const results: FlushRowResult[] = batchResult.results.map((item) => {
      if (item.success) {
        // Carry the assigned root id so the wizard scan step can scan this source.
        return {
          kind: item.kind as SourceKind,
          path: item.path,
          success: true,
          rootId: item.rootId,
        };
      }
      // Resolve through the single translation point so the user sees a friendly
      // catalog message, never the raw backend code (spec 046 FR-008/FR-009).
      const message = errMessage({ code: item.error ?? 'unknown', message: '' });
      return { kind: item.kind as SourceKind, path: item.path, success: false, error: message };
    });

    return { results, allSucceeded: results.every((r) => r.success) };
  } catch (err: unknown) {
    return {
      results: validSources.map((s) => ({
        kind: s.kind,
        path: s.path,
        success: false,
        error: m.setup_sources_error_batch_registration_failed({ message: errMessage(err) }),
      })),
      allSucceeded: false,
    };
  }
}
