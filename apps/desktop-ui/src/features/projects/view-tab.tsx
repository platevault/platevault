/**
 * The Project's View tab (066 VSEL-FR-12 to 21, 069 PREP-FR-01 to 19): the
 * View settings, the Apply this window runs or last ran, the pending changes
 * with their source, and what `View (previous)/` still holds.
 *
 * Every change stays pending until Apply. The Apply sheet (`ApplySheet`,
 * opened by Apply… as `?apply=open`) is built from one `project_apply_preview`
 * read and Apply echoes that read's revision and basis digest: what the user
 * reviewed is what runs, and the library refuses a sheet that went stale
 * with `conflict`. A sheet whose plan changed while it was open says so and
 * shows the latest only on request. Apply stays unavailable while any
 * blocker holds; the sheet lists each with the place it is resolved.
 *
 * A running Apply shows its waiting state (which folder a tool holds and
 * since when, from its durable status) and Cancel; a canceled, failed,
 * stopped or refused Apply is reported as such and never as applied.
 */
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { CopyCheck, FolderOpen, Pencil, Trash2, X } from "lucide-react"
import { useState } from "react"
import { type ApplyReport_Serialize, library, type NativePathWire, type PendingChange_Serialize, type PreviousItem_Serialize, type ProjectViewSettings_Serialize, type ViewMode } from "@/api/ipc"
import { libraryQuery } from "@/api/query"
import { useMessages } from "@/app/preferences"
import { labelOf, useSessionSummaries } from "@/components/domain/session-label"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { Notice, toast } from "@/components/app/feedback"
import { SegmentedField, SelectField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { BoxTable } from "@/components/app/box"
import { Refusal } from "@/components/app/refusal"
import { failureMessage } from "@/components/app/run-result"
import { DetailPage, type DetailSection } from "@/components/templates/detail-page"
import { formatBytes, formatCount, formatDateTime } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { ApplySheet } from "./apply-sheet"
import { type ApplyRun, cancelApply, dismissApply, useApplyRun } from "./apply-run"
import { changeSession, changeSource, changeText, sourceText, stopText } from "./apply-words"
import type { ProjectTabProps } from "./project-page"
import { inputsQuery, isLocked, previousItemsQuery, projectWrite } from "./queries"
import { modeText, pathText, reasonText } from "./words"

export function ViewTab({ header, chrome, search }: ProjectTabProps) {
  const m = useMessages()
  const navigate = useNavigate()
  const locked = isLocked(header.lifecycle)
  const inputs = useQuery(inputsQuery(header.id))
  const previous = useQuery(previousItemsQuery(header.id))
  const run = useApplyRun(header.id)
  const [editing, setEditing] = useState(false)
  const desired = inputs.data?.desired
  const pending = inputs.data?.pending ?? []
  const sessions = useSessionSummaries(pending.flatMap((c) => changeSession(c) ?? []))
  const groupName = (id: string) => desired?.groups.find((g) => g.id === id)?.name ?? m.project_group_missing()
  const sheetOpen = search.apply === "open" && !locked
  const setSheet = (open: boolean) =>
    void navigate({ to: "/projects/$projectId", params: { projectId: header.id }, search: open ? { stage: "view", apply: "open" } : { stage: "view" }, replace: true })

  const sections: DetailSection[] = []
  if (run) sections.push({ id: "apply-run", title: m.view_apply_run_title(), content: <ApplyRunPanel projectId={header.id} run={run} onReview={() => setSheet(true)} /> })
  if (desired)
    sections.push({
      id: "view-settings",
      title: m.project_view_settings(),
      actions: locked ? [] : [{ id: "edit-view-settings", label: m.view_edit_settings(), icon: Pencil, opensDialog: true, run: () => setEditing(true) }],
      // The library has no command to open the View in its application or reveal it yet (astro-plan-wre19.8, PREP-FR-10).
      more: [
        { id: "open-in", label: m.project_open_in({ name: m.view_your_tool() }), unavailable: { action: m.actions_blocked({ action: m.project_open_in({ name: m.view_your_tool() }) }), reason: m.view_open_unavailable(), blockers: [] }, run: () => undefined },
        { id: "reveal-view", label: m.view_reveal(), unavailable: { action: m.actions_blocked({ action: m.view_reveal() }), reason: m.view_open_unavailable(), blockers: [] }, run: () => undefined },
      ],
      content: <ViewSettingsSummary settings={desired.settings} />,
    })
  sections.push({
    id: "pending",
    title: m.project_pending_changes(),
    count: pending.length,
    flush: true,
    content: <PendingTable projectName={header.name} pending={pending} sessionName={(id) => labelOf(m, sessions, id)} groupName={groupName} />,
  })
  sections.push({
    id: "previous",
    title: m.project_previous_title(),
    count: previous.data?.length ?? 0,
    flush: true,
    content: <PreviousTable projectId={header.id} locked={locked} items={previous.data ?? []} />,
  })

  return (
    <>
      <DetailPage {...chrome} title={header.name} sections={sections} />
      {desired && editing ? <ViewSettingsDialog projectId={header.id} opened={desired} onClose={() => setEditing(false)} /> : null}
      {sheetOpen ? <ApplySheet header={header} onClose={() => setSheet(false)} /> : null}
    </>
  )
}

// ---------------------------------------------------------------------------
// The running or last Apply
// ---------------------------------------------------------------------------

function ApplyRunPanel({ projectId, run, onReview }: { projectId: string; run: ApplyRun; onReview: () => void }) {
  const m = useMessages()
  if (run.phase === "starting" || run.phase === "running") {
    const blocked = (reason: string) => ({ action: m.actions_blocked({ action: m.verb_cancel() }), reason, blockers: [] })
    const canceling = run.phase === "running" && run.cancelRequested
    const cancel: Action = {
      id: "cancel-apply",
      label: m.verb_cancel(),
      icon: X,
      run: () => cancelApply(projectId),
      unavailable: run.phase === "starting" ? blocked(m.view_apply_cancel_not_yet()) : canceling ? blocked(m.view_apply_canceling()) : undefined,
    }
    const waiting = run.phase === "running" ? run.progress.waiting : null
    return (
      <Notice tone="info" title={canceling ? m.view_apply_canceling() : m.view_apply_running()}>
        {waiting ? <p>{m.project_apply_waiting({ time: formatDateTime(waiting.since), path: pathText(waiting.held) })}</p> : null}
        <ActionButton action={cancel} />
      </Notice>
    )
  }
  const dismiss: Action = { id: "dismiss-apply", label: m.verb_close(), run: () => dismissApply(projectId) }
  if (run.phase === "stopped") {
    return (
      <Notice tone="warning" title={m.view_apply_unsettled()}>
        <ActionButton action={dismiss} />
      </Notice>
    )
  }
  if (!run.result.ok) {
    const review: Action = {
      id: "review-apply",
      label: m.view_apply_review_again(),
      opensDialog: true,
      run: () => {
        dismissApply(projectId)
        onReview()
      },
    }
    return (
      <>
        <Refusal action={m.actions_blocked({ action: m.project_apply() })} reason={failureMessage(m, run.result.failure)} blockers={[]} />
        <ActionButton action={review} />
        <ActionButton action={dismiss} />
      </>
    )
  }
  return <ApplyReportView report={run.result.data} dismiss={dismiss} />
}

/** How a build ended, from its report: applied with its footprint, or failed, canceled or interrupted with why and each file it names. */
function ApplyReportView({ report, dismiss }: { report: ApplyReport_Serialize; dismiss: Action }) {
  const m = useMessages()
  const failures = report.failures.map((f, i) => ({ id: String(i), path: pathText(f.path), reason: reasonText(m, f.reason.code) }))
  const columns: Column<(typeof failures)[number]>[] = [
    { id: "path", header: m.dialog_col_file(), cell: (r) => r.path, sortValue: (r) => r.path, rowHeader: true, truncate: true },
    { id: "reason", header: m.dialog_col_status(), cell: (r) => r.reason, sortValue: (r) => r.reason, truncate: true },
  ]
  const movedForeign = report.foreign.filter((f) => f.state === "moved").length
  const failedForeign = report.foreign.filter((f) => f.state === "failed")
  const applied = report.outcome === "applied"
  const title = applied ? m.view_apply_applied() : report.outcome === "canceled" ? m.view_apply_canceled() : report.outcome === "failed" ? m.op_apply_failed() : m.view_apply_unsettled()
  return (
    <Notice tone={applied ? "info" : "warning"} title={title}>
      {report.stop ? <p>{stopText(m, report.stop)}</p> : null}
      {applied ? (
        <KeyValueList
          items={[
            { label: m.view_footprint(), value: report.footprint.frames === 0 ? m.view_footprint_links_only() : `${m.view_footprint_copied({ count: report.footprint.frames, n: formatCount(report.footprint.frames) })} · ${formatBytes(report.footprint.bytes)}` },
            ...(report.correctedValues > 0 ? [{ label: m.view_col_corrected(), value: m.view_corrections_patched({ count: report.correctedValues, n: formatCount(report.correctedValues) }) }] : []),
            ...(movedForeign > 0 ? [{ label: m.project_apply_unplaced(), value: m.view_apply_foreign_moved({ count: movedForeign }) }] : []),
          ]}
        />
      ) : null}
      {failedForeign.length > 0 ? <p>{m.view_apply_foreign_failed({ count: failedForeign.length })}</p> : null}
      {report.keptMissing.map((path) => (
        <p key={pathText(path)}>{m.op_apply_kept_missing({ path: pathText(path) })}</p>
      ))}
      {failures.length > 0 ? <BoxTable label={m.view_apply_failures()} rows={failures} columns={columns} getRowId={(r) => r.id} /> : null}
      <ActionButton action={dismiss} />
    </Notice>
  )
}

// ---------------------------------------------------------------------------
// View settings
// ---------------------------------------------------------------------------

function ViewSettingsSummary({ settings }: { settings: ProjectViewSettings_Serialize }) {
  const m = useMessages()
  const profiles = useQuery(libraryQuery("prepareProfiles"))
  const profile = settings.profileId ? profiles.data?.find((p) => p.id === settings.profileId) : undefined
  return (
    <KeyValueList
      items={[
        { label: m.apps_col_application(), value: profile?.name ?? m.project_view_no_application() },
        { label: m.project_view_mode(), value: modeText(m, settings.mode) },
        { label: m.project_view_location(), value: settings.parent ? pathText(settings.parent) : m.apply_refused_no_folder(), mono: settings.parent !== null },
      ]}
    />
  )
}

/** Edit View settings…: the application, Symlinks or Copies, and the processing location; each reaches the View on the next Apply. */
function ViewSettingsDialog({ projectId, opened, onClose }: { projectId: string; opened: { revision: number; settings: ProjectViewSettings_Serialize }; onClose: () => void }) {
  const m = useMessages()
  const client = useQueryClient()
  // The draft is of what the dialog opened on: its revision and keywords never follow a re-read underneath it.
  const [{ revision, settings }] = useState(opened)
  const profiles = useQuery(libraryQuery("prepareProfiles"))
  const [mode, setMode] = useState<ViewMode>(settings.mode)
  const [profileId, setProfileId] = useState(settings.profileId ?? "")
  const [parent, setParent] = useState<NativePathWire | null>(settings.parent)
  const [pickFailed, setPickFailed] = useState<string | null>(null)
  const choose = async () => {
    const picked = await library.libraryPickFolder()
    if (!picked.ok) setPickFailed(failureMessage(m, picked.failure))
    else if (picked.data) {
      setPickFailed(null)
      setParent(picked.data)
    }
  }
  const save: Action = {
    id: "save-view-settings",
    label: m.settings_save(),
    kind: "primary",
    run: async () => {
      const result = await projectWrite(client, () =>
        library.projectSetViewSettings(projectId, revision, { mode, profileId: profileId === "" ? null : profileId, parent, keywords: settings.keywords }),
      )
      // A stale draft is never sent again on the new revision: the dialog closes on the re-read and says why.
      if (!result.ok && result.failure.source === "library" && result.failure.error.code === "conflict") {
        toast({ message: failureMessage(m, result.failure) })
        onClose()
      }
      return result
    },
  }
  return (
    <FormDialog open onOpenChange={(next) => !next && onClose()} title={m.project_view_settings()} size="md" confirm={save}>
      <SelectField
        label={m.apps_col_application()}
        value={profileId}
        options={[{ value: "", label: m.project_view_no_application() }, ...(profiles.data ?? []).map((p) => ({ value: p.id, label: p.name }))]}
        onChange={setProfileId}
      />
      <SegmentedField<ViewMode> label={m.project_view_mode()} value={mode} options={[{ value: "symlinks", label: modeText(m, "symlinks") }, { value: "copies", label: modeText(m, "copies") }]} onChange={setMode} />
      <TextField
        label={m.project_view_location()}
        value={parent ? pathText(parent) : ""}
        placeholder={m.apply_refused_no_folder()}
        onChange={() => undefined}
        readOnly
        mono
        error={pickFailed ?? undefined}
        action={<ActionButton action={{ id: "choose", label: m.verb_choose(), opensDialog: true, run: choose }} />}
      />
    </FormDialog>
  )
}

// ---------------------------------------------------------------------------
// Pending changes
// ---------------------------------------------------------------------------

interface PendingRow {
  id: string
  change: string
  source: string
  sessionId: string | null
}

function PendingTable({ projectName, pending, sessionName, groupName }: { projectName: string; pending: readonly PendingChange_Serialize[]; sessionName: (id: string) => string; groupName: (id: string) => string }) {
  const m = useMessages()
  const navigate = useNavigate()
  const rows: PendingRow[] = pending.map((change, i) => ({ id: String(i), change: changeText(m, change, sessionName, groupName), source: sourceText(m, changeSource(change)), sessionId: changeSession(change) }))
  const open = (r: PendingRow) => (r.sessionId ? void navigate({ to: "/sessions/$sessionId", params: { sessionId: r.sessionId } }) : undefined)
  const columns: Column<PendingRow>[] = [
    { id: "change", header: m.dialog_changes(), cell: (r) => r.change, sortValue: (r) => r.change, rowHeader: true, truncate: true },
    { id: "source", header: m.project_change_source(), cell: (r) => r.source, sortValue: (r) => r.source },
  ]
  return (
    <BoxTable
      label={m.project_pending_changes_of({ name: projectName })}
      rows={rows}
      columns={columns}
      getRowId={(r) => r.id}
      rowLabel={(r) => r.change}
      rowActions={(r) => (r.sessionId ? [{ id: "open-session", label: m.project_open_session(), run: () => open(r) }] : [])}
      empty={m.project_no_pending_changes()}
    />
  )
}

// ---------------------------------------------------------------------------
// View (previous)/
// ---------------------------------------------------------------------------

function previousReason(m: Messages, item: PreviousItem_Serialize): string {
  if (item.review === "kept") return m.project_previous_kept()
  switch (item.reason) {
    case "changed_copy":
      return m.project_previous_changed()
    case "unverified_copy":
      return m.project_previous_unverified()
    case "unticked_file":
      return m.project_previous_unplaced()
    case "unverified_link":
      return m.view_previous_unverified_link()
  }
}

function previousActions(m: Messages, client: QueryClient, projectId: string, item: PreviousItem_Serialize): MenuItem[] {
  const review = (resolution: "kept" | "moved" | "trashed") => () => projectWrite(client, () => library.projectReviewPreviousItem(projectId, item.path, resolution))
  const name = pathText(item.path)
  return [
    ...(item.review === "kept" ? [] : [{ id: "keep", label: m.status_keep(), icon: CopyCheck, run: review("kept") }]),
    { id: "move", label: m.project_previous_move(), icon: FolderOpen, run: review("moved") },
    {
      id: "trash",
      label: m.common_move_to_trash(),
      icon: Trash2,
      kind: "destructive",
      confirm: { title: m.common_trash_named_title({ name }), groups: [{ label: m.project_previous_title(), rows: [{ file: name, from: name, action: "trash", size: 0, sha256: item.evidence.sha256 ?? undefined }], defaultOpen: true }], confirm: { label: m.common_move_to_trash(), kind: "destructive" } },
      run: review("trashed"),
    },
  ]
}

function PreviousTable({ projectId, locked, items }: { projectId: string; locked: boolean; items: readonly PreviousItem_Serialize[] }) {
  const m = useMessages()
  const client = useQueryClient()
  const columns: Column<PreviousItem_Serialize>[] = [
    { id: "file", header: m.dialog_col_file(), cell: (r) => pathText(r.path), sortValue: (r) => pathText(r.path), rowHeader: true, truncate: true },
    { id: "reason", header: m.dialog_col_status(), cell: (r) => previousReason(m, r), sortValue: (r) => previousReason(m, r), truncate: true },
  ]
  return (
    <BoxTable
      label={m.project_previous_title()}
      rows={[...items]}
      columns={columns}
      getRowId={(r) => pathText(r.path)}
      rowLabel={(r) => pathText(r.path)}
      rowActions={(r) => (locked ? [] : previousActions(m, client, projectId, r))}
      empty={m.view_previous_empty()}
    />
  )
}
