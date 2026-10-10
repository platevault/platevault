/**
 * Shared domain contract for the PlateVault prototype, harness v5
 * (foundation-owned).
 *
 * Vocabulary follows specs 063-072 and the workflow decisions D-W1 to D-W75
 * (`specs/063-clean-rebuild-contract/workflow-decisions.md`). "Run" is the UI
 * word for the domain's View (D-W3); the prototype uses Run throughout.
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
 * "File into library" filing (D-W11), the Abandoned state (D-W72) and the
 * naming "Auto-apply pattern" (D-W58).
 */
import type { MessageRef } from "@/lib/i18n"

export type IsoDateTime = string
/** Local observing-night date, `YYYY-MM-DD` of the evening the night began. */
export type NightDate = string

export type VolumeId = string
export type LocationId = string
export type AssetId = string
export type SessionId = string
export type TargetId = string
export type ProjectId = string
export type RunId = string
export type RunGroupId = string
export type SubjectId = string
export type GoalId = string
export type GoalTemplateId = string
export type TrashEpisodeId = string
export type ImportSourceId = string
export type MasterId = string
export type ProfileId = string
export type PreparationId = string
export type ResultId = string
export type OperationId = string
export type CameraId = string
export type TelescopeId = string
export type OpticalTrainId = string
/** Rig filter id, unique within its rig. */
export type RigFilterId = string
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
  links: { symlink: boolean; hardlink: boolean; clone: boolean }
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
  /** Files sharing an inode share bytes (hardlinks). */
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
 * A rig: one optical train (camera plus telescope) taking part in Projects
 * (D-W37). Its filter list drives the Targets band strip, the narrowband
 * presets and the Fit column (D-W31).
 */
export interface OpticalTrain {
  id: OpticalTrainId
  name: string
  /** "detected" until the user confirms it (Confirm equipment promotes it to "manual"). */
  source: RecordSource
  cameraId: CameraId | null
  telescopeId: TelescopeId | null
  effectiveFocalLengthMm: number
  notes: string
  /** Plain filter list, the same form for mono and OSC cameras (PLAN-EQ-FR-01). */
  filters: RigFilter[]
}

/** The seven bands of the Targets Filters strip (PLAN-TGT-FR-06). */
export type Band = "L" | "R" | "G" | "B" | "Ha" | "SII" | "OIII"

export interface RigFilter {
  id: RigFilterId
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

/** One mosaic panel, set explicitly by centre and rotation (D-W38, D-W73). */
export interface MosaicPanel {
  id: string
  /** 1-based panel number; folders read `Panel N/` (PREP-FR-07). */
  n: number
  ra: number
  dec: number
  rotationDeg: number
}

/**
 * A Project subject: a Target, optionally marked Mosaic with explicit panels
 * (D-W9, D-W38). Candidates are sessions whose confirmed Target is
 * `targetId`, whatever the panel; panel assignment is by pointing.
 */
export interface Subject {
  id: SubjectId
  targetId: TargetId
  mosaic: {
    name: string
    /** Tonight's windows for a mosaic use this centre (D-W63). */
    centre: { ra: number; dec: number }
    panels: MosaicPanel[]
  } | null
}

/**
 * A quality bar (D-W29, PRJ-FR-03): Usable frames only, a median FWHM limit
 * per frame, or both. Frames the bar cannot judge do not count.
 */
export type QualityBar = { kind: "usable-only" } | { kind: "max-fwhm"; maxArcsec: number } | { kind: "usable-max-fwhm"; maxArcsec: number }

/**
 * A goal channel is a chip from the band set, or the derived OSC channels:
 * "OSC" (no filter or a broadband filter on an OSC camera) and "Dual-band"
 * (a filter passing two narrow bands). Never free text (`GOAL_CHANNELS`).
 */
export type GoalChannel = Band | "OSC" | "Dual-band"

/**
 * Goals for one subject (or one mosaic panel) and one channel (D-W29). A row
 * holds any of the three goal kinds: integration time, frame count and a
 * quality bar. Missing calibration and exposure mismatch are derived
 * warnings, never goals.
 */
export interface Goal {
  id: GoalId
  subjectId: SubjectId
  /** Set for a mosaic subject: panels carry their own goals. */
  panelId: string | null
  channel: GoalChannel
  integrationS: number | null
  frameCount: number | null
  qualityBar: QualityBar | null
}

/** The three optional Wrap up steps after every run is Complete (P-WRAP1). */
export type WrapUpStepId = "cleanup" | "trash" | "archive"

/** A Wrap up step the user finished or chose to skip; an absent step is still to do. */
export interface WrapUpStepRecord {
  state: "done" | "skipped"
  at: IsoDateTime
}

export interface Project {
  id: ProjectId
  name: string
  notes: string
  subjects: Subject[]
  /** Rigs taking part; each run uses exactly one of them (D-W37). */
  rigIds: OpticalTrainId[]
  goals: Goal[]
  /**
   * Archive destination for this Project (P-ARC1); null uses the Default
   * archive location (`settings.defaultArchiveLocationId`).
   */
  archiveLocationId: LocationId | null
  /** Wrap up progress (P-WRAP1); Done follows the last step. */
  wrapUp: Partial<Record<WrapUpStepId, WrapUpStepRecord>>
  /** Only the user marks a Project Done; Reopen returns it to open (D-W26, D-W46). */
  state: "open" | "done"
  doneAt: IsoDateTime | null
  /**
   * Archive after Done. It survives Reopen: archived sessions show as
   * Archived until the user restores them (D-W69).
   */
  archive: { at: IsoDateTime; sessionIds: SessionId[] } | null
  /** Project-only rejects, the second quality level (D-W42). Never change library quality. */
  rejections: Record<AssetId, { at: IsoDateTime }>
  createdAt: IsoDateTime
  revision: number
}

/** One channel of a goal template: the same three goal kinds a Goal holds. */
export interface GoalTemplateValue {
  channel: GoalChannel
  integrationS: number | null
  frameCount: number | null
  qualityBar: QualityBar | null
}

/** Built-in or user goal template; applying it copies its values into the Project (D-W30, D-W47). */
export interface GoalTemplate {
  id: GoalTemplateId
  name: string
  source: "built-in" | "user"
  values: GoalTemplateValue[]
}

// ---------------------------------------------------------------------------
// Processing runs (the domain's View: PV-VSEL, D-W3) and measurements (PV-PIX)
// ---------------------------------------------------------------------------

/** The six steps every run owns (D-W3, VSEL-FR-02). */
export type RunStep = "select" | "review" | "calibrate" | "prepare" | "results" | "done"

export type SelectionReasonKind =
  /** "Target <subject> on <rig>": the candidate rule (D-W49). */
  | "candidate"
  /** A panel run: pointing inside this panel (D-W38). */
  | "panel-pointing"
  /** A flagged session the user assigned to this panel (D-W38). */
  | "panel-assigned"
  | "refresh-added"
  | "manual"

export interface SelectionReason {
  kind: SelectionReasonKind
  /** Persisted with the membership; worded at render. */
  detail: MessageRef
}

export interface MembershipContent {
  sessions: Array<{ sessionId: SessionId; reason: SelectionReason }>
  /** Exact included frame identities. */
  included: AssetId[]
  /** Run-scoped exclusions ("Exclude from run"). Files stay on disk (VSEL-FR-10). */
  excluded: AssetId[]
  /**
   * Frames rejected in this run's Review step (X or Reject for this Project
   * only) leave the draft with the reason "Rejected"; un-rejecting restores
   * them (D-W54).
   */
  rejected: AssetId[]
  /** Selected members that are unavailable; never omitted silently. */
  unresolved: AssetId[]
  /** Accepted Results of other runs used as inputs, any Project and any rig (D-W4, D-W56). */
  productInputs: ResultId[]
}

export interface MembershipRevision extends MembershipContent {
  revision: number
  savedAt: IsoDateTime
  /** The changes this save accepted (VSEL-FR-16); worded at render. */
  accepted: MessageRef[]
}

export interface MembershipDraft extends MembershipContent {
  /** Committed revision the draft started from; null before the first save. */
  baseRevision: number | null
  updatedAt: IsoDateTime
}

/** Automatic assignment is the default; off hands off no calibration (D-W5, D-W55). */
export type CalibrationPolicy = "automatic" | "off"

/** Setup a run group shares with every panel run (D-W38); a single run holds its own. */
export interface RunSetup {
  profileId: ProfileId | null
  inputMode: InputMode | null
  calibrationPolicy: CalibrationPolicy
}

/**
 * A master found in a run's Results, offered once (D-W5, D-W55). Dismiss is
 * reversible (P-CAL2): a dismissed offer is listed under the Calibration
 * library's Dismissed filter, where Restore offer makes it pending again.
 */
export interface MasterOffer {
  masterId: MasterId
  state: "pending" | "adopted" | "dismissed"
  at: IsoDateTime
}

/**
 * A processing run: one Project, one subject (or one panel of a mosaic
 * subject) and one rig, all fixed at creation (D-W8, D-W50). The six steps
 * are derived (`runPipeline` in derive.ts), never stored.
 */
export interface Run {
  id: RunId
  name: string
  projectId: ProjectId
  subjectId: SubjectId
  /** Panel run: the one panel this run is tied to (D-W73). */
  panelId: string | null
  groupId: RunGroupId | null
  rigId: OpticalTrainId
  /** Null for a panel run, which uses its group's shared setup (`runSetup`). */
  setup: RunSetup | null
  /** Committed membership revisions, oldest first (D-W34). */
  revisions: MembershipRevision[]
  /** Unsaved working copy; null when there are no unsaved changes. */
  draft: MembershipDraft | null
  /** Calibration decisions that override automatic assignment. */
  calibration: CalibrationAssignment[]
  masterOffers: MasterOffer[]
  /** Last chosen `<output>` parent; the run folder is `<output>/<Project>/<Run>/` (PREP-FR-06). */
  outputParent: string | null
  completion: "open" | "complete"
  completedAt: IsoDateTime | null
  /** The step the run was in when completed; Reopen returns it there (D-W71 kept by D-W72). */
  stageBeforeComplete: RunStep | null
  /** Soft delete into the Project's Trash (D-W72). Restore clears it; Empty Trash removes the record. */
  trashedAt: IsoDateTime | null
  notes: string
  createdAt: IsoDateTime
  revision: number
}

/** One run per mosaic panel with one shared setup (D-W38, D-W41, D-W73). */
export interface RunGroup {
  id: RunGroupId
  name: string
  projectId: ProjectId
  subjectId: SubjectId
  rigId: OpticalTrainId
  /** Panel runs in panel order; a trashed panel run stays listed as Trashed (D-W75). */
  runIds: RunId[]
  setup: RunSetup
  outputParent: string | null
  createdAt: IsoDateTime
  revision: number
}

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
  runId: RunId
  path: string
  importedAt: IsoDateTime
  matched: number
  /** Matched rows whose frame is outside this run; values still attach to the frame. */
  outsideRun: number
  rows: MeasurementImportRow[]
}

// ---------------------------------------------------------------------------
// Calibration (PV-CAL)
// ---------------------------------------------------------------------------

export type CalibrationKind = "dark" | "flat" | "bias" | "dark-flat"

export interface CalibrationMaster {
  id: MasterId
  kind: CalibrationKind
  path: string
  cameraName: string | null
  widthPx: number
  heightPx: number
  binning: number
  gain: number | null
  offset: number | null
  exposureS: number | null
  channel: string | null
  /** Flats only: optical train evidence; null when unknown. */
  opticalTrainId: OpticalTrainId | null
  ccdTempC: number | null
  frameCount: number | null
  createdAt: IsoDateTime
  /** Candidates are never preselected; adoption makes a master reusable. */
  state: "adopted" | "candidate"
  /**
   * Where the master came from: indexed in the library, found in a run's
   * Results, stacked from a raw calibration session by its calibration
   * process, or stacked elsewhere and imported directly (P-CAL3).
   * `sessionId` is the lineage: the raw session a stacked master came from.
   */
  origin: { kind: "library" | "generated" | "stacked" | "imported"; runId: RunId | null; sourcePath: string; sessionId: SessionId | null }
  adoption: { destinationPath: string; verifiedSha256: string; adoptedAt: IsoDateTime } | null
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
  | "temperature"

export interface MatchCriterion {
  name: MatchCriterionName
  result: "compatible" | "incompatible" | "unknown"
  lightValue: MessageRef
  calibrationValue: MessageRef
}

/** Runs are assigned masters only (P-CAL3); raw calibration frames are input to a calibration process. */
export type CalibrationInput = { type: "master"; masterId: MasterId }

export interface CalibrationAssignment {
  id: string
  lightSessionId: SessionId
  kind: CalibrationKind
  input: CalibrationInput | null
  /** Suggestions never enter a verified handoff until accepted. */
  state: "suggested" | "accepted" | "exception" | "deferred" | "unresolved"
  criteria: MatchCriterion[]
  /** Run-scoped; never rewrites master evidence. */
  exception: { reason: string; at: IsoDateTime } | null
  /**
   * The D19 basis of an accepted input or exception (CAL-FR-08): when it was
   * decided and the SHA-256 each handed-off file had then.
   */
  basis: { at: IsoDateTime; files: Array<{ path: string; sha256: string }> } | null
}

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
  /** Where Import put the master in structured calibration storage. */
  storagePath: string | null
  masterId: MasterId | null
  /** What happened to the raws once the master registered. */
  raws: "trashed" | "kept" | null
  steps: Record<CalibrationStepId, CalibrationStepRecord>
  /** The operation of the running step: the output-folder watch, or the OS Trash move of the raws. */
  operationId: OperationId | null
  createdAt: IsoDateTime
  updatedAt: IsoDateTime
}

// ---------------------------------------------------------------------------
// Application preparation (PV-PREP)
// ---------------------------------------------------------------------------

export type ApplicationKind = "pixinsight-wbpp" | "siril" | "seti-astro" | "generic"

export type InputMode = "linked" | "direct-source" | "copy" | "clone"

export interface ProfileCapability {
  /** Verified only with recorded capability evidence (D04). */
  verified: boolean
  evidence: MessageRef
  inputWrite: "read-only" | "unknown" | "write-prone"
  inputModes: InputMode[]
  /** How Direct source passes inputs; "whole-folder" cannot honour exclusions. */
  directSource: "file-list" | "whole-folder" | "none"
  productInputKinds: ResultKind[]
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

export type PreparationState = "running" | "prepared" | "partial" | "failed" | "canceled" | "paused"

/** A prepared or blocked input: a frame, or an accepted Result used as an input (D-W4). */
export type PreparationInput = { kind: "asset"; assetId: AssetId } | { kind: "result"; resultId: ResultId }

/**
 * How a corrected metadata value reaches the application for one input
 * (PREP-FR-03, PREP-AC-06): through its configuration, a patched copy, by
 * accepting the source value, or by excluding the input.
 */
export interface MetadataDecision {
  assetId: AssetId
  field: CorrectionField
  observed: string | null
  corrected: string
  decision: "configuration" | "patched-copy" | "accept-source" | "excluded"
}

/**
 * One preparation revision of one run. A single run prepares to
 * `<output>/<Project>/<Run>/`, later revisions to `<Run> (rev N)/` beside it
 * (D-W51). A panel run prepares to `<output>/<Project>/<Mosaic>/Panel N/`,
 * later group revisions to `<Mosaic> (rev N)/Panel N/` (D-W67, PREP-FR-12).
 */
export interface Preparation {
  id: PreparationId
  runId: RunId
  /** Set for a panel run's preparation: the group revision it belongs to. */
  groupId: RunGroupId | null
  /** 1 for the first prepared folder, N for `(rev N)`. */
  prepRevision: number
  membershipRevision: number
  profileId: ProfileId
  mode: InputMode
  linkType: "symlink" | "hardlink" | null
  /** The prepared folder: `<output>/<Project>/<Run>/` or a group's `Panel N/`. */
  folderPath: string
  /** The Results folder shared by every revision: `<Run> Results/` or `<Mosaic> Results/Panel N/` (D-W51, D-W73). */
  resultsPath: string
  entryCount: number
  footprintBytes: number
  state: PreparationState
  operationId: OperationId | null
  preparedAssetIds: AssetId[]
  /** Accepted Result inputs written into the folder (D-W4). */
  preparedResultIds: ResultId[]
  /** Why each input was not prepared; worded at render. */
  blocked: Array<{ input: PreparationInput; path: string; reason: MessageRef }>
  metadataDecisions: MetadataDecision[]
  launches: Array<{ at: IsoDateTime; outcome: "opened" | "missing-executable" | "launch-failed" }>
  /**
   * Set when Open found prepared entries that no longer match the preparation
   * snapshot (PREP-FR-10); cleared by the next Open that re-verifies them.
   * The run reads Unverified meanwhile.
   */
  unverified?: { at: IsoDateTime; changed: Array<{ path: string; reason: MessageRef }> } | null
  createdAt: IsoDateTime
  settledAt: IsoDateTime | null
}

// ---------------------------------------------------------------------------
// Results (PV-RES)
// ---------------------------------------------------------------------------

export type ResultKind = "final-image" | "linear-integration" | "channel-product" | "mosaic-panel" | "assembled-mosaic"

/**
 * A product discovered in a run's recorded Results folder, or attached by the
 * user (D-W4). Recognized intermediates are kept apart from candidates and
 * reach the OS Trash only through the Done / Archive sheet (D-W70).
 */
export interface ResultRecord {
  id: ResultId
  /** The run that owns it; null for a group Result (the assembled mosaic). */
  runId: RunId | null
  /** Set for a panel run's Result and for the group Result. */
  groupId: RunGroupId | null
  path: string
  kind: ResultKind | null
  channel: string | null
  /** A processing intermediate (calibrated, registered frames), never a candidate. */
  intermediate: boolean
  discovered: "results-folder" | "attached"
  /** The preparation revision it came from, when known (D-W67). */
  fromPrepRevision: number | null
  processingState: "pending" | "written" | "unknown"
  /** Run association (attribution), separate from input-frame lineage (RES-FR-03). */
  association: "tool-recorded" | "user-linked"
  lineage: "tool-recorded" | "unknown"
  acceptance: "candidate" | "accepted"
  acceptedAt: IsoDateTime | null
  sha256: string
  /** "drifted" when bytes changed outside PlateVault after acceptance. */
  contentState: "unchanged" | "drifted"
  /** Set when Empty Trash moved this Result (a ticked Results folder) to the OS Trash. */
  trashed: { at: IsoDateTime; episodeId: TrashEpisodeId } | null
}

// ---------------------------------------------------------------------------
// Trash episodes (D-W43, D-W70, D-W72, D-W74)
// ---------------------------------------------------------------------------

export type TrashEpisodeKind =
  /** Done / Archive: library-Unusable candidate frames (D-W43). */
  | "rejected-frames"
  /** Done / Archive: processing intermediates in Results folders (D-W70). */
  | "intermediates"
  /** Done / Archive: byte-identical extra copies (D-W74). */
  | "duplicate-copies"
  /** Empty Trash of runs: prepared folders and ticked Results folders (D-W72). */
  | "empty-trash"
  /** Import Move: sources sent to the OS Trash after their destination verified (D-W11). */
  | "import-move"
  /** Clean up of a Complete run: only the entries its preparations created (D-W26, PREP-FR-14). */
  | "run-cleanup"
  /** A calibration process's raws after their master registered (P-CAL3). */
  | "calibration-raws"

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
  runIds: RunId[]
  items: Array<{
    path: string
    volumeId: VolumeId
    sizeBytes: number
    assetId: AssetId | null
    resultId: ResultId | null
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

/** A Target's planning record; `planned` puts it on the Plan list (`planList`, `addToPlan`). */
export interface ObservingPlan {
  targetId: TargetId
  planned: boolean
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

export interface ReminderSettings {
  enabled: boolean
  /** Always the default site at the time reminders were enabled. */
  siteId: SiteId | null
  leadTimeMin: number | null
  permission: "not-requested" | "granted" | "denied"
  deliveredWindowKeys: string[]
  enabledAt: IsoDateTime | null
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
  /** Scan for duplicates: byte-identical live copies, listed only on demand (Storage). */
  | "duplicate-scan"
  | "prepare"
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
  /**
   * Every run the operation can affect. Complete and Move to Trash are
   * refused while one of these is Running (RES-FR-07, RES-FR-10).
   */
  runIds?: RunId[]
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

export type ActivityKind = "operation" | "write-failed" | "write-refused" | "refusal" | "saved"

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
}

// ---------------------------------------------------------------------------
// Settings, simulation and the root state
// ---------------------------------------------------------------------------

/**
 * Moon tolerance of one band (planning): the Moon at least this far from the
 * Target, or lit no more than this, while it is up. Broadband needs a dark
 * Moon; narrowband tolerates more.
 */
export interface MoonConstraint {
  minSeparationDeg: number
  maxIlluminationPct: number
}

export interface AppSettings {
  /** The one default site; Plan and Tonight use it unless another is picked. */
  defaultSiteId: SiteId | null
  planningSiteId: SiteId | null
  /** The Default archive location (P-ARC1); a Project may pick another. */
  defaultArchiveLocationId: LocationId | null
  /** Per-band Moon constraints behind "good tonight" (`goodTonight`). */
  moonConstraints: Record<Band, MoonConstraint>
  onboarding: {
    completedAt: IsoDateTime | null
    /** Optional roles the user chose to set up later. */
    deferredRoles: LocationRole[]
  }
  /** Last chosen `<output>` parent folder; no root is assumed on first use (PREP-FR-06). */
  lastOutputParent: string | null
  /** Overridden naming templates only; the rest use the per-type defaults (STO-IMP-FR-07). */
  naming: Partial<Record<NamingFrameType, string>>
  /** Keep raw calibration frames after their master registers; off moves them to the OS Trash (P-CAL3). */
  keepRawCalibration: boolean
  /** Online Target resolution (LIB-AC-12, D18). Local search always works. */
  targetLookup: {
    enabled: boolean
    provider: "cds-sesame" | "simbad"
  }
}

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
}

export interface Catalog {
  locations: Record<LocationId, Location>
  assets: Record<AssetId, Asset>
  sessions: Record<SessionId, Session>
  targets: Record<TargetId, Target>
  cameras: Record<CameraId, Camera>
  telescopes: Record<TelescopeId, Telescope>
  opticalTrains: Record<OpticalTrainId, OpticalTrain>
  sites: Record<SiteId, ObservingSite>
  projects: Record<ProjectId, Project>
  runs: Record<RunId, Run>
  runGroups: Record<RunGroupId, RunGroup>
  /** User goal templates; the built-ins are constants (`BUILT_IN_GOAL_TEMPLATES`). */
  goalTemplates: Record<GoalTemplateId, GoalTemplate>
  measurements: Record<AssetId, FrameMeasurement>
  measurementImports: Record<MeasurementImportId, MeasurementImport>
  masters: Record<MasterId, CalibrationMaster>
  /** Calibration processes by id (P-CAL3): one per raw calibration session, plus masters imported directly. */
  calibrationProcesses: Record<CalibrationProcessId, CalibrationProcess>
  profiles: Record<ProfileId, ApplicationProfile>
  preparations: Record<PreparationId, Preparation>
  results: Record<ResultId, ResultRecord>
  trashEpisodes: Record<TrashEpisodeId, TrashEpisode>
  importSources: Record<ImportSourceId, ImportSource>
  /** Planning records by Target; the planned ones form the Plan list. */
  plans: Record<TargetId, ObservingPlan>
  reminders: ReminderSettings
  calendarExports: CalendarExport[]
}

export type SeedName = "empty" | "demo"
