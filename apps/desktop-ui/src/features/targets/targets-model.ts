/**
 * The Targets page's state and words, as pure functions over the library's
 * rows (PLAN-TGT-FR-01..18). Nothing here computes a planning value: the
 * library sorts, plans and grades; this module reads the URL into a
 * `TargetsQuery`, filters the rows it returned by values they carry
 * (Favourite, a viable band, a Project badge), and words them.
 *
 * The view lives in the URL, so opening a Target and coming back keeps it:
 * `view` (planned), `mode` (browse), `cat`, `preset`, `saved`, `fav`, `good`,
 * `rig`, `project`, `sort`, `night`, `site` and `q`.
 */
import type {
  Band,
  BandState,
  BuiltinPreset,
  Catalogue,
  ChannelIntegration,
  Fit,
  PlanCriteria,
  PlanningUnknownReason,
  PresetFilters,
  Recommendation,
  RigSelection,
  TargetRow_Serialize,
  TargetsColumn,
  TargetsQuery_Deserialize,
  TargetsShow,
  TargetsSort,
} from "@/api/ipc"
import { formatCount, formatHours, formatNight } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { TARGET_PAGE } from "./queries"

export type SearchParams = Record<string, string | undefined>

/** The page's three views: My targets (the default), Browse catalogues and the night's plan. */
export type TargetsView = "my" | "browse" | "planned"

export const CATALOGUES: readonly Catalogue[] = ["messier", "ngc", "ic", "caldwell", "sharpless", "lbn", "ldn", "barnard"]
export const BANDS: readonly Band[] = ["L", "R", "G", "B", "Ha", "SII", "OIII"]
export const BUILTIN_PRESETS: readonly BuiltinPreset[] = [
  "best_tonight_broadband",
  "narrowband_moon_up",
  "emission_nebulae_ha",
  "galaxies_dark_sky",
  "planetary_nebulae_oiii",
  "mosaic_candidates",
  "fits_nicely",
]
const COLUMNS: readonly TargetsColumn[] = ["designation", "type", "max_alt", "lunar", "img_time", "filters", "opposition", "sessions", "captured"]

/** The Favourite filter (PLAN-TGT-FR-17): All, Yes or No; `?fav=`. */
export type FavouriteFilter = "" | "yes" | "no"

export function parseView(search: SearchParams): TargetsView {
  if (search.view === "planned") return "planned"
  return search.mode === "browse" ? "browse" : "my"
}

export function viewSearch(view: TargetsView): SearchParams {
  return { view: view === "planned" ? "planned" : undefined, mode: view === "browse" ? "browse" : undefined }
}

function oneOf<T extends string>(values: readonly T[], value: string | undefined): T | null {
  return values.find((v) => v === value) ?? null
}

function listOf<T extends string>(values: readonly T[], value: string | undefined): T[] {
  const picked = new Set((value ?? "").split(","))
  return values.filter((v) => picked.has(v))
}

export const parseCatalogues = (value: string | undefined) => listOf(CATALOGUES, value)
export const parseBands = (value: string | undefined) => listOf(BANDS, value)
export const parsePreset = (value: string | undefined) => oneOf(BUILTIN_PRESETS, value)

/** One URL patch for every facet a FilterBar change names (Clear names them all at once). */
export function facetSearch(patch: Record<string, string | string[]>): SearchParams {
  const out: SearchParams = {}
  if (Array.isArray(patch.cat)) {
    out.cat = parseCatalogues(patch.cat.join(",")).join(",")
    out.saved = undefined
  }
  if (Array.isArray(patch.good)) out.good = parseBands(patch.good.join(",")).join(",")
  if (typeof patch.fav === "string") out.fav = parseFavourite(patch.fav)
  return out
}

export function parseFavourite(value: string | undefined): FavouriteFilter {
  return value === "yes" || value === "no" ? value : ""
}

/** `designation`, or `-img_time` for descending; null for an unknown column or none. */
export function parseSort(value: string | undefined): TargetsSort | null {
  if (!value) return null
  const descending = value.startsWith("-")
  const column = oneOf(COLUMNS, descending ? value.slice(1) : value)
  return column ? { column, descending } : null
}

export function sortParam(sort: TargetsSort | null): string | undefined {
  if (!sort) return undefined
  return sort.descending ? `-${sort.column}` : sort.column
}

/** The sortable columns: the table's column ids are the library's column names. */
export function sortColumn(id: string): TargetsColumn | null {
  return oneOf(COLUMNS, id)
}

/**
 * The rig selector (PLAN-TGT-FR-11): `?rig=project` with `?project=` is "this
 * Project's rigs", `?rig=<id>` one rig, else no rig.
 */
export function parseRigs(search: SearchParams): RigSelection {
  if (search.rig === "project" && search.project) return { kind: "project", projectId: search.project }
  if (search.rig && search.rig !== "project") return { kind: "rig", equipmentId: search.rig }
  return { kind: "none" }
}

/** Everything a Targets list read depends on. */
export interface TargetsState {
  view: TargetsView
  catalogues: Catalogue[]
  preset: BuiltinPreset | null
  rigs: RigSelection
  sort: TargetsSort | null
  night: string | null
  siteId: string | null
}

export function readState(search: SearchParams): TargetsState {
  return {
    view: parseView(search),
    catalogues: parseCatalogues(search.cat),
    preset: parsePreset(search.preset),
    rigs: parseRigs(search),
    sort: parseSort(search.sort),
    night: search.night ?? null,
    siteId: search.site ?? null,
  }
}

/** The library request for the state under `criteria`; My targets and the Planned view both read My targets. */
export function targetsQuery(state: TargetsState, criteria: PlanCriteria): TargetsQuery_Deserialize {
  const show: TargetsShow = state.view === "browse" ? "browse" : "my_targets"
  return {
    show,
    catalogues: show === "browse" ? state.catalogues : [],
    preset: state.preset,
    siteId: state.siteId,
    night: state.night,
    criteria,
    sort: state.sort,
    offset: 0,
    limit: TARGET_PAGE,
    rigs: state.rigs,
  }
}

/** What Save current… stores (PLAN-TGT-FR-10); the Favourite filter waits for astro-plan-wre19.20. */
export function presetFilters(state: TargetsState): PresetFilters {
  const filters: PresetFilters = { show: state.view === "browse" ? "browse" : "my_targets", catalogues: state.catalogues, preset: state.preset }
  return state.sort ? { ...filters, sort: state.sort } : filters
}

/** The URL a saved preset restores: its Show mode, catalogues, preset and sort, every other filter cleared. */
export function presetSearch(filters: PresetFilters, savedId: string): SearchParams {
  return {
    ...viewSearch(filters.show === "browse" ? "browse" : "my"),
    cat: filters.catalogues && filters.catalogues.length > 0 ? filters.catalogues.join(",") : undefined,
    preset: filters.preset ?? undefined,
    sort: sortParam(filters.sort ?? null),
    saved: savedId,
    fav: undefined,
    good: undefined,
  }
}

/**
 * The row filters the library's request has no field for, over values each
 * row carries: the Favourite filter, Suitable filters (a chosen band the
 * library marks viable tonight, PLAN-TGT-FR-15) and a Project's subjects
 * (PLAN-FR-10, a row's open-Project badges).
 */
export interface RowFilters {
  favourite: FavouriteFilter
  bands: readonly Band[]
  projectId: string | null
}

export function matchesRow(row: TargetRow_Serialize, filters: RowFilters): boolean {
  if (filters.favourite === "yes" && !row.favourite) return false
  if (filters.favourite === "no" && row.favourite) return false
  if (filters.projectId && !row.projects.some((p) => p.projectId === filters.projectId)) return false
  if (filters.bands.length > 0 && !row.bands.some((b) => b.viable && filters.bands.includes(b.band))) return false
  return true
}

/**
 * In My targets (PLAN-TGT-FR-01): a favourite, an open-Project subject or a
 * Target with a session. The row has no such field yet (astro-plan-wre19.20),
 * so Browse's check reads the three values that define it.
 */
export function inMyTargets(row: TargetRow_Serialize): boolean {
  return row.favourite || row.projects.length > 0 || row.sessions > 0
}

// Words -----------------------------------------------------------------------

export function unknownReasonText(m: Messages, reason: PlanningUnknownReason): string {
  switch (reason) {
    case "no_site":
      return m.targets_reason_no_site()
    case "target_coordinates_unknown":
      return m.tonight_no_coordinates()
    case "unsupported_coordinate_frame":
      return m.targets_reason_unsupported_frame()
  }
}

/** "2h10", "0h · Too low" (the reason is part of the value, T10), or null when unknown. */
export function imgTimeText(m: Messages, row: TargetRow_Serialize): string | null {
  if (row.imgTimeMinutes === null) return null
  if (row.imgTimeMinutes > 0) return formatHours(row.imgTimeMinutes * 60)
  const reason = row.imgTimeZeroReason
  if (!reason) return m.tonight_zero_hours()
  const why = reason === "altitude" ? m.tonight_zero_low() : reason === "moon" ? m.tonight_zero_moon() : m.tonight_zero_darkness()
  return m.targets_img_time_zero({ hours: m.tonight_zero_hours(), reason: why })
}

export function fitText(m: Messages, fit: Fit): { text: string; unknown: boolean } {
  switch (fit.state) {
    case "fits":
      return { text: m.fit_fits({ percent: fit.coverage === null ? "–" : Math.round(fit.coverage * 100) }), unknown: false }
    case "panels":
      return { text: m.targets_fit_panels({ count: fit.panels }), unknown: false }
    case "tiny":
      return { text: m.fit_tiny(), unknown: false }
    case "unknown":
      return { text: fit.reason === "size_unknown" ? m.target_size_unknown() : m.domain_fov_unknown(), unknown: true }
  }
}

/** "L 2h · Ha 1h30": the integration per channel; frames without a FILTER read "No filter". */
export function capturedText(m: Messages, captured: readonly ChannelIntegration[]): string | null {
  if (captured.length === 0) return null
  return captured
    .map((c) => `${c.channel ?? m.palette_session_no_filter()} ${c.seconds === null ? m.target_goal_frames({ count: formatCount(c.frames) }) : formatHours(c.seconds)}`)
    .join(" · ")
}

export function recommendationText(m: Messages, recommendation: Recommendation): string {
  switch (recommendation) {
    case "broadband_ok":
      return m.targets_recommend_broadband()
    case "narrowband_only":
      return m.targets_recommend_narrowband()
    case "avoid_tonight":
      return m.targets_recommend_avoid()
  }
}

/** The bands the library marks viable tonight, in strip order. */
export function viableBands(bands: readonly BandState[]): Band[] {
  return bands.filter((b) => b.viable).map((b) => b.band)
}

/** "2 Nov", or "2 Aug 2027" when it falls in another year than the page's night. */
export function oppositionText(opposition: string, night: string | null): string {
  return formatNight(opposition, night !== null && opposition.slice(0, 4) !== night.slice(0, 4))
}

const PRESET_WORDS: Record<BuiltinPreset, { name: (m: Messages) => string; definition: (m: Messages) => string }> = {
  best_tonight_broadband: { name: (m) => m.targets_preset_best(), definition: (m) => m.targets_preset_best_definition() },
  narrowband_moon_up: { name: (m) => m.targets_preset_narrowband(), definition: (m) => m.targets_preset_narrowband_definition() },
  emission_nebulae_ha: { name: (m) => m.targets_preset_emission(), definition: (m) => m.targets_preset_emission_definition() },
  galaxies_dark_sky: { name: (m) => m.targets_preset_galaxies(), definition: (m) => m.targets_preset_galaxies_definition() },
  planetary_nebulae_oiii: { name: (m) => m.targets_preset_planetary(), definition: (m) => m.targets_preset_planetary_definition() },
  mosaic_candidates: { name: (m) => m.targets_preset_mosaic(), definition: (m) => m.targets_preset_mosaic_definition() },
  fits_nicely: { name: (m) => m.targets_preset_fits(), definition: (m) => m.targets_preset_fits_definition() },
}

/** A built-in preset's name from the catalogue by id; the library's English fields are never shown. */
export function presetName(m: Messages, preset: BuiltinPreset): string {
  return PRESET_WORDS[preset].name(m)
}

export function presetDefinition(m: Messages, preset: BuiltinPreset): string {
  return PRESET_WORDS[preset].definition(m)
}

/** The bundled catalogues by their own names, proper nouns in every language. */
const CATALOGUE_NAMES: Record<Catalogue, string> = {
  messier: "Messier",
  ngc: "NGC",
  ic: "IC",
  caldwell: "Caldwell",
  sharpless: "Sharpless",
  lbn: "LBN",
  ldn: "LDN",
  barnard: "Barnard",
}

export function catalogueName(catalogue: Catalogue): string {
  return CATALOGUE_NAMES[catalogue]
}
