/**
 * Catalogue entry for the dialogs (design/R9-COMPOSITION-PLAN.md P8, §8.3):
 * ConfirmDialog default, destructive, busy, error, title only and file
 * groups folded and unfolded; FormDialog default, disabled with a reason,
 * busy, error and an optional step with Skip. DialogFooter renders inside
 * each. The demo actions write nothing to the store: failures come back as
 * results, so every state can be opened here. Every visible string comes
 * from the message catalogue (catalogue_dialogs_* for reviewer captions).
 */
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton, actionLabel, useAction } from "@/components/app/actions"
import { ConfirmDialog, type ConfirmGroup } from "@/components/app/confirm-dialog"
import type { Action, ConfirmSpec, FileRow } from "@/components/app/contracts"
import { TextField } from "@/components/app/fields"
import { type DialogCommit, FormDialog } from "@/components/app/form-dialog"
import { Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { formatBytes } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import type { CommitResult } from "@/store/core"
import { useStore } from "@/store/core"
import { ComponentSection, Specimen } from "./specimen"

const CAPTURES = "/Volumes/Astro-T7/Captures/M31/2026-09-18"
const ARCHIVE = "/Volumes/Archive/M31/2026-09-18"
const WORK = "/Volumes/Astro-T7/Work/M31 LRGB"

const done = (): CommitResult => ({ ok: true })

/** Settles after a moment, so the busy state can be seen. */
const slowly = (): Promise<CommitResult> => new Promise((resolve) => setTimeout(() => resolve({ ok: true }), 1500))

/** A failed write: the dialog stays open with the error and Retry. */
const failing = (m: Messages) => (): CommitResult => ({ ok: false, reason: "write-failed", message: m.op_prep_write_removed({ folder: CAPTURES }) })

function frames(count: number, filter: string, action: FileRow["action"], to?: string): FileRow[] {
  return Array.from({ length: count }, (_, index) => ({ file: `M31_${filter}_300s_${String(index + 1).padStart(4, "0")}.fits`, from: CAPTURES, to, action, size: 33_554_432 }))
}

/** The Trash groups: unusable frames with per-file refusals, intermediates, and a group with nothing in it. */
function trashGroups(m: Messages, defaultOpen: boolean): ConfirmGroup[] {
  const rejects = frames(6, "L", "trash")
  rejects[1] = { ...rejects[1]!, status: { label: m.run_profile_read_only() } }
  rejects[3] = { ...rejects[3]!, status: { label: m.calibration_used_by_runs({ count: 1 }), link: { to: "/projects" } } }
  const intermediates: FileRow[] = ["registered", "calibrated", "integrated"].map((stage) => ({ file: `M31_L_${stage}.xisf`, from: WORK, action: "trash", size: 402_653_184 }))
  return [
    { label: m.wrapup_offer_rejects(), rows: rejects, defaultOpen },
    { label: m.run_results_intermediates(), rows: intermediates, defaultOpen },
    { label: m.wrapup_offer_duplicates_label(), rows: [] },
  ]
}

function totals(groups: ConfirmGroup[]) {
  const rows = groups.flatMap((group) => group.rows)
  return { count: rows.length, size: formatBytes(rows.reduce((sum, row) => sum + row.size, 0)), locations: new Set(rows.map((row) => row.from)).size }
}

/** The trigger label of a control that opens a dialog: "Move to Trash…". */
function opener(label: string): string {
  return actionLabel({ id: label, label, opensDialog: true, run: done })
}

interface ConfirmSpecimenProps extends ConfirmSpec {
  caption: string
  onConfirm: DialogCommit
}

/** A ConfirmDialog behind its own trigger, so each state opens on its own. */
function ConfirmSpecimen({ caption, ...spec }: ConfirmSpecimenProps) {
  return (
    <Specimen caption={caption}>
      <ConfirmDialog {...spec} trigger={<Button variant="outline" size="sm">{opener(spec.confirm.label)}</Button>} />
    </Specimen>
  )
}

function ConfirmSpecimens({ archiveName }: { archiveName: string }) {
  const m = useMessages()
  const folded = trashGroups(m, false)
  const unfolded = trashGroups(m, true)
  const sum = totals(folded)
  const trashTitle = m.catalogue_dialogs_trash_title({ count: sum.count })
  const trashSummary = m.catalogue_dialogs_totals({ size: sum.size, count: sum.locations })
  const trash = { label: m.run_move_to_trash(), kind: "destructive" as const }
  const archiveGroups: ConfirmGroup[] = [{ label: m.nav_sessions(), rows: frames(4, "R", "move", ARCHIVE) }]
  const archive = { label: m.wrapup_archive_title() }
  // The default specimen goes through useAction, so a ConfirmSpec on an Action opens the same dialog.
  const runner = useAction()
  const archiveAction: Action = {
    id: "archive",
    label: m.wrapup_archive_title(),
    run: done,
    confirm: { title: m.wrapup_archive_confirm_title({ name: archiveName }), groups: archiveGroups, confirm: archive },
  }
  return (
    <ComponentSection components={["ConfirmDialog"]} description={m.catalogue_dialogs_confirm_caption()} level={3}>
      <div className="space-y-2">
        <Specimen caption={m.catalogue_dialogs_state_default()}>
          <ActionButton action={archiveAction} runner={runner} />
          {runner.dialog}
          {runner.feedback}
        </Specimen>
        <ConfirmSpecimen caption={m.catalogue_dialogs_state_destructive()} title={trashTitle} summary={trashSummary} groups={folded} confirm={trash} onConfirm={done} />
        <ConfirmSpecimen caption={m.catalogue_dialogs_state_folded()} title={trashTitle} groups={folded} confirm={trash} onConfirm={done} />
        <ConfirmSpecimen caption={m.catalogue_dialogs_state_unfolded()} title={trashTitle} summary={trashSummary} groups={unfolded} confirm={trash} onConfirm={done} />
        <ConfirmSpecimen caption={m.catalogue_dialogs_state_busy()} title={m.wrapup_archive_confirm_title({ name: archiveName })} groups={archiveGroups} confirm={archive} onConfirm={slowly} />
        <ConfirmSpecimen caption={m.catalogue_dialogs_state_error()} title={m.wrapup_archive_confirm_title({ name: archiveName })} groups={archiveGroups} confirm={archive} onConfirm={failing(m)} />
        <ConfirmSpecimen caption={m.catalogue_dialogs_state_title_only()} title={m.template_delete_title({ name: archiveName })} confirm={{ label: m.template_delete(), kind: "destructive" }} onConfirm={done} />
      </div>
    </ComponentSection>
  )
}

/** A rename FormDialog: unavailable while the name is empty, then `run` commits it. */
function RenameSpecimen({ caption, name, run, startEmpty = false }: { caption: string; name: string; run: Action["run"]; startEmpty?: boolean }) {
  const m = useMessages()
  const [value, setValue] = useState(startEmpty ? "" : name)
  const empty = value.trim() === ""
  const confirm: Action = {
    id: "rename",
    label: m.equipment_rename(),
    run,
    unavailable: empty ? { action: m.actions_blocked({ action: m.equipment_rename() }), reason: m.settings_name_required(), blockers: [] } : undefined,
  }
  return (
    <Specimen caption={caption}>
      <FormDialog
        title={m.equipment_rename_title({ name })}
        size="sm"
        confirm={confirm}
        onOpenChange={(open) => {
          if (open) setValue(startEmpty ? "" : name)
        }}
        trigger={<Button variant="outline" size="sm">{opener(m.equipment_rename())}</Button>}
      >
        <TextField label={m.equipment_rig_name()} value={value} onChange={setValue} />
      </FormDialog>
    </Specimen>
  )
}

function SkipSpecimen({ name }: { name: string }) {
  const m = useMessages()
  const [value, setValue] = useState(name)
  const proceed: Action = { id: "proceed", label: m.catalogue_dialogs_proceed(), kind: "primary", run: done }
  const skip: Action = { id: "skip", label: m.wrapup_skip(), run: done }
  return (
    <Specimen caption={m.catalogue_dialogs_state_skip()}>
      <FormDialog
        title={m.equipment_rename_title({ name })}
        confirm={proceed}
        skip={skip}
        trigger={<Button variant="outline" size="sm">{opener(proceed.label)}</Button>}
      >
        <TextField label={m.equipment_rig_name()} value={value} onChange={setValue} />
      </FormDialog>
    </Specimen>
  )
}

function FormSpecimens({ rigName }: { rigName: string }) {
  const m = useMessages()
  return (
    <ComponentSection components={["FormDialog", "DialogFooter"]} description={m.catalogue_dialogs_form_caption()} level={3}>
      <div className="space-y-2">
        <RenameSpecimen caption={m.catalogue_dialogs_state_default()} name={rigName} run={done} />
        <RenameSpecimen caption={m.catalogue_dialogs_state_unavailable()} name={rigName} run={done} startEmpty />
        <RenameSpecimen caption={m.catalogue_dialogs_state_busy()} name={rigName} run={slowly} />
        <RenameSpecimen caption={m.catalogue_dialogs_state_error()} name={rigName} run={failing(m)} />
        <SkipSpecimen name={rigName} />
      </div>
    </ComponentSection>
  )
}

export function DialogsCatalogue() {
  const m = useMessages()
  const targets = useStore((s) => s.catalog.targets)
  const rigs = useStore((s) => s.catalog.opticalTrains)
  const target = Object.values(targets)[0]?.name ?? ""
  const rig = Object.values(rigs)[0]?.name ?? target
  return (
    <Section title={m.catalogue_dialogs_heading()} description={m.catalogue_dialogs_summary()}>
      <div className="space-y-6">
        <ConfirmSpecimens archiveName={target} />
        <FormSpecimens rigName={rig} />
      </div>
    </Section>
  )
}
