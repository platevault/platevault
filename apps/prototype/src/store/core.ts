/**
 * Prototype store core (foundation-owned). A single typed state tree held in
 * memory, read with `useStore(selector)` (useSyncExternalStore) and persisted
 * to localStorage. No state library.
 *
 * Contract for screens:
 * - Read with `useStore((s) => …)`. Selectors may return new objects; the
 *   result is cached per state version and selector identity.
 * - Write durable catalog changes through `commit()`, which honours the
 *   simulated failed-write fault and stale-revision refusal (D08), and bumps
 *   the `expect` entity's revision on success. Never report success unless
 *   `commit()` returned `{ ok: true }`. The shared actions in
 *   `src/store/actions/` already do this.
 * - Keep screen-local UI state in your slice (`updateSlice`).
 * - Slice modules must not call store functions at module top level.
 */
import { useRef, useSyncExternalStore } from "react"
import type { SeedData } from "@/domain/seed"
import type { ActivityEvent, Catalog } from "@/domain/types"
import { type MessageRef, m, msg, say } from "@/lib/i18n"
import type { SliceId, SliceStates } from "./slices"

/** Bump when a domain shape changes; saved data of an older version restarts its seed. 9: operation and Activity copy stored as message refs, worded at render. 10: Target evidence is pointing and user rows only (OBJECT is a label). */
export const SCHEMA_VERSION = 10

export interface PrototypeState extends SeedData {
  schemaVersion: number
  /** Persisted version of each slice; a mismatch resets that slice only. */
  sliceVersions: Record<SliceId, number>
  slices: SliceStates
  /** Ids of the notifications the user has seen (`store/notifications.ts`); absent until the history is first opened. */
  noticesRead?: string[]
}

type Listener = () => void

let state: PrototypeState | null = null
const listeners = new Set<Listener>()

export const store = {
  getState(): PrototypeState {
    if (!state) throw new Error("Store read before initializeStore()")
    return state
  },
  /** Replace state through an updater. Returning the same object is a no-op. */
  setState(updater: (current: PrototypeState) => PrototypeState) {
    const current = store.getState()
    const next = updater(current)
    if (next === current) return
    state = next
    for (const listener of listeners) listener()
  },
  subscribe(listener: Listener) {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
  /** Used once by initializeStore. */
  replace(next: PrototypeState) {
    state = next
    for (const listener of listeners) listener()
  },
}

/**
 * Subscribe a component to a derived value of the state. The value is cached
 * per (state version, selector identity), so a snapshot is stable within one
 * render even when the selector builds a new object, and a selector that
 * closes over new props is always re-evaluated.
 */
export function useStore<T>(selector: (state: PrototypeState) => T): T {
  const cache = useRef<{ state: PrototypeState; selector: (state: PrototypeState) => T; value: T } | null>(null)
  const getSnapshot = () => {
    const current = store.getState()
    const cached = cache.current
    if (cached && cached.state === current && cached.selector === selector) return cached.value
    const value = selector(current)
    cache.current = { state: current, selector, value }
    return value
  }
  return useSyncExternalStore(store.subscribe, getSnapshot, getSnapshot)
}

let activityCounter = 0

/** Append an Activity outcome (newest first, capped). */
export function recordActivity(event: Omit<ActivityEvent, "id" | "at">) {
  activityCounter += 1
  const entry: ActivityEvent = { ...event, id: `act_${Date.now().toString(36)}_${activityCounter}`, at: new Date().toISOString() }
  store.setState((s) => ({ ...s, activity: [entry, ...s.activity].slice(0, 200) }))
}

type RevisionedCollection = "runs" | "runGroups" | "projects" | "sessions" | "targets"

export type CommitResult =
  | { ok: true }
  | { ok: false; reason: "write-failed" | "stale"; message: string }
  /** A contract rule refused the action; `reasons` names each blocker (e.g. RES-FR-10). Nothing was written. */
  | { ok: false; reason: "refused"; message: string; reasons: string[] }

export interface CommitOptions {
  /**
   * Refuse the write when the entity changed since it was read (D08). On
   * success the entity's revision is bumped once, so mutators never bump it
   * themselves and patch only the fields they own on the entity as read
   * inside `mutate`.
   */
  expect?: { collection: RevisionedCollection; id: string; revision: number }
  /** Hash route that owns the outcome, recorded with failures. */
  href?: string
}

/**
 * Durable catalog write. Failed writes stay unsaved: the caller keeps the
 * edited value on screen, marks it "Not saved" and offers Retry. `label`
 * names the write in Activity ("Save run"); the returned message is worded
 * now, the Activity entry when it is read.
 */
export function commit(label: MessageRef, mutate: (state: PrototypeState) => PrototypeState, options: CommitOptions = {}): CommitResult {
  if (options.expect && store.getState().faults.staleNextWrite) {
    // Simulated concurrent writer: the record moves to a newer revision first.
    const { collection, id } = options.expect
    store.setState((s) => {
      const records = s.catalog[collection] as Catalog[RevisionedCollection]
      const entity = records[id]
      if (!entity) return s
      return {
        ...s,
        faults: { ...s.faults, staleNextWrite: false },
        catalog: { ...s.catalog, [collection]: { ...records, [id]: { ...entity, revision: entity.revision + 1 } } },
      }
    })
  }
  const current = store.getState()
  if (options.expect) {
    const { collection, id, revision } = options.expect
    const entity = (current.catalog[collection] as Catalog[RevisionedCollection])[id]
    if (entity && entity.revision !== revision) {
      // The record version is internal (D08); it is not the run membership "Revision N" a page shows, so the message names no number.
      const message = msg("store_stale_message", { label })
      recordActivity({ kind: "write-refused", title: msg("store_refused", { label }), detail: message, operationId: null, href: options.href ?? null })
      return { ok: false, reason: "stale", message: say(m, message) }
    }
  }
  if (current.faults.failNextCatalogWrite) {
    const message = msg("store_not_saved_message", { label })
    store.setState((s) => ({ ...s, faults: { ...s.faults, failNextCatalogWrite: false } }))
    recordActivity({ kind: "write-failed", title: msg("store_not_saved_title", { label }), detail: message, operationId: null, href: options.href ?? null })
    return { ok: false, reason: "write-failed", message: say(m, message) }
  }
  store.setState((s) => {
    const next = mutate(s)
    if (!options.expect) return next
    const { collection, id, revision } = options.expect
    const records = next.catalog[collection] as Catalog[RevisionedCollection]
    const entity = records[id]
    if (!entity || entity.revision !== revision) return next
    return { ...next, catalog: { ...next.catalog, [collection]: { ...records, [id]: { ...entity, revision: revision + 1 } } } }
  })
  return { ok: true }
}

/** Shallow catalog update helper for use inside `commit` mutators and operation steps. */
export function withCatalog(state: PrototypeState, update: (catalog: Catalog) => Catalog): PrototypeState {
  return { ...state, catalog: update(state.catalog) }
}

/** Update one track's slice state. Not a durable catalog write. */
export function updateSlice<K extends SliceId>(id: K, update: (slice: SliceStates[K]) => SliceStates[K]) {
  store.setState((s) => ({ ...s, slices: { ...s.slices, [id]: update(s.slices[id]) } }))
}

/**
 * Current time as ISO string; one seam so operations and commits agree. It
 * honours the simulated clock offset (`faults.clockOffsetMs`), which is
 * persisted, so a set clock survives a reload (J29 P4).
 */
export function nowIso(): string {
  return new Date(Date.now() + (state?.faults.clockOffsetMs ?? 0)).toISOString()
}
