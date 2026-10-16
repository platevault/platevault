/**
 * S12 Session detail (slice A) as a DetailPage: one library light session's
 * facts. Intake (Target → Rig → Review) is the session's StepPage
 * (`?step=`, session-intake.tsx), opened by Review frames; this page shows
 * where intake stands, its darks, flats and bias (each pinned, suggested,
 * waiting or No, with Confirm, Choose and No; LIB-FR-23, LIB-FR-25), the
 * Projects that hold it, its frames and its header values (each with where
 * it came from).
 *
 * A raw calibration session is not a library session: it reads where its
 * calibration process stands (P-CAL3) and links to the Calibration library.
 */
import { useNavigate, useParams } from "@tanstack/react-router"
import { Check, Copy, Eye, ListChecks } from "lucide-react"
import { MissingRecord } from "@/app/missing-record"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/app/run-ui"
import { BoxTable } from "@/components/app/box"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList, PathText } from "@/components/app/data"
import type { PageNotice } from "@/components/app/feedback"
import { Pill } from "@/components/app/pill"
import { StatusBadge } from "@/components/app/status"
import { NoteMarker } from "@/components/app/tips"
import { DetailPage } from "@/components/templates/detail-page"
import { calibrationSources, candidatesFor, CHOICE_STATE_NAME, KIND_NAME, NO_KIND_NAME, PIN_KINDS, type PinProblem, sessionPinProblems, sourceRef } from "@/domain/calibration"
import { CALIBRATION_STEP_NAME, processForSession, processView, type ProcessStatus } from "@/domain/calibration-process"
import { findGroup, findInput, formatHours, sessionIntakeEntry, sessionIntakeLink, type SessionReadiness, sessionRigId, sessionTargetId } from "@/domain/derive"
import { assetAvailability, captureSite, qualityApplicability } from "@/domain/library"
import { sessionLongLabel } from "@/domain/membership"
import type { Asset, CalibrationChoice, PinKind, Project, Session } from "@/domain/types"
import { formatCount, formatDateTime, formatDec, formatExposure, formatNight, formatRa } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { confirmCalibration, pickCalibration, setNoCalibration } from "@/store/actions/calibration"
import { type PrototypeState, useStore } from "@/store/core"
import { typeLabel } from "./import-model"
import { addToProjectItems } from "./parts"
import { type SessionRow, sessionRows } from "./session-model"

export function SessionPage() {
  const { sessionId = "" } = useParams({ strict: false }) as { sessionId?: string }
  const session = useStore((s) => s.catalog.sessions[sessionId])
  const m = useMessages()
  if (!session) return <MissingRecord title={m.session_missing_title()} backTo="/sessions" backLabel={m.session_open_sessions()} />
  return session.imageType === "light" ? <SessionDetail session={session} /> : <CalibrationSession session={session} />
}

const PROCESS_STATUS: Record<ProcessStatus, { label: (m: Messages) => string; tone: "info" | "danger" | "success" }> = {
  "awaiting-stack": { label: (m) => m.import_route_stack(), tone: "info" },
  stacking: { label: (m) => m.session_process_stacking(), tone: "info" },
  importing: { label: (m) => m.session_process_importing(), tone: "info" },
  "trashing-raws": { label: (m) => m.session_process_trashing(), tone: "info" },
  failed: { label: (m) => m.status_failed(), tone: "danger" },
  done: { label: (m) => m.session_process_done(), tone: "success" },
}

/** Raw calibration frames are input to a calibration process, never a library session (P-CAL3). */
function CalibrationSession({ session }: { session: Session }) {
  const m = useMessages()
  const navigate = useNavigate()
  const view = useStore((s) => {
    const process = processForSession(s.catalog, session.id)
    return process ? processView(s.catalog, process) : null
  })
  const status = view ? PROCESS_STATUS[view.status] : null
  const items = [
    { label: m.session_observing_night(), value: formatNight(session.night, true) },
    { label: m.session_frame_type(), value: typeLabel(m, session.imageType) },
    { label: m.sessions_column_frames(), value: view ? m.session_raw_frames({ count: view.frames, frames: formatCount(view.frames) }) : m.session_raw_frames({ count: session.assetIds.length, frames: formatCount(session.assetIds.length) }) },
    ...(view ? [{ label: m.session_process(), value: say(m, view.name) }] : []),
    ...(view?.failure ? [{ label: m.status_failed(), value: `${m.session_step_failed({ step: say(m, CALIBRATION_STEP_NAME[view.failure.step]) })} · ${say(m, view.failure.reason)}` }] : []),
  ]
  return (
    <DetailPage
      path={[{ label: m.nav_sessions(), link: { to: "/sessions" } }]}
      title={sessionLongLabel(m, session)}
      status={status ? <Pill tone={status.tone}>{status.label(m)}</Pill> : <Pill tone="muted">{m.status_role_calibration()}</Pill>}
      actions={[{ id: "open-calibration", label: m.session_open_calibration(), run: () => void navigate({ to: "/calibration" }) }]}
      sections={[{ id: "calibration", title: m.status_role_calibration(), content: <KeyValueList items={items} columns={2} /> }]}
    />
  )
}

function SessionDetail({ session }: { session: Session }) {
  const m = useMessages()
  const follow = useFollowLink()
  const state = useStore((s) => s)
  const row = sessionRows(state).find((r) => r.session.id === session.id)
  if (!row) return null
  const { catalog } = state
  const assets = session.assetIds.map((id) => catalog.assets[id]).filter((a): a is Asset => a !== undefined)
  const review: Action = { id: "review", label: m.session_review_frames(), icon: ListChecks, kind: row.queued ? "primary" : "standard", run: () => follow(sessionIntakeEntry(catalog, session)) }
  const menu: MenuItem[] = row.trashed ? [] : addToProjectItems(m, catalog, session.id)
  const notice: PageNotice | null = row.trashed ? { tone: "warning", title: m.session_in_os_trash() } : null
  const hours = formatHours(row.seconds)

  return (
    <DetailPage
      path={[{ label: m.nav_sessions(), link: { to: "/sessions" } }]}
      title={sessionLongLabel(m, session)}
      status={<ReadinessBadge readiness={row.readiness} unreviewed={row.unreviewed} trashed={row.trashed} />}
      actions={row.trashed ? [] : [review]}
      menu={{ label: m.session_label(), items: menu }}
      notice={notice}
      sections={[
        { id: "intake", title: m.session_intake(), content: <IntakeFacts row={row} />, actions: row.trashed ? [] : intakeActions(m, follow, session) },
        { id: "calibration", title: m.nav_calibration(), flush: true, content: <CalibrationTable state={state} session={session} changeable={!row.trashed} /> },
        { id: "projects", title: m.nav_projects(), count: row.projects.length, flush: true, content: <ProjectsTable row={row} /> },
        { id: "frames", title: m.sessions_column_frames(), count: assets.length, flush: true, content: <FramesTable state={state} assets={assets} session={session} reviewable={!row.trashed} /> },
        { id: "headers", title: m.session_headers(), content: <Metadata state={state} session={session} hours={hours} /> },
      ]}
    />
  )
}

function intakeActions(m: Messages, follow: (link: ReturnType<typeof sessionIntakeLink>) => void, session: Session): Action[] {
  return [
    { id: "intake-target", label: m.session_choose_target(), run: () => follow(sessionIntakeLink(session.id, "target")) },
    { id: "intake-rig", label: m.session_choose_rig(), run: () => follow(sessionIntakeLink(session.id, "rig")) },
  ]
}

/** Where intake stands, as one status word: Ready, or the step it still needs (C10). The Sessions list, the detail and the intake show the same. */
export function ReadinessBadge({ readiness, unreviewed, trashed }: { readiness: SessionReadiness; unreviewed: number; trashed: boolean }) {
  const m = useMessages()
  if (trashed) return <StatusBadge kind="run" value="trashed" />
  if (readiness === "ready") return <StatusBadge kind="gate" value="ready" />
  const label = readiness === "needs-target" ? m.sessions_filter_needs_target() : readiness === "needs-rig" ? m.sessions_rig_needs_review() : m.flow_frames_unreviewed({ count: unreviewed })
  return <StatusBadge kind="gate" value="review" label={label} />
}

function IntakeFacts({ row }: { row: SessionRow }) {
  const m = useMessages()
  const { session } = row
  const targetSettled = sessionTargetId(session) !== null
  const rigSettled = sessionRigId(session) !== null
  return (
    <KeyValueList
      columns={2}
      items={[
        { label: m.sessions_column_target(), value: targetSettled ? (row.targetName ?? "–") : <StatusBadge kind="association" value={session.target.status} label={m.sessions_filter_needs_target()} /> },
        { label: m.session_target_status(), value: <StatusBadge kind="association" value={session.target.status} /> },
        { label: m.sessions_column_rig(), value: rigSettled && row.rig ? say(m, row.rig) : <StatusBadge kind="association" value={session.equipment.status} label={m.sessions_rig_needs_review()} /> },
        { label: m.session_rig_status(), value: <StatusBadge kind="association" value={session.equipment.status} /> },
        { label: m.step_review(), value: row.unreviewed > 0 ? m.flow_frames_unreviewed({ count: row.unreviewed }) : <StatusBadge kind="gate" value="ready" /> },
        { label: m.session_header_label(), value: session.objectLabel ?? m.session_none() },
      ]}
    />
  )
}

interface CalibrationRow {
  kind: PinKind
  choice: CalibrationChoice
  /** A pinned file that changed, went missing or cannot be read now: the pin stays (section 8 of the F4 record). */
  problem: PinProblem | undefined
}

function ChoiceBadge({ row }: { row: CalibrationRow }) {
  const m = useMessages()
  if (row.problem) return row.problem.state === "changed" ? <StatusBadge kind="content" value="drifted" /> : <StatusBadge kind="availability" value={row.problem.state === "missing" ? "absent" : "offline"} />
  if (row.choice.state === "pinned") return <StatusBadge kind="assignment" value="accepted" label={say(m, CHOICE_STATE_NAME.pinned)} />
  if (row.choice.state === "suggested") return <StatusBadge kind="assignment" value="suggested" label={say(m, CHOICE_STATE_NAME.suggested)} />
  if (row.choice.state === "waiting") return <StatusBadge kind="assignment" value="unresolved" label={say(m, CHOICE_STATE_NAME.waiting)} />
  return <Pill tone="muted">{say(m, NO_KIND_NAME[row.kind])}</Pill>
}

/** Darks, flats and bias, matched at ingestion and pinned on the session (LIB-FR-23): Confirm a suggestion, Choose any offered source, or No. */
function CalibrationTable({ state, session, changeable }: { state: PrototypeState; session: Session; changeable: boolean }) {
  const m = useMessages()
  const { catalog, disk, settings } = state
  const calibration = session.calibration
  const problems = sessionPinProblems(disk, calibration)
  const rows: CalibrationRow[] = calibration ? PIN_KINDS.map((kind) => ({ kind, choice: calibration[kind], problem: problems.find((p) => p.kind === kind) })) : []
  const sources = calibrationSources(catalog, disk)
  const source = (r: CalibrationRow) => (r.choice.state === "pinned" || r.choice.state === "suggested" ? say(m, sourceRef(catalog, disk, r.choice.source)) : "–")
  const columns: Column<CalibrationRow>[] = [
    { id: "kind", header: m.run_col_kind(), rowHeader: true, sortValue: (r) => PIN_KINDS.indexOf(r.kind), cell: (r) => say(m, KIND_NAME[r.kind]) },
    { id: "state", header: m.session_project_state(), sortValue: (r) => r.choice.state, cell: (r) => <ChoiceBadge row={r} /> },
    { id: "source", header: m.evidence_column_source(), truncate: true, sortValue: source, cell: source },
  ]
  const actions = (r: CalibrationRow): MenuItem[] => {
    if (!changeable) return []
    const pick = { sessionId: session.id, kind: r.kind }
    const offered = candidatesFor(catalog, settings, session, r.kind, sources)
    return [
      ...(r.choice.state === "suggested" ? [{ id: `confirm-${r.kind}`, label: m.verb_confirm(), icon: Check, run: () => confirmCalibration([pick]) }] : []),
      ...(offered.length > 0
        ? [{ submenu: m.verb_choose(), items: offered.map((c) => ({ id: `choose-${r.kind}-${c.source.key}`, label: say(m, sourceRef(catalog, disk, c.source.source)), run: () => pickCalibration(session.id, r.kind, c.source.source, session.revision) })) }]
        : []),
      ...(r.choice.state === "none" ? [] : [{ id: `no-${r.kind}`, label: say(m, NO_KIND_NAME[r.kind]), run: () => setNoCalibration([pick]) }]),
    ]
  }
  return <BoxTable label={m.nav_calibration()} rows={rows} columns={columns} getRowId={(r) => r.kind} rowLabel={(r) => say(m, KIND_NAME[r.kind])} rowActions={actions} empty={m.session_none()} />
}

/** The Projects that hold the session, open or Closed, with the group each puts it in. */
function ProjectsTable({ row }: { row: SessionRow }) {
  const m = useMessages()
  const follow = useFollowLink()
  const open = (project: Project) => follow({ to: "/projects/$projectId", params: { projectId: project.id } })
  const group = (project: Project) => findGroup(project, findInput(project, row.session.id)?.groupId ?? null)?.name ?? "–"
  const columns: Column<Project>[] = [
    { id: "project", header: m.project_noun(), rowHeader: true, truncate: true, sortValue: (p) => p.name, cell: (p) => p.name },
    { id: "state", header: m.session_project_state(), sortValue: (p) => p.state, cell: (p) => <StatusBadge kind="project" value={p.state} /> },
    { id: "group", header: m.session_project_group(), truncate: true, sortValue: group, cell: group },
  ]
  return (
    <BoxTable
      label={m.nav_projects()}
      rows={row.projects}
      columns={columns}
      getRowId={(p) => p.id}
      rowLabel={(p) => p.name}
      rowActions={(p) => [{ id: "open", label: m.verb_open(), icon: Eye, run: () => open(p) }]}
      onRowClick={open}
      empty={row.needsTarget ? m.session_needs_target_first() : m.session_none()}
    />
  )
}

function FramesTable({ state, assets, session, reviewable }: { state: PrototypeState; assets: Asset[]; session: Session; reviewable: boolean }) {
  const m = useMessages()
  const follow = useFollowLink()
  const quality = (a: Asset) => (a.trashed ? "trashed" : qualityApplicability(a) === "applicable" ? a.quality.value : qualityApplicability(a))
  const columns: Column<Asset>[] = [
    { id: "file", header: m.session_column_file(), rowHeader: true, truncate: true, sortValue: (a) => a.fileName, cell: (a) => a.fileName },
    {
      id: "quality",
      header: m.session_column_quality(),
      sortValue: quality,
      cell: (a) => {
        if (a.trashed) return <StatusBadge kind="run" value="trashed" />
        const applies = qualityApplicability(a)
        return applies === "applicable" ? <StatusBadge kind="quality" value={a.quality.value} /> : <StatusBadge kind="quality" value={applies} />
      },
    },
    { id: "exposure", header: m.session_column_exposure(), align: "right", sortValue: (a) => a.observed.exposureS, cell: (a) => formatExposure(a.observed.exposureS) },
    {
      id: "availability",
      header: m.session_column_availability(),
      sortValue: (a) => (a.trashed ? "trash" : assetAvailability(state.disk, state.catalog, a)),
      cell: (a) => (a.trashed ? m.session_os_trash() : <StatusBadge kind="availability" value={assetAvailability(state.disk, state.catalog, a)} />),
    },
    { id: "copies", header: m.session_column_copies(), align: "right", sortValue: (a) => a.copies.length, cell: (a) => formatCount(a.copies.length) },
    { id: "sha", header: m.session_column_sha(), truncate: true, sortValue: (a) => a.sha256, cell: (a) => `${a.sha256.slice(0, 12)}…` },
  ]
  const items = (a: Asset): MenuItem[] => [
    ...(reviewable && !a.trashed ? [{ id: "review", label: m.verb_review(), icon: Eye, run: () => follow({ to: "/sessions/$sessionId", params: { sessionId: session.id }, search: { step: "review", assetId: a.id } }) }] : []),
    {
      id: "copy-path",
      label: m.session_copy_path(),
      icon: Copy,
      unavailable: a.copies.length === 0 ? { action: m.session_copy_path(), reason: m.session_no_copies(), blockers: [] } : undefined,
      run: () => void navigator.clipboard?.writeText(a.copies[0]?.path ?? ""),
    },
  ]
  return <BoxTable label={m.sessions_column_frames()} rows={assets} columns={columns} getRowId={(a) => a.id} rowLabel={(a) => a.fileName} rowActions={items} initialSort={{ columnId: "file", direction: "asc" }} />
}

/** Header values; where each came from sits in its note. */
function Metadata({ state, session, hours }: { state: PrototypeState; session: Session; hours: string }) {
  const { catalog } = state
  const m = useMessages()
  const first = catalog.assets[session.assetIds[0] ?? ""]
  const header = first?.observed
  const site = captureSite(catalog, session)
  const locations = [...new Set(session.assetIds.flatMap((id) => catalog.assets[id]?.copies.map((c) => c.locationId) ?? []))].map((id) => catalog.locations[id]?.displayName ?? id)
  const sourced = (value: string, source: string) => (
    <>
      {value} <NoteMarker label={m.session_source_of({ value })} rows={[{ label: m.evidence_column_source(), value: source }]} />
    </>
  )
  const fromHeader = (keyword: string) => m.session_header_source({ keyword })
  const typedAtImport = first && first.imageType !== first.observed.imageType
  const items = [
    { label: m.session_observing_night(), value: formatNight(session.night, true) },
    // OBJECT is a label and filter, never Target evidence.
    { label: m.session_header_label(), value: sourced(session.objectLabel ?? m.session_none(), fromHeader("OBJECT")) },
    { label: m.session_started(), value: sourced(formatDateTime(session.startedAt), fromHeader("DATE-OBS")) },
    { label: m.session_ended(), value: formatDateTime(session.endedAt) },
    { label: m.session_frame_type(), value: typedAtImport ? sourced(typeLabel(m, first.imageType), m.session_typed_at_import()) : sourced(typeLabel(m, session.imageType), fromHeader("IMAGETYP")) },
    { label: m.session_filter(), value: sourced(session.channel ?? m.session_none(), fromHeader("FILTER")) },
    { label: m.session_column_exposure(), value: sourced(formatExposure(session.exposureS), fromHeader("EXPTIME")) },
    { label: m.session_integration(), value: hours },
    { label: m.session_camera(), value: sourced(session.cameraName ?? m.status_unknown(), fromHeader("INSTRUME")) },
    { label: m.session_telescope(), value: sourced(session.telescopeName ?? m.status_unknown(), fromHeader("TELESCOP")) },
    { label: m.session_gain_offset(), value: `${session.gain ?? "–"} · ${session.offset ?? "–"}` },
    { label: m.session_sensor_temperature(), value: sourced(session.ccdTempC === null ? m.status_unknown() : `${session.ccdTempC} °C`, fromHeader("CCD-TEMP")) },
    { label: m.evidence_source_pointing(), value: header?.ra != null && header.dec != null ? `${formatRa(header.ra)} ${formatDec(header.dec)}` : "–" },
    { label: m.session_capture_site(), value: site ? site.name : m.status_unknown() },
    { label: m.common_locations(), value: locations.join(", ") || m.session_none() },
    { label: m.sessions_column_frames(), value: formatCount(session.assetIds.length) },
    ...(first?.copies[0] ? [{ label: m.session_first_frame(), value: <PathText path={first.copies[0].path} /> }] : []),
  ]
  return <KeyValueList items={items} columns={2} />
}
