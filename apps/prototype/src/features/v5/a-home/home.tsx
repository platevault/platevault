/**
 * S1 Home (slice A), the start page: the control-panel dashboard (D-W39).
 *
 * Top line: every issue as a clickable pill (`useIssues` / `IssuePill`), the
 * same list the toolbar's Issues hub and the status bar read, in the bar's
 * order (`inBarOrder`). Then boxes with one-word headings:
 * - Projects: goals per channel (in project / captured), stage and the one
 *   Next action (D-W35 rule order; a blocked run reads "Blocked at <step>"
 *   with its reason in the note and opens that step); Done Projects behind
 *   Show done (D-W48).
 * - Sessions: sessions that need work, each with one action. An Unreviewed
 *   session is reviewed in place: `?review=<sessionId>` opens `SessionReview`
 *   in a sheet over Home (library marks only).
 * - Tonight: darkness, the Moon and the best windows for subjects and
 *   favourites, or the no-site state.
 * - Goals: unmet goals of open Projects per subject and channel.
 * - Work: running operations.
 */
import { Link, useLocation, useNavigate, useSearch } from "@tanstack/react-router"
import { CalendarClock, CircleCheck, Download, Eye, FolderPlus, ListChecks, Pause, Play, Target, X } from "lucide-react"
import { type ReactNode, useId, useState } from "react"
import { IssuePill } from "@/app/issues-hub"
import { useMessages } from "@/app/preferences"
import { GateLabel, StepGlyph, stepName, useFollowLink } from "@/app/run-ui"
import { openSheet } from "@/app/ui-state"
import { Box } from "@/components/app/box"
import { type Column, DataTable } from "@/components/app/data-table"
import { announce, EmptyState, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { CountBadge, Pill } from "@/components/app/pill"
import { Refusal, type RefusalProps } from "@/components/app/refusal"
import { ContextMenuArea, type MenuEntry, menuKey } from "@/components/app/row-menu"
import { StatusBadge } from "@/components/app/status"
import { NoteMarker } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Progress } from "@/components/ui/progress"
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import {
  findPanel,
  formatHours,
  goalProgress,
  planningSite,
  projectNext,
  projectRuns,
  projectStage,
  projectStatus,
  runCandidates,
  runHref,
  runningWork,
  runPipeline,
  runStepLink,
  sessionsNeedingWork,
  sessionTargetId,
  subjectCentre,
  subjectName,
  targetStatus,
  type GoalProgress,
} from "@/domain/derive"
import { inBarOrder } from "@/domain/issues"
import { OPERATION_UNIT_NAME } from "@/domain/labels"
import { sessionLabel, sessionLongLabel } from "@/domain/membership"
import { bestWindowTonight, defaultCriteria, tonightAt, zoneAbbreviation } from "@/domain/planning"
import type { Operation, Project, Session, SessionId } from "@/domain/types"
import { formatCount, formatTime } from "@/lib/format"
import { type Messages, msg, say } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { SearchParams } from "@/routes"
import { addRunSessions } from "@/store/actions/runs"
import { confirmTarget } from "@/store/actions/library"
import { useIssues } from "@/store/issues"
import { nowIso, type PrototypeState, updateSlice, useStore } from "@/store/core"
import { cancelOperation, pauseOperation, resumeOperation } from "@/store/operations"
import { SessionReview } from "../d-review/review"
import { AddToProjectDialog, AddToProjectMenu, type AddedNotice, addToProjectEntries, type PendingAdd, refusalOf } from "./parts"
import { runToJoin } from "./session-model"

const ROWS_PER_GROUP = 4

/** The search keys the in-place review owns: the session, plus the review's own filter and position. */
const REVIEW_KEYS = ["review", "filter", "panel", "assetId"] as const

function useInPlaceReview() {
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const open = (sessionId: SessionId) => void navigate({ to: pathname as never, search: { review: sessionId, filter: "unreviewed" } as never })
  const close = () =>
    void navigate({
      to: pathname as never,
      search: ((prev: SearchParams) => {
        const next = { ...prev }
        for (const key of REVIEW_KEYS) delete next[key]
        return next
      }) as never,
      replace: true,
    })
  return { sessionId: search.review ?? null, open, close }
}

export function HomePage() {
  const state = useStore((s) => s)
  const review = useInPlaceReview()
  const m = useMessages()
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={m.nav_home()}
        actions={
          <>
            <Button size="sm" variant="outline" render={<Link to="/plan" />}>
              <CalendarClock data-icon="inline-start" aria-hidden="true" />
              {m.target_plan_tonight()}
            </Button>
            <Button size="sm" variant="outline" onClick={() => openSheet({ kind: "new-project" })}>
              <FolderPlus data-icon="inline-start" aria-hidden="true" />
              {m.newproject_open()}
            </Button>
            <Button size="sm" onClick={() => openSheet({ kind: "import" })}>
              <Download data-icon="inline-start" aria-hidden="true" />
              {m.import_open()}
            </Button>
          </>
        }
      />
      <PageBody className="space-y-4">
        <IssueStrip />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <ProjectsBox state={state} className="xl:col-start-1 xl:row-start-1" />
          <SessionsBox state={state} onReview={review.open} className="xl:col-start-1 xl:row-start-2" />
          <TonightBox state={state} className="xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:self-start" />
          <GoalsBox state={state} className="xl:col-start-1 xl:row-start-3" />
          <WorkBox state={state} className="xl:col-start-2 xl:row-start-3 xl:self-start" />
        </div>
      </PageBody>
      <ReviewSheet sessionId={review.sessionId} onClose={review.close} />
    </div>
  )
}

// Issues ----------------------------------------------------------------------

function IssueStrip() {
  const issues = inBarOrder(useIssues().issues)
  const m = useMessages()
  return (
    <section aria-label={m.issues_title()} data-home-top-line data-home-issues>
      {issues.length === 0 ? (
        <Pill tone="success" icon={CircleCheck}>
          {m.issues_none()}
        </Pill>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {issues.map((issue) => (
            <li key={issue.id}>
              <IssuePill issue={issue} />
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

// Review in place -------------------------------------------------------------

function ReviewSheet({ sessionId, onClose }: { sessionId: string | null; onClose: () => void }) {
  const session = useStore((s) => (sessionId ? s.catalog.sessions[sessionId] : undefined))
  const m = useMessages()
  return (
    <Sheet open={session !== undefined} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-[96vw] data-[side=right]:max-w-[96vw] data-[side=right]:sm:max-w-[96vw]" data-home-review>
        {session ? (
          <>
            <SheetHeader className="flex-row items-center gap-2 border-b border-separator py-2 pr-12" data-chrome>
              <SheetTitle className="truncate">{sessionLongLabel(m, session)}</SheetTitle>
              <Button size="xs" variant="ghost" render={<Link to="/sessions/$sessionId" params={{ sessionId: session.id }} search={{ view: "review" }} />}>
                {m.project_open_session()}
              </Button>
            </SheetHeader>
            <div className="flex min-h-0 flex-1 flex-col">
              <SessionReview sessionId={session.id} />
            </div>
          </>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

// Projects --------------------------------------------------------------------

interface ChannelGoal {
  channel: string
  inProject: number
  captured: number
  goal: number | null
  unit: "seconds" | "frames"
  met: boolean
}

/** Goals summed per channel across subjects and panels: in project / captured / goal. */
function channelGoals(progress: GoalProgress[]): ChannelGoal[] {
  const out = new Map<string, ChannelGoal>()
  for (const p of progress) {
    const unit = p.goal.integrationS !== null ? "seconds" : "frames"
    const entry = out.get(p.goal.channel) ?? { channel: p.goal.channel, inProject: 0, captured: 0, goal: null, unit, met: true }
    entry.inProject += unit === "seconds" ? p.inProject.seconds : p.inProject.frames
    entry.captured += unit === "seconds" ? p.captured.seconds : p.captured.frames
    const target = unit === "seconds" ? p.goal.integrationS : p.goal.frameCount
    if (target !== null) entry.goal = (entry.goal ?? 0) + target
    entry.met = entry.met && p.met
    out.set(p.goal.channel, entry)
  }
  return [...out.values()]
}

function amount(value: number, unit: ChannelGoal["unit"]): string {
  return unit === "seconds" ? formatHours(value) : formatCount(value)
}

function goalLine(m: Messages, g: ChannelGoal): string {
  const inProject = amount(g.inProject, g.unit)
  const captured = amount(g.captured, g.unit)
  return g.goal !== null ? m.home_goal_line_goal({ inProject, captured, goal: amount(g.goal, g.unit) }) : m.home_goal_line({ inProject, captured })
}

function GoalLines({ goals }: { goals: ChannelGoal[] }) {
  const m = useMessages()
  if (goals.length === 0) return <span className="text-xs text-muted-foreground">{m.projects_no_goals()}</span>
  return (
    <ul className="space-y-1 py-1">
      {goals.map((g) => {
        const scale = Math.max(g.goal ?? 0, g.captured, 1)
        const line = goalLine(m, g)
        return (
          <li key={g.channel} className="grid grid-cols-[2.5rem_3rem_auto] items-center gap-2 text-xs whitespace-nowrap tabular-nums" title={`${g.channel}: ${line}`}>
            <span className="font-medium">{g.channel}</span>
            <span className="relative h-1.5 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
              <span className="absolute inset-y-0 left-0 rounded-full bg-link/35" style={{ width: `${(g.captured / scale) * 100}%` }} />
              <span className={cn("absolute inset-y-0 left-0 rounded-full", g.met ? "bg-success" : "bg-link")} style={{ width: `${(g.inProject / scale) * 100}%` }} />
            </span>
            <span className="text-muted-foreground">
              <span className="sr-only">{g.channel}: </span>
              <span className="text-foreground">{amount(g.inProject, g.unit)}</span> / {amount(g.captured, g.unit)}
              {g.goal !== null ? ` · ${amount(g.goal, g.unit)}` : ""}
              <span className="sr-only">{` (${line})`}</span>
            </span>
          </li>
        )
      })}
    </ul>
  )
}

function NextButton({ state, project }: { state: PrototypeState; project: Project }) {
  const follow = useFollowLink()
  const m = useMessages()
  const next = projectNext(state, project, Date.parse(nowIso()))
  if (!next) return <span className="text-muted-foreground">–</span>
  const runId = next.step ? next.link.params?.runId : undefined
  const run = runId ? state.catalog.runs[runId] : undefined
  const blocked = run ? runPipeline(state, run).blocker !== null : false
  return (
    <Button size="sm" variant="outline" className="max-w-[12rem] min-w-0" onClick={() => follow(next.link)} title={`${say(m, next.label)}: ${say(m, next.reason)}`} data-next={project.id}>
      {blocked ? <StepGlyph state="blocked" /> : null}
      <span className="truncate">{say(m, next.label)}</span>
      <span className="sr-only"> {m.projects_next_for({ name: project.name })}</span>
    </Button>
  )
}

/** Stage; a blocked run reads "Blocked at <step>", opens that step, and carries its reason in the note (D-W35, PRJ-FR-18). */
function StageCell({ state, project }: { state: PrototypeState; project: Project }) {
  const follow = useFollowLink()
  const m = useMessages()
  const stage = projectStage(state, project)
  if (stage.state === "blocked") {
    for (const run of projectRuns(state.catalog, project.id)) {
      const blocker = runPipeline(state, run).blocker
      if (!blocker) continue
      return (
        <span className="mt-1 inline-flex items-center gap-1">
          <button type="button" className="rounded-sm underline-offset-2 hover:underline" onClick={() => follow(runStepLink(run, blocker.step))} data-gate="blocked">
            <GateLabel state="blocked" label={m.home_blocked_at({ step: stepName(m, blocker.step) })} className="text-destructive" />
          </button>
          <NoteMarker label={m.home_why_blocked({ name: run.name })} rows={[{ label: run.name, value: say(m, blocker.message) }]} />
        </span>
      )
    }
  }
  return <GateLabel state={stage.state} label={say(m, stage.label)} className="mt-1" />
}

function ProjectsBox({ state, className }: { state: PrototypeState; className?: string }) {
  const follow = useFollowLink()
  const navigate = useNavigate()
  const m = useMessages()
  const showDone = state.slices.a.showDone
  const switchId = useId()
  const all = Object.values(state.catalog.projects).sort((a, b) => Number(a.state === "done") - Number(b.state === "done") || a.name.localeCompare(b.name))
  const done = all.filter((p) => p.state === "done")
  const rows = showDone ? all : all.filter((p) => p.state !== "done")
  const setShowDone = (value: boolean) => updateSlice("a", (a) => ({ ...a, showDone: value }))
  const columns: Column<Project>[] = [
    {
      id: "project",
      header: m.home_column_project(),
      rowHeader: true,
      className: "w-[40%] align-top whitespace-normal",
      sortValue: (p) => p.name,
      cell: (p) => (
        <div className="min-w-0 py-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <Link to="/projects/$projectId" params={{ projectId: p.id }} className="font-medium underline-offset-2 hover:underline">
              {p.name}
            </Link>
            {p.state === "done" ? <Pill tone="muted">{projectStatus(p) === "archived" ? m.status_archived() : m.status_done()}</Pill> : null}
          </div>
          <div className="text-xs text-pretty text-muted-foreground">
            {p.subjects.map((s) => subjectName(m, state.catalog, s)).join(", ") || m.projects_no_subjects()} · {m.home_rig_count({ count: p.rigIds.length })}
          </div>
          <StageCell state={state} project={p} />
        </div>
      ),
    },
    { id: "goals", header: m.home_goals(), className: "align-top", cell: (p) => <GoalLines goals={channelGoals(goalProgress(state.catalog, p))} /> },
    { id: "next", header: m.home_column_next(), className: "w-[12rem] align-top", cell: (p) => <div className="py-1"><NextButton state={state} project={p} /></div> },
  ]
  const menu = (p: Project): MenuEntry[] => {
    const next = projectNext(state, p, Date.parse(nowIso()))
    return [
      { heading: p.name },
      { label: m.verb_open(), icon: Eye, onSelect: () => void navigate({ to: "/projects/$projectId", params: { projectId: p.id } }) },
      ...(next ? [{ label: say(m, next.label), onSelect: () => follow(next.link) }] : []),
      ...(p.state === "open"
        ? [
            { separator: true } as const,
            { label: m.startrun_open(), icon: Play, onSelect: () => openSheet({ kind: "start-run", projectId: p.id }) },
            { label: m.nav_plan(), icon: CalendarClock, onSelect: () => void navigate({ to: "/plan", search: { project: p.id } }) },
          ]
        : []),
    ]
  }
  return (
    <Box
      id="home-projects"
      level={2}
      flush
      className={className}
      title={
        <span className="flex items-center gap-1.5">
          {m.nav_projects()} <CountBadge count={rows.length} label={m.home_project_count({ count: rows.length })} />
        </span>
      }
      actions={
        <div className="flex items-center gap-2" data-chrome>
          <Switch id={switchId} size="sm" checked={showDone} onCheckedChange={setShowDone} />
          <Label htmlFor={switchId} className="text-xs font-normal">
            {m.projects_show_done()}
          </Label>
          {!showDone && done.length > 0 ? <Pill tone="muted">{m.home_hidden_count({ count: done.length })}</Pill> : null}
        </div>
      }
    >
      {all.length === 0 ? (
        <EmptyState
          icon={FolderPlus}
          title={m.home_projects_none()}
          description={null}
          className="m-3"
          action={
            <Button size="sm" variant="outline" onClick={() => openSheet({ kind: "new-project" })}>
              {m.newproject_open()}
            </Button>
          }
        />
      ) : (
        <DataTable
          label={m.nav_projects()}
          rows={rows}
          columns={columns}
          getRowId={(p) => p.id}
          scroll="none"
          className="rounded-none border-0"
          contextMenu={menu}
          empty={
            <div className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="text-muted-foreground">{m.home_all_done()}</span>
              <Button size="xs" variant="outline" onClick={() => setShowDone(true)}>
                {m.projects_show_done()}
              </Button>
            </div>
          }
        />
      )}
    </Box>
  )
}

// Sessions --------------------------------------------------------------------

type SessionFilterLink = "needs-target" | "not-in-project"

function WorkGroup({ title, count, filter, children }: { title: string; count: number; filter?: SessionFilterLink; children: ReactNode }) {
  const m = useMessages()
  return (
    <div className="min-w-0">
      <div className="flex min-h-7 items-center justify-between gap-2 border-b border-separator" data-chrome>
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          {title} <CountBadge count={count} label={m.session_count({ count })} />
        </h3>
        {filter && count > ROWS_PER_GROUP ? (
          <Link to="/sessions" search={{ filter }} className="text-xs text-link underline-offset-2 hover:underline">
            {m.home_all_count({ count: formatCount(count) })}
          </Link>
        ) : null}
      </div>
      {count === 0 ? <p className="py-1.5 text-xs text-muted-foreground">{m.home_none()}</p> : <ul className="divide-y divide-border/60">{children}</ul>}
    </div>
  )
}

function WorkRow({ session, detail, action }: { session: Session; detail: ReactNode; action: ReactNode }) {
  const m = useMessages()
  return (
    <li {...menuKey(session.id)} className="flex min-h-(--row-h) flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1 text-sm">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Link to="/sessions/$sessionId" params={{ sessionId: session.id }} className="truncate font-medium underline-offset-2 hover:underline">
          {sessionLongLabel(m, session)}
        </Link>
        <span className="flex min-w-0 shrink items-center gap-1 truncate text-xs text-muted-foreground">{detail}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{action}</div>
    </li>
  )
}

function SessionsBox({ state, onReview, className }: { state: PrototypeState; onReview: (sessionId: SessionId) => void; className?: string }) {
  const { catalog } = state
  const follow = useFollowLink()
  const navigate = useNavigate()
  const m = useMessages()
  const work = sessionsNeedingWork(catalog)
  const [notice, setNotice] = useState<AddedNotice | null>(null)
  const [refusal, setRefusal] = useState<RefusalProps | null>(null)
  const [adding, setAdding] = useState<PendingAdd | null>(null)
  const projectName = (id: string) => catalog.projects[id]?.name ?? m.home_column_project()
  // A session can be a candidate of several Projects; its library review is one.
  const unreviewed = [...new Map(work.unreviewed.map((u) => [u.session.id, u])).values()]
  const total = work.needsTarget.length + work.notInProject.length + unreviewed.length + work.readyToAdd.length

  const openSession = (sessionId: string, hash?: string) => void navigate({ to: "/sessions/$sessionId", params: { sessionId }, hash })
  const menu = (sessionId: string): MenuEntry[] => {
    const session = catalog.sessions[sessionId]
    if (!session) return []
    return [
      { heading: sessionLabel(m, session) },
      { label: m.verb_open(), icon: Eye, onSelect: () => openSession(sessionId) },
      { label: m.session_review_frames(), icon: ListChecks, onSelect: () => onReview(sessionId) },
      { separator: true },
      ...(sessionTargetId(session) ? addToProjectEntries(m, catalog, sessionId, setAdding) : [{ label: m.session_choose_target(), icon: Target, onSelect: () => openSession(sessionId, "target") }]),
    ]
  }

  return (
    <Box
      id="home-sessions"
      level={2}
      className={className}
      title={
        <span className="flex items-center gap-1.5">
          {m.nav_sessions()} <CountBadge count={total} tone={total > 0 ? "warning" : "neutral"} label={m.home_sessions_need_work({ count: total })} />
        </span>
      }
      actions={
        <Button size="xs" variant="ghost" render={<Link to="/sessions" />}>
          {m.home_all_sessions()}
        </Button>
      }
    >
      <div className="space-y-3">
        {notice ? (
          <Notice tone="info" title={notice.title} actions={<Button size="xs" variant="ghost" onClick={() => setNotice(null)}>{m.session_dismiss()}</Button>}>
            {notice.note}
          </Notice>
        ) : null}
        {refusal ? <Refusal {...refusal} /> : null}
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">{m.home_nothing_to_do()}</p>
        ) : (
          <ContextMenuArea menu={menu}>
            <div className="grid gap-x-6 gap-y-3 2xl:grid-cols-2">
              <WorkGroup title={m.sessions_filter_needs_target()} count={work.needsTarget.length} filter="needs-target">
                {work.needsTarget.slice(0, ROWS_PER_GROUP).map((session) => {
                  const suggestion = session.target.value ? catalog.targets[session.target.value] : undefined
                  return (
                    <WorkRow
                      key={session.id}
                      session={session}
                      detail={session.objectLabel ? m.session_object({ name: session.objectLabel }) : m.session_no_object()}
                      action={
                        suggestion ? (
                          <Button
                            size="xs"
                            variant="outline"
                            title={m.home_suggested()}
                            onClick={() => {
                              const result = confirmTarget(session.id, suggestion.id, session.revision)
                              setRefusal(refusalOf(result, m.session_cant_confirm()))
                              if (result.ok) announce(m.session_target_confirmed({ name: suggestion.name }))
                            }}
                          >
                            {m.home_confirm_target({ name: suggestion.name })}
                          </Button>
                        ) : (
                          <Button size="xs" variant="outline" render={<Link to="/sessions/$sessionId" params={{ sessionId: session.id }} hash="target" />}>
                            {m.session_choose_target()}
                          </Button>
                        )
                      }
                    />
                  )
                })}
              </WorkGroup>
              <WorkGroup title={m.sessions_filter_not_in_project()} count={work.notInProject.length} filter="not-in-project">
                {work.notInProject.slice(0, ROWS_PER_GROUP).map((session) => (
                  <WorkRow
                    key={session.id}
                    session={session}
                    detail={session.target.value ? (catalog.targets[session.target.value]?.name ?? "") : ""}
                    action={<AddToProjectMenu sessionId={session.id} size="xs" onAdded={setNotice} />}
                  />
                ))}
              </WorkGroup>
              <WorkGroup title={m.status_unreviewed()} count={unreviewed.length}>
                {unreviewed.slice(0, ROWS_PER_GROUP).map(({ session, projectId, frames }) => (
                  <WorkRow
                    key={session.id}
                    session={session}
                    detail={
                      <>
                        <CountBadge count={frames} tone="warning" label={m.session_frames_unreviewed({ count: frames, frames: formatCount(frames) })} />
                        <span className="truncate">{projectName(projectId)}</span>
                      </>
                    }
                    action={
                      <Button size="xs" variant="outline" onClick={() => onReview(session.id)} data-review-session={session.id}>
                        {m.verb_review()}
                      </Button>
                    }
                  />
                ))}
              </WorkGroup>
              <WorkGroup title={m.home_group_ready_to_add()} count={work.readyToAdd.length}>
                {work.readyToAdd.slice(0, ROWS_PER_GROUP).map(({ session, projectId }) => {
                  const run = runToJoin(catalog, projectId, session.id)
                  return (
                    <WorkRow
                      key={`${projectId}-${session.id}`}
                      session={session}
                      detail={run ? `${projectName(projectId)} · ${run.name}` : projectName(projectId)}
                      action={
                        run ? (
                          <Button
                            size="xs"
                            variant="outline"
                            title={m.target_add_to_named({ name: run.name })}
                            onClick={() => {
                              const reason = runCandidates(catalog, run).find((c) => c.session.id === session.id)?.reason ?? msg("home_candidate_of", { name: run.name })
                              const result = addRunSessions(run.id, [session.id], { kind: "candidate", detail: reason })
                              setRefusal(refusalOf(result, m.session_cant_add()))
                              if (!result.ok) return
                              announce(m.home_added_to_draft({ session: sessionLabel(m, session), run: run.name }))
                              follow(runStepLink(run, "select"))
                            }}
                          >
                            {m.run_select_add_to_run()}
                          </Button>
                        ) : (
                          <Button size="xs" variant="outline" onClick={() => openSheet({ kind: "start-run", projectId })}>
                            {m.startrun_title()}
                          </Button>
                        )
                      }
                    />
                  )
                })}
              </WorkGroup>
            </div>
          </ContextMenuArea>
        )}
      </div>
      <AddToProjectDialog pending={adding} onClose={() => setAdding(null)} onAdded={setNotice} />
    </Box>
  )
}

// Tonight ---------------------------------------------------------------------

function TonightBox({ state, className }: { state: PrototypeState; className?: string }) {
  const site = planningSite(state)
  const m = useMessages()
  if (!site) {
    return (
      <Box id="home-tonight" level={2} title={m.home_tonight()} className={className}>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">{m.home_no_site()}</span>
          <Button size="xs" variant="outline" render={<Link to="/settings/sites" />}>
            {m.tonight_add_site()}
          </Button>
        </div>
      </Box>
    )
  }
  const nowMs = Date.parse(nowIso())
  const tonight = tonightAt(site, nowMs)
  const tz = site.timeZone
  const zone = (iso: string) => zoneAbbreviation(iso, tz)
  const criteria = defaultCriteria(site)
  // Subjects of open Projects plus ★ favourites; a mosaic uses its centre (D-W63).
  const entries = new Map<string, { name: string; ra: number; dec: number; favourite: boolean; projects: string[] }>()
  for (const target of Object.values(state.catalog.targets)) {
    if (target.favourite && target.ra !== null && target.dec !== null) entries.set(target.id, { name: target.name, ra: target.ra, dec: target.dec, favourite: true, projects: [] })
  }
  for (const project of Object.values(state.catalog.projects)) {
    if (project.state !== "open") continue
    for (const subject of project.subjects) {
      const centre = subjectCentre(state.catalog, subject)
      if (!centre) continue
      const key = subject.mosaic ? `${subject.targetId}#mosaic` : subject.targetId
      const entry = entries.get(key) ?? { name: subjectName(m, state.catalog, subject), ra: centre.ra, dec: centre.dec, favourite: Boolean(state.catalog.targets[subject.targetId]?.favourite), projects: [] }
      if (!entry.projects.includes(project.name)) entry.projects.push(project.name)
      entries.set(key, entry)
    }
  }
  const rows = [...entries.entries()].map(([key, e]) => {
    const target = state.catalog.targets[key.replace("#mosaic", "")]
    const window = target ? bestWindowTonight({ ...target, ra: e.ra, dec: e.dec }, site, criteria, nowMs) : null
    return { key, ...e, window }
  })
  const withWindow = rows.filter((r) => r.window).sort((a, b) => a.window!.start.localeCompare(b.window!.start))
  const without = rows.filter((r) => !r.window).sort((a, b) => a.name.localeCompare(b.name))

  return (
    <Box
      id="home-tonight"
      level={2}
      title={m.home_tonight()}
      className={className}
      actions={
        <>
          <Pill tone="muted" title={tz}>
            {site.name}
          </Pill>
          <Button size="xs" variant="ghost" render={<Link to="/plan" />}>
            {m.nav_plan()}
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm tabular-nums">
          <dt className="text-muted-foreground">{m.home_darkness()}</dt>
          <dd>{tonight.darkness ? `${formatTime(tonight.darkness.start, tz)}–${formatTime(tonight.darkness.end, tz)} ${zone(tonight.darkness.start)}` : m.project_none_tonight()}</dd>
          <dt className="text-muted-foreground">{m.home_moon()}</dt>
          <dd>
            {say(m, tonight.moon.phase)}, {Math.round(tonight.moon.illuminationPct)}%
            <span className="text-muted-foreground">
              {tonight.moon.rise ? ` · ${m.tonight_moon_rises({ time: formatTime(tonight.moon.rise, tz) })}` : ""}
              {tonight.moon.set ? ` · ${m.tonight_moon_sets({ time: formatTime(tonight.moon.set, tz) })}` : ""}
            </span>
          </dd>
        </dl>
        <h3 className="border-b border-separator pt-1 pb-1 text-xs font-semibold text-muted-foreground" data-chrome>
          {m.home_windows()}
        </h3>
        {rows.length === 0 ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">{m.home_no_subjects_or_favourites()}</span>
            <Button size="xs" variant="outline" render={<Link to="/targets" />}>
              {m.nav_targets()}
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 text-sm" data-tonight-windows>
            {withWindow.map((r) => (
              <li key={r.key} className="grid min-h-(--row-h) grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 py-1">
                <span className="min-w-0 truncate" title={r.projects.join(", ") || m.project_search_favourite()}>
                  {r.favourite ? <span role="img" aria-label={m.home_favourite()}>★ </span> : null}
                  {r.name}
                </span>
                <span className="text-xs tabular-nums">
                  {formatTime(r.window!.start, tz)}–{formatTime(r.window!.end, tz)}
                  <span className="text-muted-foreground"> · {m.home_window_detail({ altitude: Math.round(r.window!.maxAltitudeDeg), separation: Math.round(r.window!.moonSeparationDeg) })}</span>
                </span>
              </li>
            ))}
            {without.map((r) => (
              <li key={r.key} className="grid min-h-(--row-h) grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 py-1 text-muted-foreground">
                <span className="min-w-0 truncate">
                  {r.favourite ? <span role="img" aria-label={m.home_favourite()}>★ </span> : null}
                  {r.name}
                </span>
                <span className="text-xs">{m.home_no_window()}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Box>
  )
}

// Goals -----------------------------------------------------------------------

interface GoalRow {
  key: string
  subject: string
  project: Project
  progress: GoalProgress
}

function GoalsBox({ state, className }: { state: PrototypeState; className?: string }) {
  const m = useMessages()
  const rows: GoalRow[] = targetStatus(state.catalog).map(({ project, subject, progress }) => {
    const panel = findPanel(subject, progress.goal.panelId)
    const name = subjectName(m, state.catalog, subject)
    return { key: `${project.id}-${progress.goal.id}`, subject: panel ? m.home_panel({ name, n: panel.n }) : name, project, progress }
  })
  const unit = (p: GoalProgress) => (p.goal.integrationS !== null ? "seconds" : "frames")
  const val = (p: GoalProgress, t: { frames: number; seconds: number }) => (unit(p) === "seconds" ? formatHours(t.seconds) : formatCount(t.frames))
  const columns: Column<GoalRow>[] = [
    {
      id: "subject",
      header: m.home_column_subject(),
      rowHeader: true,
      sortValue: (r) => r.subject,
      cell: (r) => (
        <span className="flex min-w-0 flex-col">
          <span className="truncate">{r.subject}</span>
          <Link to="/projects/$projectId" params={{ projectId: r.project.id }} className="truncate text-xs text-muted-foreground underline-offset-2 hover:underline">
            {r.project.name}
          </Link>
        </span>
      ),
    },
    { id: "channel", header: m.home_column_channel(), sortValue: (r) => r.progress.goal.channel, cell: (r) => <Pill tone="neutral">{r.progress.goal.channel}</Pill> },
    { id: "in", header: m.home_column_in_project(), align: "right", sortValue: (r) => r.progress.inProject.seconds, cell: (r) => val(r.progress, r.progress.inProject) },
    { id: "captured", header: m.coverage_captured(), align: "right", sortValue: (r) => r.progress.captured.seconds, cell: (r) => val(r.progress, r.progress.captured) },
    {
      id: "goal",
      header: m.home_column_goal(),
      align: "right",
      cell: (r) => {
        const { integrationS, frameCount } = r.progress.goal
        if (integrationS !== null) return formatHours(integrationS)
        return frameCount !== null ? m.session_frame_count({ count: frameCount, frames: formatCount(frameCount) }) : m.home_quality_bar()
      },
    },
    {
      id: "needs",
      header: m.home_column_needs(),
      sortValue: (r) => r.progress.remainingS ?? 0,
      cell: (r) => {
        const p = r.progress
        if (p.remainingS === null) {
          const short = Math.max(0, (p.goal.frameCount ?? 0) - p.inProject.frames)
          return short > 0 ? <span className="tabular-nums">{m.session_frame_count({ count: short, frames: formatCount(short) })}</span> : <Pill tone="muted">{m.home_quality_bar()}</Pill>
        }
        const toCapture = Math.max(0, (p.goal.integrationS ?? 0) - p.captured.seconds)
        return (
          <span className="flex items-center gap-1.5 whitespace-nowrap tabular-nums">
            {formatHours(p.remainingS)}
            {toCapture === 0 ? (
              <Pill tone="info" title={m.home_captured_covers()}>
                {m.coverage_captured()}
              </Pill>
            ) : (
              <Pill tone="muted" title={m.home_still_to_capture()}>
                +{formatHours(toCapture)}
              </Pill>
            )}
          </span>
        )
      },
    },
  ]
  const hasGoals = Object.values(state.catalog.projects).some((p) => p.state === "open" && p.goals.length > 0)
  return (
    <Box
      id="home-goals"
      level={2}
      flush
      className={className}
      title={
        <span className="flex items-center gap-1.5">
          {m.home_goals()} <CountBadge count={rows.length} label={m.home_goals_unmet({ count: rows.length })} />
        </span>
      }
    >
      <DataTable
        label={m.home_unmet_goals()}
        rows={rows}
        columns={columns}
        getRowId={(r) => r.key}
        scroll="none"
        className="rounded-none border-0"
        empty={<p className="px-3 py-2 text-sm text-muted-foreground">{hasGoals ? m.home_all_met() : m.projects_no_goals()}</p>}
      />
    </Box>
  )
}

// Work ------------------------------------------------------------------------

function operationHref(state: PrototypeState, op: Operation): string {
  const runId = op.scope.runIds?.[0]
  const run = runId ? state.catalog.runs[runId] : undefined
  if (op.kind === "import") return `/sessions?import=${op.id}`
  if (op.kind === "index") return "/storage"
  if (op.kind === "stack-master") return "/calibration"
  if (run) return runHref(run, runPipeline(state, run).current.id)
  if (op.scope.projectId) return `/projects/${op.scope.projectId}`
  return "/activity"
}

function WorkBox({ state, className }: { state: PrototypeState; className?: string }) {
  const ops = runningWork(state.operations)
  const m = useMessages()
  return (
    <Box
      id="home-work"
      level={2}
      title={
        <span className="flex items-center gap-1.5">
          {m.issues_group_work()} {ops.length > 0 ? <CountBadge count={ops.length} tone="info" label={m.home_running_count({ count: ops.length })} /> : null}
        </span>
      }
      className={className}
      actions={
        <Button size="xs" variant="ghost" render={<Link to="/activity" />}>
          {m.nav_activity()}
        </Button>
      }
    >
      {ops.length === 0 ? (
        <p className="text-sm text-muted-foreground">{m.activity_nothing_running()}</p>
      ) : (
        <ul className="space-y-2.5" data-running-work>
          {ops.map((op) => {
            const href = operationHref(state, op)
            const value = op.progress.total > 0 ? Math.min(100, (op.progress.done / op.progress.total) * 100) : null
            const title = say(m, op.title)
            const unit = say(m, OPERATION_UNIT_NAME[op.progress.unit])
            return (
              <li key={op.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <a href={`#${href}`} className="min-w-0 truncate text-sm font-medium underline-offset-2 hover:underline">
                    {title}
                  </a>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <StatusBadge kind="operation" value={op.status} />
                    {op.status === "running" && op.canPause ? (
                      <Button size="icon-xs" variant="ghost" aria-label={m.home_pause_named({ name: title })} onClick={() => pauseOperation(op.id)}>
                        <Pause aria-hidden="true" />
                      </Button>
                    ) : null}
                    {op.status === "paused" || op.status === "interrupted" ? (
                      <Button
                        size="icon-xs"
                        variant="ghost"
                        aria-label={op.status === "paused" ? m.home_resume_named({ name: title }) : m.home_retry_named({ name: title })}
                        onClick={() => resumeOperation(op.id)}
                      >
                        <Play aria-hidden="true" />
                      </Button>
                    ) : null}
                    {op.canCancel ? (
                      <Button size="icon-xs" variant="ghost" aria-label={m.home_cancel_named({ name: title })} onClick={() => cancelOperation(op.id)}>
                        <X aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <Progress value={value} aria-label={m.operation_progress_label({ title })} className="gap-1">
                  <span className="text-xs text-muted-foreground tabular-nums" aria-hidden="true">
                    {value === null ? unit : m.operation_progress_count({ done: formatCount(op.progress.done), total: formatCount(op.progress.total), unit })}
                  </span>
                </Progress>
              </li>
            )
          })}
        </ul>
      )}
    </Box>
  )
}
