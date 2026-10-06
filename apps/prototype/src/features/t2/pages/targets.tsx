/**
 * Targets (`/targets`), the default home: local Target search by name,
 * alias or coordinates, coverage per Target, Needs review counts and the
 * planned flag. Works with no account or network (J20 S1; LIB-FR-08,
 * LIB-FR-10, LIB-FR-13, LIB-AC-09).
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { CalendarClock, Crosshair, PanelRightClose, PanelRightOpen, TriangleAlert, Unplug } from "lucide-react"
import { useId, useState } from "react"
import { toggleInspector, useShellUi } from "@/app/ui-state"
import { ChannelCoverage, KeyValueList } from "@/components/app/data"
import { type Column, DataTable, TableToolbar } from "@/components/app/data-table"
import { EmptyState, TableSkeleton } from "@/components/app/feedback"
import { InspectorSection, InspectorSplit } from "@/components/app/inspector"
import { PageBody, PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { targetCoverage } from "@/domain/derive"
import type { Target } from "@/domain/types"
import { computeWindows, defaultCriteria } from "@/features/t5/lib/planning"
import { usePlateVaultNow } from "@/features/t5/plans"
import { formatDec, formatDegrees, formatDuration, formatRa, formatTime, plural } from "@/lib/format"
import type { SearchParams } from "@/routes"
import { useStore } from "@/store/core"
import { activeIndexOperations, currentSessions, parseCoordinates, searchTargets, type TargetSummary, targetSummary, COORDINATE_SEARCH_RADIUS_DEG } from "../model"
import { type LibraryNote, LibraryStatus } from "../parts"
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
  const inspectorId = useId()
  const { inspectorOpen } = useShellUi()
  // The inspector follows the clicked or focused row, as Finder's preview pane does.
  const [currentId, setCurrentId] = useState<string | null>(null)

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

  const current = rows.find((r) => r.target.id === currentId) ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Targets"
        description="What your library holds for each sky subject. Search works offline, by name, alias or coordinates."
        actions={
          <>
            <Button variant="outline" aria-expanded={inspectorOpen} aria-controls={inspectorOpen ? inspectorId : undefined} aria-keyshortcuts="Alt+Meta+0" onClick={toggleInspector}>
              {inspectorOpen ? <PanelRightClose aria-hidden="true" data-icon="inline-start" /> : <PanelRightOpen aria-hidden="true" data-icon="inline-start" />}
              {inspectorOpen ? "Hide inspector" : "Show inspector"}
            </Button>
            <Button variant="outline" onClick={() => setAddOpen(true)}>
              Add Target
            </Button>
          </>
        }
      />
      <PageBody className="space-y-4">
        <LibraryStatus kind="light" notes={unresolvedNotes} />
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
          <InspectorSplit
            id={inspectorId}
            label={current ? `Inspector: ${current.target.name}` : "Target inspector"}
            inspector={current ? <TargetInspector target={current.target} /> : <p className="p-3 text-sm text-muted-foreground">Select a Target in the list to see its integration, Projects and tonight's window here.</p>}
            content={
          <div className="space-y-4">
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
            {/* ⌘↓ opens the current row's Target, as Finder's Open does; the menu lists the same key. */}
            <div
              onKeyDownCapture={(event) => {
                if (!(event.metaKey || event.ctrlKey) || event.key !== "ArrowDown") return
                const id = (event.target as HTMLElement).closest<HTMLElement>("tr[data-row-id]")?.dataset.rowId
                if (!id) return
                event.preventDefault()
                event.stopPropagation()
                navigate({ to: "/targets/$targetId", params: { targetId: id } })
              }}
            >
            <DataTable
              key={coords ? "coordinates" : "default"}
              label="Targets"
              rows={rows}
              columns={columns}
              getRowId={(r) => r.target.id}
              initialSort={coords ? { columnId: "distance", direction: "asc" } : { columnId: "captured", direction: "desc" }}
              activeRowId={inspectorOpen ? (current?.target.id ?? null) : null}
              onRowFocus={(r) => setCurrentId(r.target.id)}
              rowMenu={{
                label: (r) => `Actions for ${r.target.name}`,
                items: (r) => [
                  { label: "Open Target", shortcut: "⌘↓", keys: "Meta+ArrowDown", onSelect: () => navigate({ to: "/targets/$targetId", params: { targetId: r.target.id } }) },
                  { label: "Plan Target", onSelect: () => navigate({ to: "/targets/$targetId/plan", params: { targetId: r.target.id } }) },
                  {
                    label: inspectorOpen ? "Hide inspector" : "Show in inspector",
                    shortcut: "⌥⌘0",
                    keys: "Alt+Meta+0",
                    group: true,
                    onSelect: () => {
                      setCurrentId(r.target.id)
                      toggleInspector()
                    },
                  },
                  { label: "Copy name", onSelect: () => void navigator.clipboard?.writeText(r.target.name) },
                ],
              }}
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
            </div>
          </div>
            }
          />
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

/**
 * Target inspector (HARNESS V1): identity, per-channel integration, Projects
 * and tonight's window at the planning site, with the two next steps. Read
 * only: every value comes from the same derivations the Target page uses.
 */
function TargetInspector({ target }: { target: Target }) {
  const disk = useStore((s) => s.disk)
  const catalog = useStore((s) => s.catalog)
  const planningSiteId = useStore((s) => s.settings.planningSiteId)
  const now = usePlateVaultNow()
  const coverage = targetCoverage(disk, catalog, target.id)
  const projects = Object.values(catalog.projects).filter((p) => p.targetIds.includes(target.id))
  const site = planningSiteId ? (catalog.sites[planningSiteId] ?? null) : null
  const plan = catalog.plans[target.id]
  const tonight = site ? computeWindows(target, site, plan?.criteria ?? defaultCriteria(site), now, 1) : []
  return (
    <>
      <InspectorSection title="Target">
        <p className="text-lg font-semibold">{target.name}</p>
        {target.aliases.length > 0 ? <p className="mb-2 text-xs text-muted-foreground">{target.aliases.slice(0, 4).join(" · ")}</p> : null}
        <KeyValueList
          items={[
            { label: "RA", value: target.ra === null ? "Unknown" : formatRa(target.ra), mono: true },
            { label: "Dec", value: target.dec === null ? "Unknown" : formatDec(target.dec), mono: true },
            { label: "Plan", value: plan?.planned ? "Planned" : "Not planned" },
          ]}
        />
      </InspectorSection>
      <InspectorSection title="Integration by channel">
        {coverage.channels.length === 0 ? (
          <p className="text-sm text-muted-foreground">No light sessions yet.</p>
        ) : (
          <div className="space-y-3">
            {coverage.channels.map((c) => (
              <ChannelCoverage key={c.channel} channel={c.channel} breakdown={c.breakdown} />
            ))}
          </div>
        )}
      </InspectorSection>
      <InspectorSection title="Tonight">
        {!site ? (
          <p className="text-sm text-muted-foreground">No planning site chosen. Plan picks none for you.</p>
        ) : target.ra === null || target.dec === null ? (
          <p className="text-sm text-muted-foreground">Position unknown, so no window can be calculated.</p>
        ) : tonight.length === 0 ? (
          <p className="text-sm text-muted-foreground">No window tonight at {site.name} with {plan ? "this plan's" : "the default"} criteria.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {tonight.map((w) => (
              <li key={w.key} className="num">
                {formatTime(w.start, site.timeZone)}–{formatTime(w.end, site.timeZone)} · {formatDuration((Date.parse(w.end) - Date.parse(w.start)) / 1000)} · up to {formatDegrees(w.maxAltitudeDeg, 0)}
                <span className="block text-xs text-muted-foreground">at {site.name}, Moon {w.moonIlluminationPct}% lit</span>
              </li>
            ))}
          </ul>
        )}
      </InspectorSection>
      <InspectorSection title="Projects">
        {projects.length === 0 ? (
          <p className="text-sm text-muted-foreground">No Project targets {target.name}.</p>
        ) : (
          <ul className="space-y-1 text-sm">
            {projects.map((p) => (
              <li key={p.id}>
                <Link to="/projects/$projectId" params={{ projectId: p.id }} className="underline-offset-2 hover:underline">
                  {p.name}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </InspectorSection>
      <div className="flex flex-wrap gap-2 px-3 py-2.5">
        <Button size="sm" render={<Link to="/targets/$targetId" params={{ targetId: target.id }} />}>
          Open {target.name}
        </Button>
        <Button size="sm" variant="outline" render={<Link to="/targets/$targetId/plan" params={{ targetId: target.id }} />}>
          <CalendarClock aria-hidden="true" data-icon="inline-start" />
          Plan
        </Button>
      </div>
    </>
  )
}
