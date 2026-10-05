/**
 * T4 view-model hooks: the View from the route and its derived plans.
 */
import { useParams } from "@tanstack/react-router"
import { useMemo } from "react"
import type { View } from "@/domain/types"
import { useStore } from "@/store/core"
import { emptyPrepDraft } from "@/store/slices/t4"
import { calibrationPlan, preparationPlan, workingMembership } from "./domain"

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
