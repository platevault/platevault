/**
 * S1 Home (slice A, decision C8, 2026-10-13): one dashboard of what needs
 * you, what runs and when to capture next. Each row leads to the page that
 * owns it; a section shows at most 5 rows, then "All N ›" to that page.
 *
 * A DetailPage with no header buttons. From 1280 px the sections stand in
 * two columns: Pending ingestions, Pending work and Open work on the left;
 * Status, Tonight and the calendar on the right. Narrower, one column in
 * that order.
 *
 * - Pending ingestions: per Captures location, new files since its last
 *   scan, a location never scanned or whose last scan did not finish, a
 *   stopped or failed import (Retry), or a running one with its progress.
 * - Pending work: sessions that need a Target, wait for review, sit in no
 *   Project or are ready to add to a run; Finished runs awaiting Clean up,
 *   with the space each frees.
 * - Open work: open Projects and calibration processes, where each stands
 *   and its next step, deadline or season first with "N nights left".
 * - Status: locations (online, free space, low on space) and background
 *   jobs other than imports.
 * - Tonight: unfinished goals graded for tonight at the planning site, which
 *   Home names and Targets changes.
 * - Calendar: 5 weeks from the start of this week (the locale's first day).
 *   Each night opens its card on hover or focus and leads to Targets set to
 *   that night.
 *
 * Problems show on the row they affect (`issueCopy` words them as Issues
 * does). Row actions are Action descriptors: one click only where nothing
 * more is asked and the action can be undone (Add to run, Add to Plan,
 * Pause, Resume), each with an Undo toast; everything else opens its page.
 */
import { FolderPlus, Import, MapPin, Pause, Play } from "lucide-react"
import { useMemo } from "react"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/app/run-ui"
import { openSheet } from "@/app/ui-state"
import { ActionButton, ActionMenu } from "@/components/app/actions"
import { BoxTable } from "@/components/app/box"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { EmptyState, toast } from "@/components/app/feedback"
import { issueCopy } from "@/components/app/issue-row"
import { Pill } from "@/components/app/pill"
import { UsedByPreview } from "@/components/app/previews"
import { StatusBadge } from "@/components/app/status"
import { GradeBadges } from "@/components/domain/grade-badges"
import { type CalendarNight, NightCalendar } from "@/components/domain/night-calendar"
import { siteTimeRange, siteTime } from "@/components/domain/sky-lines"
import { DetailPage, type DetailSection } from "@/components/templates/detail-page"
import { CALIBRATION_STEP_NAME, type ProcessStatus } from "@/domain/calibration-process"
import {
  calibrationStepLink,
  findSubject,
  formatHours,
  liveLightSessions,
  planningSite,
  projectLink,
  runCandidates,
  sessionIntakeEntry,
  sessionIntakeLink,
  type StepLink,
  subjectName,
  type World,
} from "@/domain/derive"
import { cleanUpLink, homeStatus, type IngestionRow, type LocationStatus, openWork, type OpenWork, operationLink, pendingIngestions, type PendingWork, pendingWork } from "@/domain/home"
import type { Issue } from "@/domain/issues"
import { sessionLongLabel } from "@/domain/membership"
import { type GoalOutlook, goalHorizon, goalsTonight, type NightOutlook, nightOutlooks } from "@/domain/outlook"
import { nightPlan, upcomingNight } from "@/domain/planning"
import type { Catalog, NightDate, ObservingSite, Operation, Project, TargetId } from "@/domain/types"
import { formatBytes, formatCount, formatNight } from "@/lib/format"
import { getLocale, type Messages, msg, say } from "@/lib/i18n"
import { dayInWeek, WEEK_START } from "@/lib/week"
import { addToPlan, removeFromPlan } from "@/store/actions/planning"
import { addRunSessions, removeRunSessions } from "@/store/actions/runs"
import { nowIso, useStore } from "@/store/core"
import { pauseOperation, resumeOperation } from "@/store/operations"
import { runToJoin } from "./session-model"

/** Rows a section shows before "All N ›" (C8). */
const ROWS = 5

/** The calendar's weeks, from the start of this week. */
const CALENDAR_WEEKS = 5

type Follow = (link: StepLink) => void

interface HomeContext {
  world: World
  /** The planning site Targets uses too; null without one. */
  site: ObservingSite | null
  nowMs: number
  /** Tonight at the site, else today's date. */
  tonight: NightDate
}

/**
 * Home's reading of the store. The site, the clock and tonight re-derive
 * only when the catalogue, the settings or a 10-minute step of the
 * (simulated) clock changes, so a running operation's progress never redoes
 * the 5-week horizon.
 */
function useHomeContext(): HomeContext {
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const operations = useStore((s) => s.operations)
  const settings = useStore((s) => s.settings)
  const faults = useStore((s) => s.faults)
  const bucket = Math.floor((Date.now() + faults.clockOffsetMs) / 600_000)
  const sky = useMemo(() => {
    const site = planningSite({ catalog, settings, faults })
    const nowMs = Date.parse(nowIso())
    return { site, nowMs, tonight: site ? upcomingNight(site, nowMs) : nowIso().slice(0, 10) }
    // `bucket` re-derives tonight as the clock moves on.
  }, [catalog, settings, faults, bucket])
  return useMemo(() => ({ world: { disk, catalog, operations, settings, faults }, ...sky }), [disk, catalog, operations, settings, faults, sky])
}

function locationLink(locationId: string): StepLink {
  return { to: "/settings/locations", search: { locationId } }
}

/** Targets on a night: no `night` for tonight, as Targets reads an absent night. */
function targetsLink(night: NightDate, tonight: NightDate): StepLink {
  return { to: "/targets", search: night === tonight ? {} : { night } }
}

/** "All 12 ›": the owning page, from a section that shows only its first rows. */
function allAction(m: Messages, follow: Follow, id: string, count: number, link: StepLink): Action[] {
  return count > ROWS ? [{ id: `${id}-all`, label: m.home_all({ count: formatCount(count) }), run: () => follow(link) }] : []
}

/** One click with an Undo toast (C8): the change commits at once and the toast offers its inverse. */
function withUndo(m: Messages, message: string, undo: () => unknown): void {
  toast({ message, action: { id: "undo", label: m.wrapup_undo(), run: () => void undo() } })
}

/** The goal's subject, with its panel for a mosaic panel's goal: "IC 5070 · Panel 2". */
function goalSubject(m: Messages, catalog: Catalog, project: Project, subjectId: string, panelId: string | null): string {
  const subject = findSubject(project, subjectId)
  const name = subject ? subjectName(m, catalog, subject) : m.plan_unknown_target()
  const panel = panelId ? subject?.mosaic?.panels.find((p) => p.id === panelId) : undefined
  return panel ? m.home_panel({ name, n: panel.n }) : name
}

function goalName(m: Messages, catalog: Catalog, g: GoalOutlook): string {
  return m.home_goal_item({ subject: goalSubject(m, catalog, g.subject.project, g.progress.goal.subjectId, g.progress.goal.panelId), channel: g.progress.goal.channel })
}

/** The row's problems, worded as Issues words them, each a link to where it is fixed. */
function Problems({ issues }: { issues: Issue[] }) {
  const m = useMessages()
  const [first, ...rest] = issues
  if (!first) return null
  return <UsedByPreview label={issueCopy(m, first).text} link={first.link} items={rest.map((i) => ({ label: issueCopy(m, i).text, link: i.link }))} />
}

export function HomePage() {
  const m = useMessages()
  const follow = useFollowLink()
  const ctx = useHomeContext()
  const weekStart = WEEK_START[getLocale()]
  const { world, site, nowMs, tonight } = ctx
  const { catalog } = world
  // Tonight and the nights left of this week and the next four.
  const horizon = useMemo(
    () => (site ? goalHorizon(catalog, site, nowMs, tonight, CALENDAR_WEEKS * 7 - dayInWeek(tonight, weekStart)) : null),
    [catalog, site, nowMs, tonight, weekStart],
  )
  const ingestions = useMemo(() => pendingIngestions(world), [world])
  const work = useMemo(() => pendingWork(world), [world])
  const open = useMemo(() => openWork(world, nowMs, tonight), [world, nowMs, tonight])
  const status = useMemo(() => homeStatus(world, nowMs), [world, nowMs])

  const sections: DetailSection[] = [
    {
      id: "home-ingestions",
      title: m.home_ingestions(),
      count: ingestions.length,
      flush: true,
      actions: allAction(m, follow, "home-ingestions", ingestions.length, { to: "/settings/locations" }),
      content: <IngestionsTable rows={ingestions} follow={follow} />,
    },
    {
      id: "home-pending",
      title: m.home_pending_work(),
      count: work.length,
      flush: true,
      actions: pendingAllActions(m, follow, work, catalog),
      content: <PendingTable rows={work} follow={follow} />,
    },
    {
      id: "home-open",
      title: m.home_open_work(),
      count: open.length,
      flush: true,
      actions: allAction(m, follow, "home-open", open.length, { to: "/projects" }),
      content: <OpenWorkTable rows={open} follow={follow} />,
    },
  ]
  const aside: DetailSection[] = [
    {
      id: "home-status",
      title: m.home_status(),
      flush: true,
      actions: [
        ...(status.locations.length > ROWS ? [{ id: "home-locations-all", label: m.home_all_locations({ count: formatCount(status.locations.length) }), run: () => follow({ to: "/settings/locations" }) }] : []),
        ...(status.jobs.length > ROWS ? [{ id: "home-jobs-all", label: m.home_all_jobs({ count: formatCount(status.jobs.length) }), run: () => follow({ to: "/activity" }) }] : []),
      ],
      content: (
        <>
          <LocationsTable rows={status.locations} follow={follow} />
          <JobsTable jobs={status.jobs} follow={follow} />
        </>
      ),
    },
    tonightSection(m, follow, ctx, horizon),
    {
      id: "home-calendar",
      title: m.home_calendar(),
      content: site && horizon ? <Calendar ctx={{ ...ctx, site }} nights={nightOutlooks(catalog, site, horizon)} /> : <NoSite />,
    },
  ]
  return <DetailPage title={m.nav_home()} sections={sections} aside={aside} />
}

function NoSite() {
  const m = useMessages()
  const follow = useFollowLink()
  return <EmptyState icon={MapPin} title={m.home_no_site_yet()} action={<ActionButton action={{ id: "add-site", label: m.tonight_add_site(), run: () => follow({ to: "/settings/sites" }) }} />} />
}

// Pending ingestions -----------------------------------------------------------

function ingestionText(m: Messages, row: IngestionRow): string {
  const { state } = row
  switch (state.kind) {
    case "importing": {
      const { total } = state.operation.progress
      return state.operation.status === "paused"
        ? m.home_import_paused({ percent: state.percent })
        : m.home_importing({ count: total, files: formatCount(total), percent: state.percent })
    }
    case "stopped":
      return state.operation.status === "failed" || state.operation.status === "partial" ? m.home_import_failed() : m.home_import_stopped()
    case "never-scanned":
      return m.home_never_scanned()
    case "incomplete":
      return m.home_scan_unfinished()
    case "new-files":
      return m.home_new_files({ count: state.count, files: formatCount(state.count) })
  }
}

function IngestionsTable({ rows, follow }: { rows: IngestionRow[]; follow: Follow }) {
  const m = useMessages()
  const capture = useStore((s) => Object.values(s.catalog.locations).some((l) => l.role === "captures" && !l.retiredAt))
  const columns: Column<IngestionRow>[] = [
    { id: "location", header: m.home_column_location(), rowHeader: true, truncate: true, sortValue: (r) => r.location.displayName, cell: (r) => r.location.displayName },
    {
      id: "state",
      header: m.home_column_state(),
      sortValue: (r) => ingestionText(m, r),
      cell: (r) =>
        r.state.kind === "stopped" ? <StatusBadge kind="operation" value={r.state.operation.status} label={ingestionText(m, r)} /> : ingestionText(m, r),
    },
  ]
  const primary = (r: IngestionRow): Action | null => {
    const open = () => follow(locationLink(r.location.id))
    // Import and Retry open Import with the location as its source (Q17); a scan cannot be undone, so Scan and Rescan open the location.
    const importFrom = () => follow({ to: "/import", search: { step: "source", location: r.location.id } })
    switch (r.state.kind) {
      case "new-files":
        return { id: "import", label: m.import_open(), opensDialog: true, run: importFrom }
      case "stopped":
        return { id: "retry", label: m.verb_retry(), run: importFrom }
      case "never-scanned":
        return { id: "scan", label: m.home_scan(), run: open }
      case "incomplete":
        return { id: "rescan", label: m.location_rescan(), run: open }
      case "importing":
        return null
    }
  }
  const empty = capture ? (
    m.home_everything_imported()
  ) : (
    <EmptyState icon={FolderPlus} title={m.home_add_captures_location()} action={<ActionButton action={{ id: "add-location", label: m.storage_add_location(), run: () => follow({ to: "/settings/locations", search: { add: "captures" } }) }} />} />
  )
  return (
    <BoxTable
      label={m.home_ingestions()}
      rows={rows.slice(0, ROWS)}
      columns={columns}
      getRowId={(r) => r.location.id}
      rowLabel={(r) => r.location.displayName}
      primaryRowAction={primary}
      rowActions={(r) => [{ id: "open", label: m.verb_open(), run: () => follow(locationLink(r.location.id)) }]}
      onRowClick={(r) => follow(locationLink(r.location.id))}
      empty={empty}
    />
  )
}

// Pending work -----------------------------------------------------------------

/**
 * "All N ›" per kind of pending work the first rows leave out, each to its
 * owning page filtered to those items: Sessions by facet, a run to its
 * Project, Clean up to its Project's Clean up.
 */
function pendingAllActions(m: Messages, follow: Follow, work: PendingWork[], catalog: Catalog): Action[] {
  const shown = new Set(work.slice(0, ROWS).map(workKey))
  const kinds: PendingWork["kind"][] = ["needs-target", "unreviewed", "not-in-project", "ready-to-add", "clean-up"]
  return kinds.flatMap((kind): Action[] => {
    const rows = work.filter((w) => w.kind === kind)
    const hidden = rows.filter((w) => !shown.has(workKey(w)))
    const first = hidden[0]
    if (!first) return []
    const group: Record<PendingWork["kind"], () => string> = {
      "needs-target": m.sessions_filter_needs_target,
      unreviewed: m.status_needs_review,
      "not-in-project": m.sessions_filter_not_in_project,
      "ready-to-add": m.home_group_ready,
      "clean-up": m.wrapup_cleanup_title,
    }
    const link: StepLink =
      first.kind === "needs-target"
        ? { to: "/sessions", search: { filter: "needs-target" } }
        : first.kind === "unreviewed"
          ? { to: "/sessions", search: { filter: "needs-review" } }
          : first.kind === "not-in-project"
            ? { to: "/sessions", search: { filter: "not-in-project" } }
            : first.kind === "ready-to-add"
              ? projectLink(first.projectId)
              : cleanUpLink({ catalog }, first.run, first.project)
    return [{ id: `home-pending-all-${kind}`, label: m.home_all_group({ group: group[kind](), count: formatCount(rows.length) }), run: () => follow(link) }]
  })
}

function workKey(w: PendingWork): string {
  return w.kind === "clean-up" ? `clean-up:${w.run.id}` : `${w.kind}:${w.session.id}${w.kind === "ready-to-add" ? `:${w.projectId}` : ""}`
}

function PendingTable({ rows, follow }: { rows: PendingWork[]; follow: Follow }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const firstRun = useStore((s) => liveLightSessions(s.catalog).length === 0)
  const name = (w: PendingWork) => (w.kind === "clean-up" ? w.run.name : sessionLongLabel(m, w.session))
  const needs = (w: PendingWork): string => {
    switch (w.kind) {
      case "needs-target":
        return m.sessions_filter_needs_target()
      case "unreviewed":
        return m.session_frames_unreviewed({ count: w.frames, frames: formatCount(w.frames) })
      case "not-in-project":
        return m.sessions_filter_not_in_project()
      case "ready-to-add": {
        const run = runToJoin(catalog, w.projectId, w.session.id)
        return m.home_ready_for({ name: run?.name ?? catalog.projects[w.projectId]?.name ?? "–" })
      }
      case "clean-up":
        return w.bytes > 0 ? m.home_clean_up_frees({ bytes: formatBytes(w.bytes) }) : m.home_clean_up_links({ count: w.entries, n: formatCount(w.entries) })
    }
  }
  const page = (w: PendingWork): StepLink => (w.kind === "clean-up" ? cleanUpLink({ catalog }, w.run, w.project) : { to: "/sessions/$sessionId", params: { sessionId: w.session.id } })
  const primary = (w: PendingWork): Action | null => {
    switch (w.kind) {
      case "needs-target":
        return { id: "choose-target", label: m.session_choose_target(), run: () => follow(sessionIntakeLink(w.session.id, "target")) }
      case "unreviewed":
        return { id: "review", label: m.session_review_frames(), run: () => follow(sessionIntakeEntry(catalog, w.session)) }
      case "not-in-project":
        return { id: "open-session", label: m.project_open_session(), run: () => follow(page(w)) }
      case "ready-to-add":
        return addToRunAction(m, catalog, w)
      case "clean-up":
        return { id: "clean-up", label: m.wrapup_cleanup_title(), run: () => follow(page(w)) }
    }
  }
  const columns: Column<PendingWork>[] = [
    { id: "item", header: m.home_column_item(), rowHeader: true, truncate: true, sortValue: name, cell: name },
    { id: "needs", header: m.home_column_needs(), sortValue: needs, cell: needs },
  ]
  return (
    <BoxTable
      label={m.home_pending_work()}
      rows={rows.slice(0, ROWS)}
      columns={columns}
      getRowId={workKey}
      rowLabel={name}
      primaryRowAction={primary}
      rowActions={(w) => [{ id: "open", label: w.kind === "clean-up" ? m.wrapup_cleanup_title() : m.project_open_session(), run: () => follow(page(w)) }]}
      onRowClick={(w) => follow(page(w))}
      empty={
        firstRun ? <EmptyState icon={Import} title={m.home_import_to_start()} action={<ActionButton action={{ id: "import", label: m.import_open(), opensDialog: true, run: () => follow({ to: "/import" }) }} />} /> : m.home_nothing_to_sort()
      }
    />
  )
}

/** Add to the open run's draft: one click, undone by taking the session out again. Without an open run, Start run… asks for the rest. */
function addToRunAction(m: Messages, catalog: Catalog, w: Extract<PendingWork, { kind: "ready-to-add" }>): Action {
  const run = runToJoin(catalog, w.projectId, w.session.id)
  if (!run) return { id: "start-run", label: m.startrun_open(), opensDialog: true, run: () => openSheet({ kind: "start-run", projectId: w.projectId }) }
  return {
    id: "add-to-run",
    label: m.target_add_to_named({ name: run.name }),
    run: () => {
      const reason = runCandidates(catalog, run).find((c) => c.session.id === w.session.id)?.reason ?? msg("home_candidate_of", { name: run.name })
      const result = addRunSessions(run.id, [w.session.id], { kind: "candidate", detail: reason })
      if (result.ok) withUndo(m, m.home_added_to_draft({ session: sessionLongLabel(m, w.session), run: run.name }), () => removeRunSessions(run.id, [w.session.id]))
      return result
    },
  }
}

// Open work --------------------------------------------------------------------

const PROCESS_STATUS: Record<ProcessStatus, (m: Messages) => string> = {
  "awaiting-stack": (m) => m.import_route_stack(),
  stacking: (m) => m.session_process_stacking(),
  importing: (m) => m.session_process_importing(),
  "trashing-raws": (m) => m.session_process_trashing(),
  failed: (m) => m.status_failed(),
  done: (m) => m.session_process_done(),
}

function OpenWorkTable({ rows, follow }: { rows: OpenWork[]; follow: Follow }) {
  const m = useMessages()
  const name = (r: OpenWork) => (r.kind === "project" ? r.project.name : say(m, r.view.name))
  const stands = (r: OpenWork): string => {
    if (r.kind === "calibration") return PROCESS_STATUS[r.view.status](m)
    return r.goals.total === 0 ? m.projects_no_goals() : m.home_goals_met({ met: r.goals.met, total: r.goals.total })
  }
  const page = (r: OpenWork): StepLink => (r.kind === "project" ? projectLink(r.project.id) : r.view.current ? calibrationStepLink(r.view.process.id, r.view.current) : { to: "/calibration" })
  const next = (r: OpenWork): Action | null => {
    if (r.kind === "calibration") return r.view.current ? { id: "next", label: say(m, CALIBRATION_STEP_NAME[r.view.current]), run: () => follow(page(r)) } : null
    const step = r.next
    return step ? { id: "next", label: say(m, step.label), run: () => follow(step.link) } : null
  }
  // Two columns and the ⋯ fit the 1280 px column and a 768 px window: the deadline leads the progress cell, the next step closes it, and a row click takes the next step.
  const columns: Column<OpenWork>[] = [
    { id: "name", header: m.home_column_name(), rowHeader: true, truncate: true, sortValue: name, cell: name },
    {
      id: "stands",
      header: m.home_column_progress(),
      truncate: true,
      sortValue: (r) => r.window?.nightsLeft ?? null,
      cell: (r) => {
        const step = next(r)
        return (
          <>
            {r.window ? (
              <>
                <Pill tone={r.priority > 0 ? "warning" : "muted"}>{say(m, r.window.line)}</Pill>{" "}
              </>
            ) : null}
            {stands(r)}
            {r.issues.length > 0 ? " · " : step ? ` · ${m.home_next_step({ step: step.label })}` : null}
            <Problems issues={r.issues} />
          </>
        )
      },
    },
  ]
  return (
    <BoxTable
      label={m.home_open_work()}
      rows={rows.slice(0, ROWS)}
      columns={columns}
      getRowId={(r) => (r.kind === "project" ? r.project.id : r.view.process.id)}
      rowLabel={name}
      rowActions={(r) => [...[next(r)].filter((a) => a !== null), { id: "open", label: r.kind === "project" ? m.target_open_project() : m.verb_open(), run: () => follow(page(r)) }]}
      onRowClick={(r) => {
        const step = next(r)
        if (step) void step.run()
        else follow(page(r))
      }}
      empty={<EmptyState icon={FolderPlus} title={m.home_no_projects_in_progress()} action={<ActionButton action={{ id: "new-project", label: m.newproject_open(), opensDialog: true, run: () => openSheet({ kind: "new-project" }) }} />} />}
    />
  )
}

// Status -----------------------------------------------------------------------

function LocationStatusBadge({ row }: { row: LocationStatus }) {
  if (row.issue?.kind === "location-denied") return <StatusBadge kind="access" value="denied" />
  if (row.availability === "offline") return <StatusBadge kind="availability" value="offline" />
  if (row.location.unreadablePaths.length > 0) return <StatusBadge kind="availability" value="unreadable" />
  return <StatusBadge kind="availability" value="online" />
}

function LocationsTable({ rows, follow }: { rows: LocationStatus[]; follow: Follow }) {
  const m = useMessages()
  const columns: Column<LocationStatus>[] = [
    { id: "location", header: m.home_column_location(), rowHeader: true, truncate: true, sortValue: (r) => r.location.displayName, cell: (r) => r.location.displayName },
    { id: "status", header: m.home_column_status(), sortValue: (r) => r.availability, cell: (r) => <LocationStatusBadge row={r} /> },
    {
      id: "free",
      header: m.run_check_space(),
      align: "right",
      sortValue: (r) => r.space?.freeBytes ?? null,
      cell: (r) =>
        r.space ? (
          <>
            {r.space.low ? (
              <>
                <Pill tone="warning">{m.home_low_space()}</Pill>{" "}
              </>
            ) : null}
            {formatBytes(r.space.freeBytes)}
          </>
        ) : (
          "–"
        ),
    },
  ]
  return (
    <BoxTable
      label={m.home_locations()}
      rows={rows.slice(0, ROWS)}
      columns={columns}
      getRowId={(r) => r.location.id}
      rowLabel={(r) => r.location.displayName}
      rowActions={(r) => [{ id: "open", label: m.verb_open(), run: () => follow(locationLink(r.location.id)) }]}
      onRowClick={(r) => follow(locationLink(r.location.id))}
      empty={m.storage_no_locations()}
    />
  )
}

/** Pause and Resume undo each other, so each is one click with an Undo toast. */
function jobAction(m: Messages, op: Operation): Action | null {
  const title = say(m, op.title)
  if (op.status === "running" && op.canPause) {
    return {
      id: "pause",
      label: m.home_pause(),
      icon: Pause,
      run: () => {
        pauseOperation(op.id)
        withUndo(m, m.home_paused({ name: title }), () => resumeOperation(op.id))
      },
    }
  }
  if (op.status === "paused" || op.status === "interrupted") {
    return {
      id: "resume",
      label: m.home_resume(),
      icon: Play,
      run: () => {
        resumeOperation(op.id)
        withUndo(m, m.home_resumed({ name: title }), () => pauseOperation(op.id))
      },
    }
  }
  return null
}

function JobsTable({ jobs, follow }: { jobs: Operation[]; follow: Follow }) {
  const m = useMessages()
  const world = useStore((s) => s)
  const title = (op: Operation) => say(m, op.title)
  const percent = (op: Operation) => (op.progress.total > 0 ? Math.min(100, Math.round((op.progress.done / op.progress.total) * 100)) : null)
  const columns: Column<Operation>[] = [
    { id: "job", header: m.home_column_job(), rowHeader: true, truncate: true, sortValue: title, cell: title },
    { id: "progress", header: m.home_column_progress(), align: "right", sortValue: percent, cell: (op) => (percent(op) === null ? "–" : m.home_percent({ percent: percent(op)! })) },
    { id: "status", header: m.home_column_status(), sortValue: (op) => op.status, cell: (op) => <StatusBadge kind="operation" value={op.status} /> },
  ]
  return (
    <BoxTable
      label={m.home_jobs()}
      rows={jobs.slice(0, ROWS)}
      columns={columns}
      getRowId={(op) => op.id}
      rowLabel={title}
      primaryRowAction={(op) => jobAction(m, op)}
      rowActions={(op) => [{ id: "open", label: m.verb_open(), run: () => follow(operationLink(world, op)) }]}
      onRowClick={(op) => follow(operationLink(world, op))}
      empty={m.home_nothing_running()}
    />
  )
}

// Tonight ----------------------------------------------------------------------

function tonightSection(m: Messages, follow: Follow, ctx: HomeContext, horizon: ReturnType<typeof goalHorizon> | null): DetailSection {
  const { site, tonight } = ctx
  if (!site || !horizon) return { id: "home-tonight", title: m.home_tonight(), content: <NoSite /> }
  const graded = goalsTonight(horizon)
  return {
    id: "home-tonight",
    title: m.home_tonight_at({ site: site.name }),
    count: graded.goals.length,
    flush: true,
    actions: allAction(m, follow, "home-tonight", graded.goals.length, targetsLink(tonight, tonight)),
    content: <TonightTable ctx={ctx} goals={graded.goals} nextGood={graded.nextGood} anyGoal={horizon.goals.length > 0} />,
  }
}

function TonightTable({ ctx, goals, nextGood, anyGoal }: { ctx: HomeContext; goals: GoalOutlook[]; nextGood: NightDate | null; anyGoal: boolean }) {
  const m = useMessages()
  const follow = useFollowLink()
  const { world, tonight } = ctx
  const { catalog } = world
  const planned = new Set(nightPlan(catalog, tonight).map((t) => t.id))
  const name = (g: GoalOutlook) => goalName(m, catalog, g)
  const targetLink = (targetId: TargetId): StepLink => ({ to: "/targets/$targetId", params: { targetId } })
  const columns: Column<GoalOutlook>[] = [
    { id: "goal", header: m.home_column_goal(), rowHeader: true, truncate: true, sortValue: name, cell: (g) => goalSubject(m, catalog, g.subject.project, g.progress.goal.subjectId, g.progress.goal.panelId) },
    {
      id: "grade",
      header: m.home_column_grade(),
      sortValue: (g) => g.grades?.[0] ?? null,
      cell: (g) => <GradeBadges grades={g.grades ? [{ band: g.progress.goal.channel, grade: g.grades[0]! }] : null} />,
    },
    { id: "time", header: m.tonight_img_time(), align: "right", sortValue: (g) => g.subject.minutes[0] ?? 0, cell: (g) => formatHours((g.subject.minutes[0] ?? 0) * 60) },
  ]
  const addToPlanAction = (g: GoalOutlook): Action | null => {
    const target = g.subject.target
    if (planned.has(target.id)) return null
    return {
      id: "add-to-plan",
      label: m.targets_add_to_plan(),
      run: () => {
        const result = addToPlan(target.id, tonight)
        if (result.ok) withUndo(m, m.home_added_to_plan({ name: target.name }), () => removeFromPlan(target.id, tonight))
        return result
      },
    }
  }
  return (
    <BoxTable
      label={m.home_tonight()}
      rows={goals.slice(0, ROWS)}
      columns={columns}
      getRowId={(g) => g.progress.goal.id}
      rowLabel={name}
      primaryRowAction={addToPlanAction}
      rowActions={(g) => [
        { id: "target", label: m.project_open_target(), run: () => follow(targetLink(g.subject.target.id)) },
        { id: "project", label: m.target_open_project(), run: () => follow(projectLink(g.subject.project.id)) },
      ]}
      onRowClick={(g) => follow(targetLink(g.subject.target.id))}
      empty={anyGoal ? (nextGood ? m.home_no_goals_suit_next({ date: formatNight(nextGood) }) : m.home_no_goals_suit()) : <NoGoals />}
    />
  )
}

/** "No unfinished goals." with Add a Goal (the owner's label): the open Projects, then that Project's add-goal dialog; without one, New Project…. */
function NoGoals() {
  const m = useMessages()
  const follow = useFollowLink()
  const projects = useStore((s) => Object.values(s.catalog.projects).filter((p) => p.state === "open"))
  const items: MenuItem[] = [...projects]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((p) => ({ id: `add-goal-${p.id}`, label: p.name, opensDialog: true, run: () => follow(projectLink(p.id, { add: "goal" })) }))
  const action = items.length > 0 ? <ActionMenu label={m.home_add_a_goal()} items={items} /> : <ActionButton action={{ id: "new-project", label: m.newproject_open(), opensDialog: true, run: () => openSheet({ kind: "new-project" }) }} />
  return <EmptyState icon={FolderPlus} title={m.home_no_unfinished_goals()} action={action} />
}

// Calendar ---------------------------------------------------------------------

function moonText(m: Messages, n: NightOutlook, timeZone: string): string {
  const moon = n.summary.moon
  return [
    m.calendar_moon({ illumination: moon.illuminationPct, phase: say(m, moon.phase) }),
    moon.rise ? m.tonight_moon_rises({ time: siteTime(moon.rise, timeZone) }) : m.tonight_moon_no_rise(),
    moon.set ? m.tonight_moon_sets({ time: siteTime(moon.set, timeZone) }) : m.tonight_moon_no_set(),
  ].join(" · ")
}

function Calendar({ ctx, nights }: { ctx: HomeContext & { site: ObservingSite }; nights: NightOutlook[] }) {
  const m = useMessages()
  const { world, site, tonight } = ctx
  const names = (goals: GoalOutlook[]) => (goals.length === 0 ? "–" : goals.map((g) => goalName(m, world.catalog, g)).join(", "))
  const calendar: CalendarNight[] = nights.map((n) => ({
    night: n.night,
    moon: n.summary.moon,
    waxing: n.waxing,
    darkS: n.darkS,
    goals: n.suited.length,
    planned: n.planned.length,
    link: targetsLink(n.night, tonight),
    card: (
      <KeyValueList
        items={[
          { label: m.plan_dark(), value: n.summary.darkness ? siteTimeRange(n.summary.darkness.start, n.summary.darkness.end, site.timeZone) : m.calendar_never_dark() },
          { label: m.tonight_moon(), value: moonText(m, n, site.timeZone) },
          { label: m.calendar_legend_goals(), value: names(n.suited) },
          { label: m.home_moon_rules_out(), value: names(n.moonLimited) },
          { label: m.calendar_legend_planned(), value: n.planned.length === 0 ? "–" : n.planned.map((t) => t.name).join(", ") },
        ]}
      />
    ),
  }))
  return <NightCalendar label={m.home_calendar_label({ site: site.name })} today={tonight} nights={calendar} />
}
