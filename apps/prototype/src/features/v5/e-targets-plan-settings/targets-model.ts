/**
 * Targets model (slice E, S10): the rows of My targets, Browse catalogues and
 * search over the shared bundled catalogue and SIMBAD fixture (domain/sky);
 * the chosen night's values per row, with each filter graded "good
 * tonight"; Fit per rig; the built-in presets; "Add to targets", which
 * writes through the shared `addTarget`; and each night's plan in the
 * Planned view's order.
 *
 * Planning values come from one Moon rule (C6): each filter's grade and the
 * row's Img time come from the same windows under that filter's Moon-
 * avoidance curve on the chosen night (`imagingTonight`, good-tonight.ts), so
 * Img time is zero exactly when every filter grades poor. Subjects with a
 * deadline or season window carry their planning priority
 * (`planningPriorities`, C7), which rises as the window's last night nears.
 */
import { bandUnion, formatHours, liveLightSessions, myTargets, panelGroups, planningPriorities, rigRef, type SubjectPriority, sessionTargetId, targetFit, type Fit, fitsNicely, isMosaicCandidate } from "@/domain/derive"
import { BANDS, DEFAULT_MOON_AVOIDANCE, NARROW_BANDS } from "@/domain/labels"
import { targetCoverage } from "@/domain/library"
import type { MoonAvoidance, Stretch, Tonight } from "@/domain/planning"
import { BUNDLED_CATALOGUE, bundledEntryFor, type CatalogueEntry, type CatalogueId, entryKeys, matchesQuery, normalizeName, SIMBAD_FIXTURE } from "@/domain/sky"
import type { Band, Catalog, Disk, NightDate, ObservingSite, OpticalTrainId, PlanCriteria, Project, Target, TargetId } from "@/domain/types"
import { m, type MessageRef, msg, say } from "@/lib/i18n"
import { addTarget, setFavourite } from "@/store/actions/library"
import { addToPlan, removeFromPlan } from "@/store/actions/planning"
import { type CommitResult, updateSlice } from "@/store/core"
import { bandOk, chipsScore, type ImagingChip, imagingTonight } from "./good-tonight"
import { moonUpAt, type NightGrid, nextOpposition, objectTonight } from "./sky-tonight"

export type ObjectKind = "emission" | "galaxy" | "planetary" | "snr" | "cluster" | "reflection" | "dark" | "other"

export function objectKind(objectType: string | null): ObjectKind {
  const t = (objectType ?? "").toLowerCase()
  if (t.includes("planetary")) return "planetary"
  if (t.includes("galax")) return "galaxy"
  if (t.includes("supernova")) return "snr"
  if (t.includes("emission")) return "emission"
  if (t.includes("dark")) return "dark"
  if (t.includes("reflection")) return "reflection"
  if (t.includes("cluster")) return "cluster"
  return "other"
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

export interface TargetRow {
  /** Library Target id, or `cat:<name>` / `simbad:<name>` for an entry not in the library. */
  key: string
  target: Target | null
  entry: CatalogueEntry | null
  /** Found by the SIMBAD search, not in a bundled catalogue. */
  simbad: boolean
  designation: string
  aliases: string[]
  objectType: string | null
  kind: ObjectKind
  ra: number | null
  dec: number | null
  sizeDeg: { width: number; height: number } | null
  /** Open Projects that have it as a subject (D-W60 badge). */
  projects: Project[]
  /** In My targets: ★ favourite or an open-Project subject. */
  mine: boolean
  /** A mosaic panel's row: the Target whose mosaic it belongs to (D-W63); null for every other row. */
  panelOf: TargetId | null
}

function libraryRow(target: Target, projects: Project[], mine: boolean): TargetRow {
  const entry = bundledEntryFor(target.name, target.aliases)
  const objectType = entry?.objectType ?? target.resolver?.objectType ?? null
  return {
    key: target.id,
    target,
    entry,
    simbad: false,
    designation: target.name,
    aliases: target.aliases.filter((a) => normalizeName(a) !== normalizeName(target.name)),
    objectType,
    kind: objectKind(objectType),
    ra: target.ra,
    dec: target.dec,
    sizeDeg: target.sizeDeg ?? entry?.sizeDeg ?? null,
    projects,
    mine,
    panelOf: null,
  }
}

function entryRow(entry: CatalogueEntry, simbad: boolean): TargetRow {
  return {
    key: `${simbad ? "simbad" : "cat"}:${normalizeName(entry.designation)}`,
    target: null,
    entry,
    simbad,
    designation: entry.designation,
    aliases: entry.aliases,
    objectType: entry.objectType,
    kind: objectKind(entry.objectType),
    ra: entry.ra,
    dec: entry.dec,
    sizeDeg: entry.sizeDeg,
    projects: [],
    mine: false,
    panelOf: null,
  }
}

/** Every library Target as a row, plus each bundled entry the library does not hold yet. */
export function allRows(catalog: Catalog): TargetRow[] {
  const mine = new Map(myTargets(catalog).map((m) => [m.target.id, m.projects]))
  const rows = Object.values(catalog.targets).map((t) => libraryRow(t, mine.get(t.id) ?? [], mine.has(t.id)))
  const held = new Set(rows.flatMap((r) => [r.designation, ...r.aliases].map(normalizeName)))
  for (const entry of BUNDLED_CATALOGUE) if (!entryKeys(entry).some((k) => held.has(k))) rows.push(entryRow(entry, false))
  return rows
}

export function myTargetRows(rows: TargetRow[]): TargetRow[] {
  return rows.filter((r) => r.mine)
}

/** Browse catalogues: rows in any chosen catalogue (every catalogue when only a preset is chosen). */
export function browseRows(rows: TargetRow[], catalogues: CatalogueId[]): TargetRow[] {
  return rows.filter((r) => r.entry && (catalogues.length === 0 || r.entry.catalogues.some((c) => catalogues.includes(c))))
}

/** The rows of one Project's subjects (Open in Planner, PLAN-FR-10). */
export function projectRows(rows: TargetRow[], project: Project): TargetRow[] {
  const ids = new Set(project.subjects.map((s) => s.targetId))
  return rows.filter((r) => r.target && ids.has(r.target.id))
}

/**
 * The mosaic panels of a subject of an open Project, as rows under the
 * subject's row: each panel group that holds a session of this Target
 * (PRJ-FR-29), at the pointing of its first such session, named as the
 * group is. A panel group with no pointed session yet has no row.
 */
export function panelRows(catalog: Catalog, row: TargetRow): TargetRow[] {
  const targetId = row.target?.id
  if (!targetId) return []
  return row.projects.flatMap((project) =>
    panelGroups(project).flatMap((group) => {
      const pointing = project.inputs
        .filter((i) => i.groupId === group.id)
        .map((i) => catalog.sessions[i.sessionId])
        .find((s) => s && sessionTargetId(s) === targetId && s.pointing)?.pointing
      if (!pointing) return []
      return [{ ...row, key: `${row.key}:${group.id}`, target: null, entry: null, designation: group.name, aliases: [], ra: pointing.ra, dec: pointing.dec, sizeDeg: null, mine: false, panelOf: targetId }]
    }),
  )
}

/** Where a row was found, in the current language: My targets, the library, its bundled catalogues or SIMBAD. */
export function rowSource(row: TargetRow): string {
  if (row.mine) return m.project_search_my_targets()
  if (row.target) return m.targets_source_library()
  if (row.simbad) return "SIMBAD"
  return row.entry?.catalogues.join(", ") ?? ""
}

/** Search across My targets, the library, the bundled catalogues and (when searched) SIMBAD (PLAN-TGT-FR-03). */
export function searchRows(rows: TargetRow[], query: string, simbadSearched: boolean): TargetRow[] {
  const out = rows.filter((row) => matchesQuery([row.designation, ...row.aliases], query))
  if (simbadSearched) {
    const held = new Set(rows.flatMap((r) => [r.designation, ...r.aliases].map(normalizeName)))
    for (const entry of SIMBAD_FIXTURE) {
      if (entryKeys(entry).some((k) => held.has(k)) || !matchesQuery([entry.designation, ...entry.aliases], query)) continue
      out.push(entryRow(entry, true))
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Tonight per row
// ---------------------------------------------------------------------------

/** Why Img time is zero tonight (PLAN-TGT-FR-05): no darkness, too low in it, every filter's Moon curve refuses the dark window, or the window is too short. */
export type ZeroReason = "darkness" | "low" | "moon" | "short"

export type RowSky =
  | { status: "no-site" }
  | { status: "no-coordinates" }
  | {
      status: "ok"
      peakDeg: number | null
      /** When the peak in darkness falls; null without darkness. */
      peakAt: string | null
      lunarDeg: number
      /** Img time in seconds: every filter's windows under its Moon curve, merged. */
      imgTimeS: number
      /** Img time's windows on the chosen night, in order. */
      windows: Stretch[]
      /** The longest of them. */
      best: Stretch | null
      /** Why Img time is zero (PLAN-TGT-FR-05). */
      zeroReason: ZeroReason | null
      /** Moon above the horizon during the best window; null without a window. */
      moonUp: boolean | null
      altitudes: number[]
      /** One grade per filter, from the same windows; null without a dark window of the minimum duration. */
      chips: ImagingChip[] | null
    }

/** "Too low": the label beside "0h" (T10). */
function zeroReasonLabel(reason: ZeroReason): string {
  switch (reason) {
    case "darkness":
      return m.tonight_zero_darkness()
    case "low":
      return m.tonight_zero_low()
    case "moon":
      return m.tonight_zero_moon()
    case "short":
      return m.tonight_zero_short()
  }
}

/** Img time as one value: "2h10", or "0h · Too low" with the reason it is zero. */
export function imgTimeText(sky: Pick<Extract<RowSky, { status: "ok" }>, "imgTimeS" | "zeroReason">): string {
  if (sky.imgTimeS > 0) return formatHours(sky.imgTimeS)
  return sky.zeroReason ? `${m.tonight_zero_hours()} · ${zeroReasonLabel(sky.zeroReason)}` : m.tonight_zero_hours()
}

/** The night the Targets page plans for (`?night=`, else tonight) at the planning site. */
export interface SkyContext {
  site: ObservingSite
  grid: NightGrid
  /** The chosen night's Moon and darkness. */
  summary: Tonight
  criteria: PlanCriteria
  nowMs: number
  /** Tonight's date (`upcomingNight`): the earliest night to choose. */
  tonight: string
}

/**
 * The catalogue's sparkline specimen (app/catalogue/domain.tsx), on the shipped curves.
 * @deprecated Use `nightSky`, which drops the id. W4 removes this once the catalogue calls `nightSky`.
 */
export function positionSky(ctx: SkyContext | null, _id: string, ra: number | null, dec: number | null): RowSky {
  return nightSky(ctx, ra, dec)
}

/**
 * A position on the chosen night under the Moon rule (C6): altitude, the
 * filters' grades and Img time from the same windows. `curves` and `bands`
 * default to the shipped curves and all seven filters.
 */
export function nightSky(ctx: SkyContext | null, ra: number | null, dec: number | null, curves: Record<Band, MoonAvoidance> = DEFAULT_MOON_AVOIDANCE, bands: Band[] = BANDS): RowSky {
  if (!ctx) return { status: "no-site" }
  if (ra === null || dec === null) return { status: "no-coordinates" }
  const sky = objectTonight(ctx.grid, ra, dec)
  const imaging = imagingTonight(ctx, { ra, dec }, sky.altitudes, curves, bands)
  const best = imaging.windows.reduce<Stretch | null>((top, w) => (top === null || w.minutes > top.minutes ? w : top), null)
  let zeroReason: ZeroReason | null = null
  if (imaging.imgTimeS === 0) {
    if (!ctx.summary.darkness) zeroReason = "darkness"
    else if (sky.peakDarkDeg === null || sky.peakDarkDeg < ctx.criteria.minAltitudeDeg) zeroReason = "low"
    // A dark window of the minimum duration exists, and every filter's Moon curve refuses it.
    else if (imaging.chips) zeroReason = "moon"
    else zeroReason = "short"
  }
  const mid = best ? new Date((Date.parse(best.start) + Date.parse(best.end)) / 2).toISOString() : null
  return {
    status: "ok",
    peakDeg: sky.peakDarkDeg,
    peakAt: sky.peakDarkAt,
    lunarDeg: sky.moonSeparationDeg,
    imgTimeS: imaging.imgTimeS,
    windows: imaging.windows,
    best,
    zeroReason,
    moonUp: mid ? moonUpAt(ctx.grid, mid) : null,
    altitudes: sky.altitudes,
    chips: imaging.chips,
  }
}

export interface RigFit {
  rigId: OpticalTrainId
  rig: MessageRef
  fit: Fit
}

export interface RowView {
  row: TargetRow
  sky: RowSky
  /** One grade per filter the selection passes; null without a window on the chosen night. */
  tonight: ImagingChip[] | null
  fits: RigFit[]
  captured: Array<{ channel: string; seconds: number }>
  capturedS: number
  sessions: number
  opposition: string | null
  /** The subject's planning priority, when an open Project gives it a window (`planningPriorities`). */
  priority: SubjectPriority | null
  /** Its place in `planningPriorities`' order, 0 the most urgent; null without a window. */
  planningRank: number | null
}

/** A Target's most urgent window and its place in Planning's order. */
export interface RankedPriority {
  priority: SubjectPriority
  rank: number
}

/** What every row of one render shares: the selection, the Moon curves and the night's priorities. */
export interface RowInputs {
  rigIds: OpticalTrainId[]
  sessionCounts: Map<string, number>
  curves: Record<Band, MoonAvoidance>
  priorities: Map<TargetId, RankedPriority>
}

function asTarget(row: TargetRow): Target {
  return row.target ?? { id: row.key, name: row.designation, aliases: row.aliases, ra: row.ra, dec: row.dec, sizeDeg: row.sizeDeg, coordinateSource: "catalog", resolver: null, notes: "", favourite: false, createdAt: "", revision: 1 }
}

export function rowView(catalog: Catalog, disk: Disk, ctx: SkyContext | null, row: TargetRow, inputs: RowInputs): RowView {
  const sky = nightSky(ctx, row.ra, row.dec, inputs.curves, selectionBands(catalog, inputs.rigIds))
  const captured = row.target
    ? targetCoverage(disk, catalog, row.target.id)
        .channels.map((c) => ({ channel: c.channel, seconds: c.breakdown.captured.seconds }))
        .filter((c) => c.seconds > 0)
    : []
  const target = asTarget(row)
  return {
    row,
    sky,
    tonight: sky.status === "ok" ? sky.chips : null,
    fits: inputs.rigIds.map((rigId) => ({ rigId, rig: rigRef(catalog, rigId), fit: targetFit(catalog, { ...target, sizeDeg: row.sizeDeg }, rigId) })),
    captured,
    capturedS: captured.reduce((sum, c) => sum + c.seconds, 0),
    sessions: row.target ? (inputs.sessionCounts.get(row.target.id) ?? 0) : 0,
    opposition: row.ra === null || !ctx ? null : nextOpposition(row.ra, ctx.nowMs),
    ...ranked(row, inputs),
  }
}

function ranked(row: TargetRow, inputs: RowInputs): Pick<RowView, "priority" | "planningRank"> {
  const found = row.target && !row.panelOf ? inputs.priorities.get(row.target.id) : undefined
  return { priority: found?.priority ?? null, planningRank: found?.rank ?? null }
}

/**
 * Each Target's highest planning priority on a night (C7) and its rank: a
 * Target that is the subject of several open Projects takes its most urgent
 * window. `planningPriorities` already orders them, so the first one per
 * Target wins and the ranks follow its order.
 */
export function prioritiesByTarget(catalog: Catalog, night: NightDate): Map<TargetId, RankedPriority> {
  const out = new Map<TargetId, RankedPriority>()
  for (const p of planningPriorities(catalog, night)) if (!out.has(p.subject.targetId)) out.set(p.subject.targetId, { priority: p, rank: out.size })
  return out
}

/** A row's place in Planning's order (`planningPriorities`); rows without a window last. */
function priorityRank(v: RowView): number {
  return v.planningRank ?? Number.POSITIVE_INFINITY
}

/**
 * Planning's order (C7): Targets with a window first, by `planningPriorities`
 * (highest priority, then fewest nights left), then the rest by designation.
 */
export function priorityOrder(views: RowView[]): RowView[] {
  return [...views].sort((a, b) => {
    const ra = priorityRank(a)
    const rb = priorityRank(b)
    if (ra !== rb) return ra < rb ? -1 : 1
    return collator.compare(a.row.designation, b.row.designation)
  })
}

/** Live (not Trashed) light sessions per confirmed or associated Target (PLAN-TGT-FR-08). */
export function sessionCountsByTarget(catalog: Catalog): Map<string, number> {
  const counts = new Map<string, number>()
  for (const session of liveLightSessions(catalog)) {
    const id = sessionTargetId(session)
    if (id) counts.set(id, (counts.get(id) ?? 0) + 1)
  }
  return counts
}

// ---------------------------------------------------------------------------
// Presets (D-W19, D-W23, PLAN-TGT-FR-09 to PLAN-TGT-FR-13)
// ---------------------------------------------------------------------------

export type SortColumn = "designation" | "type" | "maxAlt" | "lunar" | "img" | "tonight" | "opposition" | "sessions" | "captured" | "fit" | "source" | "priority"
export interface SortSpec {
  column: SortColumn
  direction: "asc" | "desc"
}

export interface PresetDef {
  id: string
  /** The preset's name as a ref, for copy that is stored (an Activity detail). */
  readonly name: MessageRef
  /** `name` worded in the current language. */
  readonly label: string
  readonly definition: string
  /** "rig": offered only with a rig selected; "narrowband": hidden when a selected rig passes no Ha, SII or OIII. */
  needs: "rig" | "narrowband" | null
  match: (view: RowView) => boolean
  sort?: SortSpec
}

const imgTime = (v: RowView) => (v.sky.status === "ok" ? v.sky.imgTimeS : 0)
const ok = (v: RowView, band: Band) => bandOk(v.tonight, band)
/** Some filter the selection passes (the rig's, or all seven without one) is good or marginal. */
const anyOk = (v: RowView) => (v.tonight ?? []).some((c) => c.grade !== "poor")
const narrowOk = (v: RowView) => (v.tonight ?? []).some((c) => NARROW_BANDS.includes(c.band) && c.grade !== "poor")
const moonUp = (v: RowView) => (v.sky.status === "ok" ? v.sky.moonUp : null)

export const BUILT_IN_PRESETS: PresetDef[] = [
  {
    id: "best-tonight",
    name: msg("targets_preset_best"),
    get label() { return say(m, this.name) },
    get definition() { return m.targets_preset_best_definition() },
    needs: null,
    match: (v) => imgTime(v) > 0 && anyOk(v),
    sort: { column: "img", direction: "desc" },
  },
  {
    id: "narrowband-moon",
    name: msg("targets_preset_narrowband"),
    get label() { return say(m, this.name) },
    get definition() { return m.targets_preset_narrowband_definition() },
    needs: "narrowband",
    match: (v) => imgTime(v) > 0 && moonUp(v) === true && narrowOk(v),
    sort: { column: "img", direction: "desc" },
  },
  {
    id: "emission-ha",
    name: msg("targets_preset_emission"),
    get label() { return say(m, this.name) },
    get definition() { return m.targets_preset_emission_definition() },
    needs: "narrowband",
    match: (v) => v.row.kind === "emission" && ok(v, "Ha"),
  },
  {
    id: "galaxies-dark",
    name: msg("targets_preset_galaxies"),
    get label() { return say(m, this.name) },
    get definition() { return m.targets_preset_galaxies_definition() },
    needs: null,
    match: (v) => v.row.kind === "galaxy" && imgTime(v) > 0 && moonUp(v) === false,
    sort: { column: "img", direction: "desc" },
  },
  {
    id: "pn-oiii",
    name: msg("targets_preset_planetary"),
    get label() { return say(m, this.name) },
    get definition() { return m.targets_preset_planetary_definition() },
    needs: "narrowband",
    match: (v) => v.row.kind === "planetary" && ok(v, "OIII"),
  },
  {
    id: "mosaic",
    name: msg("targets_preset_mosaic"),
    get label() { return say(m, this.name) },
    get definition() { return m.targets_preset_mosaic_definition() },
    needs: "rig",
    match: (v) => v.fits.some((f) => isMosaicCandidate(f.fit)),
    sort: { column: "fit", direction: "desc" },
  },
  {
    id: "fits-nicely",
    name: msg("targets_preset_fits"),
    get label() { return say(m, this.name) },
    get definition() { return m.targets_preset_fits_definition() },
    needs: "rig",
    match: (v) => v.fits.some((f) => fitsNicely(f.fit)),
  },
]

export function presetById(id: string | undefined): PresetDef | undefined {
  return BUILT_IN_PRESETS.find((p) => p.id === id)
}

/** Bands the selection passes: the rigs' union, or all seven with no rig (PLAN-TGT-FR-06). */
export function selectionBands(catalog: Catalog, rigIds: OpticalTrainId[]): Band[] {
  return rigIds.length > 0 ? bandUnion(catalog, rigIds) : BANDS
}

/** Why a preset is not offered now, or null when it is. */
export function presetUnavailable(preset: PresetDef, rigIds: OpticalTrainId[], bands: Band[]): string | null {
  if (preset.needs === "rig" && rigIds.length === 0) return m.targets_preset_needs_rig()
  if (preset.needs === "narrowband" && rigIds.length > 0 && !bands.some((b) => NARROW_BANDS.includes(b))) return m.targets_preset_needs_narrowband()
  return null
}

/** The `good` URL value: a comma list of bands ("Ha,OIII"); unknown names drop out. */
export function parseBands(value: string | undefined): Band[] {
  const picked = new Set((value ?? "").split(","))
  return BANDS.filter((b) => picked.has(b))
}

/** The Suitable filters facet: rows where any picked band is good or marginal on the chosen night. */
export function goodFor(views: RowView[], bands: readonly Band[]): RowView[] {
  return bands.length > 0 ? views.filter((v) => bands.some((band) => bandOk(v.tonight, band))) : views
}

/** Sort of the Suitable filters facet: the picked bands' longest Moon-clear time, longest first (Q16). */
export const GOOD_TONIGHT_SORT: SortSpec = { column: "tonight", direction: "desc" }

// ---------------------------------------------------------------------------
// Sorting: every column but ★ sorts; unknown values sort last (PLAN-TGT-FR-04)
// ---------------------------------------------------------------------------

const collator = new Intl.Collator("en-GB", { numeric: true, sensitivity: "base" })

/** A Fit as a number: coverage of one frame, or ten plus the panels a mosaic needs; null when unknown. */
export function fitValue(fit: Fit | undefined): number | null {
  if (!fit || fit.kind === "unknown" || fit.coverage === null) return null
  return fit.kind === "panels" ? 10 + fit.panels : fit.coverage
}

/** A column's sort value; `bands` are the picked Suitable filters, by whose longest Moon-clear time the Filters column then sorts. */
export function sortValue(view: RowView, column: SortColumn, bands: readonly Band[] = []): string | number | null {
  const sky = view.sky.status === "ok" ? view.sky : null
  switch (column) {
    case "designation":
      return view.row.designation
    case "type":
      return view.row.objectType
    case "maxAlt":
      return sky?.peakDeg ?? null
    case "lunar":
      return sky?.lunarDeg ?? null
    case "img":
      return sky?.imgTimeS ?? null
    case "tonight":
      return chipsScore(view.tonight, bands)
    case "opposition":
      return view.opposition
    case "sessions":
      return view.sessions
    case "captured":
      return view.capturedS
    case "fit":
      return fitValue(view.fits[0]?.fit)
    case "source":
      return rowSource(view.row)
    case "priority":
      // The most urgent first when descending: Planning's order (`planningPriorities`).
      return view.planningRank === null ? null : -view.planningRank
  }
}

/** A saved view's sort ("img.desc"), the table's first order when the view is applied. */
export function parseSort(value: string | undefined): SortSpec | null {
  if (!value) return null
  const [column, direction] = value.split(".")
  const columns: SortColumn[] = ["designation", "type", "maxAlt", "lunar", "img", "tonight", "opposition", "sessions", "captured", "fit", "source", "priority"]
  if (!columns.includes(column as SortColumn) || (direction !== "asc" && direction !== "desc")) return null
  return { column: column as SortColumn, direction }
}

// ---------------------------------------------------------------------------
// Add to targets (PLAN-TGT-FR-03) and each night's plan (the Planned view)
// ---------------------------------------------------------------------------

const stale = (): CommitResult => ({ ok: false, reason: "stale", message: m.targets_result_gone() })

/** Write the row into the library as a ★ Target (or star an existing one). A failed write keeps nothing and returns the error for Retry. */
export function addToMyTargets(row: TargetRow): { result: CommitResult; targetId: string | null } {
  if (row.target) return { result: setFavourite(row.target.id, true), targetId: row.target.id }
  if (!row.entry) return { result: stale(), targetId: null }
  return addTarget(row.entry, { resolver: row.simbad ? "SIMBAD" : null, favourite: true })
}

/**
 * Put the row on one night's plan. A catalogue or SIMBAD entry is written
 * into the library first (not as a favourite), then planned.
 */
export function planRow(row: TargetRow, night: NightDate): CommitResult {
  let targetId = row.target?.id ?? null
  if (!targetId) {
    if (!row.entry) return stale()
    const written = addTarget(row.entry, { resolver: row.simbad ? "SIMBAD" : null, favourite: false })
    if (!written.result.ok) return written.result
    targetId = written.targetId
  }
  return targetId ? addToPlan(targetId, night) : stale()
}

/** Take a Target off one night's plan, and out of the order the user gave that night. */
export function unplan(targetId: TargetId, night: NightDate): CommitResult {
  const result = removeFromPlan(targetId, night)
  if (result.ok) updateSlice("e", (slice) => ({ ...slice, planOrder: { ...slice.planOrder, [night]: (slice.planOrder[night] ?? []).filter((id) => id !== targetId) } }))
  return result
}

/**
 * The Planned view's order: the order the user gave that night (slice E
 * `planOrder`), then the rest by planning priority (C7), then by their first
 * window on the night, then by name.
 */
export function plannedOrder(views: RowView[], order: TargetId[]): RowView[] {
  const place = new Map(order.map((id, index) => [id, index]))
  const first = (v: RowView) => (v.sky.status === "ok" && v.sky.windows[0] ? Date.parse(v.sky.windows[0].start) : Number.POSITIVE_INFINITY)
  const rank = (v: RowView) => place.get(v.row.key) ?? Number.POSITIVE_INFINITY
  return [...views].sort((a, b) => {
    if (rank(a) !== rank(b)) return rank(a) < rank(b) ? -1 : 1
    if (priorityRank(a) !== priorityRank(b)) return priorityRank(a) < priorityRank(b) ? -1 : 1
    if (first(a) !== first(b)) return first(a) < first(b) ? -1 : 1
    return collator.compare(a.row.designation, b.row.designation)
  })
}

/** Move a planned Target one place up (-1) or down (1) in the night's shown order, and keep that whole order. */
export function movePlanned(night: NightDate, shown: TargetId[], targetId: TargetId, delta: -1 | 1): void {
  const from = shown.indexOf(targetId)
  const to = from + delta
  if (from < 0 || to < 0 || to >= shown.length) return
  const next = [...shown]
  next.splice(from, 1)
  next.splice(to, 0, targetId)
  updateSlice("e", (slice) => ({ ...slice, planOrder: { ...slice.planOrder, [night]: next } }))
}
