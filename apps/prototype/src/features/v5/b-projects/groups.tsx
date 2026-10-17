/**
 * S3 Project, Sessions tab (slice B): the groups, the sessions they hold, a
 * mosaic's panel map and the suggestions (PRJ-FR-08, PRJ-FR-09, PRJ-FR-27
 * to PRJ-FR-31, VSEL-FR-02, VSEL-FR-03). A group is one rig and framing, or
 * a mosaic panel; sessions join, move and split as whole sessions, never as
 * single frames (PRJ-AC-47). Every edit changes the desired state only:
 * once the View exists, each row names its pending change and where it came
 * from until the next Apply (VSEL-FR-12). A Closed or Archived Project is
 * read-only and takes no suggestions (VSEL-AC-20).
 */
import { useNavigate } from "@tanstack/react-router"
import { Eye, FolderInput, Pencil, Plus, Split, X } from "lucide-react"
import { useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { BoxTable } from "@/components/app/box"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { rowIssues, withIssueItems } from "@/components/app/issue-actions"
import { SelectField, SwitchField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { useFollowLink } from "@/components/app/links"
import { DuplicatesBadge } from "@/components/domain/duplicates-badge"
import { MosaicField, mosaicFieldModel } from "@/components/domain/mosaic-field"
import type { DetailSection } from "@/components/templates/detail-page"
import { KIND_NAME } from "@/domain/calibration"
import {
  findGroup,
  goalProgress,
  isLocked,
  isMosaic,
  liveAssetIds,
  panelGroups,
  projectSessionsNeedingReview,
  projectSuggestions,
  rigName,
  sessionIntakeLink,
  sessionRigId,
  sessionUnreviewedFrames,
  subjectName,
  type Suggestion,
} from "@/domain/derive"
import { framesRef } from "@/domain/membership"
import { CHANGE_SOURCE_NAME, groupFolder, groupInputs, panelGroupName, type PendingChange, pendingChanges, splitGroupName } from "@/domain/project-view"
import { sessionDuplicateCopies } from "@/domain/storage"
import type { Catalog, Project, ProjectGroup, ProjectGroupId, ProjectInput, Session, SessionId } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { addSessions, createGroup, moveSessions, removeGroup, removeSessions, renameGroup, setGroupPanel, splitGroup } from "@/store/actions/projects"
import { type CommitResult, type PrototypeState, useStore } from "@/store/core"
import { useIssues } from "@/store/issues"
import { AddSessionsDialog } from "./add-sessions"
import { framingLine, sessionLine, sessionSubjectName, unavailableFor as blocked } from "./parts"

const openSession = (navigate: ReturnType<typeof useNavigate>, sessionId: string) => void navigate({ to: "/sessions/$sessionId", params: { sessionId } })

/** A session row's own cell: its line, with the F5 duplicates badge when its frames have extra copies (the same badge as Sessions). */
function SessionCell({ session }: { session: Session }) {
  const m = useMessages()
  const copies = useStore(sessionDuplicateCopies).get(session.id) ?? 0
  if (copies === 0) return sessionLine(m, session)
  return (
    <>
      {sessionLine(m, session)} <DuplicatesBadge count={copies} />
    </>
  )
}

/** A pending change in its row's own terms, with its source: "Moved from RedCat 51 (Project)", "Dark changed (Calibration)". */
function pendingLine(m: Messages, project: Project, change: PendingChange): string {
  const source = say(m, CHANGE_SOURCE_NAME[change.source])
  return m.project_pending_with_source({ change: pendingWhat(m, project, change), source })
}

function pendingWhat(m: Messages, project: Project, change: PendingChange): string {
  switch (change.kind) {
    case "session-added":
      return m.project_pending_added()
    case "session-moved":
      return m.project_pending_moved({ group: (project.view?.groups ?? project.groups).find((g) => g.id === change.from)?.name ?? m.project_group_missing() })
    case "frames-excluded":
    case "frames-included":
    case "frames-rejected":
    case "frames-restored":
      return m.project_pending_frames({ count: change.assetIds.length, n: formatCount(change.assetIds.length) })
    case "calibration-changed":
      return m.project_pending_calibration({ kind: say(m, KIND_NAME[change.pinKind]) })
    case "group-renamed":
      return m.project_pending_renamed({ name: change.from })
    default:
      return say(m, change.label)
  }
}

/** The pending lines that `matches` picks, or "–". */
function pendingCell(m: Messages, project: Project, changes: PendingChange[], matches: (change: PendingChange) => boolean): string {
  return (
    changes
      .filter(matches)
      .map((c) => pendingLine(m, project, c))
      .join("; ") || "–"
  )
}

const ofSession = (sessionId: SessionId) => (change: PendingChange) => "sessionId" in change && change.sessionId === sessionId

// ---------------------------------------------------------------------------
// Groups (PRJ-FR-27 to PRJ-FR-29)
// ---------------------------------------------------------------------------

/** What the group dialog writes: a new group, a rename, or a group marked as a mosaic panel under the name it takes. */
type GroupDraft = { mode: "new" | "rename" | "panel"; groupId: ProjectGroupId | null; name: string; panel: boolean }

/** The name New group… starts from: the next "Panel N" in a mosaic, else "<first group> · 2", else the Project's first rig. */
function newGroupName(m: Messages, catalog: Catalog, project: Project): string {
  if (isMosaic(project)) return panelGroupName(m, project, [])
  const first = project.groups[0]
  if (first) return splitGroupName(m, project, first)
  return project.rigIds[0] ? rigName(m, catalog, project.rigIds[0]) : ""
}

/** The capture names of a group's sessions, which may carry a NINA panel number. */
function captureNames(catalog: Catalog, project: Project, groupId: ProjectGroupId): Array<string | null> {
  return groupInputs(project, groupId).map((i) => catalog.sessions[i.sessionId]?.objectLabel ?? null)
}

/**
 * The Project's groups: one rig and framing each, or a mosaic panel. New
 * group… names it (and may mark it a panel); Rename… changes its folder on
 * the next Apply. Mark as mosaic panel… names the panel ("Panel N", or the
 * NINA panel number) and makes the Project a mosaic: PANEL_ folders, goals
 * per panel and the panel map. Remove is offered once the group is empty.
 * The folder column shows the group level only when the Project has
 * several groups (PRJ-AC-48).
 */
export function useGroupsSection(project: Project): DetailSection {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const settings = useStore((s) => s.settings)
  const changes = useStore((s) => pendingChanges(s, project))
  const [draft, setDraft] = useState<GroupDraft | null>(null)
  const open = !isLocked(project)
  const several = project.groups.length > 1
  const held = (group: ProjectGroup) => groupInputs(project, group.id).length
  const kind = (group: ProjectGroup) => (group.panel ? m.common_mosaic_panel() : m.project_group_kind_group())
  const folder = (group: ProjectGroup) => (several ? groupFolder({ settings }, project, group) : m.project_group_no_folder())
  const pending = (group: ProjectGroup) => pendingCell(m, project, changes, (c) => c.kind === "group-renamed" && c.groupId === group.id)
  const columns: Column<ProjectGroup>[] = [
    { id: "name", header: m.newproject_field_name(), cell: (g) => g.name, sortValue: (g) => g.name, rowHeader: true, truncate: true },
    { id: "kind", header: m.project_col_kind(), cell: kind, sortValue: kind },
    { id: "folder", header: m.project_col_folder(), cell: folder, sortValue: folder, truncate: true },
    { id: "sessions", header: m.nav_sessions(), cell: held, sortValue: held, align: "right" },
    { id: "pending", header: m.project_pending_changes(), cell: pending, sortValue: pending, truncate: true },
  ]
  const panelItem = (group: ProjectGroup): MenuItem =>
    group.panel
      ? {
          id: "unmark-panel",
          label: m.project_group_unmark_panel(),
          confirm: {
            title: m.project_group_unmark_title({ name: group.name }),
            summary: panelGroups(project).length === 1 ? m.project_group_unmark_last() : m.project_group_unmark_goals(),
            confirm: { label: m.project_group_unmark_panel() },
          },
          run: () => setGroupPanel(project.id, group.id, false),
        }
      : {
          id: "mark-panel",
          label: m.project_group_mark_panel(),
          opensDialog: true,
          run: () => setDraft({ mode: "panel", groupId: group.id, name: panelGroupName(m, project, captureNames(catalog, project, group.id), group.id), panel: true }),
        }
  const rowActions = (group: ProjectGroup): MenuItem[] => {
    if (!open) return []
    const removeLabel = m.project_group_remove()
    return [
      { id: "rename", label: m.project_group_rename(), icon: Pencil, opensDialog: true, run: () => setDraft({ mode: "rename", groupId: group.id, name: group.name, panel: group.panel }) },
      panelItem(group),
      { separator: true },
      {
        id: "remove",
        label: removeLabel,
        icon: X,
        kind: "destructive",
        unavailable: held(group) > 0 ? blocked(m, removeLabel, m.project_reason_group_holds({ count: held(group) })) : undefined,
        confirm: { title: m.project_group_remove_title({ name: group.name }), confirm: { label: m.project_remove(), kind: "destructive" } },
        run: () => removeGroup(project.id, group.id),
      },
    ]
  }
  const actions: Action[] = open ? [{ id: "new-group", label: m.project_group_new(), icon: Plus, opensDialog: true, run: () => setDraft({ mode: "new", groupId: null, name: newGroupName(m, catalog, project), panel: isMosaic(project) }) }] : []

  function save(next: GroupDraft): CommitResult {
    if (next.mode === "new") return createGroup(project.id, next.name, next.panel).result
    const group = project.groups.find((g) => g.id === next.groupId)
    if (!group) return { ok: false, reason: "write-failed", message: m.project_group_missing() }
    if (next.mode === "rename") return renameGroup(project.id, group.id, next.name)
    if (next.name.trim() !== group.name) {
      const renamed = renameGroup(project.id, group.id, next.name)
      if (!renamed.ok) return renamed
    }
    return setGroupPanel(project.id, group.id, true)
  }

  const editing = draft?.groupId ? project.groups.find((g) => g.id === draft.groupId) : undefined
  const title = !draft || draft.mode === "new" ? m.project_group_new() : draft.mode === "rename" ? m.common_rename_title({ name: editing?.name ?? "" }) : m.project_group_mark_panel_title({ name: editing?.name ?? "" })
  const saveLabel = !draft || draft.mode === "new" ? m.project_group_new() : draft.mode === "rename" ? m.settings_save() : m.project_group_mark_panel()
  const nameError = draft && !draft.name.trim() ? m.settings_name_required() : undefined
  // Marking the first panel turns the Project into a mosaic: the one consequence the dialog names.
  const panelFirst = draft?.panel && draft.mode !== "rename" && !isMosaic(project) ? m.project_group_panel_first() : undefined
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
          title={title}
          size="sm"
          confirm={{ id: "group-save", label: saveLabel, kind: "primary", run: () => (draft ? save(draft) : undefined), unavailable: nameError ? blocked(m, saveLabel, nameError) : undefined }}
        >
          {draft ? (
            <>
              <TextField label={m.newproject_field_name()} value={draft.name} onChange={(name) => setDraft({ ...draft, name })} description={draft.mode === "panel" ? panelFirst : undefined} error={nameError} required autoFocus />
              {draft.mode === "new" ? <SwitchField label={m.common_mosaic_panel()} description={panelFirst} checked={draft.panel} onChange={(panel) => setDraft({ ...draft, panel })} /> : null}
            </>
          ) : null}
        </FormDialog>
      </>
    ),
  }
}

// ---------------------------------------------------------------------------
// Held sessions (PRJ-FR-08, PRJ-FR-27, VSEL-FR-02)
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

/** Sessions to move into another group, and the group chosen. */
type MoveDraft = { sessionIds: SessionId[]; groupId: ProjectGroupId }
/** Sessions of one group to split into a new group, and its name ("RedCat 51 · 2" until the user changes it). */
type SplitDraft = { groupId: ProjectGroupId; sessionIds: SessionId[]; name: string }

/**
 * The sessions the Project holds, under their groups. Add sessions… opens
 * the picker over Ready sessions (VSEL-FR-03). Ticked sessions move into
 * another group, split into a new group (named "<Group> · 2" first,
 * PRJ-AC-44) or leave the Project, always whole; each row's menu does the
 * same for one session, and offers Dismiss issue for the session's issues
 * (Restore issue once dismissed; F7). With no sessions, the empty text
 * points to the suggestions while there are some, else to Add sessions….
 * Files, the library and other Projects never change.
 */
export function useHeldSection(project: Project): DetailSection {
  const m = useMessages()
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const rows = useStore((s) => heldRows(s, project))
  const changes = useStore((s) => pendingChanges(s, project))
  const suggested = useStore((s) => projectSuggestions(s.catalog, project).length > 0)
  const issueView = useIssues()
  const [selected, setSelected] = useState<string[]>([])
  const [adding, setAdding] = useState(false)
  const [moving, setMoving] = useState<MoveDraft | null>(null)
  const [splitting, setSplitting] = useState<SplitDraft | null>(null)
  const open = !isLocked(project)
  const heldIds = new Set<string>(rows.map((r) => r.session.id))
  // A session that left the Project (another tab, Undo) drops out of the selection.
  const chosen = selected.filter((id) => heldIds.has(id)) as SessionId[]
  const chosenGroups = new Set(rows.filter((r) => chosen.includes(r.session.id)).map((r) => r.input.groupId))

  const label = (r: HeldRow) => `${sessionSubjectName(m, catalog, project, r.session)} · ${sessionLine(m, r.session)}`
  const rigOf = (r: HeldRow) => rigName(m, catalog, sessionRigId(r.session))
  const framing = (r: HeldRow) => framingLine(m, catalog, r.session)
  const pending = (r: HeldRow) => pendingCell(m, project, changes, ofSession(r.session.id))
  const columns: Column<HeldRow>[] = [
    { id: "session", header: m.project_col_session(), cell: (r) => <SessionCell session={r.session} />, sortValue: (r) => r.session.night, rowHeader: true },
    { id: "subject", header: m.project_col_subject(), cell: (r) => sessionSubjectName(m, catalog, project, r.session), sortValue: (r) => sessionSubjectName(m, catalog, project, r.session), truncate: true },
    { id: "rig", header: m.project_col_rig(), cell: rigOf, sortValue: rigOf, truncate: true },
    { id: "framing", header: m.project_col_framing(), cell: framing, sortValue: framing, truncate: true },
    { id: "frames", header: m.goal_frames(), cell: (r) => formatCount(r.frames), sortValue: (r) => r.frames, align: "right" },
    { id: "pending", header: m.project_pending_changes(), cell: pending, sortValue: pending, truncate: true },
  ]
  const order = new Map(project.groups.map((g, index) => [g.id, index]))
  const groupHeading = (_groupId: string, members: HeldRow[]) => {
    const name = members[0]?.group?.name ?? m.project_group_missing()
    const frames = members.reduce((n, r) => n + r.frames, 0)
    return `${name} · ${m.project_sessions_count({ count: members.length })} · ${say(m, framesRef(frames))}`
  }

  const startSplit = (sessionIds: SessionId[]) => {
    const groupId = rows.find((r) => r.session.id === sessionIds[0])?.input.groupId
    const group = groupId ? findGroup(project, groupId) : undefined
    if (group) setSplitting({ groupId: group.id, sessionIds, name: splitGroupName(m, project, group) })
  }
  const startMove = (sessionIds: SessionId[]) => {
    const from = rows.find((r) => r.session.id === sessionIds[0])?.input.groupId
    const to = project.groups.find((g) => g.id !== from) ?? project.groups[0]
    if (to) setMoving({ sessionIds, groupId: to.id })
  }
  // After a split or move the opener (a header action) turns unavailable, so focus lands on the first session that moved.
  const landed = useRef<SessionId | null>(null)
  const done = (result: CommitResult, sessionIds: SessionId[] = []) => {
    if (result.ok) {
      setSelected([])
      landed.current = sessionIds[0] ?? null
    }
    return result
  }
  const focusLanded = () => (landed.current ? document.querySelector<HTMLElement>(`tr[data-row="${CSS.escape(landed.current)}"]`) : null)

  const rowActions = (r: HeldRow): MenuItem[] => {
    const others = project.groups.filter((g) => g.id !== r.input.groupId)
    return withIssueItems(
      m,
      [
        { id: "open-session", label: m.project_open_session(), icon: Eye, run: () => openSession(navigate, r.session.id) },
        ...(open
          ? [
              ...(others.length > 0 ? [{ submenu: m.project_move_to_group(), items: others.map((g): MenuItem => ({ id: `move-${g.id}`, label: g.name, icon: FolderInput, run: () => moveSessions(project.id, [r.session.id], g.id) })) }] : []),
              { id: "split", label: m.project_split_group(), icon: Split, opensDialog: true, run: () => startSplit([r.session.id]) },
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
      ],
      rowIssues(issueView, { kind: "session", id: r.session.id }),
    )
  }

  const none = chosen.length === 0
  const moveLabel = m.project_move_to_group()
  const splitLabel = m.project_split_group()
  const removeLabel = none ? m.project_remove_session() : m.store_label_remove_sessions({ count: chosen.length, n: formatCount(chosen.length) })
  const selectFirst = m.project_select_sessions_first()
  const actions: Action[] = open
    ? [
        { id: "add-sessions", label: m.project_add_sessions(), icon: Plus, opensDialog: true, run: () => setAdding(true) },
        {
          id: "move-selected",
          label: moveLabel,
          icon: FolderInput,
          opensDialog: true,
          unavailable: none ? blocked(m, moveLabel, selectFirst) : project.groups.length < 2 ? blocked(m, moveLabel, m.project_move_needs_group()) : undefined,
          run: () => startMove(chosen),
        },
        {
          id: "split-selected",
          label: splitLabel,
          icon: Split,
          opensDialog: true,
          unavailable: none ? blocked(m, splitLabel, selectFirst) : chosenGroups.size > 1 ? blocked(m, splitLabel, m.project_split_one_group()) : undefined,
          run: () => startSplit(chosen),
        },
        {
          id: "remove-selected",
          label: removeLabel,
          icon: X,
          kind: "destructive",
          unavailable: none ? blocked(m, removeLabel, selectFirst) : undefined,
          confirm: { title: m.project_remove_sessions_title({ count: chosen.length, project: project.name }), summary: m.project_remove_session_summary(), confirm: { label: m.project_remove(), kind: "destructive" } },
          run: () => done(removeSessions(project.id, chosen)),
        },
      ]
    : []

  const splitError = splitting && !splitting.name.trim() ? m.settings_name_required() : undefined
  const splitConfirm = m.project_split_confirm()
  const moveTarget = moving ? project.groups.find((g) => g.id === moving.groupId) : undefined
  const moveConfirm = m.project_label_move_sessions({ count: moving?.sessionIds.length ?? 0, group: moveTarget?.name ?? "" })
  return {
    id: "sessions",
    title: m.nav_sessions(),
    count: rows.length,
    flush: true,
    actions,
    content: (
      <>
        <BoxTable
          label={m.common_sessions_of({ name: project.name })}
          rows={rows}
          columns={columns}
          getRowId={(r) => r.session.id}
          initialSort={{ columnId: "session", direction: "desc" }}
          groups={{ key: (r) => r.input.groupId, label: groupHeading, compare: (a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0) }}
          selection={open && rows.length > 0 ? { selected: chosen, onChange: setSelected, rowLabel: label } : undefined}
          rowLabel={label}
          rowActions={rowActions}
          empty={!open ? m.project_sessions_none() : suggested ? m.project_no_sessions() : m.project_no_sessions_add()}
        />
        <AddSessionsDialog project={project} open={adding} onOpenChange={setAdding} />
        <FormDialog
          open={splitting !== null}
          onOpenChange={(next) => !next && setSplitting(null)}
          focusAfterConfirm={focusLanded}
          title={splitLabel}
          size="sm"
          confirm={{
            id: "split-save",
            label: splitConfirm,
            kind: "primary",
            run: () => (splitting ? done(splitGroup(project.id, splitting.groupId, splitting.sessionIds, splitting.name).result, splitting.sessionIds) : undefined),
            unavailable: splitError ? blocked(m, splitConfirm, splitError) : undefined,
          }}
        >
          {splitting ? (
            <TextField
              label={m.newproject_field_name()}
              value={splitting.name}
              onChange={(name) => setSplitting({ ...splitting, name })}
              description={m.project_split_moves({ count: splitting.sessionIds.length })}
              error={splitError}
              required
              autoFocus
            />
          ) : null}
        </FormDialog>
        <FormDialog
          open={moving !== null}
          onOpenChange={(next) => !next && setMoving(null)}
          focusAfterConfirm={focusLanded}
          title={moveLabel}
          size="sm"
          confirm={{ id: "move-save", label: moveConfirm, kind: "primary", run: () => (moving ? done(moveSessions(project.id, moving.sessionIds, moving.groupId), moving.sessionIds) : undefined) }}
        >
          {moving ? (
            <SelectField label={m.project_col_group()} value={moving.groupId} options={project.groups.map((g) => ({ value: g.id, label: g.name }))} onChange={(groupId) => setMoving({ ...moving, groupId })} />
          ) : null}
        </FormDialog>
      </>
    ),
  }
}

// ---------------------------------------------------------------------------
// Panel map (PRJ-FR-29, PRJ-AC-46)
// ---------------------------------------------------------------------------

/** A mosaic's panel groups on the read-only map, each with its goals met; null for a Project with no panel group. */
export function usePanelMapSection(project: Project): DetailSection | null {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  if (!isMosaic(project)) return null
  const model = mosaicFieldModel(catalog, project)
  const progress = goalProgress(catalog, project)
  const panels = model.panels.map((panel) => {
    const goals = progress.filter((p) => p.goal.groupId === panel.id)
    return goals.length > 0 ? { ...panel, detail: m.home_goals_met({ met: goals.filter((g) => g.met).length, total: goals.length }) } : panel
  })
  return { id: "panel-map", title: m.project_panel_map(), count: panels.length, content: <MosaicField panels={panels} pointings={model.pointings} field={model.field} /> }
}

// ---------------------------------------------------------------------------
// Suggestions (PRJ-FR-08, PRJ-FR-09, P-REV2)
// ---------------------------------------------------------------------------

/**
 * Suggestions: Ready matching sessions the Project doesn't hold, each with
 * why it matches ("Target NGC 7000 on RedCat 51"). They are never added by
 * themselves; Add to Project is offered once the session's calibration is
 * settled, else its blocker shows ("Choose its flats first", PRJ-AC-39) and
 * the section links to Sessions › Needs calibration. A matching session that
 * still needs review waits in the review queue; the section offers its
 * frames to review. A locked Project shows none (VSEL-AC-20).
 */
export function useSuggestionsSection(project: Project): DetailSection | null {
  const m = useMessages()
  const navigate = useNavigate()
  const follow = useFollowLink()
  const catalog = useStore((s) => s.catalog)
  const rows = useStore((s) => projectSuggestions(s.catalog, project))
  const waiting = useStore((s) => projectSessionsNeedingReview(s.catalog, project))
  if (isLocked(project)) return null
  const unreviewed = waiting.reduce((n, c) => n + sessionUnreviewedFrames(catalog, c.session), 0)
  const firstWaiting = waiting.find((c) => sessionUnreviewedFrames(catalog, c.session) > 0)
  const addable = rows.filter((r) => r.blocked === null)
  const unsettled = rows.length - addable.length

  const label = (r: Suggestion) => `${subjectName(m, catalog, r.subject)} · ${sessionLine(m, r.session)}`
  const status = (r: Suggestion) => (r.blocked ? say(m, r.blocked) : m.status_ready())
  const reason = (r: Suggestion) => say(m, r.reason)
  const columns: Column<Suggestion>[] = [
    { id: "session", header: m.project_col_session(), cell: (r) => <SessionCell session={r.session} />, sortValue: (r) => r.session.night, rowHeader: true },
    { id: "match", header: m.project_col_match(), cell: reason, sortValue: reason, truncate: true },
    { id: "framing", header: m.project_col_framing(), cell: (r) => framingLine(m, catalog, r.session), sortValue: (r) => framingLine(m, catalog, r.session), truncate: true },
    { id: "frames", header: m.goal_frames(), cell: (r) => formatCount(liveAssetIds(catalog, r.session).length), sortValue: (r) => liveAssetIds(catalog, r.session).length, align: "right" },
    { id: "status", header: m.dialog_col_status(), cell: status, sortValue: status, truncate: true },
  ]
  const addLabel = m.session_add_to_project()
  const rowActions = (r: Suggestion): MenuItem[] => [
    { id: "open-session", label: m.project_open_session(), icon: Eye, run: () => openSession(navigate, r.session.id) },
    {
      id: "add",
      label: addLabel,
      icon: Plus,
      unavailable: r.blocked ? { action: m.actions_blocked({ action: addLabel }), reason: say(m, r.blocked), blockers: [{ label: label(r), link: { to: "/sessions/$sessionId", params: { sessionId: r.session.id } } }] } : undefined,
      run: () => addSessions(project.id, [r.session.id]),
    },
  ]
  const actions: Action[] = [
    ...(addable.length > 0 ? [{ id: "add-all", label: m.project_add_suggested({ count: addable.length }), icon: Plus, run: () => addSessions(project.id, addable.map((r) => r.session.id)) }] : []),
    // Verbs only (W2): the table's Status cells show which sessions need calibration; the intake shows the frames to review.
    ...(unsettled > 0 ? [{ id: "needs-calibration", label: m.project_suggestions_choose_calibration(), run: () => follow({ to: "/sessions", search: { filter: "needs-calibration" } }) }] : []),
    ...(unreviewed > 0 && firstWaiting ? [{ id: "review", label: m.project_suggestions_review_frames(), run: () => follow(sessionIntakeLink(firstWaiting.session.id, "review")) }] : []),
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
