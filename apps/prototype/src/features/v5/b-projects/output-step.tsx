/**
 * The Project's Output tab (RES-FR-01, RES-FR-02, RES-FR-08, CAL-FR-06): the
 * Results. `Output/` is watched with its subfolders, so a file the user
 * saves there joins the table by itself, reading "Still being written" until
 * it settles; Rescan sits in the section's More menu. Each Result has a
 * Kind and a Channel, both chosen from dropdowns in Kind and Channel…, its
 * path relative to `Output/` and what it was copied from. Copy to Output…
 * picks a file in `Processing/` through the file chooser with image
 * filters, opened there (provisional), copies it, verifies the copy and
 * never overwrites: a name Output already holds is refused. The source stays
 * where it is. Tools never write into `Output/`, so a rerun cannot change a
 * Result. The generated masters found in `Processing/` are offered once per
 * file and digest for the calibration library (provisional); adoption
 * refuses PlateVault's own unregistered copy at the fixed destination until
 * a reviewed Move to Trash clears it. No acceptance, revision or lineage.
 */
import { Archive, Copy, Eye, EyeOff, Pencil, RefreshCw, RotateCcw } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { BoxTable } from "@/components/app/box"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { toast } from "@/components/app/feedback"
import { PathField, SelectField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { OperationLine } from "@/components/app/operation-panel"
import type { DetailSection } from "@/components/templates/detail-page"
import { KIND_NAME } from "@/domain/calibration"
import { isLocked } from "@/domain/derive"
import { fileAt, trashRefusal } from "@/domain/disk"
import { GOAL_CHANNELS, OUTPUT_KIND_NAME, OUTPUT_KINDS } from "@/domain/labels"
import { copyToOutputRefusal, type OutputRow, outputRows, PROJECT_TAB_NAME, type ProcessingMaster, processingMasters, projectOperation, projectPaths } from "@/domain/project-view"
import type { OutputKind, ProcessingMasterOffer, Project } from "@/domain/types"
import { fileName, formatBytes, formatDateTime } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { adoptionCheck, adoptProcessingMaster, copyToOutput, hideMasterOffer, restoreMasterOffer, setOutputChannel, setOutputKind } from "@/store/actions/project-view"
import { trashFileRows } from "@/store/actions/trash"
import { type CommitResult, store, useStore } from "@/store/core"

/** The image files Copy to Output's chooser lists (RES-AC-25). */
export const OUTPUT_IMAGE_FILTERS = [".xisf", ".fits", ".fit", ".fts", ".tif", ".tiff", ".png", ".jpg", ".jpeg"] as const

/** How long Rescan reads `Output/` again before the table shows it. */
const RESCAN_MS = 600

function relative(root: string | undefined, path: string): string {
  return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
}

/** The Channel choices: the band and OSC channels, the Project's own filters, and the Result's current value. */
export function channelOptions(m: Messages, sessionChannels: readonly string[], current: string | null): Array<{ value: string; label: string }> {
  const values = [...new Set<string>([...GOAL_CHANNELS, ...sessionChannels, ...(current ? [current] : [])])]
  return [{ value: "", label: m.status_not_set() }, ...values.map((value) => ({ value, label: value }))]
}

/** Kind and Channel… for one Result: two dropdowns, written on Save; nothing asks for acceptance (RES-AC-24). */
function ResultDialog({ project, row, onClose }: { project: Project; row: OutputRow; onClose: () => void }) {
  const m = useMessages()
  const sessionChannels = useStore((s) => project.inputs.flatMap((i) => s.catalog.sessions[i.sessionId]?.channel ?? []))
  const [kind, setKind] = useState<OutputKind | "">(row.kind ?? "")
  const [channel, setChannel] = useState(row.channel ?? "")
  const save = (): CommitResult => {
    const kindResult = setOutputKind(project.id, row.path, kind || null)
    if (!kindResult.ok) return kindResult
    return setOutputChannel(project.id, row.path, channel || null)
  }
  return (
    <FormDialog open onOpenChange={(next) => !next && onClose()} title={m.output_kind_channel_title({ name: fileName(row.path) })} size="sm" confirm={{ id: "result-save", label: m.settings_save(), kind: "primary", run: save }}>
      <SelectField label={m.project_col_kind()} value={kind} options={[{ value: "", label: m.status_not_set() }, ...OUTPUT_KINDS.map((k) => ({ value: k, label: say(m, OUTPUT_KIND_NAME[k]) }))]} onChange={setKind} />
      <SelectField label={m.target_channel()} value={channel} options={channelOptions(m, sessionChannels, row.channel)} onChange={setChannel} />
    </FormDialog>
  )
}

/** Copy to Output…: one file of `Processing/` picked in the file chooser, verified and never overwriting; the source stays (RES-FR-02). */
function CopyDialog({ project, onClose }: { project: Project; onClose: () => void }) {
  const m = useMessages()
  const processing = useStore((s) => projectPaths(s, project)?.processing ?? null)
  const [source, setSource] = useState<string | null>(null)
  const [name, setName] = useState("")
  const refusal = useStore((s) => (source ? copyToOutputRefusal(s, project, source, name) : null))
  const label = m.project_copy_to_output()
  return (
    <FormDialog
      open
      onOpenChange={(next) => !next && onClose()}
      title={label}
      size="md"
      confirm={{
        id: "copy-to-output",
        label,
        kind: "primary",
        run: () => copyToOutput(project.id, source ?? "", name).result,
        unavailable: !source || refusal ? { action: m.actions_blocked({ action: label }), reason: refusal ? say(m, refusal) : m.output_choose_file_first(), blockers: [] } : undefined,
      }}
    >
      <PathField
        mode="file"
        label={m.output_source_file()}
        value={source}
        filters={OUTPUT_IMAGE_FILTERS}
        initialPath={processing}
        description={m.output_source_hint()}
        error={refusal ? say(m, refusal) : undefined}
        onChange={(path) => {
          setSource(path)
          setName(fileName(path))
        }}
      />
      <TextField label={m.output_name_in_output()} value={name} onChange={setName} description={m.output_never_overwrites()} />
    </FormDialog>
  )
}

/** Add to library… for a generated master: its fixed destination, or why not; PlateVault's own copy there can go to the Trash first, its file folded out in the review (astro-plan-6bh3p). */
function adoptAction(m: Messages, project: Project, master: ProcessingMaster): Action {
  const label = m.project_output_adopt()
  const state = store.getState()
  const check = adoptionCheck(state, project.id, master.file.path)
  if (check.ok)
    return {
      id: "adopt",
      label,
      icon: Archive,
      confirm: { title: m.project_output_adopt_title({ name: fileName(master.file.path) }), summary: check.destination, confirm: { label } },
      run: () => adoptProcessingMaster(project.id, master.file.path, check.sha256),
    }
  if (check.ownCopy) {
    const own = fileAt(state.disk, check.ownCopy)
    const refusal = trashRefusal(state.disk, check.ownCopy)
    return {
      id: "adopt",
      label,
      icon: Archive,
      confirm: {
        title: m.project_output_adopt_own_copy_title(),
        groups: own ? [{ label: m.calibration_own_copy(), rows: trashFileRows(m, state, [{ path: own.path, sha256: own.sha256, refused: refusal ? { reason: refusal } : null }]), defaultOpen: true }] : undefined,
        confirm: { label: m.project_output_adopt_trash_copy(), kind: "destructive" },
      },
      run: () => adoptProcessingMaster(project.id, master.file.path, master.file.sha256, { trashOwnCopy: true }),
    }
  }
  return { id: "adopt", label, icon: Archive, unavailable: { action: m.actions_blocked({ action: label }), reason: check.reasons.map((r) => say(m, r)).join(" · "), blockers: [] }, run: () => undefined }
}

/** Rescan: the watcher reads `Output/` again; the table shows Loading meanwhile. */
function useRescan(): { loading: boolean; rescan: () => void } {
  const [loading, setLoading] = useState(false)
  const timer = useRef<number | null>(null)
  useEffect(() => () => void (timer.current !== null && window.clearTimeout(timer.current)), [])
  const rescan = () => {
    setLoading(true)
    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      timer.current = null
      setLoading(false)
    }, RESCAN_MS)
  }
  return { loading, rescan }
}

export function useOutputSections(project: Project): DetailSection[] {
  const m = useMessages()
  const output = useStore((s) => outputRows(s, project))
  const root = useStore((s) => projectPaths(s, project))
  const masters = useStore((s) => processingMasters(s, project))
  const copying = useStore((s) => {
    const op = projectOperation(s, project.id)
    return op?.kind === "copy-to-output" ? op.id : null
  })
  const [editing, setEditing] = useState<OutputRow | null>(null)
  const [choosing, setChoosing] = useState(false)
  const { loading, rescan } = useRescan()
  const editable = !isLocked(project)

  const state = (r: OutputRow) => (r.state === "writing" ? m.store_reason_still_being_written() : m.output_settled())
  const columns: Column<OutputRow>[] = [
    { id: "file", header: m.dialog_col_file(), cell: (r) => r.path, sortValue: (r) => r.path, rowHeader: true, truncate: true },
    { id: "kind", header: m.project_col_kind(), cell: (r) => (r.kind ? say(m, OUTPUT_KIND_NAME[r.kind]) : "–"), sortValue: (r) => r.kind },
    { id: "channel", header: m.target_channel(), cell: (r) => r.channel ?? "–", sortValue: (r) => r.channel },
    { id: "state", header: m.dialog_col_status(), cell: state, sortValue: state },
    { id: "copied", header: m.output_copied_from(), cell: (r) => (r.copiedFrom ? relative(root?.processing, r.copiedFrom) : "–"), sortValue: (r) => r.copiedFrom, truncate: true, hideable: true },
    { id: "saved", header: m.output_saved_at(), cell: (r) => formatDateTime(r.file.modifiedAt), sortValue: (r) => r.file.modifiedAt, hideable: true, defaultHidden: true },
    { id: "size", header: m.dialog_col_size(), cell: (r) => formatBytes(r.file.sizeBytes), sortValue: (r) => r.file.sizeBytes, align: "right" },
  ]
  const rowActions = (r: OutputRow): MenuItem[] => [
    ...(editable ? [{ id: "edit", label: m.output_kind_channel(), icon: Pencil, opensDialog: true, run: () => setEditing(r) }] : []),
    { id: "reveal", label: m.review_reveal_path(), icon: Eye, run: () => toast({ message: m.review_announce_revealed({ path: r.file.path }) }) },
  ]
  const actions: Action[] = editable ? [{ id: "copy", label: m.project_copy_to_output(), icon: Copy, opensDialog: true, run: () => setChoosing(true) }] : []
  const more: MenuItem[] = [{ id: "rescan", label: m.location_rescan(), icon: RefreshCw, run: rescan }]

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
      more,
      content: (
        <>
          {copying ? <OperationLine operationId={copying} className="border-b px-3 py-1.5" /> : null}
          <BoxTable
            label={m.project_output_of({ name: project.name })}
            rows={output.rows}
            columns={columns}
            getRowId={(r) => r.path}
            rowLabel={(r) => r.path}
            rowActions={rowActions}
            loading={loading}
            error={output.online ? undefined : { message: m.project_output_offline(), onRetry: rescan }}
            empty={root ? m.project_output_empty() : m.output_no_folder()}
          />
          {editing ? <ResultDialog project={project} row={editing} onClose={() => setEditing(null)} /> : null}
          {choosing ? <CopyDialog project={project} onClose={() => setChoosing(false)} /> : null}
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
      title: m.calibration_hidden_masters(),
      count: hidden.length,
      flush: true,
      content: (
        <BoxTable
          label={m.calibration_hidden_masters()}
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
