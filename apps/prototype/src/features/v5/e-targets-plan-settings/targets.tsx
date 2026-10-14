/**
 * S10 Targets (`/targets`, slice E): the planning list on a ListPage
 * (P-PLAN2, R9 composition §7.4).
 *
 * - Header: the night (NightPicker; default tonight, `?night=`) and the
 *   planning site (SitePicker) beside the title, with the night's darkness
 *   and Moon; every planning value follows them. Actions: Moon limits…, and
 *   on Planned, Reminders… and Export calendar….
 * - Views (tabs): My targets (favourites and open-Project subjects, the
 *   default), Browse catalogues (`?mode=browse`) and Planned (`?view=planned`,
 *   the chosen night's plan).
 * - Toolbar: search (My targets, the library, the bundled catalogues and
 *   SIMBAD), the facets Catalogues (Browse), Suitable filters (any picked
 *   filter good or marginal under its Moon curve, C2/C6; Q16) and Rig, and
 *   the Presets ▾ menu (built-in, saved, Save current…, Delete).
 * - Suitable filters column: one badge per grade, good then marginal, poor
 *   hidden (Q36). It sorts by its grade points, or with picked filters by
 *   their longest Moon-clear time.
 * - Order: Planning's (C7, `planningPriorities`): Targets whose Project
 *   window closes soonest first, so a subject rises as its deadline nears;
 *   then by designation. Every column sorts; the Planned view keeps the
 *   plan's order (Move up / Move down), then priority, then first window.
 * - A row click opens a library Target in the docked DetailPanel (Add to
 *   Plan, Add to Project ▸, New Project…, Open) and adds a catalogue or
 *   SIMBAD result to My targets. A mosaic subject's panels fold out under
 *   it.
 *
 * The view lives in the URL (`view`, `night`, `mode`, `cat`, `preset`,
 * `good`, `rig`, `q`, `project`, `saved`, `open`), so opening a Target and
 * coming back keeps it.
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { CalendarArrowDown, CalendarClock, Crosshair, MoonStar, Search, Star } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { useMessages, usePreferences } from "@/app/preferences"
import { ActionButton, useAction } from "@/components/app/actions"
import type { Action, Column, Facet, MenuItem, Preset } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { EmptyState, type PageNotice } from "@/components/app/feedback"
import type { FacetPatch } from "@/components/app/filter-bar"
import { NightPicker, SitePicker } from "@/components/app/pickers"
import { GradeBadges } from "@/components/domain/grade-badges"
import { AltitudeSpark, DarkLine, MoonLine } from "@/components/domain/sky-lines"
import type { PageDetail } from "@/components/templates/detail-panel"
import { ListPage } from "@/components/templates/list-page"
import { formatHours, goalProgress } from "@/domain/derive"
import { objectTypeRef } from "@/domain/labels"
import { nightPlan } from "@/domain/planning"
import { CATALOGUES, type CatalogueId } from "@/domain/sky"
import type { OpticalTrainId } from "@/domain/types"
import { formatNight } from "@/lib/format"
import { say } from "@/lib/i18n"
import type { SearchParams } from "@/routes"
import { type CommitResult, store, useStore } from "@/store/core"
import { MoonLimitsDialog } from "./moon-limits"
import { addToProjectMenu, capturedText, choosePlanningSite, clockRange, fitText, keepSearch, myTargetsAction, newProjectAction, planAction, planNight, siteOptions, useSkyContext } from "./parts"
import { ExportCalendarDialog, RemindersDialog } from "./planned-tools"
import {
  addToMyTargets,
  allRows,
  BUILT_IN_PRESETS,
  browseRows,
  fitValue,
  GOOD_TONIGHT_SORT,
  goodFor,
  movePlanned,
  myTargetRows,
  panelRows,
  parseBands,
  parseSort,
  plannedOrder,
  presetById,
  presetUnavailable,
  prioritiesByTarget,
  priorityOrder,
  projectRows,
  type RowInputs,
  rowSource,
  type RowView,
  rowView,
  type SkyContext,
  type SortSpec,
  searchRows,
  selectionBands,
  sessionCountsByTarget,
  sortValue,
  zeroReasonText,
  zeroReasonWord,
} from "./targets-model"
import { deletePreset, savedPresetUnavailable, savePreset, VIEW_KEYS } from "./targets-presets"

/** Opposition as "2 Nov", or "2 Aug ’27" when it falls in another year. */
function shortDate(night: string, nowMs: number): string {
  const label = formatNight(night)
  return night.slice(0, 4) === String(new Date(nowMs).getUTCFullYear()) ? label : `${label} ’${night.slice(2, 4)}`
}

/** Simulated SIMBAD round trip, long enough to show "Searching SIMBAD…". */
const SIMBAD_MS = 450

/** The Presets ▾ ids: built-in and saved presets share one menu. */
const BUILT_IN = "builtin:"
const SAVED = "saved:"
const NO_PRESET = "none"

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

type SkyOk = Extract<RowView["sky"], { status: "ok" }>
type View = "my" | "browse" | "planned"

export function TargetsPage() {
  const m = useMessages()
  const { locale } = usePreferences()
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const saved = useStore((s) => s.slices.e.savedPresets)
  const planOrder = useStore((s) => s.slices.e.planOrder)
  const curves = useStore((s) => s.settings.moonAvoidance)
  const planningSiteId = useStore((s) => s.settings.planningSiteId ?? s.settings.defaultSiteId)
  const defaultSiteId = useStore((s) => s.settings.defaultSiteId)
  const ctx = useSkyContext(search.night)
  const [simbad, retrySimbad] = useSimbad(search.q ?? "")
  const siteRunner = useAction()
  const [dialog, setDialog] = useState<"moon" | "reminders" | "export" | null>(null)

  const view: View = search.view === "planned" ? "planned" : search.mode === "browse" ? "browse" : "my"
  const planned = view === "planned"
  /** The night the page plans for: Add to plan adds to it, and Planned lists its plan. */
  const night = planNight(ctx)
  const query = planned ? "" : (search.q ?? "")
  // The field keeps its own value while focused, so fast typing never races the URL update.
  const [draftQuery, setDraftQuery] = useState(query)
  const typed = useRef(query)
  useEffect(() => {
    // A query that did not come from typing here (Clear, a link, the palette) replaces the field.
    if (query !== typed.current) {
      typed.current = query
      setDraftQuery(query)
    }
  }, [query])
  const project = search.project ? catalog.projects[search.project] : undefined
  const scope = planned ? undefined : project
  const catalogues = (search.cat ?? "").split(",").filter((c): c is CatalogueId => (CATALOGUES as readonly string[]).includes(c))
  const rigParam = search.rig ?? (project ? "project" : "")
  const rigIds: OpticalTrainId[] = rigParam === "project" ? (project?.rigIds ?? []) : rigParam && catalog.opticalTrains[rigParam] ? [rigParam] : []
  const bands = selectionBands(catalog, rigIds)
  const preset = presetById(search.preset)
  const presetBlocked = preset ? presetUnavailable(preset, rigIds, bands) : null
  const activePreset = preset && !presetBlocked && !query && !planned ? preset : undefined
  const good = parseBands(search.good).filter((b) => bands.includes(b))
  const activeGood = query || planned ? [] : good
  const activeSaved = search.saved ? saved.find((p) => p.id === search.saved) : undefined
  const savedSort = activeSaved ? parseSort(activeSaved.view.sort) : null
  const firstSort: SortSpec | undefined = activeGood.length > 0 ? GOOD_TONIGHT_SORT : (activePreset?.sort ?? savedSort ?? undefined)

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
  const browsing = catalogues.length > 0 || Boolean(activePreset) || activeGood.length > 0
  const baseRows = useMemo(() => {
    if (planned) return rows.filter((r) => r.target && plannedIds.has(r.target.id))
    if (searched) return searched
    if (scope) return projectRows(rows, scope)
    if (view === "browse") return browsing ? browseRows(rows, catKey ? (catKey.split(",") as CatalogueId[]) : []) : []
    return myTargetRows(rows)
  }, [planned, rows, plannedIds, searched, scope, view, browsing, catKey])
  const rigKey = rigIds.join(",")
  const inputs = useMemo<RowInputs>(
    () => ({ rigIds, sessionCounts: sessionCountsByTarget(catalog), curves, priorities: prioritiesByTarget(catalog, night) }),
    [catalog, rigKey, curves, night],
  )
  const views = useMemo(() => baseRows.map((row) => rowView(catalog, disk, ctx, row, inputs)), [baseRows, catalog, disk, ctx, inputs])
  const nightOrder = planOrder[night]
  const goodKey = activeGood.join(",")
  const shown = useMemo(() => {
    if (planned) return plannedOrder(views, nightOrder ?? [])
    return priorityOrder(goodFor(activePreset ? views.filter(activePreset.match) : views, activeGood))
  }, [planned, views, nightOrder, activePreset, goodKey])
  /** The Planned view's order, as Target ids: what Move up and Move down rearrange. */
  const order = planned ? shown.map((v) => v.row.key) : []
  const gapsByTarget = useMemo(() => {
    const out = new Map<string, number>()
    if (!scope) return out
    for (const progress of goalProgress(catalog, scope)) {
      const targetId = scope.subjects.find((s) => s.id === progress.goal.subjectId)?.targetId
      if (targetId && !progress.met) out.set(targetId, (out.get(targetId) ?? 0) + 1)
    }
    return out
  }, [catalog, scope])

  const openTarget = (targetId: string) => void navigate({ to: "/targets/$targetId", params: { targetId }, search: keepSearch(search) } as never)
  /** A row's primary action (click, Enter): a library Target opens in the panel; a result is added to My targets. */
  function activate(v: RowView) {
    if (v.row.target) return setParams({ open: v.row.target.id })
    const { result, targetId } = addToMyTargets(v.row)
    if (result.ok && targetId) setParams({ open: targetId })
  }

  const noSite = m.project_no_site()
  const skyCell = (v: RowView, render: (sky: SkyOk, ctx: SkyContext) => ReactNode) =>
    v.sky.status === "no-site" || !ctx ? noSite : v.sky.status === "no-coordinates" ? m.tonight_no_coordinates() : render(v.sky, ctx)
  const imgCell = (sky: SkyOk) => (sky.imgTimeS > 0 ? formatHours(sky.imgTimeS) : `${m.tonight_zero_hours()}${sky.zeroReason ? ` · ${zeroReasonWord(sky.zeroReason)}` : ""}`)
  const noWindow = (sky: SkyOk) => (sky.zeroReason ? zeroReasonText(sky.zeroReason) : m.tonight_no_window())
  const okSort = (column: Parameters<typeof sortValue>[1]) => (v: RowView) => sortValue(v, column, activeGood)

  // ------------------------------------------------------------------
  // Columns
  // ------------------------------------------------------------------
  const designation: Column<RowView> = { id: "designation", header: m.targets_designation(), rowHeader: true, truncate: true, sortValue: okSort("designation"), cell: (v) => v.row.designation }
  const altitude: Column<RowView> = {
    id: "maxAlt",
    header: m.tonight_altitude(),
    sortValue: okSort("maxAlt"),
    cell: (v) => skyCell(v, (sky, c) => <AltitudeSpark night={c.grid} sky={sky} darkness={c.summary.darkness} minAltitudeDeg={c.criteria.minAltitudeDeg} timeZone={c.site.timeZone} />),
  }
  const img: Column<RowView> = { id: "img", header: m.tonight_img_time(), align: "right", truncate: true, sortValue: okSort("img"), cell: (v) => skyCell(v, imgCell) }
  const filters: Column<RowView> = {
    id: "tonight",
    header: activeGood.length > 0 ? m.targets_filters_band({ band: activeGood.join(", ") }) : m.domain_suitable_filters(),
    sortValue: okSort("tonight"),
    cell: (v) => skyCell(v, (sky) => <GradeBadges grades={v.tonight} empty={noWindow(sky)} byGrade />),
  }
  const priority: Column<RowView> = { id: "priority", header: m.targets_deadline(), truncate: true, sortValue: okSort("priority"), cell: (v) => (v.priority ? say(m, v.priority.window.line) : "–") }
  const fits: Column<RowView>[] = rigIds.map((rigId, index) => ({
    id: `fit:${rigId}`,
    header: rigIds.length > 1 ? m.targets_fit_rig({ rig: catalog.opticalTrains[rigId]?.name ?? rigId }) : m.targets_fit(),
    sortValue: (v: RowView) => fitValue(v.fits[index]?.fit),
    cell: (v: RowView) => (v.fits[index] ? fitText(m, v.fits[index].fit) : "–"),
  }))

  const columns: Column<RowView>[] = planned
    ? ([
        designation,
        altitude,
        {
          id: "window",
          header: m.tonight_window(),
          cell: (v) => skyCell(v, (sky, c) => (sky.windows.length > 0 ? sky.windows.map((w) => clockRange(w.start, w.end, c.site.timeZone)).join(", ") : noWindow(sky))),
        },
        img,
        filters,
        {
          id: "moon",
          header: m.tonight_moon(),
          cell: (v) =>
            skyCell(v, (sky) => {
              const separation = Math.round(sky.lunarDeg)
              return sky.moonUp === null ? m.plan_moon_away({ separation }) : sky.moonUp ? m.plan_moon_up_best({ separation }) : m.plan_moon_down_best({ separation })
            }),
        },
        priority,
      ] satisfies Column<RowView>[]).map((c): Column<RowView> => ({ ...c, sortValue: undefined, static: true }))
    : [
        designation,
        ...(view === "browse" || searched
          ? [{ id: "mine", header: m.project_search_my_targets(), sortValue: (v: RowView) => (v.row.mine ? 1 : 0), cell: (v: RowView) => (v.row.mine ? <Star role="img" aria-label={m.targets_in_my_targets()} className="size-3.5 fill-warning text-warning" /> : null) }]
          : []),
        { id: "type", header: m.targets_type(), truncate: true, sortValue: okSort("type"), cell: (v) => (v.row.objectType ? say(m, objectTypeRef(v.row.objectType)) : "–") },
        ...(view === "browse" && !searched ? [] : [priority]),
        altitude,
        { id: "lunar", header: m.tonight_lunar(), align: "right", sortValue: okSort("lunar"), cell: (v) => skyCell(v, (sky) => `${Math.round(sky.lunarDeg)}°`) },
        img,
        filters,
        ...fits,
        ...(scope
          ? [{ id: "goals", header: m.plan_goals(), align: "right" as const, sortValue: (v: RowView) => (v.row.target ? (gapsByTarget.get(v.row.target.id) ?? 0) : null), cell: (v: RowView) => goalsCell(v) }]
          : []),
        { id: "projects", header: m.nav_projects(), truncate: true, sortValue: (v) => v.row.projects.map((p) => p.name).join(", ") || null, cell: (v) => v.row.projects.map((p) => p.name).join(", ") || "–" },
        { id: "opposition", header: m.tonight_opposition(), sortValue: okSort("opposition"), cell: (v) => (v.opposition ? shortDate(v.opposition, ctx?.nowMs ?? Date.now()) : "–") },
        { id: "sessions", header: m.nav_sessions(), align: "right", sortValue: okSort("sessions"), cell: (v) => (v.sessions > 0 ? String(v.sessions) : "–") },
        { id: "captured", header: m.coverage_captured(), truncate: true, sortValue: okSort("captured"), cell: (v) => capturedText(v.captured) },
        ...(searched ? [{ id: "source", header: m.targets_source(), sortValue: okSort("source"), cell: (v: RowView) => rowSource(v.row) }] : []),
      ]
  function goalsCell(v: RowView): string {
    const gaps = v.row.target ? (gapsByTarget.get(v.row.target.id) ?? 0) : 0
    return gaps === 0 ? m.status_met() : m.plan_goals_short({ count: gaps })
  }

  // ------------------------------------------------------------------
  // Row actions and the detail panel
  // ------------------------------------------------------------------
  function rowActions(v: RowView): MenuItem[] {
    const target = v.row.target
    const plan = planAction(m, v.row, night, Boolean(target && plannedIds.has(target.id)))
    if (!target) return [{ ...myTargetsAction(m, v.row), id: "add" }, plan]
    const at = order.indexOf(target.id)
    const addTo = addToProjectMenu(m, catalog, target)
    return [
      { id: "details", label: m.targets_details(), run: () => setParams({ open: target.id }) },
      { id: "open", label: m.verb_open(), run: () => openTarget(target.id) },
      ...(planned
        ? [
            { id: "up", label: m.plan_move_up(), run: () => movePlanned(night, order, target.id, -1), ...(at <= 0 ? { unavailable: { action: m.plan_move_up(), reason: m.plan_first_already(), blockers: [] } } : {}) },
            { id: "down", label: m.plan_move_down(), run: () => movePlanned(night, order, target.id, 1), ...(at < 0 || at >= order.length - 1 ? { unavailable: { action: m.plan_move_down(), reason: m.plan_last_already(), blockers: [] } } : {}) },
          ]
        : []),
      { separator: true },
      plan,
      myTargetsAction(m, v.row),
      ...(addTo ? [addTo] : []),
      newProjectAction(m, target.id),
    ]
  }

  const openId = search.open && catalog.targets[search.open] ? search.open : null
  const openView = useMemo(() => {
    if (!openId) return null
    const row = rows.find((r) => r.key === openId)
    return row ? rowView(catalog, disk, ctx, row, inputs) : null
  }, [openId, rows, catalog, disk, ctx, inputs])
  const detail: PageDetail | null =
    openView && openView.row.target
      ? (() => {
          const target = openView.row.target
          const addTo = addToProjectMenu(m, catalog, target)
          const sky = openView.sky
          return {
            dockId: "targets",
            title: target.name,
            actions: [planAction(m, openView.row, night, plannedIds.has(target.id)), newProjectAction(m, target.id), { id: "open", label: m.verb_open(), run: () => openTarget(target.id) }],
            menu: { label: m.target_menu(), items: [myTargetsAction(m, openView.row), ...(addTo ? [addTo] : [])] },
            content: (
              <KeyValueList
                items={[
                  ...(sky.status === "ok" && ctx
                    ? [
                        { label: m.tonight_altitude(), value: <AltitudeSpark night={ctx.grid} sky={sky} darkness={ctx.summary.darkness} minAltitudeDeg={ctx.criteria.minAltitudeDeg} timeZone={ctx.site.timeZone} /> },
                        { label: m.tonight_best(), value: sky.best ? clockRange(sky.best.start, sky.best.end, ctx.site.timeZone) : m.target_best_none() },
                        { label: m.tonight_img_time(), value: imgCell(sky) },
                        { label: m.domain_suitable_filters(), value: <GradeBadges grades={openView.tonight} empty={noWindow(sky)} wrap /> },
                        { label: m.tonight_lunar(), value: `${Math.round(sky.lunarDeg)}°` },
                      ]
                    : []),
                  { label: m.targets_deadline(), value: openView.priority ? say(m, openView.priority.window.line) : "–" },
                  { label: m.targets_type(), value: openView.row.objectType ? say(m, objectTypeRef(openView.row.objectType)) : "–" },
                  { label: m.nav_projects(), value: openView.row.projects.map((p) => p.name).join(", ") || "–" },
                  { label: m.coverage_captured(), value: capturedText(openView.captured) },
                  { label: m.tonight_opposition(), value: openView.opposition ? formatNight(openView.opposition, true) : "–" },
                ]}
              />
            ),
            onClose: () => setParams({ open: undefined }),
          }
        })()
      : null

  // ------------------------------------------------------------------
  // Toolbar: search, facets, presets
  // ------------------------------------------------------------------
  const rigOptions = [
    ...(project ? [{ value: "project", label: m.targets_project_rigs({ count: project.rigIds.length }) }] : []),
    ...Object.values(catalog.opticalTrains)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((r) => ({ value: r.id, label: r.name })),
  ]
  const facets: Facet[] = [
    ...(view === "browse" && !query
      ? [{ id: "cat", label: m.targets_catalogues(), kind: "multi" as const, options: CATALOGUES.map((c) => ({ value: c, label: c })), value: catalogues }]
      : []),
    ...(planned ? [] : [{ id: "good", label: m.domain_suitable_filters(), kind: "multi" as const, options: bands.map((b) => ({ value: b, label: b })), value: good }]),
    { id: "rig", label: m.targets_rig(), kind: "single", options: rigOptions, value: rigIds.length > 0 ? rigParam : "" },
  ]
  function onFacets(patch: FacetPatch) {
    const next: SearchParams = { saved: undefined }
    if ("cat" in patch) next.cat = (patch.cat as string[]).join(",") || undefined
    if ("good" in patch) next.good = (patch.good as string[]).join(",") || undefined
    if ("rig" in patch) next.rig = (patch.rig as string) || (project ? "none" : undefined)
    setParams(next)
  }
  const visiblePresets = BUILT_IN_PRESETS.filter((p) => !(p.needs === "rig" && rigIds.length === 0) && !(p.needs === "narrowband" && presetUnavailable(p, rigIds, bands)))
  const presetItems: Preset[] = planned
    ? []
    : [
        ...(activePreset || activeSaved ? [{ id: NO_PRESET, label: m.targets_preset_none(), source: "builtin" as const }] : []),
        ...visiblePresets.map((p) => ({ id: `${BUILT_IN}${p.id}`, label: p.label, source: "builtin" as const })),
        ...saved.map((p) => {
          const blocked = savedPresetUnavailable(catalog, p.view)
          return { id: `${SAVED}${p.id}`, label: p.name, source: "custom" as const, ...(blocked ? { unavailable: blocked } : {}) }
        }),
      ]
  function applyPreset(id: string) {
    if (id === NO_PRESET) return setParams({ preset: undefined, saved: undefined })
    if (id.startsWith(BUILT_IN)) return setParams({ preset: id.slice(BUILT_IN.length), saved: undefined, q: undefined })
    const p = saved.find((x) => `${SAVED}${x.id}` === id)
    if (!p) return
    const patch: SearchParams = { saved: p.id, q: undefined }
    for (const key of VIEW_KEYS) patch[key] = p.view[key]
    setParams(patch)
  }
  const currentView = { mode: view === "browse" ? "browse" : undefined, cat: catalogues.join(",") || undefined, preset: activePreset?.id, good: good.join(",") || undefined, rig: rigParam !== "project" && rigIds.length > 0 ? rigParam : undefined }

  // ------------------------------------------------------------------
  // Empty states, notice, header
  // ------------------------------------------------------------------
  const go = (id: string, label: string, patch: SearchParams): Action => ({ id, label, run: () => setParams(patch) })
  const empty = (() => {
    if (planned) return <EmptyState icon={CalendarClock} title={m.plan_night_empty({ night: formatNight(night) })} action={<ActionButton action={go("my", m.project_search_my_targets(), { view: undefined })} />} />
    if (searched) return <EmptyState icon={Search} title={m.targets_no_match({ query })} action={<ActionButton action={go("clear", m.sessions_clear_search(), { q: undefined })} />} />
    if (view === "browse" && !scope && !browsing) return <EmptyState icon={Crosshair} title={m.targets_choose_catalogue()} action={<ActionButton action={go("messier", m.targets_browse_messier(), { cat: "Messier" })} />} />
    if (activeGood.length > 0) return <EmptyState icon={Crosshair} title={m.targets_none_suitable()} action={<ActionButton action={go("clear-good", m.targets_clear_filter(), { good: undefined })} />} />
    if (activePreset) return <EmptyState icon={Crosshair} title={m.targets_none_match_preset({ name: activePreset.label })} action={<ActionButton action={go("clear-preset", m.targets_clear_preset(), { preset: undefined, saved: undefined })} />} />
    return <EmptyState icon={Star} title={m.targets_empty()} action={<ActionButton action={go("browse", m.targets_browse_catalogues(), { mode: "browse", cat: "Messier" })} />} />
  })()

  const notice: PageNotice | null = (() => {
    if (searched && simbad?.query === query.trim()) {
      if (simbad.status === "searching") return { tone: "info", title: m.targets_simbad_searching() }
      if (simbad.status === "off")
        return {
          tone: "offline",
          title: m.targets_simbad_off(),
          actions: <ActionButton action={{ id: "lookup", label: m.settings_target_lookup(), run: () => void navigate({ to: "/settings/targets", search: { return: "/targets" } } as never) }} />,
        }
      if (simbad.status === "unreachable") return { tone: "offline", title: m.targets_simbad_unreachable(), actions: <ActionButton action={{ id: "retry", label: m.verb_retry(), run: retrySimbad }} /> }
    }
    if (scope) return { tone: "info", title: m.targets_planning_for({ name: scope.name }), actions: <ActionButton action={go("clear-project", m.targets_clear_project(), { project: undefined, rig: undefined })} /> }
    if (presetBlocked && preset && !planned) return { tone: "warning", title: m.targets_preset_unavailable({ name: preset.label }), detail: presetBlocked }
    return null
  })()

  const manageSites = () => void navigate({ to: "/settings/sites", search: { return: "/targets" } } as never)
  const context = (
    <>
      {ctx ? <NightPicker value={ctx.grid.night} today={ctx.tonight} onChange={(n) => setParams({ night: n === ctx.tonight ? undefined : n })} /> : null}
      <SitePicker
        value={planningSiteId}
        onChange={(siteId) => siteRunner.run({ id: "planning-site", label: m.plan_site(), run: (): CommitResult => choosePlanningSite(siteId) })}
        sites={siteOptions(catalog)}
        defaultSiteId={defaultSiteId}
        onManage={manageSites}
      />
      {ctx ? <DarkLine darkness={ctx.summary.darkness} timeZone={ctx.site.timeZone} /> : null}
      {ctx ? <MoonLine moon={ctx.summary.moon} timeZone={ctx.site.timeZone} /> : null}
      {siteRunner.feedback}
    </>
  )

  const actions: Action[] = [
    { id: "moon-limits", label: m.tonight_moon_limits(), icon: MoonStar, opensDialog: true, run: () => setDialog("moon") },
    ...(planned
      ? [
          { id: "reminders", label: m.plan_reminders(), icon: CalendarClock, opensDialog: true, run: () => setDialog("reminders") },
          { id: "export-calendar", label: m.plan_export_calendar(), icon: CalendarArrowDown, opensDialog: true, run: () => setDialog("export") },
        ]
      : []),
  ]

  const caption = planned ? m.plan_list() : searched ? m.targets_caption_search({ query }) : scope ? m.targets_caption_project({ name: scope.name }) : view === "browse" ? m.targets_browse_catalogues() : m.project_search_my_targets()
  const closeDialog = (open: boolean) => !open && setDialog(null)
  // Remount the table when the view's first order changes (a preset, a Suitable filters pick): DataTable keeps the user's sort until then.
  const tableKey = `${view}:${activePreset?.id ?? ""}:${activeSaved?.id ?? ""}:${goodKey}:${rigKey}:${searched ? "q" : ""}:${locale}`

  return (
    <>
      <ListPage<RowView>
        title={m.nav_targets()}
        summary={m.plan_targets_count({ count: shown.length })}
        context={context}
        actions={actions}
        views={{
          label: m.targets_view(),
          value: view,
          onChange: (id) => setParams(id === "planned" ? { view: "planned", open: undefined } : { view: undefined, mode: id === "browse" ? "browse" : undefined, project: id === "browse" ? undefined : search.project, open: undefined }),
          items: [
            { id: "my", label: m.project_search_my_targets() },
            { id: "browse", label: m.targets_browse_catalogues() },
            { id: "planned", label: m.targets_view_planned(), count: plannedIds.size },
          ],
        }}
        notice={notice}
        detail={detail}
        table={{
          label: caption,
          rows: shown,
          columns,
          getRowId: (v) => v.row.key,
          rowLabel: (v) => v.row.designation,
          rowActions,
          onRowClick: activate,
          activeRowId: openId,
          initialSort: firstSort ? { columnId: firstSort.column, direction: firstSort.direction } : undefined,
          empty,
          stickyFirstColumn: true,
          expand: {
            isExpandable: (v) => panelRows(v.row).length > 0,
            render: (v) => <PanelTable parent={v} ctx={ctx} inputs={inputs} />,
          },
          toolbar: {
            search: planned
              ? undefined
              : {
                  label: m.targets_search_label(),
                  placeholder: m.targets_search_placeholder(),
                  value: draftQuery,
                  onChange: (value) => {
                    typed.current = value
                    setDraftQuery(value)
                    setParams({ q: value || undefined, open: undefined })
                  },
                },
            facets: { items: facets, onChange: onFacets },
            presets: planned
              ? undefined
              : {
                  items: presetItems,
                  active: activeSaved ? `${SAVED}${activeSaved.id}` : activePreset ? `${BUILT_IN}${activePreset.id}` : null,
                  apply: applyPreset,
                  save: (name) => setParams({ saved: savePreset(name, currentView).id }),
                  remove: (id) => {
                    const presetId = id.slice(SAVED.length)
                    deletePreset(presetId)
                    if (search.saved === presetId) setParams({ saved: undefined })
                  },
                },
            matchCount: shown.length,
          },
        }}
        key={tableKey}
      />
      <MoonLimitsDialog open={dialog === "moon"} onOpenChange={closeDialog} bands={bands} />
      <RemindersDialog open={dialog === "reminders"} onOpenChange={closeDialog} />
      <ExportCalendarDialog open={dialog === "export"} onOpenChange={closeDialog} />
    </>
  )
}

/** A mosaic subject's panels, folded out under its row (D-W63): each panel's night at the planning site. */
function PanelTable({ parent, ctx, inputs }: { parent: RowView; ctx: SkyContext | null; inputs: RowInputs }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const panels = useMemo(() => panelRows(parent.row).map((row) => rowView(catalog, disk, ctx, row, inputs)), [parent, catalog, disk, ctx, inputs])
  const sky = (v: RowView) => (v.sky.status === "ok" ? v.sky : null)
  const columns: Column<RowView>[] = [
    { id: "panel", header: m.targets_panel(), rowHeader: true, sortValue: (v) => v.row.designation, cell: (v) => v.row.designation },
    { id: "maxAlt", header: m.tonight_altitude(), sortValue: (v) => sky(v)?.peakDeg ?? null, cell: (v) => (sky(v) && ctx ? <AltitudeSpark night={ctx.grid} sky={sky(v)!} darkness={ctx.summary.darkness} minAltitudeDeg={ctx.criteria.minAltitudeDeg} timeZone={ctx.site.timeZone} /> : "–") },
    { id: "img", header: m.tonight_img_time(), align: "right", sortValue: (v) => sky(v)?.imgTimeS ?? null, cell: (v) => (sky(v) ? formatHours(sky(v)!.imgTimeS) : "–") },
    { id: "tonight", header: m.domain_suitable_filters(), sortValue: (v) => sortValue(v, "tonight"), cell: (v) => <GradeBadges grades={v.tonight} empty={m.tonight_no_window()} byGrade /> },
  ]
  return <DataTable label={m.rungroup_panels_label({ name: parent.row.designation })} rows={panels} columns={columns} getRowId={(v) => v.row.key} scroll="none" />
}
