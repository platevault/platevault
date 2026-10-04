/**
 * Inspect session (`/sessions/$sessionId`): observed versus confirmed
 * evidence, Confirm Target and Confirm equipment, catalog filter correction
 * as a traceable grouping revision, physical copies, and library-scope frame
 * quality with Changed content and Verification pending (J19 S9-S15;
 * LIB-FR-05, -09, -11, -12; LIB-AC-06, -08, -10, -14, -15).
 */
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { Layers } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { EvidenceList, type KeyValueItem, KeyValueList, PathText } from "@/components/app/data"
import { type Column, DataTable, SelectionBar } from "@/components/app/data-table"
import { ActionError, EmptyState, Notice, UnknownValue } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { type AssetAvailability, assetAvailability, captureSite } from "@/domain/derive"
import type { Asset, Catalog, QualityValue, Session } from "@/domain/types"
import { formatCount, formatDateTime, formatDec, formatDegrees, formatDuration, formatExposure, formatNight, formatRa, formatTime, plural } from "@/lib/format"
import { store, useStore } from "@/store/core"
import { startIndexing } from "@/store/operations"
import { confirmEquipment, confirmTarget, correctFilter, type FilterCorrectionPreview, previewFilterCorrection, setLibraryQuality } from "../actions"
import { type FrameQuality, frameQuality, knownChannels, projectsLinking, sessionLabel, sessionRow } from "../model"
import { AssociationBadge, FlowStatus, useCommitFlow } from "../parts"

export function SessionPage() {
  const { sessionId = "" } = useParams({ strict: false }) as { sessionId?: string }
  const exists = useStore((s) => Boolean(s.catalog.sessions[sessionId]))
  if (!exists) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="Session not found" />
        <PageBody>
          <EmptyState
            icon={Layers}
            titleAs="h2"
            title="This session does not exist"
            description="It may come from an older prototype build or a reset. The library is unchanged."
            action={
              <Button size="sm" render={<Link to="/sessions" />}>
                Go to Sessions
              </Button>
            }
          />
        </PageBody>
      </div>
    )
  }
  return <SessionInspector key={sessionId} sessionId={sessionId} />
}

function SessionInspector({ sessionId }: { sessionId: string }) {
  const row = useStore((s) => sessionRow(s, s.catalog.sessions[sessionId]!))
  const catalog = useStore((s) => s.catalog)
  const { session } = row
  const current = !session.supersededBy
  const isLight = session.imageType === "light"
  const offlineLocations = row.locations.filter((l) => l.availability === "offline")
  const unreadableLocations = row.locations.filter((l) => l.location.unreadablePaths.length > 0 || l.location.access === "denied")
  const replacement = session.supersededBy ? catalog.sessions[session.supersededBy] : undefined

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow={
          <span className="flex flex-wrap items-center gap-1.5">
            <Link to="/sessions" className="underline-offset-2 hover:underline">
              Sessions
            </Link>
            {session.target.value && row.targetName ? (
              <>
                <span aria-hidden="true">›</span>
                <Link to="/targets/$targetId" params={{ targetId: session.target.value }} className="underline-offset-2 hover:underline">
                  {row.targetName}
                </Link>
              </>
            ) : null}
          </span>
        }
        title={row.label}
        meta={
          <>
            {session.scope !== "complete" ? <StatusBadge kind="scanScope" value={session.scope} /> : null}
            {row.availability.offline > 0 ? <StatusBadge kind="availability" value="offline" /> : null}
          </>
        }
        description={`${plural(session.assetIds.length, "frame")} · ${formatDuration(row.breakdown.captured.seconds)} · grouping revision ${session.revision}`}
        actions={
          current && isLight ? (
            <>
              <Button variant="outline" render={<Link to="/storage/filing" search={{ sessionIds: session.id }} />}>
                File into library
              </Button>
              <Button render={<Link to="/views/new" search={{ from: "sessions", sessionIds: session.id }} />}>Create View</Button>
            </>
          ) : undefined
        }
      />
      <PageBody>
        {replacement ? (
          <Notice
            tone="info"
            title={`Replaced by grouping revision ${replacement.revision}`}
            actions={
              <Button size="sm" variant="outline" render={<Link to="/sessions/$sessionId" params={{ sessionId: replacement.id }} />}>
                Open current session
              </Button>
            }
          >
            This session is kept for traceability. It does not count in totals, and its frames now belong to {sessionLabel(catalog, replacement)}. Frame
            identities and source headers are unchanged.
          </Notice>
        ) : null}
        {session.scope === "provisional" ? (
          <Notice tone="info" title="Provisional: this session is still being read">
            Indexing is reading its location now. Counts can still grow; nothing shown here is final until the scan settles.
          </Notice>
        ) : null}
        {offlineLocations.length > 0 ? (
          <Notice
            tone="offline"
            title={`${plural(row.availability.offline, "frame")} offline`}
            actions={offlineLocations.map(({ location }) => (
              <Button key={location.id} size="sm" variant="outline" render={<Link to="/settings/locations" search={{ locationId: location.id }} />}>
                Locate or remap {location.displayName}
              </Button>
            ))}
          >
            {offlineLocations.map((l) => l.location.displayName).join(", ")} {offlineLocations.length === 1 ? "is" : "are"} offline. The values below were last
            observed {offlineLocations[0]!.location.lastIndexedAt ? formatDateTime(offlineLocations[0]!.location.lastIndexedAt) : "at the last scan"} and are not
            currently verified. These frames count in captured totals, are not missing, and are not available as inputs.
          </Notice>
        ) : null}
        {session.scope === "incomplete" || row.availability.unreadable > 0 ? (
          <Notice
            tone="warning"
            title="Incomplete scope"
            actions={unreadableLocations.map(({ location }) => (
              <span key={location.id} className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => startIndexing([location.id])}>
                  Rescan {location.displayName}
                </Button>
                <Button size="sm" variant="ghost" render={<Link to="/settings/locations" search={{ locationId: location.id }} />}>
                  Choose folder again
                </Button>
              </span>
            ))}
          >
            {row.availability.unreadable > 0 ? `${plural(row.availability.unreadable, "frame")} could not be read at the last scan` : "The last scan of this session stopped early"}
            {unreadableLocations.flatMap((l) => l.location.unreadablePaths).length > 0 ? (
              <>
                {" "}
                because{" "}
                {unreadableLocations
                  .flatMap((l) => l.location.unreadablePaths)
                  .join(", ")}{" "}
                is unreadable
              </>
            ) : null}
            . The session keeps its last-observed metadata and decisions; no frame is marked missing.
          </Notice>
        ) : null}

        <Section title="Capture metadata" description="As observed in the headers. Corrections are catalog-only and named with their source." id="metadata">
          <MetadataList session={session} catalog={catalog} />
        </Section>

        {isLight ? <TargetSection session={session} catalog={catalog} editable={current} /> : null}
        <EquipmentSection session={session} catalog={catalog} editable={current} />
        <CorrectionsSection session={session} catalog={catalog} editable={current} />
        <CopiesSection sessionId={sessionId} />
        <FramesSection session={session} editable={current && isLight} />
      </PageBody>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

function MetadataList({ session, catalog }: { session: Session; catalog: Catalog }) {
  const first = catalog.assets[session.assetIds[0] ?? ""]
  const header = first?.observed
  const site = captureSite(catalog, session)
  const filterCorrection = [...session.corrections].reverse().find((c) => c.field === "filter")
  const missing = (keyword: string) => <UnknownValue label="Missing" reason={`The headers have no ${keyword} keyword.`} />
  const items: KeyValueItem[] = [
    { label: "Night", value: formatNight(session.night, true), source: "From DATE-OBS" },
    {
      label: "Captured",
      value: `${formatDateTime(session.startedAt, site?.timeZone)} – ${formatTime(session.endedAt, site?.timeZone)}${site ? ` (${site.timeZone})` : ""}`,
    },
    {
      label: "Channel",
      value: session.channel ?? "No filter",
      source: filterCorrection ? `Catalog correction (header FILTER ${filterCorrection.observedValue ?? "missing"})` : "Header FILTER",
    },
    { label: "Exposure", value: formatExposure(session.exposureS), source: "Header EXPTIME" },
    { label: "Frames", value: formatCount(session.assetIds.length) },
    { label: "OBJECT", value: session.objectLabel ? <span className="font-mono text-xs">{session.objectLabel}</span> : missing("OBJECT"), source: "A label, never identity" },
    { label: "Camera", value: session.cameraName ?? missing("INSTRUME"), source: "Header INSTRUME" },
    { label: "Telescope", value: session.telescopeName ?? missing("TELESCOP"), source: "Header TELESCOP" },
    { label: "Focal length", value: header?.focalLengthMm ? `${header.focalLengthMm} mm` : missing("FOCALLEN"), source: "Header FOCALLEN" },
    { label: "Gain / offset", value: `${session.gain ?? "Missing"} / ${session.offset ?? "Missing"}`, source: "Header GAIN, OFFSET" },
    { label: "Sensor temperature", value: session.ccdTempC === null ? missing("CCD-TEMP") : `${session.ccdTempC} °C (median)`, source: "Header CCD-TEMP" },
    { label: "Binning", value: `${session.binning}×${session.binning}`, source: "Header XBINNING" },
    {
      label: "Pointing",
      value: session.pointing ? (
        `RA ${formatRa(session.pointing.ra)} · Dec ${formatDec(session.pointing.dec)}`
      ) : (
        <UnknownValue label="Position unknown" reason="The headers have no RA and DEC keywords." />
      ),
      source: session.pointing ? "Header RA, DEC (mean)" : undefined,
    },
    {
      label: "Rotation",
      value:
        session.pointing?.rotationDeg !== null && session.pointing?.rotationDeg !== undefined ? (
          formatDegrees(session.pointing.rotationDeg)
        ) : (
          <UnknownValue reason="Not every frame records ROTATANG." />
        ),
    },
    {
      label: "Capture site",
      value: site ? (
        site.name
      ) : (
        <UnknownValue
          reason={header?.siteLat === null || header?.siteLat === undefined ? "The headers have no SITELAT and SITELONG." : "No saved observing site matches the header coordinates."}
        />
      ),
      source: site ? "Header SITELAT, SITELONG matched to a saved site" : undefined,
    },
  ]
  return <KeyValueList items={items} columns={2} />
}

// ---------------------------------------------------------------------------
// Associations
// ---------------------------------------------------------------------------

const STATUS_EXPLANATION = {
  confirmed: "",
  associated: "Associated from agreeing evidence. Confirm it to record your decision.",
  "needs-review": "The evidence is unknown or conflicts, so this is not counted for a Target until you confirm one.",
  unresolved: "There is no OBJECT and not enough other evidence, so PlateVault does not guess.",
} as const

function ConfirmedLine({ session, field }: { session: Session; field: "target" | "equipment" }) {
  const association = session[field]
  const user = association.evidence.find((e) => e.source === "user")
  if (association.status === "confirmed" && user && association.confirmedAt) {
    return (
      <p className="text-sm">
        <span className="text-muted-foreground">Confirmed: </span>
        {user.value} <span className="text-muted-foreground">on {formatDateTime(association.confirmedAt)}, by you. Stored in the catalog only.</span>
      </p>
    )
  }
  return (
    <p className="text-sm text-pretty">
      <span className="text-muted-foreground">Confirmed: </span>
      Not confirmed. {STATUS_EXPLANATION[association.status]}
    </p>
  )
}

function useBaseRevision(session: Session) {
  const [base, setBase] = useState(session.revision)
  return { base, refresh: () => setBase(store.getState().catalog.sessions[session.id]?.revision ?? session.revision) }
}

function TargetSection({ session, catalog, editable }: { session: Session; catalog: Catalog; editable: boolean }) {
  const flow = useCommitFlow()
  const { base, refresh } = useBaseRevision(session)
  const [choice, setChoice] = useState<string | null>(session.target.value)
  const [fieldError, setFieldError] = useState(false)
  const labelId = useId()
  const errorId = useId()
  const reasonId = useId()
  const items = Object.values(catalog.targets)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ value: t.id, label: t.name }))
  const confirmedSame = session.target.status === "confirmed" && choice === session.target.value
  const observed = session.target.evidence.filter((e) => e.source !== "user")

  function confirm() {
    if (!choice) {
      setFieldError(true)
      return
    }
    const result = flow.run(() => confirmTarget(session.id, choice, base))
    if (result.ok) refresh()
  }

  return (
    <Section
      id="target"
      title="Target"
      description="Observed evidence and your confirmation are kept separately."
      actions={<AssociationBadge association={session.target} />}
    >
      <div className="space-y-3 rounded-lg border p-3">
        <EvidenceList evidence={observed} caption={`Observed Target evidence for ${sessionLabel(catalog, session)}`} />
        <ConfirmedLine session={session} field="target" />
        {editable ? (
          <div className="flex flex-wrap items-end gap-3 border-t pt-3">
            <div className="space-y-1.5">
              <Label id={labelId}>Target to confirm</Label>
              <Select
                items={items}
                value={choice}
                onValueChange={(value) => {
                  setChoice(value as string)
                  setFieldError(false)
                }}
              >
                <SelectTrigger
                  aria-labelledby={labelId}
                  aria-invalid={fieldError || undefined}
                  aria-describedby={fieldError ? errorId : undefined}
                  className="w-64"
                >
                  <SelectValue placeholder="Choose a Target" />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button onClick={confirm} disabled={confirmedSame} focusableWhenDisabled aria-describedby={confirmedSame ? reasonId : undefined}>
              Confirm Target
            </Button>
            {confirmedSame ? (
              <span id={reasonId} className="pb-1.5 text-xs text-muted-foreground">
                Already confirmed
              </span>
            ) : null}
            <FlowStatus
              flow={flow}
              dirty={choice !== session.target.value}
              onReview={() => {
                refresh()
                setChoice(store.getState().catalog.sessions[session.id]?.target.value ?? null)
                flow.reset()
              }}
            />
            {fieldError ? (
              <p id={errorId} role="alert" className="w-full text-sm text-destructive">
                Choose a Target to confirm.
              </p>
            ) : null}
            {items.length === 0 ? (
              <p className="w-full text-sm text-muted-foreground">
                No Target record exists yet.{" "}
                <Link to="/targets" className="text-primary underline-offset-2 hover:underline">
                  Add a Target
                </Link>{" "}
                first.
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </Section>
  )
}

const SOURCE_WORD = { manual: "Manual", detected: "Detected", "built-in": "Built-in" } as const

function EquipmentSection({ session, catalog, editable }: { session: Session; catalog: Catalog; editable: boolean }) {
  const flow = useCommitFlow()
  const { base, refresh } = useBaseRevision(session)
  const [choice, setChoice] = useState<string | null>(session.equipment.value)
  const [fieldError, setFieldError] = useState(false)
  const labelId = useId()
  const errorId = useId()
  const reasonId = useId()
  const items = Object.values(catalog.opticalTrains)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ value: t.id, label: `${t.name} · ${SOURCE_WORD[t.source]}` }))
  const confirmedSame = session.equipment.status === "confirmed" && choice === session.equipment.value
  const observed = session.equipment.evidence.filter((e) => e.source !== "user")
  const returnTo = `/sessions/${session.id}`

  function confirm() {
    if (!choice) {
      setFieldError(true)
      return
    }
    const result = flow.run(() => confirmEquipment(session.id, choice, base))
    if (result.ok) refresh()
  }

  return (
    <Section
      id="equipment"
      title="Equipment"
      description="Camera and optical-train evidence. Confirming promotes a train detected from headers to a manual record."
      actions={<AssociationBadge association={session.equipment} />}
    >
      <div className="space-y-3 rounded-lg border p-3">
        <EvidenceList evidence={observed} caption={`Observed equipment evidence for ${sessionLabel(catalog, session)}`} />
        <ConfirmedLine session={session} field="equipment" />
        {editable ? (
          <div className="flex flex-wrap items-end gap-3 border-t pt-3">
            {items.length > 0 ? (
              <>
                <div className="space-y-1.5">
                  <Label id={labelId}>Optical train to confirm</Label>
                  <Select
                    items={items}
                    value={choice}
                    onValueChange={(value) => {
                      setChoice(value as string)
                      setFieldError(false)
                    }}
                  >
                    <SelectTrigger
                      aria-labelledby={labelId}
                      aria-invalid={fieldError || undefined}
                      aria-describedby={fieldError ? errorId : undefined}
                      className="w-80"
                    >
                      <SelectValue placeholder="Choose an optical train" />
                    </SelectTrigger>
                    <SelectContent>
                      {items.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Button onClick={confirm} disabled={confirmedSame} focusableWhenDisabled aria-describedby={confirmedSame ? reasonId : undefined}>
                  Confirm equipment
                </Button>
                {confirmedSame ? (
                  <span id={reasonId} className="pb-1.5 text-xs text-muted-foreground">
                    Already confirmed
                  </span>
                ) : null}
                <FlowStatus
                  flow={flow}
                  dirty={choice !== session.equipment.value}
                  onReview={() => {
                    refresh()
                    setChoice(store.getState().catalog.sessions[session.id]?.equipment.value ?? null)
                    flow.reset()
                  }}
                />
                {fieldError ? (
                  <p id={errorId} role="alert" className="w-full text-sm text-destructive">
                    Choose an optical train to confirm.
                  </p>
                ) : null}
              </>
            ) : (
              <p className="text-sm text-muted-foreground">No optical train record exists yet.</p>
            )}
            <Button variant="ghost" size="sm" render={<Link to="/settings/equipment" search={{ return: returnTo }} />} className="w-fit">
              {items.length > 0 ? "Missing a record? Add an optical train" : "Add an optical train"}
            </Button>
          </div>
        ) : null}
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Corrections and grouping revisions (D15)
// ---------------------------------------------------------------------------

const FIELD_LABEL = { target: "Target", equipment: "Equipment", filter: "Filter", exposure: "Exposure", "focal-length": "Focal length" } as const

function CorrectionsSection({ session, catalog, editable }: { session: Session; catalog: Catalog; editable: boolean }) {
  const [open, setOpen] = useState(false)
  const previous = session.previousSessionIds.map((id) => catalog.sessions[id]).filter((s): s is Session => s !== undefined)
  return (
    <Section
      id="corrections"
      title="Catalog corrections and grouping revisions"
      description="Corrections change the PlateVault catalog only. Source headers stay as captured."
      actions={
        editable ? (
          <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
            Correct filter…
          </Button>
        ) : undefined
      }
    >
      {previous.length > 0 ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Grouping revision {session.revision} replaced </span>
          {previous.map((p, index) => (
            <span key={p.id}>
              {index > 0 ? ", " : ""}
              <Link to="/sessions/$sessionId" params={{ sessionId: p.id }} className="text-primary underline-offset-2 hover:underline">
                {sessionLabel(catalog, p)} (revision {p.revision})
              </Link>
            </span>
          ))}
          <span className="text-muted-foreground">. The replaced sessions stay inspectable.</span>
        </p>
      ) : null}
      {session.corrections.length === 0 ? (
        <p className="text-sm text-muted-foreground">No catalog corrections. Every value above is as observed.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border">
          <table className="w-full text-sm">
            <caption className="sr-only">Catalog corrections for {sessionLabel(catalog, session)}</caption>
            <thead className="text-xs text-muted-foreground">
              <tr className="border-b">
                <th scope="col" className="h-(--row-h) px-3 text-left font-medium">
                  Field
                </th>
                <th scope="col" className="px-3 text-left font-medium">
                  Observed
                </th>
                <th scope="col" className="px-3 text-left font-medium">
                  Catalog value
                </th>
                <th scope="col" className="px-3 text-right font-medium">
                  Revision
                </th>
                <th scope="col" className="px-3 text-left font-medium">
                  When
                </th>
              </tr>
            </thead>
            <tbody>
              {session.corrections.map((c) => (
                <tr key={c.id} className="h-(--row-h) border-b last:border-0">
                  <th scope="row" className="px-3 text-left font-normal">
                    {FIELD_LABEL[c.field]}
                  </th>
                  <td className="px-3">{c.observedValue ?? <span className="text-muted-foreground">None</span>}</td>
                  <td className="px-3">{c.correctedValue}</td>
                  <td className="px-3 text-right tabular-nums">{c.revision}</td>
                  <td className="px-3 tabular-nums">{formatDateTime(c.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {editable ? <FilterCorrectionDialog open={open} onOpenChange={setOpen} session={session} catalog={catalog} /> : null}
    </Section>
  )
}

function FilterCorrectionDialog({ open, onOpenChange, session, catalog }: { open: boolean; onOpenChange: (open: boolean) => void; session: Session; catalog: Catalog }) {
  const navigate = useNavigate()
  const [step, setStep] = useState<"edit" | "review">("edit")
  const [filter, setFilter] = useState<string | null>(null)
  const [fieldError, setFieldError] = useState(false)
  const [preview, setPreview] = useState<FilterCorrectionPreview | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [base, setBase] = useState(session.revision)
  const labelId = useId()
  const errorId = useId()
  const options = knownChannels(catalog).filter((c) => c !== session.channel)

  useEffect(() => {
    if (!open) return
    setStep("edit")
    setFilter(null)
    setFieldError(false)
    setPreview(null)
    setError(null)
    setBase(store.getState().catalog.sessions[session.id]?.revision ?? session.revision)
  }, [open])

  function review() {
    if (!filter) {
      setFieldError(true)
      return
    }
    setPreview(previewFilterCorrection(session.id, filter))
    setStep("review")
  }

  function apply() {
    if (!filter) return
    const result = correctFilter(session.id, filter, base)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onOpenChange(false)
    if (result.newSessionId) navigate({ to: "/sessions/$sessionId", params: { sessionId: result.newSessionId } })
  }

  const label = sessionLabel(catalog, session)
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{step === "edit" ? "Correct the filter" : "Review the grouping revision"}</DialogTitle>
          <DialogDescription>
            {step === "edit"
              ? `A catalog correction for ${label}. The source files keep their FILTER keyword.`
              : "Nothing is changed until you apply the correction."}
          </DialogDescription>
        </DialogHeader>
        {step === "edit" ? (
          <div className="space-y-4 text-sm">
            <KeyValueList
              items={[
                { label: "Observed FILTER", value: catalog.assets[session.assetIds[0] ?? ""]?.observed.filter ?? "Missing", source: "Header" },
                { label: "Catalog channel now", value: session.channel ?? "No filter" },
              ]}
            />
            <div className="space-y-1.5">
              <Label id={labelId}>Corrected filter</Label>
              <Select
                items={options.map((o) => ({ value: o, label: o }))}
                value={filter}
                onValueChange={(value) => {
                  setFilter(value as string)
                  setFieldError(false)
                }}
              >
                <SelectTrigger aria-labelledby={labelId} aria-invalid={fieldError || undefined} aria-describedby={fieldError ? errorId : undefined} className="w-48">
                  <SelectValue placeholder="Choose a filter" />
                </SelectTrigger>
                <SelectContent>
                  {options.map((o) => (
                    <SelectItem key={o} value={o}>
                      {o}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {fieldError ? (
                <p id={errorId} role="alert" className="text-sm text-destructive">
                  Choose the corrected filter.
                </p>
              ) : null}
            </div>
          </div>
        ) : preview && filter ? (
          <div className="space-y-3 text-sm">
            <div>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">This will</h3>
              <ul className="list-disc space-y-0.5 pl-5">
                <li>
                  Create grouping revision {preview.revision}:{" "}
                  {preview.joins
                    ? `${plural(preview.frames, "frame")} join ${sessionLabel(catalog, preview.joins)} in one new session`
                    : `${plural(preview.frames, "frame")} move to a new ${formatNight(session.night)} · ${filter} · ${formatExposure(session.exposureS)} session`}
                </li>
                <li>Keep {label} inspectable as replaced; it stops counting in totals</li>
                <li>Record the correction: FILTER {preview.observedFilter ?? "missing"} → {filter}</li>
                {preview.projectNames.length > 0 ? <li>Link the new session in {preview.projectNames.join(", ")} instead of this one</li> : null}
              </ul>
            </div>
            <div>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">Unchanged</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                <li>Source files, their headers and SHA-256 hashes</li>
                <li>Frame identities and quality decisions</li>
                <li>{preview.viewNames.length > 0 ? `Membership of ${preview.viewNames.join(", ")}` : "View membership"}</li>
              </ul>
            </div>
            {error ? <ActionError message={error} /> : null}
          </div>
        ) : null}
        <DialogFooter>
          {step === "review" ? (
            <Button variant="outline" onClick={() => setStep("edit")}>
              Back
            </Button>
          ) : (
            <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          )}
          {step === "edit" ? <Button onClick={review}>Review correction</Button> : <Button onClick={apply}>{error ? "Retry" : "Apply correction"}</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Copies (LIB-AC-15, D16)
// ---------------------------------------------------------------------------

function CopiesSection({ sessionId }: { sessionId: string }) {
  const row = useStore((s) => sessionRow(s, s.catalog.sessions[sessionId]!))
  return (
    <Section
      id="copies"
      title="Copies"
      description={
        row.multiCopyFrames > 0
          ? `${plural(row.multiCopyFrames, "frame")} have byte-identical copies in more than one location. Each frame counts once; every copy stays registered and protected.`
          : "Where this session's frames are stored. Each frame counts once."
      }
    >
      <ul className="divide-y rounded-lg border">
        {row.locations.map(({ location, availability, frames }) => (
          <li key={location.id} className="flex flex-wrap items-start justify-between gap-3 px-3 py-2">
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{location.displayName}</span>
                <StatusBadge kind="role" value={location.role} />
                <StatusBadge kind="availability" value={availability} />
              </div>
              <PathText path={location.path} className="text-muted-foreground" />
            </div>
            <div className="text-right text-sm tabular-nums">
              <div>{plural(frames, "frame")}</div>
              <div className="text-xs text-muted-foreground">
                {location.lastIndexedAt ? `${availability === "offline" ? "Last observed" : "Indexed"} ${formatDateTime(location.lastIndexedAt)}` : "Never indexed"}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Frames and library quality (LIB-FR-09, LIB-AC-14)
// ---------------------------------------------------------------------------

type FrameFilter = "all" | FrameQuality | "unavailable"

const FRAME_FILTERS: Array<{ value: FrameFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "unreviewed", label: "Unreviewed" },
  { value: "usable", label: "Usable" },
  { value: "unusable", label: "Unusable" },
  { value: "changed-content", label: "Changed content" },
  { value: "verification-pending", label: "Verification pending" },
  { value: "unavailable", label: "Unavailable" },
]

interface FrameRow {
  asset: Asset
  quality: FrameQuality
  availability: AssetAvailability
}

const DECISION_WORD: Record<QualityValue, string> = { usable: "Usable", unusable: "Unusable", unreviewed: "Unreviewed" }

function FramesSection({ session, editable }: { session: Session; editable: boolean }) {
  const frames = useStore((s) =>
    session.assetIds
      .map((id) => s.catalog.assets[id])
      .filter((a): a is Asset => a !== undefined)
      .map((asset): FrameRow => ({ asset, quality: frameQuality(asset), availability: assetAvailability(s.disk, s.catalog, asset) })),
  )
  const catalog = useStore((s) => s.catalog)
  const [filter, setFilter] = useState<FrameFilter>("all")
  const [selected, setSelected] = useState<string[]>([])
  const counts = Object.fromEntries(FRAME_FILTERS.map((f) => [f.value, frames.filter((r) => matchesFrame(r, f.value)).length])) as Record<FrameFilter, number>
  const shown = frames.filter((r) => matchesFrame(r, filter))
  const unavailable = frames.filter((r) => r.availability !== "available").length
  const shownIds = new Set(shown.map((r) => r.asset.id))
  const hidden = selected.filter((id) => !shownIds.has(id)).length
  const target = session.target.value ? catalog.targets[session.target.value] : undefined
  const projects = projectsLinking(catalog, session.id)
  const changedSelected = selected.filter((id) => frames.find((r) => r.asset.id === id)?.quality === "changed-content").length

  const columns: Column<FrameRow>[] = [
    { id: "file", header: "File", rowHeader: true, truncate: true, sortValue: (r) => r.asset.fileName, cell: (r) => <span className="font-mono text-xs" title={r.asset.fileName}>{r.asset.fileName}</span> },
    { id: "time", header: "Captured", sortValue: (r) => r.asset.observed.dateObs, cell: (r) => formatTime(r.asset.observed.dateObs) },
    {
      id: "quality",
      header: "Library quality",
      sortValue: (r) => r.quality,
      cell: (r) => (
        <span className="inline-flex items-center gap-2">
          <StatusBadge kind="quality" value={r.quality} />
          {r.quality === "changed-content" ? (
            <span className="text-xs text-muted-foreground">
              was {DECISION_WORD[r.asset.quality.value]}
              {r.asset.quality.decidedAt ? ` on ${formatNight(r.asset.quality.decidedAt.slice(0, 10))}` : ""}; bytes now differ
            </span>
          ) : null}
          {r.quality === "verification-pending" ? <span className="text-xs text-muted-foreground">{DECISION_WORD[r.asset.quality.value]} once re-read</span> : null}
        </span>
      ),
    },
    {
      id: "availability",
      header: "Availability",
      sortValue: (r) => r.availability,
      cell: (r) =>
        r.availability === "available" ? <span className="text-muted-foreground">Available</span> : <StatusBadge kind="availability" value={r.availability} />,
    },
    { id: "copies", header: "Copies", align: "right", sortValue: (r) => r.asset.copies.length, cell: (r) => formatCount(r.asset.copies.length) },
    {
      id: "observed",
      header: "Last observed",
      sortValue: (r) => r.asset.copies.map((c) => c.lastObservedAt).sort().at(-1) ?? null,
      cell: (r) => formatDateTime(r.asset.copies.map((c) => c.lastObservedAt).sort().at(-1) ?? r.asset.observed.dateObs),
    },
  ]

  const affected = [target ? `usable totals for ${target.name}` : null, projects.length > 0 ? `progress of ${projects.map((p) => p.name).join(", ")}` : null].filter(Boolean)
  function qualityDialog(value: QualityValue, verb: string, confirmLabel: string) {
    return (
      <ConfirmDialog
        trigger={
          <Button size="sm" variant={value === "usable" ? "default" : "outline"}>
            {verb}
          </Button>
        }
        title={`${confirmLabel}?`}
        description="This is a library-scope quality decision. It is separate from excluding a frame from a View or rejecting it for a Project."
        changes={[
          `Set library quality to ${DECISION_WORD[value]} for ${plural(selected.length, "frame")}`,
          ...(changedSelected > 0 && value !== "unreviewed" ? [`Record the decision against the current bytes of ${plural(changedSelected, "frame")} with changed content`] : []),
          ...(affected.length > 0 ? [`Update ${affected.join(" and ")}`] : []),
        ]}
        unchanged={["Files on disk and their headers", "View membership and View exclusions", "Project rejections"]}
        confirmLabel={confirmLabel}
        onConfirm={() => {
          const result = setLibraryQuality(selected, value, `/sessions/${session.id}`)
          if (result.ok) setSelected([])
          return result
        }}
      />
    )
  }

  return (
    <Section id="frames" title="Frames" description="Library quality applies to every View and Project. Measurements never set it.">
      <ToggleGroup aria-label="Show frames" size="sm" variant="outline" spacing={0} value={[filter]} onValueChange={(value) => value[0] && setFilter(value[0] as FrameFilter)} className="flex-wrap">
        {FRAME_FILTERS.map((f) => (
          <ToggleGroupItem key={f.value} value={f.value} disabled={f.value !== "all" && counts[f.value] === 0 && filter !== f.value}>
            {f.label} <span className="text-muted-foreground tabular-nums">{formatCount(counts[f.value])}</span>
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
      {editable && unavailable > 0 ? (
        <p className="text-xs text-muted-foreground">
          {plural(unavailable, "frame")} cannot be selected for a quality decision: their bytes cannot be read right now, so they keep their last-observed
          quality.
        </p>
      ) : null}
      {editable ? (
        <SelectionBar
          count={selected.length}
          hiddenByFilters={hidden}
          noun="frame"
          onShowSelected={hidden > 0 ? () => setFilter("all") : undefined}
          onClear={() => setSelected([])}
          actions={
            <>
              {qualityDialog("unreviewed", "Reset to Unreviewed", `Reset ${plural(selected.length, "frame")} to Unreviewed`)}
              {qualityDialog("unusable", "Mark unusable", `Mark ${plural(selected.length, "frame")} unusable`)}
              {qualityDialog("usable", "Mark usable", `Mark ${plural(selected.length, "frame")} usable`)}
            </>
          }
        />
      ) : null}
      <DataTable
        label={`Frames in ${sessionLabel(catalog, session)}`}
        rows={shown}
        columns={columns}
        getRowId={(r) => r.asset.id}
        selection={
          editable
            ? { selected, onChange: setSelected, rowLabel: (r) => r.asset.fileName, isSelectable: (r) => r.availability === "available" }
            : undefined
        }
        initialSort={{ columnId: "time", direction: "asc" }}
        empty={
          <EmptyState
            icon={Layers}
            title="No frame matches this filter"
            description="Choose another quality state to see frames."
            action={
              <Button size="sm" variant="outline" onClick={() => setFilter("all")}>
                Show all frames
              </Button>
            }
          />
        }
      />
    </Section>
  )
}

function matchesFrame(row: FrameRow, filter: FrameFilter): boolean {
  if (filter === "all") return true
  if (filter === "unavailable") return row.availability !== "available"
  return row.quality === filter
}
