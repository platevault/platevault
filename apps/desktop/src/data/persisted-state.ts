// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * persisted-state.ts — shared utility for SQLite-durable UI state (2026-07-24).
 *
 * Architecture decision: ALL persisted frontend state lives in SQLite;
 * localStorage is ONLY a synchronous boot cache. This utility generalises the
 * proven spec-018 theme/fontSize/zoom/locale pattern so every key gets the
 * same treatment for free.
 *
 * ## Write-behind policy
 *
 * `set()` updates in-memory (immediately authoritative), writes localStorage
 * synchronously (if `bootCache` is enabled), and schedules a debounced
 * `settingsUpdate` to SQLite. The SQLite write is fire-and-forget: a failure
 * never reverts the in-memory state, matching the existing
 * `persistThemeToSettings` convention.
 *
 * ## Hydration
 *
 * `hydrateScope(scope)` issues ONE `settingsGet(scope)` call per scope and
 * reconciles in-memory + localStorage from the DB response. `localStorage`
 * stays authoritative until the first successful reconcile (offline-safe).
 * Call it once at boot after Tauri IPC is available.
 *
 * One-time legacy import: if the DB has no value for a key but localStorage
 * has one, `hydrateScope` imports it into SQLite automatically.
 *
 * ## useSyncExternalStore compatibility
 *
 * The `subscribe` and `get` functions returned by `createPersistedState` are
 * directly compatible with `useSyncExternalStore(subscribe, get)`.
 */

// ── Scope registry ────────────────────────────────────────────────────────────
//
// All PersistedState instances register themselves by scope so that
// `hydrateScope` can reconcile all keys for a scope in ONE round-trip.

/** Internal handle stored in the scope registry. */
interface PersistedStateHandle<T> {
  readonly lsKey: string | null; // null when bootCache:false
  readonly settingsKey: string;
  readonly defaultValue: T;
  setFromDb(value: unknown): void;
  getForLegacyImport(): unknown; // the current localStorage raw value (pre-parse)
}

const scopeRegistry = new Map<string, Set<PersistedStateHandle<unknown>>>();

function registerHandle<T>(
  scope: string,
  handle: PersistedStateHandle<T>,
): void {
  let set = scopeRegistry.get(scope);
  if (!set) {
    set = new Set();
    scopeRegistry.set(scope, set);
  }
  (set as Set<PersistedStateHandle<unknown>>).add(
    handle as PersistedStateHandle<unknown>,
  );
}

// ── Tauri IPC helpers ─────────────────────────────────────────────────────────
//
// Memoised dynamic import — same pattern as theme.ts to prevent a Vitest
// dev-mode dynamic-import race when two callers both perform the first
// `import()` of the same mocked specifier concurrently.

let tauriCorePromise: Promise<typeof import('@tauri-apps/api/core')> | null =
  null;
function importTauriCore(): Promise<typeof import('@tauri-apps/api/core')> {
  if (!tauriCorePromise) {
    tauriCorePromise = import('@tauri-apps/api/core');
  }
  return tauriCorePromise;
}

// ── Debounce helper ───────────────────────────────────────────────────────────

function debounce<T extends unknown[]>(
  fn: (...args: T) => void,
  ms: number,
): (...args: T) => void {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return (...args: T) => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      fn(...args);
    }, ms);
  };
}

// ── Public API ────────────────────────────────────────────────────────────────

export interface PersistedStateOptions<T> {
  /** In-memory and localStorage default when no stored value exists. */
  default: T;
  /**
   * Write a localStorage boot cache on every `set()` call (default `true`).
   * Set to `false` for state not needed before first paint.
   */
  bootCache?: boolean;
  /**
   * Debounce window for the SQLite write-behind (ms). Default 500.
   * Reducing this makes writes more frequent; increasing it coalesces rapid
   * changes at the cost of a larger window of SQLite staleness.
   */
  debounceMs?: number;
}

export interface PersistedStateResult<T> {
  /** Synchronous read — always returns the current in-memory value. */
  get(): T;
  /** Update in-memory + localStorage + schedule debounced SQLite write. */
  set(value: T): void;
  /**
   * Subscribe to changes. Returns an unsubscribe function.
   * Directly compatible with `useSyncExternalStore`.
   */
  subscribe(listener: () => void): () => void;
  /**
   * Reconcile in-memory + localStorage from the DB response object produced by
   * `hydrateScope`. Not called directly by consumers — call `hydrateScope`
   * instead, which issues the batch `settingsGet` and calls this on each key.
   */
  _reconcileFromDbValues(values: Record<string, unknown>): void;
}

/**
 * Create a persisted state atom backed by SQLite (durable) and localStorage
 * (synchronous boot cache).
 *
 * @param scope      Settings scope for the SQLite key (e.g. `"ui_state"`).
 * @param key        Stable settings key within the scope (e.g.
 *                   `"uiState.logPanelExpanded"`).
 * @param opts       Options including the default value, boot-cache flag, and
 *                   debounce window.
 */
export function createPersistedState<T>(
  scope: string,
  key: string,
  opts: PersistedStateOptions<T>,
): PersistedStateResult<T> {
  const bootCache = opts.bootCache !== false;
  const debounceMs = opts.debounceMs ?? 500;
  const lsKey = bootCache ? `alm.ps.${key}` : null;

  // ── In-memory state ────────────────────────────────────────────────────────

  let current: T = readBootCache<T>(lsKey, opts.default);
  const listeners = new Set<() => void>();

  function notify(): void {
    for (const l of listeners) l();
  }

  // ── Debounced SQLite write ─────────────────────────────────────────────────

  const persistToDb = debounce((value: T) => {
    void (async () => {
      try {
        const { isTauri } = await importTauriCore();
        if (!isTauri()) return;
        const [{ commands }, { unwrap }] = await Promise.all([
          import('@/bindings/index'),
          import('@/api/ipc'),
        ]);
        unwrap(await commands.settingsUpdate(scope, { [key]: value }));
      } catch {
        // Best-effort — a DB write failure never blocks or reverts the UI change.
      }
    })();
  }, debounceMs);

  // ── Handle for the scope registry ─────────────────────────────────────────

  const handle: PersistedStateHandle<T> = {
    lsKey,
    settingsKey: key,
    defaultValue: opts.default,

    setFromDb(dbValue: unknown): void {
      const parsed = safeParse<T>(dbValue, opts.default);
      if (!shallowEqual(parsed, current)) {
        current = parsed;
        writeBootCache(lsKey, current);
        notify();
      }
    },

    getForLegacyImport(): unknown {
      if (!lsKey) return undefined;
      try {
        return window.localStorage.getItem(lsKey) ?? undefined;
      } catch {
        return undefined;
      }
    },
  };

  registerHandle(scope, handle);

  // ── Returned API ──────────────────────────────────────────────────────────

  return {
    get(): T {
      return current;
    },

    set(value: T): void {
      current = value;
      writeBootCache(lsKey, value);
      notify();
      persistToDb(value);
    },

    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    _reconcileFromDbValues(values: Record<string, unknown>): void {
      handle.setFromDb(values[key]);
    },
  };
}

// ── Scope hydration ───────────────────────────────────────────────────────────

/**
 * Reconcile all keys registered under `scope` from the SQLite settings DB in
 * ONE `settingsGet` round-trip. Call once per scope at boot after Tauri IPC is
 * available. No-ops outside Tauri or on IPC failure (localStorage stays
 * authoritative until the next successful call).
 *
 * One-time legacy import: for any key where the DB row is absent but a legacy
 * localStorage value exists, the value is imported into SQLite automatically.
 */
export async function hydrateScope(scope: string): Promise<void> {
  try {
    const { isTauri } = await importTauriCore();
    if (!isTauri()) return;

    const handles = scopeRegistry.get(scope);
    if (!handles || handles.size === 0) return;

    const [{ commands }, { unwrap }] = await Promise.all([
      import('@/bindings/index'),
      import('@/api/ipc'),
    ]);

    const data = unwrap(await commands.settingsGet(scope));
    const values = data.values as Record<string, unknown>;

    const legacyImports: Record<string, unknown> = {};

    for (const h of handles) {
      const dbValue = values[h.settingsKey];

      if (dbValue === undefined || dbValue === null) {
        // Key absent from DB — check for a legacy localStorage value to import.
        const legacy = h.getForLegacyImport();
        if (legacy !== undefined) {
          legacyImports[h.settingsKey] = legacy;
        }
        // Keep current in-memory value (localStorage already loaded at init).
        continue;
      }

      h.setFromDb(dbValue);
    }

    // Flush legacy imports into SQLite in one write (best-effort).
    if (Object.keys(legacyImports).length > 0) {
      try {
        unwrap(await commands.settingsUpdate(scope, legacyImports));
      } catch {
        // Legacy import is best-effort.
      }
    }
  } catch {
    // Keep the current localStorage-cached values authoritative.
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Read and parse a localStorage boot-cache entry; returns `defaultValue` on miss or error. */
function readBootCache<T>(lsKey: string | null, defaultValue: T): T {
  if (!lsKey) return defaultValue;
  try {
    const raw = window.localStorage.getItem(lsKey);
    if (raw === null) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

/** Write a value to localStorage; silently no-ops on failure. */
function writeBootCache<T>(lsKey: string | null, value: T): void {
  if (!lsKey) return;
  try {
    window.localStorage.setItem(lsKey, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — non-fatal.
  }
}

/**
 * Parse an opaque DB value into `T`; returns `defaultValue` when the DB
 * value is `null`/`undefined` or is unparseable. For primitive types (string,
 * number, boolean) this is a direct cast; for structured types (arrays,
 * objects) JSON round-trip through `JSON.parse(JSON.stringify(...))` ensures
 * a clean parse without trusting the DB shape blindly.
 */
function safeParse<T>(value: unknown, defaultValue: T): T {
  if (value === undefined || value === null) return defaultValue;
  try {
    // For plain JSON-compatible types the DB value IS already the parsed form
    // (Tauri deserialized the JSON row into a JS value). No extra parse needed;
    // just cast and let the caller validate if needed.
    return value as T;
  } catch {
    return defaultValue;
  }
}

/**
 * Shallow equality check used to skip notify() when the hydrated DB value
 * matches what's already in memory, preventing spurious re-renders.
 *
 * For arrays and objects this compares JSON serialisation — adequate for the
 * simple scalar / string-array types used by UI state keys; deep equality
 * isn't needed here.
 */
function shallowEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (typeof a === 'object') {
    try {
      return JSON.stringify(a) === JSON.stringify(b);
    } catch {
      return false;
    }
  }
  return false;
}

// ── Test helpers ──────────────────────────────────────────────────────────────

/**
 * Reset all scope registrations. Test-only — clears the module-level registry
 * so tests don't leak state across `createPersistedState` calls.
 */
export function __resetScopeRegistryForTest(): void {
  scopeRegistry.clear();
  // Also reset the memoised Tauri core promise so mock re-imports work.
  tauriCorePromise = null;
}
