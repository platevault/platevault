/**
 * S3 Project sections (slice B; DetailPage sections, each a Box holding a
 * BoxTable or a KeyValueList): runs and run groups first, then the Ready
 * candidates, goals, subjects (with the C7 progress: weakest panel, panel
 * balance, channel ratio and nights left), rigs, tonight's planning and the
 * archived sessions. Every edit goes through a foundation store action; a
 * refusal shows beside the action that was refused. A closed Project is
 * read-only (§5.6): its sections keep their Open and Restore actions only.
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { Crosshair, Eye, Grid2x2Plus, Pencil, Plus, RotateCcw, Trash2, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/app/run-ui"
import { BoxTable } from "@/components/app/box"
import type { Action, Column, FileRow, MenuItem } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { SelectField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { TargetPicker } from "@/components/app/pickers"
import { Refusal } from "@/components/app/refusal"
import { StatusBadge } from "@/components/app/status"
import type { DetailSection } from "@/components/templates/detail-page"
import {
  type GoalProgress,
  type GroupPanelState,
  type GroupPipeline,
  groupPipeline,
  groupStepLink,
  groupUpdatedAt,
  latestRevision,
  liveAssetIds,
  panelForSession,
  panelLabel,
  planningSite,
  projectCandidates,
  projectGroups,
  projectRuns,
  projectSessionsNeedingReview,
  projectTrash,
  rigCameraKind,
  rigFieldOfView,
  rigName,
  type RunState,
  runPipeline,
  runStatus,
  runStepLink,
  runUpdatedAt,
  sessionIntakeLink,
  sessionUnreviewedFrames,
  type StepLink,
  type SubjectProgress,
  subjectCentre,
  subjectName,
  subjectProgress,
  subjectTarget,
} from "@/domain/derive"
import { STEP_NAME } from "@/domain/labels"
import { bestWindowTonight, defaultCriteria, tonightAt, upcomingNight } from "@/domain/planning"
import type { Catalog, Goal, OpticalTrainId, Project, Run, RunGroup, Session, Subject } from "@/domain/types"
import { formatCount, formatDateTime, formatDegrees, formatNight, formatTime } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { restorePlan } from "@/domain/archive"
import { startArchiveTransfer } from "@/store/actions/archive"
import { addRig, addSubject, applyGoalTemplate, changeSubjectTarget, removeRig, removeSubject, rigRuns, setGoals } from "@/store/actions/projects"
import { trashRun } from "@/store/actions/runs"
import { freshId } from "@/store/actions/shared"
import { type CommitResult, nowIso, type PrototypeState, useStore } from "@/store/core"
import { DEFAULT_GOAL, type GoalKinds, GoalKindsFields, goalKindsError, kindsLine } from "./goals"
import { goalTemplates, projectChannels, templateChanges } from "./model"
import { type SubjectPick, useTargetSearch } from "./parts"
import { StartRunDialog } from "./start-run"
import { resolvePick } from "./subject-actions"

/** A run's state as its one badge (C2: a finished run reads Finished). */
function RunBadge({ state }: { state: RunState }) {
  const m = useMessages()
  if (state === "complete") return <StatusBadge kind="run" value="complete" label={m.status_finished()} />
  if (state === "trashed") return <StatusBadge kind="run" value="trashed" />
  return <StatusBadge kind="gate" value={state} />
}

const trashLink = (project: Project): StepLink => ({ to: "/projects/$projectId/trash", params: { projectId: project.id } })

function subjectLabel(m: Messages, catalog: Catalog, project: Project, subjectId: string, panelId: string | null = null): string {
  const subject = project.subjects.find((s) => s.id === subjectId)
  if (!subject) return m.project_unknown_subject()
  const panel = panelId ? subject.mosaic?.panels.find((p) => p.id === panelId) : undefined
  return panel ? `${subjectName(m, catalog, subject)} · ${panelLabel(m, panel)}` : subjectName(m, catalog, subject)
}

function sessionLine(m: Messages, session: Session): string {
  return `${formatNight(session.night)} · ${session.channel ?? m.palette_session_no_filter()}`
}

// ---------------------------------------------------------------------------
// Runs and run groups
// ---------------------------------------------------------------------------

type RunsRow = { kind: "run"; id: string; run: Run; state: RunState; step: string; updatedAt: string } | { kind: "group"; id: string; group: RunGroup; pipeline: GroupPipeline; updatedAt: string }

function runsRows(state: PrototypeState, project: Project): RunsRow[] {
  const runs = projectRuns(state.catalog, project.id)
    .filter((r) => !r.groupId)
    .map((run): RunsRow => {
      const status = runStatus(runPipeline(state, run))
      return { kind: "run", id: run.id, run, state: status.state, step: status.step, updatedAt: runUpdatedAt(state.catalog, run) }
    })
  const groups = projectGroups(state.catalog, project.id).map((group): RunsRow => ({ kind: "group", id: group.id, group, pipeline: groupPipeline(state, group), updatedAt: groupUpdatedAt(state.catalog, group) }))
  const createdAt = (row: RunsRow) => (row.kind === "run" ? row.run.createdAt : row.group.createdAt)
  return [...runs, ...groups].sort((a, b) => createdAt(a).localeCompare(createdAt(b)))
}

/** The Runs section: single runs and run groups in one table, oldest first; a group expands to its panels (round 5). */
export function useRunsSection(project: Project): DetailSection {
  const m = useMessages()
  const follow = useFollowLink()
  const catalog = useStore((s) => s.catalog)
  const rows = useStore((s) => runsRows(s, project))
  const trashed = useStore((s) => projectTrash(s.catalog, project.id).length)
  const open = project.state === "open"

  const linkOf = (row: RunsRow): StepLink => (row.kind === "run" ? runStepLink(row.run, row.step as Run["stageBeforeComplete"] & string) : groupStepLink(row.group, row.pipeline.status.step))
  const name = (row: RunsRow) => (row.kind === "run" ? row.run.name : row.group.name)
  const stepOf = (row: RunsRow) => say(m, STEP_NAME[row.kind === "run" ? (row.step as keyof typeof STEP_NAME) : row.pipeline.status.step])
  const columns: Column<RunsRow>[] = [
    { id: "name", header: m.newproject_field_name(), cell: name, sortValue: name, rowHeader: true, truncate: true },
    { id: "subject", header: m.project_col_subject(), cell: (r) => subjectLabel(m, catalog, project, r.kind === "run" ? r.run.subjectId : r.group.subjectId), sortValue: (r) => subjectLabel(m, catalog, project, r.kind === "run" ? r.run.subjectId : r.group.subjectId), truncate: true },
    { id: "rig", header: m.project_col_rig(), cell: (r) => rigName(m, catalog, r.kind === "run" ? r.run.rigId : r.group.rigId), sortValue: (r) => rigName(m, catalog, r.kind === "run" ? r.run.rigId : r.group.rigId), truncate: true },
    { id: "step", header: m.project_col_step(), cell: stepOf, sortValue: stepOf },
    { id: "status", header: m.rungroup_col_status(), cell: (r) => <RunBadge state={r.kind === "run" ? r.state : r.pipeline.status.state} />, sortValue: (r) => (r.kind === "run" ? r.state : r.pipeline.status.state) },
    { id: "updated", header: m.project_col_updated(), cell: (r) => formatDateTime(r.updatedAt), sortValue: (r) => r.updatedAt, align: "right" },
  ]
  const rowActions = (row: RunsRow): MenuItem[] => [
    { id: "open", label: m.verb_open(), icon: Eye, run: () => follow(linkOf(row)) },
    ...(open && row.kind === "run"
      ? [
          { separator: true } as const,
          {
            id: "trash",
            label: m.run_move_to_trash(),
            icon: Trash2,
            kind: "destructive" as const,
            confirm: { title: m.project_run_trash_title({ name: row.run.name }), summary: m.project_run_trash_description(), confirm: { label: m.run_move_to_trash(), kind: "destructive" as const } },
            run: () => trashRun(row.run.id),
          },
        ]
      : []),
  ]
  const actions: Action[] = [{ id: "project-trash", label: trashed > 0 ? m.trash_with_count({ count: trashed }) : m.trash_title(), icon: Trash2, run: () => follow(trashLink(project)) }]

  return {
    id: "runs",
    title: m.common_runs(),
    count: rows.length,
    flush: true,
    actions,
    content: (
      <BoxTable
        label={m.project_runs_of({ name: project.name })}
        rows={rows}
        columns={columns}
        getRowId={(r) => r.id}
        onRowClick={(r) => follow(linkOf(r))}
        rowLabel={name}
        rowActions={rowActions}
        expand={{ isExpandable: (r) => r.kind === "group", render: (r) => (r.kind === "group" ? <GroupPanels group={r.group} panels={r.pipeline.panels} project={project} /> : null) }}
        empty={m.project_no_runs()}
      />
    ),
  }
}

/** A run group's panels, one level under its row. */
function GroupPanels({ group, panels, project }: { group: RunGroup; panels: GroupPanelState[]; project: Project }) {
  const m = useMessages()
  const follow = useFollowLink()
  const linkOf = (p: GroupPanelState) => (p.trashed ? trashLink(project) : runStepLink(p.run, p.pipeline.current.id))
  const state = (p: GroupPanelState): RunState => (p.trashed ? "trashed" : runStatus(p.pipeline).state)
  const columns: Column<GroupPanelState>[] = [
    { id: "panel", header: m.rungroup_col_panel(), cell: (p) => panelLabel(m, p.panel), sortValue: (p) => p.panel.n, rowHeader: true },
    { id: "run", header: m.rungroup_col_panel_run(), cell: (p) => p.run.name, sortValue: (p) => p.run.name, truncate: true },
    { id: "step", header: m.project_col_step(), cell: (p) => say(m, STEP_NAME[p.pipeline.current.id]), sortValue: (p) => p.pipeline.current.n },
    { id: "status", header: m.rungroup_col_status(), cell: (p) => <RunBadge state={state(p)} />, sortValue: state },
  ]
  return <DataTable label={m.rungroup_panels_label({ name: group.name })} rows={panels} columns={columns} getRowId={(p) => p.run.id} scroll="none" onRowClick={(p) => follow(linkOf(p))} />
}

// ---------------------------------------------------------------------------
// Candidates (P-REV2: Ready sessions only)
// ---------------------------------------------------------------------------

interface CandidateRow {
  session: Session
  subject: Subject
  rigId: OpticalTrainId
  frames: number
  runs: string[]
  placement: string | null
}

function candidateRows(m: Messages, state: PrototypeState, project: Project): CandidateRow[] {
  const { catalog } = state
  const runs = projectRuns(catalog, project.id)
  return projectCandidates(catalog, project).map((c) => {
    const placed = c.subject.mosaic ? panelForSession(catalog, c.subject, c.session, c.rigId) : null
    const panel = placed?.panelId ? c.subject.mosaic?.panels.find((p) => p.id === placed.panelId) : undefined
    return {
      session: c.session,
      subject: c.subject,
      rigId: c.rigId,
      frames: liveAssetIds(catalog, c.session).length,
      runs: runs.filter((r) => latestRevision(r)?.sessions.some((member) => member.sessionId === c.session.id)).map((r) => r.name),
      placement: placed ? (panel ? panelLabel(m, panel) : say(m, placed.detail)) : null,
    }
  })
}

/**
 * Candidates (D2, P-REV2): the matching sessions that are Ready. A session
 * that still needs review waits in the review queue; the section offers its
 * frames to review, counted as every page counts them (`sessionUnreviewedFrames`, C10).
 */
export function useCandidatesSection(project: Project): DetailSection {
  const m = useMessages()
  const navigate = useNavigate()
  const follow = useFollowLink()
  const catalog = useStore((s) => s.catalog)
  const rows = useStore((s) => candidateRows(m, s, project))
  const waiting = useStore((s) => projectSessionsNeedingReview(s.catalog, project))
  const unreviewed = waiting.reduce((n, c) => n + sessionUnreviewedFrames(catalog, c.session), 0)
  const firstWaiting = waiting.find((c) => sessionUnreviewedFrames(catalog, c.session) > 0)
  const [starting, setStarting] = useState<CandidateRow | null>(null)
  const open = project.state === "open"

  const label = (r: CandidateRow) => `${subjectName(m, catalog, r.subject)} · ${sessionLine(m, r.session)}`
  const columns: Column<CandidateRow>[] = [
    { id: "session", header: m.project_col_session(), cell: (r) => sessionLine(m, r.session), sortValue: (r) => r.session.night, rowHeader: true, truncate: true },
    { id: "subject", header: m.project_col_subject(), cell: (r) => (r.placement ? `${subjectName(m, catalog, r.subject)} · ${r.placement}` : subjectName(m, catalog, r.subject)), sortValue: (r) => subjectName(m, catalog, r.subject), truncate: true },
    { id: "rig", header: m.project_col_rig(), cell: (r) => rigName(m, catalog, r.rigId), sortValue: (r) => rigName(m, catalog, r.rigId), truncate: true },
    { id: "frames", header: m.goal_frames(), cell: (r) => formatCount(r.frames), sortValue: (r) => r.frames, align: "right" },
    { id: "runs", header: m.review_col_member(), cell: (r) => r.runs.join(", ") || "–", sortValue: (r) => r.runs.length, truncate: true },
  ]
  const rowActions = (r: CandidateRow): MenuItem[] => [
    { id: "open-session", label: m.project_open_session(), icon: Eye, run: () => void navigate({ to: "/sessions/$sessionId", params: { sessionId: r.session.id } }) },
    ...(open ? [{ id: "start-run", label: m.startrun_title(), opensDialog: true, run: () => setStarting(r) }] : []),
  ]
  const actions: Action[] =
    unreviewed > 0 && firstWaiting
      ? [{ id: "review", label: m.domain_next_review_new_frames({ count: unreviewed, n: formatCount(unreviewed) }), run: () => follow(sessionIntakeLink(firstWaiting.session.id, "review")) }]
      : []

  return {
    id: "candidates",
    title: m.project_candidates(),
    count: rows.length,
    flush: true,
    actions,
    content: (
      <>
        <BoxTable
          label={m.project_candidate_sessions_of({ name: project.name })}
          rows={rows}
          columns={columns}
          getRowId={(r) => `${r.session.id}|${r.rigId}`}
          initialSort={{ columnId: "session", direction: "desc" }}
          rowLabel={label}
          rowActions={rowActions}
          empty={m.project_no_candidates()}
        />
        {starting ? <StartRunDialog project={project} open onOpenChange={(next) => !next && setStarting(null)} initial={{ subjectId: starting.subject.id, rigId: starting.rigId }} /> : null}
      </>
    ),
  }
}

// ---------------------------------------------------------------------------
// Goals (C7)
// ---------------------------------------------------------------------------

type GoalDraft = { goalId: string | null; target: string; channel: Goal["channel"]; kinds: GoalKinds }

/** "subjectId|panelId" for a goal's subject or panel. */
const targetKey = (subjectId: string, panelId: string | null) => `${subjectId}|${panelId ?? ""}`

function goalStatus(p: GoalProgress): "met" | "partial" | "missing" {
  if (p.met) return "met"
  return (p.measure.fraction ?? 0) > 0 ? "partial" : "missing"
}

/**
 * Goals: one row per goal, its counted progress and what the bar leaves out.
 * Add goal… and Edit… share one dialog; Apply template… copies a template's
 * values and conditions in (D-W30, C7). A closed Project reads its frozen
 * figures (`goalProgress`, C7) and offers no edit. `?add=goal` (Home's Add
 * a Goal) opens Add goal; closing the dialog clears it.
 */
export function useGoalsSection(project: Project): DetailSection {
  const m = useMessages()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const catalog = useStore((s) => s.catalog)
  const progress = useStore((s) => (s.catalog.projects[project.id] ? goalProgressOf(s, project) : []))
  const [draft, setDraft] = useState<GoalDraft | null>(null)
  const [applying, setApplying] = useState(false)
  const open = project.state === "open"
  const channels = projectChannels(catalog, project.rigIds)

  const targets = project.subjects.flatMap((s) => (s.mosaic ? s.mosaic.panels.map((p) => ({ value: targetKey(s.id, p.id), label: subjectLabel(m, catalog, project, s.id, p.id) })) : [{ value: targetKey(s.id, null), label: subjectName(m, catalog, s) }]))
  const newGoal = (): GoalDraft => ({ goalId: null, target: targets[0]?.value ?? "", channel: channels[0] ?? "L", kinds: DEFAULT_GOAL })
  // `?add=goal` opens Add goal once per link; the flag drops when the param does.
  const linked = open && targets.length > 0 && search.add === "goal"
  const openedFromLink = useRef(false)
  useEffect(() => {
    if (!linked) {
      openedFromLink.current = false
      return
    }
    if (openedFromLink.current) return
    openedFromLink.current = true
    setDraft(newGoal())
    // Only the link's arrival opens the dialog; a re-render while it stands does not reopen it.
  }, [linked])
  function closeDraft() {
    setDraft(null)
    if (search.add === undefined) return
    void navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: ({ add: _, ...rest }: Record<string, string | undefined>) => rest, replace: true } as never)
  }
  const subjectOf = (p: GoalProgress) => subjectLabel(m, catalog, project, p.goal.subjectId, p.goal.panelId)
  const columns: Column<GoalProgress>[] = [
    { id: "subject", header: m.project_col_subject(), cell: subjectOf, sortValue: subjectOf, rowHeader: true, truncate: true },
    { id: "channel", header: m.run_col_channel(), cell: (p) => p.goal.channel, sortValue: (p) => p.goal.channel },
    { id: "goal", header: m.project_goals_title(), cell: (p) => kindsLine(m, p.goal), sortValue: (p) => kindsLine(m, p.goal) },
    { id: "progress", header: m.project_col_progress(), cell: (p) => say(m, p.amounts), sortValue: (p) => p.measure.fraction ?? 0, truncate: true },
    { id: "below", header: m.project_col_below_bar(), cell: (p) => (p.belowBarLine ? say(m, p.belowBarLine) : "–"), sortValue: (p) => p.belowBar.seconds },
    { id: "status", header: m.rungroup_col_status(), cell: (p) => <StatusBadge kind="checklist" value={goalStatus(p)} />, sortValue: goalStatus },
  ]
  const write = (goals: Goal[]): CommitResult => setGoals(project.id, goals, project.revision)
  const rowActions = (p: GoalProgress): MenuItem[] =>
    open
      ? [
          { id: "edit", label: m.project_edit(), icon: Pencil, opensDialog: true, run: () => setDraft({ goalId: p.goal.id, target: targetKey(p.goal.subjectId, p.goal.panelId), channel: p.goal.channel, kinds: p.goal }) },
          { separator: true },
          {
            id: "remove",
            label: m.goal_remove_goal({ channel: p.goal.channel }),
            icon: X,
            kind: "destructive",
            confirm: { title: m.goal_remove_title({ channel: p.goal.channel, subject: subjectOf(p) }), confirm: { label: m.project_remove(), kind: "destructive" } },
            run: () => write(project.goals.filter((g) => g.id !== p.goal.id)),
          },
        ]
      : []
  const actions: Action[] = open
    ? [
        {
          id: "add-goal",
          label: m.goal_add(),
          icon: Plus,
          opensDialog: true,
          unavailable: targets.length === 0 ? { action: m.actions_blocked({ action: m.goal_add() }), reason: m.startrun_no_subject(), blockers: [] } : undefined,
          run: () => setDraft(newGoal()),
        },
        { id: "apply-template", label: m.goal_apply_template(), opensDialog: true, run: () => setApplying(true) },
      ]
    : []

  function save(next: GoalDraft): CommitResult {
    const [subjectId = "", panelId = ""] = next.target.split("|")
    const goal: Goal = { id: next.goalId ?? freshId("goal", `${subjectId}|${next.channel}`), subjectId, panelId: panelId || null, channel: next.channel, ...next.kinds }
    return write(next.goalId ? project.goals.map((g) => (g.id === next.goalId ? goal : g)) : [...project.goals, goal])
  }

  const saveLabel = m.settings_save()
  const error = draft ? goalKindsError(m, draft.kinds) : undefined
  return {
    id: "goals",
    title: m.project_goals_title(),
    count: progress.length,
    flush: true,
    actions,
    content: (
      <>
        <BoxTable label={m.project_goals_of({ name: project.name })} rows={progress} columns={columns} getRowId={(p) => p.goal.id} rowLabel={(p) => `${subjectOf(p)} · ${p.goal.channel}`} rowActions={rowActions} empty={m.projects_no_goals()} />
        <FormDialog
          open={draft !== null}
          onOpenChange={(next) => !next && closeDraft()}
          title={draft?.goalId ? m.goal_edit_title({ channel: draft.channel }) : m.goal_add()}
          size="sm"
          confirm={{
            id: "goal-save",
            label: saveLabel,
            kind: "primary",
            run: () => (draft ? save(draft) : undefined),
            unavailable: error ? { action: m.actions_blocked({ action: saveLabel }), reason: error, blockers: [] } : undefined,
          }}
        >
          {draft ? (
            <>
              {draft.goalId === null ? (
                <>
                  <SelectField label={m.project_col_subject()} value={draft.target} options={targets} onChange={(target) => setDraft({ ...draft, target })} />
                  <SelectField label={m.run_col_channel()} value={draft.channel} options={channels.map((c) => ({ value: c, label: c }))} onChange={(channel) => setDraft({ ...draft, channel })} />
                </>
              ) : null}
              <GoalKindsFields value={draft.kinds} onChange={(patch) => setDraft({ ...draft, kinds: { ...draft.kinds, ...patch } })} />
            </>
          ) : null}
        </FormDialog>
        <ApplyTemplateDialog project={project} open={applying} onOpenChange={setApplying} />
      </>
    ),
  }
}

function goalProgressOf(state: PrototypeState, project: Project): GoalProgress[] {
  const live = state.catalog.projects[project.id] ?? project
  return subjectProgress(state.catalog, live, null).flatMap((s) => s.goals)
}

/** Apply template…: its values replace the goals and its conditions the subjects' (D-W30, C7); the dialog lists the goal changes only (B: no Unchanged list). */
function ApplyTemplateDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const templates = goalTemplates(catalog)
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "")
  const template = templates.find((t) => t.id === templateId)
  const changes = template ? templateChanges(m, project, template) : []
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.goal_apply_template()}
      confirm={{ id: "apply-template", label: m.goal_apply(), kind: "primary", run: () => applyGoalTemplate(project.id, templateId, project.revision) }}
    >
      <SelectField label={m.goal_template()} value={templateId} options={templates.map((t) => ({ value: t.id, label: t.source === "user" ? m.newproject_template_yours({ name: t.name }) : t.name }))} onChange={setTemplateId} />
      <KeyValueList items={changes.length > 0 ? changes : [{ label: m.project_goals_title(), value: m.goal_no_changes() }]} />
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Subjects (C7 progress)
// ---------------------------------------------------------------------------

interface SubjectRow {
  progress: SubjectProgress
  target: string
  runs: number
}

/** A mosaic's panel balance per channel: the out-of-balance channels first; "–" for a plain subject. */
function balanceLine(m: Messages, progress: SubjectProgress): string {
  const lines = progress.channels.filter((c) => c.balance).sort((a, b) => Number(a.balance!.balanced) - Number(b.balance!.balanced))
  return lines.map((c) => `${c.channel}: ${say(m, c.balance!.line)}`).join(" · ") || "–"
}

/** The subject search dialog behind Add subject… and Edit… (change the Target; its goals stay). */
function SubjectDialog({ open, onOpenChange, title, confirmLabel, taken, onConfirm }: { open: boolean; onOpenChange: (open: boolean) => void; title: string; confirmLabel: string; taken: string[]; onConfirm: (pick: SubjectPick) => CommitResult }) {
  const m = useMessages()
  const search = useTargetSearch(taken)
  const [pick, setPick] = useState<SubjectPick | null>(null)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setPick(null)
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      size="sm"
      confirm={{
        id: "subject-confirm",
        label: confirmLabel,
        kind: "primary",
        run: () => (pick ? onConfirm(pick) : undefined),
        unavailable: pick ? undefined : { action: m.actions_blocked({ action: confirmLabel }), reason: m.mosaic_choose_target_first(), blockers: [] },
      }}
    >
      <TargetPicker
        label={m.project_target_label()}
        description={pick ? m.project_target_chosen({ name: pick.name }) : undefined}
        query={search.query}
        onQueryChange={search.setQuery}
        groups={search.groups}
        onPick={(option) => setPick(search.pickOf(option))}
      />
    </FormDialog>
  )
}

export function useSubjectsSection(project: Project): DetailSection {
  const m = useMessages()
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const rows = useStore((s) => {
    const tonight = planningNight(s)
    return subjectProgress(s.catalog, project, tonight).map(
      (progress): SubjectRow => ({ progress, target: subjectName(m, s.catalog, progress.subject), runs: Object.values(s.catalog.runs).filter((r) => r.projectId === project.id && r.subjectId === progress.subject.id && !r.trashedAt).length }),
    )
  })
  const [adding, setAdding] = useState(false)
  const [changing, setChanging] = useState<Subject | null>(null)
  const open = project.state === "open"
  const mosaicLink = (subjectId: string) => void navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: { mosaic: subjectId } })
  const taken = project.subjects.map((s) => subjectTarget(catalog, s)?.name ?? "")

  const columns: Column<SubjectRow>[] = [
    { id: "subject", header: m.project_col_subject(), cell: (r) => r.target, sortValue: (r) => r.target, rowHeader: true, truncate: true },
    {
      id: "kind",
      header: m.project_col_kind(),
      cell: (r) => (r.progress.subject.mosaic ? m.mosaic_of_panels({ count: r.progress.subject.mosaic.panels.length }) : m.project_target_label()),
      truncate: true,
      sortValue: (r) => r.progress.subject.mosaic?.panels.length ?? 0,
    },
    { id: "progress", header: m.project_col_progress(), cell: (r) => (r.progress.line ? say(m, r.progress.line) : "–"), sortValue: (r) => r.progress.fraction, truncate: true },
    { id: "balance", header: m.project_col_panel_balance(), cell: (r) => balanceLine(m, r.progress), sortValue: (r) => Number(r.progress.balanced), truncate: true },
    { id: "ratio", header: m.project_col_channel_ratio(), cell: (r) => (r.progress.ratio ? say(m, r.progress.ratio.line) : "–"), sortValue: (r) => (r.progress.ratio ? say(m, r.progress.ratio.line) : null), truncate: true },
    { id: "window", header: m.project_col_window(), cell: (r) => (r.progress.window ? say(m, r.progress.window.line) : "–"), sortValue: (r) => r.progress.window?.nightsLeft ?? null },
    { id: "runs", header: m.common_runs(), cell: (r) => r.runs, sortValue: (r) => r.runs, align: "right" },
  ]
  const rowActions = (r: SubjectRow): MenuItem[] => {
    const subject = r.progress.subject
    const target = subjectTarget(catalog, subject)
    const goals = project.goals.filter((g) => g.subjectId === subject.id).length
    return [
      ...(target ? [{ id: "open-target", label: m.project_open_target(), icon: Crosshair, run: () => void navigate({ to: "/targets/$targetId", params: { targetId: target.id } }) }] : []),
      ...(open
        ? [
            ...(subject.mosaic ? [] : [{ id: "edit", label: m.project_edit(), icon: Pencil, opensDialog: true, run: () => setChanging(subject) }]),
            { id: "mosaic", label: subject.mosaic ? m.mosaic_edit() : m.mosaic_make(), icon: Grid2x2Plus, run: () => mosaicLink(subject.id) },
            { separator: true } as const,
            {
              id: "remove",
              label: m.project_remove(),
              icon: X,
              kind: "destructive" as const,
              confirm: {
                title: m.project_remove_from_title({ name: r.target, project: project.name }),
                summary: goals > 0 ? m.project_remove_subject_goals({ count: goals }) : undefined,
                confirm: { label: m.project_remove(), kind: "destructive" as const },
              },
              run: () => removeSubject(project.id, subject.id, project.revision),
            },
          ]
        : []),
    ]
  }
  const actions: Action[] = open
    ? [
        { id: "add-subject", label: m.store_label_add_subject(), icon: Plus, opensDialog: true, run: () => setAdding(true) },
        { id: "new-mosaic", label: m.mosaic_new(), icon: Grid2x2Plus, run: () => mosaicLink("new") },
      ]
    : []

  return {
    id: "subjects",
    title: m.project_subjects(),
    count: rows.length,
    flush: true,
    actions,
    content: (
      <>
        <BoxTable label={m.project_subjects_of({ name: project.name })} rows={rows} columns={columns} getRowId={(r) => r.progress.subject.id} rowLabel={(r) => r.target} rowActions={rowActions} empty={m.projects_no_subjects()} />
        <SubjectDialog
          open={adding}
          onOpenChange={setAdding}
          title={m.store_label_add_subject()}
          confirmLabel={m.store_label_add_subject()}
          taken={taken}
          onConfirm={(pick) => {
            const resolved = resolvePick(pick)
            return resolved.ok ? addSubject(project.id, { targetId: resolved.targetId, mosaic: null }, project.revision) : { ok: false, reason: "write-failed", message: resolved.message }
          }}
        />
        <SubjectDialog
          open={changing !== null}
          onOpenChange={(next) => !next && setChanging(null)}
          title={changing ? m.settings_edit_title({ name: subjectName(m, catalog, changing) }) : m.project_edit()}
          confirmLabel={m.settings_save()}
          taken={taken}
          onConfirm={(pick) => {
            const resolved = resolvePick(pick)
            if (!resolved.ok) return { ok: false, reason: "write-failed", message: resolved.message }
            return changing ? changeSubjectTarget(project.id, changing.id, resolved.targetId, project.revision) : { ok: true }
          }}
        />
      </>
    ),
  }
}

/** The planning night the C7 windows count from: tonight at the planning site, else none. */
function planningNight(state: PrototypeState): string | null {
  const site = planningSite(state)
  return site ? upcomingNight(site, Date.parse(nowIso())) : null
}

// ---------------------------------------------------------------------------
// Rigs
// ---------------------------------------------------------------------------

export function useRigsSection(project: Project): DetailSection {
  const m = useMessages()
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const candidates = useStore((s) => projectCandidates(s.catalog, project))
  const [adding, setAdding] = useState(false)
  const others = Object.values(catalog.opticalTrains).filter((r) => !project.rigIds.includes(r.id))
  const [choice, setChoice] = useState("")
  const open = project.state === "open"
  const chosen = others.find((r) => r.id === choice) ?? others[0]

  const camera = (id: string) => {
    const rig = catalog.opticalTrains[id]
    const kind = rig ? rigCameraKind(catalog, rig) : null
    return kind === "osc" ? m.project_camera_osc() : kind === "mono" ? m.project_camera_mono() : m.status_unknown()
  }
  const field = (id: string) => {
    const rig = catalog.opticalTrains[id]
    const fov = rig ? rigFieldOfView(catalog, rig) : null
    return fov ? `${formatDegrees(fov.widthDeg, 2)} × ${formatDegrees(fov.heightDeg, 2)}` : "–"
  }
  const columns: Column<string>[] = [
    { id: "rig", header: m.project_col_rig(), cell: (id) => rigName(m, catalog, id), sortValue: (id) => rigName(m, catalog, id), rowHeader: true, truncate: true },
    { id: "camera", header: m.project_col_camera(), cell: camera, sortValue: camera },
    { id: "channels", header: m.project_col_channels(), cell: (id) => projectChannels(catalog, [id as OpticalTrainId]).join(", ") || "–", sortValue: (id) => projectChannels(catalog, [id as OpticalTrainId]).length, truncate: true },
    { id: "field", header: m.project_col_field(), cell: field, sortValue: field },
    { id: "candidates", header: m.project_candidates(), cell: (id) => candidates.filter((c) => c.rigId === id).length, sortValue: (id) => candidates.filter((c) => c.rigId === id).length, align: "right" },
  ]
  const rowActions = (id: string): MenuItem[] => {
    const users = rigRuns(catalog, project.id, id as OpticalTrainId)
    return [
      { id: "equipment", label: m.project_open_in({ name: m.settings_equipment() }), icon: Eye, run: () => void navigate({ to: "/settings/equipment" }) },
      ...(open
        ? [
            { separator: true } as const,
            {
              id: "remove",
              label: m.project_remove(),
              icon: X,
              kind: "destructive" as const,
              unavailable:
                users.length > 0
                  ? { action: m.project_refusal_remove_rig(), reason: m.project_used_by_runs({ count: users.length }), blockers: users.map((r) => ({ label: r.name, link: r.trashedAt ? trashLink(project) : runStepLink(r, runPipelineStep(r)) })) }
                  : undefined,
              confirm: { title: m.project_remove_from_title({ name: rigName(m, catalog, id), project: project.name }), confirm: { label: m.project_remove(), kind: "destructive" as const } },
              run: () => removeRig(project.id, id as OpticalTrainId, project.revision),
            },
          ]
        : []),
    ]
  }
  const addLabel = m.project_add_rig()
  const actions: Action[] = open
    ? [
        {
          id: "add-rig",
          label: addLabel,
          icon: Plus,
          opensDialog: true,
          unavailable: others.length === 0 ? { action: m.actions_blocked({ action: addLabel }), reason: m.project_all_rigs_added(), blockers: [] } : undefined,
          run: () => setAdding(true),
        },
      ]
    : []

  return {
    id: "rigs",
    title: m.project_rigs(),
    count: project.rigIds.length,
    flush: true,
    actions,
    content: (
      <>
        <BoxTable label={m.project_rigs_of({ name: project.name })} rows={project.rigIds} columns={columns} getRowId={(id) => id} rowLabel={(id) => rigName(m, catalog, id)} rowActions={rowActions} empty={m.equipment_no_rigs()} />
        <FormDialog open={adding} onOpenChange={setAdding} title={addLabel} size="sm" confirm={{ id: "add-rig", label: addLabel, kind: "primary", run: () => (chosen ? addRig(project.id, chosen.id, project.revision) : undefined) }}>
          <SelectField label={m.project_col_rig()} value={chosen?.id ?? ""} options={others.map((r) => ({ value: r.id, label: r.name }))} onChange={setChoice} />
        </FormDialog>
      </>
    ),
  }
}

/** Where a run that holds a rig opens: its own step. */
function runPipelineStep(run: Run) {
  return run.stageBeforeComplete ?? "select"
}

// ---------------------------------------------------------------------------
// Tonight (D-W16, D-W63)
// ---------------------------------------------------------------------------

/** Tonight at the planning site: the Moon, the darkness and each subject's best window, as facts. */
export function usePlanningSection(project: Project): DetailSection {
  const m = useMessages()
  const navigate = useNavigate()
  const items = useStore((s) => {
    const site = planningSite(s)
    if (!site) return null
    const now = Date.parse(nowIso())
    const tonight = tonightAt(site, now)
    const facts = [
      { label: m.project_site(), value: site.name },
      { label: m.project_moon(), value: m.project_moon_pct({ pct: Math.round(tonight.moon.illuminationPct) }) },
      { label: m.project_darkness(), value: tonight.darkness ? m.project_dark_window({ start: formatTime(tonight.darkness.start, site.timeZone), end: formatTime(tonight.darkness.end, site.timeZone) }) : m.project_no_darkness() },
    ]
    const subjects = project.subjects.map((subject) => {
      const target = subjectTarget(s.catalog, subject)
      const centre = subjectCentre(s.catalog, subject)
      const window = target && centre ? bestWindowTonight({ ...target, ra: centre.ra, dec: centre.dec }, site, defaultCriteria(site), now) : null
      const value = !centre
        ? m.project_search_position_unknown()
        : window
          ? m.project_window_line({ start: formatTime(window.start, site.timeZone), end: formatTime(window.end, site.timeZone), alt: Math.round(window.maxAltitudeDeg), moon: Math.round(window.moonSeparationDeg) })
          : m.project_none_tonight()
      return { label: subjectName(m, s.catalog, subject), value }
    })
    return [...facts, ...subjects]
  })
  return {
    id: "planning",
    title: m.project_tonight(),
    actions: [{ id: "plan", label: m.project_planner(), run: () => void navigate({ to: "/plan", search: { project: project.id } }) }],
    content: items ? (
      <KeyValueList columns={2} items={items} />
    ) : (
      <Refusal standing action={m.project_no_windows()} reason={m.project_no_site()} blockers={[{ label: `${m.nav_settings()} › ${m.settings_sites()}`, link: { to: "/settings/sites" } }]} />
    ),
  }
}

// ---------------------------------------------------------------------------
// Archived sessions (D-W69)
// ---------------------------------------------------------------------------

/** Rows a restore moves back, as the confirm's file list: each frame from the archive to where Archive found it. */
function restoreRows(rows: ReturnType<typeof restorePlan>["rows"]): FileRow[] {
  return rows.flatMap((row) => row.moves.map((move) => ({ file: move.from.path.split("/").at(-1) ?? move.from.path, from: move.from.path, to: move.to.path, action: "move" as const, size: move.sizeBytes })))
}

/** The Project's archived sessions; Restore puts them back where Archive found them, also after Reopen (D-W69). */
export function useArchivedSection(project: Project): DetailSection | null {
  const m = useMessages()
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const origins = useStore((s) => s.slices.b.archiveOrigins)
  const state = useStore((s) => s)
  const ids = project.archive?.sessionIds ?? []
  const sessions = ids.map((id) => catalog.sessions[id]).filter((s): s is Session => s !== undefined)
  if (sessions.length === 0) return null

  const restore = (sessionIds: string[], label: string): Action => {
    const plan = restorePlan(state, project, origins, sessionIds)
    const unavailable = plan.rows.length === 0 ? { action: m.actions_blocked({ action: label }), reason: plan.blocked ? say(m, plan.blocked) : m.project_restore_nothing_now(), blockers: plan.refused.map((r) => ({ label: `${sessionLine(m, r.session)} · ${say(m, r.reason)}` })) } : undefined
    return {
      id: `restore-${sessionIds.join("-")}`,
      label,
      icon: RotateCcw,
      unavailable,
      confirm: { title: m.project_restore_title({ count: plan.rows.length }), summary: m.project_restore_description(), groups: [{ label: m.project_restore(), rows: restoreRows(plan.rows) }], confirm: { label: m.project_restore() } },
      run: () => {
        startArchiveTransfer(project.id, plan.rows, "restore")
      },
    }
  }
  const archivePath = (session: Session) => {
    const first = liveAssetIds(catalog, session)
      .map((a) => catalog.assets[a])
      .find((a) => a !== undefined)
    return first?.copies.find((c) => catalog.locations[c.locationId]?.role === "archive")?.path.split("/").slice(0, -1).join("/") ?? "–"
  }
  const columns: Column<Session>[] = [
    { id: "session", header: m.project_col_session(), cell: (s) => `${subjectNameOf(m, catalog, project, s)} · ${sessionLine(m, s)}`, sortValue: (s) => s.night, rowHeader: true, truncate: true },
    { id: "path", header: m.project_col_archive_path(), cell: archivePath, sortValue: archivePath, truncate: true },
  ]
  return {
    id: "archived",
    title: m.status_archived(),
    count: sessions.length,
    flush: true,
    actions: [restore(ids, m.project_restore_all())],
    content: (
      <BoxTable
        label={m.project_archived_of({ name: project.name })}
        rows={sessions}
        columns={columns}
        getRowId={(s) => s.id}
        rowLabel={(s) => sessionLine(m, s)}
        rowActions={(s) => [
          { id: "open-session", label: m.project_open_session(), icon: Eye, run: () => void navigate({ to: "/sessions/$sessionId", params: { sessionId: s.id } }) },
          restore([s.id], m.project_restore()),
        ]}
      />
    ),
  }
}

function subjectNameOf(m: Messages, catalog: Catalog, project: Project, session: Session): string {
  const subject = project.subjects.find((s) => s.targetId === session.target.value)
  return subject ? subjectName(m, catalog, subject) : (session.objectLabel ?? m.project_unknown_subject())
}
