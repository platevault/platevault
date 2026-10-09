/**
 * S1 Home (slice A), the start page: the control-panel dashboard (D-W39).
 *
 * Top line: "N sessions need a Target · M not in any Project", each count
 * opening Sessions filtered (D-W35). Then six sections in order:
 * 1 actions (Import, New Project, Plan tonight); 2 Projects with goals per
 * channel (in project / captured), stage and the one Next action (D-W35
 * rule order; a blocked run reads "Blocked: <reason>" and opens that step;
 * Done Projects behind Show done, D-W48); 3 new sessions needing work, each
 * with one action; 4 Tonight (best windows for subjects and favourites, the
 * Moon, darkness, or the no-site state); 5 Target status (unmet goals and
 * what each channel still needs); 6 running work.
 */
import { Link } from "@tanstack/react-router"
import { CalendarClock, Download, FolderPlus, Pause, Play, X } from "lucide-react"
import { type ReactNode, useId, useState } from "react"
import { GateLabel, StepGlyph, useFollowLink } from "@/app/run-ui"
import { openSheet } from "@/app/ui-state"
import { type Column, DataTable } from "@/components/app/data-table"
import { announce, EmptyState, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import {
  findPanel,
  formatHours,
  goalProgress,
  homeTopLine,
  liveLightSessions,
  planningSite,
  projectNext,
  projectStage,
  projectStatus,
  projectRuns,
  runCandidates,
  runHref,
  runningWork,
  runPipeline,
  runStepLink,
  sessionsNeedingWork,
  subjectCentre,
  subjectName,
  targetStatus,
  type GoalProgress,
} from "@/domain/derive"
import { STEP_LABEL } from "@/domain/labels"
import { sessionLabel, sessionLongLabel } from "@/domain/membership"
import { bestWindowTonight, defaultCriteria, tonightAt, zoneAbbreviation } from "@/domain/planning"
import type { Operation, Project, Session } from "@/domain/types"
import { formatCount, formatTime, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { addRunSessions } from "@/store/actions/runs"
import { confirmTarget } from "@/store/actions/library"
import { nowIso, type PrototypeState, updateSlice, useStore } from "@/store/core"
import { cancelOperation, pauseOperation, resumeOperation } from "@/store/operations"
import { AddToProjectMenu, type AddedNotice } from "./parts"
import { reviewLink, runToJoin } from "./session-model"

const ROWS_PER_GROUP = 4

export function HomePage() {
  const state = useStore((s) => s)
  const top = homeTopLine(state.catalog)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Home"
        description={
          <span data-home-top-line>
            {/* A zero count is a fact, not a destination: only counts above zero open Sessions filtered. */}
            {top.needsTarget > 0 ? (
              <Link to="/sessions" search={{ filter: "needs-target" }} className="text-link underline-offset-2 hover:underline">
                {plural(top.needsTarget, "session")} need{top.needsTarget === 1 ? "s" : ""} a Target
              </Link>
            ) : (
              <span>No session needs a Target</span>
            )}
            <span aria-hidden="true"> · </span>
            {top.notInProject > 0 ? (
              <Link to="/sessions" search={{ filter: "not-in-project" }} className="text-link underline-offset-2 hover:underline">
                {formatCount(top.notInProject)} not in any Project
              </Link>
            ) : (
              <span>none outside a Project</span>
            )}
          </span>
        }
      />
      <PageBody className="space-y-4">
        <ActionsBar />
        <div className="grid gap-x-6 gap-y-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
          <ProjectsSection state={state} className="xl:col-start-1 xl:row-start-1" />
          <NewSessionsSection state={state} className="xl:col-start-1 xl:row-start-2" />
          <TonightSection state={state} className="xl:col-start-2 xl:row-span-2 xl:row-start-1 xl:self-start" />
          <TargetStatusSection state={state} className="xl:col-start-1 xl:row-start-3" />
          <RunningWorkSection state={state} className="xl:col-start-2 xl:row-start-3 xl:self-start" />
        </div>
      </PageBody>
    </div>
  )
}

// 1 ---------------------------------------------------------------------------

function ActionsBar() {
  return (
    <section aria-labelledby="home-actions" className="flex flex-wrap items-center gap-2 border-b border-separator pb-3" data-chrome>
      <h2 id="home-actions" className="sr-only">
        Actions
      </h2>
      <Button size="sm" onClick={() => openSheet({ kind: "import" })}>
        <Download data-icon="inline-start" aria-hidden="true" />
        Import…
      </Button>
      <Button size="sm" variant="outline" onClick={() => openSheet({ kind: "new-project" })}>
        <FolderPlus data-icon="inline-start" aria-hidden="true" />
        New Project…
      </Button>
      <Button size="sm" variant="outline" render={<Link to="/plan" />}>
        <CalendarClock data-icon="inline-start" aria-hidden="true" />
        Plan tonight
      </Button>
    </section>
  )
}

// 2 ---------------------------------------------------------------------------

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
  if (goals.length === 0) return <span className="text-xs text-muted-foreground">No goals set</span>
  return (
    <ul className="space-y-1 py-1">
      {goals.map((g) => {
        const scale = Math.max(g.goal ?? 0, g.captured, 1)
        return (
          <li key={g.channel} className="grid grid-cols-[2.5rem_3rem_auto] items-center gap-2 text-xs whitespace-nowrap tabular-nums">
            <span className="font-medium">{g.channel}</span>
            <span className="relative h-1.5 overflow-hidden rounded-full bg-foreground/10" aria-hidden="true">
              <span className="absolute inset-y-0 left-0 rounded-full bg-link/35" style={{ width: `${(g.captured / scale) * 100}%` }} />
              <span className={cn("absolute inset-y-0 left-0 rounded-full", g.met ? "bg-success" : "bg-link")} style={{ width: `${(g.inProject / scale) * 100}%` }} />
            </span>
            <span className="text-muted-foreground">
              <span className="sr-only">{g.channel}: </span>
              <span className="text-foreground">{amount(g.inProject, g.unit)}</span>
              <span className="sr-only"> in project,</span> / {amount(g.captured, g.unit)}
              <span className="sr-only"> captured</span>
              {g.goal !== null ? ` · goal ${amount(g.goal, g.unit)}` : ""}
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
  if (!next) return <span className="text-xs text-muted-foreground">Nothing pending</span>
  const runId = next.step ? next.link.params?.runId : undefined
  const run = runId ? state.catalog.runs[runId] : undefined
  const blocker = run ? runPipeline(state, run).blocker : null
  const label = blocker ? `Blocked: ${blocker.message}` : next.label
  return (
    <Button size="sm" variant="outline" className="h-auto max-w-full justify-start text-left whitespace-normal" onClick={() => follow(next.link)} title={next.reason} data-next={project.id}>
      {blocker ? <StepGlyph state="blocked" /> : null}
      <span className="min-w-0">{label}</span>
    </Button>
  )
}

/** Stage; a blocked run reads "Blocked: <reason>" and opens that run's step (D-W35, PRJ-FR-18). */
function StageCell({ state, project }: { state: PrototypeState; project: Project }) {
  const follow = useFollowLink()
  const stage = projectStage(state, project)
  if (stage.state === "blocked") {
    for (const run of projectRuns(state.catalog, project.id)) {
      const blocker = runPipeline(state, run).blocker
      if (!blocker) continue
      return (
        <button type="button" className="mt-1 inline-flex items-start gap-1 text-left text-[0.75rem] font-medium text-destructive underline-offset-2 hover:underline" onClick={() => follow(runStepLink(run, blocker.step))} data-gate="blocked">
          <StepGlyph state="blocked" className="mt-px" />
          <span>
            Blocked: {blocker.message}
            <span className="block font-normal text-muted-foreground">{run.name} · {STEP_LABEL[blocker.step]}</span>
          </span>
        </button>
      )
    }
  }
  return <GateLabel state={stage.state} label={stage.label} className="mt-1" />
}

function ProjectsSection({ state, className }: { state: PrototypeState; className?: string }) {
  const showDone = state.slices.a.showDone
  const switchId = useId()
  const all = Object.values(state.catalog.projects).sort((a, b) => Number(a.state === "done") - Number(b.state === "done") || a.name.localeCompare(b.name))
  const done = all.filter((p) => p.state === "done")
  const rows = showDone ? all : all.filter((p) => p.state !== "done")
  const columns: Column<Project>[] = [
    {
      id: "project",
      header: "Project · stage",
      rowHeader: true,
      className: "w-[40%] align-top whitespace-normal",
      sortValue: (p) => p.name,
      cell: (p) => (
        <div className="min-w-0 py-1">
          <div className="flex flex-wrap items-center gap-x-2">
            <Link to="/projects/$projectId" params={{ projectId: p.id }} className="font-medium underline-offset-2 hover:underline">
              {p.name}
            </Link>
            {p.state === "done" ? <span className="text-xs text-muted-foreground">{projectStatus(p) === "archived" ? "Archived" : "Done"}</span> : null}
          </div>
          <div className="text-xs text-pretty text-muted-foreground">
            {p.subjects.map((s) => subjectName(state.catalog, s)).join(", ") || "No subjects"} · {plural(p.rigIds.length, "rig")}
          </div>
          <StageCell state={state} project={p} />
        </div>
      ),
    },
    {
      id: "goals",
      header: "Goals: in project / captured",
      className: "align-top",
      cell: (p) => <GoalLines goals={channelGoals(goalProgress(state.catalog, p))} />,
    },
    { id: "next", header: "Next", className: "w-[11rem] align-top", cell: (p) => <div className="py-1"><NextButton state={state} project={p} /></div> },
  ]
  return (
    <Section
      id="home-projects"
      title="Projects"
      className={className}
      actions={
        <div className="flex items-center gap-2" data-chrome>
          <Switch id={switchId} size="sm" checked={showDone} onCheckedChange={(value) => updateSlice("a", (a) => ({ ...a, showDone: value }))} />
          <label htmlFor={switchId} className="text-xs text-muted-foreground">
            Show done{done.length > 0 ? ` (${done.length})` : ""}
          </label>
        </div>
      }
    >
      {all.length === 0 ? (
        <EmptyState
          icon={FolderPlus}
          title="No Projects yet"
          description="A Project is a campaign: its subjects, rigs and goals. Its candidate sessions come from your library."
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
          empty={<p className="px-3 py-3 text-sm text-muted-foreground">Every Project is Done. Turn on Show done to see them.</p>}
        />
      )}
    </Section>
  )
}

// 3 ---------------------------------------------------------------------------

function WorkGroup({ title, count, filter, children }: { title: string; count: number; filter?: "needs-target" | "not-in-project"; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2 border-b border-separator pb-1" data-chrome>
        <h3 className="text-xs font-medium text-muted-foreground">
          {title} <span className="tabular-nums">· {formatCount(count)}</span>
        </h3>
        {filter && count > 0 ? (
          <Link to="/sessions" search={{ filter }} className="text-xs text-link underline-offset-2 hover:underline">
            Open in Sessions
          </Link>
        ) : null}
      </div>
      {count === 0 ? <p className="py-1.5 text-xs text-muted-foreground">None</p> : <ul className="divide-y divide-border">{children}</ul>}
    </div>
  )
}

function WorkRow({ session, caption, action }: { session: Session; caption: ReactNode; action: ReactNode }) {
  return (
    <li className="flex min-h-(--row-h) flex-wrap items-center justify-between gap-x-3 gap-y-1 py-1 text-sm">
      <div className="min-w-0 flex-1">
        <Link to="/sessions/$sessionId" params={{ sessionId: session.id }} className="font-medium underline-offset-2 hover:underline">
          {sessionLongLabel(session)}
        </Link>
        <span className="ml-2 text-xs text-muted-foreground">{caption}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">{action}</div>
    </li>
  )
}

function More({ total, filter }: { total: number; filter?: "needs-target" | "not-in-project" }) {
  if (total <= ROWS_PER_GROUP) return null
  return (
    <li className="py-1 text-xs text-muted-foreground">
      {filter ? (
        <Link to="/sessions" search={{ filter }} className="text-link underline-offset-2 hover:underline">
          {formatCount(total - ROWS_PER_GROUP)} more in Sessions
        </Link>
      ) : (
        `${formatCount(total - ROWS_PER_GROUP)} more`
      )}
    </li>
  )
}

function NewSessionsSection({ state, className }: { state: PrototypeState; className?: string }) {
  const { catalog } = state
  const follow = useFollowLink()
  const work = sessionsNeedingWork(catalog)
  const [notice, setNotice] = useState<AddedNotice | null>(null)
  const [error, setError] = useState<string | null>(null)
  const projectName = (id: string) => catalog.projects[id]?.name ?? "a Project"
  const total = work.needsTarget.length + work.notInProject.length + work.unreviewed.length + work.readyToAdd.length

  return (
    <Section id="home-new-sessions" title="New sessions needing work" description="Each session has one action that moves it on." className={className}>
      {notice ? (
        <Notice tone="info" title={notice.title} actions={<Button size="xs" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>}>
          {notice.note ?? "No rig was added: the Project already has it."}
        </Notice>
      ) : null}
      {error ? <Notice tone="refusal" title="Not done" actions={<Button size="xs" variant="ghost" onClick={() => setError(null)}>Dismiss</Button>}>{error}</Notice> : null}
      {total === 0 ? (
        <p className="text-sm text-muted-foreground">
          {liveLightSessions(catalog).length === 0 ? "No light sessions in the library yet. Import a card or a folder to start." : "Every session has a Target and a Project, its frames are reviewed and it is in a run."}
        </p>
      ) : (
        <div className="grid gap-x-6 gap-y-4 2xl:grid-cols-2">
          <WorkGroup title="Needs a Target" count={work.needsTarget.length} filter="needs-target">
            {work.needsTarget.slice(0, ROWS_PER_GROUP).map((session) => {
              const suggestion = session.target.value ? catalog.targets[session.target.value] : undefined
              return (
                <WorkRow
                  key={session.id}
                  session={session}
                  caption={session.objectLabel ? `OBJECT ${session.objectLabel}` : "No OBJECT"}
                  action={
                    suggestion ? (
                      <Button
                        size="xs"
                        variant="outline"
                        title="Confirm the Target the evidence suggests"
                        onClick={() => {
                          const result = confirmTarget(session.id, suggestion.id, session.revision)
                          if (!result.ok) setError(result.message)
                          else announce(`Target confirmed: ${suggestion.name}`)
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
            <More total={work.needsTarget.length} filter="needs-target" />
          </WorkGroup>

          <WorkGroup title="Not in any Project" count={work.notInProject.length} filter="not-in-project">
            {work.notInProject.slice(0, ROWS_PER_GROUP).map((session) => (
              <WorkRow
                key={session.id}
                session={session}
                caption={session.target.value ? (catalog.targets[session.target.value]?.name ?? "") : ""}
                action={<AddToProjectMenu sessionId={session.id} size="xs" onAdded={setNotice} />}
              />
            ))}
            <More total={work.notInProject.length} filter="not-in-project" />
          </WorkGroup>

          <WorkGroup title="Unreviewed" count={work.unreviewed.length}>
            {work.unreviewed.slice(0, ROWS_PER_GROUP).map(({ session, projectId, frames }) => (
              <WorkRow
                key={`${projectId}-${session.id}`}
                session={session}
                caption={projectName(projectId)}
                action={
                  <Button size="xs" variant="outline" onClick={() => follow(reviewLink(catalog, projectId, session.id))}>
                    Review {plural(frames, "frame")}
                  </Button>
                }
              />
            ))}
            <More total={work.unreviewed.length} />
          </WorkGroup>

          <WorkGroup title="Ready to add to a run" count={work.readyToAdd.length}>
            {work.readyToAdd.slice(0, ROWS_PER_GROUP).map(({ session, projectId }) => {
              const run = runToJoin(catalog, projectId, session.id)
              return (
                <WorkRow
                  key={`${projectId}-${session.id}`}
                  session={session}
                  caption={projectName(projectId)}
                  action={
                    run ? (
                      <Button
                        size="xs"
                        variant="outline"
                        title={`Adds the session to ${run.name}'s draft and opens Select, where you save it`}
                        onClick={() => {
                          const reason = runCandidates(catalog, run).find((c) => c.session.id === session.id)?.reason ?? `Candidate of ${run.name}`
                          const result = addRunSessions(run.id, [session.id], { kind: "candidate", detail: reason })
                          if (!result.ok) return setError(result.message)
                          announce(`${sessionLabel(session)} added to the ${run.name} draft`)
                          follow(runStepLink(run, "select"))
                        }}
                      >
                        Add to {run.name}
                      </Button>
                    ) : (
                      <Button size="xs" variant="outline" onClick={() => openSheet({ kind: "start-run", projectId })}>
                        Start a run
                      </Button>
                    )
                  }
                />
              )
            })}
            <More total={work.readyToAdd.length} />
          </WorkGroup>
        </div>
      )}
    </Section>
  )
}

// 4 ---------------------------------------------------------------------------

function TonightSection({ state, className }: { state: PrototypeState; className?: string }) {
  const site = planningSite(state)
  if (!site) {
    return (
      <Section id="home-tonight" title="Tonight" className={className}>
        <Notice tone="info" title="Add an observing site in Settings" actions={<Button size="xs" variant="outline" render={<Link to="/settings/sites" />}>Open Sites</Button>}>
          Tonight's windows, the Moon and darkness need a site with its time zone.
        </Notice>
      </Section>
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
    <Section
      id="home-tonight"
      title="Tonight"
      description={`${site.name} · ${tz}`}
      className={className}
      actions={
        <Button size="xs" variant="ghost" render={<Link to="/plan" />}>
          Open Plan
        </Button>
      }
    >
      <dl className="grid grid-cols-[5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm tabular-nums">
        <dt className="text-muted-foreground">Darkness</dt>
        <dd>{tonight.darkness ? `${formatTime(tonight.darkness.start, tz)}–${formatTime(tonight.darkness.end, tz)} ${zone(tonight.darkness.start)}` : "No astronomical darkness tonight"}</dd>
        <dt className="text-muted-foreground">Moon</dt>
        <dd>
          {tonight.moon.phase}, {Math.round(tonight.moon.illuminationPct)}%
          <span className="text-muted-foreground">
            {tonight.moon.rise ? ` · rises ${formatTime(tonight.moon.rise, tz)}` : ""}
            {tonight.moon.set ? ` · sets ${formatTime(tonight.moon.set, tz)}` : ""}
          </span>
        </dd>
      </dl>
      <h3 className="pt-1 text-xs font-medium text-muted-foreground">Best windows</h3>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No subjects or favourites yet. <Link to="/targets" className="text-link underline-offset-2 hover:underline">Open Targets</Link> to ★ one.
        </p>
      ) : (
        <ul className="divide-y divide-border text-sm" data-tonight-windows>
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
              <span className="text-xs">No window tonight</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

// 5 ---------------------------------------------------------------------------

interface StatusRow {
  key: string
  subject: string
  project: Project
  progress: GoalProgress
}

function TargetStatusSection({ state, className }: { state: PrototypeState; className?: string }) {
  const rows: StatusRow[] = targetStatus(state.catalog).map(({ project, subject, progress }) => {
    const panel = findPanel(subject, progress.goal.panelId)
    const name = subjectName(state.catalog, subject)
    return { key: `${project.id}-${progress.goal.id}`, subject: panel ? `${name} · Panel ${panel.n}` : name, project, progress }
  })
  const unit = (p: GoalProgress) => (p.goal.integrationS !== null ? "seconds" : "frames")
  const val = (p: GoalProgress, t: { frames: number; seconds: number }) => (unit(p) === "seconds" ? formatHours(t.seconds) : formatCount(t.frames))
  const columns: Column<StatusRow>[] = [
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
    { id: "channel", header: "Channel", sortValue: (r) => r.progress.goal.channel, cell: (r) => r.progress.goal.channel },
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
      header: "Still needs",
      className: "whitespace-normal",
      sortValue: (r) => r.progress.remainingS ?? 0,
      cell: (r) => {
        const p = r.progress
        if (p.remainingS === null) {
          const short = Math.max(0, (p.goal.frameCount ?? 0) - p.inProject.frames)
          return <span>{short > 0 ? `${plural(short, "frame")} in project` : "Frames that pass the quality bar"}</span>
        }
        const capturedCovers = p.captured.seconds >= (p.goal.integrationS ?? 0)
        return (
          <span>
            {formatHours(p.remainingS)} in project
            <span className="block text-xs text-muted-foreground">{capturedCovers ? "Captured covers it: add candidates to a run" : `${formatHours(Math.max(0, (p.goal.integrationS ?? 0) - p.captured.seconds))} more to capture`}</span>
          </span>
        )
      },
    },
  ]
  return (
    <Section id="home-target-status" title="Target status" description="Unmet goals of open Projects, per subject and channel." className={className}>
      <DataTable
        label="Unmet goals"
        rows={rows}
        columns={columns}
        getRowId={(r) => r.key}
        scroll="none"
        empty={<p className="px-3 py-3 text-sm text-muted-foreground">{Object.values(state.catalog.projects).some((p) => p.state === "open" && p.goals.length > 0) ? "Every goal of an open Project is met." : "No open Project has goals yet."}</p>}
      />
    </Section>
  )
}

// 6 ---------------------------------------------------------------------------

function operationHref(state: PrototypeState, op: Operation): { to: string; label: string } {
  const runId = op.scope.runIds?.[0]
  const run = runId ? state.catalog.runs[runId] : undefined
  if (op.kind === "import") return { to: `/sessions?import=${op.id}`, label: "Sessions" }
  if (op.kind === "index") return { to: "/storage", label: "Storage" }
  if (run) return { to: runHref(run, runPipeline(state, run).current.id), label: run.name }
  if (op.scope.projectId) return { to: `/projects/${op.scope.projectId}`, label: state.catalog.projects[op.scope.projectId]?.name ?? "Project" }
  return { to: "/activity", label: "Activity" }
}

function RunningWorkSection({ state, className }: { state: PrototypeState; className?: string }) {
  const ops = runningWork(state.operations)
  return (
    <Section
      id="home-running"
      title="Running work"
      className={className}
      actions={
        <Button size="xs" variant="ghost" render={<Link to="/activity" />}>
          Activity
        </Button>
      }
    >
      {ops.length === 0 ? (
        <p className="text-sm text-muted-foreground">No work running.</p>
      ) : (
        <ul className="space-y-2.5" data-running-work>
          {ops.map((op) => {
            const href = operationHref(state, op)
            const value = op.progress.total > 0 ? Math.min(100, (op.progress.done / op.progress.total) * 100) : null
            const [path, search] = href.to.split("?")
            return (
              <li key={op.id} className="space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <a href={`#${path}${search ? `?${search}` : ""}`} className="min-w-0 truncate text-sm font-medium underline-offset-2 hover:underline">
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
                    {formatCount(op.progress.done)} of {formatCount(op.progress.total)} {op.progress.unit}
                  </span>
                </Progress>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}
