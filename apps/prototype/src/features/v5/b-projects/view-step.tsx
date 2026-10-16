/**
 * The Project's View tab (VSEL-FR-12 to VSEL-FR-21, PREP-FR-04 to
 * PREP-FR-19), at its smallest working form: the View settings (application,
 * Symlinks or Copies, the Processing location), the pending changes with
 * their source, the running Apply, and what `View (previous)/` still holds.
 * Every change stays pending until Apply, whose sheet (slice C) lists the
 * changes, the layout changes, the folder tree, the space and every
 * refusal, and the files PlateVault didn't place, each with a tick box.
 * Apply refuses a sheet that went stale after it opened. A Project can
 * discard only its own edits; a change from the Library or calibration links
 * to where it is fixed (D-W109).
 */
import { Eye, RefreshCw, Undo2 } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { BoxTable } from "@/components/app/box"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { Notice } from "@/components/app/feedback"
import { ChoiceListField, PathField, SegmentedField, SelectField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { useFollowLink } from "@/components/app/links"
import { OperationLine } from "@/components/app/operation-panel"
import { Refusal } from "@/components/app/refusal"
import type { DetailSection } from "@/components/templates/detail-page"
import { isLocked } from "@/domain/derive"
import { MODE_NAME, orderedProfiles, profileRef } from "@/domain/labels"
import { applyPlan, applyRefusalRef, CHANGE_SOURCE_NAME, isDiscardable, type PendingChange, pendingChanges, projectOperation, type ViewFolderNode } from "@/domain/project-view"
import type { InputMode, PreviousLeftover, Project, ProjectId } from "@/domain/types"
import { formatBytes, formatCount } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { type ApplySheet, applyPhase, discardChanges, reviewLeftover, startApply } from "@/store/actions/project-view"
import { setProjectSettings } from "@/store/actions/projects"
import { type CommitResult, store, updateSlice, useStore } from "@/store/core"

/** Open the Apply sheet on the plan as it stands now (slice C); Apply refuses it once anything changes. */
export function openApplySheet(projectId: ProjectId) {
  const state = store.getState()
  const project = state.catalog.projects[projectId]
  if (!project) return
  const { fingerprint } = applyPlan(state, project)
  updateSlice("c", (c) => ({ ...c, apply: { ...c.apply, [projectId]: { fingerprint, tickedUnplaced: [] } } }))
}

function closeApplySheet(projectId: ProjectId) {
  updateSlice("c", (c) => {
    const { [projectId]: _, ...rest } = c.apply
    return { ...c, apply: rest }
  })
}

function failureText(result: CommitResult): string | null {
  if (result.ok) return null
  return result.reason === "refused" ? result.reasons.join(" · ") : result.message
}

/** The planned View's folders, depth first, each with the entries directly inside: "GROUP_RedCat-51/NIGHT_2026-09-18/Lights/Ha · 42 entries". */
function treeItems(m: Messages, node: ViewFolderNode): Array<{ label: string; value: string }> {
  const own = node.entries > 0 ? [{ label: node.path || node.name, value: node.bytes > 0 ? `${m.project_view_entries({ count: node.entries })} · ${formatBytes(node.bytes)}` : m.project_view_entries({ count: node.entries }) }] : []
  return [...own, ...node.children.flatMap((child) => treeItems(m, child))]
}

/** Application, Symlinks or Copies, and the Processing location; each reaches the View on the next Apply. */
function SettingsFields({ project, editable }: { project: Project; editable: boolean }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const [errors, setErrors] = useState<Partial<Record<"profile" | "mode" | "folder", string>>>({})
  const commit = (field: "profile" | "mode" | "folder", result: CommitResult) => setErrors((e) => ({ ...e, [field]: failureText(result) ?? undefined }))
  const { settings } = project
  const profiles = orderedProfiles(catalog).filter((p) => p.executableState === "found" || p.executableState === "launch-fails" || p.id === settings.profileId)
  const profileOptions = [...(settings.profileId ? [] : [{ value: "", label: m.project_view_no_application(), disabled: true }]), ...profiles.map((p) => ({ value: p.id, label: say(m, profileRef(p)) }))]
  const modes: InputMode[] = ["symlink", "copy"]
  return (
    <>
      <SelectField label={m.apps_col_application()} value={settings.profileId ?? ""} options={profileOptions} disabled={!editable} error={errors.profile} onChange={(id) => commit("profile", setProjectSettings(project.id, { profileId: id }))} />
      <SegmentedField label={m.project_view_mode()} value={settings.mode} options={modes.map((mode) => ({ value: mode, label: say(m, MODE_NAME[mode]) }))} disabled={!editable} error={errors.mode} onChange={(mode) => commit("mode", setProjectSettings(project.id, { mode }))} />
      <PathField
        mode="folder"
        label={m.project_view_location()}
        value={project.folderPath ?? settings.processingParent}
        disabled={!editable || project.folderPath !== null}
        description={project.folderPath ? m.project_view_location_fixed() : undefined}
        error={errors.folder}
        onChange={(path) => commit("folder", setProjectSettings(project.id, { processingParent: path }))}
      />
    </>
  )
}

/** The Apply sheet (VSEL-FR-14), while slice C holds one open for the Project. */
function ApplySheetHost({ project }: { project: Project }) {
  const sheet = useStore((s) => s.slices.c.apply[project.id])
  return sheet ? <ApplySheetDialog project={project} sheet={sheet} /> : null
}

/** The plan the sheet opened on, the files to carry into the new View, and Apply. */
function ApplySheetDialog({ project, sheet }: { project: Project; sheet: ApplySheet }) {
  const m = useMessages()
  const plan = useStore((s) => applyPlan(s, project))
  const label = m.project_apply()
  const refusals = plan.refusals.map((r) => say(m, applyRefusalRef(r)))
  const facts = [
    { label: m.dialog_changes(), value: plan.first ? m.project_apply_first() : formatCount(plan.changes.length) },
    { label: m.project_view_mode(), value: say(m, MODE_NAME[plan.mode]) },
    { label: m.project_apply_space(), value: plan.space.twoViews ? m.project_apply_space_two_views({ size: formatBytes(plan.space.neededBytes) }) : formatBytes(plan.space.neededBytes) },
  ]
  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && closeApplySheet(project.id)}
      title={m.common_apply_named({ name: project.name })}
      size="lg"
      confirm={{
        id: "apply",
        label,
        kind: "primary",
        run: () => {
          const { result } = startApply(project.id, sheet)
          if (result.ok) closeApplySheet(project.id)
          else openApplySheet(project.id)
          return result
        },
        unavailable: refusals.length > 0 ? { action: m.actions_blocked({ action: label }), reason: refusals.join(" · "), blockers: [] } : undefined,
      }}
    >
      {plan.layoutChanged.length > 0 ? <Notice tone="warning" title={m.project_apply_readd_view()} /> : null}
      {refusals.length > 0 ? <Refusal standing action={label} reason={refusals[0]!} blockers={refusals.slice(1).map((r) => ({ label: r }))} /> : null}
      <KeyValueList items={facts} />
      {plan.changes.length > 0 ? <KeyValueList items={plan.changes.map((c) => ({ label: say(m, CHANGE_SOURCE_NAME[c.source]), value: say(m, c.label) }))} /> : null}
      <KeyValueList items={treeItems(m, plan.tree)} />
      {plan.drift.unplaced.length > 0 ? (
        <ChoiceListField
          label={m.project_apply_unplaced()}
          description={m.project_apply_unplaced_hint()}
          value={sheet.tickedUnplaced}
          options={plan.drift.unplaced.map((f) => ({ value: f.path, label: `${f.path} · ${formatBytes(f.sizeBytes)}` }))}
          onChange={(ticked) => updateSlice("c", (c) => ({ ...c, apply: { ...c.apply, [project.id]: { ...sheet, tickedUnplaced: [...ticked] } } }))}
        />
      ) : null}
    </FormDialog>
  )
}

function leftoverReason(m: Messages, leftover: PreviousLeftover): string {
  return leftover.reason === "changed-copy" ? m.project_previous_changed() : leftover.reason === "unverified-copy" ? m.project_previous_unverified() : m.project_previous_unplaced()
}

export function useViewSections(project: Project): DetailSection[] {
  const m = useMessages()
  const follow = useFollowLink()
  const changes = useStore((s) => pendingChanges(s, project))
  const running = useStore((s) => {
    const op = projectOperation(s, project.id)
    return op?.kind === "apply" ? op : null
  })
  const editable = !isLocked(project)
  const discardLabel = m.project_discard()

  const changeColumns: Column<PendingChange>[] = [
    { id: "change", header: m.dialog_changes(), cell: (c) => say(m, c.label), sortValue: (c) => say(m, c.label), rowHeader: true, truncate: true },
    { id: "source", header: m.project_change_source(), cell: (c) => say(m, CHANGE_SOURCE_NAME[c.source]), sortValue: (c) => c.source },
  ]
  const changeActions = (c: PendingChange): MenuItem[] => [
    ...(c.link ? [{ id: "open", label: m.project_change_fix_at_source(), icon: Eye, run: () => follow(c.link!) }] : []),
    ...(editable && isDiscardable(c) ? [{ id: "discard", label: discardLabel, icon: Undo2, run: () => discardChanges(project.id, [c.id]) }] : []),
  ]
  const own = changes.filter(isDiscardable).length
  const actions: Action[] = editable
    ? [
        { id: "apply", label: m.project_apply(), icon: RefreshCw, opensDialog: true, run: () => openApplySheet(project.id) },
        ...(own > 0
          ? [{ id: "discard-all", label: m.project_discard_own({ count: own }), icon: Undo2, confirm: { title: m.project_discard_own_title({ count: own }), confirm: { label: discardLabel, kind: "destructive" as const } }, run: () => discardChanges(project.id, "all") }]
          : []),
      ]
    : []

  const leftovers = project.previous?.leftovers ?? []
  const leftoverColumns: Column<PreviousLeftover>[] = [
    { id: "file", header: m.dialog_col_file(), cell: (l) => l.path, sortValue: (l) => l.path, rowHeader: true, truncate: true },
    { id: "reason", header: m.dialog_col_status(), cell: (l) => (l.kept ? m.status_keep() : leftoverReason(m, l)), sortValue: (l) => l.reason, truncate: true },
    { id: "size", header: m.dialog_col_size(), cell: (l) => formatBytes(l.sizeBytes), sortValue: (l) => l.sizeBytes, align: "right" },
  ]
  const leftoverActions = (l: PreviousLeftover): MenuItem[] =>
    editable
      ? [
          { id: "keep", label: m.status_keep(), run: () => reviewLeftover(project.id, l.path, "keep") },
          { id: "move", label: m.project_previous_move(), run: () => reviewLeftover(project.id, l.path, "move") },
          { id: "trash", label: m.common_move_to_trash(), kind: "destructive", run: () => reviewLeftover(project.id, l.path, "trash") },
        ]
      : []

  const sections: DetailSection[] = [
    { id: "view-settings", title: m.project_view_settings(), content: <SettingsFields project={project} editable={editable} /> },
    {
      id: "pending",
      title: m.project_pending_changes(),
      count: changes.length,
      flush: true,
      actions,
      content: (
        <>
          <BoxTable label={m.project_pending_changes_of({ name: project.name })} rows={changes} columns={changeColumns} getRowId={(c) => c.id} rowLabel={(c) => say(m, c.label)} rowActions={changeActions} empty={project.view ? m.project_no_pending_changes() : m.project_view_not_built()} />
          {editable ? <ApplySheetHost project={project} /> : null}
        </>
      ),
    },
  ]
  if (running)
    sections.splice(1, 0, {
      id: "apply-running",
      title: m.project_apply(),
      content: (
        <>
          <OperationLine operationId={running.id} />
          {applyPhase(running) === "waiting" ? <Notice tone="info" title={m.project_apply_waiting()} /> : null}
        </>
      ),
    })
  if (leftovers.length > 0)
    sections.push({
      id: "previous",
      title: m.project_previous_title(),
      count: leftovers.length,
      flush: true,
      content: <BoxTable label={m.project_previous_title()} rows={leftovers} columns={leftoverColumns} getRowId={(l) => l.path} rowLabel={(l) => l.path} rowActions={leftoverActions} />,
    })
  return sections
}
