/**
 * S12 Session detail (slice A): one library light session.
 *
 * Two views in the same header (`?view=review` switches): Detail, with the
 * Target and rig evidence (Confirm Target / Confirm rig), the Projects that
 * consider it a candidate, the runs that use it, its frames and headers, and
 * Add to Project (also adds the rig, D-W59) or Create Project prefilled; and
 * Review, which mounts slice D's `SessionReview` as the full-height review
 * region (library marks only, PIX-FR-18).
 *
 * A raw calibration session is not a library session: it reads where its
 * calibration process stands (P-CAL3) and links to the Calibration library.
 */
import { Link, useNavigate, useParams, useSearch } from "@tanstack/react-router"
import { Eye, FolderOpen } from "lucide-react"
import { useState } from "react"
import { MissingRecord } from "@/app/missing-record"
import { useMessages } from "@/app/preferences"
import { GateLabel, stepName } from "@/app/run-ui"
import { Box } from "@/components/app/box"
import { EvidenceList, KeyValueList, PathText } from "@/components/app/data"
import { type Column, DataTable } from "@/components/app/data-table"
import { Notice } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { CountBadge, Pill } from "@/components/app/pill"
import type { MenuEntry } from "@/components/app/row-menu"
import { StatusBadge, type Tone } from "@/components/app/status"
import { NoteMarker } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { CALIBRATION_STEP_NAME, processForSession, processView, type ProcessStatus } from "@/domain/calibration-process"
import { formatHours, rigName, runPipeline, runStepLink, sessionRigId, sessionTargetId } from "@/domain/derive"
import { assetAvailability, captureSite, qualityApplicability } from "@/domain/library"
import { sessionLongLabel } from "@/domain/membership"
import type { Asset, Session } from "@/domain/types"
import { formatCount, formatDateTime, formatDec, formatExposure, formatNight, formatRa } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import type { SearchParams } from "@/routes"
import { type PrototypeState, useStore } from "@/store/core"
import { SessionReview } from "../d-review/review"
import { typeLabel } from "./import-model"
import { AddToProjectMenu, type AddedNotice, ConfirmRigControl, ConfirmTargetControl, CreateProjectButton } from "./parts"
import { sessionReviewSearch, sessionRows } from "./session-model"

export function SessionPage() {
  const { sessionId = "" } = useParams({ strict: false }) as { sessionId?: string }
  const session = useStore((s) => s.catalog.sessions[sessionId])
  const m = useMessages()
  if (!session) return <MissingRecord noun="session" backTo="/sessions" backLabel={m.session_open_sessions()} />
  return session.imageType === "light" ? <SessionDetail sessionId={sessionId} /> : <CalibrationSession session={session} />
}

function processPill(m: Messages, status: ProcessStatus): { label: string; tone: Tone } {
  const pill: Record<ProcessStatus, { label: () => string; tone: Tone }> = {
    "awaiting-stack": { label: m.import_route_stack, tone: "info" },
    stacking: { label: m.session_process_stacking, tone: "info" },
    importing: { label: m.session_process_importing, tone: "info" },
    "trashing-raws": { label: m.session_process_trashing, tone: "info" },
    failed: { label: m.status_failed, tone: "danger" },
    done: { label: m.session_process_done, tone: "success" },
  }
  const { label, tone } = pill[status]
  return { label: label(), tone }
}

/** Raw calibration frames are input to a calibration process, never a library session (P-CAL3). */
function CalibrationSession({ session }: { session: Session }) {
  const view = useStore((s) => {
    const process = processForSession(s.catalog, session.id)
    return process ? processView(s.catalog, process) : null
  })
  const m = useMessages()
  const pill = view ? processPill(m, view.status) : null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={sessionLongLabel(m, session)}
        eyebrow={<Link to="/sessions">{m.nav_sessions()}</Link>}
        meta={pill ? <Pill tone={pill.tone}>{pill.label}</Pill> : <Pill tone="muted">{m.status_role_calibration()}</Pill>}
        actions={
          <Button size="sm" render={<Link to="/calibration" />}>
            {m.session_open_calibration()}
          </Button>
        }
      />
      <PageBody>
        <Notice
          tone="info"
          title={
            view
              ? `${view.name} · ${m.session_raw_frames({ count: view.frames, frames: formatCount(view.frames) })}`
              : m.session_raw_frames({ count: session.assetIds.length, frames: formatCount(session.assetIds.length) })
          }
        >
          {view?.failure ? `${m.session_step_failed({ step: say(m, CALIBRATION_STEP_NAME[view.failure.step]) })} · ${say(m, view.failure.reason)}` : null}
        </Notice>
      </PageBody>
    </div>
  )
}

function SessionDetail({ sessionId }: { sessionId: string }) {
  const state = useStore((s) => s)
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const m = useMessages()
  const { catalog } = state
  const session = catalog.sessions[sessionId]!
  const row = sessionRows(state).find((r) => r.session.id === sessionId)
  const [notice, setNotice] = useState<AddedNotice | null>(null)
  const reviewing = search.view === "review" && !row?.trashed
  const unreviewed = row?.unreviewed ?? 0
  const frames = row?.frames ?? session.assetIds.length
  const setView = (view: string) =>
    void navigate({ to: "/sessions/$sessionId", params: { sessionId }, search: view === "review" ? sessionReviewSearch(unreviewed) : {}, replace: false })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={sessionLongLabel(m, session)}
        eyebrow={<Link to="/sessions">{m.nav_sessions()}</Link>}
        description={`${session.objectLabel ? m.session_object({ name: session.objectLabel }) : m.session_no_object()} · ${m.session_frame_count({ count: frames, frames: formatCount(frames) })} · ${formatHours(row?.seconds ?? 0)}`}
        meta={
          row?.trashed ? (
            <StatusBadge kind="quality" value="unusable" label={m.status_trashed()} />
          ) : row?.needsTarget ? (
            <StatusBadge kind="association" value="needs-review" label={m.sessions_filter_needs_target()} />
          ) : row?.notInProject ? (
            <StatusBadge kind="association" value="unresolved" label={m.sessions_filter_not_in_project()} />
          ) : null
        }
        actions={
          <>
            {row && !row.trashed && !reviewing ? (
              <>
                <CreateProjectButton sessionId={sessionId} />
                {row.notInProject || row.candidateOf.length > 0 ? <AddToProjectMenu sessionId={sessionId} onAdded={setNotice} /> : null}
              </>
            ) : null}
            {row && !row.trashed ? (
              <ToggleGroup aria-label={m.session_view()} size="sm" variant="outline" spacing={0} value={[reviewing ? "review" : "detail"]} onValueChange={(value) => value[0] && setView(value[0] as string)}>
                <ToggleGroupItem value="detail">{m.session_detail()}</ToggleGroupItem>
                <ToggleGroupItem value="review" className="gap-1.5" data-session-review-tab>
                  {m.step_review()}
                  {unreviewed > 0 ? <CountBadge count={unreviewed} tone="warning" label={m.session_frames_unreviewed({ count: unreviewed, frames: formatCount(unreviewed) })} /> : null}
                </ToggleGroupItem>
              </ToggleGroup>
            ) : null}
          </>
        }
      />
      {reviewing ? (
        <SessionReview sessionId={sessionId} />
      ) : (
        <DetailBody state={state} session={session} row={row} notice={notice} onDismiss={() => setNotice(null)} onReview={() => setView("review")} />
      )}
    </div>
  )
}

function DetailBody({
  state,
  session,
  row,
  notice,
  onDismiss,
  onReview,
}: {
  state: PrototypeState
  session: Session
  row: ReturnType<typeof sessionRows>[number] | undefined
  notice: AddedNotice | null
  onDismiss: () => void
  onReview: () => void
}) {
  const { catalog } = state
  const m = useMessages()
  const [targetNote, setTargetNote] = useState<string | null>(null)
  const targetId = sessionTargetId(session)
  const rigId = sessionRigId(session)
  const assets = session.assetIds.map((id) => catalog.assets[id]).filter((a): a is Asset => a !== undefined)
  return (
    <PageBody className="space-y-4">
      {row?.trashed ? <Notice tone="warning" title={m.session_in_os_trash()} /> : null}
      {notice ? (
        <Notice tone="info" title={notice.title} actions={<Button size="xs" variant="ghost" onClick={onDismiss}>{m.session_dismiss()}</Button>}>
          {notice.note}
        </Notice>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Box
          id="target"
          level={2}
          title={m.sessions_column_target()}
          actions={targetId ? <Pill tone={session.target.status === "confirmed" ? "success" : "info"}>{catalog.targets[targetId]?.name ?? targetId}</Pill> : <Pill tone="warning">{m.session_unsettled()}</Pill>}
        >
          <div className="space-y-2">
            {session.target.evidence.length > 0 ? <EvidenceList evidence={session.target.evidence} caption={m.session_target_evidence({ name: sessionLongLabel(m, session) })} /> : <p className="text-xs text-muted-foreground">{m.session_no_evidence()}</p>}
            {!row?.trashed ? <ConfirmTargetControl sessionId={session.id} onDone={setTargetNote} /> : null}
            {targetNote ? <p className="text-xs text-success" role="status">{targetNote}</p> : null}
          </div>
        </Box>
        <Box id="rig" level={2} title={m.sessions_column_rig()} actions={rigId ? <Pill tone={session.equipment.status === "confirmed" ? "success" : "info"}>{rigName(m, catalog, rigId)}</Pill> : <Pill tone="warning">{m.session_unsettled()}</Pill>}>
          <div className="space-y-2">
            <EvidenceList evidence={session.equipment.evidence} caption={m.session_rig_evidence({ name: sessionLongLabel(m, session) })} />
            {!row?.trashed ? <ConfirmRigControl sessionId={session.id} /> : null}
          </div>
        </Box>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Box
          id="projects"
          level={2}
          flush
          title={
            <span className="flex items-center gap-1.5">
              {m.nav_projects()} <CountBadge count={row?.candidateOf.length ?? 0} label={m.home_project_count({ count: row?.candidateOf.length ?? 0 })} />
            </span>
          }
        >
          {row && row.candidateOf.length > 0 ? (
            <ul className="divide-y divide-border/60 text-sm">
              {row.candidateOf.map(({ project, candidate }) => (
                <li key={project.id} className="flex min-h-(--row-h) flex-wrap items-center justify-between gap-2 px-3 py-1">
                  <Link to="/projects/$projectId" params={{ projectId: project.id }} className="font-medium underline-offset-2 hover:underline">
                    {project.name}
                  </Link>
                  <span className="flex items-center gap-1.5">
                    {project.state === "done" ? <Pill tone="muted">{m.status_done()}</Pill> : null}
                    <Pill tone="info">{m.status_candidate()}</Pill>
                    <NoteMarker label={m.session_why_candidate({ name: project.name })} rows={[{ label: m.session_reason(), value: say(m, candidate.reason) }]} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-sm text-muted-foreground">{row?.needsTarget ? m.session_needs_target_first() : m.session_none()}</p>
          )}
        </Box>
        <Box
          id="runs"
          level={2}
          flush
          title={
            <span className="flex items-center gap-1.5">
              {m.common_runs()} <CountBadge count={row?.runs.length ?? 0} label={m.sessions_run_count({ count: row?.runs.length ?? 0 })} />
            </span>
          }
        >
          <RunsList state={state} runs={row?.runs ?? []} />
        </Box>
      </div>

      <Box
        id="frames"
        level={2}
        flush
        title={
          <span className="flex items-center gap-1.5">
            {m.sessions_column_frames()} <CountBadge count={assets.length} label={m.session_frame_count({ count: assets.length, frames: formatCount(assets.length) })} />
          </span>
        }
        actions={
          !row?.trashed ? (
            <Button size="sm" variant="outline" onClick={onReview}>
              <Eye aria-hidden="true" data-icon="inline-start" />
              {m.verb_review()}
            </Button>
          ) : null
        }
      >
        <FramesTable state={state} assets={assets} sessionId={session.id} reviewable={!row?.trashed} />
      </Box>

      <Box id="evidence" level={2} title={m.session_headers()}>
        <Metadata state={state} session={session} />
      </Box>
    </PageBody>
  )
}

function RunsList({ state, runs }: { state: PrototypeState; runs: ReturnType<typeof sessionRows>[number]["runs"] }) {
  const m = useMessages()
  if (runs.length === 0) return <p className="px-3 py-2 text-sm text-muted-foreground">{m.home_none()}</p>
  return (
    <ul className="divide-y divide-border/60 text-sm">
      {runs.map((run) => {
        const pipeline = runPipeline(state, run)
        const link = runStepLink(run, pipeline.current.id)
        const project = state.catalog.projects[run.projectId]
        return (
          <li key={run.id} className="flex min-h-(--row-h) flex-wrap items-center justify-between gap-2 px-3 py-1">
            <span className="flex min-w-0 items-center gap-2">
              <Link to={link.to as never} params={link.params as never} className="font-medium underline-offset-2 hover:underline">
                {run.name}
              </Link>
              <span className="truncate text-xs text-muted-foreground">
                {project?.name} · {rigName(m, state.catalog, run.rigId)}
              </span>
              {run.draft ? <Pill tone="muted">{m.status_draft()}</Pill> : null}
            </span>
            <GateLabel state={pipeline.current.state} label={`${stepName(m, pipeline.current.id)} · ${say(m, pipeline.current.status)}`} />
          </li>
        )
      })}
    </ul>
  )
}

function FramesTable({ state, assets, sessionId, reviewable }: { state: PrototypeState; assets: Asset[]; sessionId: string; reviewable: boolean }) {
  const navigate = useNavigate()
  const m = useMessages()
  const columns: Column<Asset>[] = [
    { id: "file", header: m.session_column_file(), rowHeader: true, truncate: true, sortValue: (a) => a.fileName, cell: (a) => <span title={a.copies[0]?.path}>{a.fileName}</span> },
    {
      id: "quality",
      header: m.session_column_quality(),
      sortValue: (a) => a.quality.value,
      cell: (a) => {
        if (a.trashed) return <StatusBadge kind="quality" value="unusable" label={m.status_trashed()} />
        const applies = qualityApplicability(a)
        return applies === "applicable" ? <StatusBadge kind="quality" value={a.quality.value} /> : <StatusBadge kind="quality" value={applies} />
      },
    },
    { id: "exposure", header: m.session_column_exposure(), align: "right", cell: (a) => formatExposure(a.observed.exposureS) },
    {
      id: "availability",
      header: m.session_column_availability(),
      cell: (a) => (a.trashed ? <Pill tone="muted">{m.session_os_trash()}</Pill> : <StatusBadge kind="availability" value={assetAvailability(state.disk, state.catalog, a)} />),
    },
    { id: "copies", header: m.session_column_copies(), align: "right", sortValue: (a) => a.copies.length, cell: (a) => <span className="tabular-nums" title={a.copies.map((c) => c.path).join("\n")}>{a.copies.length}</span> },
    { id: "sha", header: m.session_column_sha(), cell: (a) => <span className="font-mono text-xs text-muted-foreground">{a.sha256.slice(0, 12)}…</span> },
  ]
  const menu = (a: Asset): MenuEntry[] => [
    { heading: a.fileName },
    ...(reviewable && !a.trashed ? [{ label: m.verb_review(), icon: Eye, onSelect: () => void navigate({ to: "/sessions/$sessionId", params: { sessionId }, search: { view: "review", assetId: a.id } }) }] : []),
    { label: m.session_copy_path(), icon: FolderOpen, disabled: a.copies.length === 0, onSelect: () => void navigator.clipboard?.writeText(a.copies[0]?.path ?? "") },
  ]
  return <DataTable label={m.sessions_column_frames()} rows={assets} columns={columns} getRowId={(a) => a.id} initialSort={{ columnId: "file", direction: "asc" }} className="rounded-none border-0" contextMenu={menu} />
}

/** Header values; where each came from sits in its note. */
function Metadata({ state, session }: { state: PrototypeState; session: Session }) {
  const { catalog } = state
  const m = useMessages()
  const first = catalog.assets[session.assetIds[0] ?? ""]
  const header = first?.observed
  const site = captureSite(catalog, session)
  const locations = [...new Set(session.assetIds.flatMap((id) => catalog.assets[id]?.copies.map((c) => c.locationId) ?? []))].map((id) => catalog.locations[id]?.displayName ?? id)
  const sourced = (value: string, source: string) => (
    <>
      {value}
      <NoteMarker label={m.session_source_of({ value })} rows={[{ label: m.evidence_column_source(), value: source }]} className="ml-1" />
    </>
  )
  const fromHeader = (keyword: string) => m.session_header_source({ keyword })
  const typedAtImport = first && first.imageType !== first.observed.imageType
  const items = [
    { label: m.session_observing_night(), value: formatNight(session.night, true) },
    { label: m.session_started(), value: sourced(formatDateTime(session.startedAt), fromHeader("DATE-OBS")) },
    { label: m.session_ended(), value: formatDateTime(session.endedAt) },
    { label: m.session_frame_type(), value: typedAtImport ? sourced(typeLabel(m, first.imageType), m.session_typed_at_import()) : sourced(typeLabel(m, session.imageType), fromHeader("IMAGETYP")) },
    { label: m.session_filter(), value: sourced(session.channel ?? m.session_none(), fromHeader("FILTER")) },
    { label: m.session_column_exposure(), value: sourced(formatExposure(session.exposureS), fromHeader("EXPTIME")) },
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
