/**
 * Settings and setup write helpers (v4 T1, kept for the settled Settings
 * sections). Durable catalog and settings changes go through `commit()`
 * (failed writes stay unsaved with Retry, D08); a `saved` Activity event is
 * recorded only after the commit returned ok, so Activity doubles as the
 * settings audit trail. Onboarding progress flags are UI progress and are
 * written directly.
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

/** Settings › About: reopen the setup steps; locations and data stay. Earlier setup runs no longer describe this setup. */
export function restartSetup() {
  setOnboarding({ completedAt: null })
  updateSlice("e", (slice) => ({ ...slice, setupOperationIds: [] }))
}

export function setRoleDeferred(role: LocationRole, deferred: boolean) {
  const current = store.getState().settings.onboarding.deferredRoles
  const next = deferred ? [...new Set([...current, role])] : current.filter((r) => r !== role)
  setOnboarding({ deferredRoles: next })
}
