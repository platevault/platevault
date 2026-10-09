/**
 * S1 Home (slice A), the start page: the control-panel dashboard (D-W39).
 *
 * Top line: every issue as a clickable pill (`useIssues` / `IssuePill`), the
 * same list the toolbar's Issues hub and the status bar read. Then boxes with
 * one-word headings:
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
import { GateLabel, StepGlyph, useFollowLink } from "@/app/run-ui"
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
import { STEP_LABEL } from "@/domain/labels"
import { sessionLabel, sessionLongLabel } from "@/domain/membership"
import { bestWindowTonight, defaultCriteria, tonightAt, zoneAbbreviation } from "@/domain/planning"
import type { Operation, Project, Session, SessionId } from "@/domain/types"
import { formatCount, formatTime, plural } from "@/lib/format"
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
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Home"
        actions={
          <>
            <Button size="sm" variant="outline" render={<Link to="/plan" />}>
              <CalendarClock data-icon="inline-start" aria-hidden="true" />
              Plan tonight
            </Button>
            <Button size="sm" variant="outline" onClick={() => openSheet({ kind: "new-project" })}>
              <FolderPlus data-icon="inline-start" aria-hidden="true" />
              New Project…
            </Button>
            <Button size="sm" onClick={() => openSheet({ kind: "import" })}>
              <Download data-icon="inline-start" aria-hidden="true" />
              Import…
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
  const { issues } = useIssues()
  return (
    <section aria-label="Issues" data-home-top-line data-home-issues>
      {issues.length === 0 ? (
        <Pill tone="success" icon={CircleCheck}>
          No issues
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
  return (
    <Sheet open={session !== undefined} onOpenChange={(next) => !next && onClose()}>
      <SheetContent side="right" className="gap-0 p-0 data-[side=right]:w-[96vw] data-[side=right]:max-w-[96vw] data-[side=right]:sm:max-w-[96vw]" data-home-review>
        {session ? (
          <>
            <SheetHeader className="flex-row items-center gap-2 border-b border-separator py-2 pr-12" data-chrome>
              <SheetTitle className="truncate">{sessionLongLabel(session)}</SheetTitle>
              <Button size="xs" variant="ghost" render={<Link to="/sessions/$sessionId" params={{ sessionId: session.id }} search={{ view: "review" }} />}>
                Open session
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

function GoalLines({ goals }: { goals: ChannelGoal[] }) {
  if (goals.length === 0) return <span className="text-xs text-muted-foreground">No goals</span>
  return (
    <ul className="space-y-1 py-1">
      {goals.map((g) => {
        const scale = Math.max(g.goal ?? 0, g.captured, 1)
        const line = `${amount(g.inProject, g.unit)} in project / ${amount(g.captured, g.unit)} captured${g.goal !== null ? ` · goal ${amount(g.goal, g.unit)}` : ""}`
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
  const next = projectNext(state, project, Date.parse(nowIso()))
  if (!next) return <span className="text-muted-foreground">–</span>
  const runId = next.step ? next.link.params?.runId : undefined
  const run = runId ? state.catalog.runs[runId] : undefined
  const blocked = run ? runPipeline(state, run).blocker !== null : false
  return (
    <Button size="sm" variant="outline" className="max-w-[12rem] min-w-0" onClick={() => follow(next.link)} title={`${next.label}: ${next.reason}`} data-next={project.id}>
      {blocked ? <StepGlyph state="blocked" /> : null}
      <span className="truncate">{next.label}</span>
      <span className="sr-only"> for {project.name}</span>
    </Button>
  )
}

/** Stage; a blocked run reads "Blocked at <step>", opens that step, and carries its reason in the note (D-W35, PRJ-FR-18). */
function StageCell({ state, project }: { state: PrototypeState; project: Project }) {
  const follow = useFollowLink()
  const stage = projectStage(state, project)
  if (stage.state === "blocked") {
    for (const run of projectRuns(state.catalog, project.id)) {
      const blocker = runPipeline(state, run).blocker
      if (!blocker) continue
      return (
        <span className="mt-1 inline-flex items-center gap-1">
          <button type="button" className="rounded-sm underline-offset-2 hover:underline" onClick={() => follow(runStepLink(run, blocker.step))} data-gate="blocked">
            <GateLabel state="blocked" label={`Blocked at ${STEP_LABEL[blocker.step]}`} className="text-destructive" />
          </button>
          <NoteMarker label={`Why ${run.name} is blocked`} rows={[{ label: run.name, value: blocker.message }]} />
        </span>
      )
    }
  }
  return <GateLabel state={stage.state} label={stage.label} className="mt-1" />
}

function ProjectsBox({ state, className }: { state: PrototypeState; className?: string }) {
  const follow = useFollowLink()
  const navigate = useNavigate()
  const showDone = state.slices.a.showDone
  const switchId = useId()
  const all = Object.values(state.catalog.projects).sort((a, b) => Number(a.state === "done") - Number(b.state === "done") || a.name.localeCompare(b.name))
  const done = all.filter((p) => p.state === "done")
  const rows = showDone ? all : all.filter((p) => p.state !== "done")
  const setShowDone = (value: boolean) => updateSlice("a", (a) => ({ ...a, showDone: value }))
  const columns: Column<Project>[] = [
    {
      id: "project",
      header: "Project",
      rowHeader: true,
      className: "w-[40%] align-top whitespace-normal",
      sortValue: (p) => p.name,
      cell: (p) => (
        <div className="min-w-0 py-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <Link to="/projects/$projectId" params={{ projectId: p.id }} className="font-medium underline-offset-2 hover:underline">
              {p.name}
            </Link>
            {p.state === "done" ? <Pill tone="muted">{projectStatus(p) === "archived" ? "Archived" : "Done"}</Pill> : null}
          </div>
          <div className="text-xs text-pretty text-muted-foreground">
            {p.subjects.map((s) => subjectName(state.catalog, s)).join(", ") || "No subjects"} · {plural(p.rigIds.length, "rig")}
          </div>
          <StageCell state={state} project={p} />
        </div>
      ),
    },
    { id: "goals", header: "Goals", className: "align-top", cell: (p) => <GoalLines goals={channelGoals(goalProgress(state.catalog, p))} /> },
    { id: "next", header: "Next", className: "w-[12rem] align-top", cell: (p) => <div className="py-1"><NextButton state={state} project={p} /></div> },
  ]
  const menu = (p: Project): MenuEntry[] => {
    const next = projectNext(state, p, Date.parse(nowIso()))
    return [
      { heading: p.name },
      { label: "Open", icon: Eye, onSelect: () => void navigate({ to: "/projects/$projectId", params: { projectId: p.id } }) },
      ...(next ? [{ label: next.label, onSelect: () => follow(next.link) }] : []),
      ...(p.state === "open"
        ? [
            { separator: true } as const,
            { label: "Start run…", icon: Play, onSelect: () => openSheet({ kind: "start-run", projectId: p.id }) },
            { label: "Plan", icon: CalendarClock, onSelect: () => void navigate({ to: "/plan", search: { project: p.id } }) },
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
          Projects <CountBadge count={rows.length} label={plural(rows.length, "Project")} />
        </span>
      }
      actions={
        <div className="flex items-center gap-2" data-chrome>
          <Switch id={switchId} size="sm" checked={showDone} onCheckedChange={setShowDone} />
          <Label htmlFor={switchId} className="text-xs font-normal">
            Show done
          </Label>
          {!showDone && done.length > 0 ? <Pill tone="muted">{done.length} hidden</Pill> : null}
        </div>
      }
    >
      {all.length === 0 ? (
        <EmptyState
          icon={FolderPlus}
          title="No Projects"
          description={null}
          className="m-3"
          action={
            <Button size="sm" variant="outline" onClick={() => openSheet({ kind: "new-project" })}>
              New Project…
            </Button>
          }
        />
      ) : (
        <DataTable
          label="Projects"
          rows={rows}
          columns={columns}
          getRowId={(p) => p.id}
          scroll="none"
          className="rounded-none border-0"
          contextMenu={menu}
          empty={
            <div className="flex items-center gap-2 px-3 py-2 text-sm">
              <span className="text-muted-foreground">All Done</span>
              <Button size="xs" variant="outline" onClick={() => setShowDone(true)}>
                Show done
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
  return (
    <div className="min-w-0">
      <div className="flex min-h-7 items-center justify-between gap-2 border-b border-separator" data-chrome>
        <h3 className="flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
          {title} <CountBadge count={count} label={plural(count, "session")} />
        </h3>
        {filter && count > ROWS_PER_GROUP ? (
          <Link to="/sessions" search={{ filter }} className="text-xs text-link underline-offset-2 hover:underline">
            All {formatCount(count)}
          </Link>
        ) : null}
      </div>
      {count === 0 ? <p className="py-1.5 text-xs text-muted-foreground">None</p> : <ul className="divide-y divide-border/60">{children}</ul>}
    </div>
  )
}

function WorkRow({ session, detail, action }: { session: Session; detail: ReactNode; action: ReactNode }) {
  return (
    <li {...menuKey(session.id)} className="flex min-h-(--row-h) flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1 text-sm">
      <div className="flex min-w-0 flex-1 items-center gap-2">
        <Link to="/sessions/$sessionId" params={{ sessionId: session.id }} className="truncate font-medium underline-offset-2 hover:underline">
          {sessionLongLabel(session)}
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
  const work = sessionsNeedingWork(catalog)
  const [notice, setNotice] = useState<AddedNotice | null>(null)
  const [refusal, setRefusal] = useState<RefusalProps | null>(null)
  const [adding, setAdding] = useState<PendingAdd | null>(null)
  const projectName = (id: string) => catalog.projects[id]?.name ?? "Project"
  // A session can be a candidate of several Projects; its library review is one.
  const unreviewed = [...new Map(work.unreviewed.map((u) => [u.session.id, u])).values()]
  const total = work.needsTarget.length + work.notInProject.length + unreviewed.length + work.readyToAdd.length

  const openSession = (sessionId: string, hash?: string) => void navigate({ to: "/sessions/$sessionId", params: { sessionId }, hash })
  const menu = (sessionId: string): MenuEntry[] => {
    const session = catalog.sessions[sessionId]
    if (!session) return []
    return [
      { heading: sessionLabel(session) },
      { label: "Open", icon: Eye, onSelect: () => openSession(sessionId) },
      { label: "Review frames", icon: ListChecks, onSelect: () => onReview(sessionId) },
      { separator: true },
      ...(sessionTargetId(session) ? addToProjectEntries(catalog, sessionId, setAdding) : [{ label: "Choose Target", icon: Target, onSelect: () => openSession(sessionId, "target") }]),
    ]
  }

  return (
    <Box
      id="home-sessions"
      level={2}
      className={className}
      title={
        <span className="flex items-center gap-1.5">
          Sessions <CountBadge count={total} tone={total > 0 ? "warning" : "neutral"} label={`${plural(total, "session")} need work`} />
        </span>
      }
      actions={
        <Button size="xs" variant="ghost" render={<Link to="/sessions" />}>
          All sessions
        </Button>
      }
    >
      <div className="space-y-3">
        {notice ? (
          <Notice tone="info" title={notice.title} actions={<Button size="xs" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>}>
            {notice.note}
          </Notice>
        ) : null}
        {refusal ? <Refusal {...refusal} /> : null}
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing to do</p>
        ) : (
          <ContextMenuArea menu={menu}>
            <div className="grid gap-x-6 gap-y-3 2xl:grid-cols-2">
              <WorkGroup title="Needs a Target" count={work.needsTarget.length} filter="needs-target">
                {work.needsTarget.slice(0, ROWS_PER_GROUP).map((session) => {
                  const suggestion = session.target.value ? catalog.targets[session.target.value] : undefined
                  return (
                    <WorkRow
                      key={session.id}
                      session={session}
                      detail={session.objectLabel ? `OBJECT ${session.objectLabel}` : "No OBJECT"}
                      action={
                        suggestion ? (
                          <Button
                            size="xs"
                            variant="outline"
                            title="Suggested by the evidence"
                            onClick={() => {
                              const result = confirmTarget(session.id, suggestion.id, session.revision)
                              setRefusal(refusalOf(result, "Can't confirm"))
                              if (result.ok) announce(`Target confirmed: ${suggestion.name}`)
                            }}
                          >
                            Confirm {suggestion.name}
                          </Button>
                        ) : (
                          <Button size="xs" variant="outline" render={<Link to="/sessions/$sessionId" params={{ sessionId: session.id }} hash="target" />}>
                            Choose Target
                          </Button>
                        )
                      }
                    />
                  )
                })}
              </WorkGroup>
              <WorkGroup title="Not in any Project" count={work.notInProject.length} filter="not-in-project">
                {work.notInProject.slice(0, ROWS_PER_GROUP).map((session) => (
                  <WorkRow
                    key={session.id}
                    session={session}
                    detail={session.target.value ? (catalog.targets[session.target.value]?.name ?? "") : ""}
                    action={<AddToProjectMenu sessionId={session.id} size="xs" onAdded={setNotice} />}
                  />
                ))}
              </WorkGroup>
              <WorkGroup title="Unreviewed" count={unreviewed.length}>
                {unreviewed.slice(0, ROWS_PER_GROUP).map(({ session, projectId, frames }) => (
                  <WorkRow
                    key={session.id}
                    session={session}
                    detail={
                      <>
                        <CountBadge count={frames} tone="warning" label={`${plural(frames, "frame")} unreviewed`} />
                        <span className="truncate">{projectName(projectId)}</span>
                      </>
                    }
                    action={
                      <Button size="xs" variant="outline" onClick={() => onReview(session.id)} data-review-session={session.id}>
                        Review
                      </Button>
                    }
                  />
                ))}
              </WorkGroup>
              <WorkGroup title="Ready to add" count={work.readyToAdd.length}>
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
                            title={`Add to ${run.name}`}
                            onClick={() => {
                              const reason = runCandidates(catalog, run).find((c) => c.session.id === session.id)?.reason ?? `Candidate of ${run.name}`
                              const result = addRunSessions(run.id, [session.id], { kind: "candidate", detail: reason })
                              setRefusal(refusalOf(result, "Can't add"))
                              if (!result.ok) return
                              announce(`${sessionLabel(session)} added to the ${run.name} draft`)
                              follow(runStepLink(run, "select"))
                            }}
                          >
                            Add to run
                          </Button>
                        ) : (
                          <Button size="xs" variant="outline" onClick={() => openSheet({ kind: "start-run", projectId })}>
                            Start run
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
  if (!site) {
    return (
      <Box id="home-tonight" level={2} title="Tonight" className={className}>
        <div className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">No site</span>
          <Button size="xs" variant="outline" render={<Link to="/settings/sites" />}>
            Add site
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
      const entry = entries.get(key) ?? { name: subjectName(state.catalog, subject), ra: centre.ra, dec: centre.dec, favourite: Boolean(state.catalog.targets[subject.targetId]?.favourite), projects: [] }
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
      title="Tonight"
      className={className}
      actions={
        <>
          <Pill tone="muted" title={tz}>
            {site.name}
          </Pill>
          <Button size="xs" variant="ghost" render={<Link to="/plan" />}>
            Plan
          </Button>
        </>
      }
    >
      <div className="space-y-2">
        <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm tabular-nums">
          <dt className="text-muted-foreground">Darkness</dt>
          <dd>{tonight.darkness ? `${formatTime(tonight.darkness.start, tz)}–${formatTime(tonight.darkness.end, tz)} ${zone(tonight.darkness.start)}` : "None tonight"}</dd>
          <dt className="text-muted-foreground">Moon</dt>
          <dd>
            {tonight.moon.phase}, {Math.round(tonight.moon.illuminationPct)}%
            <span className="text-muted-foreground">
              {tonight.moon.rise ? ` · rises ${formatTime(tonight.moon.rise, tz)}` : ""}
              {tonight.moon.set ? ` · sets ${formatTime(tonight.moon.set, tz)}` : ""}
            </span>
          </dd>
        </dl>
        <h3 className="border-b border-separator pt-1 pb-1 text-xs font-semibold text-muted-foreground" data-chrome>
          Windows
        </h3>
        {rows.length === 0 ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-muted-foreground">No subjects or favourites</span>
            <Button size="xs" variant="outline" render={<Link to="/targets" />}>
              Targets
            </Button>
          </div>
        ) : (
          <ul className="divide-y divide-border/60 text-sm" data-tonight-windows>
            {withWindow.map((r) => (
              <li key={r.key} className="grid min-h-(--row-h) grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 py-1">
                <span className="min-w-0 truncate" title={r.projects.join(", ") || "★ favourite"}>
                  {r.favourite ? <span role="img" aria-label="Favourite">★ </span> : null}
                  {r.name}
                </span>
                <span className="text-xs tabular-nums">
                  {formatTime(r.window!.start, tz)}–{formatTime(r.window!.end, tz)}
                  <span className="text-muted-foreground"> · {Math.round(r.window!.maxAltitudeDeg)}° · Moon {Math.round(r.window!.moonSeparationDeg)}°</span>
                </span>
              </li>
            ))}
            {without.map((r) => (
              <li key={r.key} className="grid min-h-(--row-h) grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 py-1 text-muted-foreground">
                <span className="min-w-0 truncate">
                  {r.favourite ? <span role="img" aria-label="Favourite">★ </span> : null}
                  {r.name}
                </span>
                <span className="text-xs">No window</span>
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
  const rows: GoalRow[] = targetStatus(state.catalog).map(({ project, subject, progress }) => {
    const panel = findPanel(subject, progress.goal.panelId)
    const name = subjectName(state.catalog, subject)
    return { key: `${project.id}-${progress.goal.id}`, subject: panel ? `${name} · Panel ${panel.n}` : name, project, progress }
  })
  const unit = (p: GoalProgress) => (p.goal.integrationS !== null ? "seconds" : "frames")
  const val = (p: GoalProgress, t: { frames: number; seconds: number }) => (unit(p) === "seconds" ? formatHours(t.seconds) : formatCount(t.frames))
  const columns: Column<GoalRow>[] = [
    {
      id: "subject",
      header: "Subject",
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
    { id: "channel", header: "Channel", sortValue: (r) => r.progress.goal.channel, cell: (r) => <Pill tone="neutral">{r.progress.goal.channel}</Pill> },
    { id: "in", header: "In project", align: "right", sortValue: (r) => r.progress.inProject.seconds, cell: (r) => val(r.progress, r.progress.inProject) },
    { id: "captured", header: "Captured", align: "right", sortValue: (r) => r.progress.captured.seconds, cell: (r) => val(r.progress, r.progress.captured) },
    {
      id: "goal",
      header: "Goal",
      align: "right",
      cell: (r) => (r.progress.goal.integrationS !== null ? formatHours(r.progress.goal.integrationS) : r.progress.goal.frameCount !== null ? plural(r.progress.goal.frameCount, "frame") : "Quality bar"),
    },
    {
      id: "needs",
      header: "Needs",
      sortValue: (r) => r.progress.remainingS ?? 0,
      cell: (r) => {
        const p = r.progress
        if (p.remainingS === null) {
          const short = Math.max(0, (p.goal.frameCount ?? 0) - p.inProject.frames)
          return short > 0 ? <span className="tabular-nums">{plural(short, "frame")}</span> : <Pill tone="muted">Quality bar</Pill>
        }
        const toCapture = Math.max(0, (p.goal.integrationS ?? 0) - p.captured.seconds)
        return (
          <span className="flex items-center gap-1.5 whitespace-nowrap tabular-nums">
            {formatHours(p.remainingS)}
            {toCapture === 0 ? (
              <Pill tone="info" title="Captured covers it: add candidates to a run">
                Captured
              </Pill>
            ) : (
              <Pill tone="muted" title="Still to capture">
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
          Goals <CountBadge count={rows.length} label={`${plural(rows.length, "goal")} unmet`} />
        </span>
      }
    >
      <DataTable
        label="Unmet goals"
        rows={rows}
        columns={columns}
        getRowId={(r) => r.key}
        scroll="none"
        className="rounded-none border-0"
        empty={<p className="px-3 py-2 text-sm text-muted-foreground">{hasGoals ? "All met" : "No goals"}</p>}
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
  return (
    <Box
      id="home-work"
      level={2}
      title={
        <span className="flex items-center gap-1.5">
          Work {ops.length > 0 ? <CountBadge count={ops.length} tone="info" label={`${ops.length} running`} /> : null}
        </span>
      }
      className={className}
      actions={
        <Button size="xs" variant="ghost" render={<Link to="/activity" />}>
          Activity
        </Button>
      }
    >
      {ops.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing running</p>
      ) : (
        <ul className="space-y-2.5" data-running-work>
          {ops.map((op) => {
            const href = operationHref(state, op)
            const value = op.progress.total > 0 ? Math.min(100, (op.progress.done / op.progress.total) * 100) : null
            return (
              <li key={op.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <a href={`#${href}`} className="min-w-0 truncate text-sm font-medium underline-offset-2 hover:underline">
                    {op.title}
                  </a>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <StatusBadge kind="operation" value={op.status} />
                    {op.status === "running" && op.canPause ? (
                      <Button size="icon-xs" variant="ghost" aria-label={`Pause ${op.title}`} onClick={() => pauseOperation(op.id)}>
                        <Pause aria-hidden="true" />
                      </Button>
                    ) : null}
                    {op.status === "paused" || op.status === "interrupted" ? (
                      <Button size="icon-xs" variant="ghost" aria-label={`${op.status === "paused" ? "Resume" : "Retry"} ${op.title}`} onClick={() => resumeOperation(op.id)}>
                        <Play aria-hidden="true" />
                      </Button>
                    ) : null}
                    {op.canCancel ? (
                      <Button size="icon-xs" variant="ghost" aria-label={`Cancel ${op.title}`} onClick={() => cancelOperation(op.id)}>
                        <X aria-hidden="true" />
                      </Button>
                    ) : null}
                  </div>
                </div>
                <Progress value={value} aria-label={`${op.title} progress`} className="gap-1">
                  <span className="text-xs text-muted-foreground tabular-nums" aria-hidden="true">
                    {value === null ? op.progress.unit : `${formatCount(op.progress.done)} of ${formatCount(op.progress.total)} ${op.progress.unit}`}
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
