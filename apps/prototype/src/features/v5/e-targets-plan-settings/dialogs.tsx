/**
 * Dialogs of slice E, each a FormDialog (plan §3.3 P8, §4b):
 * - NameDialog: name a thing (save or rename a preset, rename a rig).
 * - ImportMastersDialog: Folder → Preview (CAL-FR-13). The preview lists the
 *   folder's master files with their match (New / New version of {master} /
 *   Duplicate); the selected ones import. A New version joins its master as
 *   a dated version and moves no session (CAL-FR-14).
 * - AddMasterVersionDialog: File → Match (CAL-FR-14). The same matching for
 *   one master: the file must be a new version of it. Every session keeps
 *   the version it pins.
 * - CalibrationSettingsDialog: keep raw calibration frames, and the age after
 *   which darks, bias and dark flats read "Old · {n} d" (CAL-FR-15).
 */
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import type { Action, Column, FlowStep, StepFlow } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { Notice, toast } from "@/components/app/feedback"
import { NumberField, PathField, SwitchField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { Pill } from "@/components/app/pill"
import type { Tone } from "@/components/app/status"
import { KIND_NAME, type MasterMatch, masterImportMatch, masterKindOf, masterMatchRef, masterRecordRef, newestVersion } from "@/domain/calibration"
import { fileAt, filesUnder } from "@/domain/disk"
import type { CalibrationMaster, DiskFile } from "@/domain/types"
import { fileName, formatExposure } from "@/lib/format"
import { type MessageRef, type Messages, msg, say } from "@/lib/i18n"
import { addMasterVersion, importMasterFiles, setKeepRawCalibration, setMasterMaxAgeDays } from "@/store/actions/calibration"
import { type CommitResult, store, useStore } from "@/store/core"

/** Master files the chooser lists and the import preview reads. */
export const MASTER_FILE_FILTERS = [".fits", ".fit", ".xisf"] as const

/** Re-sets `reset` each time a controlled dialog opens, so it always starts from the current values. */
function useOnOpen(open: boolean, reset: () => void) {
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) reset()
  }
}

// ---------------------------------------------------------------------------
// NameDialog
// ---------------------------------------------------------------------------

export interface NameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  label: string
  initial: string
  confirmLabel: string
  /** Returns an error message to keep the dialog open, or null when done. */
  onSubmit: (name: string) => string | null
  /** Names already taken (compared case-insensitively). */
  taken?: string[]
}

export function NameDialog({ open, onOpenChange, title, description, label, initial, confirmLabel, onSubmit, taken = [] }: NameDialogProps) {
  const m = useMessages()
  const [name, setName] = useState(initial)
  useOnOpen(open, () => setName(initial))
  const trimmed = name.trim()
  const clash = trimmed !== "" && taken.some((t) => t.toLowerCase() === trimmed.toLowerCase()) ? m.targets_name_taken({ label, name: trimmed }) : null
  const blocked = trimmed === "" ? m.targets_name_empty({ label }) : clash
  const confirm: Action = {
    id: "name-confirm",
    label: confirmLabel,
    kind: "primary",
    unavailable: blocked ? { action: m.actions_blocked({ action: confirmLabel }), reason: blocked, blockers: [] } : undefined,
    run: (): CommitResult => {
      const failure = onSubmit(trimmed)
      return failure ? { ok: false, reason: "write-failed", message: failure } : { ok: true }
    },
  }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={title} size="sm" confirm={confirm}>
      <TextField label={label} description={description} value={name} onChange={setName} autoFocus error={clash ?? undefined} />
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Matching (CAL-FR-13)
// ---------------------------------------------------------------------------

const MATCH_TONE: Record<MasterMatch["kind"], Tone> = { new: "success", version: "info", duplicate: "muted" }

/** The preview's Match cell: New, New version of {master}, Duplicate, or Not a master. */
function MatchPill({ match }: { match: MasterMatch | null }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  if (!match) return <Pill tone="muted">{m.store_cal_not_a_master()}</Pill>
  return <Pill tone={MATCH_TONE[match.kind]}>{say(m, masterMatchRef(catalog, match))}</Pill>
}

/** "Dark 300 s", "Flat 1.5 s", "Bias": the header's kind with the exposure darks and flats depend on. */
function headerKind(m: Messages, file: DiskFile): string {
  const kind = masterKindOf(file)
  if (!kind) return "–"
  const name = say(m, KIND_NAME[kind])
  return kind === "bias" || !file.header ? name : `${name} ${formatExposure(file.header.exposureS)}`
}

/** "100 · 50": gain and offset as the header records them. */
function gainOffset(gain: number | null | undefined, offset: number | null | undefined): string {
  return `${gain ?? "–"} · ${offset ?? "–"}`
}

function temperature(celsius: number | null | undefined): string {
  return celsius === null || celsius === undefined ? "–" : `${Math.round(celsius)} °C`
}

// ---------------------------------------------------------------------------
// Two-step flows on local state
// ---------------------------------------------------------------------------

interface TwoSteps {
  first: { id: string; label: string; summary?: string; gate: FlowStep["gate"] }
  second: { id: string; label: string; gate: FlowStep["gate"] }
  /** Whether the first step is done and the second is current. */
  onSecond: boolean
  setOnSecond: (onSecond: boolean) => void
  /** The second step's Proceed: the dialog's commit. */
  commit: Action
}

/** A Choose → Preview flow (FormDialog `steps`): Proceed moves on, the earlier step reopens. */
function twoStepFlow(m: Messages, { first, second, onSecond, setOnSecond, commit }: TwoSteps): StepFlow {
  const state = (gate: FlowStep["gate"]): FlowStep["state"] => (gate ? "blocked" : "current")
  return {
    steps: [
      { id: first.id, label: first.label, state: onSecond ? "finished" : state(first.gate), gate: onSecond ? null : first.gate, summary: first.summary },
      { id: second.id, label: second.label, state: onSecond ? state(second.gate) : "todo", gate: onSecond ? second.gate : null },
    ],
    current: onSecond ? second.id : first.id,
    ordered: true,
    proceed: onSecond ? commit : { id: `${first.id}-proceed`, label: m.stepflow_proceed(), run: () => setOnSecond(true) },
    next: null,
    reopen: () => ({ id: `${first.id}-reopen`, label: m.stepflow_reopen_step(), run: () => setOnSecond(false) }),
  }
}

// ---------------------------------------------------------------------------
// Import masters (CAL-FR-13)
// ---------------------------------------------------------------------------

interface PreviewFile {
  file: DiskFile
  match: MasterMatch | null
}

function previewOf(folder: string): PreviewFile[] {
  const { catalog, disk } = store.getState()
  return filesUnder(disk, folder)
    .filter((file) => MASTER_FILE_FILTERS.some((ext) => file.path.toLowerCase().endsWith(ext)) && !file.linkTarget)
    .map((file) => ({ file, match: masterImportMatch(catalog, disk, file) }))
}

const importable = (row: PreviewFile) => row.match !== null && row.match.kind !== "duplicate"

/** File and Match lead, so what each file is to the library stays in view while the header facts scroll in the dialog's width. */
function previewColumns(m: Messages): Column<PreviewFile>[] {
  return [
    { id: "file", header: m.dialog_col_file(), cell: (r) => fileName(r.file.path), sortValue: (r) => fileName(r.file.path), rowHeader: true, truncate: true },
    { id: "match", header: m.import_match(), cell: (r) => <MatchPill match={r.match} />, sortValue: (r) => r.match?.kind ?? "" },
    { id: "kind", header: m.run_col_kind(), cell: (r) => headerKind(m, r.file), sortValue: (r) => headerKind(m, r.file) },
    { id: "camera", header: m.calibration_key_camera(), cell: (r) => r.file.header?.instrument ?? "–", sortValue: (r) => r.file.header?.instrument ?? "", truncate: true },
    { id: "gain", header: m.session_gain_offset(), cell: (r) => gainOffset(r.file.header?.gain, r.file.header?.offset), sortValue: (r) => r.file.header?.gain ?? null, align: "right" },
    { id: "temp", header: m.calibration_key_temp(), cell: (r) => temperature(r.file.header?.ccdTempC), sortValue: (r) => r.file.header?.ccdTempC ?? null, align: "right" },
  ]
}

/** What one Import masters run did: imported, and refused with the first reason. */
function importOutcome(m: Messages, paths: string[]): CommitResult {
  const outcomes = importMasterFiles(paths)
  const imported = outcomes.filter((o) => o.result.ok && o.masterId !== null).length
  const refused = outcomes.flatMap((o) => (o.result.ok ? [] : [`${fileName(o.path)} · ${o.result.message}`]))
  if (imported === 0) return { ok: false, reason: "refused", message: refused[0] ?? m.calibration_import_none_imported(), reasons: refused }
  toast({ message: refused.length > 0 ? m.calibration_import_partly({ imported, refused: refused.length }) : m.calibration_masters_imported({ count: imported }) })
  return { ok: true }
}

export interface ImportMastersDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function ImportMastersDialog({ open, onOpenChange }: ImportMastersDialogProps) {
  const m = useMessages()
  // Generated masters sit in a Project's Processing/<Tool>/ folder, so the chooser starts at the last Processing parent.
  const initialPath = useStore((s) => s.settings.lastProcessingParent)
  const [folder, setFolder] = useState<string | null>(null)
  const [rows, setRows] = useState<PreviewFile[]>([])
  const [selected, setSelected] = useState<string[]>([])
  const [onSecond, setOnSecond] = useState(false)
  useOnOpen(open, () => {
    setFolder(null)
    setRows([])
    setSelected([])
    setOnSecond(false)
  })
  const choose = (path: string) => {
    const preview = previewOf(path)
    setFolder(path)
    setRows(preview)
    setSelected(preview.filter(importable).map((r) => r.file.path))
  }
  const title = m.calibration_import_masters()
  const flow = twoStepFlow(m, {
    first: { id: "folder", label: m.import_column_folder(), summary: folder ? fileName(folder) : undefined, gate: folder ? null : { reason: m.fields_path_none_folder(), blockers: [] } },
    second: { id: "preview", label: m.import_preview(), gate: selected.length > 0 ? null : { reason: m.calibration_import_select_files(), blockers: [] } },
    onSecond,
    setOnSecond,
    commit: { id: "import-masters", label: m.stepflow_import(), run: () => importOutcome(m, selected) },
  })
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={title} size="lg" steps={flow}>
      {({ step, editable }) =>
        step === "folder" ? (
          <PathField label={m.import_column_folder()} description={m.calibration_import_folder_help()} mode="folder" value={folder} onChange={choose} initialPath={initialPath} disabled={!editable} />
        ) : (
          <DataTable
            label={m.calibration_import_files({ folder: folder ? fileName(folder) : "–" })}
            rows={rows}
            columns={previewColumns(m)}
            getRowId={(r) => r.file.path}
            selection={editable ? { selected, onChange: setSelected, rowLabel: (r) => fileName(r.file.path), isSelectable: importable, countLabel: (count) => m.calibration_files_selected({ count }) } : undefined}
            empty={<Notice tone="info" title={m.calibration_import_no_files()} />}
            stickyFirstColumn
          />
        )
      }
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Add a version to a master (CAL-FR-14)
// ---------------------------------------------------------------------------

/** Why `match` cannot be added as a version of `master`, as Add version refuses it; null when it can. */
function versionRefusal(match: MasterMatch | null, master: CalibrationMaster, name: MessageRef): MessageRef | null {
  if (!match) return msg("store_cal_not_master_imagetyp")
  if (match.kind === "duplicate") return msg("store_cal_already_in_library")
  return match.kind === "version" && match.master.id === master.id ? null : msg("store_cal_not_version_of", { master: name })
}

export interface AddMasterVersionDialogProps {
  master: CalibrationMaster | null
  onOpenChange: (open: boolean) => void
}

/** Open while `master` is set. */
export function AddMasterVersionDialog({ master, onOpenChange }: AddMasterVersionDialogProps) {
  const m = useMessages()
  const state = useStore((s) => s)
  const open = master !== null
  const [path, setPath] = useState<string | null>(null)
  const [onSecond, setOnSecond] = useState(false)
  useOnOpen(open, () => {
    setPath(null)
    setOnSecond(false)
  })
  if (!master) return null
  const name = masterRecordRef(state.catalog, master)
  const file = path ? fileAt(state.disk, path) : undefined
  const match = file ? masterImportMatch(state.catalog, state.disk, file) : null
  const refusal = path ? (file ? versionRefusal(match, master, name) : msg("store_cal_path_unreadable", { path })) : null
  const newest = newestVersion(master)
  const title = say(m, msg("store_cal_label_add_version", { master: name }))
  const flow = twoStepFlow(m, {
    first: { id: "file", label: m.calibration_replace_file(), summary: path ? fileName(path) : undefined, gate: path ? null : { reason: m.fields_path_none_file(), blockers: [] } },
    second: { id: "match", label: m.import_match(), gate: refusal ? { reason: say(m, refusal), blockers: [] } : null },
    onSecond,
    setOnSecond,
    commit: {
      id: "add-version",
      label: m.calibration_add_version(),
      run: () => {
        const outcome = addMasterVersion(master.id, path ?? "")
        if (outcome.result.ok) toast({ message: say(m, msg("calibration_version_added", { master: name })) })
        return outcome.result
      },
    },
  })
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={title} size="lg" steps={flow}>
      {({ step, editable }) =>
        step === "file" ? (
          <PathField
            label={m.calibration_replace_file()}
            description={m.calibration_replace_file_help()}
            mode="file"
            filters={MASTER_FILE_FILTERS}
            value={path}
            onChange={setPath}
            initialPath={newest ? newest.path.slice(0, newest.path.lastIndexOf("/")) : null}
            disabled={!editable}
          />
        ) : (
          <>
            <KeyValueList
              items={[
                { label: m.dialog_col_file(), value: path ?? "–", mono: true },
                { label: m.import_match(), value: refusal ? say(m, refusal) : <MatchPill match={match} /> },
              ]}
            />
            <Notice tone="info" title={m.calibration_add_version_moves_none()} />
          </>
        )
      }
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Calibration settings
// ---------------------------------------------------------------------------

export interface CalibrationSettingsDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function CalibrationSettingsDialog({ open, onOpenChange }: CalibrationSettingsDialogProps) {
  const m = useMessages()
  const [keep, setKeep] = useState(false)
  const [days, setDays] = useState<number | null>(null)
  useOnOpen(open, () => {
    const { settings } = store.getState()
    setKeep(settings.keepRawCalibration)
    setDays(settings.masterMaxAgeDays)
  })
  const confirm: Action = {
    id: "calibration-settings-save",
    label: m.settings_save(),
    kind: "primary",
    run: (): CommitResult => {
      const { settings } = store.getState()
      const kept = keep === settings.keepRawCalibration ? { ok: true as const } : setKeepRawCalibration(keep)
      if (!kept.ok) return kept
      const aged = days === settings.masterMaxAgeDays ? { ok: true as const } : setMasterMaxAgeDays(days ?? Number.NaN)
      if (aged.ok) toast({ message: m.calibration_settings_saved() })
      return aged
    },
  }
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={m.calibration_settings()} size="sm" confirm={confirm}>
      <SwitchField label={m.settings_keep_raws()} description={m.settings_keep_raws_help()} checked={keep} onChange={setKeep} />
      <NumberField label={say(m, msg("flow_settings_master_age"))} unit={m.calibration_unit_days()} description={m.calibration_master_age_help()} value={days} onChange={setDays} min={1} step={1} />
    </FormDialog>
  )
}
