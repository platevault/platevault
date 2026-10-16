/**
 * S3 Project sections of the Sessions tab (slice B; DetailPage sections,
 * each a Box holding a BoxTable or a KeyValueList): the groups and the
 * sessions they hold first (PRJ-FR-08, PRJ-FR-27 to PRJ-FR-29), then the
 * suggestions, goals, subjects (with the C7 progress: weakest panel, panel
 * balance, channel ratio and nights left), rigs, tonight's planning and the
 * archived sessions. Every edit goes through a foundation store action and
 * changes the desired state only: the View follows on the next Apply. A
 * refusal shows beside the action that was refused. A Closed or Archived
 * Project is read-only for good (PRJ-FR-25): its sections keep Open only.
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { Crosshair, Eye, FolderInput, Pencil, Plus, Split, X } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { BoxTable } from "@/components/app/box"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { SelectField, SwitchField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { useFollowLink } from "@/components/app/links"
import { TargetPicker } from "@/components/app/pickers"
import { Refusal } from "@/components/app/refusal"
import { StatusBadge } from "@/components/app/status"
import type { DetailSection } from "@/components/templates/detail-page"
import { DEFAULT_GOAL, type GoalKinds, GoalKindsFields, goalKindsError, kindsLine } from "@/components/domain/goal-fields"
import {
  findGroup,
  type GoalProgress,
  isLocked,
  isMosaic,
  liveAssetIds,
  panelGroups,
  planningSite,
  projectSessionsNeedingReview,
  projectSuggestions,
  rigCameraKind,
  rigFieldOfView,
  rigName,
  sessionIntakeLink,
  sessionRigId,
  sessionTargetId,
  sessionUnreviewedFrames,
  type Suggestion,
  type SubjectProgress,
  subjectCentre,
  subjectName,
  subjectProgress,
  subjectTarget,
} from "@/domain/derive"
import { sessionLongRef } from "@/domain/membership"
import { bestWindowTonight, defaultCriteria, tonightAt, upcomingNight } from "@/domain/planning"
import { groupInputs } from "@/domain/project-view"
import type { Catalog, Goal, OpticalTrainId, Project, ProjectGroup, ProjectInput, Session, Subject } from "@/domain/types"
import { formatCount, formatDegrees, formatTime } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import {
  addRig,
  addSessions,
  addSubject,
  applyGoalTemplate,
  changeSubjectTarget,
  createGroup,
  moveSessions,
  removeGroup,
  removeRig,
  removeSessions,
  removeSubject,
  renameGroup,
  setGoals,
  setGroupPanel,
  splitGroup,
} from "@/store/actions/projects"
import { freshId } from "@/store/actions/shared"
import { type CommitResult, nowIso, type PrototypeState, useStore } from "@/store/core"
import { goalTemplates, projectChannels, templateChanges } from "./model"
import { type SubjectPick, useTargetSearch } from "./parts"
import { resolvePick } from "./subject-actions"

/** A goal's subject, with its panel group in a mosaic: "IC 5070 · Panel 2". */
function subjectLabel(m: Messages, catalog: Catalog, project: Project, subjectId: string, groupId: string | null = null): string {
  const subject = project.subjects.find((s) => s.id === subjectId)
  if (!subject) return m.project_unknown_subject()
  const group = findGroup(project, groupId)
  return group ? `${subjectName(m, catalog, subject)} · ${group.name}` : subjectName(m, catalog, subject)
}

/** "18 Sep · Ha · 300 s", as calibration and View lists name a session. */
function sessionLine(m: Messages, session: Session): string {
  return say(m, sessionLongRef(session))
}

function subjectNameOf(m: Messages, catalog: Catalog, project: Project, session: Session): string {
  const subject = project.subjects.find((s) => s.targetId === sessionTargetId(session))
  return subject ? subjectName(m, catalog, subject) : (session.objectLabel ?? m.project_unknown_subject())
}

const openSession = (navigate: ReturnType<typeof useNavigate>, sessionId: string) => void navigate({ to: "/sessions/$sessionId", params: { sessionId } })

// ---------------------------------------------------------------------------
// Groups (PRJ-FR-27 to PRJ-FR-29)
// ---------------------------------------------------------------------------

/** What the group dialog writes: a new group, or a rename of `groupId`. */
type GroupDraft = { groupId: string | null; name: string; panel: boolean }

/**
 * The Project's groups: one rig and framing each, or a mosaic panel. New
 * group… names it (and may mark it a panel); Rename… changes its folder on
 * the next Apply; marking a group as a panel makes the Project a mosaic.
 * Remove is refused while the group holds a session.
 */
export function useGroupsSection(project: Project): DetailSection {
  const m = useMessages()
  const [draft, setDraft] = useState<GroupDraft | null>(null)
  const open = !isLocked(project)
  const held = (group: ProjectGroup) => groupInputs(project, group.id).length
  const kind = (group: ProjectGroup) => (group.panel ? m.common_mosaic_panel() : m.project_group_kind_group())
  const columns: Column<ProjectGroup>[] = [
    { id: "name", header: m.newproject_field_name(), cell: (g) => g.name, sortValue: (g) => g.name, rowHeader: true, truncate: true },
    { id: "kind", header: m.project_col_kind(), cell: kind, sortValue: kind },
    { id: "sessions", header: m.nav_sessions(), cell: held, sortValue: held, align: "right" },
  ]
  const rowActions = (group: ProjectGroup): MenuItem[] =>
    open
      ? [
          { id: "rename", label: m.project_group_rename(), icon: Pencil, opensDialog: true, run: () => setDraft({ groupId: group.id, name: group.name, panel: group.panel }) },
          { id: "panel", label: group.panel ? m.project_group_unmark_panel() : m.project_group_mark_panel(), run: () => setGroupPanel(project.id, group.id, !group.panel) },
          { separator: true },
          {
            id: "remove",
            label: m.project_group_remove(),
            icon: X,
            kind: "destructive",
            confirm: { title: m.project_group_remove_title({ name: group.name }), confirm: { label: m.project_remove(), kind: "destructive" } },
            run: () => removeGroup(project.id, group.id),
          },
        ]
      : []
  const actions: Action[] = open ? [{ id: "new-group", label: m.project_group_new(), icon: Plus, opensDialog: true, run: () => setDraft({ groupId: null, name: "", panel: false }) }] : []
  const save = (next: GroupDraft): CommitResult => (next.groupId ? renameGroup(project.id, next.groupId, next.name) : createGroup(project.id, next.name, next.panel).result)
  const saveLabel = draft?.groupId ? m.settings_save() : m.project_group_new()
  const nameError = draft && !draft.name.trim() ? m.settings_name_required() : undefined
  return {
    id: "groups",
    title: m.project_groups(),
    count: project.groups.length,
    flush: true,
    actions,
    content: (
      <>
        <BoxTable label={m.project_groups_of({ name: project.name })} rows={project.groups} columns={columns} getRowId={(g) => g.id} rowLabel={(g) => g.name} rowActions={rowActions} empty={m.project_no_groups()} />
        <FormDialog
          open={draft !== null}
          onOpenChange={(next) => !next && setDraft(null)}
          title={draft?.groupId ? m.common_rename_title({ name: project.groups.find((g) => g.id === draft.groupId)?.name ?? "" }) : m.project_group_new()}
          size="sm"
          confirm={{
            id: "group-save",
            label: saveLabel,
            kind: "primary",
            run: () => (draft ? save(draft) : undefined),
            unavailable: nameError ? { action: m.actions_blocked({ action: saveLabel }), reason: nameError, blockers: [] } : undefined,
          }}
        >
          {draft ? (
            <>
              <TextField label={m.newproject_field_name()} value={draft.name} onChange={(name) => setDraft({ ...draft, name })} error={nameError} required autoFocus />
              {draft.groupId === null ? <SwitchField label={m.common_mosaic_panel()} description={m.project_group_panel_hint()} checked={draft.panel} onChange={(panel) => setDraft({ ...draft, panel })} /> : null}
            </>
          ) : null}
        </FormDialog>
      </>
    ),
  }
}

// ---------------------------------------------------------------------------
// Held sessions (PRJ-FR-08, PRJ-FR-27)
// ---------------------------------------------------------------------------

interface HeldRow {
  input: ProjectInput
  session: Session
  group: ProjectGroup | undefined
  frames: number
}

function heldRows(state: PrototypeState, project: Project): HeldRow[] {
  return project.inputs.flatMap((input) => {
    const session = state.catalog.sessions[input.sessionId]
    return session ? [{ input, session, group: findGroup(project, input.groupId), frames: liveAssetIds(state.catalog, session).length - input.excluded.length }] : []
  })
}

/**
 * The sessions the Project holds, each in one group. Move to group and
 * Split into a new group move whole sessions; Remove from Project takes its
 * frames out of the View on the next Apply. Files, the library and other
 * Projects never change.
 */
export function useHeldSection(project: Project): DetailSection {
  const m = useMessages()
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const rows = useStore((s) => heldRows(s, project))
  const open = !isLocked(project)
  const label = (r: HeldRow) => `${subjectNameOf(m, catalog, project, r.session)} · ${sessionLine(m, r.session)}`
  const rigOf = (r: HeldRow) => rigName(m, catalog, sessionRigId(r.session))
  const columns: Column<HeldRow>[] = [
    { id: "session", header: m.project_col_session(), cell: (r) => sessionLine(m, r.session), sortValue: (r) => r.session.night, rowHeader: true, truncate: true },
    { id: "subject", header: m.project_col_subject(), cell: (r) => subjectNameOf(m, catalog, project, r.session), sortValue: (r) => subjectNameOf(m, catalog, project, r.session), truncate: true },
    { id: "rig", header: m.project_col_rig(), cell: rigOf, sortValue: rigOf, truncate: true },
    { id: "group", header: m.project_col_group(), cell: (r) => r.group?.name ?? "–", sortValue: (r) => r.group?.name ?? null, truncate: true },
    { id: "frames", header: m.goal_frames(), cell: (r) => formatCount(r.frames), sortValue: (r) => r.frames, align: "right" },
  ]
  const rowActions = (r: HeldRow): MenuItem[] => {
    const others = project.groups.filter((g) => g.id !== r.input.groupId)
    return [
      { id: "open-session", label: m.project_open_session(), icon: Eye, run: () => openSession(navigate, r.session.id) },
      ...(open
        ? [
            ...(others.length > 0 ? [{ submenu: m.project_move_to_group(), items: others.map((g): MenuItem => ({ id: `move-${g.id}`, label: g.name, icon: FolderInput, run: () => moveSessions(project.id, [r.session.id], g.id) })) }] : []),
            { id: "split", label: m.project_split_group(), icon: Split, run: () => splitGroup(project.id, r.input.groupId, [r.session.id]).result },
            { separator: true } as const,
            {
              id: "remove",
              label: m.project_remove_session(),
              icon: X,
              kind: "destructive" as const,
              confirm: { title: m.project_remove_from_title({ name: label(r), project: project.name }), summary: m.project_remove_session_summary(), confirm: { label: m.project_remove(), kind: "destructive" as const } },
              run: () => removeSessions(project.id, [r.session.id]),
            },
          ]
        : []),
    ]
  }
  return {
    id: "sessions",
    title: m.nav_sessions(),
    count: rows.length,
    flush: true,
    content: (
      <BoxTable
        label={m.common_sessions_of({ name: project.name })}
        rows={rows}
        columns={columns}
        getRowId={(r) => r.session.id}
        initialSort={{ columnId: "session", direction: "desc" }}
        rowLabel={label}
        rowActions={rowActions}
        empty={m.project_no_sessions()}
      />
    ),
  }
}

// ---------------------------------------------------------------------------
// Suggestions (PRJ-FR-08, PRJ-FR-09, P-REV2)
// ---------------------------------------------------------------------------

/**
 * Suggestions: Ready matching sessions the Project doesn't hold. They are
 * never added by themselves; Add to Project is offered once the session's
 * calibration is settled, else its blocker shows ("Choose its flats first").
 * A matching session that still needs review waits in the review queue; the
 * section offers its frames to review, counted as every page counts them
 * (`sessionUnreviewedFrames`, C10).
 */
export function useSuggestionsSection(project: Project): DetailSection {
  const m = useMessages()
  const navigate = useNavigate()
  const follow = useFollowLink()
  const catalog = useStore((s) => s.catalog)
  const rows = useStore((s) => projectSuggestions(s.catalog, project))
  const waiting = useStore((s) => projectSessionsNeedingReview(s.catalog, project))
  const unreviewed = waiting.reduce((n, c) => n + sessionUnreviewedFrames(catalog, c.session), 0)
  const firstWaiting = waiting.find((c) => sessionUnreviewedFrames(catalog, c.session) > 0)
  const open = !isLocked(project)
  const addable = rows.filter((r) => r.blocked === null)

  const label = (r: Suggestion) => `${subjectName(m, catalog, r.subject)} · ${sessionLine(m, r.session)}`
  const status = (r: Suggestion) => (r.blocked ? say(m, r.blocked) : m.status_ready())
  const columns: Column<Suggestion>[] = [
    { id: "session", header: m.project_col_session(), cell: (r) => sessionLine(m, r.session), sortValue: (r) => r.session.night, rowHeader: true, truncate: true },
    { id: "subject", header: m.project_col_subject(), cell: (r) => subjectName(m, catalog, r.subject), sortValue: (r) => subjectName(m, catalog, r.subject), truncate: true },
    { id: "rig", header: m.project_col_rig(), cell: (r) => rigName(m, catalog, r.rigId), sortValue: (r) => rigName(m, catalog, r.rigId), truncate: true },
    { id: "frames", header: m.goal_frames(), cell: (r) => formatCount(liveAssetIds(catalog, r.session).length), sortValue: (r) => liveAssetIds(catalog, r.session).length, align: "right" },
    { id: "status", header: m.dialog_col_status(), cell: status, sortValue: status, truncate: true },
  ]
  const addLabel = m.session_add_to_project()
  const rowActions = (r: Suggestion): MenuItem[] => [
    { id: "open-session", label: m.project_open_session(), icon: Eye, run: () => openSession(navigate, r.session.id) },
    ...(open
      ? [
          {
            id: "add",
            label: addLabel,
            icon: Plus,
            unavailable: r.blocked ? { action: m.actions_blocked({ action: addLabel }), reason: say(m, r.blocked), blockers: [{ label: label(r), link: { to: "/sessions/$sessionId", params: { sessionId: r.session.id } } }] } : undefined,
            run: () => addSessions(project.id, [r.session.id]),
          },
        ]
      : []),
  ]
  const actions: Action[] = [
    ...(open && addable.length > 0 ? [{ id: "add-all", label: m.project_add_suggested({ count: addable.length }), icon: Plus, run: () => addSessions(project.id, addable.map((r) => r.session.id)) }] : []),
    ...(unreviewed > 0 && firstWaiting ? [{ id: "review", label: m.domain_next_review_new_frames({ count: unreviewed, n: formatCount(unreviewed) }), run: () => follow(sessionIntakeLink(firstWaiting.session.id, "review")) }] : []),
  ]

  return {
    id: "suggestions",
    title: m.project_suggestions(),
    count: rows.length,
    flush: true,
    actions,
    content: (
      <BoxTable
        label={m.project_suggestions_of({ name: project.name })}
        rows={rows}
        columns={columns}
        getRowId={(r) => `${r.session.id}|${r.rigId}`}
        initialSort={{ columnId: "session", direction: "desc" }}
        rowLabel={label}
        rowActions={rowActions}
        empty={m.project_no_suggestions()}
      />
    ),
  }
}

// ---------------------------------------------------------------------------
// Goals (C7)
// ---------------------------------------------------------------------------

type GoalDraft = { goalId: string | null; target: string; channel: Goal["channel"]; kinds: GoalKinds }

/** "subjectId|groupId" for a goal's subject, or its panel group in a mosaic. */
const targetKey = (subjectId: string, groupId: string | null) => `${subjectId}|${groupId ?? ""}`

function goalStatus(p: GoalProgress): "met" | "partial" | "missing" {
  if (p.met) return "met"
  return (p.measure.fraction ?? 0) > 0 ? "partial" : "missing"
}

/**
 * Goals: one row per goal, its counted progress and what the bar leaves out.
 * Add goal… and Edit… share one dialog; Apply template… copies a template's
 * values and conditions in (D-W30, C7). A mosaic's goals are per panel group
 * (PRJ-FR-29). A closed Project reads its frozen figures (`goalProgress`,
 * C7) and offers no edit. `?add=goal` (Home's Add a Goal) opens Add goal;
 * closing the dialog clears it.
 */
export function useGoalsSection(project: Project): DetailSection {
  const m = useMessages()
  const navigate = useNavigate()
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const catalog = useStore((s) => s.catalog)
  const progress = useStore((s) => (s.catalog.projects[project.id] ? goalProgressOf(s, project) : []))
  const [draft, setDraft] = useState<GoalDraft | null>(null)
  const [applying, setApplying] = useState(false)
  const open = !isLocked(project)
  const channels = projectChannels(catalog, project.rigIds)
  const panels = panelGroups(project)

  const targets = project.subjects.flatMap((s) =>
    panels.length > 0 ? panels.map((g) => ({ value: targetKey(s.id, g.id), label: subjectLabel(m, catalog, project, s.id, g.id) })) : [{ value: targetKey(s.id, null), label: subjectName(m, catalog, s) }],
  )
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
  const subjectOf = (p: GoalProgress) => subjectLabel(m, catalog, project, p.goal.subjectId, p.goal.groupId)
  const columns: Column<GoalProgress>[] = [
    { id: "subject", header: m.project_col_subject(), cell: subjectOf, sortValue: subjectOf, rowHeader: true, truncate: true },
    { id: "channel", header: m.target_channel(), cell: (p) => p.goal.channel, sortValue: (p) => p.goal.channel },
    { id: "goal", header: m.project_goals_title(), cell: (p) => kindsLine(m, p.goal), sortValue: (p) => kindsLine(m, p.goal) },
    { id: "progress", header: m.project_col_progress(), cell: (p) => say(m, p.amounts), sortValue: (p) => p.measure.fraction ?? 0, truncate: true },
    { id: "below", header: m.project_col_below_bar(), cell: (p) => (p.belowBarLine ? say(m, p.belowBarLine) : "–"), sortValue: (p) => p.belowBar.seconds },
    { id: "status", header: m.dialog_col_status(), cell: (p) => <StatusBadge kind="checklist" value={goalStatus(p)} />, sortValue: goalStatus },
  ]
  const write = (goals: Goal[]): CommitResult => setGoals(project.id, goals, project.revision)
  const rowActions = (p: GoalProgress): MenuItem[] =>
    open
      ? [
          { id: "edit", label: m.project_edit(), icon: Pencil, opensDialog: true, run: () => setDraft({ goalId: p.goal.id, target: targetKey(p.goal.subjectId, p.goal.groupId), channel: p.goal.channel, kinds: p.goal }) },
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
          unavailable: targets.length === 0 ? { action: m.actions_blocked({ action: m.goal_add() }), reason: m.project_goal_needs_subject(), blockers: [] } : undefined,
          run: () => setDraft(newGoal()),
        },
        { id: "apply-template", label: m.goal_apply_template(), opensDialog: true, run: () => setApplying(true) },
      ]
    : []

  function save(next: GoalDraft): CommitResult {
    const [subjectId = "", groupId = ""] = next.target.split("|")
    const goal: Goal = { id: next.goalId ?? freshId("goal", `${subjectId}|${next.channel}`), subjectId, groupId: groupId || null, channel: next.channel, ...next.kinds }
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
                  <SelectField label={m.target_channel()} value={draft.channel} options={channels.map((c) => ({ value: c, label: c }))} onChange={(channel) => setDraft({ ...draft, channel })} />
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
  /** Sessions of this subject the Project holds. */
  sessions: number
}

/** A mosaic's panel balance per channel: the out-of-balance channels first; "–" for a plain Project. */
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
      (progress): SubjectRow => ({
        progress,
        target: subjectName(m, s.catalog, progress.subject),
        sessions: project.inputs.filter((i) => {
          const session = s.catalog.sessions[i.sessionId]
          return session !== undefined && sessionTargetId(session) === progress.subject.targetId
        }).length,
      }),
    )
  })
  const [adding, setAdding] = useState(false)
  const [changing, setChanging] = useState<Subject | null>(null)
  const open = !isLocked(project)
  const mosaic = isMosaic(project)
  const taken = project.subjects.map((s) => subjectTarget(catalog, s)?.name ?? "")
  const kind = mosaic ? m.project_mosaic_of_panels({ count: panelGroups(project).length }) : m.project_target_label()

  const columns: Column<SubjectRow>[] = [
    { id: "subject", header: m.project_col_subject(), cell: (r) => r.target, sortValue: (r) => r.target, rowHeader: true, truncate: true },
    { id: "kind", header: m.project_col_kind(), cell: () => kind, truncate: true, sortValue: () => kind },
    { id: "progress", header: m.project_col_progress(), cell: (r) => (r.progress.line ? say(m, r.progress.line) : "–"), sortValue: (r) => r.progress.fraction, truncate: true },
    { id: "balance", header: m.project_col_panel_balance(), cell: (r) => balanceLine(m, r.progress), sortValue: (r) => Number(r.progress.balanced), truncate: true },
    { id: "ratio", header: m.project_col_channel_ratio(), cell: (r) => (r.progress.ratio ? say(m, r.progress.ratio.line) : "–"), sortValue: (r) => (r.progress.ratio ? say(m, r.progress.ratio.line) : null), truncate: true },
    { id: "window", header: m.project_col_window(), cell: (r) => (r.progress.window ? say(m, r.progress.window.line) : "–"), sortValue: (r) => r.progress.window?.nightsLeft ?? null },
    { id: "sessions", header: m.nav_sessions(), cell: (r) => r.sessions, sortValue: (r) => r.sessions, align: "right" },
  ]
  const rowActions = (r: SubjectRow): MenuItem[] => {
    const subject = r.progress.subject
    const target = subjectTarget(catalog, subject)
    const goals = project.goals.filter((g) => g.subjectId === subject.id).length
    return [
      ...(target ? [{ id: "open-target", label: m.project_open_target(), icon: Crosshair, run: () => void navigate({ to: "/targets/$targetId", params: { targetId: target.id } }) }] : []),
      ...(open
        ? [
            { id: "edit", label: m.project_edit(), icon: Pencil, opensDialog: true, run: () => setChanging(subject) },
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
  const actions: Action[] = open ? [{ id: "add-subject", label: m.store_label_add_subject(), icon: Plus, opensDialog: true, run: () => setAdding(true) }] : []

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
            return resolved.ok ? addSubject(project.id, resolved.targetId, project.revision) : { ok: false, reason: "write-failed", message: resolved.message }
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

/** The Project's rigs: adding or removing one changes suggestions only; held sessions stay held (PRJ-FR-02). */
export function useRigsSection(project: Project): DetailSection {
  const m = useMessages()
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const suggestions = useStore((s) => projectSuggestions(s.catalog, project))
  const [adding, setAdding] = useState(false)
  const others = Object.values(catalog.opticalTrains).filter((r) => !project.rigIds.includes(r.id))
  const [choice, setChoice] = useState("")
  const open = !isLocked(project)
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
  const suggested = (id: string) => suggestions.filter((c) => c.rigId === id).length
  const columns: Column<string>[] = [
    { id: "rig", header: m.project_col_rig(), cell: (id) => rigName(m, catalog, id), sortValue: (id) => rigName(m, catalog, id), rowHeader: true, truncate: true },
    { id: "camera", header: m.project_col_camera(), cell: camera, sortValue: camera },
    { id: "channels", header: m.project_col_channels(), cell: (id) => projectChannels(catalog, [id as OpticalTrainId]).join(", ") || "–", sortValue: (id) => projectChannels(catalog, [id as OpticalTrainId]).length, truncate: true },
    { id: "field", header: m.project_col_field(), cell: field, sortValue: field },
    { id: "suggestions", header: m.project_suggestions(), cell: suggested, sortValue: suggested, align: "right" },
  ]
  const rowActions = (id: string): MenuItem[] => [
    { id: "equipment", label: m.project_open_in({ name: m.settings_equipment() }), icon: Eye, run: () => void navigate({ to: "/settings/equipment" }) },
    ...(open
      ? [
          { separator: true } as const,
          {
            id: "remove",
            label: m.project_remove(),
            icon: X,
            kind: "destructive" as const,
            confirm: { title: m.project_remove_from_title({ name: rigName(m, catalog, id), project: project.name }), confirm: { label: m.project_remove(), kind: "destructive" as const } },
            run: () => removeRig(project.id, id as OpticalTrainId, project.revision),
          },
        ]
      : []),
  ]
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
// Archived sessions (STO-FR-13, D-W111)
// ---------------------------------------------------------------------------

/** The sessions Close project archived, with where each went; there is no Restore (D-W111). */
export function useArchivedSection(project: Project): DetailSection | null {
  const m = useMessages()
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const ids = project.archive?.sessionIds ?? []
  const sessions = ids.map((id) => catalog.sessions[id]).filter((s): s is Session => s !== undefined)
  if (sessions.length === 0) return null

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
    content: (
      <BoxTable
        label={m.project_archived_of({ name: project.name })}
        rows={sessions}
        columns={columns}
        getRowId={(s) => s.id}
        rowLabel={(s) => sessionLine(m, s)}
        rowActions={(s) => [{ id: "open-session", label: m.project_open_session(), icon: Eye, run: () => openSession(navigate, s.id) }]}
      />
    ),
  }
}
