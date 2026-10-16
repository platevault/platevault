/**
 * Slice B derivations the Project screens read, over the shared store and
 * types: the goal channels a Project's rigs capture, the goal templates on
 * offer, and what applying a goal template changes. Wrap up's offers and
 * flow are the domain's (`domain/project-view.ts`). Pure: nothing here
 * writes state.
 */
import { kindsLine } from "@/components/domain/goal-fields"
import { rigCameraKind, rigFilters } from "@/domain/derive"
import { GOAL_CHANNELS, NARROW_BANDS } from "@/domain/labels"
import { BUILT_IN_GOAL_TEMPLATES } from "@/domain/templates"
import type { Catalog, Goal, GoalChannel, GoalTemplate, OpticalTrainId, Project } from "@/domain/types"
import type { Messages } from "@/lib/i18n"
import { goalsFromValues } from "@/store/actions/projects"

// ---------------------------------------------------------------------------
// Goals and channels
// ---------------------------------------------------------------------------

/** Goal channels a rig captures, as `goalChannel` reads them (D-W29, D-W31): a single band, "OSC" or "Dual-band". */
export function rigChannels(catalog: Catalog, rigId: OpticalTrainId): GoalChannel[] {
  const rig = catalog.opticalTrains[rigId]
  if (!rig) return []
  const osc = rigCameraKind(catalog, rig) === "osc"
  const out = new Set<GoalChannel>(osc ? ["OSC"] : [])
  for (const filter of rigFilters(catalog, rig)) {
    if (filter.bands.filter((b) => NARROW_BANDS.includes(b)).length >= 2) out.add("Dual-band")
    else if (!osc && filter.bands.length === 1) out.add(filter.bands[0]!)
  }
  return GOAL_CHANNELS.filter((c) => out.has(c))
}

/** Channels the Project's rigs capture, in chip order. */
export function projectChannels(catalog: Catalog, rigIds: OpticalTrainId[]): GoalChannel[] {
  const out = new Set(rigIds.flatMap((id) => rigChannels(catalog, id)))
  return GOAL_CHANNELS.filter((c) => out.has(c))
}

/** The built-in goal templates, then the user's. */
export function goalTemplates(catalog: Catalog): GoalTemplate[] {
  return [...BUILT_IN_GOAL_TEMPLATES, ...Object.values(catalog.goalTemplates)]
}

/**
 * What applying a template changes, one line per channel and change: "5 h →
 * 10 h · 4 goals", "New: 10 h · 2 goals", "Removed: 120 frames". Unchanged
 * goals are not listed (B: the preview shows the goal changes only). A
 * mosaic's goals are per panel group (PRJ-FR-29).
 */
export function templateChanges(msgs: Messages, project: Project, template: GoalTemplate): Array<{ label: GoalChannel; value: string }> {
  const key = (g: Pick<Goal, "subjectId" | "groupId" | "channel">) => `${g.subjectId}|${g.groupId ?? ""}|${g.channel}`
  const panels = project.groups.filter((g) => g.panel).map((g) => g.id)
  const next = project.subjects.flatMap((subject) => goalsFromValues(template.values, subject.id, panels))
  const before = new Map(project.goals.map((g) => [key(g), g]))
  const after = new Map(next.map((g) => [key(g), g]))
  const counts = new Map<string, { channel: GoalChannel; line: string; count: number }>()
  const bump = (channel: GoalChannel, line: string) => {
    const id = `${channel}\u0000${line}`
    const found = counts.get(id)
    counts.set(id, { channel, line, count: (found?.count ?? 0) + 1 })
  }
  for (const [k, goal] of after) {
    const old = before.get(k)
    if (!old) bump(goal.channel, msgs.goal_change_new({ line: kindsLine(msgs, goal) }))
    else if (kindsLine(msgs, old) !== kindsLine(msgs, goal)) bump(goal.channel, msgs.goal_change_from_to({ from: kindsLine(msgs, old), to: kindsLine(msgs, goal) }))
  }
  for (const [k, goal] of before) if (!after.has(k)) bump(goal.channel, msgs.goal_change_removed({ line: kindsLine(msgs, goal) }))
  return [...counts.values()].map(({ channel, line, count }) => ({ label: channel, value: count > 1 ? `${line} · ${msgs.project_goals_count({ count })}` : line }))
}
