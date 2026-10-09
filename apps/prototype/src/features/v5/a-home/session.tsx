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
import { GateLabel } from "@/app/run-ui"
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
import { CALIBRATION_STEP_LABEL, processForSession, processView, type ProcessStatus } from "@/domain/calibration-process"
import { formatHours, rigName, runPipeline, runStepLink, sessionRigId, sessionTargetId } from "@/domain/derive"
import { assetAvailability, captureSite, qualityApplicability } from "@/domain/library"
import { sessionLongLabel } from "@/domain/membership"
import type { Asset, Session } from "@/domain/types"
import { formatCount, formatDateTime, formatDec, formatExposure, formatNight, formatRa, plural } from "@/lib/format"
import type { SearchParams } from "@/routes"
import { type PrototypeState, useStore } from "@/store/core"
import { SessionReview } from "../d-review/review"
import { AddToProjectMenu, type AddedNotice, ConfirmRigControl, ConfirmTargetControl, CreateProjectButton } from "./parts"
import { sessionReviewSearch, sessionRows } from "./session-model"

export function SessionPage() {
  const { sessionId = "" } = useParams({ strict: false }) as { sessionId?: string }
  const session = useStore((s) => s.catalog.sessions[sessionId])
  if (!session) return <MissingRecord noun="session" backTo="/sessions" backLabel="Open Sessions" />
  return session.imageType === "light" ? <SessionDetail sessionId={sessionId} /> : <CalibrationSession session={session} />
}

const PROCESS_PILL: Record<ProcessStatus, { label: string; tone: Tone }> = {
  "awaiting-stack": { label: "Calibration → stack", tone: "info" },
  stacking: { label: "Stacking", tone: "info" },
  importing: { label: "Importing master", tone: "info" },
  "trashing-raws": { label: "Trashing raws", tone: "info" },
  failed: { label: "Failed", tone: "danger" },
  done: { label: "Master registered", tone: "success" },
}

/** Raw calibration frames are input to a calibration process, never a library session (P-CAL3). */
function CalibrationSession({ session }: { session: Session }) {
  const view = useStore((s) => {
    const process = processForSession(s.catalog, session.id)
    return process ? processView(s.catalog, process) : null
  })
  const pill = view ? PROCESS_PILL[view.status] : null
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={sessionLongLabel(session)}
        eyebrow={<Link to="/sessions">Sessions</Link>}
        meta={pill ? <Pill tone={pill.tone}>{pill.label}</Pill> : <Pill tone="muted">Calibration</Pill>}
        actions={
          <Button size="sm" render={<Link to="/calibration" />}>
            Open Calibration
          </Button>
        }
      />
      <PageBody>
        <Notice tone="info" title={view ? `${view.name} · ${plural(view.frames, "raw frame")}` : `${plural(session.assetIds.length, "raw frame")}`}>
          {view?.failure ? `${CALIBRATION_STEP_LABEL[view.failure.step]} failed · ${view.failure.reason}` : null}
        </Notice>
      </PageBody>
    </div>
  )
}

function SessionDetail({ sessionId }: { sessionId: string }) {
  const state = useStore((s) => s)
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const { catalog } = state
  const session = catalog.sessions[sessionId]!
  const row = sessionRows(state).find((r) => r.session.id === sessionId)
  const [notice, setNotice] = useState<AddedNotice | null>(null)
  const reviewing = search.view === "review" && !row?.trashed
  const unreviewed = row?.unreviewed ?? 0
  const setView = (view: string) =>
    void navigate({ to: "/sessions/$sessionId", params: { sessionId }, search: view === "review" ? sessionReviewSearch(unreviewed) : {}, replace: false })

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={sessionLongLabel(session)}
        eyebrow={<Link to="/sessions">Sessions</Link>}
        description={`${session.objectLabel ? `OBJECT ${session.objectLabel}` : "No OBJECT"} · ${plural(row?.frames ?? session.assetIds.length, "frame")} · ${formatHours(row?.seconds ?? 0)}`}
        meta={
          row?.trashed ? (
            <StatusBadge kind="quality" value="unusable" label="Trashed" />
          ) : row?.needsTarget ? (
            <StatusBadge kind="association" value="needs-review" label="Needs a Target" />
          ) : row?.notInProject ? (
            <StatusBadge kind="association" value="unresolved" label="Not in any Project" />
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
              <ToggleGroup aria-label="Session view" size="sm" variant="outline" spacing={0} value={[reviewing ? "review" : "detail"]} onValueChange={(value) => value[0] && setView(value[0] as string)}>
                <ToggleGroupItem value="detail">Detail</ToggleGroupItem>
                <ToggleGroupItem value="review" className="gap-1.5" data-session-review-tab>
                  Review
                  {unreviewed > 0 ? <CountBadge count={unreviewed} tone="warning" label={`${plural(unreviewed, "frame")} unreviewed`} /> : null}
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
  const [targetNote, setTargetNote] = useState<string | null>(null)
  const targetId = sessionTargetId(session)
  const rigId = sessionRigId(session)
  const assets = session.assetIds.map((id) => catalog.assets[id]).filter((a): a is Asset => a !== undefined)
  return (
    <PageBody className="space-y-4">
      {row?.trashed ? <Notice tone="warning" title="In the OS Trash" /> : null}
      {notice ? (
        <Notice tone="info" title={notice.title} actions={<Button size="xs" variant="ghost" onClick={onDismiss}>Dismiss</Button>}>
          {notice.note}
        </Notice>
      ) : null}

      <div className="grid gap-4 xl:grid-cols-2">
        <Box
          id="target"
          level={2}
          title="Target"
          actions={targetId ? <Pill tone={session.target.status === "confirmed" ? "success" : "info"}>{catalog.targets[targetId]?.name ?? targetId}</Pill> : <Pill tone="warning">Unsettled</Pill>}
        >
          <div className="space-y-2">
            {session.target.evidence.length > 0 ? <EvidenceList evidence={session.target.evidence} caption={`Target evidence for ${sessionLongLabel(session)}`} /> : <p className="text-xs text-muted-foreground">No evidence</p>}
            {!row?.trashed ? <ConfirmTargetControl sessionId={session.id} onDone={setTargetNote} /> : null}
            {targetNote ? <p className="text-xs text-success" role="status">{targetNote}</p> : null}
          </div>
        </Box>
        <Box id="rig" level={2} title="Rig" actions={rigId ? <Pill tone={session.equipment.status === "confirmed" ? "success" : "info"}>{rigName(catalog, rigId)}</Pill> : <Pill tone="warning">Unsettled</Pill>}>
          <div className="space-y-2">
            <EvidenceList evidence={session.equipment.evidence} caption={`Rig evidence for ${sessionLongLabel(session)}`} />
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
              Projects <CountBadge count={row?.candidateOf.length ?? 0} label={plural(row?.candidateOf.length ?? 0, "Project")} />
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
                    {project.state === "done" ? <Pill tone="muted">Done</Pill> : null}
                    <Pill tone="info">Candidate</Pill>
                    <NoteMarker label={`Why ${project.name} considers it`} rows={[{ label: "Reason", value: candidate.reason }]} />
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="px-3 py-2 text-sm text-muted-foreground">{row?.needsTarget ? "Needs a Target first" : "None"}</p>
          )}
        </Box>
        <Box
          id="runs"
          level={2}
          flush
          title={
            <span className="flex items-center gap-1.5">
              Runs <CountBadge count={row?.runs.length ?? 0} label={plural(row?.runs.length ?? 0, "run")} />
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
            Frames <CountBadge count={assets.length} label={plural(assets.length, "frame")} />
          </span>
        }
        actions={
          !row?.trashed ? (
            <Button size="sm" variant="outline" onClick={onReview}>
              <Eye aria-hidden="true" data-icon="inline-start" />
              Review
            </Button>
          ) : null
        }
      >
        <FramesTable state={state} assets={assets} sessionId={session.id} reviewable={!row?.trashed} />
      </Box>

      <Box id="evidence" level={2} title="Headers">
        <Metadata state={state} session={session} />
      </Box>
    </PageBody>
  )
}

function RunsList({ state, runs }: { state: PrototypeState; runs: ReturnType<typeof sessionRows>[number]["runs"] }) {
  if (runs.length === 0) return <p className="px-3 py-2 text-sm text-muted-foreground">None</p>
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
                {project?.name} · {rigName(state.catalog, run.rigId)}
              </span>
              {run.draft ? <Pill tone="muted">Draft</Pill> : null}
            </span>
            <GateLabel state={pipeline.current.state} label={`${pipeline.current.label} · ${pipeline.current.status}`} />
          </li>
        )
      })}
    </ul>
  )
}

function FramesTable({ state, assets, sessionId, reviewable }: { state: PrototypeState; assets: Asset[]; sessionId: string; reviewable: boolean }) {
  const navigate = useNavigate()
  const columns: Column<Asset>[] = [
    { id: "file", header: "File", rowHeader: true, truncate: true, sortValue: (a) => a.fileName, cell: (a) => <span title={a.copies[0]?.path}>{a.fileName}</span> },
    {
      id: "quality",
      header: "Quality",
      sortValue: (a) => a.quality.value,
      cell: (a) => {
        if (a.trashed) return <StatusBadge kind="quality" value="unusable" label="Trashed" />
        const applies = qualityApplicability(a)
        return applies === "applicable" ? <StatusBadge kind="quality" value={a.quality.value} /> : <StatusBadge kind="quality" value={applies} />
      },
    },
    { id: "exposure", header: "Exposure", align: "right", cell: (a) => formatExposure(a.observed.exposureS) },
    {
      id: "availability",
      header: "Availability",
      cell: (a) => (a.trashed ? <Pill tone="muted">OS Trash</Pill> : <StatusBadge kind="availability" value={assetAvailability(state.disk, state.catalog, a)} />),
    },
    { id: "copies", header: "Copies", align: "right", sortValue: (a) => a.copies.length, cell: (a) => <span className="tabular-nums" title={a.copies.map((c) => c.path).join("\n")}>{a.copies.length}</span> },
    { id: "sha", header: "SHA-256", cell: (a) => <span className="font-mono text-xs text-muted-foreground">{a.sha256.slice(0, 12)}…</span> },
  ]
  const menu = (a: Asset): MenuEntry[] => [
    { heading: a.fileName },
    ...(reviewable && !a.trashed ? [{ label: "Review", icon: Eye, onSelect: () => void navigate({ to: "/sessions/$sessionId", params: { sessionId }, search: { view: "review", assetId: a.id } }) }] : []),
    { label: "Copy path", icon: FolderOpen, disabled: a.copies.length === 0, onSelect: () => void navigator.clipboard?.writeText(a.copies[0]?.path ?? "") },
  ]
  return <DataTable label="Frames" rows={assets} columns={columns} getRowId={(a) => a.id} initialSort={{ columnId: "file", direction: "asc" }} className="rounded-none border-0" contextMenu={menu} />
}

/** Header values; where each came from sits in its note. */
function Metadata({ state, session }: { state: PrototypeState; session: Session }) {
  const { catalog } = state
  const first = catalog.assets[session.assetIds[0] ?? ""]
  const header = first?.observed
  const site = captureSite(catalog, session)
  const locations = [...new Set(session.assetIds.flatMap((id) => catalog.assets[id]?.copies.map((c) => c.locationId) ?? []))].map((id) => catalog.locations[id]?.displayName ?? id)
  const sourced = (value: string, source: string) => (
    <>
      {value}
      <NoteMarker label={`Source of ${value}`} rows={[{ label: "Source", value: source }]} className="ml-1" />
    </>
  )
  const typedAtImport = first && first.imageType !== first.observed.imageType
  const items = [
    { label: "Observing night", value: formatNight(session.night, true) },
    { label: "Started", value: sourced(formatDateTime(session.startedAt), "Header DATE-OBS") },
    { label: "Ended", value: formatDateTime(session.endedAt) },
    { label: "Frame type", value: typedAtImport ? sourced(`${first.imageType}`, "Typed at import; the header has none") : sourced(session.imageType, "Header IMAGETYP") },
    { label: "Filter", value: sourced(session.channel ?? "None", "Header FILTER") },
    { label: "Exposure", value: sourced(formatExposure(session.exposureS), "Header EXPTIME") },
    { label: "Camera", value: sourced(session.cameraName ?? "Unknown", "Header INSTRUME") },
    { label: "Telescope", value: sourced(session.telescopeName ?? "Unknown", "Header TELESCOP") },
    { label: "Gain · offset", value: `${session.gain ?? "–"} · ${session.offset ?? "–"}` },
    { label: "Sensor temperature", value: sourced(session.ccdTempC === null ? "Unknown" : `${session.ccdTempC} °C`, "Header CCD-TEMP") },
    { label: "Pointing", value: header?.ra != null && header.dec != null ? `${formatRa(header.ra)} ${formatDec(header.dec)}` : "–" },
    { label: "Capture site", value: site ? site.name : "Unknown" },
    { label: "Locations", value: locations.join(", ") || "None" },
    { label: "Frames", value: formatCount(session.assetIds.length) },
    ...(first?.copies[0] ? [{ label: "First frame", value: <PathText path={first.copies[0].path} /> }] : []),
  ]
  return <KeyValueList items={items} columns={2} />
}
