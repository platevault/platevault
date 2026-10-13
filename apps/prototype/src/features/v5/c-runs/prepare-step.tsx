/**
 * S5 Prepare (§5.4, P-PREP3): Field rows, then the Inputs DataTable.
 * - Profile: the application tools PlateVault detected (user item 161).
 * - Run view: Symlinks · Copies with the footprint each writes. Symlinks
 *   are refused while Windows Developer Mode is off, with "Use copies for
 *   this run" beside the refusal.
 * - Output folder: the parent the run folder is created in.
 * Prepare… is the commit step's Proceed (F2): it confirms the folder layout
 * and every input, runs the preparation, and opens Results once it is
 * prepared and verified. Open in {app} sits in the table's toolbar once
 * prepared (and in Run ▾). Corrections are made at intake and applied here
 * without a per-field choice (C15).
 */
import { FolderOpen } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column, ConfirmSpec, FileRow } from "@/components/app/contracts"
import { PathText } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { PathField, SegmentedField, SelectField } from "@/components/app/fields"
import { OperationLine } from "@/components/app/operation-panel"
import { Refusal } from "@/components/app/refusal"
import { SettingsSection } from "@/components/app/settings"
import { StatusBadge } from "@/components/app/status"
import { runPreparations } from "@/domain/derive"
import { MODE_NAME, orderedProfiles, profileRef } from "@/domain/labels"
import type { InputMode, Preparation } from "@/domain/types"
import { fileName, formatBytes, formatDateTime } from "@/lib/format"
import { joinRefs, type Messages, msg, say } from "@/lib/i18n"
import { checkDeveloperMode, openWindowsDeveloperSettings } from "@/store/actions/settings"
import { type CommitResult, useStore } from "@/store/core"
import { isSettled } from "@/store/operations"
import { chooseMode, chooseProfile, openPreparation, setOutputParent } from "./actions"
import { currentPreparation, type ModeOption, type PrepareEntry, type PreparePlan, type RunContext, runLock, viewFootprintRef } from "./model"

/** What the Prepare fields write to: a run's own setup, or a run group's shared one (D-W38). */
export type PrepareTarget = { runId: string } | { groupId: string }

export interface PrepareSetup {
  target: PrepareTarget
  profileId: string | null
  mode: InputMode
  modes: ModeOption[]
  outputParent: string | null
  /** The folder the next Prepare creates, shown under the output folder. */
  folderPath: string | null
  /** A panel run's setup is its group's: "Shared by every panel" under the profile. */
  shared: boolean
}

type FieldId = "profile" | "mode" | "folder"

function failureText(result: CommitResult): string | null {
  if (result.ok) return null
  return result.reason === "refused" ? result.reasons.join(" · ") : result.message
}

/** Profile, Run view and Output folder as Field rows; a refused change shows on its own field. */
export function PrepareFields({ setup, editable }: { setup: PrepareSetup; editable: boolean }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const developerModeOff = useStore((s) => s.settings.developerModeCheck === "off")
  const [errors, setErrors] = useState<Partial<Record<FieldId, string>>>({})
  const commit = (field: FieldId, result: CommitResult) => setErrors((e) => ({ ...e, [field]: failureText(result) ?? undefined }))
  const { target } = setup
  // Detected tools only (user item 161), and the chosen profile whatever its state.
  const profiles = orderedProfiles(catalog).filter((p) => p.executableState === "found" || p.executableState === "launch-fails" || p.id === setup.profileId)
  const profileOptions = [...(setup.profileId ? [] : [{ value: "", label: m.run_layout_not_chosen(), disabled: true }]), ...profiles.map((p) => ({ value: p.id, label: say(m, profileRef(p)) }))]
  const chosen = setup.modes.find((o) => o.mode === setup.mode)
  const modeError = chosen && !chosen.allowed && !chosen.developerModeOff ? chosen.reasons.map((r) => say(m, r)).join(" · ") : undefined
  const useCopies: Action = { id: "use-copies", label: m.run_use_copies(), run: () => chooseMode(target, "copy") }
  const openSettings: Action = { id: "developer-settings", label: m.settings_open_windows_settings(), run: () => openWindowsDeveloperSettings() }
  const checkAgain: Action = { id: "check-again", label: m.apps_check_again(), run: () => checkDeveloperMode() }
  return (
    <>
      <SettingsSection title={m.run_prepare_setup()}>
        <SelectField
          label={m.run_check_profile()}
          value={setup.profileId ?? ""}
          options={profileOptions}
          disabled={!editable}
          description={setup.shared ? m.run_prepare_shared_title() : undefined}
          error={errors.profile}
          onChange={(id) => commit("profile", chooseProfile(target, id))}
        />
        <SegmentedField
          label={m.run_check_mode()}
          value={setup.mode}
          options={setup.modes.map((o) => ({ value: o.mode, label: say(m, MODE_NAME[o.mode]) }))}
          disabled={!editable}
          description={chosen ? say(m, viewFootprintRef(chosen.mode, chosen.entries, chosen.footprintBytes)) : undefined}
          error={errors.mode ?? modeError}
          onChange={(mode) => commit("mode", chooseMode(target, mode))}
        />
        <PathField
          mode="folder"
          label={m.run_layout_output_folder()}
          value={setup.outputParent}
          disabled={!editable}
          description={setup.folderPath ? m.run_prepare_creates({ folder: fileName(setup.folderPath) }) : undefined}
          error={errors.folder}
          onChange={(path) => commit("folder", setOutputParent(target, path))}
        />
      </SettingsSection>
      {editable && setup.mode === "symlink" && developerModeOff ? (
        <Refusal
          standing
          action={m.run_cant_prepare()}
          reason={m.run_mode_needs_developer_mode()}
          blockers={[]}
          actions={
            <>
              <ActionButton action={useCopies} />
              <ActionButton action={openSettings} />
              <ActionButton action={checkAgain} />
            </>
          }
        />
      ) : null}
    </>
  )
}

/** An input's state in the run view: blocked with its reason, prepared, or still to prepare. */
function EntryState({ entry, prep }: { entry: PrepareEntry; prep: Preparation | null }) {
  const m = useMessages()
  const blocked = entry.unavailable ?? prep?.blocked.find((b) => b.path === entry.sourcePath)?.reason ?? null
  if (blocked) return <StatusBadge kind="item" value="blocked" label={say(m, blocked)} />
  if (prep?.state === "running") return <StatusBadge kind="item" value="running" />
  const prepared = prep && (prep.state === "prepared" || prep.state === "partial") && (entry.assetId ? prep.preparedAssetIds.includes(entry.assetId) : prep.state === "prepared")
  return prepared ? <StatusBadge kind="item" value="done" label={m.status_prepared()} /> : <StatusBadge kind="item" value="pending" label={m.run_entry_to_prepare()} />
}

function entryKind(m: Messages, entry: PrepareEntry): string {
  return entry.kind === "calibration" ? m.run_entry_master() : m.run_entry_frame()
}

/** Every input the run view holds: the frames and the masters handed off. */
export function inputColumns(m: Messages, prep: Preparation | null, mode: InputMode): Column<PrepareEntry>[] {
  return [
    { id: "file", header: m.run_col_file(), rowHeader: true, truncate: true, cell: (e) => e.fileName, sortValue: (e) => e.fileName },
    { id: "kind", header: m.run_col_kind(), cell: (e) => entryKind(m, e), sortValue: (e) => e.kind },
    { id: "from", header: m.run_col_source(), truncate: true, cell: (e) => <PathText path={e.sourcePath.slice(0, e.sourcePath.lastIndexOf("/"))} truncate />, sortValue: (e) => e.sourcePath },
    { id: "size", header: m.run_col_size(), align: "right", cell: (e) => formatBytes(mode === "copy" ? e.sizeBytes : 0), sortValue: (e) => e.sizeBytes },
    { id: "state", header: m.run_col_state(), cell: (e) => <EntryState entry={e} prep={prep} />, sortValue: (e) => (e.unavailable ? 0 : 1) },
  ]
}

export function PrepareStep({ ctx, plan, editable }: { ctx: RunContext; plan: PreparePlan; editable: boolean }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const { run } = ctx
  const prep = currentPreparation(run, runPreparations(state.catalog, run.id))
  const op = prep?.operationId ? state.operations[prep.operationId] : undefined
  const profile = prep ? state.catalog.profiles[prep.profileId] : undefined
  const openIn: Action[] = prep?.state === "prepared" && profile ? [{ id: "open", label: m.run_open_in({ app: say(m, profileRef(profile)) }), icon: FolderOpen, run: () => openPreparation(run.id) }] : []
  const setup: PrepareSetup = {
    target: run.groupId ? { groupId: run.groupId } : { runId: run.id },
    profileId: plan.profile?.id ?? null,
    mode: plan.mode,
    modes: plan.modes,
    outputParent: plan.layout.parent.path,
    folderPath: plan.layout.folderPath,
    shared: run.groupId !== null,
  }
  return (
    <>
      <PrepareFields setup={setup} editable={editable && runLock(run) === null} />
      {op && !isSettled(op.status) ? <OperationLine operationId={op.id} /> : null}
      {prep?.unverified ? (
        <Refusal
          standing
          action={m.run_unverified_since({ date: formatDateTime(prep.unverified.at) })}
          reason={m.run_entries_changed({ count: prep.unverified.changed.length })}
          blockers={prep.unverified.changed.slice(0, 8).map((c) => ({ label: `${fileName(c.path)} · ${say(m, c.reason)}` }))}
        />
      ) : null}
      <DataTable
        label={m.run_prepare_inputs()}
        rows={plan.entries}
        columns={inputColumns(m, prep, plan.mode)}
        getRowId={(e) => e.id}
        initialSort={{ columnId: "file", direction: "asc" }}
        scroll="none"
        toolbar={openIn.length > 0 ? { actions: openIn } : undefined}
      />
    </>
  )
}

/** One input of the run view Prepare writes: its source folder and the run folder it goes to. */
export function prepareRows(m: Messages, plan: PreparePlan): FileRow[] {
  return plan.entries.map((entry) => ({
    file: entry.fileName,
    from: entry.sourcePath.slice(0, entry.sourcePath.lastIndexOf("/")),
    to: entry.destPath.slice(0, entry.destPath.lastIndexOf("/")),
    action: "copy",
    size: plan.mode === "copy" && !entry.unavailable ? entry.sizeBytes : 0,
    status: entry.unavailable ? { label: say(m, entry.unavailable) } : undefined,
  }))
}

/** Prepare…'s confirm (F2): the run folder it creates, the run view with its footprint, and every input. */
export function prepareConfirm(m: Messages, plan: PreparePlan): ConfirmSpec {
  const { layout, run } = plan
  const chosen = plan.modes.find((o) => o.mode === plan.mode)!
  return {
    title: layout.prepRevision > 1 ? m.run_prepare_title_rev({ name: run.name, revision: layout.prepRevision }) : m.run_prepare_title({ name: run.name }),
    summary: say(m, joinRefs([...(layout.folderPath ? [msg("run_prepare_creates", { folder: fileName(layout.folderPath) })] : []), MODE_NAME[plan.mode], viewFootprintRef(plan.mode, chosen.entries, chosen.footprintBytes)], " · ")),
    groups: [{ label: m.run_prepare_inputs(), rows: prepareRows(m, plan) }],
    confirm: { label: m.run_prepare_confirm({ count: plan.entries.length }) },
  }
}
