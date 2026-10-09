/**
 * S12 Session detail (slice A): one library light session with its frames,
 * the Target and rig evidence with Confirm Target / Confirm rig, the
 * Projects that consider it a candidate, the runs that use it, and Add to
 * Project (also adds the rig, with a visible note, D-W59) or Create Project
 * prefilled with its Target and rig.
 */
import { Link, useParams } from "@tanstack/react-router"
import { useState } from "react"
import { MissingRecord } from "@/app/missing-record"
import { GateLabel } from "@/app/run-ui"
import { EvidenceList, KeyValueList, PathText } from "@/components/app/data"
import { type Column, DataTable } from "@/components/app/data-table"
import { Notice } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { formatHours, rigName, runPipeline, runStepLink, sessionRigId, sessionTargetId } from "@/domain/derive"
import { assetAvailability, captureSite, qualityApplicability } from "@/domain/library"
import { sessionLongLabel } from "@/domain/membership"
import type { Asset } from "@/domain/types"
import { formatCount, formatDateTime, formatDec, formatExposure, formatNight, formatRa, plural } from "@/lib/format"
import { type PrototypeState, useStore } from "@/store/core"
import { AddToProjectMenu, type AddedNotice, ConfirmRigControl, ConfirmTargetControl, CreateProjectButton } from "./parts"
import { sessionRows } from "./session-model"

export function SessionPage() {
  const { sessionId = "" } = useParams({ strict: false }) as { sessionId?: string }
  const exists = useStore((s) => Boolean(s.catalog.sessions[sessionId]))
  if (!exists) return <MissingRecord noun="session" backTo="/sessions" backLabel="Open Sessions" />
  return <SessionDetail sessionId={sessionId} />
}

function SessionDetail({ sessionId }: { sessionId: string }) {
  const state = useStore((s) => s)
  const { catalog } = state
  const session = catalog.sessions[sessionId]!
  const row = sessionRows(state).find((r) => r.session.id === sessionId)
  const [notice, setNotice] = useState<AddedNotice | null>(null)
  const [targetNote, setTargetNote] = useState<string | null>(null)
  const targetId = sessionTargetId(session)
  const rigId = sessionRigId(session)
  const isLight = session.imageType === "light"

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
          row && !row.trashed && isLight ? (
            <>
              <CreateProjectButton sessionId={sessionId} />
              {row.notInProject || row.candidateOf.length > 0 ? <AddToProjectMenu sessionId={sessionId} onAdded={setNotice} /> : null}
            </>
          ) : null
        }
      />
      <PageBody className="space-y-6">
        {!isLight ? (
          <Notice tone="info" title="This is a calibration session">
            Sessions lists light frames only. <Link to="/calibration" className="text-link underline-offset-2 hover:underline">Open the Calibration library</Link>.
          </Notice>
        ) : null}
        {row?.trashed ? (
          <Notice tone="warning" title="Every frame of this session is in the OS Trash">
            It stays here for traceability and is hidden from pickers, candidates, goals and totals. Put back from the OS Trash plus a rescan restores the frames as Unusable.
          </Notice>
        ) : null}
        {notice ? (
          <Notice tone="info" title={notice.title} actions={<Button size="xs" variant="ghost" onClick={() => setNotice(null)}>Dismiss</Button>}>
            {notice.note ?? "No rig was added: the Project already has it."}
          </Notice>
        ) : null}

        <div className="grid gap-6 xl:grid-cols-2">
          <Section id="target" title="Target" description={targetId ? `${catalog.targets[targetId]?.name ?? targetId}, ${session.target.status}.` : "No settled Target: the evidence below does not agree on one."}>
            <EvidenceList evidence={session.target.evidence} caption={`Target evidence for ${sessionLongLabel(session)}`} />
            {session.target.evidence.length === 0 ? <p className="text-xs text-muted-foreground">No Target evidence: the headers have no OBJECT and no pointing.</p> : null}
            {!row?.trashed ? <ConfirmTargetControl sessionId={sessionId} onDone={setTargetNote} /> : null}
            {targetNote ? <p className="text-xs text-success" role="status">{targetNote}</p> : null}
          </Section>
          <Section id="rig" title="Rig" description={rigId ? `${rigName(catalog, rigId)}, ${session.equipment.status}.` : "No settled rig: confirm one so Projects can use this session."}>
            <EvidenceList evidence={session.equipment.evidence} caption={`Rig evidence for ${sessionLongLabel(session)}`} />
            {!row?.trashed ? <ConfirmRigControl sessionId={sessionId} /> : null}
          </Section>
        </div>

        <div className="grid gap-6 xl:grid-cols-2">
          <Section id="projects" title="Projects" description="A Project considers the session a candidate when its Target is a subject and its rig is one of the Project's rigs.">
            {row && row.candidateOf.length > 0 ? (
              <ul className="divide-y divide-border border-y border-separator text-sm">
                {row.candidateOf.map(({ project, candidate }) => (
                  <li key={project.id} className="flex min-h-(--row-h) flex-wrap items-center justify-between gap-2 py-1">
                    <Link to="/projects/$projectId" params={{ projectId: project.id }} className="font-medium underline-offset-2 hover:underline">
                      {project.name}
                    </Link>
                    <span className="text-xs text-muted-foreground">
                      Candidate · {candidate.reason}
                      {project.state === "done" ? " · Done" : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted-foreground">{row?.needsTarget ? "No Project yet: confirm a Target first." : row?.trashed ? "Trashed sessions are never candidates." : "Not in any Project. Add it to one, or create a Project from it."}</p>
            )}
          </Section>
          <Section id="runs" title="Runs that use it" description="Runs whose saved membership or open draft holds this session.">
            <RunsList state={state} runs={row?.runs ?? []} />
          </Section>
        </div>

        <Section id="frames" title="Frames" description="Library quality applies to every Project. Measurements never set it.">
          <FramesTable state={state} assets={session.assetIds.map((id) => catalog.assets[id]).filter((a): a is Asset => a !== undefined)} />
        </Section>

        <Section id="evidence" title="Capture metadata" description="As observed in the headers. Corrections are catalog-only; source headers never change.">
          <Metadata state={state} sessionId={sessionId} />
        </Section>
      </PageBody>
    </div>
  )
}

function RunsList({ state, runs }: { state: PrototypeState; runs: ReturnType<typeof sessionRows>[number]["runs"] }) {
  if (runs.length === 0) return <p className="text-sm text-muted-foreground">No run uses this session yet.</p>
  return (
    <ul className="divide-y divide-border border-y border-separator text-sm">
      {runs.map((run) => {
        const pipeline = runPipeline(state, run)
        const link = runStepLink(run, pipeline.current.id)
        const project = state.catalog.projects[run.projectId]
        return (
          <li key={run.id} className="flex min-h-(--row-h) flex-wrap items-center justify-between gap-2 py-1">
            <span className="min-w-0">
              <Link to={link.to as never} params={link.params as never} className="font-medium underline-offset-2 hover:underline">
                {run.name}
              </Link>
              <span className="ml-2 text-xs text-muted-foreground">
                {project?.name} · {rigName(state.catalog, run.rigId)}
                {run.draft ? " · in the open draft" : ""}
              </span>
            </span>
            <GateLabel state={pipeline.current.state} label={`${pipeline.current.label} · ${pipeline.current.status}`} />
          </li>
        )
      })}
    </ul>
  )
}

function FramesTable({ state, assets }: { state: PrototypeState; assets: Asset[] }) {
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
      cell: (a) => (a.trashed ? <span className="text-muted-foreground">In the OS Trash</span> : <StatusBadge kind="availability" value={assetAvailability(state.disk, state.catalog, a)} />),
    },
    { id: "copies", header: "Copies", align: "right", sortValue: (a) => a.copies.length, cell: (a) => <span className="tabular-nums" title={a.copies.map((c) => c.path).join("\n")}>{a.copies.length}</span> },
    { id: "sha", header: "SHA-256", cell: (a) => <span className="font-mono text-xs text-muted-foreground">{a.sha256.slice(0, 12)}…</span> },
  ]
  return <DataTable label="Frames" rows={assets} columns={columns} getRowId={(a) => a.id} initialSort={{ columnId: "file", direction: "asc" }} />
}

function Metadata({ state, sessionId }: { state: PrototypeState; sessionId: string }) {
  const { catalog } = state
  const session = catalog.sessions[sessionId]!
  const first = catalog.assets[session.assetIds[0] ?? ""]
  const header = first?.observed
  const site = captureSite(catalog, session)
  const locations = [...new Set(session.assetIds.flatMap((id) => catalog.assets[id]?.copies.map((c) => c.locationId) ?? []))].map((id) => catalog.locations[id]?.displayName ?? id)
  const items = [
    { label: "Observing night", value: formatNight(session.night, true) },
    { label: "Started", value: formatDateTime(session.startedAt), source: "Header DATE-OBS" },
    { label: "Ended", value: formatDateTime(session.endedAt) },
    { label: "Frame type", value: first && first.imageType !== first.observed.imageType ? `${first.imageType} (typed at import; header has none)` : session.imageType, source: "Header IMAGETYP" },
    { label: "Filter", value: session.channel ?? "None", source: "Header FILTER" },
    { label: "Exposure", value: formatExposure(session.exposureS), source: "Header EXPTIME" },
    { label: "Camera", value: session.cameraName ?? "Unknown", source: "Header INSTRUME" },
    { label: "Telescope", value: session.telescopeName ?? "Unknown", source: "Header TELESCOP" },
    { label: "Gain · offset", value: `${session.gain ?? "–"} · ${session.offset ?? "–"}` },
    { label: "Sensor temperature", value: session.ccdTempC === null ? "Unknown" : `${session.ccdTempC} °C`, source: "Header CCD-TEMP" },
    { label: "Pointing", value: header?.ra != null && header.dec != null ? `${formatRa(header.ra)} ${formatDec(header.dec)}` : "No pointing in the headers" },
    { label: "Capture site", value: site ? site.name : "Unknown" },
    { label: "Locations", value: locations.join(", ") || "None" },
    { label: "Frames", value: formatCount(session.assetIds.length) },
  ]
  return (
    <div className="space-y-2">
      <KeyValueList items={items} columns={2} />
      {first?.copies[0] ? (
        <p className="text-xs text-muted-foreground">
          First frame: <PathText path={first.copies[0].path} />
        </p>
      ) : null}
    </div>
  )
}
