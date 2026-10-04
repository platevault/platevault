/**
 * Targets (`/targets`), the default home: local Target search by name,
 * alias or coordinates, coverage per Target, Needs review counts and the
 * planned flag. Works with no account or network (J20 S1; LIB-FR-08,
 * LIB-FR-10, LIB-FR-13, LIB-AC-09).
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { CalendarClock, Crosshair, TriangleAlert, Unplug } from "lucide-react"
import { useId, useState } from "react"
import { type Column, DataTable, TableToolbar } from "@/components/app/data-table"
import { EmptyState, Notice, TableSkeleton } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDegrees, formatDuration, plural } from "@/lib/format"
import type { SearchParams } from "@/routes"
import { useStore } from "@/store/core"
import { activeIndexOperations, currentSessions, parseCoordinates, searchTargets, type TargetSummary, targetSummary, COORDINATE_SEARCH_RADIUS_DEG } from "../model"
import { IndexingNotices, LibraryScopeStrip, ScopeProblemNotices } from "../parts"
import { TargetRecordDialog } from "../target-record-dialog"

const SHOW = [
  { value: "all", label: "All Targets" },
  { value: "captured", label: "With captures" },
  { value: "planned", label: "Planned" },
  { value: "needs-review", label: "Needs review" },
] as const

export function TargetsPage() {
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const query = search.q ?? ""
  const show = search.show ?? "all"
  const summaries = useStore((s) => Object.values(s.catalog.targets).map((t) => targetSummary(s, t)))
  const unresolved = useStore((s) => currentSessions(s.catalog, "light").filter((x) => x.target.status === "unresolved").length)
  const indexing = useStore((s) => activeIndexOperations(s).length > 0)
  const hasLocations = useStore((s) => Object.keys(s.catalog.locations).length > 0)
  const [addOpen, setAddOpen] = useState(false)
  const showId = useId()

  function setParams(patch: SearchParams) {
    navigate({
      to: "/targets",
      search: (previous: SearchParams) => {
        const next: SearchParams = { ...previous, ...patch }
        for (const key of Object.keys(next)) if (!next[key] || next[key] === "all") delete next[key]
        return next
      },
      replace: true,
    })
  }

  const coords = parseCoordinates(query)
  const rows = searchTargets(summaries, query).filter((s) => {
    if (show === "captured") return s.breakdown.captured.frames > 0
    if (show === "planned") return s.planned
    if (show === "needs-review") return s.needsReview > 0
    return true
  })

  const columns: Column<TargetSummary>[] = [
    {
      id: "target",
      header: "Target",
      rowHeader: true,
      className: "whitespace-normal",
      sortValue: (r) => r.target.name,
      cell: (r) => (
        <span className="flex min-w-0 flex-col py-0.5 leading-tight">
          <Link to="/targets/$targetId" params={{ targetId: r.target.id }} className="font-medium underline-offset-2 hover:underline">
            {r.target.name}
          </Link>
          {r.target.aliases.length > 0 ? (
            <span className={`${coords ? "max-w-28 xl:max-w-56" : "max-w-36 xl:max-w-64"} truncate text-xs text-muted-foreground`} title={r.target.aliases.slice(0, 2).join(" · ")}>
              {r.target.aliases.slice(0, 2).join(" · ")}
            </span>
          ) : null}
        </span>
      ),
    },
    ...(coords
      ? [{ id: "distance", header: "Distance", align: "right" as const, sortValue: (r: TargetSummary) => r.separationDeg, cell: (r: TargetSummary) => `${formatDegrees(r.separationDeg ?? 0)} away` }]
      : []),
    {
      id: "channels",
      header: "Channels",
      className: "whitespace-normal",
      cell: (r) => (
        <span className="flex flex-col items-start gap-0.5 py-0.5">
          {r.channels.length > 0 ? <span>{r.channels.join(" · ")}</span> : <span className="text-muted-foreground">No captures</span>}
          {r.needsReview > 0 ? (
            <span className="inline-flex items-start gap-1 text-xs text-warning">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
              {plural(r.needsReview, "session")} {r.needsReview === 1 ? "needs" : "need"} review
            </span>
          ) : null}
        </span>
      ),
    },
    {
      id: "captured",
      header: "Captured",
      align: "right",
      className: "whitespace-normal",
      sortValue: (r) => r.breakdown.captured.seconds,
      cell: (r) => (
        <span className="flex flex-col items-end gap-0.5 py-0.5">
          <span className="whitespace-nowrap">{formatDuration(r.breakdown.captured.seconds)}</span>
          {r.breakdown.unavailable.frames > 0 ? (
            <span className="inline-flex items-start gap-1 text-xs text-warning">
              <Unplug aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
              {formatDuration(r.breakdown.unavailable.seconds)} unavailable
            </span>
          ) : null}
        </span>
      ),
    },
    { id: "usable", header: "Usable", align: "right", sortValue: (r) => r.breakdown.usable.seconds, cell: (r) => formatDuration(r.breakdown.usable.seconds) },
    { id: "unreviewed", header: "Unreviewed", align: "right", sortValue: (r) => r.breakdown.unreviewed.seconds, cell: (r) => formatDuration(r.breakdown.unreviewed.seconds) },
    { id: "projects", header: "Projects", align: "right", sortValue: (r) => r.projects, cell: (r) => (r.projects > 0 ? r.projects : null) },
    {
      id: "plan",
      header: "Plan",
      sortValue: (r) => (r.planned ? 1 : 0),
      cell: (r) =>
        r.planned ? (
          <Link to="/targets/$targetId/plan" params={{ targetId: r.target.id }} className="inline-flex items-center gap-1 text-xs underline-offset-2 hover:underline">
            <CalendarClock aria-hidden="true" className="size-3.5" />
            Planned
          </Link>
        ) : null,
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Targets"
        description="What your library holds for each sky subject. Search works offline, by name, alias or coordinates."
        actions={
          <Button variant="outline" onClick={() => setAddOpen(true)}>
            Add Target
          </Button>
        }
      />
      <PageBody className="space-y-4">
        <IndexingNotices />
        <ScopeProblemNotices kind="light" />
        {unresolved > 0 ? (
          <Notice
            tone="warning"
            title={`${plural(unresolved, "session")} ${unresolved === 1 ? "has" : "have"} no Target yet`}
            actions={
              <Button size="sm" variant="outline" render={<Link to="/sessions" search={{ target: "unresolved" }} />}>
                Review in Sessions
              </Button>
            }
          >
            Their headers have no OBJECT and not enough other evidence, so PlateVault does not guess. They are not counted for any Target.
          </Notice>
        ) : null}
        <LibraryScopeStrip kind="light" />
        {summaries.length === 0 ? (
          indexing ? (
            <TableSkeleton label="Reading session metadata; Targets appear as sessions are read" columns={6} />
          ) : (
            <EmptyState
              icon={Crosshair}
              titleAs="h2"
              title="No Targets yet"
              description={
                hasLocations
                  ? "Targets appear when indexed sessions carry pointing or OBJECT evidence, or when you add one yourself."
                  : "Targets appear after a capture location is indexed, or when you add one yourself."
              }
              action={
                <Button size="sm" onClick={() => setAddOpen(true)}>
                  Add Target
                </Button>
              }
            />
          )
        ) : (
          <>
            <TableToolbar
              search={{
                label: "Search Targets",
                placeholder: "Name, alias, or RA Dec (°)",
                value: query,
                onChange: (value) => setParams({ q: value }),
              }}
              filters={
                <div className="flex items-center gap-1.5">
                  <Label id={showId} className="text-xs text-muted-foreground">
                    Show
                  </Label>
                  <Select items={SHOW} value={show} onValueChange={(value) => setParams({ show: value as string })}>
                    <SelectTrigger size="sm" aria-labelledby={showId} className="min-w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {SHOW.map((item) => (
                        <SelectItem key={item.value} value={item.value}>
                          {item.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              }
            />
            <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
              {coords
                ? `${plural(rows.length, "Target")} within ${COORDINATE_SEARCH_RADIUS_DEG}° of RA ${coords.ra}°, Dec ${coords.dec}°, nearest first`
                : `${plural(rows.length, "matching Target")}`}
            </p>
            <DataTable
              key={coords ? "coordinates" : "default"}
              label="Targets"
              rows={rows}
              columns={columns}
              getRowId={(r) => r.target.id}
              initialSort={coords ? { columnId: "distance", direction: "asc" } : { columnId: "captured", direction: "desc" }}
              empty={
                <EmptyState
                  icon={Crosshair}
                  title={query ? `No Target matches “${query}”` : "No Target matches this filter"}
                  description={
                    coords
                      ? `No local Target lies within ${COORDINATE_SEARCH_RADIUS_DEG}° of these coordinates. Search uses local records only.`
                      : "Search matches local Target names and aliases, or RA and Dec in degrees."
                  }
                  action={
                    <Button size="sm" variant="outline" onClick={() => setParams({ q: undefined, show: undefined })}>
                      Clear search and filter
                    </Button>
                  }
                />
              }
            />
          </>
        )}
      </PageBody>
      <TargetRecordDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        initialName={coords ? "" : query}
        onCreated={(targetId) => navigate({ to: "/targets/$targetId", params: { targetId } })}
      />
    </div>
  )
}
