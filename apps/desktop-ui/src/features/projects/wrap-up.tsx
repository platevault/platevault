/**
 * Wrap up (`?stage=wrap-up&step=`; 065 PRJ-FR-14/15/25/32, 071 STO-FR-01 to
 * 08, 13 to 17): Clean up, Trash and Archive, each reviewed and settled in
 * that order. Each step opens on the library's review of it and its Proceed
 * echoes that review (its revision, generation or digest), so a review that
 * moved is refused with `conflict` and re-read, never carried out blind.
 *
 * - Clean up: the entries still in the installed View (Copies ticked,
 *   Symlinks unticked) and the files `View (previous)/` holds (unticked).
 *   A link is deleted, a copy or leftover goes to the OS Trash once it
 *   re-verifies; anything else stays, named with why.
 * - Trash: rejected frames, Processing files and duplicate copies, each a
 *   row moved whole or not at all, with what each refuses.
 * - Archive: Close project…. The sessions laid out for the destination the
 *   user picks; those another open Project keeps stay, named. Without a
 *   destination Close project is unavailable, naming Settings › Locations
 *   (astro-plan-409cm.7): it never records "nothing to archive" then. Skip
 *   closes the Project without archiving, on the user's explicit choice.
 *
 * Proceeding with nothing ticked records the step Skipped. A pending change
 * or a running operation holds the current step (WrapUpBlocker). Closing is
 * for good: a Closing, Closed or Archived Project reads its recorded steps.
 * A running archive offers Stop; the Project stays Closing and the next
 * start resumes it.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { Square } from "lucide-react"
import { type ReactNode, useState } from "react"
import {
  type ArchiveProgress,
  type ArchiveReview,
  type ArchiveSessionOffer,
  type CleanUpEntry,
  type CleanUpReport,
  failureOf,
  library,
  type TrashGroup,
  type TrashGroupOffer,
  type TrashReport,
  type WrapUpStatus,
  type WrapUpStep,
} from "@/api/ipc"
import { libraryQuery } from "@/api/query"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { BoxTable } from "@/components/app/box"
import type { Action, Blocker, Column, FileRow, FlowStep, StepFlow, StepLink } from "@/components/app/contracts"
import { ActionError, Notice, TableSkeleton, toast } from "@/components/app/feedback"
import { SelectField } from "@/components/app/fields"
import { failureMessage } from "@/components/app/run-result"
import { stepEditable } from "@/components/app/step-flow"
import { StepPage } from "@/components/templates/step-page"
import { formatBytes, formatDateTime } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { operationText } from "./apply-words"
import type { ProjectTabProps } from "./project-page"
import { isLocked, locationsQuery, type ProjectHeader, projectWrite, wrapUpStatusQuery } from "./queries"
import { labelOf, useSessionSummaries } from "./sessions"
import { pathText, reasonText } from "./words"

export const WRAP_UP_STEPS: readonly WrapUpStep[] = ["clean_up", "trash", "archive"]

function stepLabel(m: Messages, step: WrapUpStep): string {
  return step === "clean_up" ? m.wrapup_clean_up() : step === "trash" ? m.wrapup_step_trash() : m.wrapup_archive_title()
}

/** The step strip as the library records it: recorded steps finished or skipped, the current one held by any blocker. */
export function wrapUpSteps(m: Messages, status: WrapUpStatus, gate: FlowStep["gate"]): FlowStep[] {
  return WRAP_UP_STEPS.map((step) => {
    const record = status.records.find((r) => r.step === step)
    const label = stepLabel(m, step)
    if (record) return { id: step, label, state: record.outcome === "skipped" ? "skipped" : "finished", optional: true, summary: m.stepflow_finished_on({ date: formatDateTime(record.recordedAt) }) }
    if (step === status.current) return { id: step, label, state: gate ? "blocked" : "current", optional: true, gate }
    return { id: step, label, state: "todo", optional: true }
  })
}

/** Why the current step can't proceed now, with where it is resolved; null while Wrap up opens. */
function wrapUpGate(m: Messages, status: WrapUpStatus, viewLink: StepLink): FlowStep["gate"] {
  const blocker = status.blocker
  if (!blocker || blocker.blocker === "not_open") return null
  if (blocker.blocker === "pending_changes") return { reason: m.flow_wrapup_pending({ count: blocker.count }), blockers: [{ label: m.flow_wrapup_apply_or_discard(), link: viewLink }] }
  return { reason: m.apply_blocker_operation_running({ operation: operationText(m, blocker.kind) }), blockers: [] }
}

export function WrapUpPage({ header, chrome, search }: ProjectTabProps) {
  const m = useMessages()
  const status = useQuery(wrapUpStatusQuery(header.id))
  if (status.error) {
    const failure = failureOf(status.error)
    return <ActionError message={failure ? failureMessage(m, failure) : m.action_failure_unreachable()} onRetry={() => void status.refetch()} />
  }
  if (!status.data) return <TableSkeleton rows={4} columns={3} label={m.common_loading()} />
  return <WrapUpFlow header={header} chrome={chrome} status={status.data} viewing={search.step} />
}

function WrapUpFlow({ header, chrome, status, viewing: requested }: { header: ProjectHeader; chrome: ProjectTabProps["chrome"]; status: WrapUpStatus; viewing: string | undefined }) {
  const m = useMessages()
  const client = useQueryClient()
  const locked = isLocked(status.lifecycle)
  const link = (step: WrapUpStep): StepLink => ({ to: "/projects/$projectId", params: { projectId: header.id }, search: { stage: "wrap-up", step } })
  const viewLink: StepLink = { to: "/projects/$projectId", params: { projectId: header.id }, search: { stage: "view" } }
  const current = status.current
  const viewing: WrapUpStep = WRAP_UP_STEPS.find((s) => s === requested) ?? current ?? "archive"
  const reads = (step: WrapUpStep) => !locked && (step === viewing || step === current)
  const byStep: Record<WrapUpStep, WrapUpStepView> = {
    clean_up: useCleanUpStep(header, reads("clean_up")),
    trash: useTrashStep(header, reads("trash")),
    archive: useArchiveStep(header, status, reads("archive")),
  }
  const gate = wrapUpGate(m, status, viewLink)
  const own = current ? byStep[current] : undefined
  const nextStep = current ? WRAP_UP_STEPS[WRAP_UP_STEPS.indexOf(current) + 1] : undefined
  const flow: StepFlow = {
    steps: wrapUpSteps(m, status, gate),
    current: current ?? "archive",
    ordered: true,
    proceed: locked || !own ? null : own.proceed,
    skip: own?.skip,
    next: nextStep ? link(nextStep) : null,
    reopen: (stepId) => ({
      id: `reopen-${stepId}`,
      label: m.stepflow_reopen_step(),
      run: () => projectWrite(client, () => library.projectReopenWrapUpStep(header.id, stepId as WrapUpStep)),
    }),
    linkFor: (stepId) => link(stepId as WrapUpStep),
  }
  const closing = byStep.archive.closing
  const body = locked && !closing ? <WrapUpRecord status={status} /> : byStep[viewing].body(!locked && stepEditable(flow, viewing))
  return (
    <StepPage
      path={chrome.path}
      title={header.name}
      status={chrome.status}
      menu={chrome.menu}
      notice={chrome.notice}
      views={chrome.views}
      stepsLabel={m.wrapup_steps()}
      flow={flow}
      viewing={viewing}
      step={body}
    />
  )
}

/** One step's Proceed and Skip, as the flow footer runs them, and its body. */
interface WrapUpStepView {
  proceed: Action
  skip: Action
  body: (editable: boolean) => ReactNode
  /** Archive only: a Close running now, or its settled archive. */
  closing?: ArchiveProgress | "running" | null
}

/** A locked Project's Wrap up: each step as recorded, for good. */
function WrapUpRecord({ status }: { status: WrapUpStatus }) {
  const m = useMessages()
  const rows = status.records.map((r) => ({ ...r, id: r.step }))
  const columns: Column<(typeof rows)[number]>[] = [
    { id: "step", header: m.project_col_step(), cell: (r) => stepLabel(m, r.step), sortValue: (r) => WRAP_UP_STEPS.indexOf(r.step), rowHeader: true },
    { id: "outcome", header: m.dialog_col_status(), cell: (r) => (r.outcome === "skipped" ? m.stepflow_skip() : m.status_done()), sortValue: (r) => r.outcome },
    { id: "at", header: m.wrapup_recorded_at(), cell: (r) => formatDateTime(r.recordedAt), sortValue: (r) => r.recordedAt },
  ]
  return (
    <>
      {status.lifecycle === "closing" ? <Notice tone="info" title={m.wrapup_archive_resumes()} /> : null}
      <BoxTable label={m.wrapup_steps()} rows={rows} columns={columns} getRowId={(r) => r.id} />
    </>
  )
}

/** The read a step opens on: loading, its failure with Retry, or the step. */
function Reviewed<T>({ read, children }: { read: { data: T | undefined; error: unknown; refetch: () => unknown }; children: (data: T) => ReactNode }) {
  const m = useMessages()
  if (read.error) {
    const failure = failureOf(read.error)
    return <ActionError message={failure ? failureMessage(m, failure) : m.action_failure_unreachable()} onRetry={() => void read.refetch()} />
  }
  if (read.data === undefined) return <TableSkeleton rows={4} columns={3} label={m.common_loading()} />
  return <>{children(read.data)}</>
}

/** Proceed while the step's review is still on its way: shown, never run. */
function loadingAction(m: Messages, id: string, label: string): Action {
  return { id, label, unavailable: { action: m.actions_blocked({ action: label }), reason: m.common_loading(), blockers: [] }, run: () => undefined }
}

/** The files a step left in place, each with why. */
function KeptNotice({ kept }: { kept: { path: string; reason: string }[] }) {
  const m = useMessages()
  if (kept.length === 0) return null
  const columns: Column<(typeof kept)[number]>[] = [
    { id: "file", header: m.dialog_col_file(), cell: (r) => r.path, sortValue: (r) => r.path, rowHeader: true, truncate: true },
    { id: "reason", header: m.dialog_col_status(), cell: (r) => r.reason, sortValue: (r) => r.reason, truncate: true },
  ]
  return (
    <Notice tone="warning" title={m.wrapup_kept_in_place({ count: kept.length })}>
      <BoxTable label={m.wrapup_kept_in_place({ count: kept.length })} rows={kept} columns={columns} getRowId={(r) => r.path} />
    </Notice>
  )
}

// ---------------------------------------------------------------------------
// Clean up
// ---------------------------------------------------------------------------

function entryKind(m: Messages, entry: CleanUpEntry): string {
  if (entry.kind.kind === "leftover") return m.wrapup_cleanup_previous()
  return entry.kind.placement.kind === "symlink" ? m.wrapup_cleanup_link() : m.wrapup_cleanup_copy()
}

const entryId = (e: CleanUpEntry) => pathText(e.path)

function cleanUpSummary(m: Messages, report: CleanUpReport): string {
  const count = (outcome: "deleted" | "trashed" | "kept") => report.results.filter((r) => r.outcome.outcome === outcome).length
  return m.wrapup_cleanup_done({ deleted: count("deleted"), trashed: count("trashed"), kept: count("kept") })
}

function useCleanUpStep(header: ProjectHeader, enabled: boolean): WrapUpStepView {
  const m = useMessages()
  const client = useQueryClient()
  const read = useQuery({ ...libraryQuery("projectCleanUpReview", header.id), enabled })
  const review = read.data
  // Null keeps the review's own preselection (Copies ticked, Symlinks and leftovers not) until the user ticks.
  const [ticked, setTicked] = useState<string[] | null>(null)
  const [report, setReport] = useState<CleanUpReport | null>(null)
  const selected = ticked ?? review?.entries.filter((e) => e.preselected).map(entryId) ?? []
  const chosen = review?.entries.filter((e) => selected.includes(entryId(e))) ?? []
  const run = (paths: CleanUpEntry[]) => async () => {
    if (!review) return
    const result = await projectWrite(client, () => library.projectCleanUp({ projectId: header.id, desiredRevision: review.desiredRevision, generation: review.generation, selected: paths.map((e) => e.path) }))
    if (result.ok) {
      setReport(result.data)
      setTicked(null)
      toast({ message: cleanUpSummary(m, result.data) })
    }
    return result
  }
  const rows: FileRow[] = chosen.map((e) => ({ file: entryId(e), from: entryId(e), action: e.kind.kind === "placed" && e.kind.placement.kind === "symlink" ? "unlink" : "trash", size: e.sizeBytes }))
  const label = chosen.length > 0 ? m.wrapup_clean_up() : m.stepflow_proceed()
  const proceed: Action = !review
    ? loadingAction(m, "clean-up", label)
    : {
        id: "clean-up",
        label,
        confirm:
          chosen.length > 0
            ? { title: m.wrapup_cleanup_view_title(), summary: formatBytes(chosen.reduce((s, e) => s + e.sizeBytes, 0)), groups: [{ label: m.wrapup_files_of({ name: header.name }), rows, defaultOpen: true }], confirm: { label: m.wrapup_clean_up(), kind: "destructive" } }
            : undefined,
        run: run(chosen),
      }
  const skip: Action = { id: "skip-clean-up", label: m.stepflow_skip(), run: run([]) }
  const columns: Column<CleanUpEntry>[] = [
    { id: "file", header: m.dialog_col_file(), cell: entryId, sortValue: entryId, rowHeader: true, truncate: true },
    { id: "kind", header: m.project_col_kind(), cell: (e) => entryKind(m, e), sortValue: (e) => entryKind(m, e) },
    { id: "size", header: m.dialog_col_size(), cell: (e) => formatBytes(e.sizeBytes), sortValue: (e) => e.sizeBytes, align: "right" },
  ]
  const kept = report?.results.flatMap((r) => (r.outcome.outcome === "kept" ? [{ path: pathText(r.path), reason: reasonText(m, r.outcome.reason.code) }] : [])) ?? []
  const body = (editable: boolean) => (
    <>
      <KeptNotice kept={kept} />
      <Reviewed read={read}>
        {(data) => (
          <BoxTable
            label={m.wrapup_cleanup_view_title()}
            rows={data.entries}
            columns={columns}
            getRowId={entryId}
            selection={editable ? { selected, onChange: setTicked, rowLabel: entryId } : undefined}
            empty={m.wrapup_offer_view_none()}
          />
        )}
      </Reviewed>
    </>
  )
  return { proceed, skip, body }
}

// ---------------------------------------------------------------------------
// Trash
// ---------------------------------------------------------------------------

function groupLabel(m: Messages, group: TrashGroup): string {
  return group === "rejected_frames" ? m.wrapup_offer_rejects() : group === "processing_files" ? m.wrapup_offer_processing_label() : m.wrapup_offer_duplicates_label()
}

function trashRows(group: TrashGroupOffer): FileRow[] {
  return group.items.flatMap((item) => item.files.map((f): FileRow => ({ file: pathText(f), from: pathText(f), action: "trash", size: item.files.length > 0 ? Math.round(item.sizeBytes / item.files.length) : 0 })))
}

function useTrashStep(header: ProjectHeader, enabled: boolean): WrapUpStepView {
  const m = useMessages()
  const client = useQueryClient()
  const read = useQuery({ ...libraryQuery("projectTrashReview", header.id), enabled })
  const review = read.data
  const offered = review?.groups.filter((g) => g.items.length > 0) ?? []
  const [ticked, setTicked] = useState<string[] | null>(null)
  const [report, setReport] = useState<TrashReport | null>(null)
  const selected = ticked ?? offered.filter((g) => g.preselected).map((g) => g.group)
  const chosen = offered.filter((g) => selected.includes(g.group))
  const run = (groups: TrashGroupOffer[]) => async () => {
    if (!review) return
    const result = await projectWrite(client, () => library.projectWrapUpTrash({ projectId: header.id, digest: review.digest, ticked: groups.map((g) => g.group) }))
    if (result.ok) {
      setReport(result.data)
      setTicked(null)
      toast({ message: m.wrapup_trash_done({ moved: result.data.moved.length, refused: result.data.refused.length }) })
    }
    return result
  }
  const files = chosen.reduce((n, g) => n + trashRows(g).length, 0)
  const label = chosen.length > 0 ? m.common_move_to_trash() : m.stepflow_proceed()
  const proceed: Action = !review
    ? loadingAction(m, "trash", label)
    : {
        id: "trash",
        label,
        confirm:
          chosen.length > 0
            ? { title: m.wrapup_trash_confirm_title({ count: files }), summary: formatBytes(chosen.reduce((s, g) => s + g.sizeBytes, 0)), groups: chosen.map((g) => ({ label: groupLabel(m, g.group), rows: trashRows(g), defaultOpen: true })), confirm: { label: m.common_move_to_trash(), kind: "destructive" } }
            : undefined,
        run: run(chosen),
      }
  const skip: Action = { id: "skip-trash", label: m.stepflow_skip(), run: run([]) }
  const columns: Column<TrashGroupOffer>[] = [
    { id: "group", header: m.project_col_kind(), cell: (g) => groupLabel(m, g.group), sortValue: (g) => groupLabel(m, g.group), rowHeader: true },
    { id: "items", header: m.wrapup_col_detail(), cell: (g) => m.wrapup_items({ count: g.items.length }), sortValue: (g) => g.items.length, align: "right" },
    { id: "size", header: m.dialog_col_size(), cell: (g) => formatBytes(g.sizeBytes), sortValue: (g) => g.sizeBytes, align: "right" },
    { id: "refused", header: m.wrapup_refused(), cell: (g) => (g.refused.length > 0 ? m.wrapup_items({ count: g.refused.length }) : "–"), sortValue: (g) => g.refused.length, align: "right" },
  ]
  // What stays: each row's refusals as the review names them, then what the Trash move itself left.
  const refused = (report?.refused ?? review?.groups.flatMap((g) => g.refused) ?? []).map((r) => ({ path: pathText(r.path), reason: reasonText(m, r.reason.code) }))
  const body = (editable: boolean) => (
    <>
      <Reviewed read={read}>
        {(data) => (
          <>
            <BoxTable
              label={m.wrapup_step_trash()}
              rows={data.groups.filter((g) => g.items.length > 0)}
              columns={columns}
              getRowId={(g) => g.group}
              selection={editable ? { selected, onChange: setTicked, rowLabel: (g) => groupLabel(m, g.group) } : undefined}
              empty={m.wrapup_nothing_to_trash()}
            />
            {data.protectedMasters.length > 0 ? <Notice tone="info" title={m.wrapup_protected_masters({ count: data.protectedMasters.length })} /> : null}
          </>
        )}
      </Reviewed>
      <KeptNotice kept={refused} />
    </>
  )
  return { proceed, skip, body }
}

// ---------------------------------------------------------------------------
// Archive (Close project…)
// ---------------------------------------------------------------------------

function offerStatus(m: Messages, offer: ArchiveSessionOffer): string {
  if (offer.keptBy.length > 0) return m.wrapup_stays_used_by({ names: offer.keptBy.join(", ") })
  if (offer.hold) return reasonText(m, offer.hold.code)
  return m.wrapup_moves()
}

const movable = (s: ArchiveSessionOffer) => s.keptBy.length === 0 && s.hold === null && s.files.length > 0

function useArchiveStep(header: ProjectHeader, status: WrapUpStatus, enabled: boolean): WrapUpStepView {
  const m = useMessages()
  const client = useQueryClient()
  const locations = useQuery({ ...locationsQuery(), enabled })
  const destinations = (locations.data ?? []).filter((l) => l.location.lifecycle === "active" && l.location.role === "captures")
  const [destination, setDestination] = useState("")
  const chosen = destinations.some((l) => l.location.id === destination) ? destination : ""
  const read = useQuery({ ...libraryQuery("projectWrapUpArchiveReview", header.id, chosen), enabled: enabled && chosen !== "" })
  const review = chosen === "" ? undefined : read.data
  const sessions = useSessionSummaries(review?.sessions.map((s) => s.sessionId) ?? [])
  const [ticked, setTicked] = useState<string[] | null>(null)
  const [closing, setClosing] = useState<ArchiveProgress | "running" | null>(null)
  const picked = ticked ?? review?.sessions.filter(movable).map((s) => s.sessionId) ?? []

  const close = (archive: { review: ArchiveReview; sessions: string[] } | null) => async () => {
    setClosing("running")
    const result = await projectWrite(client, () =>
      library.projectClose({ projectId: header.id, desiredRevision: status.desiredRevision, archive: archive ? { destination: archive.review.destination, sessions: archive.sessions, digest: archive.review.digest } : null }),
    )
    setClosing(result.ok ? result.data.archive : null)
    return result
  }
  const label = m.stepflow_close_project()
  const blocked = (reason: string, blockers: Blocker[] = []): Action["unavailable"] => ({ action: m.actions_blocked({ action: label }), reason, blockers })
  // Without a destination nothing tells what would stay unmoved, so Close project never closes as "nothing to archive"
  // then (astro-plan-409cm.7); Skip closes without archiving on the user's explicit choice.
  const unavailable: Action["unavailable"] = !locations.data
    ? blocked(m.common_loading())
    : destinations.length === 0
      ? blocked(m.wrapup_no_archive_location(), [{ label: m.common_locations(), link: { to: "/settings/locations" } }])
      : chosen === ""
        ? blocked(m.wrapup_choose_destination())
        : !review
          ? blocked(m.common_loading())
          : undefined
  const moves = review ? review.sessions.filter((s) => picked.includes(s.sessionId)).flatMap((s) => s.files) : []
  const proceed: Action = {
    id: "close-project",
    label,
    opensDialog: true,
    unavailable,
    confirm: {
      title: m.stepflow_close_project_title({ name: header.name }),
      summary: m.wrapup_close_for_good(),
      groups: moves.length > 0 ? [{ label: m.wrapup_archive_moves(), rows: moves.map((f): FileRow => ({ file: pathText(f.from), from: pathText(f.from), to: pathText(f.to), action: "move", size: f.sizeBytes })), defaultOpen: true }] : [],
      confirm: { label },
    },
    run: close(review && picked.length > 0 ? { review, sessions: picked } : null),
  }
  const skip: Action = {
    id: "close-without-archive",
    label: m.wrapup_close_without_archive(),
    confirm: { title: m.stepflow_close_project_title({ name: header.name }), summary: m.wrapup_close_for_good(), confirm: { label: m.wrapup_close_without_archive() } },
    run: close(null),
  }
  const columns: Column<ArchiveSessionOffer>[] = [
    { id: "session", header: m.project_col_session(), cell: (s) => labelOf(sessions, s.sessionId), sortValue: (s) => labelOf(sessions, s.sessionId), rowHeader: true, truncate: true },
    { id: "files", header: m.wrapup_col_detail(), cell: (s) => m.wrapup_items({ count: s.files.length }), sortValue: (s) => s.files.length, align: "right" },
    { id: "size", header: m.dialog_col_size(), cell: (s) => formatBytes(s.files.reduce((t, f) => t + f.sizeBytes, 0)), sortValue: (s) => s.files.reduce((t, f) => t + f.sizeBytes, 0), align: "right" },
    { id: "status", header: m.dialog_col_status(), cell: (s) => offerStatus(m, s), sortValue: (s) => offerStatus(m, s), truncate: true },
  ]
  const body = (editable: boolean) =>
    closing !== null ? (
      <ClosingView projectId={header.id} closing={closing} sessionName={(id) => labelOf(sessions, id)} />
    ) : (
      <>
        <SelectField
          label={m.wrapup_destination()}
          value={chosen}
          options={[{ value: "", label: destinations.length === 0 ? m.wrapup_no_archive_location() : m.wrapup_choose_destination() }, ...destinations.map((l) => ({ value: l.location.id, label: l.location.name }))]}
          onChange={(value) => {
            setDestination(value)
            setTicked(null)
          }}
          disabled={!editable || destinations.length === 0}
        />
        {locations.data && destinations.length === 0 ? <Notice tone="warning" title={m.wrapup_no_archive_location()} /> : null}
        {chosen !== "" ? (
          <Reviewed read={read}>
            {(data) => (
              <BoxTable
                label={m.wrapup_archive_title()}
                rows={data.sessions}
                columns={columns}
                getRowId={(s) => s.sessionId}
                selection={editable ? { selected: picked, onChange: setTicked, rowLabel: (s) => labelOf(sessions, s.sessionId), isSelectable: movable } : undefined}
                empty={m.wrapup_nothing_to_archive()}
              />
            )}
          </Reviewed>
        ) : null}
      </>
    )
  return { proceed, skip, body, closing }
}

/** Close running (Stop offered), or its archive's outcome per file once it settled or stopped. */
function ClosingView({ projectId, closing, sessionName }: { projectId: string; closing: ArchiveProgress | "running"; sessionName: (id: string) => string }) {
  const m = useMessages()
  if (closing === "running") {
    const stop: Action = { id: "stop-archive", label: m.wrapup_stop_archive(), icon: Square, run: () => library.projectCloseStop(projectId) }
    return (
      <Notice tone="info" title={m.wrapup_closing()}>
        <ActionButton action={stop} />
      </Notice>
    )
  }
  const rows = closing.moves.map((move) => ({
    id: String(move.seq),
    session: sessionName(move.sessionId),
    file: pathText(move.file.to),
    outcome: move.outcome === "archived" ? m.status_done() : move.reason ? reasonText(m, move.reason.code) : move.outcome === null ? m.wrapup_move_pending() : m.wrapup_move_kept(),
  }))
  const columns: Column<(typeof rows)[number]>[] = [
    { id: "file", header: m.dialog_col_file(), cell: (r) => r.file, sortValue: (r) => r.file, rowHeader: true, truncate: true },
    { id: "session", header: m.project_col_session(), cell: (r) => r.session, sortValue: (r) => r.session, truncate: true },
    { id: "outcome", header: m.dialog_col_status(), cell: (r) => r.outcome, sortValue: (r) => r.outcome, truncate: true },
  ]
  return (
    <Notice tone={closing.settled ? "info" : "warning"} title={closing.settled ? m.wrapup_archive_settled() : m.wrapup_archive_resumes()}>
      <BoxTable label={m.wrapup_archive_moves()} rows={rows} columns={columns} getRowId={(r) => r.id} />
    </Notice>
  )
}
