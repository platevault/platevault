/**
 * `/calibration` and `/calibration/$calibrationId` — the calibration library
 * (CAL-FR-01, CAL-FR-06, CAL-FR-07; flow H4; J26 S8-S9). List + detail: masters
 * and raw sets grouped by camera and settings, generated candidates apart with
 * Add to calibration library, and adoption with verified copy (D05).
 */
import { Link, useParams, useSearch } from "@tanstack/react-router"
import { FolderOpen, FolderSearch, RefreshCw } from "lucide-react"
import { useId, useMemo, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { EvidenceList, KeyValueList, PathText } from "@/components/app/data"
import { ActionError, EmptyState, Notice, UnknownValue } from "@/components/app/feedback"
import { FolderPicker } from "@/components/app/folder-picker"
import { OperationPanel } from "@/components/app/operation-panel"
import { ListDetail, PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { fileAt } from "@/domain/disk"
import type { CalibrationMaster, Catalog, Session } from "@/domain/types"
import { formatDateTime, formatExposure, formatNight, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { nowIso, store, updateSlice, useStore } from "@/store/core"
import { isSettled } from "@/store/operations"
import { createExternalFile, modifyFileExternally, restoreFileExternally, setFault } from "@/store/simulation"
import { calibrationLocationFor, detectCandidates, startAdoption, updateWorld } from "./actions"
import { KIND_LABEL, masterSource, rawSetSource, sameInput, trainName, type CalSource } from "./domain"
import { PrototypeControls, PrototypeToggle } from "./prototype-controls"

interface LibraryItem {
  id: string
  source: CalSource | null
  master: CalibrationMaster | null
  session: Session | null
  candidate: boolean
}

function libraryItems(catalog: Catalog): LibraryItem[] {
  const items: LibraryItem[] = []
  for (const master of Object.values(catalog.masters)) {
    const source = masterSource(catalog, master.id)
    items.push({ id: master.id, source, master, session: null, candidate: master.state === "candidate" })
  }
  for (const session of Object.values(catalog.sessions)) {
    if (session.supersededBy) continue
    const source = rawSetSource(catalog, session)
    if (source) items.push({ id: session.id, source, master: null, session, candidate: false })
  }
  return items
}

const KIND_ORDER = ["dark", "bias", "flat", "dark-flat"]

function itemLine(item: LibraryItem): string {
  const s = item.source
  if (!s) return ""
  const parts = [KIND_LABEL[s.kind]]
  if (s.kind === "dark" && s.exposureS !== null) parts.push(formatExposure(s.exposureS))
  if (s.kind === "flat") parts.push(s.channel ?? "no filter")
  parts.push(s.isMaster ? (item.candidate ? "generated master" : "master") : `raw set · ${plural(s.frameCount ?? 0, "frame")}`)
  return parts.join(" · ")
}

function LibraryList({ items, activeId }: { items: LibraryItem[]; activeId: string | null }) {
  const candidates = items.filter((i) => i.candidate)
  const reusable = items.filter((i) => !i.candidate && i.source)
  const groups = new Map<string, LibraryItem[]>()
  for (const item of reusable.sort((a, b) => KIND_ORDER.indexOf(a.source!.kind) - KIND_ORDER.indexOf(b.source!.kind) || (a.source!.night ?? "").localeCompare(b.source!.night ?? ""))) {
    const s = item.source!
    const key = [s.cameraName ?? "Camera unknown", s.widthPx && s.heightPx ? `${s.widthPx} × ${s.heightPx}` : "dimensions unknown", `bin ${s.binning}`, `gain ${s.gain ?? "?"} / offset ${s.offset ?? "?"}`].join(" · ")
    groups.set(key, [...(groups.get(key) ?? []), item])
  }
  const renderItem = (item: LibraryItem) => (
    <li key={item.id}>
      <Link
        to="/calibration/$calibrationId"
        params={{ calibrationId: item.id }}
        aria-current={item.id === activeId ? "page" : undefined}
        className={cn(
          "block rounded-md px-2 py-1.5 text-sm hover:bg-muted/60",
          item.id === activeId && "bg-primary/10 shadow-[inset_2px_0_0_var(--primary)]",
        )}
      >
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-medium">{item.source?.name}</span>
          {item.master ? <StatusBadge kind="master" value={item.master.state} /> : null}
        </span>
        <span className="block truncate text-xs text-muted-foreground">{itemLine(item)}</span>
      </Link>
    </li>
  )
  return (
    <div className="space-y-4 p-2">
      {candidates.length > 0 ? (
        <section aria-labelledby="lib-candidates">
          <h2 id="lib-candidates" className="px-2 pb-1 text-xs font-medium text-muted-foreground">
            Detected in output locations · not reusable until added
          </h2>
          <ul className="space-y-0.5">{candidates.map(renderItem)}</ul>
        </section>
      ) : null}
      {[...groups.entries()].map(([key, list]) => (
        <section key={key} aria-label={key}>
          <h2 className="px-2 pb-1 text-xs font-medium text-muted-foreground">{key}</h2>
          <ul className="space-y-0.5">{list.map(renderItem)}</ul>
        </section>
      ))}
    </div>
  )
}

function Usage({ catalog, source, viewId }: { catalog: Catalog; source: CalSource; viewId: string | undefined }) {
  const uses = Object.values(catalog.views).flatMap((view) =>
    view.calibration.filter((a) => a.input && sameInput(a.input, source.input)).map((a) => ({ view, assignment: a, session: catalog.sessions[a.lightSessionId] })),
  )
  return (
    <Section id="cal-usage" title="Used by Views" level={3}>
      {uses.length === 0 ? (
        <p className="text-sm text-muted-foreground">No View has accepted this input. Suggestions never count as use.</p>
      ) : (
        <ul className="divide-y rounded-md border text-sm">
          {uses.map(({ view, assignment, session }) => (
            <li key={assignment.id} className={cn("flex flex-wrap items-center justify-between gap-2 px-3 py-1.5", view.id === viewId && "bg-primary/8")}>
              <span>
                <Link to="/views/$viewId/calibration" params={{ viewId: view.id }} className="text-primary underline-offset-4 hover:underline">
                  {view.name}
                </Link>
                <span className="text-muted-foreground"> · {session ? `${formatNight(session.night)} ${session.channel ?? ""}` : "session"} lights</span>
              </span>
              <StatusBadge kind="assignment" value={assignment.state} />
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}

function Evidence({ catalog, item }: { catalog: Catalog; item: LibraryItem }) {
  const s = item.source!
  const missing: string[] = []
  if (!s.cameraName) missing.push("camera (INSTRUME absent)")
  if (s.gain === null) missing.push("gain")
  if (s.offset === null) missing.push("offset")
  if (s.kind === "flat" && !s.channel) missing.push("channel (FILTER absent)")
  if (s.kind === "flat" && !s.opticalTrainId) missing.push("optical train")
  return (
    <Section id="cal-evidence" title="Evidence" level={3} description="Recorded from the file headers. An exception in a View never changes this evidence.">
      <KeyValueList
        columns={2}
        items={[
          { label: "Type", value: s.imageTypeLabel, source: "IMAGETYP" },
          { label: "Camera", value: s.cameraName ?? <UnknownValue label="Not recorded" />, source: "INSTRUME" },
          { label: "Dimensions", value: s.widthPx && s.heightPx ? `${s.widthPx} × ${s.heightPx}` : <UnknownValue />, source: "NAXIS1, NAXIS2" },
          { label: "Binning", value: `${s.binning}×${s.binning}`, source: "XBINNING" },
          { label: "Gain / offset", value: `${s.gain ?? "unknown"} / ${s.offset ?? "unknown"}`, source: "GAIN, OFFSET" },
          ...(s.kind === "dark" ? [{ label: "Exposure", value: s.exposureS === null ? <UnknownValue /> : formatExposure(s.exposureS), source: "EXPTIME" }] : []),
          ...(s.kind === "flat"
            ? [
                { label: "Channel", value: s.channel ?? <UnknownValue label="Not recorded" />, source: "FILTER" },
                {
                  label: "Optical train",
                  value: trainName(catalog, s.opticalTrainId) ?? <UnknownValue reason="No telescope or focal-length evidence in these files, and no confirmed equipment." />,
                  source: item.session ? "Equipment association" : "Header TELESCOP",
                },
              ]
            : []),
          { label: "Temperature", value: s.ccdTempC === null ? <UnknownValue label="Not recorded" /> : `${s.ccdTempC.toFixed(1)} °C${item.session ? " (median)" : ""}`, source: "CCD-TEMP · shown, never compared" },
          { label: item.session ? "Night" : "Created", value: s.night ? formatNight(s.night, true) : <UnknownValue /> },
          { label: item.session ? "Folder" : "File", value: <PathText path={s.path} /> },
        ]}
      />
      {missing.length > 0 ? <p className="text-xs text-warning">Missing evidence: {missing.join(", ")}. Matches that need it read Unknown, never compatible.</p> : null}
      {item.session && item.session.equipment.evidence.length > 0 ? (
        <div className="space-y-1">
          <h4 className="text-xs font-medium text-muted-foreground">Equipment evidence</h4>
          <EvidenceList evidence={item.session.equipment.evidence} caption={`Equipment evidence for ${s.name}`} />
        </div>
      ) : null}
    </Section>
  )
}

function Adoption({ master }: { master: CalibrationMaster }) {
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const draft = useStore((s) => s.slices.t4.adoption[master.id])
  const world = useStore((s) => s.slices.t4.world)
  const failNext = useStore((s) => s.faults.failNextHashVerification)
  const op = useStore((s) => (draft?.operationId ? s.operations[draft.operationId] : undefined))
  const [picker, setPicker] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const nameId = useId()
  const source = fileAt(disk, master.origin.sourcePath)
  const calibrationLocations = Object.values(catalog.locations).filter((l) => l.role === "calibration")
  const sourceName = master.origin.sourcePath.slice(master.origin.sourcePath.lastIndexOf("/") + 1)
  const folder = draft?.destinationFolder ?? null
  const fileName = draft?.fileName ?? sourceName
  const destination = folder && fileName.trim() ? `${folder}/${fileName.trim()}` : null
  const existing = destination ? fileAt(disk, destination) : undefined
  const location = folder ? calibrationLocationFor(catalog.locations, folder) : null
  const reviewed = Boolean(draft?.reviewedSha256)
  const drifted = reviewed && source && source.sha256 !== draft?.reviewedSha256
  const running = op && !isSettled(op.status)

  function patch(next: Partial<NonNullable<typeof draft>>) {
    updateSlice("t4", (slice) => ({
      ...slice,
      adoption: { ...slice.adoption, [master.id]: { destinationFolder: null, fileName: sourceName, reviewedSha256: null, reviewedAt: null, operationId: null, ...slice.adoption[master.id], ...next } },
    }))
  }

  function review() {
    const current = fileAt(store.getState().disk, master.origin.sourcePath)
    if (!current) return setError(`The candidate is no longer at ${master.origin.sourcePath}. Nothing can be adopted.`)
    setError(null)
    patch({ reviewedSha256: current.sha256, reviewedAt: nowIso(), operationId: null })
  }

  const problems: string[] = []
  if (!folder) problems.push("Choose a destination folder.")
  else if (!location) problems.push("Choose a folder inside a Calibration location, so the master stays in the library and is never disposable with its processing folder.")
  if (!fileName.trim()) problems.push("Enter a file name.")
  if (existing && destination) problems.push(`${destination} already exists (SHA-256 ${existing.sha256.slice(0, 12)}…). Choose another name or folder; the existing file is never overwritten.`)
  if (!source) problems.push(`The candidate is no longer at ${master.origin.sourcePath}.`)
  if (drifted) problems.push("The candidate's bytes changed since you reviewed it (SHA-256 differs). Review it again.")

  return (
    <Section id="cal-adopt" title="Add to calibration library" level={3} description="Adoption copies the master into a Calibration location, re-reads and verifies it, revalidates the source, and only then registers it. The generated source stays where it is.">
      <div className="space-y-3 rounded-lg border bg-card p-4">
        <div className="grid gap-x-4 gap-y-1 text-sm lg:grid-cols-[10rem_minmax(0,1fr)_auto] lg:items-center">
          <span className="text-muted-foreground">Destination folder</span>
          <span className="min-w-0">{folder ? <PathText path={folder} /> : <UnknownValue label="Not set" />}</span>
          <Button size="sm" variant="outline" disabled={Boolean(running)} onClick={() => setPicker(true)}>
            <FolderOpen aria-hidden="true" data-icon="inline-start" />
            Choose folder…
          </Button>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor={nameId}>File name</Label>
          <Input id={nameId} className="max-w-md font-mono text-xs" value={fileName} disabled={Boolean(running)} aria-invalid={existing ? true : undefined} aria-describedby={`${nameId}-hint`} onChange={(event) => patch({ fileName: event.target.value })} />
          <p id={`${nameId}-hint`} className="text-xs text-muted-foreground">
            {destination ? <>Destination: <span className="font-mono">{destination}</span></> : "The master is copied under this name."}
          </p>
        </div>
        <div className="space-y-1 border-t pt-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground">Reviewed identity</span>
            <Button size="sm" variant="outline" disabled={Boolean(running)} onClick={review}>
              {reviewed ? "Review again" : "Review adoption"}
            </Button>
          </div>
          {reviewed && draft ? (
            <p className="font-mono text-xs [overflow-wrap:anywhere]">
              SHA-256 {draft.reviewedSha256} · reviewed {formatDateTime(draft.reviewedAt!)}
            </p>
          ) : (
            <p className="text-xs text-muted-foreground">Review records the candidate's current SHA-256; the copy, its re-read and the source must all match it.</p>
          )}
        </div>
        {problems.length > 0 && (reviewed || existing) ? (
          <Notice tone="refusal" title="Adoption is blocked">
            <ul className="list-disc space-y-0.5 pl-4">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!reviewed || problems.length > 0 || Boolean(running)} aria-describedby="adopt-reason" onClick={() => setConfirm(true)}>
            Adopt master
          </Button>
          <span id="adopt-reason" className="text-xs text-muted-foreground">
            {!reviewed ? "Review the adoption first." : problems.length > 0 ? "Resolve the blocked items above." : running ? "Adoption is running." : "Ready to adopt."}
          </span>
        </div>
        {error ? <ActionError message={error} /> : null}
      </div>
      {op ? <OperationPanel operationId={op.id} /> : null}
      <FolderPicker
        open={picker}
        onOpenChange={setPicker}
        title="Choose a calibration-library folder"
        description="Prototype folder chooser. Choose a folder inside a Calibration location; nothing is copied until you confirm."
        initialPath={folder ?? (calibrationLocations[0] ? `${calibrationLocations[0].path}/Masters` : null)}
        onChoose={(path) => patch({ destinationFolder: path })}
      />
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Adopt ${sourceName}?`}
        description="The master becomes reusable only after its copy and its source still match the reviewed digest."
        changes={[`Copy the master to ${destination}`, "Re-read and hash-verify the copy, then revalidate the source", `Register it in Calibration with origin ${master.origin.viewId ? (catalog.views[master.origin.viewId]?.name ?? "its View") : "a processing output"}`]}
        unchanged={[`The generated source at ${master.origin.sourcePath}`, "Any existing file at the destination: a collision refuses adoption", "Views: the master is only suggested where compatible, never accepted for you"]}
        confirmLabel="Adopt master"
        onConfirm={() => {
          const result = startAdoption(master.id)
          if (!result.ok) return { ok: false, reason: "write-failed", message: result.message }
        }}
      />
      <PrototypeControls title="outside changes for adoption">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" disabled={!destination || Boolean(existing)} onClick={() => destination && createExternalFile(destination)}>
            Create an unrelated file at the destination
          </Button>
          <Button size="sm" variant="outline" disabled={!source} onClick={() => modifyFileExternally(master.origin.sourcePath)}>
            Overwrite the candidate with same-size different bytes
          </Button>
          <Button size="sm" variant="outline" disabled={!source?.previousSha256} onClick={() => restoreFileExternally(master.origin.sourcePath)}>
            Restore the candidate's original bytes
          </Button>
        </div>
        <PrototypeToggle
          label="Pause the next adoption after the copy verifies"
          detail="J26 P6: before registration. Resume it from the operation panel."
          checked={world.pauseBeforeRegister}
          onChange={(value) => updateWorld((w) => ({ ...w, pauseBeforeRegister: value }))}
        />
        <PrototypeToggle label="Fail the next hash verification" checked={failNext} onChange={(value) => setFault("failNextHashVerification", value)} />
      </PrototypeControls>
    </Section>
  )
}

function Detail({ item, viewId }: { item: LibraryItem; viewId: string | undefined }) {
  const catalog = useStore((s) => s.catalog)
  const s = item.source!
  const origin = item.master?.origin
  const originView = origin?.viewId ? catalog.views[origin.viewId] : undefined
  return (
    <div className="flex min-h-0 flex-col">
      <PageHeader
        level={2}
        title={s.name}
        eyebrow={<Link to="/calibration" className="hover:underline">Calibration</Link>}
        description={itemLine(item)}
        meta={item.master ? <StatusBadge kind="master" value={item.master.state} /> : <StatusBadge kind="custody" value="protected" label="Raw set" />}
        actions={
          item.session ? (
            <Button variant="outline" render={<Link to="/sessions/$sessionId" params={{ sessionId: item.session.id }} />}>
              Inspect frames
            </Button>
          ) : undefined
        }
      />
      <PageBody>
        {item.candidate ? (
          <Notice tone="info" title="Detected candidate">
            Found in a recorded output location. It is not reusable and no View preselects it until you add it to the calibration library.
          </Notice>
        ) : null}
        <Evidence catalog={catalog} item={item} />
        <Section id="cal-origin" title="Origin and provenance" level={3}>
          <KeyValueList
            items={[
              {
                label: "Origin",
                value: item.session
                  ? "Raw calibration frames indexed from a location"
                  : origin?.kind === "generated"
                    ? <>Generated by processing in {originView ? <Link to="/views/$viewId/prepare" params={{ viewId: originView.id }} className="text-primary underline-offset-4 hover:underline">{originView.name}</Link> : "a View"}</>
                    : "Indexed from a Calibration location (library master)",
              },
              ...(origin?.kind === "generated" ? [{ label: "Generated source", value: <PathText path={origin.sourcePath} /> }] : []),
              ...(item.master?.adoption
                ? [
                    { label: "Library copy", value: <PathText path={item.master.adoption.destinationPath} /> },
                    { label: "Verified SHA-256", value: item.master.adoption.verifiedSha256, mono: true },
                    { label: "Adopted", value: formatDateTime(item.master.adoption.adoptedAt) },
                  ]
                : []),
              { label: "Custody", value: "Protected by default during cleanup" },
              ...(item.session ? [{ label: "Handoff", value: "Raw set: handed to the application, which builds its own master. PlateVault writes no master file." }] : []),
            ]}
          />
        </Section>
        {item.master?.state === "candidate" ? <Adoption master={item.master} /> : null}
        <Usage catalog={catalog} source={s} viewId={viewId} />
      </PageBody>
    </div>
  )
}

export function CalibrationLibraryPage() {
  const params = useParams({ strict: false }) as { calibrationId?: string }
  const search = useSearch({ strict: false }) as { viewId?: string }
  const catalog = useStore((s) => s.catalog)
  const [announcement, setAnnouncement] = useState("")
  const items = useMemo(() => libraryItems(catalog), [catalog])
  const activeId = params.calibrationId ?? null
  const active = items.find((i) => i.id === activeId) ?? null
  const denied = Object.values(catalog.locations).filter((l) => l.role === "calibration" && l.access === "denied")
  const hasCalibrationLocation = Object.values(catalog.locations).some((l) => l.role === "calibration")

  function check() {
    let found = 0
    store.setState((s) => {
      const result = detectCandidates(s)
      found = result.found
      return result.state
    })
    setAnnouncement(found === 0 ? "No new candidates in recorded output locations." : `${plural(found, "new candidate")} detected.`)
  }

  const header = (
    <PageHeader
      title="Calibration"
      description="Masters and raw calibration sets from indexed locations, grouped by camera and settings, with their compatibility evidence."
      actions={
        <Button variant="outline" onClick={check}>
          <RefreshCw aria-hidden="true" data-icon="inline-start" />
          Check output locations
        </Button>
      }
    />
  )

  if (items.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        {header}
        <PageBody>
          <p className="sr-only" aria-live="polite">{announcement}</p>
          <EmptyState
            icon={FolderSearch}
            titleAs="h2"
            title="No calibration frames indexed yet"
            description={hasCalibrationLocation ? "Index your Calibration location to list its masters and raw sets." : "Add a Calibration location to list masters and raw sets."}
            action={<Button render={<Link to="/settings/locations" />}>{hasCalibrationLocation ? "Open Locations" : "Add a calibration location"}</Button>}
          />
        </PageBody>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {header}
      <p className="sr-only" aria-live="polite">{announcement}</p>
      {denied.length > 0 ? (
        <div className="px-6 pt-4">
          <Notice tone="warning" title={`${denied.map((l) => l.displayName).join(", ")}: access denied`} actions={<Button size="sm" variant="outline" render={<Link to="/settings/locations" />}>Open Locations</Button>}>
            Calibration frames in that location were not read at the last scan. They are not missing; their evidence is unknown until access is restored.
          </Notice>
        </div>
      ) : null}
      <ListDetail
        listLabel="Calibration masters and raw sets"
        list={<LibraryList items={items} activeId={activeId} />}
        detail={
          active?.source ? (
            <Detail item={active} viewId={search.viewId} />
          ) : activeId ? (
            <PageBody>
              <EmptyState icon={FolderSearch} titleAs="h2" title="This calibration item does not exist" description="It may have been removed, or the link is from another library." action={<Button render={<Link to="/calibration" />}>Show the calibration library</Button>} />
            </PageBody>
          ) : (
            <PageBody>
              <p className="text-sm text-muted-foreground">Choose a master or raw set to see its evidence, origin and the Views that use it.</p>
              <p className="text-sm text-muted-foreground">
                {plural(items.filter((i) => i.master && !i.candidate).length, "library master")} · {plural(items.filter((i) => i.session).length, "raw set")} · {plural(items.filter((i) => i.candidate).length, "detected candidate")}
              </p>
            </PageBody>
          )
        }
      />
    </div>
  )
}
