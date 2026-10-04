/**
 * Prototype store core (foundation-owned). A single typed state tree held in
 * memory, read with `useStore(selector)` (useSyncExternalStore) and persisted
 * to localStorage. No state library.
 *
 * Contract for tracks:
 * - Read with `useStore((s) => …)`. Selectors may return new objects; the
 *   result is cached per state version and selector identity.
 * - Write durable catalog changes through `commit()`, which honours the
 *   simulated failed-write fault and stale-revision refusal (D08). Never
 *   report success unless `commit()` returned `{ ok: true }`.
 * - Keep track-local UI state in your slice (`updateSlice`).
 * - Slice modules must not call store functions at module top level.
 */
import { useRef, useSyncExternalStore } from "react"
import type { SeedData } from "@/domain/seed"
import type { ActivityEvent, Catalog } from "@/domain/types"
import type { SliceId, SliceStates } from "./slices"

export const SCHEMA_VERSION = 2

export interface PrototypeState extends SeedData {
  schemaVersion: number
  /** Persisted version of each slice; a mismatch resets that slice only. */
  sliceVersions: Record<SliceId, number>
  slices: SliceStates
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

type RevisionedCollection = "views" | "projects" | "sessions" | "targets"

export type CommitResult =
  | { ok: true }
  | { ok: false; reason: "write-failed" | "stale"; message: string }

export interface CommitOptions {
  /** Refuse the write when the entity changed since it was read (D08). */
  expect?: { collection: RevisionedCollection; id: string; revision: number }
  /** Hash route that owns the outcome, recorded with failures. */
  href?: string
}

/**
 * Durable catalog write. Failed writes stay unsaved: the caller keeps the
 * edited value on screen, marks it "Not saved" and offers Retry.
 */
export function commit(label: string, mutate: (state: PrototypeState) => PrototypeState, options: CommitOptions = {}): CommitResult {
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
      const message = `${label} was refused: this record changed since you opened it (revision ${revision} → ${entity.revision}). Review the current revision before saving again.`
      recordActivity({ kind: "write-refused", title: `${label} refused`, detail: message, operationId: null, href: options.href ?? null })
      return { ok: false, reason: "stale", message }
    }
  }
  if (current.faults.failNextCatalogWrite) {
    const message = `${label} was not saved: the catalog write failed. Your change is kept on screen; choose Retry.`
    store.setState((s) => ({ ...s, faults: { ...s.faults, failNextCatalogWrite: false } }))
    recordActivity({ kind: "write-failed", title: `${label} not saved`, detail: message, operationId: null, href: options.href ?? null })
    return { ok: false, reason: "write-failed", message }
  }
  store.setState(mutate)
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

/** Current time as ISO string; one seam so operations and commits agree. */
export function nowIso(): string {
  return new Date().toISOString()
}
