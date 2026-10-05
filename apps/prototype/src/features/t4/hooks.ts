/**
 * T4 view-model hooks: the View from the route and its derived plans.
 */
import { useParams } from "@tanstack/react-router"
import { useMemo } from "react"
import type { Preparation, View } from "@/domain/types"
import { store, useStore } from "@/store/core"
import { emptyPrepDraft } from "@/store/slices/t4"
import { calibrationPlan, preparationPlan, workingMembership } from "./domain"
import { changedPreparedEntries } from "./operations"

export function useRouteView(): { viewId: string; view: View | null } {
  const params = useParams({ strict: false }) as { viewId?: string }
  const viewId = params.viewId ?? ""
  const view = useStore((s) => s.catalog.views[viewId] ?? null)
  return { viewId, view }
}

export function useCalibrationPlan(view: View | null) {
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const decisions = useStore((s) => s.slices.t4.decisions)
  return useMemo(() => (view ? calibrationPlan(catalog, disk, view, workingMembership(view), decisions) : null), [catalog, disk, view, decisions])
}

export function usePrepDraft(viewId: string) {
  return useStore((s) => s.slices.t4.prep[viewId]) ?? emptyPrepDraft()
}

export function usePreparationPlan(view: View | null) {
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const lastViewParent = useStore((s) => s.settings.lastViewParent)
  const draft = useStore((s) => (view ? s.slices.t4.prep[view.id] : undefined))
  const decisions = useStore((s) => s.slices.t4.decisions)
  return useMemo(() => {
    if (!view) return null
    const choices = draft ?? emptyPrepDraft()
    return preparationPlan({ disk, catalog, view, lastViewParent, choices, decisions })
  }, [disk, catalog, view, lastViewParent, draft, decisions])
}

/**
 * A preparation that Open found changed reads Unverified until the snapshot
 * bytes return (PREP-FR-10): the recorded refusal is re-checked against the
 * disk on every change, so restoring the bytes clears it without a launch.
 */
export function useUnverified(prep: Preparation | null) {
  const recorded = useStore((s) => (prep ? (s.slices.t4.unverified[prep.id] ?? null) : null))
  const disk = useStore((s) => s.disk)
  return useMemo(() => {
    if (!prep || !recorded || !disk) return null
    const changed = changedPreparedEntries(store.getState(), prep)
    return changed.length > 0 ? { at: recorded.at, changed } : null
  }, [prep, recorded, disk])
}
