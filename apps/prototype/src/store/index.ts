/**
 * Store bootstrap: hydration, persistence and reset (foundation-owned).
 */
import { createSeed, defaultFaults } from "@/domain/seed"
import type { SeedName } from "@/domain/types"
import { type PrototypeState, recordActivity, SCHEMA_VERSION, store } from "./core"
import { ensureTicker, interruptRunningOperations, registerOperationHandlers } from "./operations"
import { initialSliceStates, SLICES, type SliceId, sliceVersions } from "./slices"

export const STORAGE_KEY = "platevault.prototype.v1"

function fromSeed(seed: SeedName): PrototypeState {
  return { ...createSeed(seed), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
}

function load(): PrototypeState | null {
  let raw: string | null = null
  try {
    raw = localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as PrototypeState
    // An older data shape cannot be trusted: start the same seed fresh.
    if (parsed.schemaVersion !== SCHEMA_VERSION) return fromSeed(parsed.seed === "demo" ? "demo" : "empty")
    // A slice whose shape changed resets alone; other tracks keep their state.
    const versions = sliceVersions()
    const initial = initialSliceStates()
    const slices = { ...initial, ...parsed.slices }
    for (const id of Object.keys(versions) as SliceId[]) {
      if (parsed.sliceVersions?.[id] !== versions[id]) Object.assign(slices, { [id]: initial[id] })
    }
    // Faults added since the data was saved start at their defaults.
    return { ...parsed, faults: { ...defaultFaults(), ...parsed.faults }, sliceVersions: versions, slices }
  } catch {
    return null
  }
}

let persistTimer: number | null = null
let persistFailed = false

function persistNow() {
  window.clearTimeout(persistTimer ?? undefined)
  persistTimer = null
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(store.getState()))
    persistFailed = false
  } catch {
    if (persistFailed) return
    persistFailed = true
    recordActivity({
      kind: "write-failed",
      title: "Prototype data not saved in this browser",
      detail: "Browser storage refused the write. Changes stay in this tab until it closes.",
      operationId: null,
      href: null,
    })
  }
}

let initialized = false

/** Hydrate from localStorage (or the empty seed) and start persistence. */
export function initializeStore() {
  if (initialized) return
  initialized = true
  for (const slice of Object.values(SLICES)) if (slice.operations) registerOperationHandlers(slice.operations)
  store.replace(interruptRunningOperations(load() ?? fromSeed("empty")))
  store.subscribe(() => {
    window.clearTimeout(persistTimer ?? undefined)
    persistTimer = window.setTimeout(persistNow, 250)
  })
  window.addEventListener("pagehide", persistNow)
}

/** Replace all prototype data with a seed. Theme and density are kept. */
export function resetPrototype(seed: SeedName) {
  store.replace(fromSeed(seed))
  persistNow()
  ensureTicker()
}
