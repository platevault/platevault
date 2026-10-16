/**
 * The Project's Output tab (RES-FR-01, RES-FR-02, RES-FR-08, CAL-FR-06), at
 * its smallest working form: every file in `Output/` with its Kind and
 * Channel, Copy to Output… for a file in `Processing/`, and the generated
 * masters found in `Processing/`, offered once each for the calibration
 * library. Tools never write into `Output/`, so a rerun cannot overwrite a
 * Result. Adoption refuses PlateVault's own unregistered copy at the fixed
 * destination until a reviewed Move to Trash clears it.
 */
import { Archive, Copy, EyeOff, Pencil, RotateCcw } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { BoxTable } from "@/components/app/box"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { Notice } from "@/components/app/feedback"
import { SelectField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import type { DetailSection } from "@/components/templates/detail-page"
import { KIND_NAME } from "@/domain/calibration"
import { isLocked } from "@/domain/derive"
import { OUTPUT_KIND_NAME, OUTPUT_KINDS } from "@/domain/labels"
import { copyToOutputRefusal, type OutputRow, outputRows, PROJECT_TAB_NAME, type ProcessingMaster, processingFiles, processingMasters, projectPaths } from "@/domain/project-view"
import type { OutputKind, ProcessingMasterOffer, Project } from "@/domain/types"
import { fileName, formatBytes } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { adoptionCheck, adoptProcessingMaster, copyToOutput, hideMasterOffer, restoreMasterOffer, setOutputChannel, setOutputKind } from "@/store/actions/project-view"
import { type CommitResult, store, useStore } from "@/store/core"

function relative(root: string | undefined, path: string): string {
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

/** Kind and Channel… for one Result: both written on Save. */
function ResultDialog({ project, row, onClose }: { project: Project; row: OutputRow; onClose: () => void }) {
  const m = useMessages()
  const [kind, setKind] = useState<OutputKind | "">(row.kind ?? "")
  const [channel, setChannel] = useState(row.channel ?? "")
  const save = (): CommitResult => {
    const kindResult = setOutputKind(project.id, row.file.path, kind || null)
    if (!kindResult.ok) return kindResult
    return setOutputChannel(project.id, row.file.path, channel.trim() || null)
  }
  return (
    <FormDialog open onOpenChange={(next) => !next && onClose()} title={m.settings_edit_title({ name: fileName(row.path) })} size="sm" confirm={{ id: "result-save", label: m.settings_save(), kind: "primary", run: save }}>
      <SelectField label={m.project_col_kind()} value={kind} options={[{ value: "", label: "–" }, ...OUTPUT_KINDS.map((k) => ({ value: k, label: say(m, OUTPUT_KIND_NAME[k]) }))]} onChange={setKind} />
      <TextField label={m.target_channel()} value={channel} onChange={setChannel} />
    </FormDialog>
  )
}

/** Copy to Output…: one file of `Processing/`, verified and never overwriting; the source stays (RES-FR-02). */
function CopyDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const m = useMessages()
  const files = useStore((s) => processingFiles(s, project))
  const root = useStore((s) => projectPaths(s, project)?.processing)
  const [source, setSource] = useState(files[0]?.path ?? "")
  const [name, setName] = useState(files[0] ? fileName(files[0].path) : "")
  const refusal = useStore((s) => (source ? copyToOutputRefusal(s, project, source, name) : null))
  const label = m.project_copy_to_output()
  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={label}
      size="sm"
      confirm={{
        id: "copy-to-output",
        label,
        kind: "primary",
        run: () => copyToOutput(project.id, source, name).result,
        unavailable: !source || refusal ? { action: m.actions_blocked({ action: label }), reason: refusal ? say(m, refusal) : m.project_output_no_processing(), blockers: [] } : undefined,
      }}
    >
      <SelectField
        label={m.dialog_col_file()}
        value={source}
        options={files.map((f) => ({ value: f.path, label: `${relative(root, f.path)} · ${formatBytes(f.sizeBytes)}` }))}
        onChange={(path) => {
          setSource(path)
          setName(fileName(path))
        }}
      />
      <TextField label={m.newproject_field_name()} value={name} onChange={setName} />
    </FormDialog>
  )
}

/** Add to library… for a generated master: its fixed destination, or why not; PlateVault's own copy there can go to the Trash first. */
function adoptAction(m: Messages, project: Project, master: ProcessingMaster): Action {
  const label = m.project_output_adopt()
  const check = adoptionCheck(store.getState(), project.id, master.file.path)
  if (check.ok)
    return {
      id: "adopt",
      label,
      icon: Archive,
      confirm: { title: m.project_output_adopt_title({ name: fileName(master.file.path) }), summary: check.destination, confirm: { label } },
      run: () => adoptProcessingMaster(project.id, master.file.path, check.sha256),
    }
  if (check.ownCopy)
    return {
      id: "adopt",
      label,
      icon: Archive,
      confirm: { title: m.project_output_adopt_own_copy_title(), summary: check.ownCopy, confirm: { label: m.project_output_adopt_trash_copy(), kind: "destructive" } },
      run: () => adoptProcessingMaster(project.id, master.file.path, master.file.sha256, { trashOwnCopy: true }),
    }
  return { id: "adopt", label, icon: Archive, unavailable: { action: m.actions_blocked({ action: label }), reason: check.reasons.map((r) => say(m, r)).join(" · "), blockers: [] }, run: () => undefined }
}

export function useOutputSections(project: Project): DetailSection[] {
  const m = useMessages()
  const output = useStore((s) => outputRows(s, project))
  const root = useStore((s) => projectPaths(s, project))
  const masters = useStore((s) => processingMasters(s, project))
  const [editing, setEditing] = useState<OutputRow | null>(null)
  const [copying, setCopying] = useState(false)
  const editable = !isLocked(project)

  const state = (r: OutputRow) => (r.state === "writing" ? m.project_output_writing() : m.status_ready())
  const columns: Column<OutputRow>[] = [
    { id: "file", header: m.dialog_col_file(), cell: (r) => r.path, sortValue: (r) => r.path, rowHeader: true, truncate: true },
    { id: "kind", header: m.project_col_kind(), cell: (r) => (r.kind ? say(m, OUTPUT_KIND_NAME[r.kind]) : "–"), sortValue: (r) => r.kind },
    { id: "channel", header: m.target_channel(), cell: (r) => r.channel ?? "–", sortValue: (r) => r.channel },
    { id: "state", header: m.dialog_col_status(), cell: state, sortValue: state },
    { id: "size", header: m.dialog_col_size(), cell: (r) => formatBytes(r.file.sizeBytes), sortValue: (r) => r.file.sizeBytes, align: "right" },
  ]
  const rowActions = (r: OutputRow): MenuItem[] => (editable ? [{ id: "edit", label: m.project_edit(), icon: Pencil, opensDialog: true, run: () => setEditing(r) }] : [])
  const actions: Action[] = editable ? [{ id: "copy", label: m.project_copy_to_output(), icon: Copy, opensDialog: true, run: () => setCopying(true) }] : []

  const masterColumns: Column<ProcessingMaster>[] = [
    { id: "file", header: m.dialog_col_file(), cell: (r) => relative(root?.processing, r.file.path), sortValue: (r) => r.file.path, rowHeader: true, truncate: true },
    { id: "kind", header: m.project_col_kind(), cell: (r) => say(m, KIND_NAME[r.kind]), sortValue: (r) => r.kind },
    { id: "size", header: m.dialog_col_size(), cell: (r) => formatBytes(r.file.sizeBytes), sortValue: (r) => r.file.sizeBytes, align: "right" },
  ]
  const masterActions = (r: ProcessingMaster): MenuItem[] => [adoptAction(m, project, r), { id: "hide", label: m.project_output_hide_offer(), icon: EyeOff, run: () => hideMasterOffer(project.id, r.file.path) }]
  const hidden = project.masterOffers.filter((o) => o.state === "hidden")
  const hiddenColumns: Column<ProcessingMasterOffer>[] = [{ id: "file", header: m.dialog_col_file(), cell: (o) => relative(root?.processing, o.path), sortValue: (o) => o.path, rowHeader: true, truncate: true }]

  const sections: DetailSection[] = [
    {
      id: "output",
      title: say(m, PROJECT_TAB_NAME.output),
      count: output.rows.length,
      flush: true,
      actions,
      content: (
        <>
          {output.online ? null : <Notice tone="warning" title={m.project_output_offline()} />}
          <BoxTable label={m.project_output_of({ name: project.name })} rows={output.rows} columns={columns} getRowId={(r) => r.path} rowLabel={(r) => r.path} rowActions={rowActions} empty={m.project_output_empty()} />
          {editing ? <ResultDialog project={project} row={editing} onClose={() => setEditing(null)} /> : null}
          {copying ? <CopyDialog project={project} onClose={() => setCopying(false)} /> : null}
        </>
      ),
    },
  ]
  if (editable && masters.length > 0)
    sections.push({
      id: "generated-masters",
      title: m.project_output_masters(),
      count: masters.length,
      flush: true,
      content: <BoxTable label={m.project_output_masters()} rows={masters} columns={masterColumns} getRowId={(r) => r.file.path} rowLabel={(r) => fileName(r.file.path)} rowActions={masterActions} />,
    })
  if (editable && hidden.length > 0)
    sections.push({
      id: "hidden-masters",
      title: m.project_output_hidden_masters(),
      count: hidden.length,
      flush: true,
      content: (
        <BoxTable
          label={m.project_output_hidden_masters()}
          rows={hidden}
          columns={hiddenColumns}
          getRowId={(o) => o.path}
          rowLabel={(o) => fileName(o.path)}
          rowActions={(o) => [{ id: "restore", label: m.project_output_offer_again(), icon: RotateCcw, run: () => restoreMasterOffer(project.id, o.path) }]}
        />
      ),
    })
  return sections
}
