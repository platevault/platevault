/**
 * S10 Targets (`/targets`, slice E): v4's dense finder pattern grown into the
 * planning table of D-W17 to D-W19, D-W23 and D-W60 to D-W62, with the Plan
 * merged in (P-PLAN2).
 *
 * - Night: the header's date picker (default tonight, `?night=`) sets the
 *   night that suitability, altitude, the Moon and windows use; the
 *   planning site sits beside it when there are several.
 * - Views, one toggle in the header (Round 6): My targets (the default),
 *   Browse catalogues (`?mode=browse`) and Planned (`?view=planned`).
 * - My targets: ★ favourites plus open-Project subjects with a Project
 *   badge. Browse catalogues lists nothing until a catalogue or a preset is
 *   chosen. "Open in Planner" (`?project=`) limits the list to the
 *   Project's subjects, with their unmet goals, and sets the rig to this
 *   Project's rigs (PLAN-FR-10). Search (clearable) covers My targets, the
 *   library, the bundled catalogues and SIMBAD; with SIMBAD unreachable or
 *   lookup off the results say SIMBAD was not searched.
 * - Planned: the chosen night's own plan (each night has one; Add to plan
 *   adds to the chosen night) in the user's order (Move up and Move down,
 *   or Alt+↑/↓), else by first window, with each one's windows and the Moon
 *   in its best window; Remove from plan. Its header holds Reminders (a
 *   toggle and a lead time) and Export calendar… (every upcoming planned
 *   night, previewed before the download).
 * - Columns: ★, Designation, Type, Altitude (a sparkline of the night with
 *   the peak in darkness), Lunar, Img time, Filters (one chip per filter,
 *   graded good tonight), Opposition, Sessions, Captured; Fit with a rig
 *   selected; Source while searching. Every All column but ★ sorts; unknown
 *   values sort last. The Moon appears once, in the toolbar. A mosaic
 *   subject of an open Project lists its panels under it (D-W63).
 * - Clicking a row (or Enter on its name) acts: a library Target opens; a
 *   catalogue or SIMBAD result, which has no page yet, is added to My
 *   targets. The row menu (right-click, Shift+F10 or ⋯) holds the rest,
 *   Add to Plan among it.
 * - Filters: a good-tonight filter per band ("OIII ok · Moon ≥ 60° · ≤ 80%",
 *   its Moon limits editable in place), entered from the "Good tonight for"
 *   preset; built-in presets (Mosaic candidates and Fits nicely with a rig)
 *   and saved presets (rename, delete). Narrowband presets hide without a
 *   narrowband filter on the selected rig.
 *
 * The view lives in the URL (`view`, `night`, `mode`, `cat`, `preset`,
 * `good`, `rig`, `sort`, `q`, `project`, `saved`), so opening a Target and
 * coming back keeps it.
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ArrowDown, ArrowUp, ArrowUpDown, CalendarClock, ChevronDown, ChevronLeft, ChevronRight, Crosshair, MoreHorizontal, Search, Star, X } from "lucide-react"
import { type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { useMessages, usePreferences } from "@/app/preferences"
import { openSheet } from "@/app/ui-state"
import { ClearableInput } from "@/components/app/clearable-input"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { ActionError, EmptyState, Notice, UnknownValue } from "@/components/app/feedback"
import { PageHeader } from "@/components/app/page"
import { CountBadge, Pill } from "@/components/app/pill"
import { ContextMenuArea, type MenuEntry, menuKey } from "@/components/app/row-menu"
import { HelpTip, NoteMarker } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuShortcut, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatHours, goalProgress } from "@/domain/derive"
import { objectTypeRef } from "@/domain/labels"
import { nightPlan, shiftNight } from "@/domain/planning"
import { CATALOGUES, type CatalogueId } from "@/domain/sky"
import type { OpticalTrainId } from "@/domain/types"
import { save } from "@/features/t1/lib/writes"
import { formatNight } from "@/lib/format"
import { msg, say } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { SearchParams } from "@/routes"
import { setFavourite } from "@/store/actions/library"
import { type CommitResult, store, useStore } from "@/store/core"
import type { SavedTargetPreset } from "@/store/slices/e"
import { NameDialog } from "./dialogs"
import { BAND_ORDER, limitText } from "./good-tonight"
import { MoonLimits, MoonLimitsButton } from "./moon-limits"
import { AddSiteButton, AltitudeSpark, CapturedCell, clockRange, criteriaText, DarkLine, FilterChips, FitCell, MoonLine, planNight, ProjectBadge, SiteLine, useSkyContext } from "./parts"
import { ExportCalendarButton, RemindersControl } from "./planned-tools"
import {
  addToMyTargets,
  allRows,
  BUILT_IN_PRESETS,
  browseRows,
  formatSort,
  GOOD_TONIGHT_SORT,
  goodFor,
  movePlanned,
  myTargetRows,
  panelRows,
  parseBand,
  parseSort,
  plannedOrder,
  planRow,
  presetById,
  presetUnavailable,
  projectRows,
  rowSource,
  type RowView,
  rowView,
  type SkyContext,
  type SortColumn,
  type SortSpec,
  searchRows,
  selectionBands,
  sessionCountsByTarget,
  sortViews,
  type TargetRow,
  unplan,
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

/** The Alt key's legend on the keycap: Option on a Mac. */
const ALT_KEY = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform) ? "⌥" : "Alt"

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
  id: SortColumn | "star" | "actions" | "window" | "moon" | "goals"
  header: string
  /** Sorts in the All view; the Planned view keeps the plan's order. */
  sortable: boolean
  align?: "right"
  className?: string
  /** Also filled on a mosaic panel's row. */
  panel?: boolean
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

/** Interactive elements whose own action wins over the row's. */
const CONTROL = "a, button, input, select, textarea, label, [role=menuitem], [role=checkbox], [role=radio]"

/** A segmented control: one choice of a few, in the toolbar or the header. */
function Segmented<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: Array<{ value: T; label: ReactNode }>; onChange: (value: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-separator p-px">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="radio"
          aria-checked={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn("inline-flex h-6 items-center gap-1.5 rounded-[4px] px-2 text-sm", value === option.value ? "bg-selected text-selected-foreground" : "text-foreground/85 hover:bg-foreground/[0.06]")}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** The night the page plans for: previous and next night around a date field, and back to tonight. */
function NightPicker({ ctx, onChange }: { ctx: SkyContext; onChange: (night: string | undefined) => void }) {
  const m = useMessages()
  const night = ctx.grid.night
  const isTonight = night === ctx.tonight
  const pick = (value: string) => onChange(value > ctx.tonight ? value : undefined)
  return (
    <span className="inline-flex items-center gap-0.5" role="group" aria-label={m.tonight_night()} data-night-picker>
      <Button size="icon-sm" variant="ghost" aria-label={m.targets_night_previous()} disabled={isTonight} onClick={() => pick(shiftNight(night, -1))}>
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Input type="date" aria-label={m.tonight_night()} min={ctx.tonight} value={night} onChange={(event) => event.target.value && pick(event.target.value)} className="h-7 w-36 px-2 text-sm tabular-nums" />
      <Button size="icon-sm" variant="ghost" aria-label={m.targets_night_next()} onClick={() => pick(shiftNight(night, 1))}>
        <ChevronRight aria-hidden="true" />
      </Button>
      {isTonight ? null : (
        <Button size="sm" variant="ghost" onClick={() => onChange(undefined)}>
          {m.target_tonight()}
        </Button>
      )}
    </span>
  )
}

/** A row's ⋯ menu: the same entries as its right-click menu. */
function RowActions({ label, entries }: { label: string; entries: MenuEntry[] }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="icon-xs" variant="ghost" aria-label={label} data-row-actions />}>
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {entries.map((entry, index) =>
          "separator" in entry ? (
            <DropdownMenuSeparator key={`sep-${index}`} />
          ) : "heading" in entry ? null : (
            <DropdownMenuItem key={entry.label} disabled={entry.disabled} variant={entry.destructive ? "destructive" : undefined} onClick={entry.onSelect}>
              {entry.label}
              {entry.shortcut ? <DropdownMenuShortcut>{entry.shortcut}</DropdownMenuShortcut> : null}
            </DropdownMenuItem>
          ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function TargetsPage() {
  const m = useMessages()
  const { locale } = usePreferences()
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const saved = useStore((s) => s.slices.e.savedPresets)
  const planOrder = useStore((s) => s.slices.e.planOrder)
  const constraints = useStore((s) => s.settings.moonConstraints)
  const sites = useStore((s) => s.catalog.sites)
  const planningSiteId = useStore((s) => s.settings.planningSiteId ?? s.settings.defaultSiteId)
  const ctx = useSkyContext(search.night)
  const [simbad, retrySimbad] = useSimbad(search.q ?? "")
  const [failure, setFailure] = useState<{ message: string; retry: () => void } | null>(null)
  const [saveOpen, setSaveOpen] = useState(false)
  const [renaming, setRenaming] = useState<SavedTargetPreset | null>(null)
  const [deleting, setDeleting] = useState<SavedTargetPreset | null>(null)

  // One toggle: My targets (the default), Browse catalogues, or the night's plan (Round 6).
  const view: "all" | "planned" = search.view === "planned" ? "planned" : "all"
  const planned = view === "planned"
  /** The night the page plans for: Add to plan adds to it, and Planned lists its plan. */
  const night = planNight(ctx)
  const query = planned ? "" : (search.q ?? "")
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
  const scope = planned ? undefined : project
  const mode: "my" | "browse" = search.mode === "browse" ? "browse" : "my"
  const shownView: "my" | "browse" | "planned" = planned ? "planned" : mode
  const catalogues = (search.cat ?? "").split(",").filter((c): c is CatalogueId => (CATALOGUES as readonly string[]).includes(c))
  const rigParam = search.rig ?? (project ? "project" : "none")
  const rigIds: OpticalTrainId[] = rigParam === "project" ? (project?.rigIds ?? []) : rigParam !== "none" && catalog.opticalTrains[rigParam] ? [rigParam] : []
  const bands = selectionBands(catalog, rigIds)
  const preset = presetById(search.preset)
  const presetBlocked = preset ? presetUnavailable(preset, rigIds, bands) : null
  const activePreset = preset && !presetBlocked && !query && !planned ? preset : undefined
  const good = parseBand(search.good)
  const goodBlocked = good && !bands.includes(good) ? m.targets_rig_lacks_filter({ band: good }) : null
  const activeGood = good && !goodBlocked && !query && !planned ? good : null
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
  const plannedIds = useMemo(() => new Set(nightPlan(catalog, night).map((t) => t.id)), [catalog, night])
  const searched = useMemo(() => (query.trim() ? searchRows(rows, query, simbad?.status === "searched" && simbad.query === query.trim()) : null), [rows, query, simbad])
  const catKey = catalogues.join(",")
  const browsing = catalogues.length > 0 || Boolean(activePreset) || Boolean(activeGood)
  const baseRows = useMemo(() => {
    if (planned) return rows.filter((r) => r.target && plannedIds.has(r.target.id))
    if (searched) return searched
    if (scope) return projectRows(rows, scope)
    if (mode === "browse") return browsing ? browseRows(rows, catKey ? (catKey.split(",") as CatalogueId[]) : []) : []
    return myTargetRows(rows)
  }, [planned, rows, plannedIds, searched, scope, mode, browsing, catKey])
  const counts = useMemo(() => sessionCountsByTarget(catalog), [catalog])
  const rigKey = rigIds.join(",")
  const views = useMemo(() => baseRows.map((row) => rowView(catalog, disk, ctx, row, rigIds, counts, constraints)), [baseRows, catalog, disk, ctx, rigKey, counts, constraints])
  const nightOrder = planOrder[night]
  const parents = useMemo(() => {
    if (planned) return plannedOrder(views, nightOrder ?? [])
    const filtered = goodFor(activePreset ? views.filter(activePreset.match) : views, activeGood)
    return sortViews(filtered, sort, activeGood)
  }, [planned, views, nightOrder, activePreset, activeGood, sort.column, sort.direction])
  // A mosaic subject's panels follow it; `locale`: a panel row's name is worded ("Panel 2").
  const shown = useMemo(
    () => parents.flatMap((v) => [v, ...panelRows(v.row).map((row) => rowView(catalog, disk, ctx, row, rigIds, counts, constraints))]),
    [parents, catalog, disk, ctx, rigKey, counts, constraints, locale],
  )
  const byKey = new Map(shown.map((v) => [v.row.key, v]))
  /** The Planned view's order, as Target ids: what Move up and Move down rearrange. */
  const order = planned ? parents.map((v) => v.row.key) : []
  const gapsByTarget = useMemo(() => {
    const out = new Map<string, string[]>()
    if (!scope) return out
    for (const progress of goalProgress(catalog, scope)) {
      const targetId = scope.subjects.find((s) => s.id === progress.goal.subjectId)?.targetId
      if (!targetId || progress.met) continue
      out.set(targetId, [...(out.get(targetId) ?? []), say(m, progress.line)])
    }
    return out
  }, [catalog, scope, m])

  function run(action: () => CommitResult) {
    const result = action()
    setFailure(result.ok ? null : { message: result.message, retry: () => run(action) })
  }
  function toggleSort(column: SortColumn) {
    const next: SortSpec = sort.column === column ? { column, direction: sort.direction === "asc" ? "desc" : "asc" } : { column, direction: column === "img" || column === "maxAlt" || column === "captured" || column === "sessions" || column === "tonight" ? "desc" : "asc" }
    setParams({ sort: formatSort(next), saved: undefined })
  }
  const add = (row: TargetRow) => run(() => addToMyTargets(row).result)
  function toggleStar(v: RowView) {
    const target = v.row.target
    if (!target) return add(v.row)
    run(() => setFavourite(target.id, !target.favourite))
  }
  function applySaved(p: SavedTargetPreset) {
    const patch: SearchParams = { saved: p.id, q: undefined }
    for (const key of VIEW_KEYS) patch[key] = p.view[key]
    setParams(patch)
  }
  const applyGood = (band: string | undefined) => setParams({ good: band, sort: band ? formatSort(GOOD_TONIGHT_SORT) : undefined, saved: undefined })
  const openTarget = (targetId: string) => void navigate({ to: "/targets/$targetId", params: { targetId }, search: keepSearch(search) })
  function chooseSite(siteId: string) {
    run(() => save({ label: msg("plan_site"), saved: msg("store_saved_planning_site", { name: sites[siteId]?.name ?? siteId }), href: "/targets" }, (s) => ({ ...s, settings: { ...s.settings, planningSiteId: siteId } })))
  }

  /** A row's primary action (click, Enter on its name): open a library Target, or add a result to My targets. */
  function activate(v: RowView) {
    if (v.row.panelOf) return openTarget(v.row.panelOf)
    if (v.row.target) return openTarget(v.row.target.id)
    add(v.row)
  }
  function move(targetId: string, delta: -1 | 1) {
    movePlanned(night, order, targetId, delta)
    // The row moves in the DOM; its name keeps the focus.
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`tr[data-row-key="${CSS.escape(targetId)}"] [data-row-link]`)?.focus())
  }

  const noSite = m.project_no_site()
  const skyCell = (v: RowView, render: (sky: Extract<RowView["sky"], { status: "ok" }>, ctx: SkyContext) => ReactNode) =>
    v.sky.status === "no-site" || !ctx ? dash(noSite) : v.sky.status === "no-coordinates" ? dash(m.tonight_no_coordinates()) : render(v.sky, ctx)
  const noWindow = (sky: Extract<RowView["sky"], { status: "ok" }>) => (sky.zeroReason ? zeroReasonText(sky.zeroReason) : m.tonight_no_window())

  const designation: ColumnDef = {
    id: "designation",
    header: m.targets_designation(),
    sortable: true,
    panel: true,
    className: "min-w-32",
    cell: (v) => {
      if (v.row.panelOf)
        return (
          <Link to="/targets/$targetId" params={{ targetId: v.row.panelOf }} search={keepSearch(search)} data-row-link className="pl-4 text-muted-foreground hover:underline">
            {v.row.designation}
          </Link>
        )
      return (
        <span className="flex min-w-0 items-center gap-1.5" title={[v.row.designation, ...v.row.aliases.slice(0, 2)].join(" · ")}>
          {v.row.target ? (
            <Link to="/targets/$targetId" params={{ targetId: v.row.target.id }} search={keepSearch(search)} data-row-link className="font-medium hover:underline">
              {v.row.designation}
            </Link>
          ) : (
            <button type="button" data-row-link aria-label={m.targets_add_named({ name: v.row.designation })} onClick={() => add(v.row)} className="rounded-sm font-medium hover:underline">
              {v.row.designation}
            </button>
          )}
          {/* The first alias needs the width of a 1600 px window; below that it stays in the tooltip. */}
          {v.row.aliases[0] ? <span className="hidden max-w-36 truncate text-xs text-muted-foreground min-[100rem]:inline">{v.row.aliases[0]}</span> : null}
          {v.row.projects.map((p) => (
            <ProjectBadge key={p.id} project={p} />
          ))}
        </span>
      )
    },
  }
  const altitude: ColumnDef = { id: "maxAlt", header: m.tonight_altitude(), sortable: true, panel: true, className: "w-[7.5rem] max-w-[7.5rem]", cell: (v) => skyCell(v, (sky, c) => <AltitudeSpark ctx={c} sky={sky} />) }
  const lunar: ColumnDef = { id: "lunar", header: m.tonight_lunar(), sortable: true, panel: true, align: "right", cell: (v) => skyCell(v, (sky) => `${Math.round(sky.lunarDeg)}°`) }
  const img: ColumnDef = {
    id: "img",
    header: m.tonight_img_time(),
    sortable: true,
    panel: true,
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
  }
  const filters: ColumnDef = { id: "tonight", header: m.targets_filters(), sortable: true, panel: true, help: m.targets_filters_help(), cell: (v) => skyCell(v, (sky) => <FilterChips chips={v.tonight} empty={noWindow(sky)} />) }
  // Fit sits beside the filter chips: both follow the rig selector (D-W23).
  const fit: ColumnDef[] = rigIds.length > 0 ? [{ id: "fit", header: rigIds.length > 1 ? m.targets_fit_per_rig() : m.targets_fit(), sortable: true, cell: (v) => <FitCell fits={v.fits} /> }] : []
  const actions: ColumnDef = { id: "actions", header: m.tonight_actions(), sortable: false, panel: true, className: "w-px px-1", cell: (v) => <RowActions label={m.targets_more_for({ name: v.row.designation })} entries={rowMenu(v.row.key)} /> }

  const columns: ColumnDef[] = planned
    ? [
        designation,
        altitude,
        { id: "window", header: m.tonight_window(), sortable: false, panel: true, cell: (v) => skyCell(v, (sky, c) => (sky.windows.length > 0 ? sky.windows.map((w) => clockRange(w.start, w.end, c.site)).join(", ") : dash(noWindow(sky)))) },
        img,
        filters,
        ...fit,
        {
          id: "moon",
          header: m.tonight_moon(),
          sortable: false,
          panel: true,
          align: "right",
          cell: (v) =>
            skyCell(v, (sky) => {
              const separation = Math.round(sky.best ? sky.best.moonSeparationDeg : sky.lunarDeg)
              return (
                <span title={sky.moonUp === null ? m.plan_moon_away({ separation }) : sky.moonUp ? m.plan_moon_up_best({ separation }) : m.plan_moon_down_best({ separation })}>
                  {separation}°{sky.moonUp ? <span className="ml-0.5 text-[0.625rem] text-muted-foreground">{m.plan_moon_up()}</span> : null}
                </span>
              )
            }),
        },
        actions,
      ]
    : [
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
        designation,
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
        altitude,
        lunar,
        img,
        filters,
        ...fit,
        ...(scope
          ? [
              {
                id: "goals" as const,
                header: m.plan_goals(),
                sortable: false,
                cell: (v: RowView) => {
                  if (!v.row.target) return null
                  const gaps = gapsByTarget.get(v.row.target.id) ?? []
                  return gaps.length === 0 ? (
                    <Pill tone="success" className="h-4 px-1.5 text-[0.625rem]">
                      {m.status_met()}
                    </Pill>
                  ) : (
                    <Pill tone="warning" title={gaps.join("\n")} className="h-4 px-1.5 text-[0.625rem]">
                      {m.plan_goals_short({ count: gaps.length })}
                    </Pill>
                  )
                },
              },
            ]
          : []),
        {
          id: "opposition",
          header: m.tonight_opposition(),
          sortable: true,
          cell: (v) => (v.opposition ? shortDate(v.opposition, ctx?.nowMs ?? Date.now()) : dash(v.row.ra === null ? m.tonight_no_coordinates() : noSite)),
        },
        { id: "sessions", header: m.nav_sessions(), sortable: true, align: "right", cell: (v) => (v.sessions > 0 ? v.sessions : <span className="text-muted-foreground">–</span>) },
        { id: "captured", header: m.coverage_captured(), sortable: true, className: "max-w-40 truncate", cell: (v) => <CapturedCell captured={v.captured} /> },
        ...(searched ? [{ id: "source" as const, header: m.targets_source(), sortable: true, cell: (v: RowView) => <span className="text-xs">{rowSource(v.row)}</span> }] : []),
        actions,
      ]

  function onRowClick(event: MouseEvent<HTMLTableSectionElement>) {
    const target = event.target as HTMLElement
    if (target.closest(CONTROL) || !event.currentTarget.contains(target) || window.getSelection()?.toString()) return
    const key = target.closest<HTMLElement>("tr[data-row-key]")?.dataset.rowKey
    const v = key ? byKey.get(key) : undefined
    if (v) activate(v)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTableSectionElement>) {
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return
    const cell = (event.target as HTMLElement).closest("td, th")
    const row = cell?.closest<HTMLElement>("tr[data-row]")
    if (!cell || !row) return
    const delta = event.key === "ArrowDown" ? 1 : -1
    if (event.altKey) {
      // Alt+↑/↓ moves a planned Target (the Planned view's reorder).
      const v = byKey.get(row.dataset.rowKey ?? "")
      if (!planned || !v?.row.target) return
      event.preventDefault()
      move(v.row.target.id, delta)
      return
    }
    const all = Array.from(row.parentElement?.querySelectorAll<HTMLElement>("tr[data-row]") ?? [])
    const sibling = all[all.indexOf(row) + delta]
    const index = Array.from(row.children).indexOf(cell)
    const next = sibling?.children[index]?.querySelector<HTMLElement>("a, button") ?? sibling?.querySelector<HTMLElement>("a, button")
    if (next) {
      event.preventDefault()
      next.focus()
    }
  }

  function rowMenu(key: string): MenuEntry[] {
    const v = byKey.get(key)
    if (!v) return []
    if (v.row.panelOf) {
      const parent = v.row.panelOf
      return [{ label: m.verb_open(), onSelect: () => openTarget(parent) }]
    }
    const target = v.row.target
    const inPlan = target ? plannedIds.has(target.id) : false
    const plan: MenuEntry = inPlan ? { label: m.targets_remove_from_plan(), onSelect: () => run(() => unplan(target!.id, night)) } : { label: m.targets_add_to_plan(), onSelect: () => run(() => planRow(v.row, night)) }
    if (!target) return [{ label: m.targets_add_to_targets(), onSelect: () => add(v.row) }, plan]
    const at = order.indexOf(target.id)
    return [
      { label: m.verb_open(), onSelect: () => openTarget(target.id) },
      ...(planned
        ? [
            { label: m.plan_move_up(), shortcut: `${ALT_KEY} ↑`, disabled: at <= 0, onSelect: () => move(target.id, -1) },
            { label: m.plan_move_down(), shortcut: `${ALT_KEY} ↓`, disabled: at < 0 || at >= order.length - 1, onSelect: () => move(target.id, 1) },
          ]
        : [{ label: target.favourite ? m.targets_unstar() : m.targets_star(), onSelect: () => toggleStar(v) }]),
      plan,
      { separator: true },
      { label: m.newproject_open(), onSelect: () => openSheet({ kind: "new-project", targetId: target.id }) },
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
    if (planned) return <EmptyState icon={CalendarClock} title={m.plan_night_empty({ night: formatNight(night) })} description={null} action={<Button size="sm" variant="outline" onClick={() => setParams({ view: undefined })}>{m.project_search_my_targets()}</Button>} />
    if (searched) return <EmptyState icon={Search} title={m.targets_no_match({ query })} description={null} action={<Button size="sm" variant="outline" onClick={() => setParams({ q: undefined })}>{m.sessions_clear_search()}</Button>} />
    if (mode === "browse" && !scope && catalogues.length === 0 && !activePreset && !activeGood)
      return <EmptyState icon={Crosshair} title={m.targets_choose_catalogue()} description={null} action={<Button size="sm" onClick={() => setParams({ cat: "Messier" })}>{m.targets_browse_messier()}</Button>} />
    if (activeGood) return <EmptyState icon={Crosshair} title={m.targets_none_good({ band: activeGood })} description={null} action={<Button size="sm" variant="outline" onClick={() => applyGood(undefined)}>{m.targets_clear_filter()}</Button>} />
    if (activePreset) return <EmptyState icon={Crosshair} title={m.targets_none_match_preset({ name: activePreset.label })} description={null} action={<Button size="sm" variant="outline" onClick={() => setParams({ preset: undefined, saved: undefined })}>{m.targets_clear_preset()}</Button>} />
    return <EmptyState icon={Star} title={m.targets_empty()} description={null} action={<Button size="sm" onClick={() => setParams({ mode: "browse", cat: "Messier" })}>{m.targets_browse_catalogues()}</Button>} />
  })()

  const sortedBy = columns.find((c) => c.id === sort.column)?.header ?? sort.column
  const rigSelect = (
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
  )
  const siteItems = Object.values(sites).map((s) => ({ value: s.id, label: s.name }))
  const skyLines = ctx ? (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5">
      <MoonLine ctx={ctx} />
      <DarkLine ctx={ctx} />
      <SiteLine site={ctx.site} />
      <NoteMarker
        label={m.tonight_method()}
        rows={[
          { label: m.tonight_night(), value: formatNight(ctx.grid.night, true) },
          { label: m.tonight_times(), value: ctx.site.timeZone },
          { label: m.tonight_criteria(), value: criteriaText(m, ctx.criteria) },
          { label: m.tonight_method(), value: m.tonight_method_value() },
        ]}
      />
    </span>
  ) : (
    <AddSiteButton returnTo="/targets" />
  )

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title={m.nav_targets()}
        meta={
          <Segmented
            label={m.targets_view()}
            value={shownView}
            onChange={(next) => setParams(next === "planned" ? { view: "planned" } : { view: undefined, mode: next === "browse" ? "browse" : undefined, project: undefined, rig: scope ? undefined : search.rig, saved: undefined })}
            options={[
              { value: "my", label: m.project_search_my_targets() },
              { value: "browse", label: m.targets_browse_catalogues() },
              {
                value: "planned",
                label: (
                  <>
                    {m.targets_view_planned()} <CountBadge count={plannedIds.size} tone="muted" label={m.plan_targets_count({ count: plannedIds.size })} />
                  </>
                ),
              },
            ]}
          />
        }
        actions={
          <>
            {ctx ? <NightPicker ctx={ctx} onChange={(night) => setParams({ night })} /> : null}
            {ctx && siteItems.length > 1 ? (
              <Select items={siteItems} value={planningSiteId ?? undefined} onValueChange={(value) => chooseSite(value as string)}>
                <SelectTrigger size="sm" aria-label={m.plan_site()} className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {siteItems.map((s) => (
                    <SelectItem key={s.value} value={s.value}>
                      {s.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : null}
            {planned ? null : (
              <Button variant="outline" onClick={() => setSaveOpen(true)} disabled={Boolean(query)} title={query ? m.targets_clear_search_first() : undefined}>
                {m.targets_save_preset()}
              </Button>
            )}
          </>
        }
      />
      {planned ? (
        <div data-chrome className="flex flex-wrap items-center gap-2 border-b border-separator px-5 py-2" data-planned-header>
          {rigSelect}
          <MoonLimitsButton bands={bands} />
          <RemindersControl />
          <ExportCalendarButton />
          <div className="flex-1" />
          {skyLines}
        </div>
      ) : (
        <div data-chrome className="space-y-2 border-b border-separator px-5 py-2">
          <div className="flex flex-wrap items-center gap-2">
            {scope ? (
              <span className="inline-flex items-center gap-1" data-project-scope>
                <Pill tone="info" link={{ to: "/projects/$projectId", params: { projectId: scope.id } }}>
                  {scope.name}
                </Pill>
                <Button size="icon-xs" variant="ghost" aria-label={m.targets_clear_project()} title={m.targets_clear_project()} onClick={() => setParams({ project: undefined, rig: undefined })}>
                  <X aria-hidden="true" />
                </Button>
              </span>
            ) : null}
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
            {rigSelect}
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
            {skyLines}
          </div>
          {mode === "browse" && !scope && !query ? (
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
      )}

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
                {planned ? m.plan_list() : searched ? m.targets_caption_search({ query }) : scope ? m.targets_caption_project({ name: scope.name }) : mode === "browse" ? m.targets_browse_catalogues() : m.project_search_my_targets()}, {m.plan_rows_count({ count: shown.length })}
              </caption>
              <thead data-chrome className="sticky top-0 z-10 bg-[color-mix(in_oklch,var(--chrome)_70%,var(--background))] text-[0.6875rem] font-medium text-muted-foreground shadow-[inset_0_-1px_0_var(--border)]">
                <tr>
                  {columns.map((c) => {
                    const sortable = c.sortable && !planned
                    const active = sortable && sort.column === c.id
                    return (
                      <th
                        key={c.id}
                        scope="col"
                        aria-sort={sortable ? (active ? (sort.direction === "asc" ? "ascending" : "descending") : "none") : undefined}
                        className={cn("h-(--row-h) px-2 font-medium whitespace-nowrap", c.align === "right" ? "text-right" : "text-left", c.id === "maxAlt" && c.className)}
                      >
                        <span className="inline-flex items-center gap-1">
                          {sortable ? (
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
              <tbody onKeyDown={onKeyDown} onClick={onRowClick}>
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
                      data-panel-row={v.row.panelOf ? "" : undefined}
                      {...menuKey(v.row.key)}
                      className={cn("h-(--row-h) cursor-default border-b border-border/50 last:border-0 hover:bg-foreground/[0.05]", v.row.panelOf ? "bg-foreground/[0.025]" : "even:bg-foreground/[0.022]")}
                    >
                      {columns.map((c) => {
                        const Cell = c.id === "designation" ? "th" : "td"
                        return (
                          <Cell key={c.id} scope={c.id === "designation" ? "row" : undefined} className={cn("px-2 py-(--row-py) font-normal whitespace-nowrap tabular-nums", c.align === "right" ? "text-right" : "text-left", c.className)}>
                            {v.row.panelOf && !c.panel ? null : c.cell(v)}
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
        {m.plan_targets_count({ count: parents.length })}
        {planned ? null : (
          <>
            {" "}
            · {sortedBy} {sort.direction === "asc" ? "↑" : "↓"}
            <span className="sr-only"> {sort.direction === "asc" ? m.targets_sort_ascending() : m.targets_sort_descending()}</span>
          </>
        )}
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

/** The Targets view keys a Target link carries, so the list (and its night) is the same on return. */
export function keepSearch(search: SearchParams): SearchParams {
  const kept: SearchParams = {}
  for (const key of ["view", "night", "q", "mode", "cat", "preset", "good", "rig", "sort", "project", "saved"]) if (search[key]) kept[key] = search[key]
  return kept
}
