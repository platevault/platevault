/**
 * Targets model (slice E, S10): the rows of My targets, Browse catalogues and
 * search over the shared bundled catalogue and SIMBAD fixture (domain/sky);
 * tonight's values per row, with each filter graded "good tonight"; Fit per
 * rig; the built-in presets; and "Add to targets", which writes through the
 * shared `addTarget`.
 *
 * Planning values come from the foundation's `computeWindows`, so a row's Img
 * time equals the total of its Plan windows tonight under the same site and
 * criteria (PLAN-TGT-FR-05). The filter grades come from `filterSuitability`
 * (good-tonight.ts).
 */
import { bandUnion, myTargets, sessionTargetId, liveLightSessions, rigName, targetFit, type Fit, fitsNicely, isMosaicCandidate } from "@/domain/derive"
import { BANDS, NARROW_BANDS } from "@/domain/labels"
import { targetCoverage } from "@/domain/library"
import { computeWindows, nightAt, type Tonight } from "@/domain/planning"
import { BUNDLED_CATALOGUE, bundledEntryFor, type CatalogueEntry, type CatalogueId, entryKeys, matchesQuery, normalizeName, SIMBAD_FIXTURE } from "@/domain/sky"
import type { Band, Catalog, Disk, MoonConstraint, ObservingSite, ObservingWindow, OpticalTrainId, PlanCriteria, Project, Target } from "@/domain/types"
import { addTarget, setFavourite } from "@/store/actions/library"
import { addToPlan } from "@/store/actions/planning"
import type { CommitResult } from "@/store/core"
import { bandOk, chipsScore, type FilterChip, filtersTonight } from "./good-tonight"
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

export interface SearchResult {
  rows: TargetRow[]
  /** Where each row was found: My targets, a library Target, a bundled catalogue or SIMBAD. */
  source: Map<string, string>
}

/** Search across My targets, the library, the bundled catalogues and (when searched) SIMBAD (PLAN-TGT-FR-03). */
export function searchRows(rows: TargetRow[], query: string, simbadSearched: boolean): SearchResult {
  const source = new Map<string, string>()
  const out: TargetRow[] = []
  for (const row of rows) {
    if (!matchesQuery([row.designation, ...row.aliases], query)) continue
    out.push(row)
    source.set(row.key, row.mine ? "My targets" : row.target ? "Library" : row.entry!.catalogues.join(", "))
  }
  if (simbadSearched) {
    const held = new Set(rows.flatMap((r) => [r.designation, ...r.aliases].map(normalizeName)))
    for (const entry of SIMBAD_FIXTURE) {
      if (entryKeys(entry).some((k) => held.has(k)) || !matchesQuery([entry.designation, ...entry.aliases], query)) continue
      const row = entryRow(entry, true)
      out.push(row)
      source.set(row.key, "SIMBAD")
    }
  }
  return { rows: out, source }
}

// ---------------------------------------------------------------------------
// Tonight per row
// ---------------------------------------------------------------------------

export type RowSky =
  | { status: "no-site" }
  | { status: "no-coordinates"; reason: string }
  | {
      status: "ok"
      peakDeg: number | null
      lunarDeg: number
      imgTimeS: number
      windows: ObservingWindow[]
      best: ObservingWindow | null
      /** Why Img time is zero: altitude, Moon or darkness (PLAN-TGT-FR-05). */
      zeroReason: string | null
      /** Moon above the horizon during the best window; null without a window. */
      moonUp: boolean | null
      altitudes: number[]
    }

export const NO_COORDINATES = "This target has no catalogued coordinates, so visibility can't be computed."

export interface SkyContext {
  site: ObservingSite
  grid: NightGrid
  tonight: Tonight
  criteria: PlanCriteria
  nowMs: number
}

/** Tonight's windows for a position, as `computeWindows` reports them for the night that holds `nowMs`. */
export function windowsTonight(ctx: SkyContext, id: string, ra: number, dec: number): ObservingWindow[] {
  const probe: Target = { id, name: id, aliases: [], ra, dec, sizeDeg: null, coordinateSource: "catalog", resolver: null, notes: "", favourite: false, createdAt: "", revision: 1 }
  return computeWindows(probe, ctx.site, ctx.criteria, ctx.nowMs, 1).filter((w) => nightAt(Date.parse(w.start), ctx.site) === ctx.grid.night)
}

export function positionSky(ctx: SkyContext | null, id: string, ra: number | null, dec: number | null): RowSky {
  if (!ctx) return { status: "no-site" }
  if (ra === null || dec === null) return { status: "no-coordinates", reason: NO_COORDINATES }
  const windows = windowsTonight(ctx, id, ra, dec)
  const sky = objectTonight(ctx.grid, ra, dec)
  const imgTimeS = windows.reduce((sum, w) => sum + (Date.parse(w.end) - Date.parse(w.start)) / 1000, 0)
  const best = [...windows].sort((a, b) => b.maxAltitudeDeg - a.maxAltitudeDeg)[0] ?? null
  let zeroReason: string | null = null
  if (imgTimeS === 0) {
    const min = ctx.criteria.minAltitudeDeg
    if (!ctx.tonight.darkness) zeroReason = `Darkness: the Sun stays above ${ctx.grid.sunLimit}° tonight`
    else if (sky.peakDarkDeg === null || sky.peakDarkDeg < min) zeroReason = `Altitude: stays below ${min}° in darkness`
    else if (ctx.criteria.maxMoonIlluminationPct !== null || ctx.criteria.minMoonSeparationDeg !== null) zeroReason = "Moon: too bright or too close while it is up"
    else zeroReason = `Altitude: above ${min}° for under ${ctx.criteria.minDurationMin} min of the darkness still ahead`
  }
  const mid = best ? new Date((Date.parse(best.start) + Date.parse(best.end)) / 2).toISOString() : null
  return {
    status: "ok",
    peakDeg: sky.peakDarkDeg,
    lunarDeg: sky.moonSeparationDeg,
    imgTimeS,
    windows,
    best,
    zeroReason,
    moonUp: mid ? moonUpAt(ctx.grid, mid) : null,
    altitudes: sky.altitudes,
  }
}

export interface RigFit {
  rigId: OpticalTrainId
  rigName: string
  fit: Fit
}

export interface RowView {
  row: TargetRow
  sky: RowSky
  /** One chip per band the selection passes, graded good tonight; null without a window tonight. */
  tonight: FilterChip[] | null
  fits: RigFit[]
  captured: Array<{ channel: string; seconds: number }>
  capturedS: number
  sessions: number
  opposition: string | null
}

function asTarget(row: TargetRow): Target {
  return row.target ?? { id: row.key, name: row.designation, aliases: row.aliases, ra: row.ra, dec: row.dec, sizeDeg: row.sizeDeg, coordinateSource: "catalog", resolver: null, notes: "", favourite: false, createdAt: "", revision: 1 }
}

export function rowView(catalog: Catalog, disk: Disk, ctx: SkyContext | null, row: TargetRow, rigIds: OpticalTrainId[], sessionCounts: Map<string, number>, constraints: Record<Band, MoonConstraint>): RowView {
  const sky = positionSky(ctx, row.key, row.ra, row.dec)
  const captured = row.target
    ? targetCoverage(disk, catalog, row.target.id)
        .channels.map((c) => ({ channel: c.channel, seconds: c.breakdown.captured.seconds }))
        .filter((c) => c.seconds > 0)
    : []
  const target = asTarget(row)
  return {
    row,
    sky,
    tonight: sky.status === "ok" && ctx ? filtersTonight(ctx, { id: row.key, ra: row.ra, dec: row.dec }, sky.altitudes, constraints, selectionBands(catalog, rigIds)) : null,
    fits: rigIds.map((rigId) => ({ rigId, rigName: rigName(catalog, rigId), fit: targetFit(catalog, { ...target, sizeDeg: row.sizeDeg }, rigId) })),
    captured,
    capturedS: captured.reduce((sum, c) => sum + c.seconds, 0),
    sessions: row.target ? (sessionCounts.get(row.target.id) ?? 0) : 0,
    opposition: row.ra === null || !ctx ? null : nextOpposition(row.ra, ctx.nowMs),
  }
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

export type SortColumn = "designation" | "type" | "maxAlt" | "lunar" | "img" | "tonight" | "opposition" | "sessions" | "captured" | "fit" | "source"
export interface SortSpec {
  column: SortColumn
  direction: "asc" | "desc"
}

export interface PresetDef {
  id: string
  label: string
  definition: string
  /** "rig": offered only with a rig selected; "narrowband": hidden when a selected rig passes no Ha, SII or OIII. */
  needs: "rig" | "narrowband" | null
  match: (view: RowView) => boolean
  sort?: SortSpec
}

const imgTime = (v: RowView) => (v.sky.status === "ok" ? v.sky.imgTimeS : 0)
const ok = (v: RowView, band: Band) => bandOk(v.tonight, band)
const broadOk = (v: RowView) => (v.tonight ?? []).some((c) => !NARROW_BANDS.includes(c.band) && c.grade !== "poor")
const narrowOk = (v: RowView) => (v.tonight ?? []).some((c) => NARROW_BANDS.includes(c.band) && c.grade !== "poor")
const moonUp = (v: RowView) => (v.sky.status === "ok" ? v.sky.moonUp : null)

export const BUILT_IN_PRESETS: PresetDef[] = [
  {
    id: "best-tonight",
    label: "Best tonight",
    definition: "Img time above zero, a broadband filter ok tonight; longest first.",
    needs: null,
    match: (v) => imgTime(v) > 0 && broadOk(v),
    sort: { column: "img", direction: "desc" },
  },
  {
    id: "narrowband-moon",
    label: "Narrowband (Moon up)",
    definition: "Img time above zero, Ha, SII or OIII ok tonight, Moon up.",
    needs: "narrowband",
    match: (v) => imgTime(v) > 0 && moonUp(v) === true && narrowOk(v),
    sort: { column: "img", direction: "desc" },
  },
  { id: "emission-ha", label: "Emission nebulae Ha", definition: "Emission nebulae, Ha ok tonight.", needs: "narrowband", match: (v) => v.row.kind === "emission" && ok(v, "Ha") },
  {
    id: "galaxies-dark",
    label: "Galaxies dark sky",
    definition: "Galaxies, Img time above zero, Moon down.",
    needs: null,
    match: (v) => v.row.kind === "galaxy" && imgTime(v) > 0 && moonUp(v) === false,
    sort: { column: "img", direction: "desc" },
  },
  { id: "pn-oiii", label: "Planetary nebulae OIII", definition: "Planetary nebulae, OIII ok tonight.", needs: "narrowband", match: (v) => v.row.kind === "planetary" && ok(v, "OIII") },
  {
    id: "mosaic",
    label: "Mosaic candidates",
    definition: "Targets that need 2 or more panels on a selected rig.",
    needs: "rig",
    match: (v) => v.fits.some((f) => isMosaicCandidate(f.fit)),
    sort: { column: "fit", direction: "desc" },
  },
  { id: "fits-nicely", label: "Fits nicely", definition: "Targets that cover 25% to 90% of a selected rig's field.", needs: "rig", match: (v) => v.fits.some((f) => fitsNicely(f.fit)) },
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
  if (preset.needs === "rig" && rigIds.length === 0) return "Choose a rig to use this preset"
  if (preset.needs === "narrowband" && rigIds.length > 0 && !bands.some((b) => NARROW_BANDS.includes(b))) return "The selected rig has no Ha, SII or OIII filter"
  return null
}

/** The `good` URL value: one band, else null. */
export function parseBand(value: string | undefined): Band | null {
  return BANDS.find((b) => b === value) ?? null
}

/** The toolbar filter "OIII ok": rows whose band is good or marginal tonight. */
export function goodFor(views: RowView[], band: Band | null): RowView[] {
  return band ? views.filter((v) => bandOk(v.tonight, band)) : views
}

/** Sort of the "Good tonight for <band>" preset: that band's Moon-clear time, longest first. */
export const GOOD_TONIGHT_SORT: SortSpec = { column: "tonight", direction: "desc" }

// ---------------------------------------------------------------------------
// Sorting: every column but ★ sorts; unknown values sort last (PLAN-TGT-FR-04)
// ---------------------------------------------------------------------------

const collator = new Intl.Collator("en-GB", { numeric: true, sensitivity: "base" })

function fitValue(fit: Fit | undefined): number | null {
  if (!fit || fit.kind === "unknown" || fit.coverage === null) return null
  return fit.kind === "panels" ? 10 + fit.panels : fit.coverage
}

export function sortValue(view: RowView, column: SortColumn, source?: Map<string, string>, band?: Band | null): string | number | null {
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
      return chipsScore(view.tonight, band ?? undefined)
    case "opposition":
      return view.opposition
    case "sessions":
      return view.sessions
    case "captured":
      return view.capturedS
    case "fit":
      return fitValue(view.fits[0]?.fit)
    case "source":
      return source?.get(view.row.key) ?? null
  }
}

/** `band` is the toolbar's good-tonight filter: the Filters column then sorts by that band. */
export function sortViews(views: RowView[], sort: SortSpec, source?: Map<string, string>, band?: Band | null): RowView[] {
  const factor = sort.direction === "asc" ? 1 : -1
  return [...views].sort((a, b) => {
    const va = sortValue(a, sort.column, source, band)
    const vb = sortValue(b, sort.column, source, band)
    if (va === null && vb === null) return collator.compare(a.row.designation, b.row.designation)
    if (va === null) return 1
    if (vb === null) return -1
    const order = typeof va === "number" && typeof vb === "number" ? va - vb : collator.compare(String(va), String(vb))
    return order === 0 ? collator.compare(a.row.designation, b.row.designation) : order * factor
  })
}

export function parseSort(value: string | undefined): SortSpec | null {
  if (!value) return null
  const [column, direction] = value.split(".")
  const columns: SortColumn[] = ["designation", "type", "maxAlt", "lunar", "img", "tonight", "opposition", "sessions", "captured", "fit", "source"]
  if (!columns.includes(column as SortColumn) || (direction !== "asc" && direction !== "desc")) return null
  return { column: column as SortColumn, direction }
}

export function formatSort(sort: SortSpec): string {
  return `${sort.column}.${sort.direction}`
}

// ---------------------------------------------------------------------------
// Add to targets (PLAN-TGT-FR-03) and to the Plan list
// ---------------------------------------------------------------------------

/** Write the row into the library as a ★ Target (or star an existing one). A failed write keeps nothing and returns the error for Retry. */
export function addToMyTargets(row: TargetRow): { result: CommitResult; targetId: string | null } {
  if (row.target) return { result: setFavourite(row.target.id, true), targetId: row.target.id }
  if (!row.entry) return { result: { ok: false, reason: "stale", message: "This result is no longer available. Search again." }, targetId: null }
  return addTarget(row.entry, { resolver: row.simbad ? "SIMBAD" : null, favourite: true })
}

/**
 * Put the row on the Plan list. A catalogue or SIMBAD entry is written into
 * the library first (not as a favourite), then planned.
 */
export function planRow(row: TargetRow): CommitResult {
  let targetId = row.target?.id ?? null
  if (!targetId) {
    if (!row.entry) return { ok: false, reason: "stale", message: "This result is no longer available. Search again." }
    const written = addTarget(row.entry, { resolver: row.simbad ? "SIMBAD" : null, favourite: false })
    if (!written.result.ok) return written.result
    targetId = written.targetId
  }
  return targetId ? addToPlan(targetId) : { ok: false, reason: "stale", message: "This result is no longer available. Search again." }
}
