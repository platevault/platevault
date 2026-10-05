/**
 * PixInsight SubframeSelector CSV fixture and its mapping (PIX-FR-07, D03).
 * The prototype has no real file contents, so the rows of the one fixture
 * export (`seed.ts` creates the file) are defined here deterministically from
 * the simulated pixel facts of the frames it names. Rejection decisions
 * (`Approved`) are never imported; a column without units or a PlateVault
 * equivalent stays unavailable instead of being relabelled.
 */
import { copyAvailability, preferredCopy } from "@/domain/derive"
import { fileKey } from "@/domain/disk"
import type { AssetId, Catalog, Disk, Metric, MetricKey } from "@/domain/types"

export const SUBFRAME_SELECTOR_PATH = "/Volumes/Astro-T7/Work/Measurements/NGC7000_30Sep_SubframeSelector.csv"
export const IMPORT_METHOD = { method: "PixInsight SubframeSelector", version: "1.8.9-2, as recorded in the export" } as const
/** Subframe scale recorded in the export header (arcsec/px). */
const EXPORT_SCALE = 3.1

export interface CsvColumn {
  name: string
  unit: string | null
  maps: MetricKey | null
  status: "identity" | "mapped" | "not-imported" | "unavailable"
  note: string
}

export const CSV_COLUMNS: CsvColumn[] = [
  { name: "File", unit: null, maps: null, status: "identity", note: "Frame identity: matched to an indexed copy by path, then by file name" },
  { name: "Approved", unit: null, maps: null, status: "not-imported", note: "Rejection decisions stay yours" },
  { name: "FWHM", unit: "arcsec", maps: "fwhm", status: "mapped", note: "Shown next to built-in FWHM" },
  { name: "Eccentricity", unit: "ratio", maps: "eccentricity", status: "mapped", note: "Shown next to built-in eccentricity" },
  { name: "Stars", unit: "stars", maps: "star-count", status: "mapped", note: "Shown next to built-in star count" },
  {
    name: "PSFSignalWeight",
    unit: null,
    maps: null,
    status: "unavailable",
    note: "No units and no PlateVault equivalent; never shown as FWHM or HFR.",
  },
]

export interface CsvRow {
  /** 1-based data row in the export. */
  index: number
  file: string
  approved: boolean
  values: Partial<Record<MetricKey, number>>
  psfSignalWeight: number
}

const SESSION_FOLDERS = ["2026-09-18/Ha", "2026-09-24/OIII", "2026-09-26/OIII", "2026-09-28/Ha", "2026-09-30/OIII"].map(
  (folder) => `/Volumes/Astro-T7/Captures/NGC7000/${folder}/`,
)

/** Rows recorded on another computer: one name exists in two session folders, one in none. */
const FOREIGN_ROWS = ["D:/Astro/NGC7000/Light_300s_OIII_0007.fits", "D:/Astro/NGC7000/Light_NGC7000_300s_SII_0001.fits"]

/**
 * The export's rows, or null when `path` is not a SubframeSelector export the
 * prototype knows. Rows cover the five worked-example sessions as they were on
 * disk, plus the two foreign rows.
 */
export function readSubframeSelectorCsv(disk: Disk, path: string): CsvRow[] | null {
  if (path !== SUBFRAME_SELECTOR_PATH) return null
  const files = Object.values(disk.files)
    .filter((f) => f.pixelTruth && SESSION_FOLDERS.some((folder) => f.path.startsWith(folder)))
    .sort((a, b) => a.path.localeCompare(b.path))
  const rows: CsvRow[] = files.map((file, i) => {
    const truth = file.pixelTruth!
    return {
      index: i + 1,
      file: file.path,
      approved: !truth.trailed,
      values: {
        fwhm: Number((truth.fwhmPx * EXPORT_SCALE * 1.04).toFixed(3)),
        eccentricity: Number((truth.eccentricity + 0.012).toFixed(3)),
        "star-count": Math.round(truth.starCount * 0.92),
      },
      psfSignalWeight: Number((truth.starCount / (truth.fwhmPx * 900)).toFixed(4)),
    }
  })
  FOREIGN_ROWS.forEach((file, i) => {
    rows.push({ index: rows.length + 1, file, approved: true, values: { fwhm: 8.12 + i, eccentricity: 0.41, "star-count": 1650 }, psfSignalWeight: 0.61 })
  })
  return rows
}

/**
 * "content-changed": the frame's current bytes differ from its latest recorded basis (a cached measurement, else the
 * digest recorded when it was indexed). "unreadable": its bytes cannot be read now. Both are listed for review and
 * attach nothing (PIX-FR-06, PIX-AC-11, D19).
 */
export type RowMatch = "matched" | "matched-by-name" | "content-changed" | "unreadable" | "ambiguous" | "unmatched"

export interface MappedRow {
  row: CsvRow
  status: RowMatch
  /** The frame the row names; set for matched, content-changed and unreadable rows. */
  assetId: AssetId | null
  candidates: AssetId[]
  /** SHA-256 of the frame's bytes read at mapping review: the import observation. Null when unread. */
  observedSha256: string | null
  /** The digest the observation was compared with, and where PlateVault recorded it. */
  basis: { sha256: string; recordedBy: "measurement" | "index" } | null
}

const baseName = (path: string) => path.slice(Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\")) + 1)

export type FrameObservation = Pick<MappedRow, "observedSha256" | "basis"> & { state: "same" | "content-changed" | "unreadable" }

/**
 * The import observation (PIX-FR-06, D19): read the frame's current bytes, from `path` when the row names one of its
 * copies, and compare them with its latest recorded basis (its cached measurement, else the digest from indexing).
 */
export function observeFrame(disk: Disk, catalog: Catalog, assetId: AssetId, path: string | null): FrameObservation {
  const asset = catalog.assets[assetId]
  if (!asset) return { state: "unreadable", observedSha256: null, basis: null }
  const record = catalog.measurements[assetId]
  const basis = record?.inputSha256 ? { sha256: record.inputSha256, recordedBy: "measurement" as const } : { sha256: asset.sha256, recordedBy: "index" as const }
  const copy = (path ? asset.copies.find((c) => c.path === path) : undefined) ?? preferredCopy(disk, catalog, asset)
  const file = copyAvailability(disk, catalog, copy) === "available" ? disk.files[fileKey(copy.volumeId, copy.path)] : undefined
  if (!file) return { state: "unreadable", observedSha256: null, basis }
  return { state: file.sha256 === basis.sha256 ? "same" : "content-changed", observedSha256: file.sha256, basis }
}

/**
 * Exact copy path first; otherwise a unique file name; two or more names are ambiguous and attach to nothing.
 * A matched frame whose current bytes differ from its recorded basis, or cannot be read, is listed for review instead.
 */
export function mapRows(disk: Disk, catalog: Catalog, rows: CsvRow[]): MappedRow[] {
  const byPath = new Map<string, AssetId>()
  const byName = new Map<string, AssetId[]>()
  for (const asset of Object.values(catalog.assets)) {
    for (const copy of asset.copies) byPath.set(copy.path, asset.id)
    byName.set(asset.fileName, [...(byName.get(asset.fileName) ?? []), asset.id])
  }
  const matchedRow = (row: CsvRow, status: "matched" | "matched-by-name", assetId: AssetId, path: string | null): MappedRow => {
    const { state, observedSha256, basis } = observeFrame(disk, catalog, assetId, path)
    return { row, status: state === "same" ? status : state, assetId, candidates: [assetId], observedSha256, basis }
  }
  return rows.map((row) => {
    const exact = byPath.get(row.file)
    if (exact) return matchedRow(row, "matched", exact, row.file)
    const named = byName.get(baseName(row.file)) ?? []
    if (named.length === 1) return matchedRow(row, "matched-by-name", named[0]!, null)
    if (named.length > 1) return { row, status: "ambiguous", assetId: null, candidates: named, observedSha256: null, basis: null }
    return { row, status: "unmatched", assetId: null, candidates: [], observedSha256: null, basis: null }
  })
}

/** Rows whose values attach on confirmation. */
export const attaches = (m: MappedRow) => m.status === "matched" || m.status === "matched-by-name"

/** Imported metrics keep their source, method, units and input identity as recorded. */
export function importedMetrics(row: CsvRow, csvPath: string): Metric[] {
  return CSV_COLUMNS.filter((c): c is CsvColumn & { maps: MetricKey } => c.status === "mapped" && c.maps !== null).flatMap((column) => {
    const value = row.values[column.maps]
    if (value === undefined) return []
    return [
      {
        key: column.maps,
        value,
        unit: column.unit ?? "",
        ...IMPORT_METHOD,
        source: "imported",
        basis: `${baseName(csvPath)} row ${row.index}: ${row.file}`,
        state: "valid",
        warning: null,
      } satisfies Metric,
    ]
  })
}
