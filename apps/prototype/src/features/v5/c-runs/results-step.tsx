/**
 * S5 Results (§5.4, RES-FR-01 to RES-FR-08, D-W4, D-W67): one DataTable of
 * the files found in the run's recorded Results folder, products and
 * intermediates in their own groups. A file still being written reads so in
 * its State cell and holds Finish run. Batch: Accept (binds the current
 * bytes), Ignore. Toolbar: Attach… (a file anywhere, with its kind and
 * channel) and Rescan. Masters the application wrote are offered to the
 * Calibration library below. Finish run… is the flow's terminal Proceed.
 */
import { Check, Copy, FolderSearch, Paperclip, ScanSearch, X } from "lucide-react"
import { useEffect, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { Box, BoxTable } from "@/components/app/box"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList, PathText } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/feedback"
import { PathField, SelectField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { StatusBadge } from "@/components/app/status"
import { KIND_NAME } from "@/domain/calibration"
import { runPreparations } from "@/domain/derive"
import { fileAt } from "@/domain/disk"
import { RESULT_KIND_NAME } from "@/domain/labels"
import type { CalibrationMaster, ResultKind } from "@/domain/types"
import { fileName, formatBytes } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { useStore } from "@/store/core"
import { acceptResult, adoptionPreview, adoptMasterOffer, attachResult, discoverResults, dismissMasterOffer, inspectResult, rejectResult, setResultKind } from "./actions"
import { carriesChannel, type ResultRow, type RunContext, resultRow, resultsFolders, runLayout } from "./model"

/** The kinds a run's product can be; a group's own Result is the assembled mosaic. */
export const RUN_RESULT_KINDS: ResultKind[] = ["linear-integration", "channel-product", "final-image", "mosaic-panel"]

/** The Results files of a run, or a group's assembled mosaic (D-W73); a target the actions write to. */
export type ResultsTarget = { runId: string } | { groupId: string }

const FILE_FILTERS = [".xisf", ".fits", ".fit", ".tif", ".tiff"]

/** Copy a path to the clipboard (the row menu's Copy path). */
function copyPath(path: string) {
  void navigator.clipboard?.writeText(path).catch(() => {})
}

function revisionText(m: Messages, r: ResultRow): string {
  const label = say(m, r.attribution.label)
  return r.attribution.basis === "inferred" ? `${label} · ${m.run_results_inferred()}` : label
}

function ResultState({ row }: { row: ResultRow }) {
  const m = useMessages()
  if (row.pending) return <StatusBadge kind="processing" value="pending" label={m.store_reason_still_being_written()} />
  if (!row.readable) return <StatusBadge kind="availability" value="absent" label={m.status_unreadable()} />
  if (row.changed) return <StatusBadge kind="content" value="drifted" label={row.record.acceptance === "accepted" ? m.status_drifted() : m.run_results_changed()} />
  if (row.record.intermediate) return <StatusBadge kind="item" value="skipped" label={m.run_results_intermediate()} />
  return <StatusBadge kind="acceptance" value={row.record.acceptance} />
}

export interface ResultsTableProps {
  label: string
  rows: ResultRow[]
  kinds: ResultKind[]
  editable: boolean
  /** Attach… and Rescan, worded by the host. */
  actions: Action[]
  empty: Action
}

/** Discovered and attached files: File · Kind · Channel · Revision · State; products first, intermediates apart. */
export function ResultsTable({ label, rows, kinds, editable, actions, empty }: ResultsTableProps) {
  const m = useMessages()
  const [selected, setSelected] = useState<string[]>([])
  const name = (r: ResultRow) => fileName(r.record.path)
  const candidate = (r: ResultRow) => !r.record.intermediate && r.record.acceptance !== "accepted"
  const kindOptions = (r: ResultRow) => [...(r.record.kind ? [] : [{ value: "", label: m.run_results_kind_missing(), disabled: true }]), ...kinds.map((k) => ({ value: k, label: say(m, RESULT_KIND_NAME[k]) }))]
  const rowActions = (r: ResultRow): MenuItem[] => [
    ...(editable && candidate(r) && !r.pending ? [{ id: "accept", label: m.run_accept(), icon: Check, run: () => acceptResult(r.record.id) }] : []),
    ...(editable && !r.record.intermediate && r.record.acceptance !== "rejected" ? [{ id: "ignore", label: m.run_results_ignore(), icon: X, run: () => rejectResult(r.record.id) }] : []),
    ...(editable && r.changed && !r.pending ? [{ id: "inspect", label: m.run_results_inspect_again(), icon: ScanSearch, run: () => inspectResult(r.record.id) }] : []),
    { id: "copy-path", label: m.session_copy_path(), icon: Copy, run: () => copyPath(r.record.path) },
  ]
  const batchActions = (ids: string[]): Action[] => {
    const chosen = rows.filter((r) => ids.includes(r.record.id))
    const each = (write: (id: string) => ReturnType<typeof acceptResult>) => () => chosen.map((r) => write(r.record.id)).find((x) => !x.ok) ?? { ok: true as const }
    return [
      { id: "accept", label: m.run_accept(), icon: Check, run: each(acceptResult) },
      { id: "ignore", label: m.run_results_ignore(), icon: X, run: each(rejectResult) },
    ]
  }
  const columns: Column<ResultRow>[] = [
    { id: "file", header: m.run_col_file(), rowHeader: true, truncate: true, cell: name, sortValue: (r) => r.record.path },
    {
      id: "kind",
      header: m.run_col_kind(),
      cell: (r) =>
        editable && candidate(r) ? (
          <SelectField
            hideLabel
            label={m.run_results_kind_of({ name: name(r) })}
            value={r.record.kind ?? ""}
            options={kindOptions(r)}
            onChange={(kind) => void setResultKind(r.record.id, kind as ResultKind)}
          />
        ) : r.record.kind ? (
          say(m, RESULT_KIND_NAME[r.record.kind])
        ) : (
          "–"
        ),
      sortValue: (r) => r.record.kind ?? "",
    },
    { id: "channel", header: m.run_col_channel(), cell: (r) => r.record.channel ?? "–", sortValue: (r) => r.record.channel ?? "" },
    { id: "revision", header: m.run_col_revision(), cell: (r) => revisionText(m, r), sortValue: (r) => r.record.fromPrepRevision ?? -1 },
    { id: "state", header: m.run_col_state(), cell: (r) => <ResultState row={r} />, sortValue: (r) => (r.pending ? "0" : r.record.acceptance) },
  ]
  return (
    <DataTable
      label={label}
      rows={rows}
      columns={columns}
      getRowId={(r) => r.record.id}
      initialSort={{ columnId: "file", direction: "asc" }}
      scroll="none"
      groups={{
        key: (r) => (r.record.intermediate ? "intermediates" : "products"),
        label: (key, group) => (key === "products" ? m.run_results_products_count({ count: group.length }) : m.run_results_intermediates_count({ count: group.length })),
        compare: (a, b) => (a === b ? 0 : a === "products" ? -1 : 1),
      }}
      selection={editable ? { selected, onChange: setSelected, rowLabel: name, isSelectable: (r) => candidate(r) && !r.pending } : undefined}
      batchActions={editable ? batchActions : undefined}
      toolbar={{ actions }}
      rowLabel={name}
      rowActions={rowActions}
      empty={<EmptyState icon={FolderSearch} title={m.run_results_no_products()} action={<ActionButton action={empty} />} />}
    />
  )
}

export interface AttachDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  target: ResultsTarget
  kinds: ResultKind[]
  /** Where the file chooser opens: the Results folder. */
  initialPath: string | null
}

/** Attach… (RES-FR-03): a file anywhere, linked by the user, with its kind and, for a per-channel kind, its channel. */
export function AttachDialog({ open, onOpenChange, target, kinds, initialPath }: AttachDialogProps) {
  const m = useMessages()
  const [path, setPath] = useState<string | null>(null)
  const [kind, setKind] = useState<ResultKind>(kinds[0]!)
  const [channel, setChannel] = useState("")
  const confirm: Action = {
    id: "attach",
    label: m.run_results_attach(),
    kind: "primary",
    unavailable: path ? undefined : { action: m.run_results_attach_blocked(), reason: m.run_results_choose_file(), blockers: [] },
    run: () => (path ? attachResult(target, path, kind, carriesChannel(kind) ? channel.trim() || null : null) : undefined),
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={(next) => {
        if (next) {
          setPath(null)
          setKind(kinds[0]!)
          setChannel("")
        }
        onOpenChange(next)
      }}
      title={m.run_results_attach_title()}
      confirm={confirm}
    >
      <PathField mode="file" label={m.run_results_file_path()} value={path} onChange={setPath} filters={FILE_FILTERS} initialPath={initialPath} />
      <SelectField label={m.run_col_kind()} value={kind} options={kinds.map((k) => ({ value: k, label: say(m, RESULT_KIND_NAME[k]) }))} onChange={setKind} />
      {carriesChannel(kind) ? <TextField label={m.run_results_channel_optional()} value={channel} onChange={setChannel} placeholder={m.run_results_channel_placeholder()} /> : null}
    </FormDialog>
  )
}

/** Masters the application wrote into the Results folder, offered to the Calibration library (D-W55): Add to library…, Dismiss. */
function MastersFound({ runId, editable }: { runId: string; editable: boolean }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const run = state.catalog.runs[runId]!
  const offers = run.masterOffers.filter((o) => o.state === "pending").flatMap((o) => (state.catalog.masters[o.masterId] ? [state.catalog.masters[o.masterId]!] : []))
  if (offers.length === 0) return null
  const masterName = (master: CalibrationMaster) => fileName(master.origin.sourcePath)
  const sizeOf = (master: CalibrationMaster) => fileAt(state.disk, master.origin.sourcePath)?.sizeBytes ?? 0
  const rowActions = (master: CalibrationMaster): MenuItem[] => {
    if (!editable) return []
    const preview = adoptionPreview(state, master.id)
    const add: Action = preview.ok
      ? {
          id: "add",
          label: m.run_cal_add_to_library(),
          confirm: {
            title: m.run_cal_add_title({ name: masterName(master) }),
            summary: m.run_cal_add_reverifies(),
            groups: [
              {
                label: m.run_cal_add_destination(),
                defaultOpen: true,
                rows: [{ file: masterName(master), from: master.origin.sourcePath.slice(0, master.origin.sourcePath.lastIndexOf("/")), to: preview.destinationPath.slice(0, preview.destinationPath.lastIndexOf("/")), action: "copy", size: sizeOf(master) }],
              },
            ],
            confirm: { label: m.run_cal_add_to_library() },
          },
          run: () => adoptMasterOffer(runId, master.id, preview.sha256),
        }
      : { id: "add", label: m.run_cal_add_to_library(), unavailable: { action: m.run_cal_add_blocked(), reason: m.refusal_blockers({ count: preview.reasons.length }), blockers: preview.reasons.map((r) => ({ label: say(m, r) })) }, run: () => undefined }
    return [add, { id: "dismiss", label: m.run_dismiss(), run: () => dismissMasterOffer(runId, master.id) }]
  }
  const columns: Column<CalibrationMaster>[] = [
    { id: "name", header: m.run_col_file(), rowHeader: true, truncate: true, cell: masterName, sortValue: masterName },
    { id: "kind", header: m.run_col_kind(), cell: (master) => say(m, KIND_NAME[master.kind]), sortValue: (master) => master.kind },
    { id: "channel", header: m.run_col_channel(), cell: (master) => master.channel ?? "–", sortValue: (master) => master.channel ?? "" },
    { id: "size", header: m.run_col_size(), align: "right", cell: (master) => formatBytes(sizeOf(master)), sortValue: sizeOf },
  ]
  return (
    <Box title={m.run_cal_masters_found()} count={offers.length} flush>
      <BoxTable label={m.run_cal_masters_found()} rows={offers} columns={columns} getRowId={(master) => master.id} rowLabel={masterName} rowActions={rowActions} />
    </Box>
  )
}

export function ResultsStep({ ctx, editable }: { ctx: RunContext; editable: boolean }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const { run } = ctx
  const [attaching, setAttaching] = useState(false)
  const folders = resultsFolders(state, run)
  const preps = runPreparations(state.catalog, run.id)
  // Opening Results looks in the recorded folder (the watcher): new files are listed, never accepted.
  useEffect(() => {
    if (!run.trashedAt && run.completion !== "complete") discoverResults({ runId: run.id })
  }, [run.id, run.trashedAt, run.completion])
  const rows = Object.values(state.catalog.results)
    .filter((r) => r.runId === run.id && !r.trashed)
    .map((r) => resultRow(state, r, preps))
  const rescan: Action = { id: "rescan", label: m.run_results_rescan(), icon: FolderSearch, unavailable: folders.length === 0 ? { action: m.run_results_look_again_blocked(), reason: m.run_not_prepared(), blockers: [] } : undefined, run: () => discoverResults({ runId: run.id }).result }
  const attach: Action = { id: "attach", label: m.run_results_attach(), icon: Paperclip, opensDialog: true, run: () => setAttaching(true) }
  const folder = folders[0] ?? runLayout(state, run).resultsPath
  return (
    <>
      {folder ? <KeyValueList items={[{ label: m.run_results_folder(), value: <PathText path={folder} truncate />, mono: true }]} /> : null}
      <ResultsTable label={m.step_results()} rows={rows} kinds={RUN_RESULT_KINDS} editable={editable} actions={editable ? [attach, rescan] : []} empty={rescan} />
      <MastersFound runId={run.id} editable={editable} />
      <AttachDialog open={attaching} onOpenChange={setAttaching} target={{ runId: run.id }} kinds={RUN_RESULT_KINDS} initialPath={folder} />
    </>
  )
}
