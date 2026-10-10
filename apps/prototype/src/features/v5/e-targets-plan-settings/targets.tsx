/**
 * S10 Targets (`/targets`, slice E): v4's dense finder pattern grown into the
 * planning table of D-W17 to D-W19, D-W23 and D-W60 to D-W62.
 *
 * - Show: My targets (★ favourites plus open-Project subjects with a Project
 *   badge) or Browse catalogues, which lists nothing until a catalogue or a
 *   preset is chosen. "Open in Planner" (`?project=`) limits the list to the
 *   Project's subjects with the rig set to this Project's rigs (PLAN-FR-10).
 * - Search (clearable) covers My targets, the library, the bundled
 *   catalogues and SIMBAD and offers Add to targets; with SIMBAD unreachable
 *   or lookup off the results say SIMBAD was not searched.
 * - Columns: ★, Designation, Type, Max alt, Lunar, Img time, Filters (one
 *   chip per filter, graded good tonight), Opposition, Sessions, Captured;
 *   Fit with a rig selected; Source while searching. Every column but ★
 *   sorts; unknown values sort last. The Moon appears once, in the toolbar.
 * - Filters: a good-tonight filter per band ("OIII ok · Moon ≥ 60° · ≤ 80%",
 *   its Moon limits editable in place), entered from the "Good tonight for"
 *   preset; built-in presets (Mosaic candidates and Fits nicely with a rig)
 *   and saved presets (rename, delete). Narrowband presets hide without a
 *   narrowband filter on the selected rig.
 * - Right-click: rows, presets and the good-tonight filter.
 *
 * The view lives in the URL (`mode`, `cat`, `preset`, `good`, `rig`, `sort`,
 * `q`, `project`, `saved`), so opening a Target and coming back keeps it.
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronDown, Crosshair, MoreHorizontal, Plus, Search, Star, X } from "lucide-react"
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ClearableInput } from "@/components/app/clearable-input"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { ActionError, EmptyState, Notice, UnknownValue } from "@/components/app/feedback"
import { PageHeader } from "@/components/app/page"
import { Pill } from "@/components/app/pill"
import { ContextMenuArea, type MenuEntry, menuKey } from "@/components/app/row-menu"
import { HelpTip, NoteMarker } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { openSheet } from "@/app/ui-state"
import { formatHours, planList } from "@/domain/derive"
import type { OpticalTrainId } from "@/domain/types"
import { objectTypeRef } from "@/domain/labels"
import { formatNight } from "@/lib/format"
import { say } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { SearchParams } from "@/routes"
import { setFavourite } from "@/store/actions/library"
import { removeFromPlan } from "@/store/actions/planning"
import { type CommitResult, store, useStore } from "@/store/core"
import type { SavedTargetPreset } from "@/store/slices/e"
import { CATALOGUES, type CatalogueId } from "@/domain/sky"
import { NameDialog } from "./dialogs"
import { BAND_ORDER, limitText } from "./good-tonight"
import { MoonLimits } from "./moon-limits"
import { AddSiteButton, CapturedCell, FilterChips, FitCell, MoonLine, ProjectBadge, SiteLine, useSkyContext } from "./parts"
import {
  addToMyTargets,
  allRows,
  BUILT_IN_PRESETS,
  browseRows,
  formatSort,
  GOOD_TONIGHT_SORT,
  goodFor,
  myTargetRows,
  parseBand,
  parseSort,
  planRow,
  presetById,
  presetUnavailable,
  projectRows,
  rowSource,
  type RowView,
  rowView,
  type SortColumn,
  type SortSpec,
  searchRows,
  selectionBands,
  sessionCountsByTarget,
  sortViews,
  type TargetRow,
  zeroReasonText,
  zeroReasonWord,
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
  id: SortColumn | "star" | "actions"
  header: string
  sortable: boolean
  align?: "right"
  className?: string
  /** An ⓘ beside the header, for the rare column that needs it. */
  help?: ReactNode
  cell: (view: RowView) => ReactNode
}

function dash(reason: string) {
  return <UnknownValue label="–" reason={reason} />
}

/** A preset-bar chip (built-in, catalogue, or the trigger of a menu). */
const CHIP = "h-6 rounded-md border px-2 text-xs disabled:opacity-50"
const CHIP_ON = "border-transparent bg-selected text-selected-foreground"
const CHIP_OFF = "border-separator text-foreground/85 hover:bg-foreground/[0.06]"

export function TargetsPage() {
  const m = useMessages()
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const saved = useStore((s) => s.slices.e.savedPresets)
  const constraints = useStore((s) => s.settings.moonConstraints)
  const ctx = useSkyContext()
  const [simbad, retrySimbad] = useSimbad(search.q ?? "")
  const [failure, setFailure] = useState<{ message: string; retry: () => void } | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [renaming, setRenaming] = useState<SavedTargetPreset | null>(null)
  const [deleting, setDeleting] = useState<SavedTargetPreset | null>(null)

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
  const good = parseBand(search.good)
  const goodBlocked = good && !bands.includes(good) ? m.targets_rig_lacks_filter({ band: good }) : null
  const activeGood = good && !goodBlocked && !query ? good : null
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
  const baseRows = searched ? searched : project ? projectRows(rows, project) : mode === "browse" ? (catalogues.length > 0 || activePreset || activeGood ? browseRows(rows, catalogues) : []) : myTargetRows(rows)
  const counts = useMemo(() => sessionCountsByTarget(catalog), [catalog])
  const planned = useMemo(() => new Set(planList(catalog).map((t) => t.id)), [catalog])
  const rigKey = rigIds.join(",")
  const views = useMemo(() => baseRows.map((row) => rowView(catalog, disk, ctx, row, rigIds, counts, constraints)), [baseRows, catalog, disk, ctx, rigKey, counts, constraints])
  const filtered = goodFor(activePreset ? views.filter(activePreset.match) : views, activeGood)
  const shown = sortViews(filtered, sort, activeGood)

  function run(action: () => CommitResult) {
    const result = action()
    setFailure(result.ok ? null : { message: result.message, retry: () => run(action) })
  }
  function toggleSort(column: SortColumn) {
    const next: SortSpec = sort.column === column ? { column, direction: sort.direction === "asc" ? "desc" : "asc" } : { column, direction: column === "img" || column === "maxAlt" || column === "captured" || column === "sessions" || column === "tonight" ? "desc" : "asc" }
    setParams({ sort: formatSort(next), saved: undefined })
  }
  const add = (row: TargetRow) => run(() => addToMyTargets(row).result)
  function toggleStar(view: RowView) {
    const target = view.row.target
    if (!target) return add(view.row)
    run(() => setFavourite(target.id, !target.favourite))
  }
  function applySaved(p: SavedTargetPreset) {
    const patch: SearchParams = { saved: p.id, q: undefined }
    for (const key of VIEW_KEYS) patch[key] = p.view[key]
    setParams(patch)
  }
  const applyGood = (band: string | undefined) => setParams({ good: band, sort: band ? formatSort(GOOD_TONIGHT_SORT) : undefined, saved: undefined })

  const noSite = m.project_no_site()
  const skyCell = (view: RowView, render: (sky: Extract<RowView["sky"], { status: "ok" }>) => ReactNode) =>
    view.sky.status === "no-site" ? dash(noSite) : view.sky.status === "no-coordinates" ? dash(m.tonight_no_coordinates()) : render(view.sky)

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
            aria-label={starred ? m.targets_unstar_named({ name: v.row.designation }) : v.row.target ? m.targets_star_named({ name: v.row.designation }) : m.targets_add_named({ name: v.row.designation })}
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
      header: m.targets_designation(),
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
    {
      id: "type",
      header: m.targets_type(),
      sortable: true,
      className: "max-w-32 truncate",
      cell: (v) => {
        if (!v.row.objectType) return dash(m.targets_type_unknown())
        const type = say(m, objectTypeRef(v.row.objectType))
        return <span title={type}>{type}</span>
      },
    },
    {
      id: "maxAlt",
      header: m.tonight_max_alt(),
      sortable: true,
      align: "right",
      cell: (v) => skyCell(v, (sky) => (sky.peakDeg === null ? dash(m.tonight_no_darkness()) : `${Math.round(sky.peakDeg)}°`.replace("-", "−"))),
    },
    { id: "lunar", header: m.tonight_lunar(), sortable: true, align: "right", cell: (v) => skyCell(v, (sky) => `${Math.round(sky.lunarDeg)}°`) },
    {
      id: "img",
      header: m.tonight_img_time(),
      sortable: true,
      align: "right",
      cell: (v) =>
        skyCell(v, (sky) =>
          sky.imgTimeS > 0 ? (
            formatHours(sky.imgTimeS)
          ) : (
            <span title={sky.zeroReason ? zeroReasonText(sky.zeroReason) : undefined}>
              {m.tonight_zero_hours()} <span className="text-xs text-muted-foreground">{sky.zeroReason ? zeroReasonWord(sky.zeroReason) : null}</span>
              <span className="sr-only">: {sky.zeroReason ? zeroReasonText(sky.zeroReason) : null}</span>
            </span>
          ),
        ),
    },
    {
      id: "tonight",
      header: m.targets_filters(),
      sortable: true,
      help: m.targets_filters_help(),
      cell: (v) => skyCell(v, (sky) => <FilterChips chips={v.tonight} empty={sky.zeroReason ? zeroReasonText(sky.zeroReason) : m.tonight_no_window()} />),
    },
    // Fit sits beside the filter chips: both follow the rig selector (D-W23).
    ...(rigIds.length > 0 ? [{ id: "fit" as const, header: rigIds.length > 1 ? m.targets_fit_per_rig() : m.targets_fit(), sortable: true, cell: (v: RowView) => <FitCell fits={v.fits} /> }] : []),
    {
      id: "opposition",
      header: m.tonight_opposition(),
      sortable: true,
      cell: (v) => (v.opposition ? shortDate(v.opposition, ctx?.nowMs ?? Date.now()) : dash(v.row.ra === null ? m.tonight_no_coordinates() : noSite)),
    },
    { id: "sessions", header: m.nav_sessions(), sortable: true, align: "right", cell: (v) => (v.sessions > 0 ? v.sessions : <span className="text-muted-foreground">–</span>) },
    { id: "captured", header: m.coverage_captured(), sortable: true, className: "max-w-40 truncate", cell: (v) => <CapturedCell captured={v.captured} /> },
  ]
  if (searched) columns.push({ id: "source", header: m.targets_source(), sortable: true, cell: (v) => <span className="text-xs">{rowSource(v.row)}</span> })
  columns.push({
    id: "actions",
    header: m.tonight_actions(),
    sortable: false,
    className: "w-px",
    cell: (v) =>
      v.row.mine ? null : (
        <Button size="xs" variant="outline" onClick={() => add(v.row)}>
          <Plus aria-hidden="true" data-icon="inline-start" />
          {m.verb_add()}<span className="sr-only"> {m.targets_add_sr({ name: v.row.designation })}</span>
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

  function rowMenu(key: string): MenuEntry[] {
    const v = shown.find((x) => x.row.key === key)
    if (!v) return []
    const target = v.row.target
    const inPlan = target ? planned.has(target.id) : false
    const plan: MenuEntry = inPlan ? { label: m.targets_remove_from_plan(), onSelect: () => run(() => removeFromPlan(target!.id)) } : { label: m.targets_add_to_plan(), onSelect: () => run(() => planRow(v.row)) }
    if (!target) return [{ label: m.targets_add_to_targets(), onSelect: () => add(v.row) }, plan]
    return [
      { label: m.verb_open(), onSelect: () => void navigate({ to: "/targets/$targetId", params: { targetId: target.id }, search: keepSearch(search) }) },
      { label: target.favourite ? m.targets_unstar() : m.targets_star(), onSelect: () => toggleStar(v) },
      plan,
      { separator: true },
      { label: m.newproject_open(), onSelect: () => openSheet({ kind: "new-project", targetId: target.id }) },
      { label: m.targets_open_plan(), onSelect: () => void navigate({ to: "/plan" }) },
    ]
  }

  const visiblePresets = BUILT_IN_PRESETS.filter((p) => !(p.needs === "rig" && rigIds.length === 0) && !(p.needs === "narrowband" && presetUnavailable(p, rigIds, bands)))
  const goodBands = [...bands].sort((a, b) => BAND_ORDER.indexOf(a) - BAND_ORDER.indexOf(b))

  function presetMenu(key: string): MenuEntry[] {
    const [kind, id] = key.split(":") as [string, string]
    if (kind === "preset") {
      const p = presetById(id)
      if (!p) return []
      const on = activePreset?.id === p.id && !activeSaved
      return [on ? { label: m.verb_clear(), onSelect: () => setParams({ preset: undefined, sort: undefined, saved: undefined }) } : { label: m.targets_apply(), disabled: Boolean(query), onSelect: () => setParams({ preset: p.id, sort: undefined, saved: undefined }) }]
    }
    if (kind === "saved") {
      const p = saved.find((x) => x.id === id)
      if (!p) return []
      return [
        { label: m.targets_apply(), disabled: Boolean(savedPresetUnavailable(catalog, p.view)) || Boolean(query), onSelect: () => applySaved(p) },
        { label: m.targets_rename_menu(), onSelect: () => setRenaming(p) },
        { label: m.targets_delete_menu(), destructive: true, onSelect: () => setDeleting(p) },
      ]
    }
    return [...goodBands.map((band) => ({ label: m.targets_good_for({ band }), onSelect: () => applyGood(band) })), ...(good ? [{ separator: true } as const, { label: m.verb_clear(), onSelect: () => applyGood(undefined) }] : [])]
  }

  const rigItems = [
    { value: "none", label: m.session_no_rig() },
    ...Object.values(catalog.opticalTrains)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => ({ value: r.id, label: r.name })),
    ...(project ? [{ value: "project", label: m.targets_project_rigs({ count: project.rigIds.length }) }] : []),
  ]
  const currentView: SavedTargetPreset["view"] = { mode, cat: catalogues.join(",") || undefined, preset: activePreset?.id, good: activeGood ?? undefined, rig: rigParam !== "none" && rigParam !== "project" ? rigParam : undefined, sort: search.sort }

  const emptyState = (() => {
    if (searched) return <EmptyState icon={Search} title={m.targets_no_match({ query })} description={null} action={<Button size="sm" variant="outline" onClick={() => setParams({ q: undefined })}>{m.sessions_clear_search()}</Button>} />
    if (mode === "browse" && !project && catalogues.length === 0 && !activePreset && !activeGood)
      return <EmptyState icon={Crosshair} title={m.targets_choose_catalogue()} description={null} action={<Button size="sm" onClick={() => setParams({ cat: "Messier" })}>{m.targets_browse_messier()}</Button>} />
    if (activeGood) return <EmptyState icon={Crosshair} title={m.targets_none_good({ band: activeGood })} description={null} action={<Button size="sm" variant="outline" onClick={() => applyGood(undefined)}>{m.targets_clear_filter()}</Button>} />
    if (activePreset) return <EmptyState icon={Crosshair} title={m.targets_none_match_preset({ name: activePreset.label })} description={null} action={<Button size="sm" variant="outline" onClick={() => setParams({ preset: undefined, saved: undefined })}>{m.targets_clear_preset()}</Button>} />
    return <EmptyState icon={Star} title={m.targets_empty()} description={null} action={<Button size="sm" onClick={() => setParams({ mode: "browse", cat: "Messier" })}>{m.targets_browse_catalogues()}</Button>} />
  })()

  const sortedBy = columns.find((c) => c.id === sort.column)?.header ?? sort.column

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={m.nav_targets()}
        actions={
          <Button variant="outline" onClick={() => setSaveOpen(true)} disabled={Boolean(query)} title={query ? m.targets_clear_search_first() : undefined}>
            {m.targets_save_preset()}
          </Button>
        }
      />
      <div data-chrome className="space-y-2 border-b border-separator px-5 py-2">
        <div className="flex flex-wrap items-center gap-2">
          {project ? (
            <span className="inline-flex items-center gap-1" data-project-scope>
              <Pill tone="info" link={{ to: "/projects/$projectId", params: { projectId: project.id } }}>
                {project.name}
              </Pill>
              <Button size="icon-xs" variant="ghost" aria-label={m.targets_clear_project()} title={m.targets_clear_project()} onClick={() => setParams({ project: undefined, rig: undefined })}>
                <X aria-hidden="true" />
              </Button>
              <Button size="xs" variant="outline" render={<Link to="/plan" search={{ project: project.id }} />}>
                {m.nav_plan()}
              </Button>
            </span>
          ) : (
            <div role="radiogroup" aria-label={m.targets_show()} className="inline-flex rounded-md border border-separator p-px">
              {(["my", "browse"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  role="radio"
                  aria-checked={mode === option}
                  onClick={() => setParams({ mode: option === "my" ? undefined : "browse", saved: undefined })}
                  className={cn("h-6 rounded-[4px] px-2 text-sm", mode === option ? "bg-selected text-selected-foreground" : "text-foreground/85 hover:bg-foreground/[0.06]")}
                >
                  {option === "my" ? m.project_search_my_targets() : m.targets_browse_catalogues()}
                </button>
              ))}
            </div>
          )}
          <ClearableInput
            search
            aria-label={m.targets_search_label()}
            placeholder={m.targets_search_placeholder()}
            value={draftQuery}
            onValueChange={(value) => {
              typed.current = value
              setDraftQuery(value)
              setParams({ q: value || undefined })
            }}
            wrapperClassName="w-72"
          />
          <Select items={rigItems} value={rigItems.some((i) => i.value === rigParam) ? rigParam : "none"} onValueChange={(value) => setParams({ rig: value === (project ? "project" : "none") ? undefined : (value as string), saved: undefined })}>
            <SelectTrigger size="sm" aria-label={m.targets_rig()} className="w-56 min-w-0">
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
          {good ? (
            <ContextMenuArea menu={presetMenu}>
              <span className="inline-flex items-center gap-0.5" data-good-filter {...menuKey("good")}>
                <Popover>
                  <PopoverTrigger render={<button type="button" aria-label={m.targets_moon_limits_for({ band: good })} className="rounded-full" />}>
                    <Pill tone={goodBlocked ? "muted" : "success"} title={goodBlocked ?? (query ? m.targets_off_while_searching() : undefined)}>
                      {m.targets_good_chip({ band: good, limit: limitText(constraints[good]) })}
                    </Pill>
                  </PopoverTrigger>
                  <PopoverContent align="start" className="w-60">
                    <MoonLimits bands={[good]} />
                  </PopoverContent>
                </Popover>
                <Button size="icon-xs" variant="ghost" aria-label={m.targets_clear_band_filter({ band: good })} title={m.targets_clear_filter()} onClick={() => applyGood(undefined)}>
                  <X aria-hidden="true" />
                </Button>
              </span>
            </ContextMenuArea>
          ) : null}
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
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={m.targets_catalogues()}>
            <span className="mr-1 text-xs text-muted-foreground">{m.targets_catalogues()}</span>
            {CATALOGUES.map((c) => {
              const on = catalogues.includes(c)
              return (
                <button key={c} type="button" aria-pressed={on} onClick={() => setParams({ cat: (on ? catalogues.filter((x) => x !== c) : [...catalogues, c]).join(",") || undefined, saved: undefined })} className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}>
                  {c}
                </button>
              )
            })}
          </div>
        ) : null}
        <ContextMenuArea menu={presetMenu}>
          <div className="flex flex-wrap items-center gap-1" role="group" aria-label={m.targets_presets()}>
            <span className="mr-1 text-xs text-muted-foreground">{m.targets_presets()}</span>
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
                  className={cn(CHIP, on ? CHIP_ON : CHIP_OFF)}
                  {...menuKey(`preset:${p.id}`)}
                >
                  {p.label}
                </button>
              )
            })}
            <DropdownMenu>
              <DropdownMenuTrigger render={<button type="button" disabled={Boolean(query) || goodBands.length === 0} aria-pressed={Boolean(activeGood)} className={cn(CHIP, "inline-flex items-center gap-1", activeGood ? CHIP_ON : CHIP_OFF)} {...menuKey("good")} />}>
                {activeGood ? m.targets_good_for({ band: activeGood }) : m.targets_good_for_menu()}
                <ChevronDown aria-hidden="true" className="size-3" />
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{m.targets_good_for_heading()}</DropdownMenuLabel>
                  {goodBands.map((band) => (
                    <DropdownMenuItem key={band} onClick={() => applyGood(band)}>
                      <span className="w-8 font-medium">{band}</span>
                      <span className="text-muted-foreground">{limitText(constraints[band])}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuGroup>
                {good ? (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem onClick={() => applyGood(undefined)}>{m.verb_clear()}</DropdownMenuItem>
                  </>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
            {saved.length > 0 ? <span aria-hidden="true" className="mx-1 h-4 w-px bg-separator" /> : null}
            {saved.map((p) => {
              const blocked = savedPresetUnavailable(catalog, p.view)
              const on = activeSaved?.id === p.id
              return (
                <span key={p.id} className={cn("inline-flex h-6 items-center rounded-md border", on ? CHIP_ON : "border-separator")} {...menuKey(`saved:${p.id}`)}>
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={Boolean(blocked) || Boolean(query)}
                    title={blocked ?? describeView(catalog, p.view)}
                    onClick={() => (on ? setParams({ saved: undefined, preset: undefined, good: undefined, sort: undefined }) : applySaved(p))}
                    className="h-full px-2 text-xs disabled:opacity-50"
                  >
                    {p.name}
                    {blocked ? <span className="sr-only">{m.targets_preset_unavailable_sr({ reason: blocked })}</span> : null}
                  </button>
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<button type="button" aria-label={m.targets_more_for({ name: p.name })} className="inline-flex h-full items-center border-l border-separator/70 px-1" />}>
                      <MoreHorizontal aria-hidden="true" className="size-3.5" />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem onClick={() => setRenaming(p)}>{m.targets_rename_menu()}</DropdownMenuItem>
                      <DropdownMenuItem variant="destructive" onClick={() => setDeleting(p)}>
                        {m.targets_delete_menu()}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </span>
              )
            })}
            {presetBlocked && preset ? (
              <span className="ml-1 inline-flex items-center gap-0.5">
                <Pill tone="warning" title={presetBlocked}>
                  {m.targets_preset_unavailable({ name: preset.label })}
                </Pill>
                <Button size="icon-xs" variant="ghost" aria-label={m.targets_clear_named({ name: preset.label })} onClick={() => setParams({ preset: undefined, saved: undefined })}>
                  <X aria-hidden="true" />
                </Button>
              </span>
            ) : null}
          </div>
        </ContextMenuArea>
      </div>

      {searched && simbad ? (
        <div className="px-5 pt-2">
          {simbad.status === "searching" ? (
            <p className="text-[0.75rem] text-muted-foreground" role="status">
              {m.targets_simbad_searching()}
            </p>
          ) : simbad.status === "off" ? (
            <Notice tone="offline" title={m.targets_simbad_off()} actions={<Button size="sm" variant="outline" render={<Link to="/settings/targets" search={{ return: "/targets" }} />}>{m.settings_target_lookup()}</Button>} />
          ) : simbad.status === "unreachable" ? (
            <Notice tone="offline" title={m.targets_simbad_unreachable()} actions={<Button size="sm" variant="outline" onClick={retrySimbad}>{m.verb_retry()}</Button>} />
          ) : (
            <p className="inline-flex items-center gap-1 text-[0.75rem] text-muted-foreground" role="status">
              {m.targets_simbad_searched()}
              <NoteMarker rows={[{ label: m.targets_source(), value: m.targets_simbad_fixture() }]} />
            </p>
          )}
        </div>
      ) : null}
      {failure ? (
        <div className="px-5 pt-2">
          <ActionError message={failure.message} onRetry={failure.retry} />
        </div>
      ) : null}

      <div className="min-h-0 flex-1 px-5 py-2">
        <ContextMenuArea menu={rowMenu} className="block h-full">
          <div data-targets-table className="relative h-full overflow-auto rounded-md border bg-background scroll-pt-[calc(var(--row-h)+1px)]">
            <table className="w-full text-sm">
              <caption className="sr-only">
                {searched ? m.targets_caption_search({ query }) : project ? m.targets_caption_project({ name: project.name }) : mode === "browse" ? m.targets_browse_catalogues() : m.project_search_my_targets()}, {m.plan_rows_count({ count: shown.length })}
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
                        <span className="inline-flex items-center gap-1">
                          {c.sortable ? (
                            <button type="button" onClick={() => toggleSort(c.id as SortColumn)} className={cn("inline-flex h-6 items-center gap-1 rounded-sm hover:text-foreground", active && "text-foreground")}>
                              {c.id === "tonight" && activeGood ? m.targets_filters_band({ band: activeGood }) : c.header}
                              {active ? sort.direction === "asc" ? <ArrowUp aria-hidden="true" className="size-3" /> : <ArrowDown aria-hidden="true" className="size-3" /> : <ArrowUpDown aria-hidden="true" className="size-3 opacity-50" />}
                            </button>
                          ) : c.id === "star" ? (
                            <span>
                              <span aria-hidden="true">★</span>
                              <span className="sr-only">{m.targets_favourite()}</span>
                            </span>
                          ) : c.id === "actions" ? (
                            <span className="sr-only">{c.header}</span>
                          ) : (
                            c.header
                          )}
                          {c.help ? <HelpTip label={m.targets_about_column({ name: c.header })}>{c.help}</HelpTip> : null}
                        </span>
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
                    <tr key={v.row.key} data-row data-row-key={v.row.key} {...menuKey(v.row.key)} className="h-(--row-h) border-b border-border/50 last:border-0 even:bg-foreground/[0.022] hover:bg-foreground/[0.05]">
                      {columns.map((c) => {
                        const Cell = c.id === "designation" ? "th" : "td"
                        return (
                          <Cell key={c.id} scope={c.id === "designation" ? "row" : undefined} className={cn("px-2 py-0.5 font-normal whitespace-nowrap tabular-nums", c.align === "right" ? "text-right" : "text-left", c.className)}>
                            {c.cell(v)}
                          </Cell>
                        )
                      })}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </ContextMenuArea>
      </div>
      <p data-chrome className="border-t border-separator px-5 py-1 text-[0.6875rem] text-muted-foreground tabular-nums" aria-live="polite">
        {m.plan_targets_count({ count: shown.length })} · {sortedBy} {sort.direction === "asc" ? "↑" : "↓"}
        <span className="sr-only"> {sort.direction === "asc" ? m.targets_sort_ascending() : m.targets_sort_descending()}</span>
      </p>

      <NameDialog
        open={saveOpen}
        onOpenChange={setSaveOpen}
        title={m.targets_save_preset()}
        description={describeView(catalog, currentView)}
        label={m.targets_preset_name()}
        initial=""
        confirmLabel={m.targets_save_preset()}
        taken={[...saved.map((p) => p.name), ...BUILT_IN_PRESETS.map((p) => p.label)]}
        onSubmit={(name) => {
          const created = savePreset(name, currentView)
          setParams({ saved: created.id })
          return null
        }}
      />
      <NameDialog
        open={renaming !== null}
        onOpenChange={(open) => !open && setRenaming(null)}
        title={m.targets_rename_preset()}
        description={renaming ? describeView(catalog, renaming.view) : ""}
        label={m.targets_preset_name()}
        initial={renaming?.name ?? ""}
        confirmLabel={m.targets_rename()}
        taken={[...saved.filter((p) => p.id !== renaming?.id).map((p) => p.name), ...BUILT_IN_PRESETS.map((p) => p.label)]}
        onSubmit={(name) => {
          if (renaming) renamePreset(renaming.id, name)
          return null
        }}
      />
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => !open && setDeleting(null)}
        title={m.targets_delete_preset_title({ name: deleting?.name ?? "" })}
        description={deleting ? describeView(catalog, deleting.view) : ""}
        changes={[m.targets_delete_preset_change({ name: deleting?.name ?? "" })]}
        confirmLabel={m.targets_delete_preset()}
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
  for (const key of ["q", "mode", "cat", "preset", "good", "rig", "sort", "project", "saved"]) if (search[key]) kept[key] = search[key]
  return kept
}
