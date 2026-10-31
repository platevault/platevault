/**
 * A Target (`/targets/$targetId`, PLAN-FR-02, PLAN-TGT-FR-17): its Plan
 * area on a DetailPage, every planning value as the library computed it.
 *
 * - Header: the path back to Targets (keeping its view, night and site),
 *   the Favourite toggle beside the title, Export calendar… and Add to Plan
 *   (a night's plan waits for astro-plan-wre19.14).
 * - Tonight: the page's night at its planning site and zone, with the
 *   Target's Max alt, Img time, each band graded under its Moon curve, the
 *   darkness window, the Moon and the grade of each of its unfinished
 *   goals tonight.
 * - Windows: each night of the coming week with its windows
 *   (`planning_compute_windows`), or why it has none.
 * - Goals: each open Project's goal gaps for this Target, per subject and
 *   mosaic panel (`planning_target_gaps`).
 * - Notifications: the reviewed opt-in and the subscription's state
 *   (planned-tools.tsx).
 * - Identity and Library: the catalogue record, and the integration per
 *   channel with the session count.
 *
 * The page reads its Target with `targets_get` under its list's planning
 * context (the URL's site, night and rig), so it shows what the list row
 * shows, in My targets or not. Without a site or Home's criteria the planning
 * values read unknown with that reason; an unsaved Target reads as missing.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { CalendarArrowDown, CalendarClock, Crosshair, Star } from "lucide-react"
import { useState } from "react"
import {
  failureOf,
  type AngularSize,
  type DarknessWindow_Serialize,
  type GoalGap,
  type NightMoon_Serialize,
  type NightPlan_Serialize,
  type NoWindowReason,
  type ProjectGaps,
  type SkyCoordinates,
  type TargetRow_Serialize,
  type TargetsBasis_Serialize,
  type WindowSet_Serialize,
} from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { ActionButton, useAction } from "@/components/app/actions"
import { ActionToggle } from "@/components/app/action-toggle"
import { BoxTable } from "@/components/app/box"
import type { Action, Column } from "@/components/app/contracts"
import { KeyValueList, type KeyValueItem } from "@/components/app/data"
import { ActionError, DetailSkeleton, EmptyState, TableSkeleton } from "@/components/app/feedback"
import { DarkLine, MoonLine } from "@/components/domain/sky-lines"
import { type GradeBadge, GradeBadges } from "@/components/domain/grade-badges"
import type { PathItem } from "@/components/app/page"
import { type DetailSection, DetailPage } from "@/components/templates/detail-page"
import { formatCount, formatDec, formatDegrees, formatHours, formatList, formatNight, formatRa, numberText } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { goalGradesFor } from "./good-tonight"
import { favouriteAction, notYet, readFailure, Unknown, windowText } from "./parts"
import { ExportCalendarDialog, NotificationsPanel, RemindersDialog } from "./planned-tools"
import { gapsQuery, libraryQueryWhen, PLAN_NIGHTS } from "./queries"
import { darknessTonight, moonTonight } from "./sky-tonight"
import { bandGrades, capturedText, imgTimeText, recommendationText, type SearchParams, targetContext } from "./targets-model"

export function TargetPage() {
  const m = useMessages()
  const navigate = useNavigate()
  const { targetId } = useParams({ strict: false }) as { targetId: string }
  const search = useSearch({ strict: false }) as SearchParams
  const read = useQuery(libraryQueryWhen("targetsGet", [targetId, targetContext(search)]))
  const detail = read.data
  const path = [{ label: m.nav_targets(), link: { to: "/targets", search: search as Record<string, string> } }]
  const failure = failureOf(read.error)
  const missing = failure?.source === "library" && failure.error.code === "not_found"
  const failed = read.error && !missing ? { error: read.error, retry: read.refetch } : null

  if (failed) {
    return (
      <DetailPage
        path={path}
        title={m.nav_targets()}
        sections={[{ id: "failed", title: m.target_tonight(), content: <ActionError message={readFailure(m, failed.error)} onRetry={() => void failed.retry()} /> }]}
      />
    )
  }

  if (missing) {
    return (
      <DetailPage
        path={path}
        title={m.nav_targets()}
        sections={[{ id: "missing", title: m.targets_not_in_library(), content: <EmptyState icon={Crosshair} title={m.targets_not_in_library()} action={<ActionButton action={{ id: "back", label: m.nav_targets(), run: () => void navigate({ to: "/targets", search }) }} />} /> }]}
      />
    )
  }
  if (!detail) return <DetailSkeleton label={m.common_loading()} />
  return <TargetBody row={detail.row} basis={detail.basis} moon={detail.moon} darkness={detail.darkness} path={path} />
}

function TargetBody({
  row,
  basis,
  moon,
  darkness,
  path,
}: {
  row: TargetRow_Serialize
  basis: TargetsBasis_Serialize | null
  moon: NightMoon_Serialize | null
  darkness: DarknessWindow_Serialize | null
  path: PathItem[]
}) {
  const m = useMessages()
  const navigate = useNavigate()
  const client = useQueryClient()
  const runner = useAction()
  const target = row.target
  const [dialog, setDialog] = useState<"reminders" | "export" | null>(null)
  const windowQuery = basis ? { targetId: target.id, siteId: basis.site.id, firstNight: basis.night, nights: PLAN_NIGHTS, criteria: basis.criteria } : null
  const windows = useQuery(libraryQueryWhen("planningComputeWindows", windowQuery ? [windowQuery] : null))
  const gaps = useQuery(gapsQuery(target.id))
  const tonight = useQuery(libraryQueryWhen("planningTonight", basis ? [{ night: basis.night }] : null))

  const keys = windows.data?.nights.flatMap((n) => n.windows.map((w) => w.key)) ?? []
  const exportAction: Action = {
    id: "export-calendar",
    label: m.plan_export_calendar(),
    icon: CalendarArrowDown,
    opensDialog: true,
    run: () => setDialog("export"),
    unavailable: keys.length === 0 ? { action: m.actions_blocked({ action: m.plan_export_calendar() }), reason: m.plan_nothing_upcoming(), blockers: [] } : undefined,
  }
  // astro-plan-wre19.14: a night's plan has no read and no per-night write yet.
  const planAction: Action = { id: "plan", label: m.targets_add_to_plan(), icon: CalendarClock, run: () => undefined, unavailable: notYet(m, m.targets_add_to_plan()) }
  const fav = favouriteAction(m, client, target.id, row.favourite)
  // Grades come from Home's Tonight, which is at the default site: shown only when the page plans there too.
  const grades = tonight.data && basis && tonight.data.site?.id === basis.site.id ? goalGradesFor(tonight.data, target.id) : null

  const sections: DetailSection[] = [
    { id: "tonight", title: m.target_tonight(), content: <KeyValueList items={tonightItems(m, row, basis, moon, darkness, grades)} /> },
    { id: "windows", title: m.tonight_window(), content: windowsContent(m, basis, windows) },
    goalsSection(m, gaps),
    { id: "notifications", title: m.plan_reminders(), content: <NotificationsPanel targetId={target.id} onEnable={() => setDialog("reminders")} /> },
  ]
  const aside: DetailSection[] = [
    { id: "identity", title: m.target_identity(), content: <KeyValueList items={identityItems(m, row)} /> },
    {
      id: "library",
      title: m.nav_library(),
      content: (
        <KeyValueList
          items={[
            { label: m.nav_sessions(), value: row.sessions > 0 ? formatCount(row.sessions) : m.target_no_sessions() },
            { label: m.coverage_captured(), value: capturedText(m, row.captured) ?? m.target_library_empty() },
            { label: m.nav_projects(), value: row.projects.length > 0 ? formatList(row.projects.map((p) => p.name)) : "–" },
          ]}
        />
      ),
    },
  ]
  return (
    <>
      <DetailPage
        path={path}
        title={target.commonName ? `${target.designation} · ${target.commonName}` : target.designation}
        status={<ActionToggle label={m.targets_favourite()} pressed={row.favourite} action={fav} icon={Star} pressedIconClassName="fill-warning text-warning" runner={runner} />}
        statusFeedback={runner.feedback}
        actions={[exportAction, planAction]}
        sections={sections}
        aside={aside}
      />
      {runner.dialog}
      {basis ? <RemindersDialog targetId={target.id} criteria={basis.criteria} open={dialog === "reminders"} onOpenChange={(open) => setDialog(open ? "reminders" : null)} onManageSites={() => void navigate({ to: "/settings/sites" })} /> : null}
      {windowQuery && keys.length > 0 ? <ExportCalendarDialog selection={{ query: windowQuery, windowKeys: keys }} open={dialog === "export"} onOpenChange={(open) => setDialog(open ? "export" : null)} /> : null}
    </>
  )
}

function tonightItems(
  m: Messages,
  row: TargetRow_Serialize,
  basis: TargetsBasis_Serialize | null,
  moon: NightMoon_Serialize | null,
  darkness: DarknessWindow_Serialize | null,
  grades: ReturnType<typeof goalGradesFor> | null,
): KeyValueItem[] {
  const unknown = <Unknown reason={row.unknownReason} />
  const items: KeyValueItem[] = [
    { label: m.plan_site(), value: basis ? `${basis.site.name} · ${basis.timeZone}` : unknown },
    { label: m.tonight_night(), value: basis ? formatNight(basis.night, true) : unknown },
    { label: m.targets_max_alt(), value: row.maxAltitudeDeg === null ? unknown : formatDegrees(row.maxAltitudeDeg, 0) },
    { label: m.tonight_img_time(), value: imgTimeText(m, row) ?? unknown },
    {
      label: m.domain_suitable_filters(),
      value:
        row.bands.length === 0 ? (
          unknown
        ) : (
          <>
            <GradeBadges grades={bandGrades(row.bands)} wrap />
            {row.recommendation ? ` ${recommendationText(m, row.recommendation)}` : null}
          </>
        ),
    },
    { label: m.tonight_lunar(), value: row.lunarSeparationDeg === null ? unknown : formatDegrees(row.lunarSeparationDeg, 0) },
  ]
  const moonLine = moon ? moonTonight(moon) : null
  if (basis) items.push({ label: m.plan_dark(), value: <DarkLine darkness={darknessTonight(darkness)} timeZone={basis.timeZone} /> })
  if (moonLine && basis) items.push({ label: m.tonight_moon(), value: <MoonLine moon={moonLine} timeZone={basis.timeZone} /> })
  if (grades && grades.length > 0) {
    const badges: GradeBadge[] = grades.flatMap((g) => (g.band && g.grade ? [{ band: g.band, grade: g.grade }] : []))
    items.push({ label: m.targets_goal_grades(), value: <GradeBadges grades={badges.length > 0 ? badges : null} wrap /> })
  }
  return items
}

function noWindowText(m: Messages, reason: NoWindowReason): string {
  switch (reason) {
    case "never_dark":
      return m.targets_no_window_never_dark()
    case "target_never_above":
      return m.targets_no_window_too_low()
    case "moon_excluded":
      return m.targets_no_window_moon()
    case "shorter_than_minimum":
      return m.targets_no_window_short()
    case "no_overlap":
      return m.targets_no_window_no_overlap()
  }
}

function nightText(m: Messages, night: NightPlan_Serialize): string {
  if (night.windows.length > 0) return night.windows.map((w) => windowText(m, w)).join("; ")
  return night.noWindowReason ? noWindowText(m, night.noWindowReason) : m.plan_night_empty({ night: formatNight(night.night) })
}

function windowsContent(m: Messages, basis: TargetsBasis_Serialize | null, windows: { data?: WindowSet_Serialize; error: unknown; refetch: () => Promise<unknown> }) {
  if (!basis) return <Unknown reason="no_site" />
  if (windows.error) return <ActionError message={readFailure(m, windows.error)} onRetry={() => void windows.refetch()} />
  const set = windows.data
  if (!set) return <TableSkeleton rows={3} columns={2} label={m.common_loading()} />
  if (set.unavailableReason) return <Unknown reason={set.unavailableReason} />
  return <KeyValueList items={set.nights.map((night) => ({ label: formatNight(night.night), value: nightText(m, night) }))} />
}

interface GapRow {
  id: string
  project: string
  part: string
  gap: GoalGap
}

function amountText(gap: GoalGap, which: "inProject" | "captured"): string {
  const goal = gap.goal
  const tally = gap[which].tally
  if (goal.kind === "integration") return tally.seconds === null ? "–" : formatHours(tally.seconds)
  if (goal.kind === "frame_count") return formatCount(tally.frames)
  return "–"
}

function goalText(m: Messages, gap: GoalGap): string {
  const goal = gap.goal
  if (goal.kind === "integration") return formatHours(goal.goalSeconds)
  if (goal.kind === "frame_count") return m.target_goal_frames({ count: formatCount(goal.goalFrames) })
  return goal.criterion.criterion === "usable_only" ? m.goal_usable_frames() : m.domain_quality_max_fwhm({ arcsec: goal.criterion.maxArcsec === null ? "–" : numberText(goal.criterion.maxArcsec) })
}

function remainingText(m: Messages, gap: GoalGap): string {
  if (gap.met) return m.status_met()
  const r = gap.remaining
  if (r.kind === "integration") return r.seconds === null ? "–" : formatHours(r.seconds)
  return m.target_goal_frames({ count: formatCount(r.frames) })
}

function gapRows(projects: ProjectGaps[]): GapRow[] {
  return projects.flatMap((p) => [
    ...p.gaps.map((gap) => ({ id: `${p.projectId}:${gap.goal.id}`, project: p.projectName, part: p.name ?? p.designation, gap })),
    ...p.panels.flatMap((panel) => panel.gaps.map((gap) => ({ id: `${p.projectId}:${panel.groupId}:${gap.goal.id}`, project: p.projectName, part: panel.name, gap }))),
  ])
}

/** Each open Project's per-channel goal gap, with its "in project" and "captured" amounts (PLAN-FR-02). */
function goalsSection(m: Messages, read: { data?: ProjectGaps[]; error: unknown; isPending: boolean; refetch: () => Promise<unknown> }): DetailSection {
  const rows = gapRows(read.data ?? [])
  const columns: Column<GapRow>[] = [
    { id: "project", header: m.project_noun(), rowHeader: true, truncate: true, sortValue: (r) => r.project, cell: (r) => r.project },
    { id: "part", header: m.targets_panel(), truncate: true, sortValue: (r) => r.part, cell: (r) => r.part },
    { id: "channel", header: m.project_col_channels(), sortValue: (r) => ("channel" in r.gap.goal ? (r.gap.goal.channel ?? "") : ""), cell: (r) => ("channel" in r.gap.goal ? (r.gap.goal.channel ?? m.palette_session_no_filter()) : "–") },
    { id: "goal", header: m.project_goals_title(), sortValue: (r) => goalText(m, r.gap), cell: (r) => goalText(m, r.gap) },
    { id: "in-project", header: m.project_in_project(), align: "right", sortValue: (r) => r.gap.inProject.tally.frames, cell: (r) => amountText(r.gap, "inProject") },
    { id: "captured", header: m.project_captured(), align: "right", sortValue: (r) => r.gap.captured.tally.frames, cell: (r) => amountText(r.gap, "captured") },
    { id: "remaining", header: m.targets_still_needed(), align: "right", sortValue: (r) => (r.gap.met ? 0 : 1), cell: (r) => remainingText(m, r.gap) },
  ]
  return {
    id: "goals",
    title: m.plan_goals(),
    count: rows.length,
    flush: true,
    content: (
      <BoxTable
        label={m.plan_goals()}
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        loading={read.isPending}
        error={read.error ? { message: readFailure(m, read.error), onRetry: () => void read.refetch() } : undefined}
        empty={m.targets_no_open_goals()}
      />
    ),
  }
}

function identityItems(m: Messages, row: TargetRow_Serialize): KeyValueItem[] {
  const t = row.target
  const coordinates = t.coordinates
  return [
    { label: m.targets_designation(), value: t.designation },
    { label: m.target_aliases(), value: t.aliases.length > 0 ? formatList(t.aliases.map((a) => a.text)) : "–" },
    { label: m.targets_type(), value: t.objectType },
    { label: m.target_coordinates(), value: coordinates ? coordinatesText(coordinates) : <Unknown reason="target_coordinates_unknown" /> },
    { label: m.target_angular_size(), value: (t.angularSize ? angularText(t.angularSize) : null) ?? m.target_size_unknown() },
  ]
}

function coordinatesText(c: SkyCoordinates): string {
  return c.raDeg !== null && c.decDeg !== null ? `${formatRa(c.raDeg)} ${formatDec(c.decDeg)} · ${c.frame}` : "–"
}

/** "178′ × 140′", or the major axis alone. */
function angularText(size: AngularSize): string | null {
  if (size.majorArcmin === null) return null
  return size.minorArcmin === null ? `${numberText(size.majorArcmin)}′` : `${numberText(size.majorArcmin)}′ × ${numberText(size.minorArcmin)}′`
}
