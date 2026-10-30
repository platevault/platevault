/**
 * S1 Home (PRJ-FR-17, PRJ-FR-22, root FR-020; D-W89): one dashboard of what
 * needs the user, what runs and when to capture next. A DetailPage with no
 * header buttons and no summary line. From 1280 px the sections stand in two
 * columns, Pending ingestions, Pending work and Open work on the left and
 * Status, Tonight and the calendar on the right; narrower, one column in
 * that order. Each section shows at most 5 rows, then "All N ›" to the
 * owning page.
 *
 * Pending work, Open work (with each Project's Next action, PRJ-FR-18),
 * Status's background jobs and Tonight are `home_dashboard`'s, computed by
 * the library: Home never recomputes them. The library computes Tonight
 * and the calendar (`planning_calendar`, PLAN-FR-12) under Home's stored
 * criteria (criteria.ts); until the user sets them, both read
 * `no_criteria`, and only Tonight offers to set them (home-planning.tsx).
 * Pending ingestions and Status's locations read the library directly.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { FolderPlus, Import } from "lucide-react"
import { type ReactNode, useState } from "react"
import {
  type ExpectedSession,
  type HomeDashboard_Serialize,
  type HomeProject,
  type HomeSession,
  type LocationState,
  library,
  type ReadyToAdd,
  type RunningWork,
  type SessionAction,
  type SessionSummary,
  type UnreviewedSession,
} from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { BoxTable } from "@/components/app/box"
import type { Action, Column, MenuItem, StepLink } from "@/components/app/contracts"
import { ActionError, EmptyState, UnknownValue } from "@/components/app/feedback"
import { useFollowLink } from "@/components/app/links"
import { StatusBadge } from "@/components/app/status"
import { DetailPage, type DetailSection } from "@/components/templates/detail-page"
import { projectNextStep } from "@/components/domain/project-next-step"
import { formatCount } from "@/lib/format"
import { AddToProjectDialog } from "./add-to-project"
import { homeCriteriaQuery } from "@/components/domain/plan-criteria"
import { PlanCriteriaDialog } from "@/components/domain/plan-criteria-dialog"
import { IngestionsTable, ROWS, useIngestions } from "./ingestions"
import { HomeCalendar, TonightGoals } from "./home-planning"
import { readError, Unavailable } from "./parts"
import { dashboardQuery, homeWrite, locationsQuery, sessionsQuery } from "./queries"
import { sessionLabel, useSessionSummaries } from "@/components/domain/session-label"
import type { Messages } from "@/lib/i18n"

type Follow = (link: StepLink) => void

const sessionLink = (sessionId: string, step?: string): StepLink => ({ to: "/sessions/$sessionId", params: { sessionId }, ...(step ? { search: { step } } : {}) })
const projectLink = (projectId: string): StepLink => ({ to: "/projects/$projectId", params: { projectId } })

/** "All 12 ›": the owning page, from a section that shows only its first rows. */
function allAction(m: Messages, follow: Follow, id: string, count: number, link: StepLink): Action[] {
  return count > ROWS ? [{ id: `${id}-all`, label: m.home_all({ count: formatCount(count) }), run: () => follow(link) }] : []
}

export function HomePage() {
  const m = useMessages()
  const follow = useFollowLink()
  const client = useQueryClient()
  const criteria = useQuery(homeCriteriaQuery())
  const [editing, setEditing] = useState(false)
  const dashboard = useQuery(dashboardQuery())
  const data = dashboard.data ?? null
  const ingestions = useIngestions(data)
  const locations = useQuery(locationsQuery())
  const editCriteria = criteria.data ? () => setEditing(true) : undefined

  const dashboardBody = (body: (data: HomeDashboard_Serialize) => ReactNode) =>
    dashboard.error ? <ActionError message={readError(m, dashboard.error)} onRetry={() => void dashboard.refetch()} /> : data ? body(data) : null
  const work = data ? pendingWork(data) : []
  const sections: DetailSection[] = [
    {
      id: "home-ingestions",
      title: m.home_ingestions(),
      count: ingestions.rows.length,
      flush: true,
      actions: allAction(m, follow, "home-ingestions", ingestions.rows.length, { to: "/settings/locations" }),
      content: <IngestionsTable ingestions={ingestions} dashboardReady={data !== null} />,
    },
    {
      id: "home-pending",
      title: m.home_pending_work(),
      count: data ? work.length + data.topLine.needsCalibration : undefined,
      flush: data !== null,
      content: dashboardBody((d) => <PendingTable dashboard={d} rows={work} follow={follow} />),
    },
    {
      id: "home-open",
      title: m.home_open_work(),
      count: data?.projects.length,
      flush: data !== null,
      actions: data ? allAction(m, follow, "home-open", data.projects.length, { to: "/projects" }) : [],
      content: dashboardBody((d) => <OpenWorkTable projects={d.projects} follow={follow} />),
    },
  ]
  const aside: DetailSection[] = [
    {
      id: "home-status",
      title: m.home_status(),
      flush: true,
      content: (
        <>
          <LocationsTable locations={locations.data ?? []} loading={locations.isPending} error={locations.error ? { message: readError(m, locations.error), onRetry: () => void locations.refetch() } : undefined} follow={follow} />
          {data ? <JobsTable work={data.runningWork} follow={follow} /> : null}
        </>
      ),
    },
    {
      id: "home-tonight",
      title: data?.tonight.site ? m.home_tonight_at({ site: data.tonight.site.name }) : m.home_tonight(),
      count: data && !data.tonight.unavailableReason ? data.tonight.goals.length : undefined,
      flush: data !== null,
      actions: [
        ...(editCriteria && data?.tonight.criteria ? [{ id: "home-edit-criteria", label: m.home_edit_criteria(), run: editCriteria }] : []),
        ...(data ? allAction(m, follow, "home-tonight", data.tonight.goals.length, { to: "/targets" }) : []),
      ],
      content: dashboardBody((d) => <TonightGoals tonight={d.tonight} follow={follow} onSetCriteria={editCriteria} />),
    },
    {
      id: "home-calendar",
      title: m.home_calendar(),
      content: dashboardBody((d) => <HomeCalendar tonight={d.tonight.night} reason={d.tonight.unavailableReason} />),
    },
  ]
  return (
    <>
      <DetailPage title={m.nav_home()} sections={sections} aside={aside} />
      {criteria.data ? (
        <PlanCriteriaDialog
          record={criteria.data}
          open={editing}
          onOpenChange={setEditing}
          save={(next, expectedRevision) => homeWrite(client, () => library.planningSaveHomeCriteria(next, expectedRevision))}
        />
      ) : null}
    </>
  )
}

// Pending work -----------------------------------------------------------------

type PendingKind = "needs-target" | "unreviewed" | "needs-calibration" | "not-in-project" | "ready-to-add"

/** The kinds of pending work, in the order Home lists them. */
const PENDING_KINDS: PendingKind[] = ["needs-target", "unreviewed", "needs-calibration", "not-in-project", "ready-to-add"]

type WorkRow =
  | { kind: "needs-target" | "not-in-project"; sessionId: string; summary: SessionSummary; actions: SessionAction[] }
  | { kind: "unreviewed"; sessionId: string; item: UnreviewedSession; actions: SessionAction[] }
  | { kind: "ready-to-add"; sessionId: string; item: ReadyToAdd; actions: SessionAction[] }
  | { kind: "needs-calibration"; sessionId: string; summary: SessionSummary; actions: SessionAction[] }

/** The dashboard's new sessions, in Home's order. Needs calibration rows come from the Library's own list. */
function pendingWork(d: HomeDashboard_Serialize): WorkRow[] {
  const session = (kind: "needs-target" | "not-in-project") => (h: HomeSession): WorkRow => ({ kind, sessionId: h.session.session.id, summary: h.session, actions: h.actions })
  return [
    ...d.newSessions.needsTarget.map(session("needs-target")),
    ...d.newSessions.unreviewed.map((item): WorkRow => ({ kind: "unreviewed", sessionId: item.sessionId, item, actions: item.actions })),
    ...d.newSessions.notInProject.map(session("not-in-project")),
    ...d.newSessions.readyToAdd.map((item): WorkRow => ({ kind: "ready-to-add", sessionId: item.suggestion.sessionId, item, actions: item.actions })),
  ]
}

function pendingGroup(m: Messages, kind: PendingKind): string {
  const group: Record<PendingKind, () => string> = {
    "needs-target": m.sessions_filter_needs_target,
    unreviewed: m.status_needs_review,
    "needs-calibration": m.sessions_filter_needs_calibration,
    "not-in-project": m.sessions_filter_not_in_project,
    "ready-to-add": m.home_group_ready,
  }
  return group[kind]()
}

const workKey = (w: WorkRow) => `${w.kind}:${w.sessionId}${w.kind === "ready-to-add" || w.kind === "unreviewed" ? `:${w.item.projectId}` : ""}`
const expectedOf = (summary: SessionSummary): ExpectedSession => ({ sessionId: summary.session.id, groupingRevision: summary.session.groupingRevision, decisionRevision: summary.session.decisionRevision })

function PendingTable({ dashboard, rows: dashboardRows, follow }: { dashboard: HomeDashboard_Serialize; rows: WorkRow[]; follow: Follow }) {
  const m = useMessages()
  const client = useQueryClient()
  const [adding, setAdding] = useState<{ session: ExpectedSession; name: string } | null>(null)
  const calibration = useQuery({ ...sessionsQuery("needs_calibration"), enabled: dashboard.topLine.needsCalibration > 0 })
  const calibrationRows = (calibration.data ?? []).map((summary): WorkRow => ({ kind: "needs-calibration", sessionId: summary.session.id, summary, actions: [] }))
  const all = [...dashboardRows, ...calibrationRows].sort((a, b) => PENDING_KINDS.indexOf(a.kind) - PENDING_KINDS.indexOf(b.kind))
  const shown = all.slice(0, ROWS)
  // Unreviewed and ready rows name only their session: read each shown one for its label.
  const summaries = new Map(useSessionSummaries(shown.filter((w) => w.kind === "unreviewed" || w.kind === "ready-to-add").map((w) => w.sessionId)))
  for (const w of shown) if ("summary" in w) summaries.set(w.sessionId, w.summary)
  const projectName = (id: string) => dashboard.projects.find((p) => p.project.id === id)?.project.name ?? "–"
  const name = (w: WorkRow) => {
    const summary = summaries.get(w.sessionId)
    return summary ? sessionLabel(m, summary.session) : "–"
  }
  const counts: Record<PendingKind, number> = {
    "needs-target": dashboard.topLine.needsTarget,
    unreviewed: dashboard.newSessions.unreviewed.length,
    "needs-calibration": dashboard.topLine.needsCalibration,
    "not-in-project": dashboard.topLine.notInAnyProject,
    "ready-to-add": dashboard.newSessions.readyToAdd.length,
  }
  const needsText = (w: WorkRow): string => {
    switch (w.kind) {
      case "unreviewed":
        return m.session_frames_unreviewed({ count: w.item.frames, frames: formatCount(w.item.frames) })
      case "ready-to-add":
        return m.home_ready_for({ name: projectName(w.item.projectId) })
      default:
        return pendingGroup(m, w.kind)
    }
  }
  const actionFor = (w: WorkRow, a: SessionAction): Action | null => {
    switch (a.kind) {
      case "choose_target":
        return { id: "choose-target", label: m.session_choose_target(), run: () => follow(sessionLink(w.sessionId, "target")) }
      case "review_frames":
        return { id: "review", label: m.session_review_frames(), run: () => follow(sessionLink(w.sessionId, "review")) }
      case "open_suggestions":
        return { id: "open-suggestions", label: m.target_open_project(), run: () => follow(projectLink(a.projectId)) }
      case "create_project": {
        const summary = summaries.get(w.sessionId)
        if (!summary) return null
        return {
          id: "create-project",
          label: m.newproject_create(),
          run: async () => {
            const input = await library.projectPrefillFromSession(w.sessionId)
            if (!input.ok) return input
            const created = await homeWrite(client, () => library.projectCreateFromSession(expectedOf(summary), input.data))
            if (created.ok) follow(projectLink(created.data.id))
            return created
          },
        }
      }
      case "add_to_project": {
        const summary = summaries.get(w.sessionId)
        if (!summary) return null
        return { id: "add-to-project", label: m.session_add_to_project(), opensDialog: true, run: () => setAdding({ session: expectedOf(summary), name: sessionLabel(m, summary.session) }) }
      }
    }
  }
  const actions = (w: WorkRow): Action[] => {
    if (w.kind === "needs-calibration") return [{ id: "choose-calibration", label: m.home_choose_calibration(), run: () => follow(sessionLink(w.sessionId)) }]
    return w.actions.flatMap((a) => actionFor(w, a) ?? [])
  }
  const columns: Column<WorkRow>[] = [
    { id: "item", header: m.session_label(), rowHeader: true, truncate: true, sortValue: name, cell: name },
    { id: "needs", header: m.home_column_needs(), sortValue: needsText, cell: needsText },
  ]
  const firstRun = dashboard.topLine.needsTarget + dashboard.topLine.notInAnyProject === 0 && all.length === 0
  return (
    <>
      <BoxTable
        label={m.home_pending_work()}
        rows={shown}
        columns={columns}
        getRowId={workKey}
        rowLabel={name}
        groups={shown.length > 0 ? { key: (w) => w.kind, label: (kind) => m.home_pending_group({ group: pendingGroup(m, kind as PendingKind), count: formatCount(counts[kind as PendingKind]) }), compare: (a, b) => PENDING_KINDS.indexOf(a as PendingKind) - PENDING_KINDS.indexOf(b as PendingKind) } : undefined}
        primaryRowAction={(w) => actions(w)[0] ?? null}
        rowActions={(w): MenuItem[] => [...actions(w).slice(1), { id: "open", label: m.project_open_session(), run: () => follow(sessionLink(w.sessionId)) }]}
        onRowClick={(w) => follow(sessionLink(w.sessionId))}
        empty={firstRun ? <EmptyState icon={Import} title={m.home_import_to_start()} action={<ActionButton action={{ id: "import", label: m.import_open(), opensDialog: true, run: () => follow({ to: "/import" }) }} />} /> : m.home_nothing_to_sort()}
      />
      {adding ? <AddToProjectDialog session={adding.session} sessionName={adding.name} open onOpenChange={(open) => !open && setAdding(null)} /> : null}
    </>
  )
}

// Open work --------------------------------------------------------------------

function OpenWorkTable({ projects, follow }: { projects: HomeProject[]; follow: Follow }) {
  const m = useMessages()
  const stands = (p: HomeProject) => (p.goals.length === 0 ? m.projects_no_goals() : m.home_goals_met({ met: p.goals.filter((g) => g.met).length, total: p.goals.length }))
  const columns: Column<HomeProject>[] = [
    { id: "name", header: m.home_column_name(), rowHeader: true, truncate: true, sortValue: (p) => p.project.name, cell: (p) => p.project.name },
    { id: "stands", header: m.home_column_progress(), truncate: true, sortValue: stands, cell: (p) => `${stands(p)} · ${m.home_next_step({ step: projectNextStep(m, p.project.id, p.next).label })}` }
  ]
  return (
    <>
      <BoxTable
        label={m.home_open_work()}
        rows={projects.slice(0, ROWS)}
        columns={columns}
        getRowId={(p) => p.project.id}
        rowLabel={(p) => p.project.name}
        rowActions={(p) => {
          const next = projectNextStep(m, p.project.id, p.next)
          return [
            { id: "next", label: next.label, run: () => follow(next.link) },
            { id: "open", label: m.target_open_project(), run: () => follow(projectLink(p.project.id)) },
          ]
        }}
        onRowClick={(p) => follow(projectNextStep(m, p.project.id, p.next).link)}
        empty={<EmptyState icon={FolderPlus} title={m.home_no_projects_in_progress()} action={<ActionButton action={{ id: "new-project", label: m.newproject_open_ellipsis(), opensDialog: true, run: () => follow({ to: "/projects", search: { new: "open" } }) }} />} />}
      />
      {/* astro-plan-wre19.10: goal deadlines and season windows ("N nights left", PRJ-FR-23); 1dhpb: calibration processes. */}
      <Unavailable what={m.home_deadlines_processes()} />
    </>
  )
}

// Status -----------------------------------------------------------------------

function LocationsTable({ locations, loading, error, follow }: { locations: LocationState[]; loading: boolean; error?: { message: string; onRetry: () => void }; follow: Follow }) {
  const m = useMessages()
  const active = locations.filter((s) => s.location.lifecycle === "active")
  const link = (id: string): StepLink => ({ to: "/settings/locations", search: { locationId: id } })
  const columns: Column<LocationState>[] = [
    { id: "location", header: m.home_column_location(), rowHeader: true, truncate: true, sortValue: (r) => r.location.name, cell: (r) => r.location.name },
    {
      id: "status",
      header: m.home_column_status(),
      sortValue: (r) => r.location.availability,
      cell: (r) => {
        const a = r.location.availability
        return <StatusBadge kind="availability" value={a === "available" ? "online" : a === "unreadable" || a === "identity_conflict" ? "unreadable" : a === "missing" ? "absent" : "offline"} />
      },
    },
    // astro-plan-wre19.10: Location carries no free space or low-space flag yet.
    { id: "free", header: m.run_check_space(), align: "right", static: true, cell: () => <UnknownValue reason={m.home_unavailable({ what: m.run_check_space() })} /> },
  ]
  return (
    <BoxTable
      label={m.home_locations()}
      rows={active.slice(0, ROWS)}
      columns={columns}
      getRowId={(r) => r.location.id}
      rowLabel={(r) => r.location.name}
      rowActions={(r) => [{ id: "open", label: m.verb_open(), run: () => follow(link(r.location.id)) }]}
      onRowClick={(r) => follow(link(r.location.id))}
      loading={loading}
      error={error}
      empty={m.storage_no_locations()}
    />
  )
}

function workTitle(m: Messages, w: RunningWork): string {
  switch (w.kind) {
    case "scan":
      return m.home_job_scan()
    case "measurement":
      return m.home_job_measurement()
    case "import":
      return m.import_open()
    case "project":
      return m.home_job_project({ name: w.projectName })
    case "storage":
      return w.action === "trash" ? m.common_move_to_trash() : w.action === "move" ? m.import_move() : m.import_copy()
  }
}

function workLink(w: RunningWork): StepLink {
  switch (w.kind) {
    case "project":
      return projectLink(w.operation.projectId)
    case "import":
      return { to: "/import", search: { step: "run", import: w.importId } }
    default:
      return { to: "/activity" }
  }
}

/** Background jobs other than imports, which show in Pending ingestions (PRJ-FR-17 section 4). */
function JobsTable({ work, follow }: { work: RunningWork[]; follow: Follow }) {
  const m = useMessages()
  const jobs = work.filter((w) => w.kind !== "import")
  const id = (w: RunningWork) => (w.kind === "project" ? w.operation.id : w.kind === "import" ? w.importId : w.operationId)
  const columns: Column<RunningWork>[] = [
    { id: "job", header: m.home_column_job(), rowHeader: true, truncate: true, sortValue: (w) => workTitle(m, w), cell: (w) => workTitle(m, w) },
    { id: "status", header: m.home_column_status(), static: true, cell: () => <StatusBadge kind="operation" value="running" /> },
  ]
  return (
    <BoxTable
      label={m.home_jobs()}
      rows={jobs.slice(0, ROWS)}
      columns={columns}
      getRowId={id}
      rowLabel={(w) => workTitle(m, w)}
      rowActions={(w) => [{ id: "open", label: m.verb_open(), run: () => follow(workLink(w)) }]}
      onRowClick={(w) => follow(workLink(w))}
      empty={m.home_nothing_running()}
    />
  )
}
