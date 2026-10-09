/**
 * S10 Targets (`/targets`, slice E): v4's dense finder pattern grown into the
 * planning table of D-W17 to D-W19, D-W23 and D-W60 to D-W62.
 *
 * - Show: My targets (★ favourites plus open-Project subjects with a Project
 *   badge) or Browse catalogues, which lists nothing until a catalogue or a
 *   preset is chosen. "Open in Planner" (`?project=`) limits the list to the
 *   Project's subjects with the rig set to this Project's rigs (PLAN-FR-10).
 * - Search covers My targets, the library, the bundled catalogues and SIMBAD
 *   and offers Add to targets; with SIMBAD unreachable or lookup off the
 *   results say SIMBAD was not searched.
 * - Columns: ★, Designation, Type, Max alt, Lunar, Img time, Filters,
 *   Opposition, Sessions, Captured; Fit with a rig selected; Source while
 *   searching. Every column but ★ sorts; unknown values sort last. The Moon
 *   appears once, in the toolbar.
 * - Presets: the built-ins, Mosaic candidates and Fits nicely with a rig, and
 *   saved presets (rename, delete). Narrowband presets hide without a
 *   narrowband filter on the selected rig.
 *
 * The view lives in the URL (`mode`, `cat`, `preset`, `rig`, `sort`, `q`,
 * `project`, `saved`), so opening a Target and coming back keeps it.
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ArrowDown, ArrowUp, ArrowUpDown, Crosshair, MoreHorizontal, Plus, Search, Star, X } from "lucide-react"
import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { ActionError, EmptyState, Notice, UnknownValue } from "@/components/app/feedback"
import { PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { openSheet } from "@/app/ui-state"
import { formatHours } from "@/domain/derive"
import type { OpticalTrainId } from "@/domain/types"
import { formatNight, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { SearchParams } from "@/routes"
import { setFavourite } from "@/store/actions/library"
import { store, useStore } from "@/store/core"
import type { SavedTargetPreset } from "@/store/slices/e"
import { CATALOGUES, type CatalogueId } from "@/domain/sky"
import { NameDialog } from "./dialogs"
import { AddSiteButton, BandStrip, CapturedCell, FitCell, MoonLine, ProjectBadge, SiteLine, useSkyContext } from "./parts"
import {
  addToMyTargets,
  allRows,
  BUILT_IN_PRESETS,
  browseRows,
  formatSort,
  myTargetRows,
  parseSort,
  presetById,
  presetUnavailable,
  projectRows,
  type RowView,
  rowView,
  type SortColumn,
  type SortSpec,
  searchRows,
  selectionBands,
  sessionCountsByTarget,
  sortViews,
  type TargetRow,
} from "./targets-model"
import { deletePreset, describeView, renamePreset, savedPresetUnavailable, savePreset, VIEW_KEYS } from "./targets-presets"

/** Opposition as "2 Nov", or "2 Aug ’27" when it falls in another year. */
function shortDate(night: string, nowMs: number): string {
  const label = formatNight(night)
  return night.slice(0, 4) === String(new Date(nowMs).getUTCFullYear()) ? label : `${label} ’${night.slice(2, 4)}`
}

const DEFAULT_SORT: SortSpec = { column: "designation", direction: "asc" }

/** Simulated SIMBAD round trip, long enough to show "Searching SIMBAD…". */
const SIMBAD_MS = 450

type SimbadState = { query: string; status: "searching" | "searched" | "off" | "unreachable" }

function useSimbad(query: string): [SimbadState | null, () => void] {
  const enabled = useStore((s) => s.settings.targetLookup.enabled)
  const [state, setState] = useState<SimbadState | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    const q = query.trim()
    if (q.length < 2) return setState(null)
    if (!enabled) return setState({ query: q, status: "off" })
    setState({ query: q, status: "searching" })
    const timer = window.setTimeout(() => {
      if (store.getState().faults.failNextResolverLookup) {
        // The prototype fault: this lookup fails as if offline (LIB-AC-12).
        store.setState((s) => ({ ...s, faults: { ...s.faults, failNextResolverLookup: false } }))
        setState({ query: q, status: "unreachable" })
      } else setState({ query: q, status: "searched" })
    }, SIMBAD_MS)
    return () => window.clearTimeout(timer)
  }, [query, enabled, attempt])
  return [state, () => setAttempt((n) => n + 1)]
}

interface ColumnDef {
  id: SortColumn | "star" | "actions" | "filters"
  header: string
  sortable: boolean
  align?: "right"
  className?: string
  cell: (view: RowView) => ReactNode
}

function dash(reason: string) {
  return <UnknownValue label="–" reason={reason} />
}

export function TargetsPage() {
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const saved = useStore((s) => s.slices.e.savedPresets)
  const ctx = useSkyContext()
  const [simbad, retrySimbad] = useSimbad(search.q ?? "")
  const [adding, setAdding] = useState<{ key: string; message: string; row: TargetRow } | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [renaming, setRenaming] = useState<SavedTargetPreset | null>(null)
  const [deleting, setDeleting] = useState<SavedTargetPreset | null>(null)
  const [menuKey, setMenuKey] = useState<string | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)

  const query = search.q ?? ""
  // The field keeps its own value while focused, so fast typing never races the URL update.
  const [draftQuery, setDraftQuery] = useState(query)
  const typed = useRef(query)
  useEffect(() => {
    // A query that did not come from typing here (Clear search, a link, the palette) replaces the field.
    if (query !== typed.current) {
      typed.current = query
      setDraftQuery(query)
    }
  }, [query])
  const project = search.project ? catalog.projects[search.project] : undefined
  const mode: "my" | "browse" = search.mode === "browse" ? "browse" : "my"
  const catalogues = (search.cat ?? "").split(",").filter((c): c is CatalogueId => (CATALOGUES as readonly string[]).includes(c))
  const rigParam = search.rig ?? (project ? "project" : "none")
  const rigIds: OpticalTrainId[] = rigParam === "project" ? (project?.rigIds ?? []) : rigParam !== "none" && catalog.opticalTrains[rigParam] ? [rigParam] : []
  const bands = selectionBands(catalog, rigIds)
  const preset = presetById(search.preset)
  const presetBlocked = preset ? presetUnavailable(preset, rigIds, bands) : null
  const activePreset = preset && !presetBlocked && !query ? preset : undefined
  const sort = parseSort(search.sort) ?? activePreset?.sort ?? DEFAULT_SORT
  const activeSaved = search.saved ? saved.find((p) => p.id === search.saved) : undefined

  function setParams(patch: SearchParams) {
    navigate({
      to: "/targets",
      search: (previous: SearchParams) => {
        const next: SearchParams = { ...previous, ...patch }
        for (const key of Object.keys(next)) if (next[key] === undefined || next[key] === "") delete next[key]
        return next
      },
      replace: true,
    } as never)
  }

  const rows = useMemo(() => allRows(catalog), [catalog])
  const searched = useMemo(() => (query.trim() ? searchRows(rows, query, simbad?.status === "searched" && simbad.query === query.trim()) : null), [rows, query, simbad])
  const baseRows = searched ? searched.rows : project ? projectRows(rows, project) : mode === "browse" ? (catalogues.length > 0 || activePreset ? browseRows(rows, catalogues) : []) : myTargetRows(rows)
  const counts = useMemo(() => sessionCountsByTarget(catalog), [catalog])
  const rigKey = rigIds.join(",")
  const views = useMemo(() => baseRows.map((row) => rowView(catalog, disk, ctx, row, rigIds, counts)), [baseRows, catalog, disk, ctx, rigKey, counts])
  const filtered = activePreset ? views.filter(activePreset.match) : views
  const shown = sortViews(filtered, sort, searched?.source)

  function toggleSort(column: SortColumn) {
    const next: SortSpec = sort.column === column ? { column, direction: sort.direction === "asc" ? "desc" : "asc" } : { column, direction: column === "img" || column === "maxAlt" || column === "captured" || column === "sessions" ? "desc" : "asc" }
    setParams({ sort: formatSort(next), saved: undefined })
  }

  function add(row: TargetRow) {
    const { result } = addToMyTargets(row)
    setAdding(result.ok ? null : { key: row.key, message: result.message, row })
  }

  function toggleStar(view: RowView) {
    const target = view.row.target
    if (!target) return add(view.row)
    const result = setFavourite(target.id, !target.favourite)
    setAdding(result.ok ? null : { key: view.row.key, message: result.message, row: view.row })
  }

  function applySaved(preset: SavedTargetPreset) {
    const patch: SearchParams = { saved: preset.id, q: undefined }
    for (const key of VIEW_KEYS) patch[key] = preset.view[key]
    setParams(patch)
  }

  const site = ctx?.site ?? null
  const noSite = "Add an observing site in Settings to see tonight's values."
  const skyCell = (view: RowView, render: (sky: Extract<RowView["sky"], { status: "ok" }>) => ReactNode) =>
    view.sky.status === "no-site" ? dash(noSite) : view.sky.status === "no-coordinates" ? dash(view.sky.reason) : render(view.sky)

  const columns: ColumnDef[] = [
    {
      id: "star",
      header: "★",
      sortable: false,
      className: "w-8 px-2",
      cell: (v) => {
        const starred = v.row.target?.favourite ?? false
        return (
          <button
            type="button"
            data-star
            aria-pressed={starred}
            aria-label={starred ? `Remove ${v.row.designation} from favourites` : v.row.target ? `Add ${v.row.designation} to favourites` : `Add ${v.row.designation} to targets`}
            onClick={() => toggleStar(v)}
            className="inline-flex size-6 items-center justify-center rounded-sm text-muted-foreground hover:text-foreground"
          >
            <Star aria-hidden="true" className={cn("size-3.5", starred && "fill-warning text-warning")} />
          </button>
        )
      },
    },
    {
      id: "designation",
      header: "Designation",
      sortable: true,
      className: "min-w-32",
      cell: (v) => (
        <span className="flex min-w-0 items-center gap-1.5" title={[v.row.designation, ...v.row.aliases.slice(0, 2)].join(" · ")}>
          {v.row.target ? (
            <Link to="/targets/$targetId" params={{ targetId: v.row.target.id }} search={keepSearch(search)} data-row-link className="font-medium hover:underline">
              {v.row.designation}
            </Link>
          ) : (
            <span className="font-medium" data-row-link tabIndex={-1}>
              {v.row.designation}
            </span>
          )}
          {/* The first alias needs the width of a 1600 px window; below that it stays in the tooltip. */}
          {v.row.aliases[0] ? <span className="hidden max-w-36 truncate text-xs text-muted-foreground min-[100rem]:inline">{v.row.aliases[0]}</span> : null}
          {v.row.projects.map((p) => (
            <ProjectBadge key={p.id} project={p} />
          ))}
        </span>
      ),
    },
    { id: "type", header: "Type", sortable: true, className: "max-w-32 truncate", cell: (v) => (v.row.objectType ? <span title={v.row.objectType}>{v.row.objectType}</span> : dash("Object type unknown")) },
    {
      id: "maxAlt",
      header: "Max alt",
      sortable: true,
      align: "right",
      cell: (v) => skyCell(v, (sky) => (sky.peakDeg === null ? dash("No darkness tonight") : `${Math.round(sky.peakDeg)}°`.replace("-", "−"))),
    },
    { id: "lunar", header: "Lunar", sortable: true, align: "right", cell: (v) => skyCell(v, (sky) => `${Math.round(sky.lunarDeg)}°`) },
    {
      id: "img",
      header: "Img time",
      sortable: true,
      align: "right",
      cell: (v) =>
        skyCell(v, (sky) =>
          sky.imgTimeS > 0 ? (
            formatHours(sky.imgTimeS)
          ) : (
            <span title={sky.zeroReason ?? undefined}>
              0h <span className="text-xs text-muted-foreground">{sky.zeroReason?.split(":")[0]?.toLowerCase()}</span>
              <span className="sr-only">: {sky.zeroReason}</span>
            </span>
          ),
        ),
    },
    { id: "filters", header: "Filters", sortable: false, cell: (v) => (v.sky.status === "ok" ? <BandStrip cells={v.strip.cells} recommendation={v.strip.recommendation} /> : <BandStrip cells={v.strip.cells} recommendation="Moon unknown" />) },
    // Fit sits beside the band strip: both follow the rig selector (D-W23).
    ...(rigIds.length > 0 ? [{ id: "fit" as const, header: rigIds.length > 1 ? "Fit per rig" : "Fit", sortable: true, cell: (v: RowView) => <FitCell fits={v.fits} /> }] : []),
    {
      id: "opposition",
      header: "Opposition",
      sortable: true,
      cell: (v) => (v.opposition ? shortDate(v.opposition, ctx?.nowMs ?? Date.now()) : dash(v.row.ra === null ? "No catalogued coordinates" : noSite)),
    },
    { id: "sessions", header: "Sessions", sortable: true, align: "right", cell: (v) => (v.sessions > 0 ? v.sessions : <span className="text-muted-foreground">–</span>) },
    { id: "captured", header: "Captured", sortable: true, className: "max-w-40 truncate", cell: (v) => <CapturedCell captured={v.captured} /> },
  ]
  if (searched) columns.push({ id: "source", header: "Source", sortable: true, cell: (v) => <span className="text-xs">{searched.source.get(v.row.key)}</span> })
  columns.push({
    id: "actions",
    header: "Actions",
    sortable: false,
    className: "w-px",
    cell: (v) =>
      v.row.mine ? null : (
        <Button size="xs" variant="outline" onClick={() => add(v.row)}>
          <Plus aria-hidden="true" data-icon="inline-start" />
          Add to targets<span className="sr-only">: {v.row.designation}</span>
        </Button>
      ),
  })

  function onKeyDown(event: KeyboardEvent<HTMLTableSectionElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    const cell = (event.target as HTMLElement).closest("td, th")
    const row = cell?.closest<HTMLElement>("tr[data-row]")
    if (!cell || !row) return
    const all = Array.from(row.parentElement?.querySelectorAll<HTMLElement>("tr[data-row]") ?? [])
    const sibling = all[all.indexOf(row) + (event.key === "ArrowDown" ? 1 : -1)]
    const index = Array.from(row.children).indexOf(cell)
    const next = sibling?.children[index]?.querySelector<HTMLElement>("a, button") ?? sibling?.querySelector<HTMLElement>("a, button")
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  function onContextMenu(event: MouseEvent) {
    const key = (event.target as HTMLElement).closest("tr[data-row-key]")?.getAttribute("data-row-key") ?? null
    if (key === null) event.stopPropagation()
    else setMenuKey(key)
  }
  const menuView = menuKey ? shown.find((v) => v.row.key === menuKey) : undefined

  const visiblePresets = BUILT_IN_PRESETS.filter((p) => !(p.needs === "rig" && rigIds.length === 0) && !(p.needs === "narrowband" && presetUnavailable(p, rigIds, bands)))
  const hiddenNarrow = BUILT_IN_PRESETS.filter((p) => p.needs === "narrowband" && presetUnavailable(p, rigIds, bands))
  const rigItems = [
    { value: "none", label: "No rig" },
    ...Object.values(catalog.opticalTrains)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => ({ value: r.id, label: r.name })),
    ...(project ? [{ value: "project", label: `This Project's rigs (${project.rigIds.length})` }] : []),
  ]
  const currentView: SavedTargetPreset["view"] = { mode, cat: catalogues.join(",") || undefined, preset: activePreset?.id, rig: rigParam !== "none" && rigParam !== "project" ? rigParam : undefined, sort: search.sort }

  const emptyState = (() => {
    if (searched)
      return <EmptyState icon={Search} title={`No target matches “${query}”`} description="Search ignores case and spaces, so M31, M 31 and m31 match. It covers My targets, the library, the bundled catalogues and SIMBAD." action={<Button size="sm" variant="outline" onClick={() => setParams({ q: undefined })}>Clear search</Button>} />
    if (mode === "browse" && !project && catalogues.length === 0 && !activePreset)
      return <EmptyState icon={Crosshair} title="Choose a catalogue or a preset" description="Browse catalogues lists rows only once a bundled catalogue or a preset is chosen." action={<Button size="sm" onClick={() => setParams({ cat: "Messier" })}>Browse Messier</Button>} />
    if (activePreset)
      return <EmptyState icon={Crosshair} title={`No target matches ${activePreset.label}`} description={activePreset.definition} action={<Button size="sm" variant="outline" onClick={() => setParams({ preset: undefined, saved: undefined })}>Clear preset</Button>} />
    return <EmptyState icon={Star} title="My targets is empty" description="★ a Target, or add a subject to an open Project, and it is listed here." action={<Button size="sm" onClick={() => setParams({ mode: "browse", cat: "Messier" })}>Browse catalogues</Button>} />
  })()

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Targets"
        description="What to shoot and what you hold: tonight's values at the planning site, Fit on your rigs and captured time per channel."
        actions={
          <Button variant="outline" onClick={() => setSaveOpen(true)} disabled={Boolean(query)} title={query ? "Clear the search to save the view as a preset" : undefined}>
            Save preset…
          </Button>
        }
      />
      <div data-chrome className="space-y-2 border-b border-separator px-5 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {project ? null : (
            <div role="radiogroup" aria-label="Show" className="inline-flex rounded-md border border-separator p-px">
              {(["my", "browse"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={mode === m}
                  onClick={() => setParams({ mode: m === "my" ? undefined : "browse", saved: undefined })}
                  className={cn("h-6 rounded-[4px] px-2 text-sm", mode === m ? "bg-selected text-selected-foreground" : "text-foreground/85 hover:bg-foreground/[0.06]")}
                >
                  {m === "my" ? "My targets" : "Browse catalogues"}
                </button>
              ))}
            </div>
          )}
          <div className="relative w-72 min-w-0">
            <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              ref={searchRef}
              data-page-search
              type="search"
              aria-label="Search targets, catalogues and SIMBAD"
              placeholder="Targets, catalogues, SIMBAD"
              value={draftQuery}
              onChange={(event) => {
                typed.current = event.target.value
                setDraftQuery(event.target.value)
                setParams({ q: event.target.value || undefined })
              }}
              className="pl-7"
            />
          </div>
          <Select items={rigItems} value={rigItems.some((i) => i.value === rigParam) ? rigParam : "none"} onValueChange={(value) => setParams({ rig: value === (project ? "project" : "none") ? undefined : (value as string), saved: undefined })}>
            <SelectTrigger size="sm" aria-label="Rig" className="w-56 min-w-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {rigItems.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex-1" />
          {ctx ? (
            <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
              <MoonLine ctx={ctx} />
              <SiteLine site={ctx.site} />
            </span>
          ) : (
            <AddSiteButton returnTo="/targets" />
          )}
        </div>
        {mode === "browse" && !project && !query ? (
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Catalogues">
            <span className="mr-1 text-xs text-muted-foreground">Catalogues</span>
            {CATALOGUES.map((c) => {
              const on = catalogues.includes(c)
              return (
                <button
                  key={c}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setParams({ cat: (on ? catalogues.filter((x) => x !== c) : [...catalogues, c]).join(",") || undefined, saved: undefined })}
                  className={cn("h-6 rounded-md border px-2 text-xs", on ? "border-transparent bg-selected text-selected-foreground" : "border-separator text-foreground/85 hover:bg-foreground/[0.06]")}
                >
                  {c}
                </button>
              )
            })}
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Presets">
          <span className="mr-1 text-xs text-muted-foreground">Presets</span>
          {visiblePresets.map((p) => {
            const on = activePreset?.id === p.id && !activeSaved
            return (
              <button
                key={p.id}
                type="button"
                aria-pressed={on}
                title={p.definition}
                disabled={Boolean(query)}
                onClick={() => setParams({ preset: on ? undefined : p.id, sort: undefined, saved: undefined })}
                className={cn("h-6 rounded-md border px-2 text-xs disabled:opacity-50", on ? "border-transparent bg-selected text-selected-foreground" : "border-separator text-foreground/85 hover:bg-foreground/[0.06]")}
              >
                {p.label}
              </button>
            )
          })}
          {saved.length > 0 ? <span aria-hidden="true" className="mx-1 h-4 w-px bg-separator" /> : null}
          {saved.map((p) => {
            const blocked = savedPresetUnavailable(catalog, p.view)
            const on = activeSaved?.id === p.id
            return (
              <span key={p.id} className={cn("inline-flex h-6 items-center rounded-md border", on ? "border-transparent bg-selected text-selected-foreground" : "border-separator")}>
                <button
                  type="button"
                  aria-pressed={on}
                  disabled={Boolean(blocked) || Boolean(query)}
                  title={blocked ?? describeView(catalog, p.view)}
                  onClick={() => (on ? setParams({ saved: undefined, preset: undefined, sort: undefined }) : applySaved(p))}
                  className="h-full px-2 text-xs disabled:opacity-50"
                >
                  {p.name}
                  {blocked ? <span className="sr-only">: unavailable, {blocked}</span> : null}
                </button>
                <DropdownMenu>
                  <DropdownMenuTrigger render={<button type="button" aria-label={`More for ${p.name}`} className="inline-flex h-full items-center border-l border-separator/70 px-1" />}>
                    <MoreHorizontal aria-hidden="true" className="size-3.5" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent>
                    <DropdownMenuItem onClick={() => setRenaming(p)}>Rename…</DropdownMenuItem>
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleting(p)}>
                      Delete…
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            )
          })}
        </div>
        <p className="text-[0.75rem] text-muted-foreground" aria-live="polite">
          {query
            ? "Search covers every row: My targets, the library, the bundled catalogues and SIMBAD. Presets apply again when the search is cleared."
            : activePreset
              ? `${activePreset.label}: ${activePreset.definition}`
              : presetBlocked && preset
                ? `${preset.label} is not available: ${presetBlocked}.`
                : rigIds.length === 0
                  ? "Choose a rig to add Fit, Mosaic candidates and Fits nicely, and to show only the bands it passes."
                  : `${rigIds.length > 1 ? "This Project's rigs pass" : "The rig passes"} ${bands.join(", ") || "no bands"}.${hiddenNarrow.length > 0 ? ` Hidden without a narrowband filter: ${hiddenNarrow.map((p) => p.label).join(", ")}.` : ""}`}
        </p>
      </div>

      {project ? (
        <div className="px-5 pt-2">
          <Notice
            tone="info"
            title={`Planning for ${project.name}: its ${plural(project.subjects.length, "subject")}`}
            actions={
              <>
                <Button size="sm" variant="outline" onClick={() => setParams({ project: undefined, rig: undefined })}>
                  <X aria-hidden="true" data-icon="inline-start" />
                  Clear Project context
                </Button>
                <Button size="sm" variant="outline" render={<Link to="/projects/$projectId" params={{ projectId: project.id }} />}>
                  Open {project.name}
                </Button>
                <Button size="sm" variant="outline" render={<Link to="/plan" search={{ project: project.id }} />}>
                  Tonight for {project.name}
                </Button>
              </>
            }
          >
            The rig selector starts at this Project's rigs. Clearing the context returns the list to My targets.
          </Notice>
        </div>
      ) : null}
      {!ctx ? (
        <div className="px-5 pt-2">
          <Notice tone="warning" title="No observing site: planning columns show –">
            Max alt, Lunar, Img time and Opposition need a planning site. Search, Add to targets, ★ and Sessions still work.
          </Notice>
        </div>
      ) : null}
      {searched && simbad ? (
        <div className="px-5 pt-2">
          {simbad.status === "searching" ? (
            <p className="text-[0.75rem] text-muted-foreground" role="status">
              Searching SIMBAD…
            </p>
          ) : simbad.status === "off" ? (
            <Notice tone="offline" title="SIMBAD not searched: online lookup is off" actions={<Button size="sm" variant="outline" render={<Link to="/settings/targets" search={{ return: "/targets" }} />}>Open Target lookup</Button>}>
              Results come from My targets, the library and the bundled catalogues only.
            </Notice>
          ) : simbad.status === "unreachable" ? (
            <Notice tone="offline" title="SIMBAD not searched: SIMBAD could not be reached" actions={<Button size="sm" variant="outline" onClick={retrySimbad}>Retry SIMBAD</Button>}>
              Results come from My targets, the library and the bundled catalogues only. Nothing was written.
            </Notice>
          ) : (
            <p className="text-[0.75rem] text-muted-foreground" role="status">
              SIMBAD searched. Prototype: SIMBAD answers from fixture data.
            </p>
          )}
        </div>
      ) : null}
      {adding ? (
        <div className="px-5 pt-2">
          <ActionError message={adding.message} onRetry={() => add(adding.row)} />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 px-5 py-2">
        <ContextMenu>
          <ContextMenuTrigger className="relative block h-full overflow-auto rounded-md border bg-background scroll-pt-[calc(var(--row-h)+1px)]" data-targets-table>
            <table className="w-full text-sm" onContextMenu={onContextMenu}>
              <caption className="sr-only">
                {searched ? `Search results for ${query}` : project ? `${project.name} subjects` : mode === "browse" ? "Browse catalogues" : "My targets"}, {plural(shown.length, "row")}
              </caption>
              <thead data-chrome className="sticky top-0 z-10 bg-[color-mix(in_oklch,var(--chrome)_70%,var(--background))] text-[0.6875rem] font-medium text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]">
                <tr>
                  {columns.map((c) => {
                    const active = sort.column === c.id
                    return (
                      <th
                        key={c.id}
                        scope="col"
                        aria-sort={c.sortable ? (active ? (sort.direction === "asc" ? "ascending" : "descending") : "none") : undefined}
                        className={cn("h-(--row-h) px-2 font-medium whitespace-nowrap", c.align === "right" ? "text-right" : "text-left")}
                      >
                        {c.sortable ? (
                          <button type="button" onClick={() => toggleSort(c.id as SortColumn)} className={cn("inline-flex h-6 items-center gap-1 rounded-sm hover:text-foreground", active && "text-foreground")}>
                            {c.header}
                            {active ? sort.direction === "asc" ? <ArrowUp aria-hidden="true" className="size-3" /> : <ArrowDown aria-hidden="true" className="size-3" /> : <ArrowUpDown aria-hidden="true" className="size-3 opacity-50" />}
                          </button>
                        ) : c.id === "star" ? (
                          <span>
                            <span aria-hidden="true">★</span>
                            <span className="sr-only">Favourite</span>
                          </span>
                        ) : (
                          c.header
                        )}
                      </th>
                    )
                  })}
                </tr>
              </thead>
              <tbody onKeyDown={onKeyDown}>
                {shown.length === 0 ? (
                  <tr>
                    <td colSpan={columns.length} className="p-4">
                      {emptyState}
                    </td>
                  </tr>
                ) : (
                  shown.map((v) => (
                    <tr
                      key={v.row.key}
                      data-row
                      data-row-key={v.row.key}
                      className="h-(--row-h) border-b border-border/50 last:border-0 even:bg-foreground/[0.022] hover:bg-foreground/[0.05]"
                    >
                      {columns.map((c) => {
                        const Cell = c.id === "designation" ? "th" : "td"
                        return (
                          <Cell
                            key={c.id}
                            scope={c.id === "designation" ? "row" : undefined}
                            className={cn("px-2 py-0.5 font-normal whitespace-nowrap tabular-nums", c.align === "right" ? "text-right" : "text-left", c.className)}
                          >
                            {c.cell(v)}
                          </Cell>
                        )
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ContextMenuTrigger>
          <ContextMenuContent>
            {menuView ? (
              <ContextMenuGroup>
                <ContextMenuLabel>{menuView.row.designation}</ContextMenuLabel>
                {menuView.row.target ? (
                  <>
                    <ContextMenuItem onClick={() => void navigate({ to: "/targets/$targetId", params: { targetId: menuView.row.target!.id }, search: keepSearch(search) })}>Open</ContextMenuItem>
                    <ContextMenuItem onClick={() => toggleStar(menuView)}>{menuView.row.target.favourite ? "Remove ★" : "Add ★"}</ContextMenuItem>
                    <ContextMenuSeparator />
                    <ContextMenuItem onClick={() => openSheet({ kind: "new-project", targetId: menuView.row.target!.id })}>New Project…</ContextMenuItem>
                    <ContextMenuItem onClick={() => void navigate({ to: "/plan" })}>Open Plan</ContextMenuItem>
                  </>
                ) : (
                  <ContextMenuItem onClick={() => add(menuView.row)}>Add to targets</ContextMenuItem>
                )}
              </ContextMenuGroup>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      </div>
      <p data-chrome className="border-t border-separator px-5 py-1 text-[0.6875rem] text-muted-foreground tabular-nums" aria-live="polite">
        {plural(shown.length, "target")}
        {site ? ` · tonight at ${site.name}` : ""} · sorted by {columns.find((c) => c.id === sort.column)?.header ?? sort.column}, {sort.direction === "asc" ? "ascending" : "descending"} · ↑ and ↓ move between rows · right-click a row for more
      </p>

      <NameDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        title="Save preset"
        description={`Saves ${describeView(catalog, currentView)}. Saved presets are listed after the built-ins and survive restarts.`}
        label="Preset name"
        initial=""
        confirmLabel="Save preset"
        taken={[...saved.map((p) => p.name), ...BUILT_IN_PRESETS.map((p) => p.label)]}
        onSubmit={(name) => {
          const preset = savePreset(name, currentView)
          setParams({ saved: preset.id })
          return null
        }}
      />
      <NameDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title="Rename preset"
        description="Only the name changes; the saved view stays as it is."
        label="Preset name"
        initial={renaming?.name ?? ""}
        confirmLabel="Rename"
        taken={[...saved.filter((p) => p.id !== renaming?.id).map((p) => p.name), ...BUILT_IN_PRESETS.map((p) => p.label)]}
        onSubmit={(name) => {
          if (renaming) renamePreset(renaming.id, name)
          return null
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={`Delete the preset ${deleting?.name ?? ""}?`}
        description="The preset's saved view is removed from the preset bar."
        changes={[`Removes the saved preset “${deleting?.name ?? ""}” (${deleting ? describeView(catalog, deleting.view) : ""})`]}
        unchanged={["Built-in presets", "Your other saved presets", "Targets, ★ favourites and Projects"]}
        confirmLabel="Delete preset"
        tone="destructive"
        onConfirm={() => {
          if (!deleting) return
          if (search.saved === deleting.id) setParams({ saved: undefined })
          deletePreset(deleting.id)
        }}
      />
    </div>
  )
}

/** The Targets view keys a Target link carries, so the list is the same on return. */
export function keepSearch(search: SearchParams): SearchParams {
  const kept: SearchParams = {}
  for (const key of ["q", "mode", "cat", "preset", "rig", "sort", "project", "saved"]) if (search[key]) kept[key] = search[key]
  return kept
}
