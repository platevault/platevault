/**
 * Planning writes (foundation-owned): the Plan list of Targets. Adding keeps
 * a Target's saved criteria; removing only takes it off the list.
 */
import { defaultCriteria } from "@/domain/planning"
import { planningSite } from "@/domain/derive"
import type { TargetId } from "@/domain/types"
import { type CommitResult, commit, nowIso, store, withCatalog } from "@/store/core"
import { MISSING, recordSaved } from "./shared"

function setPlanned(targetId: TargetId, planned: boolean): CommitResult {
  const state = store.getState()
  const target = state.catalog.targets[targetId]
  if (!target) return MISSING
  if ((state.catalog.plans[targetId]?.planned ?? false) === planned) return { ok: true }
  const label = planned ? `Add ${target.name} to Plan` : `Remove ${target.name} from Plan`
  const result = commit(label, (s) =>
    withCatalog(s, (c) => {
      const existing = c.plans[targetId]
      const plan = existing ? { ...existing, planned, updatedAt: nowIso() } : { targetId, planned, criteria: defaultCriteria(planningSite(s)), updatedAt: nowIso() }
      return { ...c, plans: { ...c.plans, [targetId]: plan } }
    }),
    { href: "/plan" },
  )
  if (result.ok) recordSaved(label, null, "/plan")
  return result
}

export function addToPlan(targetId: TargetId): CommitResult {
  return setPlanned(targetId, true)
}

export function removeFromPlan(targetId: TargetId): CommitResult {
  return setPlanned(targetId, false)
}
