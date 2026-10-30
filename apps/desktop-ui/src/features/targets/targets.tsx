/**
 * Targets (`/targets`, PLAN-TGT-FR-01..18): the planning list on a
 * ListPage, every planning value as the library computed it
 * (`planning_target_rows`) for the page's night at its planning site under
 * Home's stored criteria.
 *
 * - Header: the night (NightPicker, `?night=`, tonight by default) and the
 *   planning site (SitePicker, `?site=`, the default site by default) with
 *   the night's Moon, once (PLAN-TGT-FR-07). Actions: Moon limits….
 * - Views: My targets (the default), Browse catalogues (`?mode=browse`) and
 *   Planned (`?view=planned`). The night's plan has no library read yet
 *   (astro-plan-wre19.14), so Planned shows that it isn't available.
 * - Toolbar: search over My targets, the library, the bundled catalogues and
 *   SIMBAD (`?q=`); the facets Catalogues (Browse), Suitable filters and
 *   Favourite; Presets ▾; with a Project context (`?project=`, "Open in
 *   Planner") Clear Project; the rig selector (no rig, each saved rig from
 *   `library_list_equipment`, or this Project's rigs) picks the rigs Fit,
 *   the Filters strip and the presets plan for (PLAN-TGT-FR-11).
 * - Rows: the library sorts (unknown values last, catalogue order); a header
 *   click asks it for that sort. A row in My targets opens its Target page;
 *   any other row, like a search result, is added to My targets as a
 *   favourite and the list stays as it is (search.ts).
 *
 * Without Home's criteria the library lists no row at all, so the list asks
 * for them; listing without criteria comes with astro-plan-wre19.19.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate, useSearch } from "@tanstack/react-router"
import { CalendarClock, Check, Crosshair, MoonStar, Search, SlidersHorizontal, Star, Telescope } from "lucide-react"
import { useEffect, useRef, useState } from "react"
import { library, type TargetRow_Serialize, type TargetsPage_Serialize, type TargetsSearchResult, type TargetsSearchSource } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column, Facet, MenuItem } from "@/components/app/contracts"
import { EmptyState, type PageNotice, UnknownValue } from "@/components/app/feedback"
import type { FacetPatch } from "@/components/app/filter-bar"
import { NightPicker, SitePicker } from "@/components/app/pickers"
import { failureMessage } from "@/components/app/run-result"
import { MoonLimitsDialog } from "@/components/domain/moon-limits"
import { MoonLine } from "@/components/domain/sky-lines"
import { ListPage } from "@/components/templates/list-page"
import { formatCount, formatDegrees, formatList } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { suitableFacet } from "./good-tonight"
import { favouriteAction, notYet, readFailure, Unknown } from "./parts"
import { equipmentQuery, homeCriteriaQuery, libraryQueryWhen, presetsQuery, sitesQuery, targetsWrite } from "./queries"
import { useResultAction } from "./search"
import { moonTonight } from "./sky-tonight"
import {
  CATALOGUES,
  capturedText,
  catalogueName,
  fitText,
  imgTimeText,
  inMyTargets,
  matchesRow,
  oppositionText,
  facetSearch,
  parseBands,
  parseFavourite,
  presetDefinition,
  presetFilters,
  presetSearch,
  readState,
  recommendationText,
  type SearchParams,
  sortColumn,
  sortParam,
  type TargetsState,
  type TargetsView,
  targetsQuery,
  viableBands,
  viewSearch,
} from "./targets-model"
import { activePreset, parsePresetId, presetItems, RenamePresetDialog, usePresetWrites } from "./targets-presets"

/** Searches start at two characters, as the library's search does. */
const MIN_QUERY = 2
/** The pause after typing before the search runs (each search may ask SIMBAD). */
const SEARCH_DELAY_MS = 300

/** A row with its place in the library's order, so the table keeps that order. */
interface RowView {
  row: TargetRow_Serialize
  position: number
}

/** Drop the keys a patch clears, so the URL holds only what is set. */
function cleaned(search: SearchParams): SearchParams {
  return Object.fromEntries(Object.entries(search).filter(([, value]) => value !== undefined && value !== "")) as SearchParams
}

export function TargetsPage() {
  const m = useMessages()
  const navigate = useNavigate()
  const client = useQueryClient()
  const search = useSearch({ strict: false }) as SearchParams
  const state = readState(search)
  const favourite = parseFavourite(search.fav)
  const bands = parseBands(search.good)
  const projectId = search.project ?? null
  const query = (search.q ?? "").trim()
  const searching = query.length >= MIN_QUERY

  const criteria = useQuery(homeCriteriaQuery())
  const stored = criteria.data?.criteria ?? null
  const sites = useQuery(sitesQuery())
  const listed = state.view !== "planned" && !searching && stored !== null
  const page = useQuery(libraryQueryWhen("planningTargetRows", listed && stored ? [targetsQuery(state, stored)] : null))
  const presets = useQuery(presetsQuery(state.rigs))
  const equipment = useQuery(equipmentQuery())
  const results = useQuery(libraryQueryWhen("targetsSearch", searching ? [query] : null))
  // Tonight's date at the default site, for Today, only while another night is chosen.
  const tonight = useQuery(libraryQueryWhen("planningTonight", state.night ? [{ night: null }] : null))
  const [dialog, setDialog] = useState<"moon" | "rename" | null>(null)
  const settings = useQuery(libraryQueryWhen("workflowSettingsGet", dialog === "moon" ? [] : null))

  const setParams = (patch: SearchParams) => void navigate({ to: "/targets", search: cleaned({ ...search, ...patch }), replace: true })
  const openTarget = (targetId: string) => void navigate({ to: "/targets/$targetId", params: { targetId }, search: cleaned(search) })
  const result = useResultAction(openTarget, query)
  const savedPresets = presets.data?.saved ?? []
  const activeSaved = savedPresets.find((p) => p.id === search.saved) ?? null
  const writes = usePresetWrites(
    presetFilters(state),
    (preset) => setParams({ saved: preset.id }),
    (preset) => (search.saved === preset.id ? setParams({ saved: undefined }) : undefined),
  )

  const data: TargetsPage_Serialize | undefined = page.data
  const rows = data?.rows ?? []
  // astro-plan-wre19.20: over one page of rows these filters need the library; filtering the first page here would hide matches.
  const partial = data ? data.total > data.rows.length : false
  const filters = partial ? { favourite: "" as const, bands: [], projectId: null } : { favourite, bands, projectId }
  const shown: RowView[] = rows.map((row, position) => ({ row, position })).filter((v) => matchesRow(v.row, filters))
  const projectName = projectId ? (rows.flatMap((r) => r.projects).find((p) => p.projectId === projectId)?.name ?? null) : null

  /** Open a row in My targets; add any other row to My targets as a favourite. */
  const activate = (row: TargetRow_Serialize) => (inMyTargets(row) ? openTarget(row.target.id) : void result.act(asResult(row)))

  const columns = targetColumns(m, state, data, result.pending)
  const rowActions = (v: RowView): MenuItem[] => {
    const row = v.row
    const open: MenuItem[] = inMyTargets(row) ? [{ id: "open", label: m.verb_open(), run: () => openTarget(row.target.id) }, { separator: true }] : []
    const fav: Action = row.saved ? favouriteAction(m, client, row.target.id, row.favourite) : { id: "favourite-add", label: m.targets_favourite_add(), icon: Star, run: () => result.act(asResult(row)) }
    // astro-plan-wre19.14: a night's plan has no read and no per-night write yet.
    const plan: Action = { id: "plan", label: m.targets_add_to_plan(), icon: CalendarClock, run: () => undefined, unavailable: notYet(m, m.targets_add_to_plan()) }
    return [...open, fav, plan]
  }

  const facets: Facet[] = []
  if (state.view === "browse")
    facets.push({ id: "cat", label: m.targets_catalogues(), kind: "multi", value: state.catalogues, options: CATALOGUES.map((c) => ({ value: c, label: catalogueName(c) })) })
  if (data && data.bands.length > 0 && !partial) facets.push(suitableFacet(m, data.bands, rows, bands))
  if (state.view !== "planned" && !partial)
    facets.push({
      id: "fav",
      label: m.targets_favourite(),
      kind: "single",
      value: favourite,
      options: [
        { value: "yes", label: m.targets_favourite_yes(), count: rows.filter((r) => r.favourite).length },
        { value: "no", label: m.targets_favourite_no(), count: rows.filter((r) => !r.favourite).length },
      ],
    })
  // Clear empties every facet in one patch, so the URL changes once with all of them.
  const onFacets = (patch: FacetPatch) => setParams(facetSearch(patch))

  const toolbarActions: Action[] = []
  if (state.preset || activeSaved) toolbarActions.push({ id: "clear-preset", label: m.targets_clear_preset(), run: () => setParams({ preset: undefined, saved: undefined }) })
  if (partial) {
    const needsLibrary = (id: string, label: string): Action => ({ id, label, run: () => undefined, unavailable: { action: m.actions_blocked({ action: label }), reason: m.targets_filter_needs_library(), blockers: [] } })
    toolbarActions.push(needsLibrary("filter-favourite", m.targets_favourite()), needsLibrary("filter-suitable", m.domain_suitable_filters()))
    if (projectId) toolbarActions.push(needsLibrary("filter-project", m.targets_caption_project({ name: projectName ?? m.project_noun() })))
  }
  // Clear Project leaves a single chosen rig; only "this Project's rigs" goes with the Project.
  if (projectId) toolbarActions.push({ id: "clear-project", label: m.targets_clear_project(), run: () => setParams({ project: undefined, rig: state.rigs.kind === "project" ? undefined : search.rig }) })

  const views = {
    label: m.targets_view(),
    items: [
      { id: "my", label: m.project_search_my_targets() },
      { id: "browse", label: m.targets_browse_catalogues() },
      { id: "planned", label: m.targets_view_planned() },
    ],
    value: state.view,
    onChange: (id: string) => setParams({ ...viewSearch(id as TargetsView), cat: id === "browse" ? search.cat : undefined, saved: undefined }),
  }

  const basis = data?.basis ?? null
  const today = state.night ? (tonight.data?.night ?? null) : (basis?.night ?? null)
  const moon = data?.moon ? moonTonight(data.moon) : null
  const context = (
    <>
      {today ? <NightPicker value={state.night ?? today} today={today} weekJumps onChange={(night) => setParams({ night: night === today ? undefined : night })} /> : null}
      {sites.data ? (
        <SitePicker
          value={basis?.site.id ?? state.siteId ?? sites.data.defaultSiteId}
          sites={sites.data.sites}
          defaultSiteId={sites.data.defaultSiteId}
          onChange={(site) => setParams({ site: site === sites.data.defaultSiteId ? undefined : site })}
          onManage={() => void navigate({ to: "/settings/sites" })}
        />
      ) : null}
      {/* astro-plan-wre19.19: the page's darkness window (DarkLine) is not part of its read yet. */}
      {moon && basis ? <MoonLine moon={moon} timeZone={basis.timeZone} /> : null}
    </>
  )

  const notice = pageNotice(m, {
    result,
    presetFailure: writes.failure,
    dismissPreset: writes.dismiss,
    page: data,
    simbadSkipped: searching && results.data?.simbad.state === "not_searched",
    onAddSite: () => void navigate({ to: "/settings/sites" }),
  })

  const actions: Action[] = [{ id: "moon-limits", label: m.tonight_moon_limits(), icon: MoonStar, opensDialog: true, run: () => setDialog("moon") }]
  if (activeSaved) actions.push({ id: "rename-preset", label: m.targets_rename_preset(), opensDialog: true, run: () => setDialog("rename") })
  const searchBox = useSearchBox(search.q ?? "", (q) => setParams({ q: q || undefined }))
  const presetMenu = presets.data
    ? {
        items: presetItems(m, presets.data),
        active: activePreset(state.preset, activeSaved?.id ?? null),
        apply: (id: string) => {
          const picked = parsePresetId(id)
          if (picked?.kind === "builtin") setParams({ preset: picked.preset, saved: undefined, ...(state.view === "planned" ? viewSearch("my") : {}) })
          const saved = picked?.kind === "saved" ? savedPresets.find((p) => p.id === picked.id) : undefined
          if (saved) setParams(presetSearch(saved.filters, saved.id))
        },
        save: writes.save,
        remove: (id: string) => {
          const picked = parsePresetId(id)
          const saved = picked?.kind === "saved" ? savedPresets.find((p) => p.id === picked.id) : undefined
          if (saved) writes.remove(saved)
        },
      }
    : undefined

  const header = { title: m.nav_targets(), context, actions, views, notice }
  const workflow = settings.data
  const dialogs = (
    <>
      {workflow ? (
        <MoonLimitsDialog
          record={workflow}
          open={dialog === "moon"}
          onOpenChange={(open) => setDialog(open ? "moon" : null)}
          save={(moonAvoidance) => targetsWrite(client, () => library.workflowSettingsSave({ ...workflow.settings, moonAvoidance }, workflow.revision))}
        />
      ) : null}
      {activeSaved ? <RenamePresetDialog preset={activeSaved} open={dialog === "rename"} onOpenChange={(open) => setDialog(open ? "rename" : null)} /> : null}
    </>
  )

  if (searching) {
    const found = results.data?.results ?? []
    return (
      <>
        <ListPage
          {...header}
          summary={results.data ? m.targets_caption_search({ query }) : undefined}
          table={{
            label: m.targets_caption_search({ query }),
            rows: found,
            columns: resultColumns(m, result.pending),
            getRowId: (r) => `${r.source}:${r.target.id}`,
            onRowClick: (r) => void result.act(r),
            rowLabel: (r) => r.target.designation,
            rowActions: (r) => [{ id: r.inMyTargets ? "open" : "favourite-add", label: r.inMyTargets ? m.verb_open() : m.targets_favourite_add(), run: () => result.act(r) }],
            loading: results.isLoading,
            error: results.error ? { message: readFailure(m, results.error), onRetry: () => void results.refetch() } : undefined,
            toolbar: { search: searchBox, matchCount: found.length },
            empty: <EmptyState icon={Search} title={m.targets_no_match({ query })} action={null} />,
            columnsId: "targets-search",
          }}
        />
        {dialogs}
      </>
    )
  }

  const sort = state.sort ? { columnId: state.sort.column, direction: state.sort.descending ? ("desc" as const) : ("asc" as const) } : null
  // A built-in preset states its definition while it is on (PLAN-TGT-FR-09), worded from the catalogue by id.
  const summary = data ? [listSummary(m, data, shown.length, projectName), state.preset ? presetDefinition(m, state.preset) : null].filter(Boolean).join(" · ") : undefined
  return (
    <>
      <ListPage
        {...header}
        summary={summary}
        table={{
          label: m.nav_targets(),
          rows: state.view === "planned" ? [] : shown,
          columns,
          getRowId: (v) => v.row.target.id,
          onRowClick: (v) => activate(v.row),
          rowLabel: (v) => v.row.target.designation,
          rowActions,
          sort,
          onSortChange: (next) => {
            const column = sortColumn(next.columnId)
            if (column) setParams({ sort: sortParam({ column, descending: next.direction === "desc" }), saved: undefined })
          },
          loading: criteria.isPending || page.isLoading,
          error: criteria.error
            ? { message: readFailure(m, criteria.error), onRetry: () => void criteria.refetch() }
            : page.error
              ? { message: readFailure(m, page.error), onRetry: () => void page.refetch() }
              : undefined,
          toolbar: {
            search: searchBox,
            facets: { items: facets, onChange: onFacets },
            presets: state.view === "planned" ? undefined : presetMenu,
            select: {
              label: m.targets_rig(),
              value: state.rigs.kind === "rig" ? state.rigs.equipmentId : state.rigs.kind,
              options: [
                { value: "none", label: m.targets_rig_none() },
                ...(projectId ? [{ value: "project", label: m.targets_project_rigs_plain() }] : []),
                ...(equipment.data ?? []).map((rig) => ({ value: rig.id, label: rig.name })),
              ],
              onChange: (value) => setParams({ rig: value === "none" ? undefined : value }),
            },
            actions: toolbarActions,
            matchCount: shown.length,
          },
          empty: emptyState(m, { state, data, criteriaMissing: criteria.isSuccess && stored === null, filtered: rows.length > 0, setParams, goHome: () => void navigate({ to: "/" }) }),
          columnsId: "targets",
          stickyFirstColumn: true,
        }}
      />
      {dialogs}
    </>
  )
}

/** The search field's text: typing updates it at once, and the URL (and so the search) after a pause. */
function useSearchBox(fromUrl: string, commit: (q: string) => void) {
  const m = useMessages()
  const [text, setText] = useState(fromUrl)
  const typed = useRef(fromUrl)
  // A query that did not come from typing here (Clear, Back, the palette) replaces the field.
  useEffect(() => {
    if (fromUrl !== typed.current) {
      typed.current = fromUrl
      setText(fromUrl)
    }
  }, [fromUrl])
  const commitRef = useRef(commit)
  commitRef.current = commit
  useEffect(() => {
    if (text === typed.current) return
    const timer = window.setTimeout(() => {
      typed.current = text
      commitRef.current(text)
    }, SEARCH_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [text])
  return { label: m.targets_search_label(), placeholder: m.targets_search_placeholder(), value: text, onChange: setText }
}

/** A list row as the search-result action takes it: a saved Target from the library, else a bundled catalogue entry. */
function asResult(row: TargetRow_Serialize): TargetsSearchResult {
  return { target: row.target, source: row.saved ? "library" : "catalogue", inMyTargets: inMyTargets(row), matchedAlias: null }
}

function listSummary(m: Messages, data: TargetsPage_Serialize, shown: number, projectName: string | null): string {
  const count = data.total > data.rows.length ? m.targets_count_partial({ shown: formatCount(data.rows.length), total: formatCount(data.total) }) : m.plan_targets_count({ count: shown })
  return projectName ? `${m.targets_caption_project({ name: projectName })} · ${count}` : count
}

/** The page's one standing notice: a failed add (with Retry), a refused preset write, no planning site, or SIMBAD left out. */
function pageNotice(
  m: Messages,
  input: {
    result: ReturnType<typeof useResultAction>
    presetFailure: ReturnType<typeof usePresetWrites>["failure"]
    dismissPreset: () => void
    page: TargetsPage_Serialize | undefined
    simbadSkipped: boolean
    onAddSite: () => void
  },
): PageNotice | null {
  const { result } = input
  if (result.failed) {
    const failed = result.failed
    const retry: Action = { id: "retry-add", label: m.verb_retry(), run: () => result.act(failed.result) }
    return {
      tone: "warning",
      title: m.targets_add_failed({ name: failed.result.target.designation }),
      detail: failureMessage(m, failed.failure),
      actions: (
        <>
          <ActionButton action={retry} />
          <ActionButton action={{ id: "dismiss-add", label: m.verb_dismiss(), run: result.dismiss }} />
        </>
      ),
    }
  }
  if (input.presetFailure)
    return {
      tone: "warning",
      title: m.targets_preset_failed(),
      detail: failureMessage(m, input.presetFailure),
      actions: <ActionButton action={{ id: "dismiss-preset", label: m.verb_dismiss(), run: input.dismissPreset }} />,
    }
  if (input.page?.planningUnavailable === "no_site")
    return { tone: "info", title: m.home_no_site_yet(), actions: <ActionButton action={{ id: "add-site", label: m.tonight_add_site(), run: input.onAddSite }} /> }
  if (input.simbadSkipped) return { tone: "offline", title: m.targets_simbad_not_searched() }
  return null
}

function emptyState(
  m: Messages,
  input: { state: TargetsState; data: TargetsPage_Serialize | undefined; criteriaMissing: boolean; filtered: boolean; setParams: (patch: SearchParams) => void; goHome: () => void },
) {
  const { state, data, setParams } = input
  // astro-plan-wre19.14: the night's plan has no library read yet.
  if (state.view === "planned") return <EmptyState icon={CalendarClock} title={m.home_unavailable({ what: m.targets_view_planned() })} action={null} />
  // astro-plan-wre19.19: the library lists rows only under criteria; until it reads the stored ones itself, ask for them.
  if (input.criteriaMissing)
    return <EmptyState icon={SlidersHorizontal} title={m.targets_needs_criteria()} action={<ActionButton action={{ id: "set-criteria", label: m.shell_not_found_home(), run: input.goHome }} />} />
  if (data?.needsCatalogueOrPreset)
    return <EmptyState icon={Telescope} title={m.targets_choose_catalogue()} action={<ActionButton action={{ id: "browse-messier", label: m.targets_browse_messier(), run: () => setParams({ cat: "messier" }) }} />} />
  if (input.filtered) return <EmptyState icon={Crosshair} title={m.targets_none_suitable()} action={<ActionButton action={{ id: "clear-filters", label: m.targets_clear_filter(), run: () => setParams({ fav: undefined, good: undefined }) }} />} />
  return (
    <EmptyState
      icon={Crosshair}
      title={m.targets_empty()}
      action={<ActionButton action={{ id: "browse", label: m.targets_browse_catalogues(), run: () => setParams({ ...viewSearch("browse"), cat: "messier" }) }} />}
    />
  )
}

/** The row's designation, saying so while its open-or-add action runs. */
function designationCell(m: Messages, designation: string, busy: boolean): string {
  return busy ? `${designation} · ${m.common_loading()}` : designation
}

function targetColumns(m: Messages, state: TargetsState, data: TargetsPage_Serialize | undefined, pending: string | null): Column<RowView>[] {
  // The library ordered the rows for the requested sort; the table keeps that order.
  const order = (v: RowView) => (state.sort?.descending ? -v.position : v.position)
  const night = data?.basis?.night ?? null
  const unknown = (row: TargetRow_Serialize) => <Unknown reason={row.unknownReason} />
  const columns: Column<RowView>[] = [
    { id: "designation", header: m.targets_designation(), rowHeader: true, truncate: true, truncateMin: "name", sortValue: order, cell: (v) => designationCell(m, v.row.target.designation, pending === v.row.target.id) },
    // The library does not sort by Favourite (TargetsColumn), so the column is static.
    {
      id: "favourite",
      header: m.targets_favourite(),
      static: true,
      cell: (v) => (v.row.favourite ? <Star role="img" aria-label={m.targets_favourite()} className="size-3.5 fill-warning text-warning" /> : null),
    },
  ]
  if (state.view === "browse")
    columns.push({
      id: "mine",
      header: m.targets_in_my_targets(),
      static: true,
      cell: (v) => (inMyTargets(v.row) ? <Check role="img" aria-label={m.targets_in_my_targets()} className="size-3.5 text-success" /> : null),
    })
  columns.push(
    { id: "type", header: m.targets_type(), truncate: true, sortValue: order, cell: (v) => v.row.target.objectType },
    // astro-plan-wre19.19: the altitude sparkline needs the library's samples across the night; until then the cell is the peak.
    { id: "max_alt", header: m.tonight_altitude(), align: "right", sortValue: order, cell: (v) => (v.row.maxAltitudeDeg === null ? unknown(v.row) : formatDegrees(v.row.maxAltitudeDeg, 0)) },
    { id: "lunar", header: m.tonight_lunar(), align: "right", hideable: true, defaultHidden: true, sortValue: order, cell: (v) => (v.row.lunarSeparationDeg === null ? unknown(v.row) : formatDegrees(v.row.lunarSeparationDeg, 0)) },
    { id: "img_time", header: m.tonight_img_time(), align: "right", sortValue: order, cell: (v) => imgTimeText(m, v.row) ?? unknown(v.row) },
    { id: "filters", header: m.domain_suitable_filters(), sortValue: order, cell: (v) => filtersCell(m, v.row) },
  )
  for (const rig of data?.rigs ?? []) {
    columns.push({
      id: `fit:${rig.equipmentId}`,
      header: (data?.rigs.length ?? 0) > 1 ? m.targets_fit_rig({ rig: rig.name }) : m.targets_fit(),
      static: true,
      cell: (v) => {
        const fit = v.row.fit.find((f) => f.equipmentId === rig.equipmentId)?.fit
        if (!fit) return "–"
        const words = fitText(m, fit)
        return words.unknown ? <Unknown reason={null} /> : words.text
      },
    })
  }
  columns.push(
    { id: "projects", header: m.nav_projects(), truncate: true, hideable: true, static: true, cell: (v) => (v.row.projects.length > 0 ? formatList(v.row.projects.map((p) => p.name)) : "–") },
    { id: "opposition", header: m.tonight_opposition(), hideable: true, defaultHidden: true, sortValue: order, cell: (v) => (v.row.nextOpposition ? oppositionText(v.row.nextOpposition, night) : unknown(v.row)) },
    { id: "sessions", header: m.nav_sessions(), align: "right", hideable: true, sortValue: order, cell: (v) => (v.row.sessions > 0 ? formatCount(v.row.sessions) : "–") },
    { id: "captured", header: m.coverage_captured(), truncate: true, hideable: true, sortValue: order, cell: (v) => capturedText(m, v.row.captured) ?? "–" },
  )
  return columns
}

/** The bands the library marks viable tonight, then its recommendation; unknown with the row's reason. */
function filtersCell(m: Messages, row: TargetRow_Serialize) {
  if (row.bands.length === 0) return <Unknown reason={row.unknownReason} />
  const viable = viableBands(row.bands)
  const parts = [viable.length > 0 ? viable.join(", ") : m.targets_no_band_viable()]
  if (row.recommendation) parts.push(recommendationText(m, row.recommendation))
  return parts.join(" · ")
}

const SOURCE_WORDS: Record<TargetsSearchSource, (m: Messages) => string> = {
  my_targets: (m) => m.project_search_my_targets(),
  library: (m) => m.targets_source_library(),
  catalogue: (m) => m.target_source_catalogue(),
  simbad: (m) => m.targets_source_simbad(),
}

function resultColumns(m: Messages, pending: string | null): Column<TargetsSearchResult>[] {
  return [
    { id: "designation", header: m.targets_designation(), rowHeader: true, truncate: true, truncateMin: "name", sortValue: (r) => r.target.designation, cell: (r) => designationCell(m, r.target.designation, pending === r.target.id) },
    // astro-plan-wre19.20: a search result does not say whether it is a favourite yet.
    { id: "favourite", header: m.targets_favourite(), static: true, cell: () => <UnknownValue label={m.home_unavailable({ what: m.targets_favourite() })} /> },
    { id: "name", header: m.home_column_name(), truncate: true, sortValue: (r) => r.target.commonName ?? r.matchedAlias, cell: (r) => r.target.commonName ?? r.matchedAlias ?? "–" },
    { id: "type", header: m.targets_type(), truncate: true, sortValue: (r) => r.target.objectType, cell: (r) => r.target.objectType },
    { id: "source", header: m.targets_source(), sortValue: (r) => SOURCE_WORDS[r.source](m), cell: (r) => SOURCE_WORDS[r.source](m) },
    {
      id: "mine",
      header: m.targets_in_my_targets(),
      static: true,
      cell: (r) => (r.inMyTargets ? <Check role="img" aria-label={m.targets_in_my_targets()} className="size-3.5 text-success" /> : null),
    },
  ]
}
