/**
 * Sessions (`/sessions`): the session table with display-only grouping by
 * night, filters held in the URL, selection with Create View, File into
 * library and bulk confirmations, and provisional totals while indexing
 * (J19 S6, S8, S10, S12-S15; LIB-FR-03, -04, -06, -07, -09).
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { Layers } from "lucide-react"
import { type ReactNode, useId, useState } from "react"
import { type Column, DataTable, SelectionBar, TableToolbar } from "@/components/app/data-table"
import { FilterChips } from "@/components/app/data"
import { EmptyState, TableSkeleton } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { normalizeName } from "@/domain/sky"
import type { SessionId } from "@/domain/types"
import { formatCount, formatDuration, formatExposure, formatNight, plural } from "@/lib/format"
import type { SearchParams } from "@/routes"
import { updateSlice, useStore } from "@/store/core"
import { startIndexing } from "@/store/operations"
import { BulkConfirmDialog, type BulkMode } from "../bulk-confirm"
import {
  activeIndexOperations,
  currentSessions,
  IMAGE_TYPE_LABEL,
  type SessionKind,
  type SessionRow,
  sessionRow,
  sumBreakdowns,
} from "../model"
import { EquipmentCell, IndexingNotices, LibraryScopeStrip, LocationsCell, QualityCounts, ScopeCell, ScopeProblemNotices, TargetCell } from "../parts"

const ALL = "all"

const QUALITY_FILTERS = [
  { value: ALL, label: "Any quality" },
  { value: "unreviewed", label: "Has Unreviewed" },
  { value: "usable", label: "Has Usable" },
  { value: "unusable", label: "Has Unusable" },
  { value: "changed-content", label: "Changed content" },
  { value: "verification-pending", label: "Verification pending" },
] as const

const AVAILABILITY_FILTERS = [
  { value: ALL, label: "Any availability" },
  { value: "available", label: "All frames available" },
  { value: "unavailable", label: "Some frames unavailable" },
] as const

function matchesQuality(row: SessionRow, quality: string): boolean {
  const b = row.breakdown
  switch (quality) {
    case "unreviewed":
      return b.unreviewed.frames > 0
    case "usable":
      return b.usable.frames > 0
    case "unusable":
      return b.unusable.frames > 0
    case "changed-content":
      return b.changedContent.frames > 0
    case "verification-pending":
      return b.verificationPending.frames > 0
    default:
      return true
  }
}

/** One filter select with a visible label, so the chosen value always reads in context. */
function FilterSelect({ label, value, items, onChange }: { label: string; value: string; items: ReadonlyArray<{ value: string; label: string }>; onChange: (value: string) => void }) {
  const id = useId()
  return (
    <div className="flex items-center gap-1.5">
      <Label id={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Select items={items} value={value} onValueChange={(next) => onChange(next as string)}>
        <SelectTrigger size="sm" aria-labelledby={id} className="min-w-28">
          <SelectValue />
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
  )
}

export function SessionsPage() {
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const kind: SessionKind = search.type === "calibration" ? "calibration" : "light"
  const channel = search.channel ?? ALL
  const target = search.target ?? ALL
  const quality = search.quality ?? ALL
  const availability = search.availability ?? ALL
  const selectedOnly = search.show === "selected"
  const query = search.q ?? ""

  const rows = useStore((s) => currentSessions(s.catalog, kind).map((session) => sessionRow(s, session)))
  const targets = useStore((s) => s.catalog.targets)
  const locationCount = useStore((s) => Object.keys(s.catalog.locations).length)
  const neverIndexed = useStore((s) => Object.values(s.catalog.locations).every((l) => l.scanScope === "never"))
  const indexing = useStore((s) => activeIndexOperations(s).length > 0)
  const locationIds = useStore((s) => Object.keys(s.catalog.locations))
  const groupByNight = useStore((s) => s.slices.t2.groupByNight)
  const switchId = useId()

  const [selection, setSelection] = useState<Record<SessionKind, SessionId[]>>({ light: [], calibration: [] })
  const selected = selection[kind]
  const setSelected = (ids: SessionId[]) => setSelection((current) => ({ ...current, [kind]: ids }))
  const [bulk, setBulk] = useState<BulkMode | null>(null)
  const [announcement, setAnnouncement] = useState("")

  function setParams(patch: SearchParams) {
    navigate({
      to: "/sessions",
      search: (previous: SearchParams) => {
        const next: SearchParams = { ...previous, ...patch }
        for (const key of Object.keys(next)) if (next[key] === undefined || next[key] === "" || next[key] === ALL) delete next[key]
        return next
      },
      replace: true,
    })
  }

  const needle = normalizeName(query)
  const filtered = rows.filter((row) => {
    const s = row.session
    if (selectedOnly && !selected.includes(s.id)) return false
    if (channel !== ALL && (s.channel ?? "No filter") !== channel) return false
    if (target === "needs-review" && s.target.status !== "needs-review") return false
    if (target === "unresolved" && s.target.status !== "unresolved") return false
    if (target !== ALL && target !== "needs-review" && target !== "unresolved" && s.target.value !== target) return false
    if (!matchesQuality(row, quality)) return false
    if (availability === "available" && row.breakdown.unavailable.frames > 0) return false
    if (availability === "unavailable" && row.breakdown.unavailable.frames === 0) return false
    if (needle) {
      const haystack = [row.label, s.objectLabel, row.targetName, s.cameraName, s.telescopeName, row.trainName, formatNight(s.night, true)]
      if (!haystack.some((value) => value && normalizeName(value).includes(needle))) return false
    }
    return true
  })
  const shownIds = new Set(filtered.map((r) => r.session.id))
  const hiddenSelected = selected.filter((id) => !shownIds.has(id)).length

  const channels = [...new Set(rows.map((r) => r.session.channel ?? "No filter"))].sort((a, b) => a.localeCompare(b))
  const channelItems = [{ value: ALL, label: "All channels" }, ...channels.map((c) => ({ value: c, label: c }))]
  const targetIdsInRows = [...new Set(rows.map((r) => r.session.target.value).filter((id): id is string => Boolean(id)))]
  const targetItems = [
    { value: ALL, label: "All Targets" },
    { value: "needs-review", label: "Needs review" },
    { value: "unresolved", label: "Unresolved" },
    ...targetIdsInRows.map((id) => ({ value: id, label: targets[id]?.name ?? id })).sort((a, b) => a.label.localeCompare(b.label)),
  ]

  const chips = [
    query ? { id: "q", label: `Search: “${query}”` } : null,
    channel !== ALL ? { id: "channel", label: `Channel: ${channel}` } : null,
    target !== ALL ? { id: "target", label: `Target: ${targetItems.find((t) => t.value === target)?.label ?? target}` } : null,
    quality !== ALL ? { id: "quality", label: `Quality: ${QUALITY_FILTERS.find((q) => q.value === quality)?.label ?? quality}` } : null,
    availability !== ALL ? { id: "availability", label: `Availability: ${AVAILABILITY_FILTERS.find((a) => a.value === availability)?.label ?? availability}` } : null,
    selectedOnly ? { id: "show", label: "Selected sessions only" } : null,
  ].filter((chip): chip is { id: string; label: string } => chip !== null)
  const clearFilters = () => setParams({ q: undefined, channel: undefined, target: undefined, quality: undefined, availability: undefined, show: undefined })

  const totals = sumBreakdowns(filtered.map((r) => r.breakdown))
  const isLight = kind === "light"

  const columns: Column<SessionRow>[] = [
    {
      id: "session",
      header: "Session",
      rowHeader: true,
      sortValue: (r) => `${r.session.night}|${r.label}`,
      cell: (r) => (
        <Link to="/sessions/$sessionId" params={{ sessionId: r.session.id }} className="font-medium underline-offset-2 hover:underline">
          {r.label}
        </Link>
      ),
    },
    ...(isLight
      ? [
          { id: "target", header: "Target", sortValue: (r: SessionRow) => r.targetName, cell: (r: SessionRow) => <TargetCell row={r} /> },
          {
            id: "object",
            header: "OBJECT",
            sortValue: (r: SessionRow) => r.session.objectLabel,
            cell: (r: SessionRow) => (r.session.objectLabel ? <span className="font-mono text-xs">{r.session.objectLabel}</span> : <span className="text-muted-foreground">Missing</span>),
          },
        ]
      : [{ id: "type", header: "Type", sortValue: (r: SessionRow) => r.session.imageType, cell: (r: SessionRow) => IMAGE_TYPE_LABEL[r.session.imageType] }]),
    { id: "frames", header: "Frames", align: "right", sortValue: (r) => r.session.assetIds.length, cell: (r) => formatCount(r.session.assetIds.length) },
    {
      id: "integration",
      header: isLight ? "Integration" : "Exposure",
      align: "right",
      sortValue: (r) => (isLight ? r.breakdown.captured.seconds : r.session.exposureS),
      cell: (r) => (isLight ? formatDuration(r.breakdown.captured.seconds) : formatExposure(r.session.exposureS)),
    },
    { id: "equipment", header: "Equipment", sortValue: (r) => r.trainName, cell: (r) => <EquipmentCell row={r} /> },
    { id: "locations", header: "Locations", cell: (r) => <LocationsCell row={r} /> },
    ...(isLight ? [{ id: "quality", header: "Quality", cell: (r: SessionRow) => <QualityCounts breakdown={r.breakdown} /> }] : []),
    { id: "scope", header: "Scope", cell: (r) => <ScopeCell scope={r.session.scope} /> },
  ]

  const selectionProps = { selected, onChange: setSelected, rowLabel: (r: SessionRow) => r.label }
  const filteredEmpty = (
    <EmptyState
      icon={Layers}
      title="No session matches these filters"
      description={selected.length > 0 ? `Your ${plural(selected.length, "selected session")} stay selected.` : "Remove a filter to see more sessions."}
      action={
        <Button size="sm" variant="outline" onClick={clearFilters}>
          Clear filters
        </Button>
      }
    />
  )

  let body: ReactNode
  if (rows.length === 0 && indexing) {
    body = <TableSkeleton label="Reading session metadata" columns={6} />
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon={Layers}
        titleAs="h2"
        title={isLight ? "No sessions yet" : "No calibration sets yet"}
        description={
          locationCount === 0
            ? "Sessions appear after a capture location is registered and indexed. Indexing reads metadata in place and never moves files."
            : neverIndexed
              ? "Your locations are registered but not indexed yet. Indexing reads metadata in place and never moves files."
              : isLight
                ? "No light frames were found in the indexed locations."
                : "No calibration frames were found. They appear after a Calibration location is indexed."
        }
        action={
          locationCount > 0 && neverIndexed ? (
            <Button size="sm" onClick={() => startIndexing(locationIds)}>
              Index registered locations
            </Button>
          ) : (
            <Button size="sm" variant="outline" render={<Link to="/settings/locations" />}>
              {locationCount === 0 ? "Add a capture location" : "Open Settings › Locations"}
            </Button>
          )
        }
      />
    )
  } else if (groupByNight) {
    const nights = [...new Set(filtered.map((r) => r.session.night))].sort((a, b) => b.localeCompare(a))
    body =
      nights.length === 0 ? (
        <div className="rounded-lg border p-4">{filteredEmpty}</div>
      ) : (
        <div className="space-y-5">
          {nights.map((night) => {
            const nightRows = filtered.filter((r) => r.session.night === night)
            return (
              <section key={night} aria-labelledby={`night-${night}`} className="space-y-2">
                <h2 id={`night-${night}`} className="text-sm font-semibold">
                  {formatNight(night, true)} <span className="font-normal text-muted-foreground">· {plural(nightRows.length, "session")}</span>
                </h2>
                <DataTable
                  label={`Sessions on the night of ${formatNight(night, true)}`}
                  rows={nightRows}
                  columns={columns}
                  getRowId={(r) => r.session.id}
                  selection={selectionProps}
                  initialSort={{ columnId: "session", direction: "asc" }}
                  scroll="none"
                />
              </section>
            )
          })}
        </div>
      )
  } else {
    body = (
      <DataTable
        label={isLight ? "Light sessions" : "Calibration sets"}
        rows={filtered}
        columns={columns}
        getRowId={(r) => r.session.id}
        selection={selectionProps}
        initialSort={{ columnId: "session", direction: "desc" }}
        empty={filteredEmpty}
      />
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Sessions"
        description="Metadata-homogeneous capture groups, read from your locations in place. Grouping by night changes the display only."
      />
      <PageBody className="space-y-4">
        <IndexingNotices />
        <ScopeProblemNotices kind={kind} />
        <LibraryScopeStrip kind={kind} />
        {rows.length > 0 ? (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm tabular-nums" aria-live="polite">
            <span className="font-medium">{plural(filtered.length, isLight ? "session" : "calibration set")}</span>
            <span className="text-muted-foreground">·</span>
            <span>{plural(totals.captured.frames, "frame")}</span>
            {isLight ? (
              <>
                <span className="text-muted-foreground">·</span>
                <span>{formatDuration(totals.captured.seconds)} captured</span>
                <span className="text-muted-foreground">·</span>
                <span>Usable {formatDuration(totals.usable.seconds)}</span>
                <span className="text-muted-foreground">·</span>
                <span>Unreviewed {formatDuration(totals.unreviewed.seconds)}</span>
                {totals.changedContent.frames > 0 ? <span className="text-warning">· Changed content {formatDuration(totals.changedContent.seconds)}</span> : null}
                {totals.verificationPending.frames > 0 ? <span>· Verification pending {formatDuration(totals.verificationPending.seconds)}</span> : null}
                {totals.unavailable.frames > 0 ? <span className="text-warning">· Unavailable {formatDuration(totals.unavailable.seconds)}</span> : null}
              </>
            ) : null}
            {indexing ? <StatusBadge kind="scanScope" value="provisional" /> : null}
          </p>
        ) : null}
        {rows.length > 0 ? (
          <>
            <TableToolbar
              search={{ label: "Search sessions", placeholder: "Search OBJECT, Target, night or camera", value: query, onChange: (value) => setParams({ q: value }) }}
              filters={
                <>
                  <ToggleGroup
                    aria-label="Frame type"
                    size="sm"
                    variant="outline"
                    spacing={0}
                    value={[kind]}
                    onValueChange={(value) => {
                      const next = value[0]
                      if (next) setParams({ type: next === "calibration" ? "calibration" : undefined })
                    }}
                  >
                    <ToggleGroupItem value="light">Lights</ToggleGroupItem>
                    <ToggleGroupItem value="calibration">Calibration</ToggleGroupItem>
                  </ToggleGroup>
                  <FilterSelect label="Channel" value={channel} items={channelItems} onChange={(value) => setParams({ channel: value })} />
                  {isLight ? <FilterSelect label="Target" value={target} items={targetItems} onChange={(value) => setParams({ target: value })} /> : null}
                  {isLight ? <FilterSelect label="Quality" value={quality} items={QUALITY_FILTERS} onChange={(value) => setParams({ quality: value })} /> : null}
                  <FilterSelect label="Availability" value={availability} items={AVAILABILITY_FILTERS} onChange={(value) => setParams({ availability: value })} />
                </>
              }
              actions={
                <div className="flex items-center gap-2">
                  <Switch id={switchId} checked={groupByNight} onCheckedChange={(value) => updateSlice("t2", (s) => ({ ...s, groupByNight: value }))} />
                  <Label htmlFor={switchId}>Group by night</Label>
                </div>
              }
            />
            <FilterChips
              chips={chips}
              onRemove={(id) => setParams({ [id]: undefined })}
              onClear={clearFilters}
              matchLabel={`${plural(filtered.length, isLight ? "matching session" : "matching calibration set")}`}
            />
            <SelectionBar
              count={selected.length}
              hiddenByFilters={hiddenSelected}
              noun={isLight ? "session" : "calibration set"}
              onShowSelected={hiddenSelected > 0 ? () => setParams({ show: "selected", q: undefined, channel: undefined, target: undefined, quality: undefined, availability: undefined }) : undefined}
              onClear={() => setSelected([])}
              actions={
                <>
                  {isLight ? (
                    <Button size="sm" variant="outline" onClick={() => setBulk("target")}>
                      Confirm Target…
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={() => setBulk("equipment")}>
                    Confirm equipment…
                  </Button>
                  {isLight ? (
                    <>
                      <Button size="sm" variant="outline" render={<Link to="/storage/filing" search={{ sessionIds: selected.join(",") }} />}>
                        File into library
                      </Button>
                      <Button size="sm" render={<Link to="/views/new" search={{ from: "sessions", sessionIds: selected.join(",") }} />}>
                        Create View
                      </Button>
                    </>
                  ) : null}
                </>
              }
            />
            <p role="status" className={announcement ? "text-sm" : "sr-only"}>
              {announcement}
            </p>
          </>
        ) : null}
        {body}
      </PageBody>
      <BulkConfirmDialog
        open={bulk !== null}
        onOpenChange={(open) => {
          if (!open) setBulk(null)
        }}
        mode={bulk ?? "equipment"}
        sessionIds={selected}
        onDone={setAnnouncement}
      />
    </div>
  )
}
