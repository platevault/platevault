/**
 * Seeds: `empty` (first run; onboarding starts) and `demo` (harness v5: one
 * library that shows every state the review needs, HARNESS-V5-IA.md § Seed).
 * Both share the same simulated disk so the empty seed can be indexed into
 * the same library through onboarding.
 *
 * Demo contents:
 * - "Cygnus HOO 2026" (open): NGC 7000 and the 3-panel "IC 5070 mosaic";
 *   rigs RedCat 51 / ASI2600MM (mono: Ha, OIII, SII) and Esprit 100 /
 *   ASI533MC (OSC), HOO goals, an exposure mismatch on the OSC rig. Runs: one
 *   Complete with Cleanup available, one at Review with unreviewed frames,
 *   one blocked at Calibrate, a run group whose Panel 2 is Partial and whose
 *   Panel 3 is in the Trash, and one trashed run in the Project Trash.
 * - "M 31 LRGB" (Done): archive offers pending (rejected frames,
 *   intermediates, duplicate copies).
 * - "Heart and Soul" (open): no runs, candidates waiting.
 * - Library: sessions that need a Target, sessions in no Project, a Trashed
 *   session, an offline volume (Cold-1) and a running scan of a network share.
 * - Targets: favourites, a southern Target with no window tonight, a default site.
 *
 * All names, paths and counts are illustrative fixtures.
 */
import { plural } from "@/lib/format"
import { fakeSha256, fileAt, fileKey, makeFile, writeFiles } from "./disk"
import { indexLocationsSync, stableHash } from "./indexing"
import { addSessions, emptyContent } from "./membership"
import { simulateMeasurement } from "./measurement"
import { pixelScaleArcsec } from "./sky"
import type {
  ActivityEvent,
  AppSettings,
  ApplicationProfile,
  Asset,
  AssetId,
  Catalog,
  Disk,
  DiskFile,
  FrameHeader,
  Goal,
  ImageType,
  Location,
  MembershipRevision,
  Operation,
  PixelTruth,
  Preparation,
  ResultKind,
  ResultRecord,
  Run,
  RunGroup,
  SeedName,
  SelectionReason,
  Session,
  SimulatedApp,
  SimulationFaults,
  Subject,
  Target,
  Volume,
  VolumeId,
} from "./types"

export const VOLUME_IDS = {
  astro: "vol_astro_t7",
  cold: "vol_cold_1",
  scratch: "vol_scratch",
  archive: "vol_archive",
  impostor: "vol_archive_impostor",
  spare: "vol_spare",
  nas: "vol_nas",
  /** The ASIAIR SD card behind the demo's saved Import source; mounted by Prototype › Insert ASIAIR card. */
  asiair: "vol_asiair",
} as const

const TB = 1_000_000_000_000

function buildVolumes(coldMounted: boolean): Record<VolumeId, Volume> {
  const allLinks = { symlink: true, hardlink: true, clone: true }
  const list: Volume[] = [
    { id: VOLUME_IDS.astro, name: "Astro-T7", mountPath: "/Volumes/Astro-T7", volumeUuid: "5E1F-T7-0001", mounted: true, writable: true, trash: "supported", capacityBytes: 2 * TB, links: allLinks, network: false },
    { id: VOLUME_IDS.cold, name: "Cold-1", mountPath: "/Volumes/Cold-1", volumeUuid: "C01D-0001", mounted: coldMounted, writable: true, trash: "supported", capacityBytes: 4 * TB, links: allLinks, network: false },
    { id: VOLUME_IDS.scratch, name: "Scratch", mountPath: "/Volumes/Scratch", volumeUuid: "5C7A-0001", mounted: true, writable: true, trash: "unsupported", capacityBytes: 0.5 * TB, links: { symlink: false, hardlink: false, clone: false }, network: false },
    { id: VOLUME_IDS.archive, name: "Archive", mountPath: "/Volumes/Archive", volumeUuid: "A7C4-0001", mounted: true, writable: true, trash: "supported", capacityBytes: 8 * TB, links: { symlink: true, hardlink: true, clone: false }, network: false },
    { id: VOLUME_IDS.impostor, name: "Archive", mountPath: "/Volumes/Archive", volumeUuid: "A7C4-9999", mounted: false, writable: true, trash: "supported", capacityBytes: 1 * TB, links: { symlink: true, hardlink: true, clone: false }, network: false },
    { id: VOLUME_IDS.spare, name: "Spare", mountPath: "/Volumes/Spare", volumeUuid: "5BA2-0001", mounted: true, writable: true, trash: "supported", capacityBytes: 1 * TB, links: allLinks, network: false },
    // D-W12: an OS-mounted network share, hashed resumably with progress.
    { id: VOLUME_IDS.nas, name: "NAS", mountPath: "/Volumes/NAS", volumeUuid: "4A5E-0001", mounted: true, writable: true, trash: "supported", capacityBytes: 12 * TB, links: { symlink: true, hardlink: false, clone: false }, network: true },
  ]
  return Object.fromEntries(list.map((v) => [v.id, v]))
}

const MOUNT: Record<VolumeId, string> = {
  [VOLUME_IDS.astro]: "/Volumes/Astro-T7",
  [VOLUME_IDS.cold]: "/Volumes/Cold-1",
  [VOLUME_IDS.scratch]: "/Volumes/Scratch",
  [VOLUME_IDS.archive]: "/Volumes/Archive",
  [VOLUME_IDS.spare]: "/Volumes/Spare",
  [VOLUME_IDS.nas]: "/Volumes/NAS",
  [VOLUME_IDS.asiair]: "/Volumes/ASIAIR",
}

const SITE_COORDS = {
  backyard: { lat: 52.09, lon: 5.12 },
  lapalma: { lat: 28.76, lon: -17.88 },
}

/** Header values one optical train writes. */
interface Train {
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

const REDCAT: Train = { instrument: "ZWO ASI2600MM Pro", telescope: "RedCat 51", focalLengthMm: 250, widthPx: 6248, heightPx: 4176, pixelSizeUm: 3.76, gain: 100, offset: 50, ccdTempC: -10, bayerPattern: null }
const FRA400: Train = { ...REDCAT, telescope: "Askar FRA400", focalLengthMm: 400 }
const ESPRIT: Train = { instrument: "ZWO ASI533MC Pro", telescope: "Esprit 100", focalLengthMm: 550, widthPx: 3008, heightPx: 3008, pixelSizeUm: 3.76, gain: 101, offset: 50, ccdTempC: -5, bayerPattern: "RGGB" }

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
  rig: Train
  pointing: { ra: number; dec: number; rotationDeg: number | null } | null
  site: { lat: number; lon: number } | null
  ext?: "fits" | "xisf"
  overrides?: Partial<FrameHeader>
  truth?: (index: number) => Partial<PixelTruth>
  /** The last file is still being written by the capture device. */
  growingLast?: boolean
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
    files.push(makeFile({ path, volumeId: spec.volumeId, sizeBytes: bytes, kind: ext, header, pixelTruth: truth, growing: spec.growingLast === true && i === spec.count - 1, modifiedAt: dateObs }))
  }
  return files
}

const A = VOLUME_IDS.astro
const NGC7000 = { ra: 314.75, dec: 44.53 }
const IC5070 = { ra: 312.75, dec: 44.37 }
/** Panel centres of the IC 5070 mosaic: a north-south strip on the RedCat field (3.6° short side). */
const PANEL_DEC = [IC5070.dec - 3.1, IC5070.dec, IC5070.dec + 3.1]

function light(volumeId: VolumeId, dir: string, prefix: string, count: number, start: string, exposureS: number, filter: string | null, object: string | null, pointing: CaptureSpec["pointing"], extra: Partial<CaptureSpec> = {}): DiskFile[] {
  return captureSet({ volumeId, dir, prefix, count, start, imageType: "light", exposureS, filter, object, rig: REDCAT, pointing, site: SITE_COORDS.backyard, ...extra })
}

function calibrationSet(dir: string, prefix: string, count: number, start: string, imageType: ImageType, exposureS: number, filter: string | null, rig: Train = REDCAT): DiskFile[] {
  return captureSet({ volumeId: A, dir, prefix, count, start, imageType, exposureS, filter, object: null, rig, pointing: null, site: null })
}

function masterFile(name: string, imageType: ImageType, exposureS: number, filter: string | null, date: string, volumeId: VolumeId = A, dir = "Calibration/Masters", rig: Train = REDCAT): DiskFile {
  const path = `${MOUNT[volumeId]}/${dir}/${name}`
  return makeFile({
    path,
    volumeId,
    sizeBytes: rig.widthPx * rig.heightPx * 4 + 23_040,
    kind: "xisf",
    header: {
      imageType, object: null, filter, exposureS, dateObs: date, instrument: rig.instrument, telescope: imageType === "master-flat" ? rig.telescope : null,
      focalLengthMm: imageType === "master-flat" ? rig.focalLengthMm : null, binning: 1, gain: rig.gain, offset: rig.offset, ccdTempC: rig.ccdTempC,
      ra: null, dec: null, rotationDeg: null, widthPx: rig.widthPx, heightPx: rig.heightPx, pixelSizeUm: rig.pixelSizeUm, bayerPattern: rig.bayerPattern, siteLat: null, siteLon: null,
    },
    modifiedAt: date,
  })
}

const rot = 90

/** Files on every simulated volume before PlateVault touches anything. */
function baseFiles(): DiskFile[] {
  const fra = (dir: string, prefix: string, count: number, start: string, exposureS: number, filter: string, object: string, pointing: CaptureSpec["pointing"], extra: Partial<CaptureSpec> = {}) =>
    light(A, dir, prefix, count, start, exposureS, filter, object, pointing, { rig: FRA400, ...extra })
  const osc = (dir: string, prefix: string, count: number, start: string) =>
    captureSet({ volumeId: A, dir, prefix, count, start, imageType: "light", exposureS: 180, filter: "L-eXtreme", object: "NGC 7000", rig: ESPRIT, pointing: { ...NGC7000, rotationDeg: 0 }, site: SITE_COORDS.backyard })
  const panel = (dir: string, prefix: string, count: number, start: string, filter: string, n: number, volumeId: VolumeId = A) =>
    light(volumeId, dir, prefix, count, start, 300, filter, "IC 5070", { ra: IC5070.ra, dec: PANEL_DEC[n]!, rotationDeg: 0 })
  return [
    // NGC 7000 on RedCat 51 / ASI2600MM.
    ...light(VOLUME_IDS.cold, "Captures/NGC7000/2026-09-12/OIII", "Light_NGC7000_300s_OIII", 24, "2026-09-12T21:30:00Z", 300, "OIII", "NGC 7000", { ...NGC7000, rotationDeg: rot }),
    ...light(A, "Captures/NGC7000/2026-09-18/Ha", "Light_NGC7000_300s_Ha", 55, "2026-09-18T20:40:00Z", 300, "Ha", "NGC 7000", { ...NGC7000, rotationDeg: rot }),
    ...light(A, "Captures/NGC7000/2026-09-24/OIII", "Light_NGC7000_300s_OIII", 20, "2026-09-24T20:10:00Z", 300, "OIII", "NGC 7000", { ...NGC7000, rotationDeg: rot }),
    // OBJECT disagrees with the pointing: the Target needs review.
    ...light(A, "Captures/NGC7000/2026-09-26/OIII", "Light_Cygnus_300s_OIII", 35, "2026-09-26T19:55:00Z", 300, "OIII", "Cygnus field", { ra: 314.8, dec: 44.6, rotationDeg: rot }),
    // No telescope or focal-length keywords: the rig needs review.
    ...light(A, "Captures/NGC7000/2026-09-28/Ha", "Light_NGC7000_300s_Ha", 56, "2026-09-28T19:50:00Z", 300, "Ha", "NGC 7000", { ...NGC7000, rotationDeg: rot }, { overrides: { telescope: null, focalLengthMm: null } }),
    ...light(A, "Captures/NGC7000/2026-09-30/OIII", "Light_NGC7000_300s_OIII", 48, "2026-09-30T19:45:00Z", 300, "OIII", "NGC 7000", { ...NGC7000, rotationDeg: rot }, { truth: (i) => (i >= 12 && i <= 17 ? { trailed: true, eccentricity: 0.78, fwhmPx: 4.1 } : {}) }),
    ...light(A, "Captures/NGC7000/2026-10-02/Ha", "Light_NGC7000_300s_Ha", 10, "2026-10-02T19:40:00Z", 300, "Ha", "NGC 7000", { ...NGC7000, rotationDeg: rot }),
    // No OBJECT and no pointing: the Target stays unresolved.
    ...light(A, "Captures/Unsorted/2026-09-22", "Light_300s_Ha", 10, "2026-09-22T21:10:00Z", 300, "Ha", null, null),
    // NGC 7000 on Esprit 100 / ASI533MC (OSC, L-eXtreme): 180 s lights have no 180 s dark.
    ...osc("Captures/NGC7000/2026-09-21/OSC", "Light_NGC7000_180s_LeX", 40, "2026-09-21T20:30:00Z"),
    ...osc("Captures/NGC7000/2026-10-01/OSC", "Light_NGC7000_180s_LeX", 30, "2026-10-01T20:00:00Z"),
    // IC 5070 mosaic panels on RedCat; one session points between panels 1 and 2.
    ...panel("Captures/IC5070/2026-09-13/Ha", "Light_IC5070_P1_300s_Ha", 30, "2026-09-13T20:30:00Z", "Ha", 0),
    ...panel("Captures/IC5070/2026-09-14/OIII", "Light_IC5070_P1_300s_OIII", 30, "2026-09-14T21:30:00Z", "OIII", 0),
    ...panel("Captures/IC5070/2026-09-16/Ha", "Light_IC5070_P2_300s_Ha", 30, "2026-09-16T20:30:00Z", "Ha", 1, VOLUME_IDS.cold),
    ...panel("Captures/IC5070/2026-09-17/OIII", "Light_IC5070_P2_300s_OIII", 24, "2026-09-17T20:30:00Z", "OIII", 1),
    ...panel("Captures/IC5070/2026-09-19/Ha", "Light_IC5070_P3_300s_Ha", 20, "2026-09-19T20:30:00Z", "Ha", 2),
    ...light(A, "Captures/IC5070/2026-09-20/Ha", "Light_IC5070_300s_Ha", 12, "2026-09-20T20:30:00Z", 300, "Ha", "IC 5070", { ra: IC5070.ra, dec: (PANEL_DEC[0]! + PANEL_DEC[1]!) / 2, rotationDeg: 0 }),
    // Heart and Soul on RedCat, waiting for a first run.
    ...light(A, "Imaging/HeartSoul/2026-09-14/Ha", "Light_Heart_300s_Ha", 20, "2026-09-14T20:40:00Z", 300, "Ha", "Heart Nebula", { ra: 38.2, dec: 61.45, rotationDeg: 0 }),
    ...light(A, "Imaging/HeartSoul/2026-09-15/Ha", "Light_Soul_300s_Ha", 18, "2026-09-15T20:40:00Z", 300, "Ha", "Soul Nebula", { ra: 42.8, dec: 60.43, rotationDeg: 0 }),
    // M 31 on Askar FRA400 / ASI2600MM; the 25 Aug session was moved to the OS Trash.
    ...fra("Imaging/M31/2026-08-25/L", "Light_M31_120s_L_test", 8, "2026-08-25T22:00:00Z", 120, "L", "M31", { ra: 10.685, dec: 41.269, rotationDeg: 12 }),
    ...fra("Imaging/M31/2026-09-02/L", "Light_M31_120s_L", 60, "2026-09-02T21:00:00Z", 120, "L", "M31", { ra: 10.685, dec: 41.269, rotationDeg: 12 }),
    ...fra("Imaging/M31/2026-09-03/R", "Light_M31_120s_R", 20, "2026-09-03T21:00:00Z", 120, "R", "M31", { ra: 10.685, dec: 41.269, rotationDeg: 12 }),
    ...fra("Imaging/M31/2026-09-03/G", "Light_M31_120s_G", 20, "2026-09-03T21:50:00Z", 120, "G", "M31", { ra: 10.685, dec: 41.269, rotationDeg: 12 }),
    ...fra("Imaging/M31/2026-09-03/B", "Light_M31_120s_B", 20, "2026-09-03T22:40:00Z", 120, "B", "M31", { ra: 10.685, dec: 41.269, rotationDeg: 12 }),
    // M 33: a confirmed Target that no Project names.
    ...fra("Imaging/M33/2026-08-30/L", "Light_M33_120s_L", 40, "2026-08-30T22:00:00Z", 120, "L", "M33", { ra: 23.462, dec: 30.66, rotationDeg: 0 }),
    // Calibration: raw sets and library masters (day-time sets stay in one night).
    ...calibrationSet("Calibration/Darks/2026-09-08/300s", "Dark_300s_G100", 30, "2026-09-08T14:00:00Z", "dark", 300, null),
    ...calibrationSet("Calibration/Darks/2026-09-08/120s", "Dark_120s_G100", 30, "2026-09-08T17:00:00Z", "dark", 120, null),
    ...calibrationSet("Calibration/Bias/2026-09-08", "Bias_G100", 50, "2026-09-08T18:30:00Z", "bias", 0.000032, null),
    ...calibrationSet("Calibration/Flats/2026-09-19/Ha", "Flat_RedCat_Ha", 30, "2026-09-19T05:20:00Z", "flat", 1.5, "Ha"),
    ...calibrationSet("Calibration/Flats/2026-09-26/OIII", "Flat_RedCat_OIII", 30, "2026-09-27T05:25:00Z", "flat", 2.0, "OIII"),
    ...calibrationSet("Calibration/Flats/2026-09-02/L", "Flat_FRA_L", 20, "2026-09-03T05:00:00Z", "flat", 0.8, "L", FRA400),
    ...calibrationSet("Calibration/Flats/2026-09-02/R", "Flat_FRA_R", 20, "2026-09-03T05:40:00Z", "flat", 1.1, "R", FRA400),
    ...calibrationSet("Calibration/Flats/2026-09-02/G", "Flat_FRA_G", 20, "2026-09-03T05:50:00Z", "flat", 1.0, "G", FRA400),
    ...calibrationSet("Calibration/Flats/2026-09-02/B", "Flat_FRA_B", 20, "2026-09-03T06:00:00Z", "flat", 1.3, "B", FRA400),
    ...calibrationSet("Calibration/Darks/2026-09-10/533-120s", "Dark_533_120s", 20, "2026-09-10T14:00:00Z", "dark", 120, null, ESPRIT),
    ...calibrationSet("Calibration/Darks/2026-09-10/533-300s", "Dark_533_300s", 20, "2026-09-10T16:00:00Z", "dark", 300, null, ESPRIT),
    ...calibrationSet("Calibration/Bias/2026-09-10/533", "Bias_533", 40, "2026-09-10T17:30:00Z", "bias", 0.000032, null, ESPRIT),
    ...calibrationSet("Calibration/Flats/2026-09-22/LeX", "Flat_Esprit_LeX", 25, "2026-09-22T05:30:00Z", "flat", 3.0, "L-eXtreme", ESPRIT),
    masterFile("MasterDark_300s_G100_O50_-10C.xisf", "master-dark", 300, null, "2026-09-08T15:00:00Z"),
    masterFile("MasterBias_G100_O50.xisf", "master-bias", 0.000032, null, "2026-09-08T16:30:00Z"),
  ]
}

/** M 42 on the NAS: the scan that is running when the demo loads (D-W12). */
function nasFiles(): DiskFile[] {
  return captureSet({ volumeId: VOLUME_IDS.nas, dir: "Captures/M42/2025-12-20/L", prefix: "Light_M42_60s_L", count: 90, start: "2025-12-20T23:00:00Z", imageType: "light", exposureS: 60, filter: "L", object: "M42", rig: FRA400, pointing: { ra: 83.82, dec: -5.39, rotationDeg: 0 }, site: SITE_COORDS.lapalma })
}

/** Two new matching NGC 7000 sessions copied into Captures later (prototype control): "Add 2 new sessions". */
export function arrivalFiles(): DiskFile[] {
  return [
    ...light(A, "Captures/NGC7000/2026-10-05/Ha", "Light_NGC7000_300s_Ha", 12, "2026-10-05T19:40:00Z", 300, "Ha", "NGC 7000", { ...NGC7000, rotationDeg: rot }),
    ...light(A, "Captures/NGC7000/2026-10-05/OIII", "Light_NGC7000_300s_OIII", 12, "2026-10-05T21:00:00Z", 300, "OIII", "NGC 7000", { ...NGC7000, rotationDeg: rot }),
  ]
}

/** The ASIAIR SD card the demo's saved source "ASIAIR SD card" points at; not mounted until inserted. */
export const ASIAIR_CARD: Volume = {
  id: VOLUME_IDS.asiair,
  name: "ASIAIR",
  mountPath: MOUNT[VOLUME_IDS.asiair]!,
  volumeUuid: "A51A-0001",
  mounted: true,
  writable: true,
  trash: "supported",
  capacityBytes: 128_000_000_000,
  links: { symlink: false, hardlink: false, clone: false },
  network: false,
}

/**
 * What the ASIAIR wrote last night (S13 Import): new NGC 7000 lights with the
 * last file still being written, flats, a set without IMAGETYP (held as
 * Unclassified), a log file, and the 2 Oct Ha session imported from this card
 * before (byte-identical duplicates of library frames).
 */
export function asiairCardFiles(disk: Disk): DiskFile[] {
  const card = VOLUME_IDS.asiair
  const pointing = { ...NGC7000, rotationDeg: rot }
  const site = SITE_COORDS.backyard
  const files = [
    ...captureSet({ volumeId: card, dir: "Autorun/Light/NGC 7000", prefix: "Light_NGC7000_300s_Ha_20261006", count: 16, start: "2026-10-06T19:30:00Z", imageType: "light", exposureS: 300, filter: "Ha", object: "NGC 7000", rig: REDCAT, pointing, site, growingLast: true }),
    ...captureSet({ volumeId: card, dir: "Autorun/Light/NGC 7000", prefix: "Light_NGC7000_300s_OIII_20261006", count: 12, start: "2026-10-06T21:10:00Z", imageType: "light", exposureS: 300, filter: "OIII", object: "NGC 7000", rig: REDCAT, pointing, site }),
    ...captureSet({ volumeId: card, dir: "Autorun/Flat", prefix: "Flat_RedCat_Ha_20261007", count: 20, start: "2026-10-07T05:20:00Z", imageType: "flat", exposureS: 1.5, filter: "Ha", object: null, rig: REDCAT, pointing: null, site: null }),
    // IMAGETYP missing: the files are held as Unclassified until typed.
    ...captureSet({ volumeId: card, dir: "Plan/M 33", prefix: "Capture_M33_120s_L_20261006", count: 6, start: "2026-10-06T23:40:00Z", imageType: "unknown", exposureS: 120, filter: "L", object: "M 33", rig: REDCAT, pointing: { ra: 23.462, dec: 30.66, rotationDeg: rot }, site, truth: () => ({ starCount: 1700, background: 860, saturatedStars: 1 }) }),
    makeFile({ path: `${ASIAIR_CARD.mountPath}/Log/Autorun_Log_2026-10-06.txt`, volumeId: card, sizeBytes: 48_200, kind: "text", modifiedAt: "2026-10-07T05:40:00Z" }),
  ]
  const earlier = Object.values(disk.files)
    .filter((f) => f.path.startsWith(`${MOUNT[A]}/Captures/NGC7000/2026-10-02/Ha/`))
    .map((f) => ({ ...f, volumeId: card, path: `${ASIAIR_CARD.mountPath}/Autorun/Light/NGC 7000/${f.path.slice(f.path.lastIndexOf("/") + 1)}`, inode: f.inode + 7 }))
  return [...files, ...earlier]
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

/** Application bundles on the simulated computer (PREP-FR-01). */
function simulatedApps(): SimulatedApp[] {
  return [
    { id: "app_pixinsight", name: "PixInsight", path: "/Applications/PixInsight/PixInsight.app", present: true, launchFails: false },
    { id: "app_siril", name: "Siril", path: "/Applications/Siril.app", present: true, launchFails: false },
    { id: "app_seti", name: "SETI Astro Suite Pro", path: "/Applications/SetiAstroSuitePro.app", present: true, launchFails: false },
    { id: "app_astap", name: "ASTAP", path: "/Applications/ASTAP.app", present: true, launchFails: false },
  ]
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
    sites: {},
    projects: {},
    runs: {},
    runGroups: {},
    goalTemplates: {},
    measurements: {},
    measurementImports: {},
    masters: {},
    profiles: builtInProfiles(),
    preparations: {},
    results: {},
    trashEpisodes: {},
    importSources: {},
    plans: {},
    reminders: { enabled: false, siteId: null, leadTimeMin: null, permission: "not-requested", deliveredWindowKeys: [], enabledAt: null },
    calendarExports: [],
  }
}

export function defaultSettings(): AppSettings {
  return {
    defaultSiteId: null,
    planningSiteId: null,
    onboarding: { completedAt: null, deferredRoles: [] },
    lastOutputParent: null,
    naming: {},
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
    slowIndexing: false,
    clockOffsetMs: 0,
    noSite: false,
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

/** Empty folders the flows need before anything writes into them. */
const EXPLICIT_FOLDERS = [
  { volumeId: A, path: "/Volumes/Astro-T7/Processing" },
  { volumeId: A, path: "/Volumes/Astro-T7/Library" },
  { volumeId: VOLUME_IDS.archive, path: "/Volumes/Archive/Library" },
  { volumeId: VOLUME_IDS.spare, path: "/Volumes/Spare/Captures" },
]

function diskOf(files: DiskFile[], coldMounted: boolean, deniedPaths: string[]): Disk {
  return {
    volumes: buildVolumes(coldMounted),
    files: Object.fromEntries(files.map((f) => [fileKey(f.volumeId, f.path), f])),
    folders: EXPLICIT_FOLDERS.map((f) => ({ ...f })),
    deniedPaths,
    readOnlyPaths: [],
    trash: [],
    apps: simulatedApps(),
  }
}

/** First run: the disk exists, the catalog is empty, onboarding starts. */
function emptySeed(): SeedData {
  return {
    seed: "empty",
    // The calibration folder starts access-denied; Cold-1 is connected.
    disk: diskOf([...baseFiles(), ...nasFiles()], true, ["/Volumes/Astro-T7/Calibration"]),
    catalog: emptyCatalog(),
    operations: {},
    activity: [],
    settings: defaultSettings(),
    faults: defaultFaults(),
  }
}

function location(id: string, displayName: string, path: string, volumeId: VolumeId, role: Location["role"]): Location {
  return { id, displayName, path, volumeId, role, registeredAt: "2026-09-01T18:00:00.000Z", access: "unknown", lastIndexedAt: null, scanScope: "never", unreadablePaths: [], lastScanOperationId: null }
}

function findSession(catalog: Catalog, predicate: (s: Session) => boolean): Session {
  const session = Object.values(catalog.sessions).find(predicate)
  if (!session) throw new Error("Demo seed: expected session not found")
  return session
}

// ---------------------------------------------------------------------------
// Demo
// ---------------------------------------------------------------------------

const RIG = { redcat: "otr_redcat", esprit: "otr_esprit", fra: "otr_fra400" } as const
const PROJECT = { cygnus: "prj_cygnus", m31: "prj_m31", heart: "prj_heart" } as const
const PROCESSING = "/Volumes/Astro-T7/Processing"

function equipment(catalog: Catalog) {
  catalog.cameras = {
    cam_2600: { id: "cam_2600", name: "ASI2600MM Pro", aliases: ["ZWO ASI2600MM Pro"], source: "manual", widthPx: 6248, heightPx: 4176, pixelSizeUm: 3.76, kind: "mono" },
    cam_533: { id: "cam_533", name: "ASI533MC Pro", aliases: ["ZWO ASI533MC Pro"], source: "manual", widthPx: 3008, heightPx: 3008, pixelSizeUm: 3.76, kind: "osc" },
  }
  catalog.telescopes = {
    tel_redcat: { id: "tel_redcat", name: "RedCat 51", aliases: ["William Optics RedCat 51"], source: "manual", focalLengthMm: 250, apertureMm: 51 },
    tel_esprit: { id: "tel_esprit", name: "Esprit 100", aliases: ["SkyWatcher Esprit 100ED"], source: "manual", focalLengthMm: 550, apertureMm: 100 },
    tel_fra400: { id: "tel_fra400", name: "Askar FRA400", aliases: ["FRA400"], source: "manual", focalLengthMm: 400, apertureMm: 72 },
  }
  const flt = (rig: string, name: string, bands: Array<"L" | "R" | "G" | "B" | "Ha" | "SII" | "OIII">, matches: string[] = [name]) => ({ id: `flt_${rig}_${name.toLowerCase().replace(/[^a-z0-9]/g, "")}`, name, matches, bands })
  catalog.opticalTrains = {
    [RIG.redcat]: {
      id: RIG.redcat, name: "RedCat 51 / ASI2600MM", source: "manual", cameraId: "cam_2600", telescopeId: "tel_redcat", effectiveFocalLengthMm: 250, notes: "",
      filters: [flt("redcat", "Ha", ["Ha"], ["Ha", "H-alpha"]), flt("redcat", "OIII", ["OIII"], ["OIII", "O3"]), flt("redcat", "SII", ["SII"], ["SII", "S2"])],
    },
    [RIG.esprit]: {
      id: RIG.esprit, name: "Esprit 100 / ASI533MC", source: "manual", cameraId: "cam_533", telescopeId: "tel_esprit", effectiveFocalLengthMm: 550, notes: "",
      filters: [flt("esprit", "L-eXtreme", ["Ha", "OIII"], ["L-eXtreme", "LeXtreme"])],
    },
    [RIG.fra]: {
      id: RIG.fra, name: "Askar FRA400 / ASI2600MM", source: "manual", cameraId: "cam_2600", telescopeId: "tel_fra400", effectiveFocalLengthMm: 400, notes: "",
      filters: [flt("fra", "L", ["L"], ["L", "Lum"]), flt("fra", "R", ["R"]), flt("fra", "G", ["G"]), flt("fra", "B", ["B"]), flt("fra", "Ha", ["Ha"])],
    },
  }
}

const decided = (asset: Asset, value: "usable" | "unusable", at = "2026-09-29T10:00:00.000Z"): Asset => ({ ...asset, quality: { value, decidedAt: at, basisSha256: asset.sha256 } })

function confirm(catalog: Catalog, session: Session, targetId: string | null, rigId: string | null) {
  catalog.sessions[session.id] = {
    ...session,
    target: targetId ? { ...session.target, value: targetId, status: "confirmed", confirmedAt: "2026-09-29T09:00:00.000Z" } : session.target,
    equipment: rigId ? { ...session.equipment, value: rigId, status: "confirmed", confirmedAt: "2026-09-29T09:00:00.000Z" } : session.equipment,
  }
}

function revision(content: ReturnType<typeof emptyContent>, savedAt: string, accepted: string[]): MembershipRevision {
  return { ...content, revision: 1, savedAt, accepted }
}

function run(fields: Pick<Run, "id" | "name" | "projectId" | "subjectId" | "rigId"> & Partial<Run>): Run {
  return {
    panelId: null,
    groupId: null,
    setup: { profileId: PROFILE_IDS.pixinsight, inputMode: "linked", calibrationPolicy: "automatic" },
    revisions: [],
    draft: null,
    calibration: [],
    masterOffers: [],
    outputParent: PROCESSING,
    completion: "open",
    completedAt: null,
    stageBeforeComplete: null,
    trashedAt: null,
    notes: "",
    createdAt: "2026-09-29T12:00:00.000Z",
    revision: 1,
    ...fields,
  }
}

interface Prepared {
  record: Preparation
  files: DiskFile[]
}

/** A linked preparation: one symlink per included frame under `<folder>/lights/` (PREP-FR-04). */
function linkedPreparation(catalog: Catalog, r: Run, folderPath: string, resultsPath: string, assetIds: AssetId[], at: string, extra: Partial<Preparation> = {}): Prepared {
  const files = assetIds.map((id) => {
    const asset = catalog.assets[id]!
    return makeFile({ path: `${folderPath}/lights/${asset.fileName}`, volumeId: A, sizeBytes: 0, kind: "fits", linkTarget: asset.copies[0]!.path, modifiedAt: at })
  })
  const record: Preparation = {
    id: `prep_${r.id}`,
    runId: r.id,
    groupId: r.groupId,
    prepRevision: 1,
    membershipRevision: 1,
    profileId: PROFILE_IDS.pixinsight,
    mode: "linked",
    linkType: "symlink",
    folderPath,
    resultsPath,
    entryCount: assetIds.length,
    footprintBytes: 0,
    state: "prepared",
    operationId: null,
    preparedAssetIds: assetIds,
    preparedResultIds: [],
    blocked: [],
    metadataDecisions: [],
    launches: [{ at, outcome: "opened" }],
    unverified: null,
    createdAt: at,
    settledAt: at,
    ...extra,
  }
  return { record, files }
}

function resultFile(path: string, at: string, sizeBytes = 104_390_000, kind: DiskFile["kind"] = "xisf"): DiskFile {
  return makeFile({ path, volumeId: A, sizeBytes, kind, modifiedAt: at })
}

function resultRecord(id: string, r: Run, file: DiskFile, kind: ResultKind | null, channel: string | null, fields: Partial<ResultRecord> = {}): ResultRecord {
  return {
    id,
    runId: r.id,
    groupId: r.groupId,
    path: file.path,
    kind,
    channel,
    intermediate: false,
    discovered: "results-folder",
    fromPrepRevision: 1,
    processingState: "written",
    association: "tool-recorded",
    lineage: "tool-recorded",
    acceptance: "candidate",
    acceptedAt: null,
    sha256: file.sha256,
    contentState: "unchanged",
    trashed: null,
    ...fields,
  }
}

/** Demo: the harness v5 review library. */
function demoSeed(): SeedData {
  const files = [...baseFiles(), ...nasFiles()]
  // M 31 R and G frames also sit on Spare: byte-identical duplicate copies (D-W74).
  const duplicates = files
    .filter((f) => f.path.includes("/Imaging/M31/2026-09-03/R/") || f.path.includes("/Imaging/M31/2026-09-03/G/"))
    .map((f) => ({ ...f, volumeId: VOLUME_IDS.spare, path: f.path.replace("/Volumes/Astro-T7/Imaging", "/Volumes/Spare/Captures"), inode: f.inode + 1 }))
  let disk = diskOf([...files, ...duplicates], true, [])
  let catalog = emptyCatalog()
  equipment(catalog)
  catalog.sites = {
    site_backyard: { id: "site_backyard", name: "Backyard", latitude: 52.09, longitude: 5.12, elevationM: 5, timeZone: "Europe/Amsterdam", twilight: "astronomical", minAltitudeDeg: 25 },
    site_lapalma: { id: "site_lapalma", name: "La Palma", latitude: 28.76, longitude: -17.88, elevationM: 2300, timeZone: "Atlantic/Canary", twilight: "astronomical", minAltitudeDeg: 20 },
  }
  catalog.locations = {
    loc_captures: location("loc_captures", "Astro-T7 captures", "/Volumes/Astro-T7/Captures", A, "captures"),
    loc_imaging: location("loc_imaging", "Astro-T7 imaging", "/Volumes/Astro-T7/Imaging", A, "captures"),
    loc_cold: location("loc_cold", "Cold-1 captures", "/Volumes/Cold-1/Captures", VOLUME_IDS.cold, "captures"),
    loc_calibration: location("loc_calibration", "Astro-T7 calibration", "/Volumes/Astro-T7/Calibration", A, "calibration"),
    loc_processing: location("loc_processing", "Astro-T7 processing", PROCESSING, A, "results"),
    loc_spare: location("loc_spare", "Spare captures", "/Volumes/Spare/Captures", VOLUME_IDS.spare, "captures"),
    loc_archive: location("loc_archive", "Archive", "/Volumes/Archive", VOLUME_IDS.archive, "archive"),
    loc_nas: location("loc_nas", "NAS captures", "/Volumes/NAS/Captures", VOLUME_IDS.nas, "captures"),
  }
  catalog = indexLocationsSync(catalog, disk, ["loc_cold"], "2026-09-13T08:00:00.000Z")
  catalog = indexLocationsSync(catalog, disk, ["loc_captures", "loc_imaging", "loc_calibration", "loc_spare", "loc_archive"], "2026-10-04T08:00:00.000Z")

  const session = (night: string, channel: string, predicate: (s: Session) => boolean = () => true) =>
    findSession(catalog, (s) => s.imageType === "light" && s.night === night && s.channel === channel && predicate(s))
  const ngc = catalog.sessions[session("2026-09-18", "Ha").id]!.target.value!
  const ic5070Target = ensureTarget(catalog, "tgt_ic5070", "IC 5070", ["Pelican Nebula", "IC5070"], IC5070.ra, IC5070.dec, { width: 1.0, height: 0.8 })
  const m31 = session("2026-09-02", "L").target.value!
  const heartIds = [session("2026-09-14", "Ha", (s) => s.objectLabel === "Heart Nebula"), session("2026-09-15", "Ha")]

  const s = {
    oiii0912: session("2026-09-12", "OIII"),
    ha0918: session("2026-09-18", "Ha"),
    oiii0924: session("2026-09-24", "OIII"),
    cygnus0926: session("2026-09-26", "OIII"),
    ha0928: session("2026-09-28", "Ha"),
    oiii0930: session("2026-09-30", "OIII"),
    ha1002: session("2026-10-02", "Ha"),
    unsorted: session("2026-09-22", "Ha"),
    osc0921: session("2026-09-21", "L-eXtreme"),
    osc1001: session("2026-10-01", "L-eXtreme"),
    p1ha: session("2026-09-13", "Ha"),
    p1oiii: session("2026-09-14", "OIII"),
    p2ha: session("2026-09-16", "Ha"),
    p2oiii: session("2026-09-17", "OIII"),
    p3ha: session("2026-09-19", "Ha"),
    flagged: session("2026-09-20", "Ha"),
    m31test: session("2026-08-25", "L"),
    m31: { L: session("2026-09-02", "L"), R: session("2026-09-03", "R"), G: session("2026-09-03", "G"), B: session("2026-09-03", "B") },
    m33: session("2026-08-30", "L"),
  }

  // Confirmed associations: Targets and rigs the review relies on.
  for (const x of [s.oiii0912, s.ha0918, s.oiii0924, s.oiii0930, s.ha1002]) confirm(catalog, x, ngc, RIG.redcat)
  for (const x of [s.osc0921, s.osc1001]) confirm(catalog, x, ngc, RIG.esprit)
  for (const x of [s.p1ha, s.p1oiii, s.p2ha, s.p2oiii, s.p3ha, s.flagged]) confirm(catalog, x, ic5070Target, RIG.redcat)
  for (const x of heartIds) confirm(catalog, x, x.target.value, RIG.redcat)
  for (const x of [s.m31test, s.m31.L, s.m31.R, s.m31.G, s.m31.B]) confirm(catalog, x, m31, RIG.fra)
  confirm(catalog, s.m33, s.m33.target.value, RIG.fra)
  // Rig confirmed, Target still unresolved or in review: these sessions need a Target.
  confirm(catalog, s.cygnus0926, null, RIG.redcat)
  confirm(catalog, s.unsorted, null, RIG.redcat)

  // Library quality: reviewed sessions are Usable; M 31 L has five Unusable frames.
  const reviewed = [s.ha0918, s.oiii0924, s.osc0921, s.p1ha, s.p1oiii, s.p2ha, s.p2oiii, s.p3ha, s.m31.R, s.m31.G, s.m31.B]
  for (const x of reviewed) for (const id of x.assetIds) catalog.assets[id] = decided(catalog.assets[id]!, "usable")
  const unusableL = new Set([2, 16, 28, 43, 57])
  s.m31.L.assetIds.forEach((id, index) => {
    catalog.assets[id] = decided(catalog.assets[id]!, unusableL.has(index) ? "unusable" : "usable")
  })
  // Cached measurements for the M 31 broadband frames.
  const scale = pixelScaleArcsec(3.76, 400)
  for (const x of [s.m31.L, s.m31.R, s.m31.G, s.m31.B]) {
    for (const id of x.assetIds) {
      const asset = catalog.assets[id]!
      catalog.measurements[id] = simulateMeasurement(asset, fileAt(disk, asset.copies[0]!.path), scale, "2026-09-06T11:00:00.000Z")
    }
  }

  // Targets: favourites and a southern Target with no window tonight.
  for (const id of [m31, s.m33.target.value!]) catalog.targets[id] = { ...catalog.targets[id]!, favourite: true }
  const tuc = ensureTarget(catalog, "tgt_ngc104", "NGC 104", ["47 Tucanae", "Caldwell 106"], 6.024, -72.081, { width: 0.5, height: 0.5 })
  catalog.targets[tuc] = { ...catalog.targets[tuc]!, favourite: true }

  // Projects.
  const subject = (id: string, targetId: string, mosaic: Subject["mosaic"] = null): Subject => ({ id, targetId, mosaic })
  const ngcSubject = subject("sub_ngc7000", ngc)
  const mosaicSubject = subject("sub_ic5070", ic5070Target, {
    name: "IC 5070 mosaic",
    centre: { ...IC5070 },
    panels: PANEL_DEC.map((dec, i) => ({ id: `pnl_${i + 1}`, n: i + 1, ra: IC5070.ra, dec, rotationDeg: 0 })),
  })
  const goal = (id: string, subjectId: string, channel: string, hours: number, panelId: string | null = null): Goal => ({ id, subjectId, panelId, channel, integrationS: hours * 3600, frameCount: null, qualityBar: null })
  catalog.projects = {
    [PROJECT.cygnus]: {
      id: PROJECT.cygnus,
      name: "Cygnus HOO 2026",
      notes: "Wide HOO of the North America and Pelican region; the OSC rig adds dual-band data.",
      subjects: [ngcSubject, mosaicSubject],
      rigIds: [RIG.redcat, RIG.esprit],
      goals: [
        goal("goal_ngc_ha", ngcSubject.id, "Ha", 10),
        goal("goal_ngc_oiii", ngcSubject.id, "OIII", 10),
        ...mosaicSubject.mosaic!.panels.flatMap((p) => [goal(`goal_${p.id}_ha`, mosaicSubject.id, "Ha", 4, p.id), goal(`goal_${p.id}_oiii`, mosaicSubject.id, "OIII", 4, p.id)]),
      ],
      goalTemplateId: "gtpl_hoo",
      state: "open",
      doneAt: null,
      archive: null,
      rejections: {},
      createdAt: "2026-09-10T19:00:00.000Z",
      revision: 3,
    },
    [PROJECT.m31]: {
      id: PROJECT.m31,
      name: "M 31 LRGB",
      notes: "Broadband first; narrowband blend later.",
      subjects: [subject("sub_m31", m31)],
      rigIds: [RIG.fra],
      goals: [goal("goal_m31_l", "sub_m31", "L", 2), goal("goal_m31_r", "sub_m31", "R", 0.5), goal("goal_m31_g", "sub_m31", "G", 0.5), goal("goal_m31_b", "sub_m31", "B", 0.5)],
      goalTemplateId: "gtpl_lrgb",
      state: "done",
      doneAt: "2026-09-12T09:00:00.000Z",
      archive: null,
      rejections: {},
      createdAt: "2026-09-01T19:00:00.000Z",
      revision: 4,
    },
    [PROJECT.heart]: {
      id: PROJECT.heart,
      name: "Heart and Soul",
      notes: "Ha first; OIII when the Moon allows.",
      subjects: heartIds.map((x, i) => subject(`sub_heart_${i + 1}`, catalog.sessions[x.id]!.target.value!)),
      rigIds: [RIG.redcat],
      goals: heartIds.flatMap((_, i) => [goal(`goal_heart_${i + 1}_ha`, `sub_heart_${i + 1}`, "Ha", 10), goal(`goal_heart_${i + 1}_oiii`, `sub_heart_${i + 1}`, "OIII", 10)]),
      goalTemplateId: "gtpl_hoo",
      state: "open",
      doneAt: null,
      archive: null,
      rejections: {},
      createdAt: "2026-09-14T19:00:00.000Z",
      revision: 1,
    },
  }

  // Memberships are read while Cold-1 is still connected, so its frames were included when saved.
  const candidate = (x: Session, rig: string, subjectName: string): { session: Session; reason: SelectionReason } => ({
    session: catalog.sessions[x.id]!,
    reason: { kind: "candidate", detail: `Target ${subjectName} on ${catalog.opticalTrains[rig]!.name}` },
  })
  const panelReason = (x: Session, n: number): { session: Session; reason: SelectionReason } => ({
    session: catalog.sessions[x.id]!,
    reason: { kind: "panel-pointing", detail: `Target IC 5070 mosaic on RedCat 51 / ASI2600MM · Pointing inside Panel ${n}` },
  })
  const content = (items: Array<{ session: Session; reason: SelectionReason }>) => addSessions(emptyContent(), disk, catalog, items)

  const runA = run({
    id: "run_ngc_hoo",
    name: "NGC 7000 HOO RedCat",
    projectId: PROJECT.cygnus,
    subjectId: ngcSubject.id,
    rigId: RIG.redcat,
    revisions: [revision(content([candidate(s.ha0918, RIG.redcat, "NGC 7000"), candidate(s.oiii0924, RIG.redcat, "NGC 7000")]), "2026-09-29T12:30:00.000Z", ["Added 18 Sep Ha, 24 Sep OIII"])],
    completion: "complete",
    completedAt: "2026-10-03T21:00:00.000Z",
    stageBeforeComplete: "results",
    createdAt: "2026-09-29T12:00:00.000Z",
  })
  const runB = run({
    id: "run_ngc_oiii",
    name: "NGC 7000 OIII deep",
    projectId: PROJECT.cygnus,
    subjectId: ngcSubject.id,
    rigId: RIG.redcat,
    setup: { profileId: null, inputMode: null, calibrationPolicy: "automatic" },
    revisions: [revision(content([candidate(s.oiii0930, RIG.redcat, "NGC 7000")]), "2026-10-01T09:00:00.000Z", ["Added 30 Sep OIII"])],
    createdAt: "2026-10-01T08:50:00.000Z",
  })
  const runC = run({
    id: "run_ngc_osc",
    name: "NGC 7000 dual-band Esprit",
    projectId: PROJECT.cygnus,
    subjectId: ngcSubject.id,
    rigId: RIG.esprit,
    setup: { profileId: PROFILE_IDS.siril, inputMode: "linked", calibrationPolicy: "automatic" },
    revisions: [revision(content([candidate(s.osc0921, RIG.esprit, "NGC 7000")]), "2026-09-30T20:00:00.000Z", ["Added 21 Sep L-eXtreme"])],
    createdAt: "2026-09-30T19:40:00.000Z",
  })
  const runD = run({
    id: "run_ngc_test",
    name: "NGC 7000 Ha quick look",
    projectId: PROJECT.cygnus,
    subjectId: ngcSubject.id,
    rigId: RIG.redcat,
    revisions: [revision(content([candidate(s.ha0918, RIG.redcat, "NGC 7000")]), "2026-09-25T20:00:00.000Z", ["Added 18 Sep Ha"])],
    trashedAt: "2026-09-30T08:00:00.000Z",
    createdAt: "2026-09-25T19:50:00.000Z",
  })
  const group: RunGroup = {
    id: "grp_ic5070",
    name: "IC 5070 mosaic",
    projectId: PROJECT.cygnus,
    subjectId: mosaicSubject.id,
    rigId: RIG.redcat,
    runIds: ["run_ic5070_p1", "run_ic5070_p2", "run_ic5070_p3"],
    setup: { profileId: PROFILE_IDS.pixinsight, inputMode: "linked", calibrationPolicy: "automatic" },
    outputParent: PROCESSING,
    createdAt: "2026-09-27T18:00:00.000Z",
    revision: 1,
  }
  const panelRun = (n: number, sessions: Session[], extra: Partial<Run> = {}) =>
    run({
      id: `run_ic5070_p${n}`,
      name: `IC 5070 mosaic Panel ${n}`,
      projectId: PROJECT.cygnus,
      subjectId: mosaicSubject.id,
      rigId: RIG.redcat,
      panelId: `pnl_${n}`,
      groupId: group.id,
      setup: null,
      revisions: [revision(content(sessions.map((x) => panelReason(x, n))), "2026-09-27T18:30:00.000Z", [`Added ${plural(sessions.length, "session")} by pointing`])],
      createdAt: "2026-09-27T18:00:00.000Z",
      ...extra,
    })
  const p1 = panelRun(1, [s.p1ha, s.p1oiii])
  const p2 = panelRun(2, [s.p2ha, s.p2oiii])
  const p3 = panelRun(3, [s.p3ha], { trashedAt: "2026-10-02T09:00:00.000Z" })
  const m31Run = run({
    id: "run_m31",
    name: "M 31 LRGB FRA400",
    projectId: PROJECT.m31,
    subjectId: "sub_m31",
    rigId: RIG.fra,
    revisions: [revision(content([s.m31.L, s.m31.R, s.m31.G, s.m31.B].map((x) => candidate(x, RIG.fra, "M 31"))), "2026-09-07T17:50:00.000Z", ["Added 2 Sep L, 3 Sep R, G and B"])],
    completion: "complete",
    completedAt: "2026-09-10T08:00:00.000Z",
    stageBeforeComplete: "results",
    createdAt: "2026-09-07T17:30:00.000Z",
  })

  // Preparations and Results on disk.
  const cygnus = `${PROCESSING}/Cygnus HOO 2026`
  const prepA = linkedPreparation(catalog, runA, `${cygnus}/${runA.name}`, `${cygnus}/${runA.name} Results`, runA.revisions[0]!.included, "2026-09-29T13:00:00.000Z")
  const prepD = linkedPreparation(catalog, runD, `${cygnus}/${runD.name}`, `${cygnus}/${runD.name} Results`, runD.revisions[0]!.included, "2026-09-25T20:30:00.000Z")
  const prepP1 = linkedPreparation(catalog, p1, `${cygnus}/IC 5070 mosaic/Panel 1`, `${cygnus}/IC 5070 mosaic Results/Panel 1`, p1.revisions[0]!.included, "2026-09-27T19:00:00.000Z")
  // Panel 2: the Ha frames on Cold-1 could not be read: the preparation is Partial.
  const p2Included = p2.revisions[0]!.included
  const p2Offline = p2Included.filter((id) => catalog.assets[id]!.copies[0]!.volumeId === VOLUME_IDS.cold)
  const p2Ready = p2Included.filter((id) => !p2Offline.includes(id))
  const prepP2 = linkedPreparation(catalog, p2, `${cygnus}/IC 5070 mosaic/Panel 2`, `${cygnus}/IC 5070 mosaic Results/Panel 2`, p2Ready, "2026-09-27T19:05:00.000Z", {
    entryCount: p2Included.length,
    state: "partial",
    launches: [],
    blocked: p2Offline.map((id) => ({ input: { kind: "asset" as const, assetId: id }, path: catalog.assets[id]!.copies[0]!.path, reason: "Offline: Cold-1 is not connected" })),
  })
  const m31Path = `${PROCESSING}/M 31 LRGB/${m31Run.name}`
  const prepM31 = linkedPreparation(catalog, m31Run, m31Path, `${m31Path} Results`, m31Run.revisions[0]!.included, "2026-09-07T18:00:00.000Z")
  catalog.preparations = Object.fromEntries([prepA, prepD, prepP1, prepP2, prepM31].map((p) => [p.record.id, p.record]))

  const resultsA = `${cygnus}/${runA.name} Results`
  const masterLight = (dir: string, channel: string, when: string) => resultFile(`${dir}/master/masterLight_BIN-1_FILTER-${channel}.xisf`, when)
  const aFiles = {
    ha: masterLight(resultsA, "Ha", "2026-10-01T22:00:00.000Z"),
    oiii: masterLight(resultsA, "OIII", "2026-10-01T22:10:00.000Z"),
    final: resultFile(`${resultsA}/NGC7000-HOO.tif`, "2026-10-03T20:00:00.000Z", 156_500_000, "tiff"),
    flat: masterFile("masterFlat_BIN-1_FILTER-Ha.xisf", "master-flat", 1.5, "Ha", "2026-10-01T21:40:00.000Z", A, `Processing/Cygnus HOO 2026/${runA.name} Results/master`),
  }
  const m31Results = `${m31Path} Results`
  const m31Final = resultFile(`${m31Results}/M31-LRGB.tif`, "2026-09-09T21:00:00.000Z", 156_500_000, "tiff")
  const m31Masters = (["L", "R", "G", "B"] as const).map((c) => masterLight(m31Results, c, "2026-09-07T20:30:00.000Z"))
  const m31Intermediates = s.m31.L.assetIds.slice(0, 12).flatMap((id) => {
    const stem = catalog.assets[id]!.fileName.replace(/\.fits$/, "")
    return [resultFile(`${m31Results}/calibrated/${stem}_c.xisf`, "2026-09-07T19:00:00.000Z"), resultFile(`${m31Results}/registered/${stem}_c_r.xisf`, "2026-09-07T19:40:00.000Z")]
  })
  const resultsD = resultFile(`${cygnus}/${runD.name} Results/master/masterLight_BIN-1_FILTER-Ha.xisf`, "2026-09-26T21:00:00.000Z")
  disk = writeFiles(disk, [...prepA.files, ...prepD.files, ...prepP1.files, ...prepP2.files, ...prepM31.files, ...Object.values(aFiles), m31Final, ...m31Masters, ...m31Intermediates, resultsD])

  const accepted = (when: string): Partial<ResultRecord> => ({ acceptance: "accepted", acceptedAt: when })
  const results: ResultRecord[] = [
    resultRecord("res_ngc_ha", runA, aFiles.ha, "linear-integration", "Ha", accepted("2026-10-02T09:00:00.000Z")),
    resultRecord("res_ngc_oiii", runA, aFiles.oiii, "linear-integration", "OIII", accepted("2026-10-02T09:00:00.000Z")),
    resultRecord("res_ngc_final", runA, aFiles.final, "final-image", null, { ...accepted("2026-10-03T20:30:00.000Z"), discovered: "attached", association: "user-linked", lineage: "unknown" }),
    resultRecord("res_m31_final", m31Run, m31Final, "final-image", null, accepted("2026-09-09T21:10:00.000Z")),
    ...m31Masters.map((f, i) => resultRecord(`res_m31_${"lrgb"[i]}`, m31Run, f, "linear-integration", "LRGB"[i]!, accepted("2026-09-08T09:00:00.000Z"))),
    ...m31Intermediates.map((f, i) => resultRecord(`res_m31_int_${i + 1}`, m31Run, f, null, "L", { intermediate: true })),
    resultRecord("res_ngc_test", runD, resultsD, "linear-integration", "Ha"),
  ]
  catalog.results = Object.fromEntries(results.map((r) => [r.id, r]))
  // A master flat found in Run A's Results: a candidate master, offered once (D-W5, D-W55).
  const flatMasterId = `mst_${stableHash(aFiles.flat.path)}`
  catalog.masters[flatMasterId] = {
    id: flatMasterId, kind: "flat", path: aFiles.flat.path, cameraName: REDCAT.instrument, widthPx: REDCAT.widthPx, heightPx: REDCAT.heightPx, binning: 1, gain: REDCAT.gain, offset: REDCAT.offset,
    exposureS: null, channel: "Ha", opticalTrainId: RIG.redcat, ccdTempC: REDCAT.ccdTempC, frameCount: 30, createdAt: aFiles.flat.modifiedAt, state: "candidate",
    origin: { kind: "generated", runId: runA.id, sourcePath: aFiles.flat.path }, adoption: null,
  }
  runA.masterOffers = [{ masterId: flatMasterId, state: "pending", at: "2026-10-02T09:00:00.000Z" }]

  catalog.runs = Object.fromEntries([runA, runB, runC, runD, p1, p2, p3, m31Run].map((r) => [r.id, r]))
  catalog.runGroups = { [group.id]: group }

  // The 25 Aug M 31 test session was moved to the OS Trash from M 31's Done / Archive sheet.
  const episodeId = "trash_m31_test"
  const trashAt = "2026-09-12T09:30:00.000Z"
  const episodeItems = s.m31test.assetIds.map((id) => {
    const asset = catalog.assets[id]!
    const copy = asset.copies[0]!
    return { path: copy.path, volumeId: copy.volumeId, sizeBytes: asset.sizeBytes, assetId: id, resultId: null, outcome: "trashed" as const, reason: null }
  })
  for (const item of episodeItems) {
    const file = disk.files[fileKey(item.volumeId, item.path)]!
    disk = { ...disk, files: Object.fromEntries(Object.entries(disk.files).filter(([key]) => key !== fileKey(item.volumeId, item.path))), trash: [...disk.trash, { file, originalPath: item.path, trashedAt: trashAt }] }
    catalog.assets[item.assetId] = { ...decided(catalog.assets[item.assetId]!, "unusable", "2026-09-06T10:00:00.000Z"), trashed: { at: trashAt, episodeId } }
  }
  catalog.trashEpisodes = { [episodeId]: { id: episodeId, kind: "rejected-frames", at: trashAt, projectId: PROJECT.m31, runIds: [], items: episodeItems, operationId: null } }

  // One drifted-content frame: an M 31 L frame changed on disk after review (LIB-FR-09).
  const driftedId = s.m31.L.assetIds[6]!
  const drifted = catalog.assets[driftedId]!
  const driftedPath = drifted.copies[0]!.path
  const driftedSha = fakeSha256(driftedPath, 1)
  disk.files[fileKey(A, driftedPath)] = { ...fileAt(disk, driftedPath)!, sha256: driftedSha, modifiedAt: "2026-09-20T22:14:00Z" }
  catalog.assets[driftedId] = { ...drifted, sha256: driftedSha, copies: drifted.copies.map((c) => ({ ...c, sha256: driftedSha })) }

  // Cold-1 was disconnected after its sessions were saved into runs.
  disk.volumes[VOLUME_IDS.cold] = { ...disk.volumes[VOLUME_IDS.cold]!, mounted: false }

  // A saved Import source for "Import new" (STO-IMP-FR-01).
  catalog.importSources = { src_sd: { id: "src_sd", name: "ASIAIR SD card", path: "/Volumes/ASIAIR", lastImportedAt: "2026-10-03T08:00:00.000Z", importedSha256: [] } }

  const cleanupM31: Operation = {
    id: "op_cleanup_m31",
    kind: "cleanup",
    title: `Clean up ${m31Run.name}`,
    status: "succeeded",
    scope: { runIds: [m31Run.id], projectId: PROJECT.m31 },
    progress: { done: m31Run.revisions[0]!.included.length, total: m31Run.revisions[0]!.included.length, unit: "entries" },
    items: [],
    summary: `${plural(m31Run.revisions[0]!.included.length, "prepared link")} moved to the OS Trash. Sources, Results and library frames unchanged.`,
    canPause: false,
    canCancel: false,
    payload: {},
    createdAt: "2026-09-10T08:30:00.000Z",
    updatedAt: "2026-09-10T08:31:00.000Z",
    settledAt: "2026-09-10T08:31:00.000Z",
  }
  // The M 31 run's prepared links were cleaned up.
  for (const file of prepM31.files) delete disk.files[fileKey(file.volumeId, file.path)]
  // Refusals the Done / Archive sheet shows: one rejected M 31 L frame and one duplicate copy of an R frame
  // on Spare lost write permission, so each offer lists a refused item with its reason (D-W57).
  const lockedReject = catalog.assets[s.m31.L.assetIds[2]!]?.copies[0]?.path
  const lockedDuplicate = s.m31.R.assetIds.map((id) => catalog.assets[id]?.copies.find((c) => c.path.startsWith("/Volumes/Spare/"))?.path).find((p) => p !== undefined)
  disk = { ...disk, readOnlyPaths: [lockedReject, lockedDuplicate].filter((p): p is string => p !== undefined) }

  // The NAS scan is running when the demo loads; it reads one file at a time (D-W12).
  const nasPending = nasFiles().map((f) => f.path)
  const scan: Operation = {
    id: "op_index_nas",
    kind: "index",
    title: "Index NAS captures",
    status: "running",
    scope: { locationIds: ["loc_nas"] },
    progress: { done: 0, total: nasPending.length, unit: "files" },
    items: [{ id: "loc_nas", label: "NAS captures", path: "/Volumes/NAS/Captures", status: "running", phase: null, detail: `${nasPending.length} files to read` }],
    summary: null,
    canPause: true,
    canCancel: true,
    payload: { queue: [], current: { locationId: "loc_nas", pending: nasPending, observed: [] }, counts: { discovered: nasPending.length, read: 0, unsupported: 0, unreadableFolders: 0 } },
    createdAt: "2026-10-04T07:58:00.000Z",
    updatedAt: "2026-10-04T07:58:00.000Z",
    settledAt: null,
  }

  const settings = defaultSettings()
  settings.onboarding = { completedAt: "2026-09-01T18:12:00.000Z", deferredRoles: [] }
  settings.defaultSiteId = "site_backyard"
  settings.lastOutputParent = PROCESSING
  const activity: ActivityEvent[] = [
    { id: "act_trash_m31", at: trashAt, kind: "operation", title: "Move 8 rejected frames to Trash: finished", detail: "8 frames (M 31 25 Aug L) moved to the OS Trash. Put back plus a rescan restores them as Unusable.", operationId: null, href: `/projects/${PROJECT.m31}` },
    { id: "act_cleanup_m31", at: cleanupM31.settledAt!, kind: "operation", title: `${cleanupM31.title}: finished`, detail: cleanupM31.summary, operationId: cleanupM31.id, href: `/projects/${PROJECT.m31}/runs/${m31Run.id}/done` },
    { id: "act_prep_p2", at: "2026-09-27T19:06:00.000Z", kind: "operation", title: "Prepare IC 5070 mosaic Panel 2: partial", detail: `${plural(p2Offline.length, "input")} offline on Cold-1; ${plural(p2Ready.length, "entry", "entries")} prepared.`, operationId: null, href: `/projects/${PROJECT.cygnus}/runs/${p2.id}/prepare` },
  ]
  return { seed: "demo", disk, catalog, operations: { [cleanupM31.id]: cleanupM31, [scan.id]: scan }, activity, settings, faults: defaultFaults() }
}

/** A Target record outside the bundled reference objects (or the one indexing created), keyed by `id`. */
function ensureTarget(catalog: Catalog, id: string, name: string, aliases: string[], ra: number, dec: number, sizeDeg: Target["sizeDeg"]): string {
  const existing = Object.values(catalog.targets).find((t) => t.name === name)
  if (existing) return existing.id
  catalog.targets[id] = { id, name, aliases, ra, dec, sizeDeg, coordinateSource: "catalog", resolver: null, notes: "", favourite: false, createdAt: "2026-09-01T18:00:00.000Z", revision: 1 }
  return id
}

export function createSeed(name: SeedName): SeedData {
  return name === "demo" ? demoSeed() : emptySeed()
}
