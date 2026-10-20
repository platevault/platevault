/**
 * Shared domain contract for the PlateVault prototype, harness v5
 * (foundation-owned).
 *
 * Vocabulary follows specs 063-072 and the workflow decisions D-W1 to D-W116
 * (`specs/063-clean-rebuild-contract/workflow-decisions.md`), with the F4
 * Project model (D-W93 to D-W116): a Project holds explicit sessions in
 * groups; calibration is matched at ingestion and pinned on each session; one
 * View per Project is rebuilt from the originals by Apply; Results live in
 * the Project's Output folder; Close locks a Project for good. There are no
 * runs, membership revisions, preparations or Result records.
 * Screens read and write these entities through the store; they never
 * redefine them. Screen-local UI state lives in `src/store/slices/<slice>.ts`.
 * A screen that needs a change here messages the integration owner instead of
 * editing this file.
 *
 * Two worlds are modelled:
 * - `Disk`: the simulated computer outside PlateVault (volumes, files,
 *   access, OS Trash, application bundles). Prototype controls and app
 *   operations change it.
 * - `Catalog`: what PlateVault has indexed and decided. Indexing reads the
 *   disk into the catalog; it never writes source files.
 *
 * Dropped by the contract and absent here: the Inbox (D-W24, D-W33), Project
 * session links (D-W34), View origins and stand-alone Views (D-W1), project
 * checklist kinds other than goals (D-W29), the global filter list (D-W31),
 * "File into library" filing (D-W11), the Abandoned state (D-W72), the
 * naming "Auto-apply pattern" (D-W58), and every run concept (D-W94).
 */
import type { MessageRef } from "@/lib/i18n"
import type { FrameTotals } from "./library"
import type { MoonAvoidance } from "./planning"

export type IsoDateTime = string
/** Local observing-night date, `YYYY-MM-DD` of the evening the night began. */
export type NightDate = string

export type VolumeId = string
export type LocationId = string
export type AssetId = string
export type SessionId = string
export type TargetId = string
export type ProjectId = string
export type ProjectGroupId = string
export type SubjectId = string
export type GoalId = string
export type GoalTemplateId = string
export type TrashEpisodeId = string
export type ImportSourceId = string
export type MasterId = string
export type ProfileId = string
export type MasterVersionId = string
export type RigVersionId = string
export type OperationId = string
export type CameraId = string
export type TelescopeId = string
export type OpticalTrainId = string
export type ReducerId = string
export type FilterId = string
export type SiteId = string
export type MeasurementImportId = string
export type CalibrationProcessId = string

// ---------------------------------------------------------------------------
// Simulated disk
// ---------------------------------------------------------------------------

export interface Volume {
  id: VolumeId
  name: string
  mountPath: string
  /** Volume identity proof. A different volume at the same path has another uuid. */
  volumeUuid: string
  mounted: boolean
  writable: boolean
  /** "unsupported" covers locations whose OS removal deletes immediately. */
  trash: "supported" | "unsupported"
  capacityBytes: number
  /** The file system can hold symlinks, so a Symlinks run view can be written onto it (P-PREP3). */
  symlinks: boolean
  /** An OS-mounted network share: hashed resumably with progress, Offline when unmounted (D-W12). */
  network: boolean
  /** A USB or SD device: detected when connected and offered by Import (`removableDevices`). */
  removable: boolean
}

export type ImageType =
  | "light"
  | "dark"
  | "flat"
  | "bias"
  | "dark-flat"
  | "master-dark"
  | "master-flat"
  | "master-bias"
  | "master-dark-flat"
  | "unknown"

/** Observed header metadata as read from the source file. */
export interface FrameHeader {
  imageType: ImageType
  object: string | null
  filter: string | null
  exposureS: number
  dateObs: IsoDateTime
  instrument: string | null
  telescope: string | null
  focalLengthMm: number | null
  binning: number
  gain: number | null
  offset: number | null
  ccdTempC: number | null
  /** Pointing in degrees; null when the header has no pointing evidence. */
  ra: number | null
  dec: number | null
  rotationDeg: number | null
  widthPx: number
  heightPx: number
  pixelSizeUm: number | null
  /** Recorded CFA pattern for one-shot-colour data; null for mono. */
  bayerPattern: string | null
  siteLat: number | null
  siteLon: number | null
  /** NCOMBINE: how many frames a master was stacked from; null on raw frames. */
  ncombine: number | null
}

/** FITS keyword names, used when disclosing header evidence. */
export const HEADER_KEYWORDS: Record<keyof FrameHeader, string> = {
  imageType: "IMAGETYP",
  object: "OBJECT",
  filter: "FILTER",
  exposureS: "EXPTIME",
  dateObs: "DATE-OBS",
  instrument: "INSTRUME",
  telescope: "TELESCOP",
  focalLengthMm: "FOCALLEN",
  binning: "XBINNING",
  gain: "GAIN",
  offset: "OFFSET",
  ccdTempC: "CCD-TEMP",
  ra: "RA",
  dec: "DEC",
  rotationDeg: "ROTATANG",
  widthPx: "NAXIS1",
  heightPx: "NAXIS2",
  pixelSizeUm: "XPIXSZ",
  bayerPattern: "BAYERPAT",
  siteLat: "SITELAT",
  siteLon: "SITELONG",
  ncombine: "NCOMBINE",
}

export type DiskFileKind = "fits" | "xisf" | "tiff" | "csv" | "log" | "text" | "other"

/**
 * Simulated pixel facts behind a light or calibration file. Measurement
 * simulations derive plausible values from these; the UI never shows them
 * directly, so the prototype stays honest about what was "measured".
 */
export interface PixelTruth {
  fwhmPx: number
  eccentricity: number
  starCount: number
  background: number
  saturatedStars: number
  invalidSamples: number
  trailed: boolean
}

export interface DiskFile {
  /** Absolute POSIX path. Unique per volume; see `fileKey` in disk.ts. */
  path: string
  volumeId: VolumeId
  sizeBytes: number
  sha256: string
  /** Bytes before the last external overwrite, so the prototype can restore them (J22 S15b, LIB-AC-14). */
  previousSha256: string | null
  /** Files sharing an inode share bytes. */
  inode: number
  kind: DiskFileKind
  header: FrameHeader | null
  /** Set for symlinks; the link itself holds no image bytes. */
  linkTarget: string | null
  /** True while an external application is still writing the file. */
  growing: boolean
  modifiedAt: IsoDateTime
  /** Simulated pixel facts; null for non-image files and links. */
  pixelTruth: PixelTruth | null
}

export interface TrashedFile {
  file: DiskFile
  originalPath: string
  trashedAt: IsoDateTime
}

/** An explicit folder (it may be empty). Folders that hold files also exist implicitly. */
export interface DiskFolder {
  volumeId: VolumeId
  path: string
}

/** An application bundle on the simulated computer, outside PlateVault. */
export interface SimulatedApp {
  id: string
  name: string
  path: string
  /** The bundle exists at `path`. */
  present: boolean
  /** The next launch of this bundle fails. */
  launchFails: boolean
}

export interface Disk {
  volumes: Record<VolumeId, Volume>
  /**
   * Keyed by `fileKey(volumeId, path)`: two volumes mounted at one path (the
   * impostor Archive) never overwrite each other's records. Look a path up
   * with `fileAt(disk, path)`, which resolves the volume mounted there.
   */
  files: Record<string, DiskFile>
  folders: DiskFolder[]
  /** Folders whose access is denied. Descendants are unreadable. */
  deniedPaths: string[]
  /** Folders or files that can be read but not written (write permission removed). */
  readOnlyPaths: string[]
  trash: TrashedFile[]
  /** Application bundles installed on the simulated computer (PREP-FR-01). */
  apps: SimulatedApp[]
}

// ---------------------------------------------------------------------------
// Library: locations, assets, sessions, targets, equipment (PV-LIB)
// ---------------------------------------------------------------------------

export type LocationRole = "captures" | "calibration" | "results" | "archive"

export interface Location {
  id: LocationId
  displayName: string
  path: string
  volumeId: VolumeId
  role: LocationRole
  registeredAt: IsoDateTime
  /** Last observed access state. "denied" offers Choose folder again or Retry. */
  access: "ok" | "denied" | "unknown"
  lastIndexedAt: IsoDateTime | null
  /** Scope of the last indexing run for this location. */
  scanScope: "never" | "complete" | "incomplete"
  /** Folders that could not be read during the last run. */
  unreadablePaths: string[]
  lastScanOperationId: OperationId | null
  /**
   * Set by a reviewed Retire location (LIB-FR-15, D11). A retired location is
   * never reselected, rescanned or remapped; its copies read Retired and leave
   * integration totals. Absent on locations saved before retirement existed.
   */
  retiredAt?: IsoDateTime
}

/** Live availability, derived from the disk (volume mounted); "retired" after Retire location (D11). */
export type Availability = "online" | "offline" | "retired"

export type QualityValue = "unreviewed" | "usable" | "unusable"

export interface QualityDecision {
  value: QualityValue
  decidedAt: IsoDateTime | null
  /** Content fingerprint the decision was made against. */
  basisSha256: string | null
  /**
   * Set when a readable rescan starts over a decided asset and cleared once
   * its bytes are re-read. Until then the decision is outside applicable
   * totals; a canceled or failed rescan leaves it set (LIB-FR-09, LIB-AC-14).
   */
  verificationPending?: boolean
}

/**
 * - "observed": seen by the last complete scan of a readable scope.
 * - "unknown": its folder was unreadable or offline at the last scan.
 * - "absent": a complete scan of its readable folder did not find it.
 */
export type Presence = "observed" | "unknown" | "absent"

/** One physical copy of an asset's bytes in a registered location (LIB-AC-15, D16). */
export interface AssetCopy {
  locationId: LocationId
  volumeId: VolumeId
  path: string
  /** Bytes observed at this copy; differs from `Asset.sha256` when this copy changed (conflicting copies, LIB-AC-15). */
  sha256: string
  presence: Presence
  lastObservedAt: IsoDateTime
}

/**
 * One logical frame. Identity comes from its bytes, not its path: indexing a
 * byte-identical file elsewhere adds a copy instead of a new asset, and a move
 * keeps the asset (LIB-FR-08 counts it once).
 */
export interface Asset {
  id: AssetId
  fileName: string
  format: "fits" | "xisf"
  sizeBytes: number
  /**
   * Recorded content identity: the bytes every copy agreed on at its last
   * observation. A copy that changes while another keeps these bytes leaves
   * it unchanged; the copies then conflict (LIB-AC-15, D19).
   */
  sha256: string
  observed: FrameHeader
  imageType: ImageType
  sessionId: SessionId | null
  /** Physical copies, in the order they were found. Never empty. */
  copies: AssetCopy[]
  /** Library-scope quality decision (Unreviewed, Usable, Unusable): the first quality level (D-W42). */
  quality: QualityDecision
  /**
   * Set when an approved Trash episode moved this frame's copies to the OS
   * Trash (D-W43, D-W57). A Trashed record stays for traceability and is
   * hidden everywhere except the Sessions "Trashed" filter and the fixed
   * membership of a run that was Complete when it was trashed (D-W52).
   */
  trashed: { at: IsoDateTime; episodeId: TrashEpisodeId } | null
}

export type AssociationStatus = "confirmed" | "associated" | "needs-review" | "unresolved"

export type EvidenceSource = "header" | "pointing" | "equipment-record" | "user" | "resolver" | "catalog"

export interface Evidence {
  source: EvidenceSource
  /** A FITS keyword (`verbatim`) or a catalogue label; worded at render. */
  label: MessageRef
  value: MessageRef
  /** true agrees with the association, false conflicts, null is unknown. */
  agrees: boolean | null
}

export interface Association<T extends string> {
  value: T | null
  status: AssociationStatus
  evidence: Evidence[]
  confirmedAt: IsoDateTime | null
}

export type CorrectionField = "target" | "equipment" | "filter" | "exposure" | "focal-length"

/** Catalog-only correction. Source headers are never changed. */
export interface CatalogCorrection {
  id: string
  field: CorrectionField
  observedValue: string | null
  correctedValue: string
  at: IsoDateTime
  /** Grouping revision the correction created. */
  revision: number
}

/**
 * Metadata-homogeneous group of frames. A session is not tied to one
 * location: its frames may have copies in several (see `sessionLocationIds`).
 * The capture site is derived from header coordinates (`captureSite`).
 */
export interface Session {
  id: SessionId
  /** Grouping revision; corrections create a new revision. */
  revision: number
  night: NightDate
  imageType: ImageType
  /** Effective channel (filter), after catalog corrections. */
  channel: string | null
  exposureS: number
  binning: number
  gain: number | null
  offset: number | null
  ccdTempC: number | null
  cameraName: string | null
  telescopeName: string | null
  assetIds: AssetId[]
  startedAt: IsoDateTime
  endedAt: IsoDateTime
  /** OBJECT header value: a label and filter, never capture identity. */
  objectLabel: string | null
  pointing: { ra: number; dec: number; rotationDeg: number | null } | null
  target: Association<TargetId>
  equipment: Association<OpticalTrainId>
  corrections: CatalogCorrection[]
  /** Sessions this one replaced through a regrouping revision. */
  previousSessionIds: SessionId[]
  /**
   * Set when a regrouping revision replaced this session (LIB-AC-10, D15).
   * Superseded sessions stay for traceability and never count in totals.
   */
  supersededBy: SessionId | null
  /** "provisional" while a scan runs; "incomplete" when part was unreadable or the scan stopped. */
  scope: "complete" | "provisional" | "incomplete"
  /**
   * The framing within its capture key (D-W107, LIB-FR-04): 1 for the
   * night's first framing, 2 for "framing 2" and so on. Intake reads frames
   * in capture order and splits a frame whose pointing lies more than the
   * framing margin from the session's first frame, or whose ROTATANG turns
   * more than it; a meridian flip never splits. Frames with no pointing form
   * a session of their own (Framing unknown), numbered after the framings.
   */
  framing: number
  /** The rig version the session was captured with (LIB-FR-26): set with its rig and kept when the rig is edited later. */
  rigVersionId: RigVersionId | null
  /** A light session's calibration, matched at ingestion and pinned per kind (LIB-FR-23, CAL-FR-02); null for a calibration session. */
  calibration: SessionCalibration | null
}

export interface Target {
  id: TargetId
  name: string
  aliases: string[]
  ra: number | null
  dec: number | null
  /** Angular size in degrees, when known. */
  sizeDeg: { width: number; height: number } | null
  coordinateSource: "catalog" | "user" | "resolver" | "unknown"
  resolver: { provider: string; fetchedAt: IsoDateTime; objectType: string | null } | null
  notes: string
  /** ★ favourite: listed in My targets (D-W60). */
  favourite: boolean
  createdAt: IsoDateTime
  revision: number
}

/** Where an equipment record came from: entered by the user, detected from headers, or shipped. */
export type RecordSource = "manual" | "detected" | "built-in"

export type CameraKind = "mono" | "osc"

export interface Camera {
  id: CameraId
  name: string
  aliases: string[]
  source: RecordSource
  widthPx: number
  heightPx: number
  pixelSizeUm: number
  /** Mono or OSC comes from the camera, never from the filter list (D-W31, PLAN-EQ-FR-02). */
  kind: CameraKind
  /**
   * The unique name of this physical camera (LIB-FR-26): needed once the
   * rigs hold two cameras of one model, so darks and bias link to one of
   * them at import. Distinct from `aliases`, the header names it matches.
   */
  physicalAlias: string | null
  /** "Don't use darks": its sessions settle as No darks with no warning, overridable per session (CAL-FR-22). */
  noDarks: boolean
  /** "Don't use bias": its sessions settle as No bias with no warning, overridable per session (CAL-FR-22). */
  noBias: boolean
}

export interface Telescope {
  id: TelescopeId
  name: string
  aliases: string[]
  source: RecordSource
  focalLengthMm: number
  apertureMm: number | null
}

/**
 * The optics of one dated rig version (PLAN-EQ-FR-07): editing a rig adds a
 * version from a night on; a session keeps the version it was captured
 * with, so a later edit never remaps it. Flats need the lights' exact
 * version (CAL-FR-19); Project grouping starts a new group only when the
 * optics change (camera, focal length, reducer; PRJ-FR-31).
 */
export interface RigVersion {
  id: RigVersionId
  /** The first observing night the version applies to. */
  from: NightDate
  cameraId: CameraId | null
  telescopeId: TelescopeId | null
  reducerId: ReducerId | null
  effectiveFocalLengthMm: number
  filterIds: FilterId[]
  /** A rotator: a flat with no ROTATANG reads unknown rotation, so it is only suggested (CAL-FR-20). */
  rotator: boolean
}

/**
 * A rig: one optical train (camera plus telescope, optionally a reducer)
 * taking part in Projects (D-W37). It selects its parts and its filters from
 * the Equipment records and edits none of them (ngm9g, C E2). Its filters
 * drive the Targets band strip, the narrowband presets and the Fit column
 * (D-W31).
 */
export interface OpticalTrain {
  id: OpticalTrainId
  name: string
  /** "detected" until the user confirms it (Confirm equipment promotes it to "manual"); a rig added by hand is "manual". */
  source: RecordSource
  /** The current version's optics: the top-level fields are the newest version, `history` the earlier ones. */
  cameraId: CameraId | null
  telescopeId: TelescopeId | null
  /** The reducer or extender in the train; null or absent without one. The effective focal length already includes its factor. */
  reducerId?: ReducerId | null
  effectiveFocalLengthMm: number
  notes: string
  /** The filters the rig carries, the same form for mono and OSC cameras (PLAN-EQ-FR-01); Mono or OSC still comes from the camera. */
  filterIds: FilterId[]
  rotator: boolean
  /** The current version's id and first night. */
  versionId: RigVersionId
  versionFrom: NightDate
  /** Earlier versions, oldest first, frozen as they were (PLAN-EQ-FR-07). */
  history: RigVersion[]
}

/** A focal reducer or extender: its factor scales the telescope's focal length (0.8 for a 0.8× reducer, 2 for a 2× Barlow). */
export interface Reducer {
  id: ReducerId
  name: string
  factor: number
}

/** The seven bands of the Targets Filters strip (PLAN-TGT-FR-06). */
export type Band = "L" | "R" | "G" | "B" | "Ha" | "SII" | "OIII"

/** A filter record (Settings › Equipment › Filters, ngm9g); rigs select it by id. */
export interface Filter {
  id: FilterId
  name: string
  /** FITS FILTER header values this filter matches, compared case-insensitively. */
  matches: string[]
  /** Bands the filter passes; a dual-band filter passes two. */
  bands: Band[]
}

export interface ObservingSite {
  id: SiteId
  name: string
  latitude: number
  longitude: number
  elevationM: number | null
  /** IANA time zone. */
  timeZone: string
  twilight: "astronomical" | "nautical"
  minAltitudeDeg: number
}

// ---------------------------------------------------------------------------
// Projects (PV-PRJ)
// ---------------------------------------------------------------------------

/**
 * A Project subject: a Target (D-W9). Suggestions are sessions whose
 * confirmed Target is `targetId` on one of the Project's rigs (PRJ-FR-09).
 * A mosaic is not a subject mode: marking a group as a panel makes the
 * Project a mosaic (PRJ-FR-29).
 */
export interface Subject {
  id: SubjectId
  targetId: TargetId
  /** Goal conditions beside the goals (C7). Absent reads as `DEFAULT_SUBJECT_CONDITIONS` (`subjectConditions` in templates.ts). */
  conditions?: SubjectConditions
}

/**
 * A subject's optional deadline (C7): "Finish by" a night, or a season window
 * from one night to another, pre-filled from the Target's visibility
 * (`seasonWindow` in planning.ts). Both ends are nights (evening dates) and
 * count as included.
 */
export type SubjectWindow = { kind: "finish-by"; night: NightDate } | { kind: "season"; from: NightDate; to: NightDate }

/** The goal conditions a subject holds beside its per-channel goals (C7, `HARNESS-V5-FEEDBACK-R1.md` "Goals, grilling round 4"). */
export interface SubjectConditions {
  /**
   * Mosaic panel balance: per channel, every panel's counted amount stays
   * within ± this many percent of the panels' mean (`panelBalance` in
   * derive.ts). Kept inside `PANEL_BALANCE_LIMITS` by `clampPanelBalance`.
   */
  panelBalancePct: number
  window: SubjectWindow | null
}

/**
 * A quality bar (D-W29, PRJ-FR-03, C7). A goal counts Usable frames, and the
 * optional bar narrows them to "FWHM ≤ x″": `usable-only` without a bar,
 * `usable-max-fwhm` with one (`qualityBarFor` writes these, `fwhmBar` reads x).
 * Frames the bar cannot judge do not count. `max-fwhm` (FWHM without the
 * Usable mark) and a null bar (any frame) are read as before and are
 * deprecated: C7 counts Usable frames only, so W3's editors stop writing them
 * and W4 removes them.
 */
export type QualityBar = { kind: "usable-only" } | { kind: "max-fwhm"; maxArcsec: number } | { kind: "usable-max-fwhm"; maxArcsec: number }

/**
 * A goal channel is a chip from the band set, or the derived OSC channels:
 * "OSC" (no filter or a broadband filter on an OSC camera) and "Dual-band"
 * (a filter passing two narrow bands). Never free text (`GOAL_CHANNELS`).
 */
export type GoalChannel = Band | "OSC" | "Dual-band"

/**
 * Goals for one subject (or one mosaic panel group) and one channel (D-W29).
 * A row holds one amount, time or frames (C7, `goalAmount`), and a quality
 * bar. Exposure mismatch is a derived warning, never a goal.
 */
export interface Goal {
  id: GoalId
  subjectId: SubjectId
  /** Set for a mosaic: each panel group carries its own goals (PRJ-FR-29). */
  groupId: ProjectGroupId | null
  channel: GoalChannel
  integrationS: number | null
  frameCount: number | null
  qualityBar: QualityBar | null
}

/**
 * A removed subject's goal, kept hidden by its Target with its id and edited
 * values (D-W128): it shows and counts nowhere until that Target is a subject
 * again, when it comes back unless its panel group is gone or no longer a panel.
 */
export type HiddenGoal = Omit<Goal, "subjectId"> & { targetId: TargetId }

/** The three Wrap up steps, in their strict order (PRJ-FR-14, C3): Clean up → Trash → Archive, whose last action is Close project. */
export type WrapUpStepId = "cleanup" | "trash" | "archive"

/** A Wrap up step the user finished or skipped; an absent step is still to do. */
export interface WrapUpStepRecord {
  state: "done" | "skipped"
  at: IsoDateTime
  /**
   * The operations its Proceed started (F2). The step reads Finished once
   * every one succeeded; while one runs it reads Running, and a failed,
   * partial or canceled one returns it to To do. Empty when nothing moved.
   */
  operationIds: OperationId[]
  /** An earlier step was reopened after this one settled (F5): it reads Redo until Proceed records it again. */
  redo: boolean
}

/**
 * A group of a Project's sessions (PRJ-FR-27 to PRJ-FR-29): one rig and
 * framing, or a mosaic panel. It holds whole sessions only. Its folder is
 * `GROUP_<name>` or `PANEL_<name>` once the Project has two or more groups.
 */
export interface ProjectGroup {
  id: ProjectGroupId
  /** Prefilled when created ("<Rig>", "<Rig> · Framing 2", "Panel N", "<Rig> · 2"); a rename changes the folder on the next Apply. */
  name: string
  /** A mosaic panel: its folder uses the PANEL keyword, and a Project with one is a mosaic (PRJ-FR-29). */
  panel: boolean
  createdAt: IsoDateTime
}

/**
 * One session the Project holds (PRJ-FR-08, VSEL-FR-10): added by the user
 * only, never by a suggestion. Its Usable frames are in; library-Unusable
 * frames stay out unless `included` names them; `excluded` leaves out frames
 * for this Project only. Files, the library and other Projects never change.
 */
export interface ProjectInput {
  sessionId: SessionId
  groupId: ProjectGroupId
  /** Frames this Project leaves out. */
  excluded: AssetId[]
  /** Library-Unusable frames this Project includes explicitly (VSEL-FR-15). */
  included: AssetId[]
}

/** The GROUP and PANEL keyword names (PRJ-FR-28): Settings holds the defaults, a Project may override them. */
export interface GroupKeywords {
  group: string
  panel: string
}

/** What the View step chooses (VSEL-FR-16, PREP-FR-01, PREP-FR-04); a change reaches the View through Apply. */
export interface ProjectSettings {
  /** The application the View is handed to; null until chosen. */
  profileId: ProfileId | null
  /** Symlinks or Copies (F1, F2). */
  mode: InputMode
  /** The parent folder the Project folder lives in (PREP-FR-06); null takes Settings' last chosen one. Fixed by the first Apply. */
  processingParent: string | null
  /** Keyword names for this Project; null uses Settings'. */
  keywords: GroupKeywords | null
}

/** What one View entry places: a frame, or one dated version of a master (CAL-FR-14). */
export type ViewSource = { type: "asset"; assetId: AssetId } | { type: "master"; masterId: MasterId; versionId: MasterVersionId }

/**
 * One entry an Apply placed in the View. Its name is fixed for life: the
 * next Apply keeps it for the same source, and a newcomer that clashes gets
 * a suffix (PREP-FR-19). These are custody facts, not Result lineage.
 */
export interface ViewEntry {
  /** Path under `View/`: "GROUP_RedCat-51/NIGHT_2026-09-18/Lights/Ha/Light_0001.fits". */
  path: string
  source: ViewSource
  role: "light" | "flat" | "dark" | "bias"
  /** The original it was built from, and that original's SHA-256 then (D19). */
  originalPath: string
  sha256: string
  /** Bytes a copy holds; 0 for a symlink. */
  sizeBytes: number
  /** The SHA-256 of the copy as placed (an isolated patched copy differs from its original, PREP-FR-03); null for a symlink. */
  copySha256: string | null
}

/** The layout facts that make a tool re-add the View when they change (PRJ-FR-28, PREP-FR-16). */
export interface ViewLayout {
  groupLevel: boolean
  /** GAIN_ and OFFSET_ folder tokens: the Project mixes gain or offset (D-W108). */
  gain: boolean
  offset: boolean
  /** Darks and Bias sit inside each group: the Project mixes cameras. */
  perGroupDarks: boolean
}

/**
 * The applied state: what the last Apply built and swapped in (VSEL-FR-16).
 * The Project's inputs, groups and settings are the desired state; where
 * they differ from these, the difference is a pending change.
 */
export interface AppliedView {
  at: IsoDateTime
  operationId: OperationId
  /** `<Project folder>/View`. */
  folderPath: string
  settings: ProjectSettings
  inputs: ProjectInput[]
  groups: ProjectGroup[]
  /** The calibration each session had when the View was built, so a later reassignment reads as a pending change. */
  calibration: Record<SessionId, SessionCalibration>
  entries: ViewEntry[]
  layout: ViewLayout
}

/**
 * A file the last swap left in `View (previous)/` (VSEL-FR-14, D-W110): a
 * copy that differs from what PlateVault placed, a copy whose original
 * could not be verified, or a file PlateVault didn't place that the user
 * left unticked. The next Apply waits until each is reviewed.
 */
export interface PreviousLeftover {
  /** Path under `View (previous)/`. */
  path: string
  reason: "changed-copy" | "unverified-copy" | "unplaced"
  sizeBytes: number
  /** Reviewed as Keep: it stays and is not asked about again (provisional, VSEL-AC-34). */
  kept: boolean
}

export interface PreviousView {
  /** `<Project folder>/View (previous)`. */
  folderPath: string
  at: IsoDateTime
  leftovers: PreviousLeftover[]
}

/** A Result's Kind (RES-FR-01), chosen in its dropdown. */
export type OutputKind = "final-image" | "linear-integration" | "channel-product" | "mosaic-panel" | "assembled-mosaic" | "other"

/** What the user set or did on one `Output/` file; its availability and writing state come from the disk (RES-FR-01). */
export interface OutputMeta {
  kind: OutputKind | null
  channel: string | null
  /** Copy to Output: the Processing file it copied, verified and left in place (RES-FR-02). */
  copiedFrom: string | null
  at: IsoDateTime
}

/**
 * A generated master PlateVault found in the Project's `Processing/` folder,
 * offered once per file and digest on the Output step (CAL-FR-06,
 * RES-FR-11, provisional): Hide records the decline so it does not return.
 */
export interface ProcessingMasterOffer {
  path: string
  sha256: string
  state: "offered" | "adopted" | "hidden"
  at: IsoDateTime
}

/** One goal's counted totals at Close (C7): what `goalProgress` reads for a Closed Project instead of the live library. */
export interface FrozenGoal {
  goalId: GoalId
  inProject: FrameTotals
  captured: FrameTotals
  /** Usable frames in project that the bar's FWHM limit leaves out ("+N h below bar"). */
  belowBar: FrameTotals
  unknownQuality: number
}

/**
 * What Close freezes (PRJ-FR-25): the goal figures and the calibration each
 * held session used, so later library or calibration changes never touch a
 * Closed Project. Duplicate reads the sessions' current pins, not this
 * (D-W112).
 */
export interface CloseSnapshot {
  at: IsoDateTime
  goals: FrozenGoal[]
  calibration: Record<SessionId, SessionCalibration>
}

/** Open, Closed (Close project without an archive), or Archived (its Close project archive succeeded); there is no Reopen (PRJ-FR-14, PRJ-FR-25). */
export type ProjectState = "open" | "closed" | "archived"

export interface Project {
  id: ProjectId
  name: string
  notes: string
  subjects: Subject[]
  /** Rigs taking part; suggestions are sessions on one of them (D-W37). */
  rigIds: OpticalTrainId[]
  goals: Goal[]
  /** The goals of removed subjects, kept hidden (D-W128). Absent reads as none. */
  hiddenGoals?: HiddenGoal[]
  /** The sessions it holds (desired state), each in one group. */
  inputs: ProjectInput[]
  groups: ProjectGroup[]
  settings: ProjectSettings
  /** `<Processing location>/<Project>`, fixed by the first Apply; null before it. */
  folderPath: string | null
  /** The applied View; null until the first Apply. */
  view: AppliedView | null
  /** What the last swap left in `View (previous)/`; null once it is empty. */
  previous: PreviousView | null
  /** Kind, Channel and Copy to Output records, by path under `Output/`. */
  output: Record<string, OutputMeta>
  masterOffers: ProcessingMasterOffer[]
  /**
   * Archive destination for this Project (P-ARC1); null uses the Default
   * archive location (`settings.defaultArchiveLocationId`).
   */
  archiveLocationId: LocationId | null
  /** Wrap up progress (PRJ-FR-14); Close project follows the last step. */
  wrapUp: Partial<Record<WrapUpStepId, WrapUpStepRecord>>
  state: ProjectState
  closedAt: IsoDateTime | null
  /** What Close froze; null while open. */
  snapshot: CloseSnapshot | null
  /** The sessions the Close project archive moved (STO-FR-13). */
  archive: { at: IsoDateTime; sessionIds: SessionId[] } | null
  createdAt: IsoDateTime
  revision: number
}

/** One channel of a goal template: the same amount and quality bar a Goal holds. */
export interface GoalTemplateValue {
  channel: GoalChannel
  integrationS: number | null
  frameCount: number | null
  qualityBar: QualityBar | null
}

/**
 * How a template sets a subject's window (C7): a fixed "Finish by" night, or
 * the season, pre-filled from the subject's Target visibility when the
 * template is applied (`subjectConditionsFrom` in templates.ts).
 */
export type WindowRule = { kind: "finish-by"; night: NightDate } | { kind: "season" }

/** The subject conditions a goal template carries (C7, Settings › Goal templates). */
export interface GoalTemplateConditions {
  panelBalancePct: number
  window: WindowRule | null
}

/** Built-in or user goal template; applying it copies its values into the Project (D-W30, D-W47). */
export interface GoalTemplate {
  id: GoalTemplateId
  name: string
  source: "built-in" | "user"
  values: GoalTemplateValue[]
  /** Copied into each subject it is applied to (C7). Absent reads as `DEFAULT_TEMPLATE_CONDITIONS` (`templateConditions`). */
  conditions?: GoalTemplateConditions
}

// ---------------------------------------------------------------------------
// Measurements (PV-PIX)
// ---------------------------------------------------------------------------

export type MetricKey = "fwhm" | "hfr" | "eccentricity" | "star-count" | "background" | "snr"

export interface Metric {
  key: MetricKey
  value: number | null
  unit: string
  method: string
  version: string
  source: "built-in" | "imported"
  /** Input basis, for example "linear, mono" or the CSV row it came from. */
  basis: MessageRef
  state: "valid" | "failed" | "unavailable"
  warning: MessageRef | null
}

/** One earlier measurement of an asset, kept when its bytes or method changed. */
export interface MeasurementRecord {
  inputSha256: string
  state: "valid" | "failed" | "unavailable"
  metrics: Metric[]
  computedAt: IsoDateTime
}

/**
 * Cached measurement of one asset (PIX-FR-01, PIX-AC-10). It applies only
 * while `inputSha256` equals the asset's current bytes (`measurementApplies`);
 * "verifying" means the bytes are being re-checked before reuse.
 */
export interface FrameMeasurement {
  assetId: AssetId
  state: "valid" | "pending" | "verifying" | "failed" | "unavailable"
  /** Bytes the metrics were computed from; null before the first run. */
  inputSha256: string | null
  metrics: Metric[]
  computedAt: IsoDateTime | null
  /** Earlier measurements, newest first. */
  history: MeasurementRecord[]
}

/** A row of an external measurement import that attaches to no frame until the user resolves it (PIX-FR-07). */
export interface MeasurementImportRow {
  index: number
  file: string
  /** "content-changed" / "unreadable": the named frame's bytes differed from its recorded basis, or could not be read, at mapping review; it never attaches (PIX-FR-06). */
  status: "ambiguous" | "unmatched" | "content-changed" | "unreadable" | "resolved"
  candidates: AssetId[]
  assetId: AssetId | null
  values: Partial<Record<MetricKey, number>>
}

/**
 * One external measurement import (for example a SubframeSelector CSV) and
 * the rows still to review. Matched values live in `measurements`; this keeps
 * the review rows durable across reloads.
 */
export interface MeasurementImport {
  id: MeasurementImportId
  /** The session under review the import was started from. */
  sessionId: SessionId
  path: string
  importedAt: IsoDateTime
  matched: number
  /** Matched rows whose frame is outside that session; values still attach to the frame. */
  outsideSession: number
  rows: MeasurementImportRow[]
}

// ---------------------------------------------------------------------------
// Calibration (PV-CAL)
// ---------------------------------------------------------------------------

export type CalibrationKind = "dark" | "flat" | "bias" | "dark-flat"

/** The kinds a light session pins (CAL-FR-02): dark flats are never matched, suggested or assigned (CAL-FR-01). */
export type PinKind = "dark" | "flat" | "bias"

/** One dated file of a master (CAL-FR-14): its bytes, provenance and capture date. No version is Latest. */
export interface MasterVersion {
  id: MasterVersionId
  path: string
  sha256: string
  /** DATE-OBS of the master: matching and the Old badge count from capture time, never import time (CAL-FR-21). */
  capturedAt: IsoDateTime
  frameCount: number | null
  /**
   * Where the file came from: indexed in the library, generated in a
   * Project's `Processing/` folder, stacked from a raw calibration session by
   * its calibration process, or stacked elsewhere and imported (P-CAL3).
   * `sessionId` is the raw session a stacked master came from.
   */
  origin: { kind: "library" | "generated" | "stacked" | "imported"; projectId: ProjectId | null; sourcePath: string; sessionId: SessionId | null }
  adoption: { destinationPath: string; verifiedSha256: string; adoptedAt: IsoDateTime } | null
}

/**
 * A library master (CAL-FR-14): one record with its kind, its camera (or
 * physical camera alias) and the settings it matches, and an ordered list of
 * dated versions. Adding a version moves no session.
 */
export interface CalibrationMaster {
  id: MasterId
  kind: CalibrationKind
  cameraName: string | null
  /** The physical camera it was linked to at import; null matches by model while the rigs hold one camera of it (CAL-FR-21, LIB-FR-26). */
  cameraId: CameraId | null
  widthPx: number
  heightPx: number
  binning: number
  gain: number | null
  offset: number | null
  exposureS: number | null
  channel: string | null
  /** Flats only: optical train evidence; null when unknown. */
  opticalTrainId: OpticalTrainId | null
  /** Flats only: the rig version they were taken with; the lights must have the same one (CAL-FR-19). */
  rigVersionId: RigVersionId | null
  ccdTempC: number | null
  /** Flats only: ROTATANG when the master was taken; null when unknown (CAL-FR-20). */
  rotationDeg: number | null
  /** Oldest capture first. */
  versions: MasterVersion[]
  /** Candidates are never preselected; adoption makes a master reusable. */
  state: "adopted" | "candidate"
  /** Set while the master is hidden (CAL-FR-16): it leaves the list for Show hidden and is never matched; Restore clears it. */
  hiddenAt?: IsoDateTime
}

export type MatchCriterionName =
  | "camera"
  | "dimensions"
  | "binning"
  | "gain"
  | "offset"
  | "image-type"
  | "exposure"
  | "channel"
  | "optical-train"
  | "rig-version"
  | "temperature"
  | "rotation"
  | "age"

export interface MatchCriterion {
  name: MatchCriterionName
  /** "warning": inside the hard limits but past the warning level, so the match is only suggested (CAL-FR-20, CAL-FR-21). */
  result: "compatible" | "warning" | "incompatible" | "unknown"
  lightValue: MessageRef
  calibrationValue: MessageRef
}

/** What a pin or a suggestion names: one dated master version, or a raw calibration session (CAL-FR-04, CAL-FR-14). */
export type CalibrationSource = { type: "master"; masterId: MasterId; versionId: MasterVersionId } | { type: "raw"; sessionId: SessionId }

/** Why this match (CAL-FR-03, CAL-FR-08): recorded with every pin and suggestion and kept after pinning. */
export interface MatchEvidence {
  /** The calibration's capture time; the lights' is the session's start. */
  capturedAt: IsoDateTime
  /** Flats: observing nights apart; darks and bias: days apart. Either direction. */
  apart: number
  /** Flats: the ROTATANG difference to the lights; null when unknown. */
  rotationDeltaDeg: number | null
  criteria: MatchCriterion[]
  /** The files the source places and their SHA-256 when matched (D19). */
  files: Array<{ path: string; sha256: string }>
}

/**
 * One kind's calibration on a light session (LIB-FR-23, CAL-FR-05):
 * waiting for a match; a suggestion that needs confirmation; pinned; or an
 * explicit No, which needs no reason. A pin changes only by Reassign
 * (LIB-FR-25); matching never replaces it.
 */
export type CalibrationChoice =
  | { state: "waiting" }
  | { state: "suggested"; source: CalibrationSource; evidence: MatchEvidence }
  | { state: "pinned"; source: CalibrationSource; evidence: MatchEvidence; at: IsoDateTime; by: "matching" | "user" }
  | { state: "none"; at: IsoDateTime; by: "user" | "camera-default" }

/** Settled once every kind is pinned or No (LIB-FR-23); only then can a Project add the session (PRJ-FR-08). */
export type SessionCalibration = Record<PinKind, CalibrationChoice>

/** The steps of a calibration process, in order (P-CAL3). */
export type CalibrationStepId = "stack" | "detect" | "import" | "register" | "raws"

export type CalibrationStepState = "todo" | "running" | "done" | "failed" | "skipped"

export interface CalibrationStepRecord {
  state: CalibrationStepState
  at: IsoDateTime | null
  /** Why the step failed, or why it went back to todo ("Canceled"); worded at render. */
  reason: MessageRef | null
}

/**
 * The calibration process (P-CAL3): a raw calibration session becomes a
 * master in structured calibration storage. Stack hands the raws to a tool
 * profile; PlateVault watches the output folder, detects the master
 * (IMAGETYP master, NCOMBINE), imports it per kind, registers it with
 * lineage to the raw session, then moves the raws to the OS Trash or keeps
 * them (`settings.keepRawCalibration`). Every step keeps its state, so the
 * process resumes at its first step that is not done.
 */
export interface CalibrationProcess {
  id: CalibrationProcessId
  kind: CalibrationKind
  /** The raw calibration session it stacks; null for a master stacked elsewhere and imported directly. */
  sessionId: SessionId | null
  /** The tool profile Stack handed the raws to. */
  profileId: ProfileId | null
  /** Folder the tool writes into; watched for the master. */
  outputFolder: string | null
  /** The master found in the output folder, or the file imported directly. */
  detected: { path: string; sha256: string; ncombine: number | null } | null
  /** The physical camera Import masters linked the file to (LIB-FR-26); null links none, so the master matches by model. */
  cameraId: CameraId | null
  /** Where Import put the master in structured calibration storage. */
  storagePath: string | null
  masterId: MasterId | null
  /** The version Register added to that master. */
  versionId: MasterVersionId | null
  /** What happened to the raws once the master registered. */
  raws: "trashed" | "kept" | null
  steps: Record<CalibrationStepId, CalibrationStepRecord>
  /** The operation of the running step: the output-folder watch, or the OS Trash move of the raws. */
  operationId: OperationId | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

// ---------------------------------------------------------------------------
// Application handoff (PV-PREP)
// ---------------------------------------------------------------------------

export type ApplicationKind = "pixinsight-wbpp" | "siril" | "seti-astro" | "generic"

/**
 * View modes (PREP-FR-04, F1, F2): "symlink" links each entry to its
 * catalogue original; "copy" writes copies, cloned where the volume can.
 */
export type InputMode = "symlink" | "copy"

/** Windows Developer Mode, which symlinks need on Windows (P-PREP3); "not-windows" needs no check. */
export type DeveloperMode = "not-windows" | "off" | "on"

export interface ProfileCapability {
  /** Verified only with recorded capability evidence (D04). */
  verified: boolean
  evidence: MessageRef
  inputWrite: "read-only" | "unknown" | "write-prone"
  /** Can the application read a corrected value through configuration? */
  correctedMetadata: "configuration" | "none"
  /** Stack: the application stacks a raw calibration session into a master (P-CAL3). */
  masterStacking: boolean
}

export interface ApplicationProfile {
  id: ProfileId
  application: ApplicationKind
  name: string
  executablePath: string | null
  executableState: "not-configured" | "found" | "missing" | "launch-fails"
  launchArgs: string
  capability: ProfileCapability
}

/**
 * How a corrected metadata value reaches the application for one input
 * (PREP-FR-03, PREP-AC-06): through its configuration, an isolated patched
 * copy, by accepting the source value, or by excluding the input.
 */
export interface MetadataDecision {
  assetId: AssetId
  field: CorrectionField
  observed: string | null
  corrected: string
  decision: "configuration" | "patched-copy" | "accept-source" | "excluded"
}

// ---------------------------------------------------------------------------
// Trash episodes (D-W43, D-W70, D-W72, D-W74)
// ---------------------------------------------------------------------------

export type TrashEpisodeKind =
  /** Wrap up Trash: library-Unusable frames of the Project's sessions (D-W43). */
  | "rejected-frames"
  /** Wrap up Trash: files in the Project's `Processing/` folder (PRJ-FR-15). */
  | "processing-files"
  /** Wrap up Trash: byte-identical extra copies (D-W74). */
  | "duplicate-copies"
  /** Import Move: sources sent to the OS Trash after their destination verified (D-W11). */
  | "import-move"
  /** Wrap up Clean up: the View's entries and what `View (previous)/` still holds (F1, STO-FR-01). */
  | "view-cleanup"
  /** A `View (previous)/` file the user reviewed as Trash before the next Apply (D-W110). */
  | "previous-leftovers"
  /** A calibration process's raws after their master registered (P-CAL3). */
  | "calibration-raws"
  /** A library master's files, every version, moved by Move to Trash once no Project uses it (CAL-FR-17). */
  | "calibration-master"
  /** PlateVault's own unregistered copy at an adoption's fixed destination, moved after review so the adoption can retry (CAL-FR-06). */
  | "unregistered-copy"

/**
 * One approved move to the OS Trash. Every item is either trashed or refused
 * with its reason; nothing is ever deleted permanently. Put back in the OS
 * Trash followed by a rescan restores a frame record as Unusable (D-W43).
 */
export interface TrashEpisode {
  id: TrashEpisodeId
  kind: TrashEpisodeKind
  at: IsoDateTime
  projectId: ProjectId | null
  items: Array<{
    path: string
    volumeId: VolumeId
    sizeBytes: number
    assetId: AssetId | null
    outcome: "trashed" | "refused"
    /** Why the item stayed in place (`trashRefusal`); worded at render. */
    reason: MessageRef | null
  }>
  operationId: OperationId | null
}

// ---------------------------------------------------------------------------
// Import (D-W11, D-W20, D-W24)
// ---------------------------------------------------------------------------

/** A saved Import source; Import new skips files already imported (STO-IMP-FR-01). */
export interface ImportSource {
  id: ImportSourceId
  name: string
  path: string
  lastImportedAt: IsoDateTime | null
  /** SHA-256 of every file imported from this source. */
  importedSha256: string[]
}

/** Frame types a naming template is defined for (STO-IMP-FR-07). */
export type NamingFrameType = "light" | "flat" | "dark" | "bias" | "master-flat" | "master-dark" | "master-bias" | "master-dark-flat"

/**
 * The naming tokens, each with its fallback (D-W20); `train` and `offset`
 * lay out structured calibration storage (P-CAL3).
 */
export type NamingToken = "target" | "filter" | "date" | "frame_type" | "camera" | "exposure" | "gain" | "offset" | "binning" | "set_temp" | "train"

// ---------------------------------------------------------------------------
// Observing plans (PV-PLAN)
// ---------------------------------------------------------------------------

export interface PlanCriteria {
  minAltitudeDeg: number
  darkness: "astronomical" | "nautical"
  maxMoonIlluminationPct: number | null
  minMoonSeparationDeg: number | null
  minDurationMin: number
}

/** A Target's planning record; each night in `nights` has it on that night's plan (`nightPlan`, `addToPlan`). */
export interface ObservingPlan {
  targetId: TargetId
  /** The nights (evening dates) whose plan holds the Target, in order. */
  nights: NightDate[]
  criteria: PlanCriteria
  updatedAt: IsoDateTime
}

export interface ObservingWindow {
  /** Stable identity `targetId/siteId/start` used for repeat suppression. */
  key: string
  targetId: TargetId
  siteId: SiteId
  start: IsoDateTime
  end: IsoDateTime
  maxAltitudeDeg: number
  moonIlluminationPct: number
  moonSeparationDeg: number
}

/** The default reminder lead time (PLAN-AC-15, D-W88 as amended): 12 hours. */
export const DEFAULT_REMINDER_LEAD_MIN = 12 * 60

export interface ReminderSettings {
  enabled: boolean
  /** Always the default site at the time reminders were enabled. */
  siteId: SiteId | null
  /** Minutes before a window starts; more than 30, `DEFAULT_REMINDER_LEAD_MIN` until the user picks another (PLAN-FR-06). */
  leadTimeMin: number
  permission: "not-requested" | "granted" | "denied"
  /**
   * Durable suppression (PLAN-FR-06): the Target/site/window identities
   * (`ObservingWindow.key`) already notified, coalesced into a startup
   * notice, or recorded as missed. None is notified again.
   */
  deliveredWindowKeys: string[]
  enabledAt: IsoDateTime | null
  /**
   * When PlateVault last checked the windows (launch, resume, while open).
   * The startup and resume scan looks back to it: windows that ended since
   * are recorded in Activity as missed, windows already inside the lead
   * time are coalesced into one notice (PLAN-AC-15). Null before the first check.
   */
  checkedAt: IsoDateTime | null
}

/**
 * The reminder data an Activity entry carries (PLAN-AC-15), for the bell and
 * Activity: "single", a normal notice for one window as it enters the lead
 * time; "coalesced", the one startup or resume notice for every unended
 * window already inside the lead time; "missed", a window that ended while
 * PlateVault was closed, recorded in Activity only (kind "reminder-missed")
 * and never a notification.
 */
export interface ReminderNotice {
  delivery: "single" | "coalesced" | "missed"
  windows: Array<Pick<ObservingWindow, "key" | "targetId" | "siteId" | "start" | "end">>
  /** Target names in window order; a notice shows at most three, then "N more" (`more`). */
  names: string[]
  more: number
  /** Where the notice opens: Targets for tonight. */
  href: string
}

export interface CalendarExport {
  id: string
  at: IsoDateTime
  siteId: SiteId
  timeZone: string
  from: NightDate
  to: NightDate
  fileName: string
  windows: ObservingWindow[]
}

// ---------------------------------------------------------------------------
// Operations and activity
// ---------------------------------------------------------------------------

export type OperationKind =
  | "index"
  | "measure"
  | "import-measurements"
  | "import"
  | "adopt-master"
  /** Stack: the output-folder watch of a calibration process while its tool stacks (P-CAL3). */
  | "stack-master"
  /** Duplicate scan: byte-identical live copies, after each index and import (P-STO2). */
  | "duplicate-scan"
  /** Apply: build `View (building)/` from the originals, verify, wait for a held file, swap (PREP-FR-06, PREP-FR-09, PREP-FR-18). */
  | "apply"
  /** Copy to Output: a verified copy of one Processing file (RES-FR-02). */
  | "copy-to-output"
  | "cleanup"
  | "archive"
  | "trash"

export type OperationStatus = "running" | "paused" | "succeeded" | "partial" | "failed" | "canceled" | "interrupted"

/** The one outcome an operation settles with. */
export type SettledStatus = Exclude<OperationStatus, "running" | "paused" | "interrupted">

/** What an operation counts: worded with `OPERATION_UNIT_NAME` and `unitCount` (labels.ts). */
export type OperationUnit = "files" | "frames" | "entries" | "prepared-entries" | "sessions" | "items"

export type OperationItemStatus = "pending" | "running" | "done" | "blocked" | "failed" | "skipped" | "uncertain"

export interface OperationItem {
  id: string
  /** Usually a file or location name, as data (`verbatim`). */
  label: MessageRef
  path: string | null
  status: OperationItemStatus
  /** Kind-specific phase, for example "destination-verified". */
  phase: string | null
  detail: MessageRef | null
}

export interface OperationScope {
  /** The Project it works on: one PlateVault operation per Project at a time (PREP-FR-19). */
  projectId?: ProjectId
  locationIds?: LocationId[]
  sessionIds?: SessionId[]
  targetId?: TargetId
}

/** Persisted copy is a `MessageRef`, worded at render (`say`), so Activity and progress follow a language switch. */
export interface Operation {
  id: OperationId
  kind: OperationKind
  title: MessageRef
  status: OperationStatus
  scope: OperationScope
  progress: { done: number; total: number; unit: OperationUnit }
  items: OperationItem[]
  summary: MessageRef | null
  canPause: boolean
  canCancel: boolean
  /** Kind-specific data owned by the track that registered the kind. */
  payload: Record<string, unknown>
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
  settledAt: IsoDateTime | null
}

/** "reminder": a delivered planning reminder, the simulated OS notification; "reminder-missed": a window that ended while PlateVault was closed, Activity only. */
export type ActivityKind = "operation" | "write-failed" | "write-refused" | "refusal" | "saved" | "reminder" | "reminder-missed"

export interface ActivityEvent {
  id: string
  at: IsoDateTime
  kind: ActivityKind
  title: MessageRef
  detail: MessageRef | null
  /** How an "operation" entry settled; its title is the operation's own title. */
  status?: SettledStatus
  operationId: OperationId | null
  /** Hash route of the surface that owns the outcome. */
  href: string | null
  /** An indexing outcome whose scope was incomplete, kept even when no Operation record is retained. */
  outcome?: "incomplete-scope"
  /** Set on "reminder" and "reminder-missed" entries. */
  reminder?: ReminderNotice
}

// ---------------------------------------------------------------------------
// Settings, simulation and the root state
// ---------------------------------------------------------------------------

export interface AppSettings {
  /** The one default site; Plan and Tonight use it unless another is picked. */
  defaultSiteId: SiteId | null
  planningSiteId: SiteId | null
  /** The Default archive location (P-ARC1); a Project may pick another. */
  defaultArchiveLocationId: LocationId | null
  /** One Moon-avoidance curve per filter (C6, design/R10-MOON-MODEL.md): grades and Img time (`nightImaging`). Edited through `setMoonAvoidance`, which clamps. */
  moonAvoidance: Record<Band, MoonAvoidance>
  onboarding: {
    completedAt: IsoDateTime | null
    /** Optional roles the user chose to set up later. */
    deferredRoles: LocationRole[]
    /** The orientation walk: "due" once setup ends or it is restarted, "done" once finished or skipped; absent: never offered. */
    walk?: "due" | "done"
    /** Set when the user dismissed Home's Getting started checklist. */
    checklistDismissedAt?: IsoDateTime | null
  }
  /** The last chosen Processing parent folder; no root is assumed on first use (PREP-FR-06). */
  lastProcessingParent: string | null
  /** Overridden naming templates only; the rest use the per-type defaults (STO-IMP-FR-07). */
  naming: Partial<Record<NamingFrameType, string>>
  /** Tokens a naming template leaves out when their value is missing, instead of writing their fallback (wmbp9); the folder they leave empty collapses. */
  namingOmit: NamingToken[]
  /** Keep raw calibration frames after their master registers; off moves them to the OS Trash (P-CAL3). */
  keepRawCalibration: boolean
  /** A dark or bias master whose newest version is older than this many days reads "Old · {n} d" (CAL-FR-15; flats are exempt). Not a matching window. */
  masterMaxAgeDays: number
  /** Online Target resolution (LIB-AC-12, D18). Local search always works. */
  targetLookup: {
    enabled: boolean
    provider: "cds-sesame" | "simbad"
  }
  /** The View mode a new Project starts with (PREP-FR-04). */
  defaultInputMode: InputMode
  /** The GROUP and PANEL keyword names (PRJ-FR-28); a Project may override them. */
  keywords: GroupKeywords
  /** Framing and calibration matching thresholds (D-W114), adjustable in Settings. */
  matching: MatchingSettings
  /** Windows Developer Mode as PlateVault last checked it: at launch, in setup, Settings and at Prepare (P-PREP3). */
  developerModeCheck: DeveloperMode
}

/**
 * The matching defaults the owner settled (D-W114), all adjustable:
 * framing groups sessions and splits them at intake (PRJ-FR-31, D-W107);
 * flats and darks/bias have their own windows and checks (CAL-FR-19 to
 * CAL-FR-21).
 */
export interface MatchingSettings {
  framing: {
    /** Same framing: footprints overlap at least this much. */
    overlapPct: number
    /** Same framing: centres at most this many arcminutes apart, whatever the field (default 5′). */
    centreArcmin: number
    /** Same framing: ROTATANG within this many degrees; a meridian flip (180°) is the same framing. */
    rotationDeg: number
    /** Mosaic panels overlap between these. */
    panelOverlapMinPct: number
    panelOverlapMaxPct: number
  }
  flats: {
    /** Rotation within this is fine. */
    fineDeg: number
    /** Rotation up to this warns (a suggestion); beyond it is not offered. */
    warnDeg: number
    /** Observing nights apart, either direction: 1 is the same or the next night. */
    windowNights: number
  }
  darks: {
    /** Days apart by capture time, either direction (CAL-FR-21). */
    windowDays: number
    /** Sensor temperature difference past which the match is only suggested (provisional: the legacy matcher's 2 °C, crates/calibration/core/src/ranking.rs:155). */
    temperatureWarnC: number
  }
  bias: {
    windowDays: number
    temperatureWarnC: number
  }
}

/** The two limits intake splits a capture's frames by (D-W107): Settings holds the defaults, and import review can override them for one import. */
export type FramingMargins = Pick<MatchingSettings["framing"], "centreArcmin" | "rotationDeg">

export interface SimulationFaults {
  /** The next durable catalog write fails and stays unsaved. */
  failNextCatalogWrite: boolean
  /** Response to the next OS notification permission request. */
  notificationResponse: "grant" | "deny"
  /** The next archive or adoption hash verification fails (D05, D06). */
  failNextHashVerification: boolean
  /** The next revision-checked save finds the record changed elsewhere (D08). */
  staleNextWrite: boolean
  /** The next Target resolver lookup fails as if offline (LIB-AC-12, D18). */
  failNextResolverLookup: boolean
  /** Indexing reads a few files per tick, so provisional results can be browsed at human speed (J19 S6). */
  slowIndexing: boolean
  /** Simulated clock offset; `nowIso()` adds it, and it survives a reload (J29). */
  clockOffsetMs: number
  /** Planning sees no saved site: Tonight and the Planner show "Add an observing site in Settings" (PLAN-TGT-AC-15). */
  noSite: boolean
  /** The simulated computer's Windows Developer Mode; PlateVault sees a change at its next check. */
  developerMode: DeveloperMode
  /** The Quick actions switch: how the actions the owner ticked run (astro-plan-zzjlz; prototype only, never in Settings). */
  quickActions: QuickActionMode
  /** A tool holds a file in a View (Windows): Apply waits after its build until the prototype control releases it (PREP-FR-18). */
  viewFileHeld: boolean
}

/** One-click runs a ticked action in place, with an Undo notice where it has an inverse; Open page sends it to the page that owns it. */
export type QuickActionMode = "one-click" | "open-page"

export interface Catalog {
  locations: Record<LocationId, Location>
  assets: Record<AssetId, Asset>
  sessions: Record<SessionId, Session>
  targets: Record<TargetId, Target>
  cameras: Record<CameraId, Camera>
  telescopes: Record<TelescopeId, Telescope>
  reducers: Record<ReducerId, Reducer>
  filters: Record<FilterId, Filter>
  opticalTrains: Record<OpticalTrainId, OpticalTrain>
  sites: Record<SiteId, ObservingSite>
  projects: Record<ProjectId, Project>
  /** User goal templates; the built-ins are constants (`BUILT_IN_GOAL_TEMPLATES`). */
  goalTemplates: Record<GoalTemplateId, GoalTemplate>
  measurements: Record<AssetId, FrameMeasurement>
  measurementImports: Record<MeasurementImportId, MeasurementImport>
  masters: Record<MasterId, CalibrationMaster>
  /** Calibration processes by id (P-CAL3): one per raw calibration session, plus masters imported directly. */
  calibrationProcesses: Record<CalibrationProcessId, CalibrationProcess>
  profiles: Record<ProfileId, ApplicationProfile>
  trashEpisodes: Record<TrashEpisodeId, TrashEpisode>
  importSources: Record<ImportSourceId, ImportSource>
  /** Planning records by Target; the planned ones form the Plan list. */
  plans: Record<TargetId, ObservingPlan>
  reminders: ReminderSettings
  calendarExports: CalendarExport[]
}

export type SeedName = "empty" | "demo"
