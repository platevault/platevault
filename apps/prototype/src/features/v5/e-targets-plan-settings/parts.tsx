/**
 * Shared pieces of the Targets and Target pages (slice E): the chosen
 * night's sky context, the planning site, value wording for the planning
 * columns, and the actions on a Target that both pages offer (Add to Plan,
 * My targets, Add to Project ▸, New Project…). The night visuals are the
 * L2-domain ones (components/domain/sky-lines.tsx, grade-badges.tsx).
 */
import { useMemo } from "react"
import { openSheet } from "@/app/ui-state"
import type { Action, MenuItem } from "@/components/app/contracts"
import { formatHours, type Fit, planningSite, projectGoalSet } from "@/domain/derive"
import { defaultCriteria, nightSummary, upcomingNight } from "@/domain/planning"
import type { Catalog, NightDate, PlanCriteria, Target } from "@/domain/types"
import { formatTime } from "@/lib/format"
import { type Messages, msg, say } from "@/lib/i18n"
import { setFavourite } from "@/store/actions/library"
import { addToPlan } from "@/store/actions/planning"
import { addSubject } from "@/store/actions/projects"
import { commit, nowIso, useStore } from "@/store/core"
import type { SearchParams } from "@/routes"
import { nightGrid } from "./sky-tonight"
import { addToMyTargets, planRow, type SkyContext, type TargetRow, unplan } from "./targets-model"

const NIGHT = /^\d{4}-\d{2}-\d{2}$/

/**
 * The chosen night (`night`, `YYYY-MM-DD`, else tonight) at the active
 * planning site, recomputed every 10 minutes of the (simulated) clock; null
 * with no site or the "no site" prototype fault. A night before tonight, or
 * a malformed one, reads as tonight.
 */
export function useSkyContext(night?: string): SkyContext | null {
  const site = useStore((s) => planningSite(s))
  const offset = useStore((s) => s.faults.clockOffsetMs)
  const bucket = Math.floor((Date.now() + offset) / 600_000)
  return useMemo(() => {
    if (!site) return null
    const nowMs = Date.parse(nowIso())
    const tonight = upcomingNight(site, nowMs)
    const chosen = night && NIGHT.test(night) && !Number.isNaN(Date.parse(night)) && night > tonight ? night : tonight
    return { site, grid: nightGrid(site, chosen), summary: nightSummary(site, chosen), criteria: defaultCriteria(site), nowMs, tonight }
    // `bucket` re-derives tonight as the clock moves on.
  }, [site, bucket, night])
}

/** The night Add to plan adds to and Planned lists: the chosen night at the planning site, else today's date while no site is saved. */
export function planNight(ctx: SkyContext | null): NightDate {
  return ctx?.grid.night ?? nowIso().slice(0, 10)
}

/** The Targets view keys a Target link carries, so the list (and its night) is the same on return. */
export function keepSearch(search: SearchParams): SearchParams {
  const kept: SearchParams = {}
  for (const key of ["view", "night", "q", "mode", "cat", "preset", "good", "rig", "project", "saved"]) if (search[key]) kept[key] = search[key]
  return kept
}

/** "21:00–04:40" in the site's zone, for values whose zone the page header names. */
export function clockRange(start: string, end: string, timeZone: string): string {
  return `${formatTime(start, timeZone)}–${formatTime(end, timeZone)}`
}

/** The planning criteria behind every window. */
export function criteriaText(m: Messages, c: PlanCriteria): string {
  const parts = [
    m.tonight_criteria_altitude({ altitude: c.minAltitudeDeg }),
    c.darkness === "astronomical" ? m.tonight_criteria_astronomical() : m.tonight_criteria_nautical(),
    m.tonight_criteria_duration({ minutes: c.minDurationMin }),
  ]
  return parts.join(", ")
}

/** A Fit as one value ("Fits", "2 × 1 panels"), or "–". */
export function fitText(m: Messages, fit: Fit): string {
  return fit.kind === "unknown" ? "–" : say(m, fit.label)
}

/** Captured per channel: "Ha 9h15 · OIII 6h", or "–". */
export function capturedText(captured: ReadonlyArray<{ channel: string; seconds: number }>): string {
  return captured.length === 0 ? "–" : captured.map((c) => `${c.channel} ${formatHours(c.seconds)}`).join(" · ")
}

// ---------------------------------------------------------------------------
// Planning site
// ---------------------------------------------------------------------------

/** The sites for a SitePicker, by name. */
export function siteOptions(catalog: Catalog): { id: string; name: string }[] {
  return Object.values(catalog.sites)
    .map((site) => ({ id: site.id, name: site.name }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Pick the planning site, the one setting Home and Targets share: every planning value follows it. */
export function choosePlanningSite(siteId: string) {
  return commit(msg("plan_site"), (s) => ({ ...s, settings: { ...s.settings, planningSiteId: siteId } }), { href: "/targets" })
}

// ---------------------------------------------------------------------------
// Actions on a Target
// ---------------------------------------------------------------------------

/** Add to Plan, or Remove from Plan when the Target is on the night's plan. A catalogue result is written into the library first. */
export function planAction(m: Messages, row: TargetRow, night: NightDate, inPlan: boolean): Action {
  const target = row.target
  if (target && inPlan) return { id: "unplan", label: m.targets_remove_from_plan(), run: () => unplan(target.id, night) }
  return { id: "plan", label: m.targets_add_to_plan(), run: () => (target ? addToPlan(target.id, night) : planRow(row, night)) }
}

/** My targets membership (★, D-W60): add a result or a library Target, or take it out again. */
export function myTargetsAction(m: Messages, row: TargetRow): Action {
  const target = row.target
  if (target?.favourite) return { id: "my-remove", label: m.targets_my_remove(), run: () => setFavourite(target.id, false) }
  return { id: "my-add", label: m.targets_my_add(), run: () => addToMyTargets(row).result }
}

export function newProjectAction(m: Messages, targetId: string): Action {
  return { id: "new-project", label: m.newproject_open(), opensDialog: true, run: () => openSheet({ kind: "new-project", targetId }) }
}

/**
 * Add to Project ▸: one item per open Project the Target is not a subject
 * of, each confirming what it adds (the subject, and the goals it copies).
 * Null when every open Project already holds it.
 */
export function addToProjectMenu(m: Messages, catalog: Catalog, target: Target): MenuItem | null {
  const projects = Object.values(catalog.projects).filter((p) => p.state === "open" && !p.subjects.some((s) => s.targetId === target.id))
  if (projects.length === 0) return null
  return {
    submenu: m.session_add_to_project(),
    items: projects.map((p): Action => {
      const goals = projectGoalSet(p)
      const copies =
        goals.length > 0
          ? m.target_copies_goals({ goals: goals.map((v) => `${v.channel} ${v.integrationS ? formatHours(v.integrationS) : m.target_goal_frames({ count: v.frameCount ?? 0 })}`).join(", ") })
          : m.target_no_goals_to_copy()
      return {
        id: `add-to-${p.id}`,
        label: p.name,
        confirm: {
          title: m.target_add_to_title({ target: target.name, project: p.name }),
          summary: `${m.target_adds_subject({ name: target.name })} · ${copies}`,
          confirm: { label: m.target_add_to_named({ name: p.name }), kind: "primary" },
        },
        run: () => addSubject(p.id, { targetId: target.id, mosaic: null }, p.revision),
      }
    }),
  }
}
