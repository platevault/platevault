/**
 * T1 write helpers. Durable catalog and settings changes go through `commit()`
 * (failed writes stay unsaved with Retry, D08); a `saved` Activity event is
 * recorded only after the commit returned ok, so Activity doubles as the
 * settings audit trail (J10 S3, J15 S5, HLD §14). Onboarding progress flags are
 * UI progress and are written directly.
 */
import type { AppSettings, LocationRole } from "@/domain/types"
import { type CommitResult, commit, nowIso, type PrototypeState, recordActivity, store, updateSlice } from "@/store/core"

export interface SaveOptions {
  /** Noun phrase for the change; failures read "<label> was not saved: …". */
  label: string
  /** Activity title after a successful write, e.g. "Registered Astro-T7 captures". */
  saved: string
  detail?: string | null
  /** Route (without #) that owns the outcome. */
  href: string
}

export function save(options: SaveOptions, mutate: (state: PrototypeState) => PrototypeState): CommitResult {
  const result = commit(options.label, mutate, { href: options.href })
  if (result.ok) recordActivity({ kind: "saved", title: options.saved, detail: options.detail ?? null, operationId: null, href: options.href })
  return result
}

function setOnboarding(patch: Partial<AppSettings["onboarding"]>) {
  store.setState((s) => ({ ...s, settings: { ...s.settings, onboarding: { ...s.settings.onboarding, ...patch } } }))
}

/** Open library, Index later and Set up later all end setup (HLD seam 1). */
export function completeOnboarding() {
  if (store.getState().settings.onboarding.completedAt) return
  setOnboarding({ completedAt: nowIso() })
}

/** Settings › About: reopen the setup steps; locations and data stay. */
export function restartSetup() {
  setOnboarding({ completedAt: null })
}

export function setRoleDeferred(role: LocationRole, deferred: boolean) {
  const current = store.getState().settings.onboarding.deferredRoles
  const next = deferred ? [...new Set([...current, role])] : current.filter((r) => r !== role)
  setOnboarding({ deferredRoles: next })
}

/** Finish and Skip are the same terminal outcome of the one-time walk (J18 S3). */
export function endTour() {
  if (!store.getState().settings.onboarding.tourCompletedAt) setOnboarding({ tourCompletedAt: nowIso() })
  updateSlice("t1", (slice) => ({ ...slice, tour: { replaying: false, stop: 0 } }))
}

export function setTourStop(stop: number) {
  updateSlice("t1", (slice) => ({ ...slice, tour: { ...slice.tour, stop } }))
}

/** Replay from Settings or the checklist (J18 S5); the checklist state is untouched. */
export function replayTour() {
  updateSlice("t1", (slice) => ({ ...slice, tour: { replaying: true, stop: 0 } }))
}

export function setChecklistHidden(hidden: boolean) {
  setOnboarding({ checklistHidden: hidden })
}

export function setChecklistCollapsed(collapsed: boolean) {
  updateSlice("t1", (slice) => ({ ...slice, checklistCollapsed: collapsed }))
}
