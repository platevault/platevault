/**
 * The Project's Sessions tab (065 PRJ-FR-07/08/19/27 to 31, 066 VSEL-FR-02,
 * 10, 15): its groups, the whole sessions each holds, the sessions it may
 * add, its goals per subject or mosaic panel, and its subjects and rigs.
 *
 * Membership is whole sessions (PRJ-FR-19): a session joins, moves between
 * groups of its own rig, or leaves, all its frames with it. Groups are the
 * library's: by rig and framing, or the user's, with a folder each and
 * optionally a mosaic panel (PRJ-FR-29). Every edit echoes the revision
 * `project_inputs` read and lands as a pending change until Apply; a stale
 * one is refused and the tab re-reads. Selection lives in this page, which
 * remounts per Project, so a bulk action never acts on another Project's
 * ticks (astro-plan-409cm.9).
 *
 * Subjects, rigs and goals are listed from what the library reports; edits
 * that replace a whole list wait for the Project record read
 * (astro-plan-wre19.3) and say so.
 */
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { Eye, FolderPlus, LayoutGrid, Pencil, Plus, Scissors, Trash2 } from "lucide-react"
import { useState } from "react"
import { type ActionResult, type GoalProgress, library, type ProjectCapture_Serialize, type ProjectDesired_Serialize, type ProjectGroup, type ProjectInputs_Serialize, type ProjectSessionMember, type ProjectSuggestion } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { BoxTable } from "@/components/app/box"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { DataTable } from "@/components/app/data-table"
import { KeyValueList } from "@/components/app/data"
import { ActionError, TableSkeleton } from "@/components/app/feedback"
import { SelectField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { failureMessage } from "@/components/app/run-result"
import { DetailPage, type DetailSection } from "@/components/templates/detail-page"
import { failureOf } from "@/api/ipc"
import { formatCount, formatDateTime, formatHours, numberText } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import type { ProjectTabProps } from "./project-page"
import { inputsQuery, isLocked, type ProjectHeader, progressQuery, projectWrite, rigQuery, useProjectRecord } from "./queries"
import { labelOf, useSessionSummaries } from "./sessions"

/** Each rig's saved name, read once per rig. */
function useRigNames(rigIds: readonly string[]): (rigId: string) => string {
  const m = useMessages()
  const unique = [...new Set(rigIds)]
  const reads = useQueries({ queries: unique.map((id) => rigQuery(id)) })
  return (rigId) => reads[unique.indexOf(rigId)]?.data?.equipment.name ?? m.project_col_rig()
}

export function SessionsTab({ header, chrome }: ProjectTabProps) {
  const m = useMessages()
  const inputs = useQuery(inputsQuery(header.id))
  if (inputs.error) {
    const failure = failureOf(inputs.error)
    return <DetailPage {...chrome} title={header.name} sections={[{ id: "sessions-error", title: m.project_tab_sessions(), content: <ActionError message={failure ? failureMessage(m, failure) : m.action_failure_unreachable()} onRetry={() => void inputs.refetch()} /> }]} />
  }
  if (!inputs.data) return <DetailPage {...chrome} title={header.name} sections={[{ id: "sessions-loading", title: m.project_tab_sessions(), content: <TableSkeleton rows={4} columns={4} label={m.common_loading()} /> }]} />
  return <SessionsBody header={header} chrome={chrome} inputs={inputs.data} />
}

function SessionsBody({ header, chrome, inputs }: { header: ProjectHeader; chrome: ProjectTabProps["chrome"]; inputs: ProjectInputs_Serialize }) {
  const m = useMessages()
  const desired = inputs.desired
  const locked = isLocked(desired.lifecycle)
  const record = useProjectRecord(header.id)
  const progress = useQuery(progressQuery(header.id))
  const rigName = useRigNames([...desired.groups.map((g) => g.rigId), ...inputs.suggestions.map((s) => s.rigId)])
  const sessions = useSessionSummaries([...desired.sessions.map((s) => s.sessionId), ...inputs.suggestions.map((s) => s.sessionId)])
  const sessionName = (id: string) => labelOf(sessions, id)
  const groupName = (id: string) => desired.groups.find((g) => g.id === id)?.name ?? m.project_group_missing()
  const subjectName = (subjectId: string): string => {
    if (record.state === "ready") {
      const subject = record.project.subjects.find((s) => s.id === subjectId)
      if (subject) return subject.name ?? subject.designation
    }
    // One subject is unambiguous without the record.
    return header.subjects.length === 1 ? header.subjects[0]! : m.project_unknown_subject()
  }
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const writes = useWrites(header.id, desired.revision)
  const ctx: SectionContext = { m, header, desired, locked, rigName, sessionName, groupName, writes, open: setDialog }

  const sections: DetailSection[] = [
    groupsSection(ctx, inputs),
    heldSection(ctx),
    suggestionsSection(ctx, inputs.suggestions, subjectName),
    goalsSection(ctx, progress.data?.goals ?? [], subjectName),
    subjectsSection(ctx),
  ]
  if (record.state === "ready" && record.project.notes?.trim()) sections.unshift({ id: "notes", title: m.newproject_notes(), content: record.project.notes })
  return (
    <>
      <DetailPage {...chrome} title={header.name} sections={sections} />
      {dialog ? <SessionsDialog ctx={ctx} dialog={dialog} onClose={() => setDialog(null)} /> : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// Writes: each echoes the revision the tab read
// ---------------------------------------------------------------------------

interface Writes {
  removeSessions: (sessions: string[]) => Promise<ActionResult<unknown>>
  moveSessions: (sessions: string[], groupId: string) => Promise<ActionResult<unknown>>
  addSessions: (suggestions: ProjectSuggestion[]) => Promise<ActionResult<unknown>>
  createGroup: (rigId: string, name: string, sessions: string[]) => Promise<ActionResult<unknown>>
  splitGroup: (groupId: string, sessions: string[], name: string | null) => Promise<ActionResult<unknown>>
  renameGroup: (groupId: string, name: string) => Promise<ActionResult<unknown>>
  setPanel: (groupId: string, panel: boolean) => Promise<ActionResult<unknown>>
  removeGroup: (groupId: string) => Promise<ActionResult<unknown>>
  setFrames: (captureKeys: string[], choice: "exclude" | "include" | "follow_library") => Promise<ActionResult<unknown>>
}

function useWrites(projectId: string, revision: number): Writes {
  const client = useQueryClient()
  const write = <T,>(call: () => Promise<ActionResult<T>>) => projectWrite(client, call)
  return {
    removeSessions: (sessions) => write(() => library.projectRemoveSessions(projectId, revision, sessions)),
    moveSessions: (sessions, groupId) => write(() => library.projectMoveSessions(projectId, revision, sessions, groupId)),
    // Each suggestion carries the admission basis the user saw; the library refuses one that moved since.
    addSessions: (suggestions) => write(() => library.projectAddSessions(projectId, revision, suggestions.map((s) => ({ sessionId: s.sessionId, expected: s.basis })), null)),
    createGroup: (rigId, name, sessions) => write(() => library.projectCreateGroup(projectId, revision, rigId, name, sessions)),
    splitGroup: (groupId, sessions, name) => write(() => library.projectSplitGroup(projectId, revision, groupId, sessions, name)),
    renameGroup: (groupId, name) => write(() => library.projectRenameGroup(projectId, revision, groupId, name)),
    setPanel: (groupId, panel) => write(() => library.projectSetGroupPanel(projectId, revision, groupId, panel, null)),
    removeGroup: (groupId) => write(() => library.projectRemoveGroup(projectId, revision, groupId)),
    setFrames: (captureKeys, choice) => write(() => library.projectSetFrames(projectId, revision, captureKeys, choice)),
  }
}

type Dialog = { kind: "rename"; group: ProjectGroup } | { kind: "new-group"; sessions: string[] } | { kind: "split"; group: ProjectGroup; sessions: string[] }

interface SectionContext {
  m: Messages
  header: ProjectHeader
  desired: ProjectDesired_Serialize
  locked: boolean
  rigName: (rigId: string) => string
  sessionName: (sessionId: string) => string
  groupName: (groupId: string) => string
  writes: Writes
  open: (dialog: Dialog) => void
}

function lockedReason(ctx: SectionContext, label: string): Action["unavailable"] {
  return ctx.locked ? { action: ctx.m.actions_blocked({ action: label }), reason: ctx.m.project_closed(), blockers: [] } : undefined
}

// ---------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------

function framingText(m: Messages, group: ProjectGroup): string {
  if (group.origin === "user") return m.project_group_kind_group()
  return group.framing ? m.project_col_framing() : m.project_framing_unknown()
}

function groupsSection(ctx: SectionContext, inputs: ProjectInputs_Serialize): DetailSection {
  const { m, desired } = ctx
  const groups = [...desired.groups].sort((a, b) => a.position - b.position)
  const folder = (id: string) => inputs.folders.find((f) => f.groupId === id)?.folder ?? null
  const count = (id: string) => desired.sessions.filter((s) => s.groupId === id).length
  const columns: Column<ProjectGroup>[] = [
    { id: "name", header: m.project_col_group(), cell: (g) => g.name, sortValue: (g) => g.position, rowHeader: true, truncate: true },
    { id: "rig", header: m.project_col_rig(), cell: (g) => ctx.rigName(g.rigId), sortValue: (g) => ctx.rigName(g.rigId), truncate: true },
    { id: "framing", header: m.project_col_framing(), cell: (g) => (g.panel ? m.common_mosaic_panel() : framingText(m, g)), sortValue: (g) => framingText(m, g) },
    { id: "sessions", header: m.nav_sessions(), cell: (g) => formatCount(count(g.id)), sortValue: (g) => count(g.id), align: "right" },
    { id: "folder", header: m.project_col_folder(), cell: (g) => folder(g.id) ?? m.project_group_no_folder(), sortValue: (g) => folder(g.id) ?? "", truncate: true },
  ]
  const rowActions = (g: ProjectGroup): MenuItem[] => {
    if (ctx.locked) return []
    const removeLabel = m.project_group_remove()
    return [
      { id: "rename", label: m.project_group_rename(), icon: Pencil, opensDialog: true, run: () => ctx.open({ kind: "rename", group: g }) },
      g.panel
        ? { id: "unmark-panel", label: m.project_group_unmark_panel(), icon: LayoutGrid, confirm: { title: m.project_group_unmark_title({ name: g.name }), summary: m.project_group_unmark_goals(), confirm: { label: m.project_group_unmark_panel() } }, run: () => ctx.writes.setPanel(g.id, false) }
        : { id: "mark-panel", label: m.project_group_mark_panel(), icon: LayoutGrid, run: () => ctx.writes.setPanel(g.id, true) },
      {
        id: "remove-group",
        label: removeLabel,
        icon: Trash2,
        kind: "destructive",
        confirm: { title: m.project_group_remove_title({ name: g.name }), confirm: { label: removeLabel, kind: "destructive" } },
        run: () => ctx.writes.removeGroup(g.id),
      },
    ]
  }
  return {
    id: "groups",
    title: m.project_groups(),
    count: groups.length,
    flush: true,
    content: <BoxTable label={m.project_groups_of({ name: ctx.header.name })} rows={groups} columns={columns} getRowId={(g) => g.id} rowLabel={(g) => g.name} rowActions={rowActions} empty={m.project_no_groups()} />,
  }
}

// ---------------------------------------------------------------------------
// Held sessions
// ---------------------------------------------------------------------------

interface HeldRow {
  member: ProjectSessionMember
  label: string
  captures: ProjectCapture_Serialize[]
  included: number
}

function heldRows(ctx: SectionContext): HeldRow[] {
  return ctx.desired.sessions.map((member) => {
    const captures = ctx.desired.captures.filter((c) => c.sessionId === member.sessionId)
    return { member, label: ctx.sessionName(member.sessionId), captures, included: captures.filter((c) => c.inclusion.state === "included").length }
  })
}

function placementText(m: Messages, member: ProjectSessionMember): string {
  return member.placement === "framing_unknown" ? m.project_framing_unknown() : member.placement === "user" ? m.project_group_kind_group() : m.project_col_framing()
}

function heldSection(ctx: SectionContext): DetailSection {
  return { id: "held", title: ctx.m.nav_sessions(), count: ctx.desired.sessions.length, flush: true, content: <HeldTable ctx={ctx} /> }
}

function HeldTable({ ctx }: { ctx: SectionContext }) {
  const { m } = ctx
  const navigate = useNavigate()
  const [selected, setSelected] = useState<string[]>([])
  const rows = heldRows(ctx)
  const present = selected.filter((id) => rows.some((r) => r.member.sessionId === id))
  const open = (r: HeldRow) => void navigate({ to: "/sessions/$sessionId", params: { sessionId: r.member.sessionId } })
  const columns: Column<HeldRow>[] = [
    { id: "session", header: m.project_col_session(), cell: (r) => r.label, sortValue: (r) => r.label, rowHeader: true, truncate: true },
    { id: "group", header: m.project_col_group(), cell: (r) => ctx.groupName(r.member.groupId), sortValue: (r) => ctx.groupName(r.member.groupId), truncate: true },
    { id: "placement", header: m.project_col_framing(), cell: (r) => placementText(m, r.member), sortValue: (r) => r.member.placement },
    { id: "frames", header: m.goal_frames(), cell: (r) => `${formatCount(r.included)} / ${formatCount(r.captures.length)}`, sortValue: (r) => r.included, align: "right" },
    { id: "added", header: m.project_pending_added(), cell: (r) => formatDateTime(r.member.addedAt), sortValue: (r) => r.member.addedAt },
  ]
  const remove = (ids: string[]): Action => ({
    id: "remove-sessions",
    label: m.project_remove_session(),
    icon: Trash2,
    kind: "destructive",
    unavailable: lockedReason(ctx, m.project_remove_session()),
    confirm: { title: m.project_remove_sessions_title({ count: ids.length, project: ctx.header.name }), summary: m.project_remove_session_summary(), confirm: { label: m.project_remove(), kind: "destructive" } },
    run: async () => {
      const result = await ctx.writes.removeSessions(ids)
      if (result.ok) setSelected([])
      return result
    },
  })
  const membersOf = (ids: string[]) => rows.filter((r) => ids.includes(r.member.sessionId)).map((r) => r.member)
  const batchActions = (ids: string[]): MenuItem[] => {
    const members = membersOf(ids)
    const groups = [...new Set(members.map((s) => s.groupId))]
    const rigs = [...new Set(members.map((s) => ctx.desired.groups.find((g) => g.id === s.groupId)?.rigId))]
    const targets = rigs.length === 1 ? ctx.desired.groups.filter((g) => g.rigId === rigs[0] && !(groups.length === 1 && groups[0] === g.id)) : []
    const splitLabel = m.project_split_group()
    const group = groups.length === 1 ? ctx.desired.groups.find((g) => g.id === groups[0]) : undefined
    return [
      {
        submenu: m.project_move_to_group(),
        items: targets.map((g) => ({ id: `move-${g.id}`, label: g.name, run: () => ctx.writes.moveSessions(ids, g.id) })),
      },
      {
        id: "split",
        label: splitLabel,
        icon: Scissors,
        opensDialog: true,
        unavailable: ctx.locked ? lockedReason(ctx, splitLabel) : !group ? { action: m.actions_blocked({ action: splitLabel }), reason: m.project_split_one_group(), blockers: [] } : undefined,
        run: () => (group ? ctx.open({ kind: "split", group, sessions: ids }) : undefined),
      },
      {
        id: "new-group",
        label: m.project_group_new(),
        icon: FolderPlus,
        opensDialog: true,
        unavailable: ctx.locked ? lockedReason(ctx, m.project_group_new()) : rigs.length !== 1 ? { action: m.actions_blocked({ action: m.project_group_new() }), reason: m.project_new_group_one_rig(), blockers: [] } : undefined,
        run: () => ctx.open({ kind: "new-group", sessions: ids }),
      },
      remove(ids),
    ]
  }
  const rowActions = (r: HeldRow): MenuItem[] => {
    const unusable = r.captures.filter((c) => c.inclusion.state === "excluded" && c.inclusion.basis === "unusable").map((c) => c.captureKey)
    const userExcluded = r.captures.filter((c) => c.inclusion.state === "excluded" && c.inclusion.basis === "user").map((c) => c.captureKey)
    const all = r.captures.map((c) => c.captureKey)
    return [
      { id: "open", label: m.project_open_session(), icon: Eye, run: () => open(r) },
      ...(ctx.locked
        ? []
        : [
            { separator: true as const },
            ...(unusable.length > 0 ? [{ id: "include-unusable", label: m.project_use_unusable(), run: () => ctx.writes.setFrames(unusable, "include") }] : []),
            ...(userExcluded.length > 0 ? [{ id: "follow-library", label: m.project_follow_library(), run: () => ctx.writes.setFrames(userExcluded, "follow_library") }] : []),
            { id: "exclude", label: m.project_leave_out_frames(), run: () => ctx.writes.setFrames(all, "exclude") },
            remove([r.member.sessionId]),
          ]),
    ]
  }
  return (
    <DataTable
      label={m.common_sessions_of({ name: ctx.header.name })}
      rows={rows}
      columns={columns}
      getRowId={(r) => r.member.sessionId}
      rowLabel={(r) => r.label}
      onRowClick={open}
      rowActions={rowActions}
      selection={ctx.locked ? undefined : { selected: present, onChange: setSelected, rowLabel: (r) => r.label, countLabel: (count) => m.project_sessions_selected({ count }) }}
      batchActions={batchActions}
      groups={{ key: (r) => r.member.groupId, label: (key, inGroup) => `${ctx.groupName(key)} · ${m.project_sessions_count({ count: inGroup.length })}` }}
      scroll="none"
      empty={m.project_no_sessions()}
    />
  )
}

// ---------------------------------------------------------------------------
// Suggestions
// ---------------------------------------------------------------------------

function admissionText(m: Messages, suggestion: ProjectSuggestion): string {
  const blocker = suggestion.blockers[0]
  if (!blocker) return m.status_ready()
  switch (blocker.blocker) {
    case "project_locked":
      return m.project_closed()
    case "superseded":
      return m.project_blocker_superseded()
    case "not_ready":
      return m.project_blocker_not_ready()
    case "rig_mismatch":
      return m.project_blocker_rig_mismatch()
    case "calibration_unsettled":
      return m.project_sessions_need_calibration({ count: 1, n: blocker.kinds.length })
  }
}

function suggestionsSection(ctx: SectionContext, suggestions: ProjectSuggestion[], subjectName: (id: string) => string): DetailSection {
  const { m } = ctx
  const ready = suggestions.filter((s) => s.blockers.length === 0)
  const addLabel = m.project_add_suggested({ count: ready.length })
  const add: Action = {
    id: "add-suggested",
    label: addLabel,
    icon: Plus,
    unavailable: ctx.locked ? lockedReason(ctx, addLabel) : ready.length === 0 ? { action: m.actions_blocked({ action: addLabel }), reason: m.project_add_none(), blockers: [] } : undefined,
    run: () => ctx.writes.addSessions(ready),
  }
  const columns: Column<ProjectSuggestion>[] = [
    { id: "session", header: m.project_col_session(), cell: (s) => ctx.sessionName(s.sessionId), sortValue: (s) => ctx.sessionName(s.sessionId), rowHeader: true, truncate: true },
    { id: "subject", header: m.project_col_subject(), cell: (s) => subjectName(s.subjectId), sortValue: (s) => subjectName(s.subjectId), truncate: true },
    { id: "rig", header: m.project_col_rig(), cell: (s) => ctx.rigName(s.rigId), sortValue: (s) => ctx.rigName(s.rigId), truncate: true },
    { id: "status", header: m.dialog_col_status(), cell: (s) => admissionText(m, s), sortValue: (s) => s.blockers.length, truncate: true },
  ]
  const rowActions = (s: ProjectSuggestion): MenuItem[] => {
    const label = m.verb_add()
    return [
      {
        id: "add",
        label,
        icon: Plus,
        unavailable: ctx.locked ? lockedReason(ctx, label) : s.blockers.length > 0 ? { action: m.actions_blocked({ action: label }), reason: admissionText(m, s), blockers: [{ label: ctx.sessionName(s.sessionId), link: { to: "/sessions/$sessionId", params: { sessionId: s.sessionId } } }] } : undefined,
        run: () => ctx.writes.addSessions([s]),
      },
    ]
  }
  return {
    id: "suggestions",
    title: m.project_suggestions(),
    count: suggestions.length,
    actions: [add],
    flush: true,
    content: <BoxTable label={m.project_suggestions_of({ name: ctx.header.name })} rows={suggestions} columns={columns} getRowId={(s) => s.sessionId} rowLabel={(s) => ctx.sessionName(s.sessionId)} rowActions={rowActions} empty={m.project_no_suggestions()} />,
  }
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

function goalLine(m: Messages, progress: GoalProgress): { goal: string; inProject: string; captured: string } {
  const goal = progress.goal
  if (goal.kind === "integration")
    return { goal: formatHours(goal.goalSeconds), inProject: formatHours(progress.inProject.seconds ?? 0), captured: formatHours(progress.captured.seconds ?? 0) }
  if (goal.kind === "frame_count") return { goal: formatCount(goal.goalFrames), inProject: formatCount(progress.inProject.frames), captured: formatCount(progress.captured.frames) }
  const bar = goal.criterion.criterion === "usable_only" ? m.goal_usable_frames() : m.domain_quality_max_fwhm({ arcsec: goal.criterion.maxArcsec === null ? "–" : numberText(goal.criterion.maxArcsec) })
  return { goal: bar, inProject: "–", captured: "–" }
}

function goalsSection(ctx: SectionContext, goals: GoalProgress[], subjectName: (id: string) => string): DetailSection {
  const { m } = ctx
  const rows = goals.map((g, i) => ({ ...g, id: g.goal.id ?? String(i), line: goalLine(m, g) }))
  const columns: Column<(typeof rows)[number]>[] = [
    { id: "subject", header: m.project_col_subject(), cell: (r) => (r.goal.groupId ? `${subjectName(r.goal.subjectId)} · ${ctx.groupName(r.goal.groupId)}` : subjectName(r.goal.subjectId)), sortValue: (r) => subjectName(r.goal.subjectId), rowHeader: true, truncate: true },
    { id: "channel", header: m.project_col_channels(), cell: (r) => ("channel" in r.goal ? (r.goal.channel ?? "–") : "–"), sortValue: (r) => ("channel" in r.goal ? (r.goal.channel ?? "") : "") },
    { id: "goal", header: m.project_goals_title(), cell: (r) => r.line.goal, sortValue: (r) => r.line.goal },
    { id: "in-project", header: m.project_in_project(), cell: (r) => r.line.inProject, sortValue: (r) => r.inProject.frames, align: "right" },
    { id: "captured", header: m.project_captured(), cell: (r) => r.line.captured, sortValue: (r) => r.captured.frames, align: "right" },
    { id: "met", header: m.dialog_col_status(), cell: (r) => (r.met ? m.status_done() : r.unknownForBar > 0 ? m.project_goal_unknown_for_bar({ count: r.unknownForBar }) : "–"), sortValue: (r) => (r.met ? 1 : 0) },
  ]
  const editLabel = m.goal_add()
  return {
    id: "goals",
    title: m.project_goals_title(),
    count: goals.length,
    // Goal edits replace the whole list by Target: they need the Project record (astro-plan-wre19.3) and the goal dialogs, so
    // the action stays visibly unavailable until both exist.
    actions: [
      {
        id: "add-goal",
        label: editLabel,
        icon: Plus,
        opensDialog: true,
        unavailable: { action: m.actions_blocked({ action: editLabel }), reason: m.project_edit_unavailable(), blockers: [] },
        run: () => undefined,
      },
    ],
    flush: true,
    content: <BoxTable label={m.project_goals_of({ name: ctx.header.name })} rows={rows} columns={columns} getRowId={(r) => r.id} empty={m.projects_no_goals()} />,
  }
}

// ---------------------------------------------------------------------------
// Subjects and rigs
// ---------------------------------------------------------------------------

function subjectsSection(ctx: SectionContext): DetailSection {
  const { m, header, desired } = ctx
  const rigs = [...new Set(desired.groups.map((g) => g.rigId))]
  const editLabel = m.project_edit()
  return {
    id: "subjects-rigs",
    title: `${m.project_subjects()} · ${m.project_rigs()}`,
    // Subject and rig edits replace whole lists too: unavailable until the record (astro-plan-wre19.3) and their dialogs exist.
    actions: [
      {
        id: "edit-subjects",
        label: editLabel,
        icon: Pencil,
        opensDialog: true,
        unavailable: { action: m.actions_blocked({ action: editLabel }), reason: m.project_edit_unavailable(), blockers: [] },
        run: () => undefined,
      },
    ],
    content: (
      <KeyValueList
        items={[
          { label: m.project_subjects(), value: header.subjects.join(", ") || m.projects_no_subjects() },
          { label: m.project_rigs(), value: rigs.length > 0 ? rigs.map(ctx.rigName).join(", ") : m.project_rigs_count({ count: header.rigCount }) },
        ]}
      />
    ),
  }
}

// ---------------------------------------------------------------------------
// Dialogs: rename, split, new group
// ---------------------------------------------------------------------------

function SessionsDialog({ ctx, dialog, onClose }: { ctx: SectionContext; dialog: Dialog; onClose: () => void }) {
  const { m } = ctx
  const initial = dialog.kind === "rename" ? dialog.group.name : ""
  const [name, setName] = useState(initial)
  const rigsOfSelection = dialog.kind === "new-group" ? [...new Set(ctx.desired.sessions.filter((s) => dialog.sessions.includes(s.sessionId)).map((s) => ctx.desired.groups.find((g) => g.id === s.groupId)?.rigId ?? ""))] : []
  const [rigId, setRigId] = useState(rigsOfSelection[0] ?? "")
  const blank = name.trim() === ""
  const title = dialog.kind === "rename" ? m.common_rename_title({ name: dialog.group.name }) : dialog.kind === "split" ? m.project_label_split_group({ name: dialog.group.name }) : m.project_group_new()
  const label = dialog.kind === "rename" ? m.project_group_rename() : dialog.kind === "split" ? m.project_split_confirm() : m.project_label_create_group({ name: name.trim() || m.project_group_new() })
  const confirm: Action = {
    id: `${dialog.kind}-confirm`,
    label,
    kind: "primary",
    // A split may go unnamed: the library names it "<Rig> · 2".
    unavailable: blank && dialog.kind !== "split" ? { action: m.actions_blocked({ action: label }), reason: m.project_name_required(), blockers: [] } : undefined,
    run: () => {
      if (dialog.kind === "rename") return ctx.writes.renameGroup(dialog.group.id, name.trim())
      if (dialog.kind === "split") return ctx.writes.splitGroup(dialog.group.id, dialog.sessions, blank ? null : name.trim())
      return ctx.writes.createGroup(rigId, name.trim(), dialog.sessions)
    },
  }
  return (
    <FormDialog open onOpenChange={(next) => !next && onClose()} title={title} size="sm" confirm={confirm}>
      {dialog.kind === "new-group" && rigsOfSelection.length > 1 ? <SelectField label={m.project_col_rig()} value={rigId} options={rigsOfSelection.map((id) => ({ value: id, label: ctx.rigName(id) }))} onChange={setRigId} /> : null}
      <TextField label={m.newproject_field_name()} value={name} onChange={setName} autoFocus description={dialog.kind === "split" ? m.project_split_moves({ count: dialog.sessions.length }) : undefined} />
    </FormDialog>
  )
}
