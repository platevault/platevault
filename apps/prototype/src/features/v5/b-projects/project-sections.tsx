/**
 * S3 Project sections (slice B), each a hairline Box: runs and run groups
 * first, then candidates (review frames, start a run from a selection),
 * goals (structured kinds and channel chips), subjects (with the mosaic
 * editor), rigs, planning and archived sessions. Each edit goes through a
 * foundation store action and keeps its refusal beside the control as a
 * terse `Refusal`; no section edits a run's membership (PRJ-FR-05,
 * PRJ-FR-08). Lists carry right-click menus.
 */
import { Link, useNavigate } from "@tanstack/react-router"
import { CheckCheck, Eye, Grid2x2Plus, Layers, Pencil, Play, Plus, Trash2, X } from "lucide-react"
import { useState } from "react"
import { Box } from "@/components/app/box"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { PathText } from "@/components/app/data"
import { type Column, DataTable, SelectionBar } from "@/components/app/data-table"
import { OperationPanel } from "@/components/app/operation-panel"
import { CountBadge, Pill } from "@/components/app/pill"
import { Refusal } from "@/components/app/refusal"
import { type MenuEntry, RowContextMenu } from "@/components/app/row-menu"
import { StatusBadge } from "@/components/app/status"
import { NoteMarker } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { GateLabel, StepRail, useFollowLink } from "@/app/run-ui"
import { openSheet } from "@/app/ui-state"
import {
  formatHours,
  GATE_LABEL,
  goalProgress,
  groupPipeline,
  latestRevision,
  liveAssetIds,
  panelForSession,
  panelLabel,
  planningSite,
  projectCandidates,
  projectGroups,
  projectRuns,
  projectTrash,
  projectWarnings,
  rigCameraKind,
  rigFieldOfView,
  rigName,
  runPipeline,
  runRefresh,
  runStepLink,
  subjectCentre,
  subjectName,
  subjectTarget,
} from "@/domain/derive"
import { qualityBarLabel } from "@/domain/labels"
import { qualityApplicability } from "@/domain/library"
import { bestWindowTonight, defaultCriteria, tonightAt } from "@/domain/planning"
import { BUILT_IN_GOAL_TEMPLATES } from "@/domain/templates"
import type { Catalog, Goal, GoalChannel, MosaicPanel, Project, Run, Session, Subject } from "@/domain/types"
import { formatDec, formatDegrees, formatNight, formatRa, formatTime, plural } from "@/lib/format"
import { addRig, addSubject, applyGoalTemplate, goalsFromTemplate, removeRig, removeSubject, setGoals } from "@/store/actions/projects"
import { completeRun, startRun, trashRun } from "@/store/actions/runs"
import { freshId } from "@/store/actions/shared"
import { type CommitResult, nowIso, type PrototypeState, useStore } from "@/store/core"
import { SelectField } from "@/features/t3/fields"
import { startArchiveTransfer } from "./actions"
import { ChannelChips, DEFAULT_GOAL, GoalKindsFields } from "./goals"
import { projectChannels, restorePlan, sessionLabel, subjectGaps } from "./model"
import { CommitOutcome, SubjectSearch, useCommitError } from "./parts"
import { resolvePick } from "./subject-actions"
import { rememberApproval } from "./trash"

const TH = "py-1 pr-3 text-left text-[0.6875rem] font-medium text-muted-foreground"
const TD = "py-1.5 pr-3 align-top"

/** A native-looking table that fills a flush Box. */
function SimpleTable({ caption, headers, children }: { caption: string; headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-chrome" data-chrome>
          <tr className="border-b border-separator">
            {headers.map((h, i) => (
              <th key={h || i} scope="col" className={`${TH} ${i === 0 ? "pl-3" : ""}`}>
                {h || <span className="sr-only">Actions</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-separator [&>tr:last-child]:border-0 [&>tr:nth-child(even)]:bg-foreground/[0.02] [&>tr>*:first-child]:pl-3">{children}</tbody>
      </table>
    </div>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="px-3 py-2 text-sm text-muted-foreground">{children}</p>

function runsUsing(catalog: Catalog, project: Project, test: (run: Run) => boolean): Run[] {
  return Object.values(catalog.runs).filter((r) => r.projectId === project.id && test(r))
}

/** "used by 6 runs" chips: each run linked to its current step (a trashed one to the Trash). */
function runBlockers(state: PrototypeState, project: Project, reasons: string[]) {
  const runs = Object.values(state.catalog.runs).filter((r) => r.projectId === project.id)
  return reasons.map((reason) => {
    const run = runs.find((r) => reason.startsWith(`${r.name} `))
    if (!run) return { label: reason }
    return { label: run.name, link: run.trashedAt ? { to: "/projects/$projectId/trash", params: { projectId: project.id } } : runStepLink(run, runPipeline(state, run).current.id) }
  })
}

// ---------------------------------------------------------------------------
// Runs and run groups
// ---------------------------------------------------------------------------

type RunDialog = { kind: "complete" | "trash"; run: Run } | null

export function RunsSection({ project }: { project: Project }) {
  const state = useStore((s) => s)
  const follow = useFollowLink()
  const navigate = useNavigate()
  const runs = projectRuns(state.catalog, project.id).filter((r) => !r.groupId)
  const groups = projectGroups(state.catalog, project.id)
  const trashed = projectTrash(state.catalog, project.id).length
  const [dialog, setDialog] = useState<RunDialog>(null)
  const action = useCommitError()
  const open = project.state === "open"
  const pending = dialog ? runPipeline(state, dialog.run) : null
  const openSteps = pending ? pending.steps.slice(0, 5).filter((s) => s.state !== "done") : []

  const menu = (run: Run, step: string): MenuEntry[] => [
    { heading: run.name },
    { label: "Open", icon: Eye, onSelect: () => void navigate({ to: "/projects/$projectId/runs/$runId/$step", params: { projectId: project.id, runId: run.id, step } }) },
    ...(open && run.completion !== "complete" ? [{ label: "Complete…", icon: CheckCheck, onSelect: () => setDialog({ kind: "complete", run }) }] : []),
    ...(open ? [{ separator: true } as const, { label: "Move to Trash…", icon: Trash2, destructive: true, onSelect: () => setDialog({ kind: "trash", run }) }] : []),
  ]

  return (
    <Box
      id="runs"
      level={2}
      flush
      title={
        <span className="flex items-center gap-1.5">
          Runs <CountBadge count={runs.length + groups.length} label={plural(runs.length + groups.length, "run")} />
        </span>
      }
      actions={
        <>
          {trashed > 0 ? (
            <Button size="sm" variant="ghost" render={<Link to="/projects/$projectId/trash" params={{ projectId: project.id }} />}>
              <Trash2 aria-hidden="true" data-icon="inline-start" />
              Trash <CountBadge count={trashed} label={plural(trashed, "trashed run")} />
            </Button>
          ) : null}
          {open ? (
            <Button size="sm" variant="outline" onClick={() => openSheet({ kind: "start-run", projectId: project.id })}>
              <Play aria-hidden="true" data-icon="inline-start" />
              Start run
            </Button>
          ) : null}
        </>
      }
    >
      <CommitOutcome
        result={action.result}
        action={dialog?.kind === "trash" ? "Can't trash run" : "Can't complete run"}
        reason={(n) => plural(n, "blocker")}
        className="border-b border-border px-3 py-2"
      />
      {runs.length === 0 && groups.length === 0 ? (
        <Empty>No runs yet</Empty>
      ) : (
        <ul className="divide-y divide-separator">
          {runs.map((run) => {
            const pipeline = runPipeline(state, run)
            const held = pipeline.blocker ? pipeline.steps.find((s) => s.id === pipeline.blocker!.step) : undefined
            const subject = project.subjects.find((s) => s.id === run.subjectId)
            return (
              <RowContextMenu key={run.id} entries={menu(run, pipeline.current.id)}>
                <li className="grid gap-x-4 gap-y-1 px-3 py-2 lg:grid-cols-[minmax(12rem,1fr)_auto_auto] lg:items-center">
                  <div className="min-w-0">
                    <Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: project.id, runId: run.id, step: pipeline.current.id }} className="font-medium underline-offset-2 hover:underline">
                      {run.name}
                    </Link>
                    <span className="flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                      {subject ? subjectName(state.catalog, subject) : "Unknown subject"} · {rigName(state.catalog, run.rigId)}
                      <StatusBadge kind="run" value={pipeline.status} />
                      {held ? <GateLabel state={held.state} label={`${GATE_LABEL[held.state]} at ${held.label}`} /> : null}
                      {held ? <NoteMarker label={`Why ${run.name} is held`}>{pipeline.blocker!.message}</NoteMarker> : null}
                    </span>
                  </div>
                  <StepRail steps={pipeline.steps} current={pipeline.current.id} label={`Steps of ${run.name}`} />
                  <NextButton next={pipeline.next} onFollow={follow} runName={run.name} />
                </li>
              </RowContextMenu>
            )
          })}
          {groups.map((group) => {
            const pipeline = groupPipeline(state, group)
            const current = pipeline.next?.step ?? pipeline.steps.at(-1)!
            return (
              <li key={group.id} className="space-y-1.5 px-3 py-2">
                <div className="grid gap-x-4 gap-y-1 lg:grid-cols-[minmax(12rem,1fr)_auto_auto] lg:items-center">
                  <div className="min-w-0">
                    <Link to="/projects/$projectId/groups/$groupId/$step" params={{ projectId: project.id, groupId: group.id, step: current.id }} className="font-medium underline-offset-2 hover:underline">
                      {group.name}
                    </Link>
                    <span className="flex flex-wrap items-center gap-1.5 text-[0.6875rem] text-muted-foreground">
                      <Pill tone="info" icon={Layers}>
                        {plural(pipeline.panels.length, "panel")}
                      </Pill>
                      {rigName(state.catalog, group.rigId)}
                    </span>
                  </div>
                  <StepRail steps={pipeline.steps} current={current.id} label={`Steps of ${group.name}`} />
                  <NextButton next={pipeline.next} onFollow={follow} runName={group.name} />
                </div>
                <ul className="ml-3 space-y-1 border-l border-separator pl-3">
                  {pipeline.panels.map((p) =>
                    p.trashed ? (
                      <li key={p.run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                        <span className="w-16 font-medium">{panelLabel(p.panel)}</span>
                        <StatusBadge kind="run" value="trashed" />
                      </li>
                    ) : (
                      <RowContextMenu key={p.run.id} entries={menu(p.run, p.pipeline.current.id)}>
                        <li className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                          <Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: project.id, runId: p.run.id, step: p.pipeline.current.id }} className="w-16 font-medium underline-offset-2 hover:underline">
                            {panelLabel(p.panel)}
                          </Link>
                          <StepRail compact steps={p.pipeline.steps} current={p.pipeline.current.id} label={`Steps of ${p.run.name}`} />
                          <GateLabel state={p.pipeline.current.state} label={`${p.pipeline.current.label}: ${p.pipeline.current.status}`} className="text-muted-foreground" />
                        </li>
                      </RowContextMenu>
                    ),
                  )}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
      <ConfirmDialog
        open={dialog?.kind === "complete"}
        onOpenChange={(next) => !next && setDialog(null)}
        title={`Complete ${dialog?.run.name ?? "run"}?`}
        description="Reopen returns it to its step."
        changes={[`${dialog?.run.name ?? "Run"} → Complete`]}
        unchanged={openSteps.length > 0 ? openSteps.map((s) => `${s.label} stays ${GATE_LABEL[s.state]}`) : undefined}
        confirmLabel="Complete run"
        onConfirm={() => {
          if (dialog) action.run(() => completeRun(dialog.run.id))
        }}
      />
      <ConfirmDialog
        open={dialog?.kind === "trash"}
        onOpenChange={(next) => !next && setDialog(null)}
        title={`Move ${dialog?.run.name ?? "run"} to Trash?`}
        description="Restore brings it back as it was."
        changes={[`${dialog?.run.name ?? "Run"} → Project Trash`, "Its members stop counting toward goals"]}
        confirmLabel="Move to Trash"
        tone="destructive"
        onConfirm={() => {
          if (dialog) action.run(() => trashRun(dialog.run.id))
        }}
      />
    </Box>
  )
}

function NextButton({ next, onFollow, runName }: { next: ReturnType<typeof runPipeline>["next"]; onFollow: (link: NonNullable<ReturnType<typeof runPipeline>["next"]>["link"]) => void; runName: string }) {
  if (!next) return <span className="text-xs text-muted-foreground">–</span>
  return (
    <Button size="sm" variant="outline" title={next.reason} onClick={() => onFollow(next.link)}>
      {next.label}
      <span className="sr-only"> for {runName}</span>
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Candidates: review frames, start a run from a selection
// ---------------------------------------------------------------------------

function unreviewed(catalog: Catalog, session: Session): number {
  return liveAssetIds(catalog, session).filter((id) => {
    const asset = catalog.assets[id]
    return asset ? asset.quality.value === "unreviewed" && qualityApplicability(asset) === "applicable" : false
  }).length
}

export type CandidateFilter = "all" | "unreviewed" | "ready"

interface CandidateRow {
  session: Session
  subject: Subject
  rigId: string
  placement: string | null
  frames: number
  unreviewed: number
  runs: string[]
  firstAssetId: string | null
}

function candidateRows(state: PrototypeState, project: Project): CandidateRow[] {
  const { catalog } = state
  const runs = projectRuns(catalog, project.id)
  return projectCandidates(catalog, project).map((c) => {
    const placed = c.subject.mosaic ? panelForSession(catalog, c.subject, c.session, c.rigId) : null
    const panel = placed?.panelId ? c.subject.mosaic?.panels.find((p) => p.id === placed.panelId) : undefined
    const assets = liveAssetIds(catalog, c.session)
    return {
      session: c.session,
      subject: c.subject,
      rigId: c.rigId,
      placement: placed ? (panel ? panelLabel(panel) : placed.flag === "ambiguous" ? "Ambiguous" : placed.flag === "off-panel" ? "Off panel" : "No pointing") : null,
      frames: assets.length,
      unreviewed: unreviewed(catalog, c.session),
      runs: runs.filter((r) => latestRevision(r)?.sessions.some((m) => m.sessionId === c.session.id)).map((r) => r.name),
      firstAssetId: assets[0] ?? null,
    }
  })
}

const FILTERS: Array<[CandidateFilter, string]> = [
  ["all", "All"],
  ["unreviewed", "Unreviewed"],
  ["ready", "Not in a run"],
]

export function CandidatesSection({ project }: { project: Project }) {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<CandidateFilter>("all")
  const [selected, setSelected] = useState<string[]>([])
  const [refusal, setRefusal] = useState<{ action: string; reason: string; blockers: Array<{ label: string }> } | null>(null)
  const start = useCommitError()
  const rows = useStore((s) => candidateRows(s, project))
  const catalog = useStore((s) => s.catalog)
  const flagged = useStore((s) =>
    projectRuns(s.catalog, project.id).flatMap((run) => runRefresh(s.catalog, run).noLongerMatching.map((sessionId) => ({ run, session: s.catalog.sessions[sessionId] }))),
  )
  const shown = rows.filter((r) => (filter === "unreviewed" ? r.unreviewed > 0 : filter === "ready" ? r.runs.length === 0 : true))
  const unreviewedFrames = rows.reduce((n, r) => n + r.unreviewed, 0)
  const ready = rows.filter((r) => r.runs.length === 0).length
  const open = project.state === "open"
  const live = selected.filter((id) => rows.some((r) => r.session.id === id))

  const review = (assetId?: string | null) =>
    void navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: { candidates: unreviewedFrames > 0 && !assetId ? "unreviewed" : "all", ...(assetId ? { filter: "all", assetId } : {}) } })

  function startFrom(ids: string[]) {
    setRefusal(null)
    const picked = rows.filter((r) => ids.includes(r.session.id))
    const combos = [...new Map(picked.map((r) => [`${r.subject.id}|${r.rigId}`, r])).values()]
    if (combos.length !== 1) {
      setRefusal({ action: "Can't start run", reason: `${combos.length} subject and rig pairs`, blockers: combos.map((r) => ({ label: `${subjectName(catalog, r.subject)} · ${rigName(catalog, r.rigId)}` })) })
      return
    }
    const { subject, rigId } = combos[0]!
    if (subject.mosaic) {
      void navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: { mosaic: subject.id, rig: rigId, sessions: ids.join(",") } })
      return
    }
    const outcome = startRun(project.id, subject.id, rigId, { sessionIds: ids })
    start.run(() => outcome.result)
    if (outcome.runId) {
      setSelected([])
      void navigate({ to: "/projects/$projectId/runs/$runId/$step", params: { projectId: project.id, runId: outcome.runId, step: "select" } })
    }
  }

  const columns: Column<CandidateRow>[] = [
    {
      id: "session",
      header: "Session",
      rowHeader: true,
      sortValue: (r) => r.session.night,
      cell: (r) => (
        <Link to="/sessions/$sessionId" params={{ sessionId: r.session.id }} className="font-medium whitespace-nowrap underline-offset-2 hover:underline">
          {formatNight(r.session.night)} · {r.session.channel ?? "No filter"}
        </Link>
      ),
    },
    {
      id: "subject",
      header: "Subject",
      sortValue: (r) => subjectName(catalog, r.subject),
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          {subjectName(catalog, r.subject)}
          {r.placement ? <Pill tone={r.placement.startsWith("Panel") ? "muted" : "warning"}>{r.placement}</Pill> : null}
        </span>
      ),
    },
    { id: "rig", header: "Rig", cell: (r) => rigName(catalog, r.rigId), truncate: true },
    { id: "frames", header: "Frames", align: "right", sortValue: (r) => r.frames, cell: (r) => <span className="tabular-nums">{r.frames}</span> },
    {
      id: "unreviewed",
      header: "Unreviewed",
      align: "right",
      sortValue: (r) => r.unreviewed,
      cell: (r) => (r.unreviewed > 0 ? <CountBadge count={r.unreviewed} tone="warning" label={`${r.unreviewed} unreviewed`} /> : <span className="text-muted-foreground">0</span>),
    },
    { id: "runs", header: "In run", cell: (r) => (r.runs.length > 0 ? <span className="text-xs">{r.runs.join(", ")}</span> : <Pill tone="info">Ready</Pill>) },
  ]

  const menu = (r: CandidateRow): MenuEntry[] => {
    const ids = live.includes(r.session.id) && live.length > 1 ? live : [r.session.id]
    return [
      { heading: ids.length > 1 ? plural(ids.length, "session") : `${formatNight(r.session.night)} · ${r.session.channel ?? "No filter"}` },
      { label: "Review frames", icon: Eye, onSelect: () => review(r.firstAssetId) },
      ...(open ? [{ label: ids.length > 1 ? `Start run (${ids.length})` : "Start run", icon: Play, onSelect: () => startFrom(ids) }] : []),
      { separator: true },
      { label: "Open session", onSelect: () => void navigate({ to: "/sessions/$sessionId", params: { sessionId: r.session.id } }) },
    ]
  }

  return (
    <Box
      id="candidates"
      level={2}
      flush
      title={
        <span className="flex items-center gap-1.5">
          Candidates <CountBadge count={rows.length} label={plural(rows.length, "session")} />
        </span>
      }
      actions={
        rows.length > 0 ? (
          <>
            {ready > 0 ? <Pill tone="info">{ready} ready</Pill> : null}
            <Button size="sm" variant="outline" onClick={() => review()}>
              <Eye aria-hidden="true" data-icon="inline-start" />
              Review frames
              {unreviewedFrames > 0 ? <CountBadge count={unreviewedFrames} tone="warning" label={`${unreviewedFrames} unreviewed`} /> : null}
            </Button>
          </>
        ) : null
      }
    >
      {flagged.length > 0 ? (
        <div className="border-b border-border px-3 py-2">
          <Refusal
            action={`${plural(flagged.length, "member")} no longer match`}
            reason="subject changed"
            blockers={flagged.map(({ run, session }) => ({ label: `${session ? sessionLabel(catalog, session) : "Session"} · ${run.name}`, link: runStepLink(run, "select") }))}
          />
        </div>
      ) : null}
      {rows.length === 0 ? (
        <Empty>No candidates</Empty>
      ) : (
        <div className="space-y-2 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1" role="group" aria-label="Candidates filter">
              {FILTERS.map(([value, label]) => (
                <Button key={value} size="sm" variant={filter === value ? "secondary" : "ghost"} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                  {label}
                </Button>
              ))}
            </div>
            {live.length > 0 ? (
              <SelectionBar
                count={live.length}
                noun="session"
                onClear={() => setSelected([])}
                actions={
                  open ? (
                    <Button size="sm" onClick={() => startFrom(live)}>
                      <Play aria-hidden="true" data-icon="inline-start" />
                      Start run
                    </Button>
                  ) : null
                }
              />
            ) : null}
          </div>
          {refusal ? <Refusal {...refusal} /> : null}
          <CommitOutcome result={start.result} action="Can't start run" />
          <DataTable
            label={`Candidate sessions of ${project.name}`}
            rows={shown}
            columns={columns}
            getRowId={(r) => r.session.id}
            selection={open ? { selected: live, onChange: setSelected, rowLabel: (r) => sessionLabel(catalog, r.session) } : undefined}
            contextMenu={menu}
            scroll="none"
            empty={<Empty>{filter === "unreviewed" ? "None unreviewed" : "Every candidate is in a run"}</Empty>}
          />
        </div>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Goals: structured kinds and channel chips (D-W29, D-W30)
// ---------------------------------------------------------------------------

function kindsLine(goal: Pick<Goal, "integrationS" | "frameCount" | "qualityBar">): string {
  const parts = [goal.integrationS !== null ? formatHours(goal.integrationS) : null, goal.frameCount !== null ? plural(goal.frameCount, "frame") : null, goal.qualityBar ? qualityBarLabel(goal.qualityBar) : null].filter(Boolean)
  return parts.join(" · ") || "No target"
}

/** What applying a template changes, grouped by channel and change: "Ha 10h → 15h · 4 goals". Unchanged goals are not listed. */
export function templateChanges(project: Project, next: Goal[]): string[] {
  const key = (g: Goal) => `${g.subjectId}|${g.panelId ?? ""}|${g.channel}`
  const before = new Map(project.goals.map((g) => [key(g), g]))
  const after = new Map(next.map((g) => [key(g), g]))
  const counts = new Map<string, number>()
  const bump = (line: string) => counts.set(line, (counts.get(line) ?? 0) + 1)
  for (const [k, g] of after) {
    const old = before.get(k)
    if (!old) bump(`+ ${g.channel} ${kindsLine(g)}`)
    else if (kindsLine(old) !== kindsLine(g)) bump(`${g.channel} ${kindsLine(old)} → ${kindsLine(g)}`)
  }
  for (const [k, g] of before) if (!after.has(k)) bump(`− ${g.channel} ${kindsLine(g)}`)
  return [...counts].map(([line, n]) => (n > 1 ? `${line} · ${plural(n, "goal")}` : line))
}

export function GoalsSection({ project }: { project: Project }) {
  const catalog = useStore((s) => s.catalog)
  const progress = useStore((s) => goalProgress(s.catalog, project))
  const warnings = useStore((s) => projectWarnings(s.disk, s.catalog, project))
  const channels = projectChannels(catalog, project.rigIds)
  const [editing, setEditing] = useState<Goal[] | null>(null)
  const [templateId, setTemplateId] = useState(BUILT_IN_GOAL_TEMPLATES[0]!.id)
  const save = useCommitError()
  const templates = [...BUILT_IN_GOAL_TEMPLATES, ...Object.values(catalog.goalTemplates)]
  const template = templates.find((t) => t.id === templateId)
  const editable = project.state === "open"
  const groups = project.subjects.flatMap<{ subject: Subject; panel: MosaicPanel | null }>((subject) =>
    subject.mosaic ? subject.mosaic.panels.map((p) => ({ subject, panel: p })) : [{ subject, panel: null }],
  )
  const preview = template ? templateChanges(project, project.subjects.flatMap((s) => goalsFromTemplate(template, s))) : []

  const edit = (id: string, patch: Partial<Goal>) => setEditing((list) => list?.map((g) => (g.id === id ? { ...g, ...patch } : g)) ?? null)

  return (
    <Box
      id="goals"
      level={2}
      title="Goals"
      actions={
        editable ? (
          editing ? (
            <>
              <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button size="sm" onClick={() => save.run(() => setGoals(project.id, editing, project.revision)) && setEditing(null)}>
                Save goals
              </Button>
            </>
          ) : (
            <>
              <SelectField className="w-44 [&>label]:sr-only" label="Goal template" value={templateId} onChange={setTemplateId} options={templates.map((t) => ({ value: t.id, label: t.name }))} />
              <ConfirmDialog
                trigger={
                  <Button size="sm" variant="ghost">
                    Apply
                  </Button>
                }
                title={`Apply ${template?.name ?? "template"}?`}
                description="Values are copied in and stay editable."
                changes={preview.length > 0 ? preview : ["No goal changes"]}
                confirmLabel="Apply template"
                onConfirm={() => applyGoalTemplate(project.id, templateId, project.revision)}
              />
              <Button size="sm" variant="outline" onClick={() => setEditing(project.goals.map((g) => ({ ...g })))}>
                <Pencil aria-hidden="true" data-icon="inline-start" />
                Edit
              </Button>
            </>
          )
        ) : null
      }
    >
      <div className="space-y-3">
        <CommitOutcome result={save.result} action="Can't save goals" />
        {groups.length === 0 ? <p className="text-sm text-muted-foreground">No subjects</p> : null}
        {groups.map(({ subject, panel }) => {
          const rows = (editing ?? project.goals).filter((g) => g.subjectId === subject.id && (g.panelId ?? null) === (panel?.id ?? null))
          return (
            <div key={`${subject.id}|${panel?.id ?? ""}`} className="space-y-1">
              <h3 className="flex items-center gap-1.5 text-sm font-medium">
                {subjectName(catalog, subject)}
                {panel ? <Pill tone="muted">{panelLabel(panel)}</Pill> : null}
              </h3>
              {rows.length === 0 && !editing ? <p className="text-xs text-muted-foreground">No goals</p> : null}
              {rows.length > 0 ? (
                <ul className="divide-y divide-separator rounded-md border border-border">
                  {rows.map((goal) => {
                    const p = progress.find((x) => x.goal.id === goal.id)
                    const rowWarnings = panel ? [] : warnings.filter((w) => w.subjectId === subject.id && w.channel === goal.channel)
                    return (
                      <li key={goal.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-sm">
                        <Pill tone="info">{goal.channel}</Pill>
                        {editing ? (
                          <>
                            <GoalKindsFields channel={goal.channel} value={goal} onChange={(patch) => edit(goal.id, patch)} />
                            <Button size="icon-sm" variant="ghost" className="ml-auto" aria-label={`Remove ${goal.channel} goal`} onClick={() => setEditing((list) => list?.filter((g) => g.id !== goal.id) ?? null)}>
                              <X aria-hidden="true" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <span className="min-w-0 flex-1 tabular-nums">{p?.line.replace(new RegExp(`^${goal.channel} `), "") ?? kindsLine(goal)}</span>
                            {goal.qualityBar ? <Pill tone="muted">{qualityBarLabel(goal.qualityBar)}</Pill> : null}
                            {p && p.unknownQuality > 0 ? <NoteMarker label="Unmeasured members">{plural(p.unknownQuality, "member")} unmeasured · not counted</NoteMarker> : null}
                            {rowWarnings.map((w) => (
                              <Pill key={w.message} tone="warning" title={w.message}>
                                {w.kind === "exposure-mismatch" ? "Exposure mismatch" : "Missing calibration"}
                              </Pill>
                            ))}
                            {p?.met ? (
                              <Pill tone="success">Met</Pill>
                            ) : p && p.remainingS !== null ? (
                              <span className="text-xs text-muted-foreground tabular-nums">{formatHours(p.remainingS)} to go</span>
                            ) : null}
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              ) : null}
              {editing ? (
                <ChannelChips
                  label={`Add goal for ${subjectName(catalog, subject)}${panel ? ` ${panelLabel(panel)}` : ""}`}
                  channels={channels}
                  taken={rows.map((g) => g.channel)}
                  onAdd={(channel: GoalChannel) =>
                    setEditing((list) => [...(list ?? []), { id: freshId("goal", `${subject.id}|${panel?.id ?? ""}|${channel}`), subjectId: subject.id, panelId: panel?.id ?? null, channel, ...DEFAULT_GOAL }])
                  }
                />
              ) : null}
            </div>
          )
        })}
      </div>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Subjects (with the mosaic editor)
// ---------------------------------------------------------------------------

export function SubjectsSection({ project }: { project: Project }) {
  const state = useStore((s) => s)
  const catalog = state.catalog
  const navigate = useNavigate()
  const remove = useCommitError()
  const add = useCommitError()
  const [adding, setAdding] = useState(false)
  const editable = project.state === "open"
  const mosaicLink = (subjectId: string) => void navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: { mosaic: subjectId } })

  const menu = (subject: Subject): MenuEntry[] => {
    const target = subjectTarget(catalog, subject)
    return [
      { heading: subjectName(catalog, subject) },
      ...(target ? [{ label: "Open Target", onSelect: () => void navigate({ to: "/targets/$targetId", params: { targetId: target.id } }) }] : []),
      ...(editable ? [{ label: subject.mosaic ? "Start mosaic run" : "Make mosaic", icon: Grid2x2Plus, onSelect: () => mosaicLink(subject.id) }] : []),
      ...(editable ? [{ separator: true } as const, { label: "Remove", icon: X, destructive: true, onSelect: () => remove.run(() => removeSubject(project.id, subject.id, project.revision)) }] : []),
    ]
  }

  return (
    <Box
      id="subjects"
      level={2}
      flush
      title={
        <span className="flex items-center gap-1.5">
          Subjects <CountBadge count={project.subjects.length} label={plural(project.subjects.length, "subject")} />
        </span>
      }
      actions={
        editable && !adding ? (
          <>
            <Button size="sm" variant="ghost" onClick={() => mosaicLink("new")}>
              <Grid2x2Plus aria-hidden="true" data-icon="inline-start" />
              New mosaic
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
              <Plus aria-hidden="true" data-icon="inline-start" />
              Add
            </Button>
          </>
        ) : null
      }
    >
      <CommitOutcome result={remove.result} action="Can't remove subject" reason={(n) => `used by ${plural(n, "run")}`} blockers={(reasons) => runBlockers(state, project, reasons)} className="border-b border-border px-3 py-2" />
      {adding ? (
        <div className="space-y-2 border-b border-border p-3">
          <SubjectSearch
            autoFocus
            taken={project.subjects.map((s) => subjectTarget(catalog, s)?.name ?? "")}
            onPick={(pick) => {
              const resolved = resolvePick(pick)
              if (!resolved.ok) {
                add.setError(resolved.message)
                return
              }
              if (add.run(() => addSubject(project.id, { targetId: resolved.targetId, mosaic: null }, project.revision))) setAdding(false)
            }}
          />
          <CommitOutcome result={add.result} action="Can't add subject" />
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Cancel
          </Button>
        </div>
      ) : null}
      {project.subjects.length === 0 ? (
        <Empty>No subjects</Empty>
      ) : (
        <SimpleTable caption={`Subjects of ${project.name}`} headers={["Subject", "Kind", "Centre", "Runs"]}>
          {project.subjects.map((subject) => {
            const target = subjectTarget(catalog, subject)
            const centre = subjectCentre(catalog, subject)
            const users = runsUsing(catalog, project, (r) => r.subjectId === subject.id && !r.trashedAt)
            return (
              <RowContextMenu key={subject.id} entries={menu(subject)}>
                <tr>
                  <th scope="row" className={`${TD} text-left font-medium`}>
                    {target ? (
                      <Link to="/targets/$targetId" params={{ targetId: target.id }} className="underline-offset-2 hover:underline">
                        {subjectName(catalog, subject)}
                      </Link>
                    ) : (
                      subjectName(catalog, subject)
                    )}
                  </th>
                  <td className={TD}>
                    {subject.mosaic ? (
                      <button type="button" className="rounded-full" onClick={() => editable && mosaicLink(subject.id)} disabled={!editable} aria-label={`Mosaic of ${plural(subject.mosaic.panels.length, "panel")}: start mosaic run`}>
                        <Pill tone="info" icon={Grid2x2Plus}>
                          {plural(subject.mosaic.panels.length, "panel")}
                        </Pill>
                      </button>
                    ) : (
                      <Pill tone="muted">Target</Pill>
                    )}
                  </td>
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>{centre ? `${formatRa(centre.ra)} ${formatDec(centre.dec)}` : "–"}</td>
                  <td className={`${TD} tabular-nums`}>{users.length}</td>
                </tr>
              </RowContextMenu>
            )
          })}
        </SimpleTable>
      )}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Rigs
// ---------------------------------------------------------------------------

export function RigsSection({ project }: { project: Project }) {
  const state = useStore((s) => s)
  const catalog = state.catalog
  const navigate = useNavigate()
  const candidates = projectCandidates(catalog, project)
  const remove = useCommitError()
  const add = useCommitError()
  const [choice, setChoice] = useState("")
  const editable = project.state === "open"
  const others = Object.values(catalog.opticalTrains).filter((r) => !project.rigIds.includes(r.id))
  const chosen = others.find((r) => r.id === choice) ?? others[0]

  const menu = (id: string): MenuEntry[] => [
    { heading: rigName(catalog, id) },
    { label: "Open in Equipment", onSelect: () => void navigate({ to: "/settings/equipment" as never }) },
    ...(editable ? [{ separator: true } as const, { label: "Remove", icon: X, destructive: true, onSelect: () => remove.run(() => removeRig(project.id, id, project.revision)) }] : []),
  ]

  return (
    <Box
      id="rigs"
      level={2}
      flush
      title={
        <span className="flex items-center gap-1.5">
          Rigs <CountBadge count={project.rigIds.length} label={plural(project.rigIds.length, "rig")} />
        </span>
      }
    >
      <CommitOutcome result={remove.result} action="Can't remove rig" reason={(n) => `used by ${plural(n, "run")}`} blockers={(reasons) => runBlockers(state, project, reasons)} className="border-b border-border px-3 py-2" />
      {project.rigIds.length === 0 ? (
        <Empty>No rigs</Empty>
      ) : (
        <SimpleTable caption={`Rigs of ${project.name}`} headers={["Rig", "Camera", "Channels", "Field", "Candidates"]}>
          {project.rigIds.map((id) => {
            const rig = catalog.opticalTrains[id]
            const fov = rig ? rigFieldOfView(catalog, rig) : null
            const kind = rig ? rigCameraKind(catalog, rig) : null
            const chips = projectChannels(catalog, [id])
            return (
              <RowContextMenu key={id} entries={menu(id)}>
                <tr>
                  <th scope="row" className={`${TD} text-left font-medium`}>
                    {rigName(catalog, id)}
                  </th>
                  <td className={TD}>
                    <Pill tone="muted">{kind === "osc" ? "OSC" : kind === "mono" ? "Mono" : "Unknown"}</Pill>
                  </td>
                  <td className={TD}>
                    <span className="flex flex-wrap gap-1">
                      {chips.length > 0 ? chips.map((c) => <Pill key={c}>{c}</Pill>) : "–"}
                    </span>
                  </td>
                  <td className={`${TD} whitespace-nowrap tabular-nums`}>{fov ? `${formatDegrees(fov.widthDeg, 2)} × ${formatDegrees(fov.heightDeg, 2)}` : "–"}</td>
                  <td className={`${TD} tabular-nums`}>{candidates.filter((c) => c.rigId === id).length}</td>
                </tr>
              </RowContextMenu>
            )
          })}
        </SimpleTable>
      )}
      {editable && chosen ? (
        <div className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
          <SelectField className="min-w-0 flex-1 [&>label]:sr-only" label="Add a rig" value={chosen.id} onChange={setChoice} options={others.map((r) => ({ value: r.id, label: r.name }))} />
          <Button size="sm" variant="outline" onClick={() => add.run(() => addRig(project.id, chosen.id, project.revision))}>
            <Plus aria-hidden="true" data-icon="inline-start" />
            Add rig
          </Button>
          <CommitOutcome result={add.result} action="Can't add rig" className="basis-full" />
        </div>
      ) : null}
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Planning for its subjects (D-W16, D-W63)
// ---------------------------------------------------------------------------

export function PlanningSection({ project }: { project: Project }) {
  const state = useStore((s) => s)
  const site = planningSite(state)
  const now = Date.parse(nowIso())
  const tonight = site ? tonightAt(site, now) : null
  return (
    <Box
      id="planning"
      level={2}
      flush
      title={
        <span className="flex flex-wrap items-center gap-1.5">
          Tonight
          {site && tonight ? (
            <>
              <Pill tone="muted">{site.name}</Pill>
              <Pill tone="muted">Moon {Math.round(tonight.moon.illuminationPct)}%</Pill>
              <Pill tone={tonight.darkness ? "muted" : "warning"}>
                {tonight.darkness ? `Dark ${formatTime(tonight.darkness.start, site.timeZone)}–${formatTime(tonight.darkness.end, site.timeZone)}` : "No darkness"}
              </Pill>
            </>
          ) : null}
        </span>
      }
      actions={
        <Button size="sm" variant="outline" render={<Link to="/plan" search={{ project: project.id }} />}>
          Planner
        </Button>
      }
    >
      {!site || !tonight ? (
        <div className="border-b border-border px-3 py-2">
          <Refusal action="No windows" reason="no observing site" blockers={[{ label: "Settings › Sites", link: { to: "/settings/sites" } }]} />
        </div>
      ) : null}
      <SimpleTable caption={`Planning for the subjects of ${project.name}`} headers={["Subject", "Best window", "To go"]}>
        {project.subjects.map((subject) => {
          const target = subjectTarget(state.catalog, subject)
          const centre = subjectCentre(state.catalog, subject)
          const window = site && target && centre ? bestWindowTonight({ ...target, ra: centre.ra, dec: centre.dec }, site, defaultCriteria(site), now) : null
          const gaps = subjectGaps(state.catalog, project, subject).filter((g) => !g.met)
          return (
            <tr key={subject.id}>
              <th scope="row" className={`${TD} text-left font-medium`}>
                {subjectName(state.catalog, subject)}
              </th>
              <td className={`${TD} tabular-nums`}>
                {!site || !centre ? (
                  "–"
                ) : window ? (
                  <span className="inline-flex items-center gap-1.5">
                    {formatTime(window.start, site.timeZone)}–{formatTime(window.end, site.timeZone)}
                    <Pill tone="muted">{Math.round(window.maxAltitudeDeg)}°</Pill>
                    <Pill tone="muted">Moon {Math.round(window.moonSeparationDeg)}°</Pill>
                  </span>
                ) : (
                  <span className="text-muted-foreground">None tonight</span>
                )}
              </td>
              <td className={TD}>
                {gaps.length === 0 ? (
                  "–"
                ) : (
                  <span className="flex flex-wrap gap-1">
                    {gaps.map((gap) => (
                      <Pill key={`${gap.panelId}|${gap.channel}`} tone="neutral" title={gap.line}>
                        {gap.panelId ? `P${subject.mosaic?.panels.find((p) => p.id === gap.panelId)?.n ?? "?"} · ` : ""}
                        {gap.line.replace(/ to go in project.*$/, "")}
                      </Pill>
                    ))}
                  </span>
                )}
              </td>
            </tr>
          )
        })}
      </SimpleTable>
    </Box>
  )
}

// ---------------------------------------------------------------------------
// Archived sessions (D-W69)
// ---------------------------------------------------------------------------

export function ArchivedSection({ project }: { project: Project }) {
  const catalog = useStore((s) => s.catalog)
  const origins = useStore((s) => s.slices.b.archiveOrigins)
  const operationId = useStore((s) => s.slices.b.approvals[project.id]?.restore ?? null)
  const ids = project.archive?.sessionIds ?? []
  const [chosen, setChosen] = useState<string[]>([])
  const live = chosen.filter((id) => ids.includes(id))
  const plan = useStore((s) => restorePlan(s, project, origins, live))
  if (ids.length === 0 && !operationId) return null
  const open = project.state === "open"
  return (
    <Box
      id="archived"
      level={2}
      flush
      title={
        <span className="flex items-center gap-1.5">
          Archived <CountBadge count={ids.length} label={plural(ids.length, "session")} />
        </span>
      }
      actions={
        open && live.length > 0 ? (
          <ConfirmDialog
            trigger={<Button size="sm">Restore ({live.length})…</Button>}
            title={`Restore ${plural(live.length, "session")}?`}
            description="Back to where Archive found each frame."
            changes={[
              ...plan.rows.map((r) => `${sessionLabel(catalog, r.session)} → ${r.folder}`),
              ...plan.refused.map((r) => `${sessionLabel(catalog, r.session)} stays · ${r.reason}`),
            ]}
            confirmLabel="Restore"
            onConfirm={(): CommitResult => {
              if (plan.rows.length === 0) return { ok: false, reason: "refused", message: plan.blocked ?? "Nothing chosen can be restored now.", reasons: [] }
              rememberApproval(project.id, "restore", startArchiveTransfer(project.id, plan.rows, "restore"))
              setChosen([])
              return { ok: true }
            }}
          />
        ) : null
      }
    >
      {ids.length > 0 ? (
        <SimpleTable caption={`Archived sessions of ${project.name}`} headers={[open ? "Restore" : "", "Session", "Archive path"]}>
          {ids.map((id) => {
            const session = catalog.sessions[id]
            if (!session) return null
            const first = liveAssetIds(catalog, session).map((a) => catalog.assets[a]).find((a) => a !== undefined)
            const path = first?.copies.find((c) => catalog.locations[c.locationId]?.role === "archive")?.path ?? first?.copies[0]?.path ?? ""
            return (
              <tr key={id}>
                <td className={TD}>
                  {open ? <Checkbox aria-label={`Restore ${sessionLabel(catalog, session)}`} checked={live.includes(id)} onCheckedChange={(checked) => setChosen((list) => (checked ? [...list, id] : list.filter((x) => x !== id)))} /> : null}
                </td>
                <th scope="row" className={`${TD} text-left font-medium`}>
                  <Link to="/sessions/$sessionId" params={{ sessionId: id }} className="underline-offset-2 hover:underline">
                    {sessionLabel(catalog, session)}
                  </Link>
                </th>
                <td className={TD}>
                  <PathText path={path.split("/").slice(0, -1).join("/")} />
                </td>
              </tr>
            )
          })}
        </SimpleTable>
      ) : null}
      {operationId ? (
        <div className="p-3">
          <OperationPanel operationId={operationId} headingLevel={3} />
        </div>
      ) : null}
    </Box>
  )
}
