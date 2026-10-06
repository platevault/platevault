/**
 * Targets (`/targets`): the concise Target finder (Harness V3,
 * design/HARNESS-V3.md §6). One search field and a scope bar over a dense,
 * one-line-per-Target list; the cursor Target fills the inspector with its
 * position (value beside its source), coverage by channel and its work.
 * Local search by name, alias or coordinates; works with no account or
 * network (J20 S1; LIB-FR-08, LIB-FR-10, LIB-FR-13, LIB-AC-09).
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { CalendarClock, Crosshair, TriangleAlert, Unplug } from "lucide-react"
import { useState } from "react"
import { type Column, DataTable, TableToolbar } from "@/components/app/data-table"
import { EmptyState, TableSkeleton } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { Inspector, InspectorSection, PropertyList } from "@/components/app/panes"
import { Button } from "@/components/ui/button"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { targetCoverage } from "@/domain/derive"
import { formatDec, formatDegrees, formatDuration, formatRa, plural } from "@/lib/format"
import type { SearchParams } from "@/routes"
import { useStore } from "@/store/core"
import {
  acceptedResultsForViews,
  activeIndexOperations,
  COORDINATE_SEARCH_RADIUS_DEG,
  COORDINATE_SOURCE,
  currentSessions,
  parseCoordinates,
  searchTargets,
  type TargetSummary,
  targetSummary,
  viewsForTarget,
} from "../model"
import { type LibraryNote, LibraryStatus } from "../parts"
import { TargetRecordDialog } from "../target-record-dialog"

const SCOPES = [
  { value: "all", label: "All", test: () => true },
  { value: "captured", label: "With captures", test: (s: TargetSummary) => s.breakdown.captured.frames > 0 },
  { value: "planned", label: "Planned", test: (s: TargetSummary) => s.planned },
  { value: "needs-review", label: "Needs review", test: (s: TargetSummary) => s.needsReview > 0 },
] as const

/** Usable, then Unreviewed, share of captured integration. Decorative: the numbers beside it carry the meaning. */
function CoverageBar({ summary }: { summary: TargetSummary }) {
  const captured = Math.max(summary.breakdown.captured.seconds, 1)
  const pct = (seconds: number) => `${(seconds / captured) * 100}%`
  return (
    <span aria-hidden="true" className="inline-flex h-1.5 w-16 overflow-hidden rounded-full bg-muted align-middle">
      <span className="h-full bg-primary" style={{ width: pct(summary.breakdown.usable.seconds) }} />
      <span className="h-full bg-primary/35" style={{ width: pct(summary.breakdown.unreviewed.seconds) }} />
    </span>
  )
}

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
  const [cursorId, setCursorId] = useState<string | null>(null)

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
  const matched = searchTargets(summaries, query)
  const scope = SCOPES.find((s) => s.value === show) ?? SCOPES[0]
  const rows = matched.filter((s) => scope.test(s))
  const cursor = rows.find((r) => r.target.id === cursorId) ?? rows[0] ?? null
  const unresolvedNotes: LibraryNote[] =
    unresolved > 0
      ? [
          {
            id: "unresolved",
            summary: `${plural(unresolved, "session")} ${unresolved === 1 ? "has" : "have"} no Target yet`,
            detail: "Their headers have no OBJECT and not enough other evidence, so PlateVault does not guess. They are not counted for any Target.",
            action: (
              <Button size="sm" variant="outline" render={<Link to="/sessions" search={{ target: "unresolved" }} />}>
                Review in Sessions
              </Button>
            ),
          },
        ]
      : []

  const columns: Column<TargetSummary>[] = [
    {
      id: "target",
      header: "Target",
      rowHeader: true,
      // Takes the free width; the aliases truncate first, never the name.
      className: "w-full max-w-0",
      sortValue: (r) => r.target.name,
      cell: (r) => (
        <span className="flex min-w-0 items-baseline gap-2">
          <Link to="/targets/$targetId" params={{ targetId: r.target.id }} className="shrink-0 font-medium underline-offset-2 hover:underline">
            {r.target.name}
          </Link>
          {r.target.aliases.length > 0 ? (
            <span className="min-w-0 truncate text-xs text-muted-foreground" title={r.target.aliases.join(" · ")}>
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
      cell: (r) => (r.channels.length > 0 ? r.channels.join(" · ") : <span className="text-muted-foreground">No captures</span>),
    },
    {
      id: "coverage",
      header: "Usable of captured",
      align: "right",
      sortValue: (r) => r.breakdown.usable.seconds,
      cell: (r) =>
        r.breakdown.captured.frames > 0 ? (
          <span className="inline-flex items-center gap-2">
            <CoverageBar summary={r} />
            <span>
              {formatDuration(r.breakdown.usable.seconds)} <span className="text-muted-foreground">of</span> {formatDuration(r.breakdown.captured.seconds)}
            </span>
          </span>
        ) : (
          <span className="text-muted-foreground">0h 00m</span>
        ),
    },
    { id: "unreviewed", header: "Unreviewed", align: "right", sortValue: (r) => r.breakdown.unreviewed.seconds, cell: (r) => formatDuration(r.breakdown.unreviewed.seconds) },
    {
      id: "flags",
      header: "Attention",
      sortValue: (r) => r.needsReview * 2 + (r.breakdown.unavailable.frames > 0 ? 1 : 0),
      cell: (r) => (
        <span className="inline-flex items-center gap-2.5 text-xs">
          {r.needsReview > 0 ? (
            <span className="inline-flex items-center gap-1 text-warning" title={`${plural(r.needsReview, "session")} ${r.needsReview === 1 ? "needs" : "need"} review`}>
              <TriangleAlert aria-hidden="true" className="size-3 shrink-0" />
              {plural(r.needsReview, "session")} {r.needsReview === 1 ? "needs" : "need"} review
            </span>
          ) : null}
          {r.breakdown.unavailable.frames > 0 ? (
            <span className="inline-flex items-center gap-1 text-warning">
              <Unplug aria-hidden="true" className="size-3 shrink-0" />
              {formatDuration(r.breakdown.unavailable.seconds)} unavailable
            </span>
          ) : null}
          {r.planned ? (
            <Link to="/targets/$targetId/plan" params={{ targetId: r.target.id }} className="inline-flex items-center gap-1 underline-offset-2 hover:underline">
              <CalendarClock aria-hidden="true" className="size-3 shrink-0" />
              Planned
            </Link>
          ) : null}
        </span>
      ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Targets"
        description="Search works offline, by name, alias or coordinates."
        actions={
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            Add Target
          </Button>
        }
      />
      {summaries.length > 0 ? (
        <div className="border-b px-4 py-1.5">
          <TableToolbar
            search={{
              label: "Search Targets",
              placeholder: "Name, alias, or RA Dec (°)",
              value: query,
              onChange: (value) => setParams({ q: value }),
            }}
            filters={
              <ToggleGroup
                aria-label="Show"
                variant="outline"
                size="sm"
                spacing={0}
                value={[scope.value]}
                onValueChange={(value) => value[0] && setParams({ show: value[0] as string })}
              >
                {SCOPES.map((item) => (
                  <ToggleGroupItem key={item.value} value={item.value} className="gap-1.5 px-2.5">
                    {item.label}
                    <span className="text-xs text-muted-foreground tabular-nums">{matched.filter((s) => item.test(s)).length}</span>
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
            }
            actions={
              <p className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
                {coords
                  ? `${plural(rows.length, "Target")} within ${COORDINATE_SEARCH_RADIUS_DEG}° of RA ${coords.ra}°, Dec ${coords.dec}°, nearest first`
                  : `${plural(rows.length, "matching Target")}`}
              </p>
            }
          />
        </div>
      ) : null}
      <PageBody className="space-y-3">
        <LibraryStatus kind="light" notes={unresolvedNotes} />
        {summaries.length === 0 ? (
          indexing ? (
            <TableSkeleton label="Reading session metadata; Targets appear as sessions are read" columns={5} />
          ) : (
            <EmptyState
              icon={Crosshair}
              titleAs="h2"
              title="No Targets yet"
              description={
                hasLocations
                  ? "Targets appear when indexed sessions carry pointing or OBJECT evidence. You can also add one with Add Target."
                  : "Targets appear after a capture location is indexed. You can also add one with Add Target."
              }
              action={
                // One first-run next step across the library pages; Add Target stays in the header.
                hasLocations ? (
                  <Button size="sm" render={<Link to="/sessions" />}>
                    Go to Sessions
                  </Button>
                ) : (
                  <Button size="sm" render={<Link to="/settings/locations" />}>
                    Add a capture location
                  </Button>
                )
              }
            />
          )
        ) : (
          <DataTable
            key={coords ? "coordinates" : "default"}
            label="Targets"
            rows={rows}
            columns={columns}
            getRowId={(r) => r.target.id}
            activeRowId={cursor?.target.id ?? null}
            onCursorChange={setCursorId}
            scroll="none"
            initialSort={coords ? { columnId: "distance", direction: "asc" } : { columnId: "coverage", direction: "desc" }}
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
        )}
      </PageBody>
      {cursor ? <TargetInspector summary={cursor} /> : null}
      <TargetRecordDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        initialName={coords ? "" : query}
        onCreated={(targetId) => navigate({ to: "/targets/$targetId", params: { targetId } })}
      />
    </div>
  )
}

/** The cursor Target: where it is (value beside its source), what the library holds by channel, and its work. */
function TargetInspector({ summary }: { summary: TargetSummary }) {
  const { target } = summary
  const channels = useStore((s) => targetCoverage(s.disk, s.catalog, target.id).channels)
  const work = useStore((s) => {
    const views = viewsForTarget(s.catalog, target.id)
    return { views: views.length, results: acceptedResultsForViews(s.catalog, views).length }
  })
  return (
    <Inspector title={target.name}>
      <InspectorSection title="Target">
        <p className="text-sm font-medium">{target.name}</p>
        {target.aliases.length > 0 ? <p className="text-xs text-muted-foreground">{target.aliases.join(" · ")}</p> : null}
      </InspectorSection>
      <InspectorSection title="Position">
        <PropertyList
          rows={[
            {
              label: "RA",
              value: target.ra !== null ? formatRa(target.ra) : <span className="text-muted-foreground">Unknown</span>,
              source: target.ra !== null ? COORDINATE_SOURCE[target.coordinateSource] : undefined,
            },
            { label: "Dec", value: target.dec !== null ? formatDec(target.dec) : <span className="text-muted-foreground">Unknown</span> },
            { label: "Size", value: target.sizeDeg ? `${formatDegrees(target.sizeDeg.width)} × ${formatDegrees(target.sizeDeg.height)}` : <span className="text-muted-foreground">Unknown</span> },
          ]}
        />
      </InspectorSection>
      <InspectorSection title="Coverage by channel">
        {channels.length === 0 ? (
          <p className="text-xs text-muted-foreground">No associated light sessions yet.</p>
        ) : (
          <table className="w-full text-xs tabular-nums">
            <caption className="sr-only">Coverage of {target.name} by channel</caption>
            <thead className="text-muted-foreground" data-chrome>
              <tr>
                <th scope="col" className="pb-1 text-left font-medium">
                  Channel
                </th>
                <th scope="col" className="pb-1 text-right font-medium">
                  Captured
                </th>
                <th scope="col" className="pb-1 text-right font-medium">
                  Usable
                </th>
                <th scope="col" className="pb-1 text-right font-medium">
                  Unreviewed
                </th>
              </tr>
            </thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.channel} className="h-6 border-t">
                  <th scope="row" className="text-left font-medium">
                    {c.channel}
                  </th>
                  <td className="text-right">{formatDuration(c.breakdown.captured.seconds)}</td>
                  <td className="text-right">{formatDuration(c.breakdown.usable.seconds)}</td>
                  <td className="text-right">{formatDuration(c.breakdown.unreviewed.seconds)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {summary.needsReview > 0 ? (
          <p className="mt-1.5 flex items-start gap-1 text-xs text-warning">
            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
            {plural(summary.needsReview, "session")} not counted until reviewed
          </p>
        ) : null}
      </InspectorSection>
      <InspectorSection title="Work">
        <PropertyList
          rows={[
            { label: "Projects", value: summary.projects },
            { label: "Views", value: work.views },
            { label: "Results", value: work.results, source: "accepted" },
            { label: "Plan", value: summary.planned ? "Planned" : "Not planned" },
          ]}
        />
        <div className="mt-2.5 flex flex-wrap gap-1.5" data-chrome>
          <Button size="sm" render={<Link to="/targets/$targetId" params={{ targetId: target.id }} />}>
            Open {target.name}
          </Button>
          <Button size="sm" variant="outline" render={<Link to="/targets/$targetId/plan" params={{ targetId: target.id }} />}>
            Plan
          </Button>
        </div>
      </InspectorSection>
    </Inspector>
  )
}
