/**
 * Seeds: `empty` (first run; onboarding starts) and `demo` (harness v5: one
 * library that shows every state the review needs, HARNESS-V5-IA.md § Seed).
 * Both share the same simulated disk so the empty seed can be indexed into
 * the same library through onboarding.
 *
 * Demo contents (F4 Project model):
 * - "Cygnus HOO 2026" (open, Symlinks): NGC 7000 in three groups, RedCat
 *   51 / ASI2600MM, its "Framing 2" (24 Sep, where intake split a session
 *   at a 0.6° re-point) and Esprit 100 / ASI533MC (OSC). Its View is
 *   applied with GROUP_ folders, Darks and Bias per group and the gain in
 *   the light folders' names; since Apply, labelled pending changes wait:
 *   the Project added 30 Sep OIII, the Library rejected three frames and a
 *   late 180 s dark replaced the OSC session's No darks. View holds the
 *   user's notes (unplaced); Output holds a final image, a Copy to Output
 *   and a file still being written; Processing/ holds a generated master
 *   flat whose adoption finds PlateVault's own unregistered copy at its
 *   destination. A "Finish by" goal condition has 12 nights left.
 *   Suggestions: 2 Oct Ha ("Choose its flats first": a new rig version has
 *   no flats), 12 Sep OIII (addable), and sessions still to review.
 * - "IC 5070 mosaic" (open, Copies): three panel groups, per-panel goals
 *   and a season window; Panel 3 joined after the last Apply; View
 *   (previous)/ holds a rewritten copy and two of the user's files, one
 *   kept. Its Panel 2 Ha originals are on Cold-1, which is offline.
 * - "M 31 LRGB" (open, Copies): in Wrap up with Clean up done and Trash and
 *   Archive still to do (rejected frames, Processing files, duplicate
 *   copies); it archives to the NAS archive, not the Default. Its goals use
 *   every kind: integration with an FWHM bar (part of its L frames sit over
 *   the limit: "below bar"), frame counts, Usable only. Its camera is the
 *   second ASI2600MM ("Don't use darks"); a generated master dark was hidden.
 * - "NGC 7000 OIII test" (Closed): its kept Symlinks View, frozen goals and
 *   calibration; its only session is held by no open Project.
 * - "Heart and Soul" (open): no sessions yet, its matches still to review.
 * - Library: sessions that need a Target or calibration, sessions in no
 *   Project, a Trashed session, an offline volume (Cold-1) and a running
 *   scan of a network share; two archive locations (one Default); two
 *   removable devices connected, an ASIAIR card (recognised layout) and a
 *   generic USB stick.
 * - Equipment: two ASI2600MM cameras with physical aliases, RedCat's two rig
 *   versions (camera remounted on 1 Oct).
 * - Calibration (P-CAL3): masters in structured storage, a 300 s dark and an
 *   OIII flat with two dated versions each, linked to their physical camera;
 *   pins matched at ingestion, suggestions the user confirmed, No choices.
 *   Calibration processes: a raw Ha flat session awaiting Stack, 120 s darks
 *   mid-stack in PixInsight, 300 s darks finished with their raws in the OS
 *   Trash, bias finished with its raws kept, and an OIII flat whose Stack
 *   output was not found.
 * - Targets: favourites, a southern Target with no window tonight, a default
 *   site, and tonight's plan of two Targets.
 * - Goal templates: one user template carrying conditions (C7): an FWHM bar,
 *   a ±15% panel balance and a season window.
 *
 * All names, paths and counts are illustrative fixtures.
 */
import { fileName, formatCount } from "@/lib/format"
import { m, msg, verbatim } from "@/lib/i18n"
import { calibrateSessions, confirmChoice, DEFAULT_MASTER_MAX_AGE_DAYS, noChoice } from "./calibration"
import { adoptionDestination, CALIBRATION_STEP_NAME, processIdFor, processRef, stepRecord } from "./calibration-process"
import { closeSnapshot, projectHref } from "./derive"
import { DEFAULT_GROUP_KEYWORDS, DEFAULT_MATCHING, DEFAULT_MOON_AVOIDANCE, DEFAULT_MOON_CONSTRAINTS, unitCount } from "./labels"
import { createFolder, fakeSha256, fileAt, fileKey, filesUnder, makeFile, type NewFile, writeFiles } from "./disk"
import { capturedRigVersionId, confirmedEvidence, indexLocationsSync, stableHash } from "./indexing"
import { simulateMeasurement } from "./measurement"
import { defaultCriteria, seasonWindow, shiftNight, upcomingNight } from "./planning"
import { appliedViewFor, placeEntry, projectPaths, viewPlan } from "./project-view"
import { pixelScaleArcsec } from "./sky"
import { DEFAULT_PANEL_BALANCE_PCT, qualityBarFor } from "./templates"
import {
  type ActivityEvent,
  type AppSettings,
  type ApplicationProfile,
  type Asset,
  type CalibrationChoice,
  type Catalog,
  DEFAULT_REMINDER_LEAD_MIN,
  type Disk,
  type DiskFile,
  type Filter,
  type FrameHeader,
  type Goal,
  type GoalChannel,
  type ImageType,
  type Location,
  type Operation,
  type PinKind,
  type PixelTruth,
  type Project,
  type ProjectGroup,
  type ProjectInput,
  type SeedName,
  type Session,
  type SimulatedApp,
  type SimulationFaults,
  type Subject,
  type SubjectConditions,
  type Target,
  type TrashEpisodeKind,
  type ViewEntry,
  type Volume,
  type VolumeId,
} from "./types"

export const VOLUME_IDS = {
  astro: "vol_astro_t7",
  cold: "vol_cold_1",
  scratch: "vol_scratch",
  archive: "vol_archive",
  impostor: "vol_archive_impostor",
  spare: "vol_spare",
  nas: "vol_nas",
  /** A removable SD card in the ASIAIR layout (Autorun, Plan): Import recognises it as an ASIAIR. */
  asiair: "vol_asiair",
  /** A removable USB stick with loose FITS files: a generic device. */
  usb: "vol_usb",
} as const

const TB = 1_000_000_000_000

function buildVolumes(coldMounted: boolean): Record<VolumeId, Volume> {
  const fixed = { network: false, removable: false }
  const list: Volume[] = [
    { id: VOLUME_IDS.astro, name: "Astro-T7", mountPath: "/Volumes/Astro-T7", volumeUuid: "5E1F-T7-0001", mounted: true, writable: true, trash: "supported", capacityBytes: 2 * TB, symlinks: true, ...fixed },
    { id: VOLUME_IDS.cold, name: "Cold-1", mountPath: "/Volumes/Cold-1", volumeUuid: "C01D-0001", mounted: coldMounted, writable: true, trash: "supported", capacityBytes: 4 * TB, symlinks: true, ...fixed },
    { id: VOLUME_IDS.scratch, name: "Scratch", mountPath: "/Volumes/Scratch", volumeUuid: "5C7A-0001", mounted: true, writable: true, trash: "unsupported", capacityBytes: 0.5 * TB, symlinks: false, ...fixed },
    { id: VOLUME_IDS.archive, name: "Archive", mountPath: "/Volumes/Archive", volumeUuid: "A7C4-0001", mounted: true, writable: true, trash: "supported", capacityBytes: 8 * TB, symlinks: true, ...fixed },
    { id: VOLUME_IDS.impostor, name: "Archive", mountPath: "/Volumes/Archive", volumeUuid: "A7C4-9999", mounted: false, writable: true, trash: "supported", capacityBytes: 1 * TB, symlinks: true, ...fixed },
    { id: VOLUME_IDS.spare, name: "Spare", mountPath: "/Volumes/Spare", volumeUuid: "5BA2-0001", mounted: true, writable: true, trash: "supported", capacityBytes: 1 * TB, symlinks: true, ...fixed },
    // D-W12: an OS-mounted network share, hashed resumably with progress.
    { id: VOLUME_IDS.nas, name: "NAS", mountPath: "/Volumes/NAS", volumeUuid: "4A5E-0001", mounted: true, writable: true, trash: "supported", capacityBytes: 12 * TB, symlinks: true, network: true, removable: false },
    // Removable devices: not connected until the demo (or Prototype › Connect) mounts them.
    { id: VOLUME_IDS.asiair, name: "ASIAIR", mountPath: "/Volumes/ASIAIR", volumeUuid: "A51A-0001", mounted: false, writable: true, trash: "supported", capacityBytes: 128_000_000_000, symlinks: false, network: false, removable: true },
    { id: VOLUME_IDS.usb, name: "USB DISK", mountPath: "/Volumes/USB DISK", volumeUuid: "U5B0-0001", mounted: false, writable: true, trash: "unsupported", capacityBytes: 64_000_000_000, symlinks: false, network: false, removable: true },
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
  [VOLUME_IDS.usb]: "/Volumes/USB DISK",
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
/** The second ASI2600MM ("2600MM #2") runs colder on the FRA400: its own bias, and its darks are "Don't use darks". */
const FRA400: Train = { ...REDCAT, telescope: "Askar FRA400", focalLengthMm: 400, ccdTempC: -15 }
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
      ncombine: null,
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

function masterFile(name: string, imageType: ImageType, exposureS: number, filter: string | null, date: string, volumeId: VolumeId = A, dir = "Calibration/Masters", rig: Train = REDCAT, ncombine: number | null = null): DiskFile {
  const path = `${MOUNT[volumeId]}/${dir}/${name}`
  return makeFile({
    path,
    volumeId,
    sizeBytes: rig.widthPx * rig.heightPx * 4 + 23_040,
    kind: "xisf",
    header: {
      imageType, object: null, filter, exposureS, dateObs: date, instrument: rig.instrument, telescope: imageType === "master-flat" ? rig.telescope : null,
      focalLengthMm: imageType === "master-flat" ? rig.focalLengthMm : null, binning: 1, gain: rig.gain, offset: rig.offset, ccdTempC: rig.ccdTempC,
      ra: null, dec: null, rotationDeg: null, widthPx: rig.widthPx, heightPx: rig.heightPx, pixelSizeUm: rig.pixelSizeUm, bayerPattern: rig.bayerPattern, siteLat: null, siteLon: null, ncombine,
    },
    modifiedAt: date,
  })
}

const MASTER_FILE_PREFIX: Partial<Record<ImageType, string>> = { "master-dark": "MasterDark", "master-flat": "MasterFlat", "master-bias": "MasterBias" }

/** A master in structured calibration storage (P-CAL3): `Calibration/<per-kind folder>/Master<Kind>_<night>.xisf`. */
function storedMaster(dir: string, night: string, imageType: ImageType, exposureS: number, filter: string | null, date: string, rig: Train, ncombine: number): DiskFile {
  return masterFile(`${MASTER_FILE_PREFIX[imageType]}_${night}.xisf`, imageType, exposureS, filter, date, A, `Calibration/${dir}`, rig, ncombine)
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
    // Later that night the mount re-pointed 0.6° north: intake splits it off as "framing 2" (D-W107).
    ...light(A, "Captures/NGC7000/2026-09-24/OIII", "Light_NGC7000_300s_OIII_B", 16, "2026-09-24T22:10:00Z", 300, "OIII", "NGC 7000", { ra: NGC7000.ra, dec: NGC7000.dec + 0.6, rotationDeg: rot }),
    // OBJECT names NGC 7000 but the capture wrote no RA/DEC: the Target stays unresolved (OBJECT is a label, never evidence), and with no pointing nothing splits.
    ...light(A, "Captures/NGC7000/2026-09-26/OIII", "Light_Cygnus_300s_OIII", 35, "2026-09-26T19:55:00Z", 300, "OIII", "NGC 7000", null),
    // No telescope or focal-length keywords: the rig needs review.
    ...light(A, "Captures/NGC7000/2026-09-28/Ha", "Light_NGC7000_300s_Ha", 56, "2026-09-28T19:50:00Z", 300, "Ha", "NGC 7000", { ...NGC7000, rotationDeg: rot }, { overrides: { telescope: null, focalLengthMm: null } }),
    // Six trailed frames the review marks Unusable.
    ...light(A, "Captures/NGC7000/2026-09-30/OIII", "Light_NGC7000_300s_OIII", 48, "2026-09-30T19:45:00Z", 300, "OIII", "NGC 7000", { ...NGC7000, rotationDeg: rot }, { truth: (i) => (i >= 12 && i <= 17 ? { trailed: true, eccentricity: 0.78, fwhmPx: 4.1 } : {}) }),
    // RedCat's camera was remounted on 1 Oct: a new rig version, so these lights need flats taken with it.
    ...light(A, "Captures/NGC7000/2026-10-02/Ha", "Light_NGC7000_300s_Ha", 10, "2026-10-02T19:40:00Z", 300, "Ha", "NGC 7000", { ...NGC7000, rotationDeg: rot }),
    // No OBJECT and no pointing: the Target stays unresolved.
    ...light(A, "Captures/Unsorted/2026-09-22", "Light_300s_Ha", 10, "2026-09-22T21:10:00Z", 300, "Ha", null, null),
    // NGC 7000 on Esprit 100 / ASI533MC (OSC, L-eXtreme): 180 s lights; their 180 s darks arrived later (5 Oct).
    ...osc("Captures/NGC7000/2026-09-21/OSC", "Light_NGC7000_180s_LeX", 40, "2026-09-21T20:30:00Z"),
    ...osc("Captures/NGC7000/2026-10-01/OSC", "Light_NGC7000_180s_LeX", 30, "2026-10-01T20:00:00Z"),
    // IC 5070 mosaic panels on RedCat; one session points between panels 1 and 2. Only Panel 2 points inside IC 5070 itself:
    // the others stay unresolved by pointing until the user confirms them.
    ...panel("Captures/IC5070/2026-09-13/Ha", "Light_IC5070_P1_300s_Ha", 30, "2026-09-13T20:30:00Z", "Ha", 0),
    ...panel("Captures/IC5070/2026-09-14/OIII", "Light_IC5070_P1_300s_OIII", 30, "2026-09-14T21:30:00Z", "OIII", 0),
    ...panel("Captures/IC5070/2026-09-16/Ha", "Light_IC5070_P2_300s_Ha", 30, "2026-09-16T20:30:00Z", "Ha", 1, VOLUME_IDS.cold),
    ...panel("Captures/IC5070/2026-09-17/OIII", "Light_IC5070_P2_300s_OIII", 24, "2026-09-17T20:30:00Z", "OIII", 1),
    ...panel("Captures/IC5070/2026-09-19/Ha", "Light_IC5070_P3_300s_Ha", 20, "2026-09-19T20:30:00Z", "Ha", 2),
    ...light(A, "Captures/IC5070/2026-09-20/Ha", "Light_IC5070_300s_Ha", 12, "2026-09-20T20:30:00Z", 300, "Ha", "IC 5070", { ra: IC5070.ra, dec: (PANEL_DEC[0]! + PANEL_DEC[1]!) / 2, rotationDeg: 0 }),
    // Heart and Soul on RedCat, still to review.
    ...light(A, "Imaging/HeartSoul/2026-09-14/Ha", "Light_Heart_300s_Ha", 20, "2026-09-14T20:40:00Z", 300, "Ha", "Heart Nebula", { ra: 38.2, dec: 61.45, rotationDeg: 0 }),
    ...light(A, "Imaging/HeartSoul/2026-09-15/Ha", "Light_Soul_300s_Ha", 18, "2026-09-15T20:40:00Z", 300, "Ha", "Soul Nebula", { ra: 42.8, dec: 60.43, rotationDeg: 0 }),
    // M 31 on Askar FRA400 / ASI2600MM #2; the 25 Aug session was moved to the OS Trash.
    ...fra("Imaging/M31/2026-08-25/L", "Light_M31_120s_L_test", 8, "2026-08-25T22:00:00Z", 120, "L", "M31", { ra: 10.685, dec: 41.269, rotationDeg: 12 }),
    ...fra("Imaging/M31/2026-09-02/L", "Light_M31_120s_L", 60, "2026-09-02T21:00:00Z", 120, "L", "M31", { ra: 10.685, dec: 41.269, rotationDeg: 12 }),
    ...fra("Imaging/M31/2026-09-03/R", "Light_M31_120s_R", 20, "2026-09-03T21:00:00Z", 120, "R", "M31", { ra: 10.685, dec: 41.269, rotationDeg: 12 }),
    ...fra("Imaging/M31/2026-09-03/G", "Light_M31_120s_G", 20, "2026-09-03T21:50:00Z", 120, "G", "M31", { ra: 10.685, dec: 41.269, rotationDeg: 12 }),
    ...fra("Imaging/M31/2026-09-03/B", "Light_M31_120s_B", 20, "2026-09-03T22:40:00Z", 120, "B", "M31", { ra: 10.685, dec: 41.269, rotationDeg: 12 }),
    // M 33: a confirmed Target that no Project names.
    ...fra("Imaging/M33/2026-08-30/L", "Light_M33_120s_L", 40, "2026-08-30T22:00:00Z", 120, "L", "M33", { ra: 23.462, dec: 30.66, rotationDeg: 0 }),
    // Calibration (P-CAL3): raw sessions wait under Raw/ for their calibration process (day-time sets stay in one night);
    // masters live in structured storage, flats per rig, filter and night, darks and bias per camera and settings. A master
    // with the same settings taken on another date is a second dated version of one record (CAL-FR-14).
    ...calibrationSet("Calibration/Raw/Darks/300s/2026-09-08", "Dark_300s_G100", 30, "2026-09-08T14:00:00Z", "dark", 300, null),
    ...calibrationSet("Calibration/Raw/Darks/120s/2026-09-08", "Dark_120s_G100", 30, "2026-09-08T17:00:00Z", "dark", 120, null),
    ...calibrationSet("Calibration/Raw/Bias/2026-09-08", "Bias_G100", 50, "2026-09-08T18:30:00Z", "bias", 0.000032, null),
    ...calibrationSet("Calibration/Raw/Flats/Ha/2026-09-18", "Flat_RedCat_Ha", 30, "2026-09-19T05:20:00Z", "flat", 1.5, "Ha"),
    ...calibrationSet("Calibration/Raw/Flats/OIII/2026-09-26", "Flat_RedCat_OIII", 30, "2026-09-27T05:25:00Z", "flat", 2.0, "OIII"),
    storedMaster("Darks/ZWO ASI2600MM Pro/300s_g100_o50_-10C", "2026-09-08", "master-dark", 300, null, "2026-09-08T19:10:00Z", REDCAT, 30),
    storedMaster("Darks/ZWO ASI2600MM Pro/300s_g100_o50_-10C", "2026-03-14", "master-dark", 300, null, "2026-03-14T19:10:00Z", REDCAT, 30),
    storedMaster("Bias/ZWO ASI2600MM Pro/g100_o50", "2026-09-08", "master-bias", 0.000032, null, "2026-09-08T20:00:00Z", REDCAT, 50),
    storedMaster("Bias/ZWO ASI2600MM Pro 2/g100_o50_-15C", "2026-09-02", "master-bias", 0.000032, null, "2026-09-02T12:00:00Z", FRA400, 50),
    storedMaster("Flats/RedCat 51 - ASI2600MM/Ha/2026-09-12", "2026-09-12", "master-flat", 1.5, "Ha", "2026-09-13T05:40:00Z", REDCAT, 30),
    storedMaster("Flats/RedCat 51 - ASI2600MM/OIII/2026-09-12", "2026-09-12", "master-flat", 2.0, "OIII", "2026-09-13T06:10:00Z", REDCAT, 30),
    storedMaster("Flats/RedCat 51 - ASI2600MM/OIII/2026-09-24", "2026-09-24", "master-flat", 2.0, "OIII", "2026-09-25T05:30:00Z", REDCAT, 30),
    ...(["L", "R", "G", "B"] as const).map((f, i) => storedMaster(`Flats/Askar FRA400 - ASI2600MM/${f}/2026-09-02`, "2026-09-02", "master-flat", 1, f, `2026-09-03T07:${String(i * 10).padStart(2, "0")}:00Z`, FRA400, 20)),
    storedMaster("Darks/ZWO ASI533MC Pro/120s_g101_o50_-5C", "2026-09-10", "master-dark", 120, null, "2026-09-10T18:00:00Z", ESPRIT, 20),
    storedMaster("Darks/ZWO ASI533MC Pro/300s_g101_o50_-5C", "2026-09-10", "master-dark", 300, null, "2026-09-10T18:10:00Z", ESPRIT, 20),
    storedMaster("Darks/ZWO ASI533MC Pro/180s_g101_o50_-5C", "2026-10-05", "master-dark", 180, null, "2026-10-05T18:00:00Z", ESPRIT, 20),
    storedMaster("Bias/ZWO ASI533MC Pro/g101_o50", "2026-09-10", "master-bias", 0.000032, null, "2026-09-10T18:20:00Z", ESPRIT, 40),
    storedMaster("Flats/Esprit 100 - ASI533MC/L-eXtreme/2026-09-21", "2026-09-21", "master-flat", 3.0, "L-eXtreme", "2026-09-22T06:30:00Z", ESPRIT, 25),
    // C9: a 600 s master dark written 91 days before the demo loads, so the library shows its "Old · 91 d" badge.
    oldMasterDark(),
  ]
}

/** 91 days and one hour before load time, so `masterAge` reads "Old · 91 d" for 23 hours after the demo loads. */
function oldMasterDark(): DiskFile {
  const date = new Date(Date.now() - (91 * 24 + 1) * 3_600_000).toISOString()
  return storedMaster("Darks/ZWO ASI2600MM Pro/600s_g100_o50_-10C", date.slice(0, 10), "master-dark", 600, null, date, REDCAT, 20)
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

/**
 * What a removable device holds when it connects (S13 Import, `connectDevice`).
 * The ASIAIR card: new NGC 7000 lights with the last file still being written,
 * flats, a set without IMAGETYP (held as Unclassified), a log file, and the
 * 2 Oct Ha session imported from it before (byte-identical duplicates of
 * library frames); its Autorun and Plan folders are the ASIAIR layout. The
 * USB stick: loose M 45 lights in a dated folder, no recognised layout.
 */
export function deviceFiles(disk: Disk, volumeId: VolumeId): DiskFile[] {
  if (volumeId === VOLUME_IDS.usb) {
    return captureSet({ volumeId, dir: "M45 2026-10-05", prefix: "M45_L_60s", count: 8, start: "2026-10-05T23:10:00Z", imageType: "light", exposureS: 60, filter: "L", object: "M 45", rig: FRA400, pointing: { ra: 56.75, dec: 24.12, rotationDeg: 0 }, site: SITE_COORDS.backyard })
  }
  if (volumeId !== VOLUME_IDS.asiair) return []
  const card = VOLUME_IDS.asiair
  const pointing = { ...NGC7000, rotationDeg: rot }
  const site = SITE_COORDS.backyard
  const files = [
    ...captureSet({ volumeId: card, dir: "Autorun/Light/NGC 7000", prefix: "Light_NGC7000_300s_Ha_20261006", count: 16, start: "2026-10-06T19:30:00Z", imageType: "light", exposureS: 300, filter: "Ha", object: "NGC 7000", rig: REDCAT, pointing, site, growingLast: true }),
    ...captureSet({ volumeId: card, dir: "Autorun/Light/NGC 7000", prefix: "Light_NGC7000_300s_OIII_20261006", count: 12, start: "2026-10-06T21:10:00Z", imageType: "light", exposureS: 300, filter: "OIII", object: "NGC 7000", rig: REDCAT, pointing, site }),
    ...captureSet({ volumeId: card, dir: "Autorun/Flat", prefix: "Flat_RedCat_Ha_20261007", count: 20, start: "2026-10-07T05:20:00Z", imageType: "flat", exposureS: 1.5, filter: "Ha", object: null, rig: REDCAT, pointing: null, site: null }),
    // IMAGETYP missing: the files are held as Unclassified until typed.
    ...captureSet({ volumeId: card, dir: "Plan/M 33", prefix: "Capture_M33_120s_L_20261006", count: 6, start: "2026-10-06T23:40:00Z", imageType: "unknown", exposureS: 120, filter: "L", object: "M 33", rig: REDCAT, pointing: { ra: 23.462, dec: 30.66, rotationDeg: rot }, site, truth: () => ({ starCount: 1700, background: 860, saturatedStars: 1 }) }),
    makeFile({ path: `${MOUNT[card]}/Log/Autorun_Log_2026-10-06.txt`, volumeId: card, sizeBytes: 48_200, kind: "text", modifiedAt: "2026-10-07T05:40:00Z" }),
  ]
  const earlier = Object.values(disk.files)
    .filter((f) => f.path.startsWith(`${MOUNT[A]}/Captures/NGC7000/2026-10-02/Ha/`))
    .map((f) => ({ ...f, volumeId: card, path: `${MOUNT[card]}/Autorun/Light/NGC 7000/${f.path.slice(f.path.lastIndexOf("/") + 1)}`, inode: f.inode + 7 }))
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
        evidence: msg("seed_apps_evidence_pixinsight"),
        inputWrite: "read-only",
        correctedMetadata: "none",
        masterStacking: true,
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
        evidence: msg("seed_apps_evidence_siril"),
        inputWrite: "read-only",
        correctedMetadata: "none",
        masterStacking: true,
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
        evidence: msg("seed_apps_evidence_seti"),
        inputWrite: "unknown",
        correctedMetadata: "none",
        masterStacking: false,
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
        evidence: msg("seed_apps_evidence_generic"),
        inputWrite: "unknown",
        correctedMetadata: "none",
        masterStacking: false,
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
    reducers: {},
    filters: {},
    opticalTrains: {},
    sites: {},
    projects: {},
    goalTemplates: {},
    measurements: {},
    measurementImports: {},
    masters: {},
    calibrationProcesses: {},
    profiles: builtInProfiles(),
    trashEpisodes: {},
    importSources: {},
    plans: {},
    reminders: { enabled: false, siteId: null, leadTimeMin: DEFAULT_REMINDER_LEAD_MIN, permission: "not-requested", deliveredWindowKeys: [], enabledAt: null, checkedAt: null },
    calendarExports: [],
  }
}

export function defaultSettings(): AppSettings {
  return {
    defaultSiteId: null,
    planningSiteId: null,
    defaultArchiveLocationId: null,
    moonConstraints: structuredClone(DEFAULT_MOON_CONSTRAINTS),
    moonAvoidance: structuredClone(DEFAULT_MOON_AVOIDANCE),
    onboarding: { completedAt: null, deferredRoles: [] },
    lastProcessingParent: null,
    naming: {},
    namingOmit: [],
    keepRawCalibration: false,
    masterMaxAgeDays: DEFAULT_MASTER_MAX_AGE_DAYS,
    targetLookup: { enabled: true, provider: "cds-sesame" },
    defaultInputMode: "symlink",
    keywords: { ...DEFAULT_GROUP_KEYWORDS },
    matching: structuredClone(DEFAULT_MATCHING),
    developerModeCheck: "not-windows",
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
    developerMode: "not-windows",
    quickActions: "one-click",
    viewFileHeld: false,
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
  { volumeId: VOLUME_IDS.nas, path: "/Volumes/NAS/Archive" },
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

function location(id: string, displayName: string, path: string, volumeId: VolumeId, role: Location["role"], registeredAt = "2026-09-01T18:00:00.000Z"): Location {
  return { id, displayName, path, volumeId, role, registeredAt, access: "unknown", lastIndexedAt: null, scanScope: "never", unreadablePaths: [], lastScanOperationId: null }
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
/** Two ASI2600MM cameras of one model: each has its own physical alias, and darks and bias link to one of them (LIB-FR-26). */
const CAMERA = { first: "cam_2600", second: "cam_2600b", osc: "cam_533" } as const
const PROJECT = { cygnus: "prj_cygnus", mosaic: "prj_ic5070", m31: "prj_m31", heart: "prj_heart", oiii: "prj_ngc_oiii" } as const
const PROCESSING = "/Volumes/Astro-T7/Processing"

function equipment(catalog: Catalog) {
  const mono = { widthPx: 6248, heightPx: 4176, pixelSizeUm: 3.76, kind: "mono" as const, source: "manual" as const, noBias: false }
  catalog.cameras = {
    [CAMERA.first]: { id: CAMERA.first, name: "ASI2600MM Pro", aliases: ["ZWO ASI2600MM Pro"], physicalAlias: "2600MM #1", noDarks: false, ...mono },
    // The FRA400's camera: "Don't use darks" settles its sessions as No darks with no warning (CAL-FR-22).
    [CAMERA.second]: { id: CAMERA.second, name: "ASI2600MM Pro", aliases: ["ZWO ASI2600MM Pro"], physicalAlias: "2600MM #2", noDarks: true, ...mono },
    [CAMERA.osc]: { id: CAMERA.osc, name: "ASI533MC Pro", aliases: ["ZWO ASI533MC Pro"], source: "manual", widthPx: 3008, heightPx: 3008, pixelSizeUm: 3.76, kind: "osc", physicalAlias: null, noDarks: false, noBias: false },
  }
  catalog.telescopes = {
    tel_redcat: { id: "tel_redcat", name: "RedCat 51", aliases: ["William Optics RedCat 51"], source: "manual", focalLengthMm: 250, apertureMm: 51 },
    tel_esprit: { id: "tel_esprit", name: "Esprit 100", aliases: ["SkyWatcher Esprit 100ED"], source: "manual", focalLengthMm: 550, apertureMm: 100 },
    tel_fra400: { id: "tel_fra400", name: "Askar FRA400", aliases: ["FRA400"], source: "manual", focalLengthMm: 400, apertureMm: 72 },
  }
  // Each rig's filters as it lists them. Filters are records the rigs select (ngm9g): a definition two rigs share (name, bands and FILTER matches) is one record.
  const lists: Record<string, Array<Omit<Filter, "id">>> = {
    [RIG.redcat]: [
      { name: "Ha", bands: ["Ha"], matches: ["Ha", "H-alpha"] },
      { name: "OIII", bands: ["OIII"], matches: ["OIII", "O3"] },
      { name: "SII", bands: ["SII"], matches: ["SII", "S2"] },
    ],
    [RIG.esprit]: [{ name: "L-eXtreme", bands: ["Ha", "OIII"], matches: ["L-eXtreme", "LeXtreme"] }],
    [RIG.fra]: [
      { name: "L", bands: ["L"], matches: ["L", "Lum"] },
      { name: "R", bands: ["R"], matches: ["R"] },
      { name: "G", bands: ["G"], matches: ["G"] },
      { name: "B", bands: ["B"], matches: ["B"] },
      { name: "Ha", bands: ["Ha"], matches: ["Ha"] },
    ],
  }
  const same = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])
  catalog.filters = {}
  const filterIds: Record<string, string[]> = {}
  for (const [rigId, list] of Object.entries(lists)) {
    filterIds[rigId] = list.map((f) => {
      const existing = Object.values(catalog.filters).find((x) => x.name === f.name && same(x.bands, f.bands) && same(x.matches, f.matches))
      if (existing) return existing.id
      const id = `flt_${rigId.replace(/^otr_/, "")}_${f.name.toLowerCase().replace(/[^a-z0-9]/g, "")}`
      catalog.filters[id] = { id, ...f }
      return id
    })
  }
  const optics = (cameraId: string, telescopeId: string, effectiveFocalLengthMm: number, rigId: string) => ({ cameraId, telescopeId, reducerId: null, effectiveFocalLengthMm, filterIds: filterIds[rigId]!, rotator: false })
  catalog.opticalTrains = {
    // RedCat's camera was remounted on 1 Oct: a second dated version with the same optics (PLAN-EQ-FR-07). Flats need the lights' version.
    [RIG.redcat]: {
      id: RIG.redcat,
      name: "RedCat 51 / ASI2600MM",
      source: "manual",
      notes: "",
      ...optics(CAMERA.first, "tel_redcat", 250, RIG.redcat),
      versionId: "rv_redcat_2",
      versionFrom: "2026-10-01",
      history: [{ id: "rv_redcat_1", from: "2026-01-01", ...optics(CAMERA.first, "tel_redcat", 250, RIG.redcat) }],
    },
    [RIG.esprit]: { id: RIG.esprit, name: "Esprit 100 / ASI533MC", source: "manual", notes: "", ...optics(CAMERA.osc, "tel_esprit", 550, RIG.esprit), versionId: "rv_esprit_1", versionFrom: "2026-01-01", history: [] },
    [RIG.fra]: { id: RIG.fra, name: "Askar FRA400 / ASI2600MM", source: "manual", notes: "", ...optics(CAMERA.second, "tel_fra400", 400, RIG.fra), versionId: "rv_fra400_1", versionFrom: "2026-01-01", history: [] },
  }
}

/**
 * Masters indexed from the Calibration location match by camera model until
 * they are linked to a physical camera; with two ASI2600MM cameras each one
 * is linked, as Import masters records it (LIB-FR-26).
 */
function linkMasterCameras(catalog: Catalog) {
  const link = (folder: string, cameraId: string) => {
    for (const master of Object.values(catalog.masters)) {
      if (master.versions.some((v) => v.path.includes(`/Calibration/${folder}/`))) catalog.masters[master.id] = { ...master, cameraId }
    }
  }
  link("Darks/ZWO ASI2600MM Pro", CAMERA.first)
  link("Bias/ZWO ASI2600MM Pro", CAMERA.first)
  link("Flats/RedCat 51 - ASI2600MM", CAMERA.first)
  link("Bias/ZWO ASI2600MM Pro 2", CAMERA.second)
  link("Flats/Askar FRA400 - ASI2600MM", CAMERA.second)
}

const decided = (asset: Asset, value: "usable" | "unusable", at: string): Asset => ({ ...asset, quality: { value, decidedAt: at, basisSha256: asset.sha256 } })

/** The user's confirmation, recorded as the store's Confirm Target / Confirm rig record it: a separate user row, and the rig version the session was captured with. */
function confirm(catalog: Catalog, session: Session, targetId: string | null, rigId: string | null) {
  const at = "2026-09-29T09:00:00.000Z"
  const target = targetId ? catalog.targets[targetId] : undefined
  const rig = rigId ? catalog.opticalTrains[rigId] : undefined
  const current = catalog.sessions[session.id]!
  const next: Session = {
    ...current,
    target: target ? { value: target.id, status: "confirmed", evidence: confirmedEvidence(current.target.evidence, msg("session_confirm_target"), verbatim(target.name)), confirmedAt: at } : current.target,
    equipment: rig ? { value: rig.id, status: "confirmed", evidence: confirmedEvidence(current.equipment.evidence, msg("session_confirm_rig"), verbatim(rig.name)), confirmedAt: at } : current.equipment,
  }
  catalog.sessions[session.id] = { ...next, rigVersionId: capturedRigVersionId(catalog, next) }
}

/** A Project with the fields every demo Project shares; `fields` override them. */
function project(fields: Pick<Project, "id" | "name" | "subjects" | "rigIds" | "goals" | "createdAt"> & Partial<Project>): Project {
  return {
    notes: "",
    inputs: [],
    groups: [],
    settings: { profileId: PROFILE_IDS.pixinsight, mode: "symlink", processingParent: PROCESSING, keywords: null },
    folderPath: null,
    view: null,
    previous: null,
    output: {},
    masterOffers: [],
    archiveLocationId: null,
    wrapUp: {},
    state: "open",
    closedAt: null,
    snapshot: null,
    archive: null,
    revision: 1,
    ...fields,
  }
}

function group(id: string, name: string, createdAt: string, panel = false): ProjectGroup {
  return { id, name, panel, createdAt }
}

function input(session: Session, groupId: string): ProjectInput {
  return { sessionId: session.id, groupId, excluded: [], included: [] }
}

/**
 * A Project's View built from its originals as Apply builds it, in one go
 * (VSEL-FR-16): every planned entry placed, verified and recorded as the
 * applied state, with the Project folder's `Processing/` and `Output/`.
 */
function buildView(catalog: Catalog, disk: Disk, settings: AppSettings, built: Project, at: string): { disk: Disk; project: Project } {
  const world = { catalog, disk, settings }
  const paths = projectPaths(world, built)!
  const plan = viewPlan(world, built)
  let next = createFolder(createFolder(disk, { volumeId: A, path: paths.processing }), { volumeId: A, path: paths.output })
  const entries: ViewEntry[] = []
  const copies = new Map<string, DiskFile>()
  for (const planned of plan.entries) {
    const placed = placeEntry(next, planned, paths.view, built.settings.mode, at, copies.get(planned.originalPath) ?? null)
    if (!placed.ok) throw new Error(`Demo seed: ${built.name} cannot place ${planned.path}`)
    next = writeFiles(next, [placed.file])
    if (placed.entry.copySha256 !== null && !copies.has(planned.originalPath)) copies.set(planned.originalPath, placed.file)
    entries.push(placed.entry)
  }
  return { disk: next, project: { ...built, folderPath: paths.root, view: appliedViewFor(world, built, paths.view, entries, plan.layout, at, `op_apply_${built.id}`) } }
}

/** The header of a master PlateVault finds in a tool's folder: RedCat's settings, no pointing. */
const REDCAT_MASTER_HEADER: FrameHeader = {
  imageType: "master-flat",
  object: null,
  filter: "Ha",
  exposureS: 1.5,
  dateObs: "2026-10-01T22:00:00.000Z",
  instrument: REDCAT.instrument,
  telescope: REDCAT.telescope,
  focalLengthMm: REDCAT.focalLengthMm,
  binning: 1,
  gain: REDCAT.gain,
  offset: REDCAT.offset,
  ccdTempC: REDCAT.ccdTempC,
  ra: null,
  dec: null,
  rotationDeg: null,
  widthPx: REDCAT.widthPx,
  heightPx: REDCAT.heightPx,
  pixelSizeUm: REDCAT.pixelSizeUm,
  bayerPattern: null,
  siteLat: null,
  siteLon: null,
  ncombine: 30,
}

/** An image a tool or the user wrote into a Project folder; a master carries a master header. */
function imageFile(path: string, at: string, imageType: ImageType | null = null, extra: Partial<NewFile> = {}): DiskFile {
  const header = imageType ? { ...REDCAT_MASTER_HEADER, imageType, dateObs: at } : null
  return makeFile({ path, volumeId: A, sizeBytes: 104_390_000, kind: path.endsWith(".tif") ? "tiff" : "xisf", header, modifiedAt: at, ...extra })
}

/** Demo: the harness review library, F4 Project model (HARNESS-V5-IA.md § Seed). */
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
    // Registered after Astro-T7, so its byte-identical M 31 copies are the ones the Duplicates review offers to move (Round 6 keeper rule).
    loc_spare: location("loc_spare", "Spare captures", "/Volumes/Spare/Captures", VOLUME_IDS.spare, "captures", "2026-09-02T18:00:00.000Z"),
    loc_archive: location("loc_archive", "Archive", "/Volumes/Archive", VOLUME_IDS.archive, "archive"),
    // P-ARC1: a second archive location. Archive is the Default; M 31 picks this one.
    loc_archive_nas: location("loc_archive_nas", "NAS archive", "/Volumes/NAS/Archive", VOLUME_IDS.nas, "archive"),
    loc_nas: location("loc_nas", "NAS captures", "/Volumes/NAS/Captures", VOLUME_IDS.nas, "captures"),
  }
  const settings = defaultSettings()
  settings.onboarding = { completedAt: "2026-09-01T18:12:00.000Z", deferredRoles: [] }
  settings.defaultSiteId = "site_backyard"
  settings.defaultArchiveLocationId = "loc_archive"
  settings.lastProcessingParent = PROCESSING

  // Calibration first: masters and raw sets are in the library when the lights arrive, so ingestion pins what it can (CAL-FR-02).
  catalog = indexLocationsSync(catalog, disk, settings, ["loc_calibration"], "2026-09-12T08:00:00.000Z")
  linkMasterCameras(catalog)
  catalog = indexLocationsSync(catalog, disk, settings, ["loc_cold"], "2026-09-13T08:00:00.000Z")
  catalog = indexLocationsSync(catalog, disk, settings, ["loc_captures", "loc_imaging", "loc_spare", "loc_archive"], "2026-10-04T08:00:00.000Z")
  const session = (night: string, channel: string, predicate: (s: Session) => boolean = () => true) =>
    findSession(catalog, (s) => s.imageType === "light" && s.night === night && s.channel === channel && predicate(s))
  const ngc = session("2026-09-18", "Ha").target.value!
  const ic5070Target = ensureTarget(catalog, "tgt_ic5070", "IC 5070", ["Pelican Nebula", "IC5070"], IC5070.ra, IC5070.dec, { width: 1.0, height: 0.8 })
  const m31 = session("2026-09-02", "L").target.value!
  const heartIds = [session("2026-09-14", "Ha", (s) => s.objectLabel === "Heart Nebula"), session("2026-09-15", "Ha")]
  const s = {
    oiii0912: session("2026-09-12", "OIII"),
    ha0918: session("2026-09-18", "Ha"),
    oiii0924: session("2026-09-24", "OIII", (x) => x.framing === 1),
    oiii0924b: session("2026-09-24", "OIII", (x) => x.framing === 2),
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
    between: session("2026-09-20", "Ha"),
    m31test: session("2026-08-25", "L"),
    m31: { L: session("2026-09-02", "L"), R: session("2026-09-03", "R"), G: session("2026-09-03", "G"), B: session("2026-09-03", "B") },
    m33: session("2026-08-30", "L"),
  }
  // Confirmed associations: Targets and rigs the review relies on.
  for (const x of [s.oiii0912, s.ha0918, s.oiii0924, s.oiii0924b, s.ha0928, s.oiii0930, s.ha1002]) confirm(catalog, x, ngc, RIG.redcat)
  for (const x of [s.osc0921, s.osc1001]) confirm(catalog, x, ngc, RIG.esprit)
  for (const x of [s.p1ha, s.p1oiii, s.p2ha, s.p2oiii, s.p3ha, s.between]) confirm(catalog, x, ic5070Target, RIG.redcat)
  for (const x of heartIds) confirm(catalog, x, x.target.value, RIG.redcat)
  for (const x of [s.m31test, s.m31.L, s.m31.R, s.m31.G, s.m31.B]) confirm(catalog, x, m31, RIG.fra)
  confirm(catalog, s.m33, s.m33.target.value, RIG.fra)
  // Rig confirmed, Target still unresolved: these sessions need a Target.
  confirm(catalog, s.cygnus0926, null, RIG.redcat)
  confirm(catalog, s.unsorted, null, RIG.redcat)
  // Confirming a rig matches what still waits again (its camera and rig version are now known); pins stay.
  catalog = calibrateSessions(catalog, disk, settings, "2026-10-04T09:00:00.000Z")

  // Library quality, decided before each Project's Apply read it. M 31 L has five Unusable frames; 30 Sep OIII six trailed ones.
  const review = (x: Session, at: string, unusable: ReadonlySet<number> = new Set()) => {
    catalog.sessions[x.id]!.assetIds.forEach((id, index) => {
      catalog.assets[id] = decided(catalog.assets[id]!, unusable.has(index) ? "unusable" : "usable", at)
    })
  }
  review(s.oiii0912, "2026-09-13T10:00:00.000Z")
  for (const x of [s.p1ha, s.p1oiii, s.p2ha, s.p2oiii, s.p3ha]) review(x, "2026-09-21T10:00:00.000Z")
  for (const x of [s.ha0918, s.oiii0924, s.oiii0924b, s.osc0921]) review(x, "2026-09-30T10:00:00.000Z")
  review(s.oiii0930, "2026-10-01T12:00:00.000Z", new Set([12, 13, 14, 15, 16, 17]))
  review(s.ha1002, "2026-10-03T10:00:00.000Z")
  review(s.m31.L, "2026-09-04T10:00:00.000Z", new Set([2, 16, 28, 43, 57]))
  for (const x of [s.m31.R, s.m31.G, s.m31.B]) review(x, "2026-09-04T10:00:00.000Z")
  // Cached measurements for the M 31 broadband frames.
  const scale = pixelScaleArcsec(3.76, 400)
  for (const x of [s.m31.L, s.m31.R, s.m31.G, s.m31.B]) {
    for (const id of x.assetIds) {
      const asset = catalog.assets[id]!
      catalog.measurements[id] = simulateMeasurement(asset, fileAt(disk, asset.copies[0]!.path), scale, "2026-09-06T11:00:00.000Z")
    }
  }

  // Calibration choices the user made (LIB-FR-23, LIB-FR-25): suggestions confirmed on the sessions the Projects hold.
  const choose = (x: Session, kind: PinKind, choice: (current: CalibrationChoice) => CalibrationChoice) => {
    const current = catalog.sessions[x.id]!
    catalog.sessions[x.id] = { ...current, calibration: { ...current.calibration!, [kind]: choice(current.calibration![kind]) } }
  }
  for (const x of [s.p1oiii, s.p2ha, s.p2oiii]) choose(x, "flat", (c) => confirmChoice(c, "2026-09-21T11:00:00.000Z"))
  choose(s.oiii0930, "flat", (c) => confirmChoice(c, "2026-10-03T09:00:00.000Z"))

  // Targets: favourites and a southern Target with no window tonight.
  for (const id of [m31, s.m33.target.value!]) catalog.targets[id] = { ...catalog.targets[id]!, favourite: true }
  const tuc = ensureTarget(catalog, "tgt_ngc104", "NGC 104", ["47 Tucanae", "Caldwell 106"], 6.024, -72.081, { width: 0.5, height: 0.5 })
  catalog.targets[tuc] = { ...catalog.targets[tuc]!, favourite: true }

  // Goal conditions (C7) are relative to tonight at the default site, so the demo always has nights left.
  const backyard = catalog.sites.site_backyard!
  const tonight = upcomingNight(backyard, Date.now())
  const subject = (id: string, targetId: string, conditions?: SubjectConditions): Subject => ({ id, targetId, ...(conditions ? { conditions } : {}) })
  const ngcSubject = subject("sub_ngc7000", ngc, { panelBalancePct: DEFAULT_PANEL_BALANCE_PCT, window: { kind: "finish-by", night: shiftNight(tonight, 11) } })
  const mosaicSubject = subject("sub_ic5070", ic5070Target, { panelBalancePct: DEFAULT_PANEL_BALANCE_PCT, window: seasonWindow(IC5070, backyard, defaultCriteria(backyard), tonight) })
  const goal = (id: string, subjectId: string, channel: GoalChannel, hours: number | null, groupId: string | null = null, extra: Partial<Goal> = {}): Goal => ({
    id,
    subjectId,
    groupId,
    channel,
    integrationS: hours === null ? null : hours * 3600,
    frameCount: null,
    qualityBar: qualityBarFor(null),
    ...extra,
  })

  // "Cygnus HOO 2026" (Symlinks): three groups (two framings on RedCat, and the Esprit), so the View has GROUP_ folders, Darks and
  // Bias inside each group (two cameras) and the gain in the light folders' names (RedCat 100, Esprit 101).
  const cyg = { redcat: "grp_cyg_redcat", framing: "grp_cyg_framing2", esprit: "grp_cyg_esprit" }
  let cygnus = project({
    id: PROJECT.cygnus,
    name: "Cygnus HOO 2026",
    notes: m.seed_project_cygnus_notes(),
    subjects: [ngcSubject],
    rigIds: [RIG.redcat, RIG.esprit],
    goals: [goal("goal_ngc_ha", ngcSubject.id, "Ha", 10), goal("goal_ngc_oiii", ngcSubject.id, "OIII", 10)],
    groups: [
      group(cyg.redcat, "RedCat 51 / ASI2600MM", "2026-09-19T08:00:00.000Z"),
      group(cyg.framing, "RedCat 51 / ASI2600MM · Framing 2", "2026-09-30T18:00:00.000Z"),
      group(cyg.esprit, "Esprit 100 / ASI533MC", "2026-09-30T18:05:00.000Z"),
    ],
    inputs: [input(s.ha0918, cyg.redcat), input(s.oiii0924, cyg.redcat), input(s.oiii0924b, cyg.framing), input(s.osc0921, cyg.esprit)],
    createdAt: "2026-09-10T19:00:00.000Z",
    revision: 6,
  })
  // At Apply the 21 Sep OSC session was set to No darks; its 180 s darks arrived on 5 Oct and "Also use for these sessions" pinned
  // them, so the open Project reads a labelled calibration change (LIB-FR-25).
  const oscDark = catalog.sessions[s.osc0921.id]!.calibration!.dark
  choose(s.osc0921, "dark", () => noChoice("2026-09-30T20:00:00.000Z"))
  ;({ disk, project: cygnus } = buildView(catalog, disk, settings, cygnus, "2026-10-01T09:00:00.000Z"))
  choose(s.osc0921, "dark", () => (oscDark.state === "pinned" ? { ...oscDark, at: "2026-10-05T19:00:00.000Z", by: "user" } : oscDark))
  // Since Apply: the Project added 30 Sep OIII, and the Library marked three 18 Sep Ha frames Unusable.
  cygnus = { ...cygnus, inputs: [...cygnus.inputs, input(s.oiii0930, cyg.redcat)] }
  for (const index of [7, 21, 40]) catalog.assets[s.ha0918.assetIds[index]!] = decided(catalog.assets[s.ha0918.assetIds[index]!]!, "unusable", "2026-10-02T10:00:00.000Z")
  const cygPaths = projectPaths({ settings }, cygnus)!
  const wbpp = `${cygPaths.processing}/WBPP`
  const generatedFlat = imageFile(`${wbpp}/master/masterFlat_BIN-1_FILTER-Ha.xisf`, "2026-10-01T21:40:00.000Z", "master-flat")
  const cygMaster = imageFile(`${wbpp}/master/masterLight_BIN-1_FILTER-Ha.xisf`, "2026-10-01T22:00:00.000Z")
  disk = writeFiles(disk, [
    cygMaster,
    imageFile(`${wbpp}/master/masterLight_BIN-1_FILTER-OIII.xisf`, "2026-10-01T22:10:00.000Z"),
    generatedFlat,
    makeFile({ path: `${wbpp}/logs/WBPP.log`, volumeId: A, sizeBytes: 220_000, kind: "log", modifiedAt: "2026-10-01T22:12:00.000Z" }),
    // A file PlateVault didn't place: the user's notes in View, which the next Apply asks about (VSEL-FR-14).
    makeFile({ path: `${cygPaths.view}/notes.txt`, volumeId: A, sizeBytes: 2_400, kind: "text", modifiedAt: "2026-10-02T21:00:00.000Z" }),
    imageFile(`${cygPaths.output}/NGC7000-HOO.tif`, "2026-10-03T20:00:00.000Z", null, { sizeBytes: 156_500_000 }),
    imageFile(`${cygPaths.output}/NGC7000-Ha.xisf`, "2026-10-02T09:00:00.000Z", null, { sha256: cygMaster.sha256 }),
    // Still being written by the tool: Output shows it as writing (RES-FR-01).
    imageFile(`${cygPaths.output}/NGC7000-HOO-starless.tif`, "2026-10-04T07:55:00.000Z", null, { sizeBytes: 98_000_000, growing: true }),
  ])
  cygnus = {
    ...cygnus,
    output: {
      "NGC7000-HOO.tif": { kind: "final-image", channel: null, copiedFrom: null, at: "2026-10-03T20:05:00.000Z" },
      "NGC7000-Ha.xisf": { kind: "linear-integration", channel: "Ha", copiedFrom: cygMaster.path, at: "2026-10-02T09:00:00.000Z" },
    },
  }
  // Adopting the generated master flat (CAL-FR-06): an earlier adoption stopped after copying it, so its fixed destination holds
  // PlateVault's own unregistered copy. Adopt names that copy and offers a reviewed Move to Trash before it retries.
  const flatDestination = adoptionDestination(catalog, settings, generatedFlat, "flat")
  if (flatDestination) disk = writeFiles(disk, [{ ...generatedFlat, path: flatDestination, inode: generatedFlat.inode + 11, modifiedAt: "2026-10-02T08:00:00.000Z" }])

  // "IC 5070 mosaic" (Copies): panel groups make the Project a mosaic (PRJ-FR-29); each panel has its own goals. Panel 3 joined
  // after the last Apply, and that Apply left files in View (previous)/: a copy WBPP rewrote and two of the user's files, one kept.
  const panel = (n: number) => group(`grp_ic5070_p${n}`, `Panel ${n}`, "2026-09-12T19:00:00.000Z", true)
  const panels = [panel(1), panel(2), panel(3)]
  let mosaic = project({
    id: PROJECT.mosaic,
    name: "IC 5070 mosaic",
    subjects: [mosaicSubject],
    rigIds: [RIG.redcat],
    goals: panels.flatMap((p) => [goal(`goal_${p.id}_ha`, mosaicSubject.id, "Ha", 4, p.id), goal(`goal_${p.id}_oiii`, mosaicSubject.id, "OIII", 4, p.id)]),
    groups: panels,
    inputs: [input(s.p1ha, panels[0]!.id), input(s.p1oiii, panels[0]!.id), input(s.p2ha, panels[1]!.id), input(s.p2oiii, panels[1]!.id)],
    settings: { profileId: PROFILE_IDS.pixinsight, mode: "copy", processingParent: PROCESSING, keywords: null },
    createdAt: "2026-09-12T19:00:00.000Z",
    revision: 4,
  })
  ;({ disk, project: mosaic } = buildView(catalog, disk, settings, mosaic, "2026-09-23T09:00:00.000Z"))
  mosaic = { ...mosaic, inputs: [...mosaic.inputs, input(s.p3ha, panels[2]!.id)] }
  const mosaicPaths = projectPaths({ settings }, mosaic)!
  const rewritten = mosaic.view!.entries.find((e) => e.role === "light")!
  disk = writeFiles(disk, [
    makeFile({ path: `${mosaicPaths.previous}/${rewritten.path}`, volumeId: A, sizeBytes: rewritten.sizeBytes, kind: "fits", sha256: fakeSha256(rewritten.path, 5), modifiedAt: "2026-09-22T23:10:00.000Z" }),
    makeFile({ path: `${mosaicPaths.previous}/notes-panel-2.txt`, volumeId: A, sizeBytes: 3_200, kind: "text", modifiedAt: "2026-09-22T21:00:00.000Z" }),
    makeFile({ path: `${mosaicPaths.previous}/framing-sketch.png`, volumeId: A, sizeBytes: 420_000, kind: "other", modifiedAt: "2026-09-20T12:00:00.000Z" }),
    imageFile(`${mosaicPaths.output}/Panels/Panel-1/IC5070-Panel-1-HOO.xisf`, "2026-09-24T21:00:00.000Z"),
    imageFile(`${mosaicPaths.processing}/WBPP/master/masterLight_BIN-1_FILTER-Ha_PANEL-Panel-1.xisf`, "2026-09-23T22:00:00.000Z"),
  ])
  mosaic = {
    ...mosaic,
    previous: {
      folderPath: mosaicPaths.previous,
      at: "2026-09-23T09:00:00.000Z",
      leftovers: [
        { path: rewritten.path, reason: "changed-copy", sizeBytes: rewritten.sizeBytes, kept: false },
        { path: "notes-panel-2.txt", reason: "unplaced", sizeBytes: 3_200, kept: false },
        // Reviewed as Keep: it stays and is not asked about again.
        { path: "framing-sketch.png", reason: "unplaced", sizeBytes: 420_000, kept: true },
      ],
    },
    output: { "Panels/Panel-1/IC5070-Panel-1-HOO.xisf": { kind: "mosaic-panel", channel: null, copiedFrom: null, at: "2026-09-24T21:05:00.000Z" } },
  }

  // "M 31 LRGB" (Copies): in Wrap up with Clean up done (its View's copies are in the OS Trash) and Trash and Archive still to do;
  // it archives to the NAS archive, not the Default. Goals use every kind: integration with an FWHM bar (part of the L frames sit
  // over the limit: "below bar"), frame counts, Usable only.
  const m31Group = "grp_m31_fra"
  let m31Project = project({
    id: PROJECT.m31,
    name: "M 31 LRGB",
    notes: m.seed_project_m31_notes(),
    subjects: [subject("sub_m31", m31)],
    rigIds: [RIG.fra],
    goals: [
      goal("goal_m31_l", "sub_m31", "L", 2, null, { qualityBar: qualityBarFor(5.25) }),
      goal("goal_m31_r", "sub_m31", "R", null, null, { frameCount: 20 }),
      goal("goal_m31_g", "sub_m31", "G", null, null, { frameCount: 20 }),
      goal("goal_m31_b", "sub_m31", "B", null, null, { frameCount: 20 }),
    ],
    groups: [group(m31Group, "Askar FRA400 / ASI2600MM", "2026-09-04T18:00:00.000Z")],
    inputs: [s.m31.L, s.m31.R, s.m31.G, s.m31.B].map((x) => input(x, m31Group)),
    settings: { profileId: PROFILE_IDS.pixinsight, mode: "copy", processingParent: PROCESSING, keywords: null },
    archiveLocationId: "loc_archive_nas",
    createdAt: "2026-09-01T19:00:00.000Z",
    revision: 5,
  })
  ;({ disk, project: m31Project } = buildView(catalog, disk, settings, m31Project, "2026-09-05T09:00:00.000Z"))
  const m31Paths = projectPaths({ settings }, m31Project)!
  const m31Wbpp = `${m31Paths.processing}/WBPP`
  const generatedDark = imageFile(`${m31Wbpp}/master/masterDark_BIN-1_EXPOSURE-120.00s.xisf`, "2026-09-07T20:10:00.000Z", null, {
    header: { ...REDCAT_MASTER_HEADER, imageType: "master-dark", filter: null, exposureS: 120, telescope: null, focalLengthMm: null, ccdTempC: -15, dateObs: "2026-09-07T20:10:00.000Z" },
  })
  const m31Masters = (["L", "R", "G", "B"] as const).map((c) => imageFile(`${m31Wbpp}/master/masterLight_BIN-1_FILTER-${c}.xisf`, "2026-09-07T20:30:00.000Z"))
  const m31Intermediates = s.m31.L.assetIds.slice(0, 12).flatMap((id) => {
    const stem = catalog.assets[id]!.fileName.replace(/\.fits$/, "")
    return [imageFile(`${m31Wbpp}/calibrated/${stem}_c.xisf`, "2026-09-07T19:00:00.000Z"), imageFile(`${m31Wbpp}/registered/${stem}_c_r.xisf`, "2026-09-07T19:40:00.000Z")]
  })
  const m31Copied = m31Masters.map((f) => imageFile(`${m31Paths.output}/${fileName(f.path)}`, "2026-09-08T09:00:00.000Z", null, { sha256: f.sha256 }))
  disk = writeFiles(disk, [generatedDark, ...m31Masters, ...m31Intermediates, imageFile(`${m31Paths.output}/M31-LRGB.tif`, "2026-09-09T21:00:00.000Z", null, { sizeBytes: 156_500_000 }), ...m31Copied])
  // Clean up moved the View's copies to the OS Trash (F1); Trash and Archive are still to do.
  const trashAt = "2026-09-10T08:31:00.000Z"
  const viewCopies = filesUnder(disk, m31Project.view!.folderPath)
  for (const file of viewCopies) delete disk.files[fileKey(file.volumeId, file.path)]
  disk = { ...disk, trash: [...disk.trash, ...viewCopies.map((file) => ({ file, originalPath: file.path, trashedAt: trashAt }))] }
  catalog.trashEpisodes.trash_m31_view = {
    id: "trash_m31_view",
    kind: "view-cleanup",
    at: trashAt,
    projectId: PROJECT.m31,
    items: viewCopies.map((file) => ({ path: file.path, volumeId: file.volumeId, sizeBytes: file.sizeBytes, assetId: null, outcome: "trashed" as const, reason: null })),
    operationId: "op_cleanup_m31",
  }
  m31Project = {
    ...m31Project,
    output: {
      "M31-LRGB.tif": { kind: "final-image", channel: null, copiedFrom: null, at: "2026-09-09T21:05:00.000Z" },
      ...Object.fromEntries(m31Copied.map((f, i) => [fileName(f.path), { kind: "linear-integration" as const, channel: (["L", "R", "G", "B"] as const)[i]!, copiedFrom: m31Masters[i]!.path, at: "2026-09-08T09:00:00.000Z" }])),
    },
    // The generated master dark was hidden: it is not offered again for that file and digest (CAL-FR-06).
    masterOffers: [{ path: generatedDark.path, sha256: generatedDark.sha256, state: "hidden", at: "2026-09-08T09:30:00.000Z" }],
    wrapUp: { cleanup: { state: "done", at: trashAt, operationIds: ["op_cleanup_m31"], redo: false } },
  }

  // "NGC 7000 OIII test" (Closed, Symlinks): Clean up kept its View's links, Trash and Archive were skipped, and Close froze its
  // goals and calibration (PRJ-FR-25). Its session is held by no open Project, so Sessions › Archive… repoints the kept View.
  const oiiiGroup = "grp_oiii_redcat"
  let oiiiTest = project({
    id: PROJECT.oiii,
    name: "NGC 7000 OIII test",
    subjects: [subject("sub_ngc_oiii", ngc)],
    rigIds: [RIG.redcat],
    goals: [goal("goal_oiii_test", "sub_ngc_oiii", "OIII", 2)],
    groups: [group(oiiiGroup, "RedCat 51 / ASI2600MM", "2026-09-13T09:00:00.000Z")],
    inputs: [input(s.oiii0912, oiiiGroup)],
    createdAt: "2026-09-13T09:00:00.000Z",
    revision: 4,
  })
  ;({ disk, project: oiiiTest } = buildView(catalog, disk, settings, oiiiTest, "2026-09-14T09:00:00.000Z"))
  const oiiiPaths = projectPaths({ settings }, oiiiTest)!
  disk = writeFiles(disk, [imageFile(`${oiiiPaths.output}/NGC7000-OIII-test.tif`, "2026-09-15T21:00:00.000Z", null, { sizeBytes: 156_500_000 })])
  const closedAt = "2026-09-16T09:10:00.000Z"
  oiiiTest = {
    ...oiiiTest,
    output: { "NGC7000-OIII-test.tif": { kind: "final-image", channel: "OIII", copiedFrom: null, at: "2026-09-15T21:05:00.000Z" } },
    wrapUp: {
      cleanup: { state: "done", at: "2026-09-16T09:00:00.000Z", operationIds: [], redo: false },
      trash: { state: "skipped", at: "2026-09-16T09:05:00.000Z", operationIds: [], redo: false },
      archive: { state: "skipped", at: closedAt, operationIds: [], redo: false },
    },
    state: "closed",
    closedAt,
  }
  oiiiTest = { ...oiiiTest, snapshot: closeSnapshot(catalog, oiiiTest, closedAt) }

  catalog.projects = {
    [PROJECT.cygnus]: cygnus,
    [PROJECT.mosaic]: mosaic,
    [PROJECT.m31]: m31Project,
    // "Heart and Soul": no sessions yet; its matching sessions still need review.
    [PROJECT.heart]: project({
      id: PROJECT.heart,
      name: "Heart and Soul",
      notes: m.seed_project_heart_notes(),
      subjects: heartIds.map((x, i) => subject(`sub_heart_${i + 1}`, catalog.sessions[x.id]!.target.value!)),
      rigIds: [RIG.redcat],
      goals: heartIds.flatMap((_, i) => [goal(`goal_heart_${i + 1}_ha`, `sub_heart_${i + 1}`, "Ha", 10), goal(`goal_heart_${i + 1}_oiii`, `sub_heart_${i + 1}`, "OIII", null, null, { frameCount: 120 })]),
      createdAt: "2026-09-14T19:00:00.000Z",
    }),
    [PROJECT.oiii]: oiiiTest,
  }
  // A user goal template carrying every condition (C7): an FWHM bar, an edited panel balance and a season window.
  catalog.goalTemplates = {
    gtpl_user_hoo_mosaic: {
      id: "gtpl_user_hoo_mosaic",
      name: m.seed_template_hoo_mosaic(),
      source: "user",
      values: (["Ha", "OIII"] as const).map((channel) => ({ channel, integrationS: 4 * 3600, frameCount: null, qualityBar: qualityBarFor(3.5) })),
      conditions: { panelBalancePct: 15, window: { kind: "season" } },
    },
  }

  /** Move each frame's copy to the OS Trash as one recorded episode, as the Trash engine would have. */
  const trashFrames = (episodeId: string, kind: TrashEpisodeKind, at: string, projectId: string | null, assetIds: string[], quality: "unusable" | null) => {
    const items = assetIds.map((id) => {
      const asset = catalog.assets[id]!
      const copy = asset.copies[0]!
      return { path: copy.path, volumeId: copy.volumeId, sizeBytes: asset.sizeBytes, assetId: id, outcome: "trashed" as const, reason: null }
    })
    for (const item of items) {
      const key = fileKey(item.volumeId, item.path)
      const { [key]: file, ...rest } = disk.files
      disk = { ...disk, files: rest, trash: [...disk.trash, { file: file!, originalPath: item.path, trashedAt: at }] }
      const asset = catalog.assets[item.assetId]!
      catalog.assets[item.assetId] = { ...(quality ? decided(asset, quality, "2026-09-06T10:00:00.000Z") : asset), trashed: { at, episodeId } }
    }
    catalog.trashEpisodes = { ...catalog.trashEpisodes, [episodeId]: { id: episodeId, kind, at, projectId, items, operationId: null } }
  }
  // The 25 Aug M 31 test session was moved to the OS Trash from M 31's Wrap up.
  const testTrashAt = "2026-09-12T09:30:00.000Z"
  trashFrames("trash_m31_test", "rejected-frames", testTrashAt, PROJECT.m31, s.m31test.assetIds, "unusable")

  // Calibration processes (P-CAL3). Indexing routed each raw session into a process awaiting Stack;
  // the Ha flat still waits. 300 s darks and bias finished in PixInsight (raws trashed, raws kept),
  // 120 s darks are mid-stack, and the OIII flat's Stack output was not found.
  const rawSession = (imageType: ImageType, predicate: (x: Session) => boolean) => findSession(catalog, (x) => x.imageType === imageType && x.cameraName === REDCAT.instrument && predicate(x))
  const dark300 = rawSession("dark", (x) => x.exposureS === 300)
  const dark120 = rawSession("dark", (x) => x.exposureS === 120)
  const biasRaw = rawSession("bias", () => true)
  const flatOiii = rawSession("flat", (x) => x.channel === "OIII")
  const stacking = `${PROCESSING}/Stacking`
  const processOf = (x: Session) => catalog.calibrationProcesses[processIdFor(x.id)]!
  const finishProcess = (x: Session, output: string, storedPath: string, stackedAt: string, at: string, raws: "trashed" | "kept") => {
    const master = Object.values(catalog.masters).find((mst) => mst.versions.some((v) => v.path.endsWith(storedPath)))!
    const version = master.versions.find((v) => v.path.endsWith(storedPath))!
    const stored = fileAt(disk, version.path)!
    const toolOutput = makeFile({ path: `${output}/${fileName(version.path)}`, volumeId: A, sizeBytes: stored.sizeBytes, kind: "xisf", header: stored.header, sha256: stored.sha256, modifiedAt: at })
    disk = writeFiles(disk, [toolOutput])
    const ncombine = stored.header?.ncombine ?? null
    catalog.masters[master.id] = {
      ...master,
      versions: master.versions.map((v) =>
        v.id === version.id ? { ...v, origin: { kind: "stacked", projectId: null, sourcePath: toolOutput.path, sessionId: x.id }, adoption: { destinationPath: v.path, verifiedSha256: stored.sha256, adoptedAt: at } } : v,
      ),
    }
    catalog.calibrationProcesses[processIdFor(x.id)] = {
      ...processOf(x),
      profileId: PROFILE_IDS.pixinsight,
      outputFolder: output,
      detected: { path: toolOutput.path, sha256: stored.sha256, ncombine },
      storagePath: version.path,
      masterId: master.id,
      versionId: version.id,
      raws,
      steps: { stack: stepRecord("done", stackedAt), detect: stepRecord("done", at), import: stepRecord("done", at), register: stepRecord("done", at), raws: stepRecord("done", at) },
      updatedAt: at,
    }
  }
  catalog.calibrationProcesses = { ...catalog.calibrationProcesses }
  finishProcess(dark300, `${stacking}/Dark 300 s 8 Sep`, "300s_g100_o50_-10C/MasterDark_2026-09-08.xisf", "2026-09-08T18:20:00.000Z", "2026-09-08T19:10:00.000Z", "trashed")
  trashFrames("trash_cal_dark300", "calibration-raws", "2026-09-08T19:11:00.000Z", null, dark300.assetIds, null)
  finishProcess(biasRaw, `${stacking}/Bias 8 Sep`, "Bias/ZWO ASI2600MM Pro/g100_o50/MasterBias_2026-09-08.xisf", "2026-09-08T19:30:00.000Z", "2026-09-08T20:00:00.000Z", "kept")
  const dark120Output = `${stacking}/Dark 120 s 8 Sep`
  disk = createFolder(disk, { volumeId: A, path: dark120Output })
  const stackDark120: Operation = {
    id: "op_stack_dark120",
    kind: "stack-master",
    title: msg("store_cal_stack_title", { name: processRef(catalog, processOf(dark120)) }),
    status: "running",
    scope: { sessionIds: [dark120.id] },
    progress: { done: 0, total: 0, unit: "frames" },
    items: [],
    summary: null,
    canPause: false,
    canCancel: true,
    payload: { processId: processIdFor(dark120.id) },
    createdAt: "2026-10-04T07:50:00.000Z",
    updatedAt: "2026-10-04T07:50:00.000Z",
    settledAt: null,
  }
  catalog.calibrationProcesses[processIdFor(dark120.id)] = {
    ...processOf(dark120),
    profileId: PROFILE_IDS.pixinsight,
    outputFolder: dark120Output,
    operationId: stackDark120.id,
    steps: { ...processOf(dark120).steps, stack: stepRecord("done", stackDark120.createdAt), detect: stepRecord("running", stackDark120.createdAt) },
    updatedAt: stackDark120.createdAt,
  }
  const oiiiOutput = `${stacking}/Flat OIII 26 Sep`
  disk = writeFiles(disk, [makeFile({ path: `${oiiiOutput}/PixInsight.log`, volumeId: A, sizeBytes: 18_400, kind: "log", modifiedAt: "2026-09-27T09:08:00.000Z" })])
  catalog.calibrationProcesses[processIdFor(flatOiii.id)] = {
    ...processOf(flatOiii),
    profileId: PROFILE_IDS.pixinsight,
    outputFolder: oiiiOutput,
    steps: { ...processOf(flatOiii).steps, stack: stepRecord("done", "2026-09-27T08:00:00.000Z"), detect: stepRecord("failed", "2026-09-27T09:10:00.000Z", msg("store_cal_tool_output_not_found")) },
    updatedAt: "2026-09-27T09:10:00.000Z",
  }

  // One drifted-content frame: an M 31 L frame changed on disk after review (LIB-FR-09).
  const driftedId = s.m31.L.assetIds[6]!
  const drifted = catalog.assets[driftedId]!
  const driftedPath = drifted.copies[0]!.path
  const driftedSha = fakeSha256(driftedPath, 1)
  disk.files[fileKey(A, driftedPath)] = { ...fileAt(disk, driftedPath)!, sha256: driftedSha, modifiedAt: "2026-09-20T22:14:00Z" }
  catalog.assets[driftedId] = { ...drifted, sha256: driftedSha, copies: drifted.copies.map((c) => ({ ...c, sha256: driftedSha })) }

  // Cold-1 was disconnected after its sessions were added to Projects.
  disk.volumes[VOLUME_IDS.cold] = { ...disk.volumes[VOLUME_IDS.cold]!, mounted: false }

  // Removable devices connected when the demo loads: an ASIAIR card (recognised layout) and a generic USB stick.
  for (const id of [VOLUME_IDS.asiair, VOLUME_IDS.usb]) {
    disk.volumes[id] = { ...disk.volumes[id]!, mounted: true }
    disk = writeFiles(disk, deviceFiles(disk, id))
  }
  // A saved Import source for "Import new" (STO-IMP-FR-01): the ASIAIR device's folder.
  catalog.importSources = { src_asiair: { id: "src_asiair", name: "ASIAIR", path: "/Volumes/ASIAIR", lastImportedAt: "2026-10-03T08:00:00.000Z", importedSha256: [] } }

  // Tonight's plan at the default site: NGC 7000 and M 33 (Round 6: each night has its own plan).
  for (const targetId of [ngc, s.m33.target.value!]) {
    catalog.plans[targetId] = { targetId, nights: [tonight], criteria: { minAltitudeDeg: 25, darkness: "astronomical", maxMoonIlluminationPct: null, minMoonSeparationDeg: null, minDurationMin: 60 }, updatedAt: "2026-10-01T18:00:00.000Z" }
  }

  const m31Entries = m31Project.view!.entries.length
  const cleanupM31: Operation = {
    id: "op_cleanup_m31",
    kind: "cleanup",
    title: msg("store_label_clean_up_named", { name: m31Project.name }),
    status: "succeeded",
    scope: { projectId: PROJECT.m31 },
    progress: { done: m31Entries, total: m31Entries, unit: "entries" },
    items: [],
    summary: msg("seed_cleanup_summary", { count: m31Entries, n: formatCount(m31Entries) }),
    canPause: false,
    canCancel: false,
    payload: {},
    createdAt: "2026-09-10T08:30:00.000Z",
    updatedAt: trashAt,
    settledAt: trashAt,
  }
  const cygEntries = cygnus.view!.entries.length
  const applyCygnus: Operation = {
    id: cygnus.view!.operationId,
    kind: "apply",
    title: msg("common_apply_named", { name: cygnus.name }),
    status: "succeeded",
    scope: { projectId: PROJECT.cygnus },
    progress: { done: cygEntries, total: cygEntries, unit: "entries" },
    items: [],
    summary: msg("op_apply_swapped", { entries: unitCount("entries", cygEntries) }),
    canPause: false,
    canCancel: false,
    payload: {},
    createdAt: "2026-10-01T08:58:00.000Z",
    updatedAt: cygnus.view!.at,
    settledAt: cygnus.view!.at,
  }
  // Refusals Wrap up's Trash shows: one rejected M 31 L frame and one duplicate copy of an R frame on Spare lost write
  // permission, so each offer lists a refused item with its reason (D-W57).
  const lockedReject = catalog.assets[s.m31.L.assetIds[2]!]?.copies[0]?.path
  const lockedDuplicate = s.m31.R.assetIds.map((id) => catalog.assets[id]?.copies.find((c) => c.path.startsWith("/Volumes/Spare/"))?.path).find((p) => p !== undefined)
  disk = { ...disk, readOnlyPaths: [lockedReject, lockedDuplicate].filter((p): p is string => p !== undefined) }

  // The NAS scan is running when the demo loads; it reads one file at a time (D-W12).
  const nasPending = nasFiles().map((f) => f.path)
  const scan: Operation = {
    id: "op_index_nas",
    kind: "index",
    title: msg("op_index_title_one", { name: "NAS captures" }),
    status: "running",
    scope: { locationIds: ["loc_nas"] },
    progress: { done: 0, total: nasPending.length, unit: "files" },
    items: [{ id: "loc_nas", label: verbatim("NAS captures"), path: "/Volumes/NAS/Captures", status: "running", phase: null, detail: msg("op_index_files_to_read", { count: nasPending.length, n: formatCount(nasPending.length) }) }],
    summary: null,
    canPause: true,
    canCancel: true,
    payload: { queue: [], current: { locationId: "loc_nas", pending: nasPending, observed: [] }, counts: { discovered: nasPending.length, read: 0, unsupported: 0, unreadableFolders: 0 } },
    createdAt: "2026-10-04T07:58:00.000Z",
    updatedAt: "2026-10-04T07:58:00.000Z",
    settledAt: null,
  }

  const activity: ActivityEvent[] = [
    { id: "act_apply_cygnus", at: applyCygnus.settledAt!, kind: "operation", title: applyCygnus.title, status: "succeeded", detail: applyCygnus.summary, operationId: applyCygnus.id, href: projectHref(PROJECT.cygnus, { stage: "view" }) },
    { id: "act_trash_m31", at: testTrashAt, kind: "operation", title: msg("seed_move_rejected_title", { count: 8, n: formatCount(8) }), status: "succeeded", detail: msg("seed_trash_m31_detail", { frames: unitCount("frames", 8), session: "M 31 25 Aug L" }), operationId: null, href: projectHref(PROJECT.m31) },
    { id: "act_cleanup_m31", at: trashAt, kind: "operation", title: cleanupM31.title, status: "succeeded", detail: cleanupM31.summary, operationId: cleanupM31.id, href: projectHref(PROJECT.m31, { stage: "wrap-up" }) },
    { id: "act_stack_oiii", at: "2026-09-27T09:10:00.000Z", kind: "operation", title: msg("store_cal_stack_title", { name: processRef(catalog, processOf(flatOiii)) }), status: "failed", detail: msg("store_cal_failed_at", { reason: msg("store_cal_tool_output_not_found"), step: CALIBRATION_STEP_NAME.detect }), operationId: null, href: "/calibration" },
    { id: "act_stack_dark300", at: "2026-09-08T19:10:00.000Z", kind: "operation", title: msg("store_cal_stack_title", { name: processRef(catalog, processOf(dark300)) }), status: "succeeded", detail: msg("store_cal_registered_from", { file: "MasterDark_2026-09-08.xisf", frames: unitCount("frames", 30) }), operationId: null, href: "/calibration" },
  ]
  return { seed: "demo", disk, catalog, operations: { [cleanupM31.id]: cleanupM31, [applyCygnus.id]: applyCygnus, [scan.id]: scan, [stackDark120.id]: stackDark120 }, activity, settings, faults: defaultFaults() }
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
