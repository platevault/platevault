/**
 * Seeds: `empty` (first run; onboarding starts) and `demo` (a realistic
 * indexed library for browsing). Both share the same simulated disk so the
 * empty seed can be indexed into the same library through onboarding (J19).
 * Journeys J18-J30 run in order from the empty seed; the demo is not a
 * journey checkpoint.
 *
 * All names, paths and counts are illustrative fixtures, matching the worked
 * example in the product flow (NGC 7000 HOO, 208 lights, 17h 20m).
 */
import { fakeSha256, fileAt, fileKey, makeFile, writeFiles } from "./disk"
import { indexLocationsSync, stableHash } from "./indexing"
import { simulateMeasurement } from "./measurement"
import { pixelScaleArcsec } from "./sky"
import type {
  ActivityEvent,
  AppSettings,
  ApplicationProfile,
  Catalog,
  Disk,
  DiskFile,
  FilterDef,
  FrameHeader,
  ImageType,
  Location,
  Operation,
  PixelTruth,
  SeedName,
  Session,
  SimulationFaults,
  Volume,
  VolumeId,
} from "./types"

export const DEMO_NOW = "2026-10-04T08:00:00.000Z"

export const VOLUME_IDS = {
  astro: "vol_astro_t7",
  cold: "vol_cold_1",
  scratch: "vol_scratch",
  archive: "vol_archive",
  impostor: "vol_archive_impostor",
  spare: "vol_spare",
} as const

const TB = 1_000_000_000_000

function buildVolumes(coldMounted: boolean): Record<VolumeId, Volume> {
  const allLinks = { symlink: true, hardlink: true, clone: true }
  const list: Volume[] = [
    { id: VOLUME_IDS.astro, name: "Astro-T7", mountPath: "/Volumes/Astro-T7", volumeUuid: "5E1F-T7-0001", mounted: true, writable: true, trash: "supported", capacityBytes: 2 * TB, links: allLinks },
    { id: VOLUME_IDS.cold, name: "Cold-1", mountPath: "/Volumes/Cold-1", volumeUuid: "C01D-0001", mounted: coldMounted, writable: true, trash: "supported", capacityBytes: 4 * TB, links: allLinks },
    { id: VOLUME_IDS.scratch, name: "Scratch", mountPath: "/Volumes/Scratch", volumeUuid: "5C7A-0001", mounted: true, writable: true, trash: "unsupported", capacityBytes: 0.5 * TB, links: { symlink: false, hardlink: false, clone: false } },
    { id: VOLUME_IDS.archive, name: "Archive", mountPath: "/Volumes/Archive", volumeUuid: "A7C4-0001", mounted: true, writable: true, trash: "supported", capacityBytes: 8 * TB, links: { symlink: true, hardlink: true, clone: false } },
    { id: VOLUME_IDS.impostor, name: "Archive", mountPath: "/Volumes/Archive", volumeUuid: "A7C4-9999", mounted: false, writable: true, trash: "supported", capacityBytes: 1 * TB, links: { symlink: true, hardlink: true, clone: false } },
    // J25 P4: a disposable writable volume with an empty Captures folder.
    { id: VOLUME_IDS.spare, name: "Spare", mountPath: "/Volumes/Spare", volumeUuid: "5BA2-0001", mounted: true, writable: true, trash: "supported", capacityBytes: 1 * TB, links: allLinks },
  ]
  return Object.fromEntries(list.map((v) => [v.id, v]))
}

const MOUNT: Record<VolumeId, string> = {
  [VOLUME_IDS.astro]: "/Volumes/Astro-T7",
  [VOLUME_IDS.cold]: "/Volumes/Cold-1",
  [VOLUME_IDS.scratch]: "/Volumes/Scratch",
  [VOLUME_IDS.archive]: "/Volumes/Archive",
  [VOLUME_IDS.spare]: "/Volumes/Spare",
}

const SITE_COORDS = {
  backyard: { lat: 52.09, lon: 5.12 },
  lapalma: { lat: 28.76, lon: -17.88 },
}

interface Rig {
  instrument: string
  telescope: string | null
  focalLengthMm: number | null
  widthPx: number
  heightPx: number
  pixelSizeUm: number
  gain: number
  offset: number
  ccdTempC: number
  bayerPattern: string | null
}

const REDCAT: Rig = { instrument: "ZWO ASI2600MM Pro", telescope: "RedCat 51", focalLengthMm: 250, widthPx: 6248, heightPx: 4176, pixelSizeUm: 3.76, gain: 100, offset: 50, ccdTempC: -10, bayerPattern: null }
const SAMYANG: Rig = { instrument: "ZWO ASI533MC Pro", telescope: "Samyang 135", focalLengthMm: 135, widthPx: 3008, heightPx: 3008, pixelSizeUm: 3.76, gain: 101, offset: 50, ccdTempC: -5, bayerPattern: "RGGB" }

function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface CaptureSpec {
  volumeId: VolumeId
  dir: string
  prefix: string
  count: number
  start: string
  imageType: ImageType
  exposureS: number
  filter: string | null
  object: string | null
  rig: Rig
  pointing: { ra: number; dec: number; rotationDeg: number | null } | null
  site: { lat: number; lon: number } | null
  ext?: "fits" | "xisf"
  overrides?: Partial<FrameHeader>
  truth?: (index: number) => Partial<PixelTruth>
}

function captureSet(spec: CaptureSpec): DiskFile[] {
  const random = mulberry32(Number.parseInt(stableHash(spec.dir), 36))
  const ext = spec.ext ?? "fits"
  const files: DiskFile[] = []
  const startMs = new Date(spec.start).getTime()
  const bytes = spec.rig.widthPx * spec.rig.heightPx * (ext === "xisf" ? 4 : 2) + 11_520
  for (let i = 0; i < spec.count; i += 1) {
    const dateObs = new Date(startMs + i * (spec.exposureS + 12) * 1000).toISOString()
    const header: FrameHeader = {
      imageType: spec.imageType,
      object: spec.object,
      filter: spec.filter,
      exposureS: spec.exposureS,
      dateObs,
      instrument: spec.rig.instrument,
      telescope: spec.rig.telescope,
      focalLengthMm: spec.rig.focalLengthMm,
      binning: 1,
      gain: spec.rig.gain,
      offset: spec.rig.offset,
      ccdTempC: spec.rig.ccdTempC + Math.round((random() - 0.5) * 4) / 10,
      ra: spec.pointing ? spec.pointing.ra + (random() - 0.5) * 0.02 : null,
      dec: spec.pointing ? spec.pointing.dec + (random() - 0.5) * 0.02 : null,
      rotationDeg: spec.pointing?.rotationDeg ?? null,
      widthPx: spec.rig.widthPx,
      heightPx: spec.rig.heightPx,
      pixelSizeUm: spec.rig.pixelSizeUm,
      bayerPattern: spec.rig.bayerPattern,
      siteLat: spec.site?.lat ?? null,
      siteLon: spec.site?.lon ?? null,
      ...spec.overrides,
    }
    const isLight = spec.imageType === "light"
    const truth: PixelTruth = {
      fwhmPx: 2.4 + random() * 0.6,
      eccentricity: 0.36 + random() * 0.12,
      starCount: isLight ? Math.round(1500 + random() * 600) : 0,
      background: isLight ? 820 + random() * 120 : 300 + random() * 40,
      saturatedStars: isLight ? Math.round(random() * 3) : 0,
      invalidSamples: 0,
      trailed: false,
      ...spec.truth?.(i),
    }
    const path = `${MOUNT[spec.volumeId]}/${spec.dir}/${spec.prefix}_${String(i + 1).padStart(4, "0")}.${ext}`
    files.push(makeFile({ path, volumeId: spec.volumeId, sizeBytes: bytes, kind: ext, header, pixelTruth: truth, modifiedAt: dateObs }))
  }
  return files
}

const A = VOLUME_IDS.astro
const NGC7000 = { ra: 314.75, dec: 44.53 }

function light(
  volumeId: VolumeId,
  dir: string,
  prefix: string,
  count: number,
  start: string,
  exposureS: number,
  filter: string | null,
  object: string | null,
  pointing: CaptureSpec["pointing"],
  extra: Partial<CaptureSpec> = {},
): DiskFile[] {
  return captureSet({ volumeId, dir, prefix, count, start, imageType: "light", exposureS, filter, object, rig: REDCAT, pointing, site: SITE_COORDS.backyard, ...extra })
}

function calibrationSet(dir: string, prefix: string, count: number, start: string, imageType: ImageType, exposureS: number, filter: string | null, rig: Rig = REDCAT): DiskFile[] {
  return captureSet({ volumeId: A, dir, prefix, count, start, imageType, exposureS, filter, object: null, rig, pointing: null, site: null })
}

function masterFile(name: string, imageType: ImageType, exposureS: number, filter: string | null, date: string, volumeId: VolumeId = A, dir = "Calibration/Masters"): DiskFile {
  const path = `${MOUNT[volumeId]}/${dir}/${name}`
  return makeFile({
    path,
    volumeId,
    sizeBytes: REDCAT.widthPx * REDCAT.heightPx * 4 + 23_040,
    kind: "xisf",
    header: {
      imageType, object: null, filter, exposureS, dateObs: date, instrument: REDCAT.instrument, telescope: imageType === "master-flat" ? REDCAT.telescope : null,
      focalLengthMm: imageType === "master-flat" ? REDCAT.focalLengthMm : null, binning: 1, gain: REDCAT.gain, offset: REDCAT.offset, ccdTempC: REDCAT.ccdTempC,
      ra: null, dec: null, rotationDeg: null, widthPx: REDCAT.widthPx, heightPx: REDCAT.heightPx, pixelSizeUm: REDCAT.pixelSizeUm, bayerPattern: null, siteLat: null, siteLon: null,
    },
    modifiedAt: date,
  })
}

/** Files on every simulated volume before PlateVault touches anything. */
function baseFiles(): DiskFile[] {
  const rot = 90
  return [
    // Demo-only history lives outside Captures, so J19's Captures folder holds exactly its seven sessions.
    // Mosaic panel case: Heart and Soul, two explicit panels.
    ...light(A, "Imaging/HeartSoul/2026-09-14/Ha", "Light_HeartP1_300s_Ha", 20, "2026-09-14T20:40:00Z", 300, "Ha", "Heart Panel 1", { ra: 38.2, dec: 61.45, rotationDeg: 0 }),
    ...light(A, "Imaging/HeartSoul/2026-09-15/Ha", "Light_HeartP2_300s_Ha", 18, "2026-09-15T20:40:00Z", 300, "Ha", "Heart Panel 2", { ra: 42.8, dec: 60.43, rotationDeg: 0 }),
    // M 31 across nights: LRGB plus Ha and OIII.
    ...light(A, "Imaging/M31/2026-09-02/L", "Light_M31_120s_L", 60, "2026-09-02T21:00:00Z", 120, "L", "M31", { ra: 10.685, dec: 41.269, rotationDeg: 12 }),
    ...light(A, "Imaging/M31/2026-09-03/R", "Light_M31_120s_R", 20, "2026-09-03T21:00:00Z", 120, "R", "M31", { ra: 10.685, dec: 41.269, rotationDeg: 12 }),
    ...light(A, "Imaging/M31/2026-09-03/G", "Light_M31_120s_G", 20, "2026-09-03T21:50:00Z", 120, "G", "M31", { ra: 10.685, dec: 41.269, rotationDeg: 12 }),
    ...light(A, "Imaging/M31/2026-09-03/B", "Light_M31_120s_B", 20, "2026-09-03T22:40:00Z", 120, "B", "M31", { ra: 10.685, dec: 41.269, rotationDeg: 12 }),
    ...light(A, "Imaging/M31/2026-09-04/Ha", "Light_M31_300s_Ha", 30, "2026-09-04T21:10:00Z", 300, "Ha", "M31", { ra: 10.685, dec: 41.269, rotationDeg: 12 }),
    ...light(A, "Imaging/M31/2026-09-05/OIII", "Light_M31_300s_OIII", 24, "2026-09-05T21:10:00Z", 300, "OIII", "M31", { ra: 10.685, dec: 41.269, rotationDeg: 12 }),
    ...light(A, "Imaging/M33/2026-08-30/L", "Light_M33_120s_L", 40, "2026-08-30T22:00:00Z", 120, "L", "M33", { ra: 23.462, dec: 30.66, rotationDeg: 0 }),
    // NGC 7000: the worked example.
    ...light(VOLUME_IDS.cold, "Captures/NGC7000/2026-09-12/OIII", "Light_NGC7000_300s_OIII", 24, "2026-09-12T21:30:00Z", 300, "OIII", "NGC 7000", { ...NGC7000, rotationDeg: rot }, { site: SITE_COORDS.lapalma }),
    ...light(A, "Captures/NGC7000/2026-09-18/Ha", "Light_NGC7000_300s_Ha", 55, "2026-09-18T20:20:00Z", 300, "Ha", "NGC 7000", { ra: 314.7, dec: 44.5, rotationDeg: null }),
    ...captureSet({ volumeId: A, dir: "Captures/NGC7000/2026-09-21/OSC", prefix: "Light_NGC7000_120s_Ha", count: 40, start: "2026-09-21T20:30:00Z", imageType: "light", exposureS: 120, filter: "Ha", object: "NGC 7000", rig: SAMYANG, pointing: { ...NGC7000, rotationDeg: 0 }, site: SITE_COORDS.backyard }),
    ...light(A, "Captures/NGC7000/2026-09-24/OIII", "Light_300s_OIII", 20, "2026-09-24T20:10:00Z", 300, "OIII", null, null),
    ...light(A, "Captures/NGC7000/2026-09-26/OIII", "Light_Cygnus_300s_OIII", 35, "2026-09-26T19:55:00Z", 300, "OIII", "Cygnus field", { ra: 314.8, dec: 44.6, rotationDeg: rot }),
    // J19 P2: 28 Sep has no telescope or focal-length keywords, so its equipment needs review.
    ...light(A, "Captures/NGC7000/2026-09-28/Ha", "Light_NGC7000_300s_Ha", 56, "2026-09-28T19:50:00Z", 300, "Ha", "NGC 7000", { ...NGC7000, rotationDeg: rot }, {
      overrides: { telescope: null, focalLengthMm: null },
      truth: (i) => (i === 30 ? { invalidSamples: 140 } : i === 5 ? { saturatedStars: 9 } : {}),
    }),
    ...light(A, "Captures/NGC7000/2026-09-30/OIII", "Light_300s_OIII", 48, "2026-09-30T19:45:00Z", 300, "OIII", "NGC 7000", { ra: 314.76, dec: 44.52, rotationDeg: rot }, {
      truth: (i) => (i >= 12 && i <= 17 ? { trailed: true, eccentricity: 0.78, fwhmPx: 4.1 } : {}),
    }),
    makeFile({ path: "/Volumes/Astro-T7/Captures/NGC7000/observing-notes.txt", volumeId: A, sizeBytes: 2_140, kind: "text", modifiedAt: "2026-09-30T23:10:00Z" }),
    // J22: a PixInsight SubframeSelector export for the 30 Sep OIII session; T3 defines its rows.
    makeFile({ path: "/Volumes/Astro-T7/Work/Measurements/NGC7000_30Sep_SubframeSelector.csv", volumeId: A, sizeBytes: 18_420, kind: "csv", modifiedAt: "2026-10-01T09:00:00Z" }),
    // Calibration: raw sets and library masters.
    // Day-time calibration starts after 12:00 UTC so each set stays in one night.
    ...calibrationSet("Calibration/Darks/2026-09-08/300s", "Dark_300s_G100", 30, "2026-09-08T14:00:00Z", "dark", 300, null),
    ...calibrationSet("Calibration/Darks/2026-09-08/120s", "Dark_120s_G100", 30, "2026-09-08T17:00:00Z", "dark", 120, null),
    ...calibrationSet("Calibration/Bias/2026-09-08", "Bias_G100", 50, "2026-09-08T18:30:00Z", "bias", 0.000032, null),
    ...calibrationSet("Calibration/Flats/2026-09-02/L", "Flat_L", 20, "2026-09-03T05:30:00Z", "flat", 0.8, "L"),
    ...calibrationSet("Calibration/Flats/2026-09-02/R", "Flat_R", 20, "2026-09-03T05:40:00Z", "flat", 1.1, "R"),
    ...calibrationSet("Calibration/Flats/2026-09-02/G", "Flat_G", 20, "2026-09-03T05:50:00Z", "flat", 1.0, "G"),
    ...calibrationSet("Calibration/Flats/2026-09-02/B", "Flat_B", 20, "2026-09-03T06:00:00Z", "flat", 1.3, "B"),
    ...calibrationSet("Calibration/Flats/2026-09-18/Ha", "Flat_Ha", 30, "2026-09-19T05:20:00Z", "flat", 1.5, "Ha"),
    ...calibrationSet("Calibration/Flats/2026-09-26/OIII", "Flat_OIII", 30, "2026-09-27T05:25:00Z", "flat", 2.0, "OIII", { ...REDCAT, telescope: null, focalLengthMm: null }),
    ...calibrationSet("Calibration/Flats/2026-09-28/Ha", "Flat_Ha", 30, "2026-09-29T05:20:00Z", "flat", 1.5, "Ha"),
    ...calibrationSet("Calibration/Flats/2026-09-30/OIII", "Flat_OIII", 30, "2026-10-01T05:30:00Z", "flat", 2.0, "OIII"),
    masterFile("MasterDark_300s_G100_O50_-10C.xisf", "master-dark", 300, null, "2026-09-08T12:00:00Z"),
    masterFile("MasterDark_120s_G100_O50_-10C.xisf", "master-dark", 120, null, "2026-09-08T15:00:00Z"),
    masterFile("MasterBias_G100_O50.xisf", "master-bias", 0.000032, null, "2026-09-08T16:30:00Z"),
    // Unrelated content that makes a suggested View folder collide (PREP-AC-02).
    makeFile({ path: "/Volumes/Scratch/Processing/NGC7000-HOO-Siril/keep.txt", volumeId: VOLUME_IDS.scratch, sizeBytes: 412, kind: "text", modifiedAt: "2026-09-20T10:00:00Z" }),
  ]
}

/** J25: two new matching sessions copied into captures later (prototype control). */
export function arrivalFiles(): DiskFile[] {
  return [
    ...light(A, "Captures/NGC7000/2026-10-02/Ha", "Light_NGC7000_300s_Ha", 10, "2026-10-02T19:40:00Z", 300, "Ha", "NGC 7000", { ...NGC7000, rotationDeg: 90 }),
    ...light(A, "Captures/NGC7000/2026-10-02/OIII", "Light_NGC7000_300s_OIII", 10, "2026-10-02T20:40:00Z", 300, "OIII", "NGC 7000", { ...NGC7000, rotationDeg: 90 }),
  ]
}

export const PROFILE_IDS = {
  pixinsight: "prof_pixinsight",
  siril: "prof_siril",
  seti: "prof_seti",
  generic: "prof_generic",
} as const

/** Built-in application profiles (D04). Capability evidence is fixture data. */
function builtInProfiles(): Record<string, ApplicationProfile> {
  const list: ApplicationProfile[] = [
    {
      id: PROFILE_IDS.pixinsight,
      application: "pixinsight-wbpp",
      name: "PixInsight / WBPP",
      executablePath: "/Applications/PixInsight/PixInsight.app",
      executableState: "found",
      launchArgs: "",
      capability: {
        verified: true,
        evidence: "Fixture evidence: WBPP 2.8 reads an exact file list and does not write to input files.",
        inputWrite: "read-only",
        inputModes: ["linked", "direct-source", "copy", "clone"],
        directSource: "file-list",
        productInputKinds: ["linear-integration", "channel-product", "mosaic-panel"],
        correctedMetadata: "none",
      },
    },
    {
      id: PROFILE_IDS.siril,
      application: "siril",
      name: "Siril",
      executablePath: null,
      executableState: "not-configured",
      launchArgs: "",
      capability: {
        verified: true,
        evidence: "Fixture evidence: Siril 1.4 accepts an exact file list and opens inputs read-only.",
        inputWrite: "read-only",
        inputModes: ["linked", "direct-source", "copy", "clone"],
        directSource: "file-list",
        productInputKinds: ["linear-integration", "channel-product"],
        correctedMetadata: "none",
      },
    },
    {
      id: PROFILE_IDS.seti,
      application: "seti-astro",
      name: "SETI Astro Suite Pro",
      executablePath: null,
      executableState: "not-configured",
      launchArgs: "",
      capability: {
        verified: false,
        evidence: "No capability evidence recorded. Input-write behaviour is unknown and it consumes whole folders.",
        inputWrite: "unknown",
        inputModes: ["copy", "clone"],
        directSource: "whole-folder",
        productInputKinds: [],
        correctedMetadata: "none",
      },
    },
    {
      id: PROFILE_IDS.generic,
      application: "generic",
      name: "Open in…",
      executablePath: null,
      executableState: "not-configured",
      launchArgs: "",
      capability: {
        verified: false,
        evidence: "Generic launcher. It does not claim a verified profile.",
        inputWrite: "unknown",
        inputModes: ["copy"],
        directSource: "none",
        productInputKinds: [],
        correctedMetadata: "none",
      },
    },
  ]
  return Object.fromEntries(list.map((p) => [p.id, p]))
}

function builtInFilters(): Record<string, FilterDef> {
  const list: FilterDef[] = [
    { id: "flt_ha", name: "Ha", category: "narrowband", aliases: ["H-alpha", "Halpha"], source: "built-in" },
    { id: "flt_oiii", name: "OIII", category: "narrowband", aliases: ["O3", "O-III"], source: "built-in" },
    { id: "flt_sii", name: "SII", category: "narrowband", aliases: ["S2", "S-II"], source: "built-in" },
    { id: "flt_l", name: "L", category: "broadband", aliases: ["Lum", "Luminance"], source: "built-in" },
    { id: "flt_r", name: "R", category: "broadband", aliases: ["Red"], source: "built-in" },
    { id: "flt_g", name: "G", category: "broadband", aliases: ["Green"], source: "built-in" },
    { id: "flt_b", name: "B", category: "broadband", aliases: ["Blue"], source: "built-in" },
    { id: "flt_lextreme", name: "L-eXtreme", category: "dual-band", aliases: ["LeXtreme"], source: "built-in" },
  ]
  return Object.fromEntries(list.map((f) => [f.id, f]))
}

export function emptyCatalog(): Catalog {
  return {
    locations: {},
    assets: {},
    sessions: {},
    targets: {},
    cameras: {},
    telescopes: {},
    opticalTrains: {},
    filters: builtInFilters(),
    sites: {},
    projects: {},
    views: {},
    measurements: {},
    masters: {},
    profiles: builtInProfiles(),
    preparations: {},
    results: {},
    plans: {},
    reminders: { enabled: false, siteId: null, leadTimeMin: null, permission: "not-requested", deliveredWindowKeys: [], enabledAt: null },
    calendarExports: [],
  }
}

export function defaultSettings(): AppSettings {
  return {
    defaultSiteId: null,
    planningSiteId: null,
    onboarding: { completedAt: null, deferredRoles: [], tourCompletedAt: null, checklistHidden: false },
    lastViewParent: null,
    targetLookup: { enabled: true, provider: "cds-sesame" },
  }
}

export function defaultFaults(): SimulationFaults {
  return {
    failNextCatalogWrite: false,
    notificationResponse: "grant",
    failNextHashVerification: false,
    staleNextWrite: false,
    failNextResolverLookup: false,
    clockOffsetMs: 0,
  }
}

export interface SeedData {
  seed: SeedName
  disk: Disk
  catalog: Catalog
  operations: Record<string, Operation>
  activity: ActivityEvent[]
  settings: AppSettings
  faults: SimulationFaults
}

/** Empty folders the journeys need before anything writes into them. */
const EXPLICIT_FOLDERS = [
  { volumeId: A, path: "/Volumes/Astro-T7/Work/Processing" }, // J24 P3
  { volumeId: A, path: "/Volumes/Astro-T7/Work/Outputs" }, // J24 P3
  { volumeId: A, path: "/Volumes/Astro-T7/Library" }, // J30 P2
  { volumeId: VOLUME_IDS.archive, path: "/Volumes/Archive/Library" }, // J30 P2
  { volumeId: VOLUME_IDS.archive, path: "/Volumes/Archive/NGC7000" }, // J28 destination
  { volumeId: VOLUME_IDS.spare, path: "/Volumes/Spare/Captures" }, // J25 P4
]

function diskOf(files: DiskFile[], coldMounted: boolean, deniedPaths: string[]): Disk {
  return {
    volumes: buildVolumes(coldMounted),
    files: Object.fromEntries(files.map((f) => [fileKey(f.volumeId, f.path), f])),
    folders: EXPLICIT_FOLDERS.map((f) => ({ ...f })),
    deniedPaths,
    readOnlyPaths: [],
    trash: [],
  }
}

/** First run: the disk exists, the catalog is empty, onboarding starts. */
function emptySeed(): SeedData {
  return {
    seed: "empty",
    // J19: the calibration folder starts access-denied; Cold-1 is connected.
    disk: diskOf(baseFiles(), true, ["/Volumes/Astro-T7/Calibration"]),
    catalog: emptyCatalog(),
    operations: {},
    activity: [],
    settings: defaultSettings(),
    faults: defaultFaults(),
  }
}

function location(id: string, displayName: string, path: string, volumeId: VolumeId, role: Location["role"], managed = false): Location {
  return { id, displayName, path, volumeId, role, managed, registeredAt: "2026-09-01T18:00:00.000Z", access: "unknown", lastIndexedAt: null, scanScope: "never", unreadablePaths: [], lastScanOperationId: null }
}

function findSession(catalog: Catalog, predicate: (s: Session) => boolean): Session {
  const session = Object.values(catalog.sessions).find(predicate)
  if (!session) throw new Error("Demo seed: expected session not found")
  return session
}

/** Demo: indexed library with history, an offline location and a partial scan. */
function demoSeed(): SeedData {
  const files = baseFiles()
  const disk = diskOf(files, true, [])
  let catalog = emptyCatalog()

  catalog.cameras = {
    cam_2600: { id: "cam_2600", name: "ASI2600MM Pro", aliases: ["ZWO ASI2600MM Pro"], source: "manual", widthPx: 6248, heightPx: 4176, pixelSizeUm: 3.76, color: false },
    cam_533: { id: "cam_533", name: "ASI533MC Pro", aliases: ["ZWO ASI533MC Pro"], source: "manual", widthPx: 3008, heightPx: 3008, pixelSizeUm: 3.76, color: true },
  }
  catalog.telescopes = {
    tel_redcat: { id: "tel_redcat", name: "RedCat 51", aliases: ["William Optics RedCat 51"], source: "manual", focalLengthMm: 250, apertureMm: 51 },
    tel_samyang: { id: "tel_samyang", name: "Samyang 135", aliases: ["Samyang 135mm f/2"], source: "manual", focalLengthMm: 135, apertureMm: 67 },
  }
  catalog.opticalTrains = {
    otr_redcat: { id: "otr_redcat", name: "RedCat 51 / ASI2600MM", source: "manual", cameraId: "cam_2600", telescopeId: "tel_redcat", effectiveFocalLengthMm: 250, notes: "" },
    otr_samyang: { id: "otr_samyang", name: "Samyang 135 / ASI533MC", source: "manual", cameraId: "cam_533", telescopeId: "tel_samyang", effectiveFocalLengthMm: 135, notes: "" },
  }
  catalog.sites = {
    site_backyard: { id: "site_backyard", name: "Backyard", latitude: 52.09, longitude: 5.12, elevationM: 5, timeZone: "Europe/Amsterdam", twilight: "astronomical", minAltitudeDeg: 25 },
    site_lapalma: { id: "site_lapalma", name: "La Palma", latitude: 28.76, longitude: -17.88, elevationM: 2300, timeZone: "Atlantic/Canary", twilight: "astronomical", minAltitudeDeg: 20 },
  }
  catalog.locations = {
    loc_captures: location("loc_captures", "Astro-T7 captures", "/Volumes/Astro-T7/Captures", A, "captures"),
    loc_imaging: location("loc_imaging", "Astro-T7 imaging", "/Volumes/Astro-T7/Imaging", A, "captures"),
    loc_cold: location("loc_cold", "Cold-1 captures", "/Volumes/Cold-1/Captures", VOLUME_IDS.cold, "captures"),
    loc_calibration: location("loc_calibration", "Astro-T7 calibration", "/Volumes/Astro-T7/Calibration", A, "calibration"),
    loc_finals: location("loc_finals", "Finals", "/Volumes/Astro-T7/Work/Finals", A, "results"),
    loc_library: location("loc_library", "Astro-T7 library", "/Volumes/Astro-T7/Library", A, "captures", true),
    loc_archive: location("loc_archive", "Archive", "/Volumes/Archive", VOLUME_IDS.archive, "archive", true),
  }

  // Cold-1 was indexed on 13 Sep while connected.
  catalog = indexLocationsSync(catalog, disk, ["loc_cold"], "2026-09-13T08:00:00.000Z")
  // The 1 Oct scan of Astro-T7 hit an access-denied folder (partial scan).
  disk.deniedPaths = ["/Volumes/Astro-T7/Imaging/M33/2026-08-30"]
  catalog = indexLocationsSync(catalog, disk, ["loc_captures", "loc_imaging", "loc_calibration", "loc_finals", "loc_library", "loc_archive"], "2026-10-01T08:00:00.000Z")
  disk.volumes[VOLUME_IDS.cold] = { ...disk.volumes[VOLUME_IDS.cold]!, mounted: false }

  const m31Night = (night: string, channel: string) =>
    findSession(catalog, (s) => s.imageType === "light" && s.night === night && s.channel === channel && s.objectLabel === "M31")
  const m31 = {
    L: m31Night("2026-09-02", "L"),
    R: m31Night("2026-09-03", "R"),
    G: m31Night("2026-09-03", "G"),
    B: m31Night("2026-09-03", "B"),
    Ha: m31Night("2026-09-04", "Ha"),
    OIII: m31Night("2026-09-05", "OIII"),
  }
  const heart1 = findSession(catalog, (s) => s.objectLabel === "Heart Panel 1")
  const heart2 = findSession(catalog, (s) => s.objectLabel === "Heart Panel 2")

  // Confirmed associations for M 31 and the mosaic panels.
  for (const session of [...Object.values(m31), heart1, heart2]) {
    catalog.sessions[session.id] = {
      ...session,
      target: { ...session.target, status: "confirmed", confirmedAt: "2026-09-06T09:00:00.000Z" },
      equipment: { ...session.equipment, value: "otr_redcat", status: "confirmed", confirmedAt: "2026-09-06T09:00:00.000Z" },
    }
  }

  // Library quality decisions for M 31 (L has five Unusable frames).
  const unusableL = new Set([2, 16, 28, 43, 57])
  const decide = (session: Session, value: "usable" | "unusable" | ((index: number) => "usable" | "unusable")) => {
    session.assetIds.forEach((id, index) => {
      const asset = catalog.assets[id]!
      const decided = typeof value === "function" ? value(index) : value
      catalog.assets[id] = { ...asset, quality: { value: decided, decidedAt: "2026-09-06T10:00:00.000Z", basisSha256: asset.sha256 } }
    })
  }
  decide(m31.L, (index) => (unusableL.has(index) ? "unusable" : "usable"))
  for (const s of [m31.R, m31.G, m31.B, m31.Ha]) decide(s, "usable")

  // One drifted-content asset: an M 31 L frame changed on disk after review.
  const driftedId = m31.L.assetIds[6]!
  const drifted = catalog.assets[driftedId]!
  const driftedPath = drifted.copies[0]!.path
  const driftedSha = fakeSha256(driftedPath, 1)
  disk.files[fileKey(A, driftedPath)] = { ...fileAt(disk, driftedPath)!, sha256: driftedSha, modifiedAt: "2026-09-20T22:14:00.000Z" }
  catalog.assets[driftedId] = { ...drifted, sha256: driftedSha, copies: drifted.copies.map((c) => ({ ...c, sha256: driftedSha })) }

  // Cached measurements for the M 31 broadband frames.
  const scale = pixelScaleArcsec(3.76, 250)
  for (const s of [m31.L, m31.R, m31.G, m31.B]) {
    for (const id of s.assetIds) {
      const asset = catalog.assets[id]!
      catalog.measurements[id] = simulateMeasurement(asset, fileAt(disk, asset.copies[0]!.path), scale, "2026-09-06T11:00:00.000Z")
    }
  }

  const m31Target = catalog.sessions[m31.L.id]!.target.value!
  const heartTargets = [catalog.sessions[heart1.id]!.target.value!, catalog.sessions[heart2.id]!.target.value!]

  catalog.projects = {
    prj_m31: {
      id: "prj_m31",
      name: "M 31 LRGB",
      notes: "Broadband first; narrowband blend later.",
      targetIds: [m31Target],
      framing: { ra: 10.685, dec: 41.269, rotationDeg: 12, widthDeg: 3.2, heightDeg: 1.0, source: "target" },
      panels: [],
      equipmentId: "otr_redcat",
      linkedSessionIds: Object.values(m31).map((s) => s.id),
      checklist: [
        { id: "chk_m31_l", kind: "integration", channel: "L", goalS: 3 * 3600 },
        { id: "chk_m31_r", kind: "integration", channel: "R", goalS: 40 * 60 },
        { id: "chk_m31_g", kind: "integration", channel: "G", goalS: 40 * 60 },
        { id: "chk_m31_b", kind: "integration", channel: "B", goalS: 40 * 60 },
        { id: "chk_m31_ha", kind: "integration", channel: "Ha", goalS: 4 * 3600 },
      ],
      rejections: {},
      createdAt: "2026-09-01T19:00:00.000Z",
      revision: 3,
    },
    prj_heart: {
      id: "prj_heart",
      name: "Heart and Soul mosaic",
      notes: "Two-panel Ha mosaic.",
      targetIds: heartTargets,
      framing: null,
      panels: [
        { id: "pnl_1", name: "Panel 1 (Heart)", ra: 38.2, dec: 61.45, widthDeg: 5.4, heightDeg: 3.6, rotationDeg: 0 },
        { id: "pnl_2", name: "Panel 2 (Soul)", ra: 42.8, dec: 60.43, widthDeg: 5.4, heightDeg: 3.6, rotationDeg: 0 },
        // East of Panel 2: no linked session's footprint reaches the coverage threshold (uncovered).
        { id: "pnl_3", name: "Panel 3 (east)", ra: 50.4, dec: 59.6, widthDeg: 5.4, heightDeg: 3.6, rotationDeg: 0 },
      ],
      equipmentId: "otr_redcat",
      linkedSessionIds: [heart1.id, heart2.id],
      checklist: [
        { id: "chk_heart_ha", kind: "integration", channel: "Ha", goalS: 6 * 3600 },
        { id: "chk_heart_p1", kind: "panel-coverage", panelId: "pnl_1" },
        { id: "chk_heart_p2", kind: "panel-coverage", panelId: "pnl_2" },
        { id: "chk_heart_p3", kind: "panel-coverage", panelId: "pnl_3" },
      ],
      rejections: {},
      createdAt: "2026-09-13T19:00:00.000Z",
      revision: 1,
    },
  }

  // A completed M 31 attempt: prepared with symlinks, processed in PixInsight.
  const viewPath = "/Volumes/Astro-T7/Work/Processing/M31-LRGB-PixInsight"
  const broadband = [m31.L, m31.R, m31.G, m31.B]
  const included = broadband.flatMap((s) => s.assetIds.filter((id) => catalog.assets[id]!.quality.value === "usable"))
  const excluded = m31.L.assetIds.filter((id) => catalog.assets[id]!.quality.value === "unusable")
  const viewFiles: DiskFile[] = []
  for (const id of included) {
    const asset = catalog.assets[id]!
    const stem = asset.fileName.replace(/\.fits$/, "")
    viewFiles.push(makeFile({ path: `${viewPath}/lights/${asset.fileName}`, volumeId: A, sizeBytes: 0, kind: "fits", linkTarget: asset.copies[0]!.path, modifiedAt: "2026-09-07T18:00:00.000Z" }))
    viewFiles.push(makeFile({ path: `${viewPath}/output/calibrated/${stem}_c.xisf`, volumeId: A, sizeBytes: 104_390_000, kind: "xisf", modifiedAt: "2026-09-07T19:00:00.000Z" }))
    viewFiles.push(makeFile({ path: `${viewPath}/output/registered/${stem}_c_r.xisf`, volumeId: A, sizeBytes: 104_390_000, kind: "xisf", modifiedAt: "2026-09-07T19:40:00.000Z" }))
  }
  const masterLights = (["L", "R", "G", "B"] as const).map((channel) =>
    makeFile({ path: `${viewPath}/output/master/masterLight_BIN-1_FILTER-${channel}.xisf`, volumeId: A, sizeBytes: 104_390_000, kind: "xisf", modifiedAt: "2026-09-07T20:30:00.000Z" }),
  )
  const masterFlats = (["L", "R", "G", "B"] as const).map((channel) =>
    masterFile(`masterFlat_BIN-1_FILTER-${channel}.xisf`, "master-flat", 1, channel, "2026-09-07T18:40:00.000Z", A, "Work/Processing/M31-LRGB-PixInsight/output/master"),
  )
  const finalTif = makeFile({ path: "/Volumes/Astro-T7/Work/Finals/M31-LRGB.tif", volumeId: A, sizeBytes: 156_500_000, kind: "tiff", modifiedAt: "2026-09-09T21:00:00.000Z" })
  const log = makeFile({ path: `${viewPath}/output/logs/WBPP_2026-09-07.log`, volumeId: A, sizeBytes: 84_000, kind: "log", modifiedAt: "2026-09-07T20:31:00.000Z" })
  disk.files = writeFiles(disk, [...viewFiles, ...masterLights, ...masterFlats, finalTif, log]).files

  catalog.views = {
    view_m31: {
      id: "view_m31",
      name: "M31 LRGB - PixInsight",
      projectId: "prj_m31",
      targetId: m31Target,
      origin: "project",
      profileId: PROFILE_IDS.pixinsight,
      revisions: [
        {
          revision: 1,
          savedAt: "2026-09-07T17:50:00.000Z",
          sessions: broadband.map((s) => ({ sessionId: s.id, reason: { kind: "project-equipment" as const, detail: "Project equipment RedCat 51 / ASI2600MM, footprint overlaps M 31 framing" } })),
          included,
          excluded,
          unresolved: [],
          productInputs: [],
        },
      ],
      draft: null,
      criteria: { targetId: m31Target, projectId: "prj_m31", opticalTrainIds: ["otr_redcat"], channels: ["L", "R", "G", "B"], exposureS: [120] },
      calibration: [],
      locationParent: "/Volumes/Astro-T7/Work/Processing",
      outputPath: `${viewPath}/output`,
      notes: "First LRGB pass; colour balance needs another look.",
      completedAt: "2026-09-10T08:00:00.000Z",
      createdAt: "2026-09-07T17:30:00.000Z",
      revision: 4,
    },
  }

  const darkMaster = Object.values(catalog.masters).find((m) => m.kind === "dark" && m.exposureS === 120)!
  const biasMaster = Object.values(catalog.masters).find((m) => m.kind === "bias")!
  const flatSet = (channel: string) => findSession(catalog, (s) => s.imageType === "flat" && s.night === "2026-09-02" && s.channel === channel)
  catalog.views.view_m31!.calibration = broadband.flatMap((light) => [
    { id: `cal_${light.id}_dark`, lightSessionId: light.id, kind: "dark" as const, input: { type: "master" as const, masterId: darkMaster.id }, state: "accepted" as const, criteria: [], exception: null },
    { id: `cal_${light.id}_bias`, lightSessionId: light.id, kind: "bias" as const, input: { type: "master" as const, masterId: biasMaster.id }, state: "accepted" as const, criteria: [], exception: null },
    { id: `cal_${light.id}_flat`, lightSessionId: light.id, kind: "flat" as const, input: { type: "raw-set" as const, sessionId: flatSet(light.channel!).id }, state: "accepted" as const, criteria: [], exception: null },
  ])

  catalog.preparations = {
    prep_m31: {
      id: "prep_m31",
      viewId: "view_m31",
      membershipRevision: 1,
      profileId: PROFILE_IDS.pixinsight,
      mode: "linked",
      linkType: "symlink",
      viewPath,
      outputPath: `${viewPath}/output`,
      entryCount: included.length,
      footprintBytes: 0,
      state: "prepared",
      operationId: null,
      preparedAssetIds: included,
      blocked: [],
      preparedResultIds: [],
      metadataDecisions: [],
      launches: [{ at: "2026-09-07T18:05:00.000Z", outcome: "opened" }],
      createdAt: "2026-09-07T18:00:00.000Z",
      settledAt: "2026-09-07T18:01:00.000Z",
    },
  }

  for (const [index, file] of masterLights.entries()) {
    const channel = ["L", "R", "G", "B"][index]!
    const id = `res_m31_${channel.toLowerCase()}`
    catalog.results[id] = {
      id, viewId: "view_m31", path: file.path, kind: "linear-integration", channel, discovered: "output-location", processingState: "written",
      association: "tool-recorded", lineage: "tool-recorded", acceptance: "accepted", acceptedAt: "2026-09-08T09:00:00.000Z", sha256: file.sha256, contentState: "unchanged",
    }
  }
  catalog.results.res_m31_final = {
    id: "res_m31_final", viewId: "view_m31", path: finalTif.path, kind: "final-image", channel: null, discovered: "attached", processingState: "written",
    association: "user-linked", lineage: "unknown", acceptance: "accepted", acceptedAt: "2026-09-09T21:10:00.000Z", sha256: finalTif.sha256, contentState: "unchanged",
  }

  // Generated master flats detected in the View output: candidates only.
  for (const file of masterFlats) {
    const id = `mst_${stableHash(file.path)}`
    catalog.masters[id] = {
      id, kind: "flat", path: file.path, cameraName: REDCAT.instrument, widthPx: REDCAT.widthPx, heightPx: REDCAT.heightPx, binning: 1, gain: REDCAT.gain, offset: REDCAT.offset,
      exposureS: null, channel: file.header!.filter, opticalTrainId: "otr_redcat", ccdTempC: REDCAT.ccdTempC, frameCount: 20, createdAt: file.modifiedAt,
      state: "candidate", origin: { kind: "generated", viewId: "view_m31", sourcePath: file.path }, adoption: null,
    }
  }

  const settings = defaultSettings()
  settings.onboarding = { completedAt: "2026-09-01T18:10:00.000Z", deferredRoles: [], tourCompletedAt: "2026-09-01T18:12:00.000Z", checklistHidden: false }
  settings.lastViewParent = "/Volumes/Astro-T7/Work/Processing"

  const activity: ActivityEvent[] = [
    {
      id: "act_scan_partial",
      at: "2026-10-01T08:02:00.000Z",
      kind: "operation",
      title: "Indexing finished with incomplete scope",
      detail: "Access denied: /Volumes/Astro-T7/Imaging/M33/2026-08-30. Other folders were indexed.",
      operationId: null,
      href: "/settings/locations",
    },
  ]

  return { seed: "demo", disk, catalog, operations: {}, activity, settings, faults: defaultFaults() }
}

export function createSeed(name: SeedName): SeedData {
  return name === "demo" ? demoSeed() : emptySeed()
}
