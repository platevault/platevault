/**
 * Sessions in this View (`/views/$viewId/sessions`, product flow C1-C6):
 * geometry suggestions with evidence, manual inclusion, filters that never
 * change the selection, the linked sky coverage, and unavailable sources that
 * are named and removed only explicitly.
 */
import { Link } from "@tanstack/react-router"
import { Inbox, Telescope } from "lucide-react"
import { useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { FilterChips, KeyValueList, PathText } from "@/components/app/data"
import { type Column, DataTable, SelectionBar, TableToolbar } from "@/components/app/data-table"
import { EmptyState, Notice, UnknownValue } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { STATUS, StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { assetAvailability, measurementApplies, sessionBreakdown, sessionLocationIds } from "@/domain/derive"
import type { Catalog, Disk, SelectionReason, Session } from "@/domain/types"
import { formatDec, formatDegrees, formatDuration, formatExposure, formatNight, formatRa, formatTime, plural } from "@/lib/format"
import { useStore } from "@/store/core"
import { defaultSessionFilters } from "@/store/slices/t3"
import { setActiveSession, setSessionFilters, setSky } from "./actions"
import {
  addSessions,
  candidateSessions,
  NEAR_RADIUS_DEG,
  REASON_LABEL,
  removeSessions,
  resolveAvailable,
  type SessionAvailability,
  sessionAvailability,
  type SessionGeometry,
  sessionGeometry,
  sessionExposureS,
  sessionLabel,
  type Suggestion,
  suggestionFor,
  trainName,
  type ViewContext,
} from "./model"
import { type FilterableRow, filterChips, FiltersPopover, matchesFilters } from "./session-filters"
import { SkyCoverage } from "./sky-coverage"
import { formatMetric } from "./measure"
import { useDraftEditor, useWorkspace } from "./workspace"

interface CandidateRow extends FilterableRow {
  geometry: SessionGeometry
  suggestion: Suggestion
  avail: SessionAvailability
  reason: SelectionReason | null
  fwhm: { median: number; unit: string; measured: number } | null
}

function medianFwhm(catalog: Catalog, session: Session): CandidateRow["fwhm"] {
  const values: number[] = []
  let unit = ""
  for (const id of session.assetIds) {
    const asset = catalog.assets[id]
    const record = catalog.measurements[id]
    if (!asset || !record || !measurementApplies(asset, record)) continue
    const metric = record.metrics.find((m) => m.key === "fwhm" && m.source === "built-in" && m.value !== null)
    if (!metric) continue
    values.push(metric.value!)
    unit = metric.unit
  }
  if (values.length === 0) return null
  values.sort((a, b) => a - b)
  return { median: values[Math.floor(values.length / 2)]!, unit, measured: values.length }
}

function buildRows(disk: Disk, catalog: Catalog, sessions: Session[], ctx: ViewContext, reasons: Map<string, SelectionReason>): CandidateRow[] {
  return sessions.map((session) => {
    const geometry = sessionGeometry(catalog, session, ctx.regions)
    const avail = sessionAvailability(disk, catalog, session)
    return {
      session,
      trainId: session.equipment.value,
      trainName: trainName(catalog, session),
      locationIds: sessionLocationIds(catalog, session),
      availability: avail.state,
      breakdown: sessionBreakdown(disk, catalog, session),
      geometry,
      suggestion: suggestionFor(catalog, session, geometry, ctx),
      avail,
      reason: reasons.get(session.id) ?? null,
      fwhm: medianFwhm(catalog, session),
    }
  })
}

/** Reason recorded when the user checks a row: geometry evidence when it qualifies, otherwise a manual inclusion. */
function reasonForCheck(row: CandidateRow, via: string): SelectionReason {
  if (row.suggestion.kind === "geometry") return { kind: "geometry", detail: `Checked ${via}. ${row.suggestion.detail}` }
  return { kind: "manual", detail: `Checked ${via}: ${row.suggestion.label}. ${row.suggestion.detail}` }
}

function QualityCounts({ row }: { row: CandidateRow }) {
  const b = row.breakdown
  const parts = [
    b.usable.frames > 0 ? `${b.usable.frames} Usable` : null,
    b.unreviewed.frames > 0 ? `${b.unreviewed.frames} Unreviewed` : null,
    b.unusable.frames > 0 ? `${b.unusable.frames} Unusable` : null,
    b.changedContent.frames > 0 ? `${b.changedContent.frames} Changed content` : null,
    b.verificationPending.frames > 0 ? `${b.verificationPending.frames} Verification pending` : null,
  ].filter(Boolean)
  return <span>{parts.join(", ")}</span>
}

function AvailabilityCell({ row }: { row: CandidateRow }) {
  const { state, unavailable, total } = row.avail
  if (state === "available") return <StatusBadge kind="availability" value="available" />
  const label = { offline: "Offline", unreadable: "Unreadable", absent: "Not found", retired: "Retired" }[state]
  return <StatusBadge kind="availability" value={state} label={unavailable === total ? label : `${label} ${unavailable} of ${total}`} />
}

function FootprintCell({ row }: { row: CandidateRow }) {
  const g = row.geometry
  if (g.kind === "position-unknown") return <UnknownValue label="Position unknown" reason="No RA/DEC in the headers; OBJECT never stands in for coordinates." />
  if (g.kind === "pointing-only") return <UnknownValue label="Pointing only" reason={g.fov ? "No orientation (ROTATANG), so no footprint." : "No orientation and no confirmed equipment, so no footprint."} />
  if (g.coverage === null) return <UnknownValue label="No framing" />
  return <span>Covers {Math.round(g.coverage * 100)}%</span>
}

export function SessionsArea() {
  const { view, content, ctx, summary, readOnlyReason } = useWorkspace()
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const filters = useStore((s) => s.slices.t3.sessionFilters[view.id]) ?? defaultSessionFilters()
  const activeId = useStore((s) => s.slices.t3.activeSession[view.id] ?? null)
  const skyOn = useStore((s) => s.slices.t3.sky[view.id] ?? false)
  const { edit, errorNode } = useDraftEditor(view.id)
  const [clearOpen, setClearOpen] = useState(false)

  const selectedIds = content.sessions.map((s) => s.sessionId)
  const reasons = new Map(content.sessions.map((s) => [s.sessionId, s.reason]))
  const candidates = candidateSessions(catalog, view, ctx, selectedIds, filters.scope)
  const rows = buildRows(disk, catalog, candidates, ctx, reasons)
  const shown = rows.filter((row) => (filters.selectedOnly ? selectedIds.includes(row.session.id) : true) && matchesFilters(row, filters))
  const hiddenSelected = selectedIds.filter((id) => !shown.some((row) => row.session.id === id)).length
  const names = {
    trainName: (id: string) => catalog.opticalTrains[id]?.name ?? "Unknown equipment",
    locationName: (id: string) => catalog.locations[id]?.displayName ?? "Unknown location",
    targetName: (id: string) => catalog.targets[id]?.name ?? "Unknown Target",
  }
  const chips = filterChips(filters, names)
  const active = rows.find((r) => r.session.id === activeId) ?? shown.find((r) => r.reason) ?? shown[0] ?? null
  const editable = readOnlyReason === null
  const matchReason = !editable ? readOnlyReason : chips.length === 0 ? "Set a filter first" : shown.every((r) => r.reason) ? "Every match is selected" : null
  // Notices and the Selection bar unmount after these actions: keep focus in the session table (WCAG 2.4.3).
  const focusTable = () => requestAnimationFrame(() => document.querySelector<HTMLElement>("#t3-sessions-table thead [role=checkbox]")?.focus())
  const readableAgain = content.unresolved.filter((id) => {
    const asset = catalog.assets[id]
    return asset ? assetAvailability(disk, catalog, asset) === "available" : false
  }).length

  function changeSelection(next: string[], via: string) {
    const added = rows.filter((r) => next.includes(r.session.id) && !selectedIds.includes(r.session.id))
    const removed = selectedIds.filter((id) => !next.includes(id))
    const label = added.length > 0 ? `Add ${plural(added.length, "session")} to the View` : `Remove ${plural(removed.length, "session")} from the View`
    edit(label, (current, state) => {
      let updated = removed.length > 0 ? removeSessions(current, state.catalog, removed) : current
      if (added.length > 0) updated = addSessions(updated, state.disk, state.catalog, added.map((row) => ({ session: row.session, reason: reasonForCheck(row, via) })))
      return updated
    })
  }

  const columns: Column<CandidateRow>[] = [
    {
      id: "session",
      header: "Session",
      rowHeader: true,
      sortValue: (r) => r.session.night,
      cell: (r) => (
        <button
          type="button"
          id={`session-${r.session.id}`}
          className="rounded-sm font-medium hover:underline"
          aria-label={`${formatNight(r.session.night)} ${r.session.channel ?? "no filter"}: show evidence`}
          onClick={() => setActiveSession(view.id, r.session.id)}
        >
          {formatNight(r.session.night)}
        </button>
      ),
    },
    {
      id: "reason",
      header: "Reason",
      sortValue: (r) => (r.reason ? REASON_LABEL[r.reason.kind] : `~${r.suggestion.label}`),
      cell: (r) =>
        r.reason ? (
          <span className="font-medium">{REASON_LABEL[r.reason.kind]}</span>
        ) : (
          <span className="text-muted-foreground">Not selected · {r.suggestion.label}</span>
        ),
    },
    { id: "start", header: "Start (UTC)", sortValue: (r) => r.session.startedAt, cell: (r) => formatTime(r.session.startedAt, "UTC") },
    { id: "channel", header: "Channel", sortValue: (r) => r.session.channel, cell: (r) => r.session.channel ?? <UnknownValue label="No filter" /> },
    { id: "exposure", header: "Exposure", align: "right", sortValue: (r) => sessionExposureS(r.session), cell: (r) => formatExposure(sessionExposureS(r.session)) },
    {
      id: "equipment",
      header: "Camera / optical train",
      sortValue: (r) => r.trainName,
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5">
          <span className="max-w-44 truncate" title={r.trainName ?? r.session.cameraName ?? undefined}>
            {r.trainName ?? r.session.cameraName ?? "Unknown"}
          </span>
          <StatusBadge kind="association" value={r.session.equipment.status} />
        </span>
      ),
    },
    {
      id: "frames",
      header: "Frames",
      align: "right",
      sortValue: (r) => r.session.assetIds.length,
      cell: (r) => (r.avail.state === "available" ? r.session.assetIds.length : <span title="Last observed; not verified">{r.session.assetIds.length} unverified</span>),
    },
    { id: "integration", header: "Integration", align: "right", sortValue: (r) => r.breakdown.captured.seconds, cell: (r) => formatDuration(r.breakdown.captured.seconds) },
    { id: "availability", header: "Availability", sortValue: (r) => r.avail.unavailable, cell: (r) => <AvailabilityCell row={r} /> },
    {
      id: "distance",
      header: "Sky distance",
      align: "right",
      sortValue: (r) => r.geometry.distanceDeg,
      cell: (r) =>
        r.geometry.distanceDeg !== null ? (
          formatDegrees(r.geometry.distanceDeg, 2)
        ) : ctx.regions.length === 0 && r.session.pointing ? (
          <UnknownValue label="No framing" reason="This View has no Project or Target framing to measure a distance from." />
        ) : (
          <UnknownValue label="Position unknown" />
        ),
    },
    { id: "footprint", header: "Footprint", sortValue: (r) => r.geometry.coverage, cell: (r) => <FootprintCell row={r} /> },
    { id: "quality", header: "Frames by quality", cell: (r) => <QualityCounts row={r} /> },
    {
      id: "fwhm",
      header: "FWHM (median)",
      align: "right",
      sortValue: (r) => r.fwhm?.median ?? null,
      cell: (r) => (r.fwhm ? formatMetric({ value: Number(r.fwhm.median.toFixed(2)), unit: r.fwhm.unit }) : <UnknownValue label="Not measured" />),
    },
  ]

  const skyItems = rows.map((r) => ({
    id: r.session.id,
    label: sessionLabel(r.session),
    footprint: r.geometry.footprint,
    pointing: r.session.pointing,
    selected: r.reason !== null,
  }))

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        level={2}
        title="Sessions in this View"
        description="Check sessions to include their available frames. Filters change the list, never the selection."
        actions={
          <div className="flex items-center gap-2">
            <Switch id={`${view.id}-sky`} checked={skyOn} onCheckedChange={(on) => setSky(view.id, on)} />
            <Label htmlFor={`${view.id}-sky`}>Sky coverage</Label>
          </div>
        }
      />
      <PageBody className="space-y-4">
        {readOnlyReason ? <p className="text-sm text-muted-foreground">{readOnlyReason}</p> : null}
        {summary.unavailableSessions.map(({ session, members, state, locationId }) => {
          // The location holding the copies in this state, so "on Archive" names where they are, not the first-seen copy.
          const location = locationId ? catalog.locations[locationId] : undefined
          const retired = state === "retired"
          return (
            <Notice
              key={session.id}
              tone={state === "offline" ? "offline" : retired ? "info" : "warning"}
              title={`${sessionLabel(session)} is ${STATUS.availability[state].label.toLowerCase()}`}
              actions={
                <>
                  {location ? (
                    <Button size="sm" variant="outline" render={<Link to="/settings/locations" search={{ locationId: location.id }} />}>
                      {retired ? "Open Locations" : "Locate a copy"}
                    </Button>
                  ) : null}
                  {retired ? null : (
                    <Button size="sm" variant="outline" render={<Link to="/storage" />}>
                      Open Storage
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={!editable}
                    onClick={() => {
                      if (edit(`Remove ${sessionLabel(session)} from the View`, (current, state) => removeSessions(current, state.catalog, [session.id])).ok) focusTable()
                    }}
                  >
                    Remove from draft
                  </Button>
                </>
              }
            >
              {retired ? (
                <>
                  {plural(members, "selected frame")} are in the retired location {location?.displayName ?? "that was retired"}. They stay named as unresolved members and
                  Retired, never inputs, and no longer count in captured totals. A retired location is never reselected: add its folder again to index it as a new location, or
                  remove the session explicitly.
                </>
              ) : (
                <>
                  {plural(members, "selected frame")} {state === "offline" ? `on ${location?.displayName ?? "an offline location"}` : ""} cannot be read now. They stay named as
                  unresolved members, never verified inputs: {session.assetIds.length} frames and {formatDuration(session.assetIds.length * sessionExposureS(session))} are
                  last-observed counts. Reconnect, locate a copy, or remove the session explicitly.
                </>
              )}
            </Notice>
          )
        })}
        {readableAgain > 0 ? (
          <Notice
            tone="info"
            title={`${plural(readableAgain, "unresolved frame")} can be read again`}
            actions={
              <Button
                size="sm"
                variant="outline"
                disabled={!editable}
                onClick={() => {
                  if (edit("Include readable frames", (current, state) => resolveAvailable(state.disk, state.catalog, current)).ok) focusTable()
                }}
              >
                Include {plural(readableAgain, "readable frame")}
              </Button>
            }
          >
            Their copies are available now. They join the View only when you include them.
          </Notice>
        ) : null}

        <SelectionBar
          count={selectedIds.length}
          hiddenByFilters={hiddenSelected}
          noun="session"
          onShowSelected={() => setSessionFilters(view.id, { ...defaultSessionFilters(), scope: filters.scope, selectedOnly: true })}
          // Read-only Views refuse beside the bar instead of opening a confirmation they would then refuse (D09).
          onClear={() => (editable ? setClearOpen(true) : edit("Clear selection", (current) => current))}
        />
        {errorNode}
        <TableToolbar
          search={{ label: "Filter by OBJECT", placeholder: "OBJECT contains…", value: filters.object, onChange: (object) => setSessionFilters(view.id, { object }) }}
          filters={<FiltersPopover rows={rows} filters={filters} onChange={(patch) => setSessionFilters(view.id, patch)} names={names} activeCount={chips.length} />}
          actions={
            <>
              {ctx.regions.length > 0 ? (
                <Button size="sm" variant="ghost" onClick={() => setSessionFilters(view.id, { scope: filters.scope === "near" ? "all" : "near" })}>
                  {filters.scope === "near" ? "Show all light sessions" : `Show sessions near ${ctx.targetName ?? "the framing"}`}
                </Button>
              ) : null}
              <span className="inline-flex items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={matchReason !== null}
                  focusableWhenDisabled
                  aria-describedby={matchReason ? `${view.id}-match-reason` : undefined}
                  className="aria-disabled:pointer-events-none aria-disabled:opacity-50"
                  onClick={() => changeSelection([...new Set([...selectedIds, ...shown.map((r) => r.session.id)])], "with Select matching")}
                >
                  Select matching ({shown.filter((r) => !r.reason).length})
                </Button>
                {matchReason ? (
                  <span id={`${view.id}-match-reason`} className="text-xs text-muted-foreground">
                    {matchReason}
                  </span>
                ) : null}
              </span>
            </>
          }
        />
        <p className="text-xs text-muted-foreground">
          {filters.scope === "near" && ctx.regions.length > 0
            ? `Listing sessions within ${NEAR_RADIUS_DEG}° of ${ctx.regions.map((r) => r.name).join(", ")}, sessions associated with ${ctx.targetName ?? "the Target"}, sessions with Position unknown, and every selected session.`
            : "Listing every light session in the library."}{" "}
          Preselection needs a footprint covering at least 50% of the framing and confirmed Project equipment; OBJECT is a label, never evidence.
        </p>
        <FilterChips
          chips={chips}
          matchLabel={plural(shown.length, "matching session")}
          onRemove={(id) => setSessionFilters(view.id, chips.find((c) => c.id === id)?.clear ?? {})}
          onClear={() => setSessionFilters(view.id, { ...defaultSessionFilters(), scope: filters.scope })}
        />
        <div id="t3-sessions-table">
        <DataTable
          label="Candidate sessions"
          rows={shown}
          columns={columns}
          getRowId={(r) => r.session.id}
          initialSort={{ columnId: "distance", direction: "asc" }}
          activeRowId={active?.session.id ?? null}
          scroll="frame"
          className="max-h-[28rem]"
          selection={{
            selected: selectedIds,
            onChange: (next) => changeSelection(next, "by hand"),
            rowLabel: (r) => `${sessionLabel(r.session)} session`,
            isSelectable: () => editable,
          }}
          empty={
            rows.length === 0 ? (
              <EmptyState
                icon={Telescope}
                title={`No light sessions near ${ctx.targetName ?? "this Target"} yet`}
                description="Index captures, or list every light session in the library."
                action={
                  <Button size="sm" variant="outline" onClick={() => setSessionFilters(view.id, { scope: "all" })}>
                    Show all light sessions
                  </Button>
                }
                className="border-0"
              />
            ) : (
              <EmptyState
                icon={Inbox}
                title="No sessions match these filters"
                description="Filters change the list, not the selection."
                action={
                  <Button size="sm" variant="outline" onClick={() => setSessionFilters(view.id, { ...defaultSessionFilters(), scope: filters.scope })}>
                    Clear filters
                  </Button>
                }
                className="border-0"
              />
            )
          }
        />
        </div>

        <div className={skyOn ? "grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]" : ""}>
          {active ? <SessionEvidence row={active} ctx={ctx} editable={editable} onToggle={(include) => changeSelection(include ? [...selectedIds, active.session.id] : selectedIds.filter((id) => id !== active.session.id), "from its evidence")} /> : null}
          {skyOn ? (
            <Section title="Sky coverage" level={3} description="Click a footprint to open its session. The table above stays the full list.">
              <SkyCoverage
                regions={ctx.regions}
                items={skyItems}
                activeId={active?.session.id ?? null}
                unknown={rows.filter((r) => r.geometry.kind === "position-unknown").map((r) => sessionLabel(r.session))}
                onActivate={(id) => {
                  setActiveSession(view.id, id)
                  document.getElementById(`session-${id}`)?.scrollIntoView({ block: "nearest" })
                }}
              />
            </Section>
          ) : null}
        </div>

        {content.productInputs.length > 0 ? (
          <Section title="Accepted Result inputs" level={3} description="Accepted products used as inputs. They are listed apart from raw sessions.">
            <ul className="divide-y rounded-lg border text-sm">
              {content.productInputs.map((id) => {
                const result = catalog.results[id]
                return (
                  <li key={id} className="flex items-center justify-between gap-3 px-3 py-2">
                    <div className="min-w-0">
                      {result ? <PathText path={result.path} /> : <UnknownValue label="Result no longer recorded" />}
                      {result ? <p className="text-xs text-muted-foreground">{result.kind}{result.channel ? ` · ${result.channel}` : ""}</p> : null}
                    </div>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={!editable}
                      onClick={() => edit("Remove Result input", (current) => ({ ...current, productInputs: current.productInputs.filter((r) => r !== id) }))}
                    >
                      Remove
                    </Button>
                  </li>
                )
              })}
            </ul>
          </Section>
        ) : null}
      </PageBody>
      <ConfirmDialog
        open={clearOpen}
        onOpenChange={setClearOpen}
        title={`Clear the selection of ${view.name}?`}
        description="The draft keeps no session. You can check sessions again; exclusions made inside them are not restored."
        changes={[`Remove ${plural(selectedIds.length, "session")} and ${plural(content.included.length + content.excluded.length + content.unresolved.length, "frame")} from this draft`]}
        unchanged={["Saved revisions of this View until you choose Save View", "Other Views", "Sessions, frames and library quality"]}
        confirmLabel="Clear selection"
        onConfirm={() => {
          const result = edit("Clear selection", (current) => ({ ...current, sessions: [], included: [], excluded: [], unresolved: [] }))
          if (result.ok) focusTable()
          return result
        }}
      />
    </div>
  )
}

function SessionEvidence({ row, ctx, editable, onToggle }: { row: CandidateRow; ctx: ViewContext; editable: boolean; onToggle: (include: boolean) => void }) {
  const catalog = useStore((s) => s.catalog)
  const { session, geometry, suggestion } = row
  const first = catalog.assets[session.assetIds[0] ?? ""]
  const header = first?.observed
  const fov = geometry.fov
  const locations = row.locationIds.map((id) => catalog.locations[id]?.displayName ?? "Unknown location")
  return (
    <Section
      title={`${sessionLabel(session)} · ${plural(session.assetIds.length, "frame")} · ${formatDuration(row.breakdown.captured.seconds)}`}
      level={3}
      description={row.reason ? `Selected: ${REASON_LABEL[row.reason.kind]}. ${row.reason.detail}` : `Not selected. ${suggestion.label}: ${suggestion.detail}`}
      actions={
        <>
          <Button size="sm" variant="outline" render={<Link to="/sessions/$sessionId" params={{ sessionId: session.id }} />}>
            Open session
          </Button>
          <Button size="sm" variant={row.reason ? "outline" : "default"} disabled={!editable} onClick={() => onToggle(!row.reason)}>
            {row.reason ? "Remove from View" : "Include in View"}
          </Button>
        </>
      }
    >
      <div className="rounded-lg border p-4">
        <KeyValueList
          items={[
            {
              label: "Pointing",
              value: session.pointing ? `${formatRa(session.pointing.ra)}, ${formatDec(session.pointing.dec)}` : <UnknownValue label="Position unknown" reason="No RA/DEC keywords in the headers." />,
              source: session.pointing ? "Header RA/DEC, mean of frames" : undefined,
            },
            {
              label: "Orientation",
              value:
                session.pointing?.rotationDeg !== null && session.pointing?.rotationDeg !== undefined ? (
                  formatDegrees(session.pointing.rotationDeg)
                ) : (
                  <UnknownValue label="Unknown" reason="No ROTATANG keyword, so no footprint." />
                ),
              source: session.pointing?.rotationDeg !== null && session.pointing?.rotationDeg !== undefined ? "Header ROTATANG" : undefined,
            },
            {
              label: "Field of view",
              value: fov ? `${formatDegrees(fov.widthDeg, 2)} × ${formatDegrees(fov.heightDeg, 2)}` : <UnknownValue label="FOV unknown" reason="Needs confirmed equipment with a camera and an effective focal length." />,
              source: fov ? (geometry.fovSource === "confirmed" ? "FOV from confirmed equipment" : "FOV from associated equipment (not confirmed)") : undefined,
            },
            ...(fov
              ? [
                  {
                    label: "FOV inputs",
                    value: `${fov.basis.widthPx} × ${fov.basis.heightPx} px · ${fov.basis.focalLengthMm} mm effective focal length · ${fov.basis.pixelSizeUm} µm pixels · binning ${fov.basis.binning} · ${fov.pixelScaleArcsec.toFixed(2)}″/px`,
                    source: row.trainName ?? undefined,
                  },
                ]
              : []),
            {
              label: "Header optics",
              value: header ? `TELESCOP ${header.telescope ?? "missing"} · FOCALLEN ${header.focalLengthMm ? `${header.focalLengthMm} mm` : "missing"}` : <UnknownValue />,
              source: "First frame",
            },
            {
              label: "Footprint",
              value:
                geometry.kind === "footprint" && geometry.coverage !== null ? (
                  `Covers ${Math.round(geometry.coverage * 100)}% of ${geometry.coveredRegion}`
                ) : (
                  <UnknownValue label={geometry.kind === "pointing-only" ? "Pointing only" : "No footprint"} reason="A footprint needs pointing, orientation and confirmed equipment." />
                ),
              source: geometry.kind === "footprint" ? "Threshold 50% (prototype value)" : undefined,
            },
            {
              label: "Sky distance",
              value:
                geometry.distanceDeg !== null ? (
                  `${formatDegrees(geometry.distanceDeg, 2)} from ${ctx.regions.length > 1 ? "the nearest panel" : "the framing centre"}`
                ) : ctx.regions.length === 0 && session.pointing ? (
                  <UnknownValue label="No framing" reason="This View has no Project or Target framing to measure a distance from." />
                ) : (
                  <UnknownValue label="Position unknown" reason="Unknown geometry is never shown as zero distance." />
                ),
              source: geometry.distanceDeg === null ? undefined : "Orders suggestions; never decides them",
            },
            { label: "OBJECT", value: session.objectLabel ?? <UnknownValue label="Missing OBJECT" />, source: "Header OBJECT: a label, never evidence" },
            { label: "Target", value: <StatusBadge kind="association" value={session.target.status} label={`${session.target.value ? (catalog.targets[session.target.value]?.name ?? "Target") : "No Target"} · ${session.target.status === "confirmed" ? "Confirmed" : session.target.status === "associated" ? "Associated" : session.target.status === "needs-review" ? "Needs review" : "Unresolved"}`} /> },
            {
              label: "Equipment",
              value: (
                <span className="inline-flex flex-wrap items-center gap-2">
                  {row.trainName ?? session.cameraName ?? "Unknown"}
                  <StatusBadge kind="association" value={session.equipment.status} />
                  {session.equipment.status !== "confirmed" ? (
                    <Link to="/sessions/$sessionId" params={{ sessionId: session.id }} className="text-xs text-primary underline-offset-4 hover:underline">
                      Confirm equipment in Sessions
                    </Link>
                  ) : null}
                </span>
              ),
            },
            { label: "Locations", value: locations.join(", ") || <UnknownValue label="Not set" /> },
            { label: "Availability", value: <AvailabilityCell row={row} /> },
          ]}
        />
      </div>
    </Section>
  )
}
