/**
 * Shared domain contract for the PlateVault prototype (foundation-owned).
 *
 * Vocabulary follows specs 063-072 exactly. Tracks read and write these
 * entities through the store; they never redefine them. Track-local UI state
 * lives in `src/store/slices/<track>.ts`. A track that needs a change here
 * messages the integration owner instead of editing this file.
 *
 * Two worlds are modelled:
 * - `Disk`: the simulated filesystem outside PlateVault (volumes, files,
 *   access, OS Trash). Prototype controls and app operations change it.
 * - `Catalog`: what PlateVault has indexed and decided. Indexing reads the
 *   disk into the catalog; it never writes source files.
 */

export type IsoDateTime = string
/** Local observing-night date, `YYYY-MM-DD` of the evening the night began. */
export type NightDate = string

export type VolumeId = string
export type LocationId = string
export type AssetId = string
export type SessionId = string
export type TargetId = string
export type ProjectId = string
export type ViewId = string
export type MasterId = string
export type ProfileId = string
export type PreparationId = string
export type ResultId = string
export type OperationId = string
export type CameraId = string
export type TelescopeId = string
export type OpticalTrainId = string
export type FilterId = string
export type SiteId = string
export type MeasurementImportId = string

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
  /** Accepts reviewed filing (File into library). */
  managed: boolean
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
  /** Bytes observed at this copy; differs from `Asset.sha256` when this copy changed. */
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
  /** Content identity at the last observation of any copy. */
  sha256: string
  observed: FrameHeader
  imageType: ImageType
  sessionId: SessionId | null
  /** Physical copies, in the order they were found. Never empty. */
  copies: AssetCopy[]
  /** Library-scope quality decision (Unreviewed, Usable, Unusable). */
  quality: QualityDecision
}

export type AssociationStatus = "confirmed" | "associated" | "needs-review" | "unresolved"

export type EvidenceSource = "header" | "pointing" | "equipment-record" | "user" | "resolver" | "catalog"

export interface Evidence {
  source: EvidenceSource
  label: string
  value: string
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
  createdAt: IsoDateTime
  revision: number
}

/** Where an equipment record came from: entered by the user, detected from headers, or shipped. */
export type RecordSource = "manual" | "detected" | "built-in"

export interface Camera {
  id: CameraId
  name: string
  aliases: string[]
  source: RecordSource
  widthPx: number
  heightPx: number
  pixelSizeUm: number
  color: boolean
}

export interface Telescope {
  id: TelescopeId
  name: string
  aliases: string[]
  source: RecordSource
  focalLengthMm: number
  apertureMm: number | null
}

export interface OpticalTrain {
  id: OpticalTrainId
  name: string
  /** "detected" until the user confirms it (Confirm equipment promotes it to "manual"). */
  source: RecordSource
  cameraId: CameraId | null
  telescopeId: TelescopeId | null
  effectiveFocalLengthMm: number
  notes: string
}

export interface FilterDef {
  id: FilterId
  name: string
  category: "narrowband" | "broadband" | "dual-band" | "other"
  aliases: string[]
  source: RecordSource
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

export interface MosaicPanel {
  id: string
  name: string
  ra: number
  dec: number
  widthDeg: number
  heightDeg: number
  rotationDeg: number
}

export type ChecklistItem =
  | { id: string; kind: "integration"; channel: string; goalS: number }
  | { id: string; kind: "frame-count"; channel: string; goalFrames: number }
  | { id: string; kind: "exposure"; channel: string | null; exposureS: number }
  | { id: string; kind: "panel-coverage"; panelId: string }
  | { id: string; kind: "equipment"; opticalTrainId: OpticalTrainId }
  | { id: string; kind: "calibration"; calibrationKind: CalibrationKind; channel: string | null }

export interface Project {
  id: ProjectId
  name: string
  notes: string
  targetIds: TargetId[]
  framing: {
    ra: number
    dec: number
    rotationDeg: number | null
    widthDeg: number
    heightDeg: number
    source: "target" | "user"
  } | null
  panels: MosaicPanel[]
  /** Equipment chosen for initial session preselection. */
  equipmentId: OpticalTrainId | null
  /** Explicit, inspectable session linkage. */
  linkedSessionIds: SessionId[]
  checklist: ChecklistItem[]
  /** Project-scoped rejections; never change library quality. */
  rejections: Record<AssetId, { at: IsoDateTime }>
  createdAt: IsoDateTime
  revision: number
}

// ---------------------------------------------------------------------------
// Views (PV-VSEL) and measurements (PV-PIX)
// ---------------------------------------------------------------------------

export type ViewOrigin = "project" | "target" | "sessions" | "results"

/**
 * Derived by `viewStatus()` in derive.ts, never stored:
 * - draft: never saved; membership lives in `draft` only.
 * - saved: has a committed membership revision.
 * - prepared: the latest preparation of the latest revision is verified.
 * - complete: the user marked the processing attempt complete.
 */
export type ViewStatus = "draft" | "saved" | "prepared" | "unverified" | "complete"

export type SelectionReasonKind = "geometry" | "pointing" | "project-equipment" | "manual" | "refresh-added"

export interface SelectionReason {
  kind: SelectionReasonKind
  detail: string
}

export interface MembershipContent {
  sessions: Array<{ sessionId: SessionId; reason: SelectionReason }>
  /** Exact included frame identities. */
  included: AssetId[]
  /** View-scoped exclusions. Files stay on disk. */
  excluded: AssetId[]
  /** Selected members that are unavailable; never omitted silently. */
  unresolved: AssetId[]
  /** Accepted Result inputs for a View created from results. */
  productInputs: ResultId[]
}

export interface MembershipRevision extends MembershipContent {
  revision: number
  savedAt: IsoDateTime
}

export interface MembershipDraft extends MembershipContent {
  /** Committed revision the draft started from; null for a new View. */
  baseRevision: number | null
  updatedAt: IsoDateTime
}

/** Saved selection criteria used by Refresh selection. */
export interface SelectionCriteria {
  targetId: TargetId | null
  projectId: ProjectId | null
  opticalTrainIds: OpticalTrainId[]
  channels: string[]
  exposureS: number[]
}

export interface View {
  id: ViewId
  name: string
  projectId: ProjectId | null
  targetId: TargetId | null
  origin: ViewOrigin
  profileId: ProfileId | null
  /** Committed membership revisions, oldest first. */
  revisions: MembershipRevision[]
  /** Unsaved working copy; null when there are no unsaved changes. */
  draft: MembershipDraft | null
  criteria: SelectionCriteria | null
  calibration: CalibrationAssignment[]
  /** Parent folder for the View folder; null until chosen. */
  locationParent: string | null
  /** Output location; defaults to `<View folder>/output/`. */
  outputPath: string | null
  notes: string
  /** Set by Mark complete (T5), cleared by Reopen (T3). */
  completedAt: IsoDateTime | null
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
  /** Input basis, for example "linear, mono" or "CFA red plane". */
  basis: string
  state: "valid" | "failed" | "unavailable"
  warning: string | null
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
  status: "ambiguous" | "unmatched" | "resolved"
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
  viewId: ViewId
  path: string
  importedAt: IsoDateTime
  matched: number
  /** Matched rows whose frame is outside this View; values still attach to the frame. */
  outsideView: number
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
  origin: { kind: "library" | "generated"; viewId: ViewId | null; sourcePath: string }
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
  lightValue: string
  calibrationValue: string
}

export type CalibrationInput =
  | { type: "master"; masterId: MasterId }
  | { type: "raw-set"; sessionId: SessionId }

export interface CalibrationAssignment {
  id: string
  lightSessionId: SessionId
  kind: CalibrationKind
  input: CalibrationInput | null
  /** Suggestions never enter a verified handoff until accepted. */
  state: "suggested" | "accepted" | "exception" | "deferred" | "unresolved"
  criteria: MatchCriterion[]
  /** View-scoped; never rewrites master evidence. */
  exception: { reason: string; at: IsoDateTime } | null
}

// ---------------------------------------------------------------------------
// Application preparation (PV-PREP)
// ---------------------------------------------------------------------------

export type ApplicationKind = "pixinsight-wbpp" | "siril" | "seti-astro" | "generic"

export type InputMode = "linked" | "direct-source" | "copy" | "clone"

export interface ProfileCapability {
  /** Verified only with recorded capability evidence (D04). */
  verified: boolean
  evidence: string
  inputWrite: "read-only" | "unknown" | "write-prone"
  inputModes: InputMode[]
  /** How Direct source passes inputs; "whole-folder" cannot honour exclusions. */
  directSource: "file-list" | "whole-folder" | "none"
  productInputKinds: ResultKind[]
  /** Can the application read a corrected value through configuration? */
  correctedMetadata: "configuration" | "none"
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

/** A prepared or blocked input: a frame, or an accepted Result for a View created from results. */
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

export interface Preparation {
  id: PreparationId
  viewId: ViewId
  membershipRevision: number
  profileId: ProfileId
  mode: InputMode
  linkType: "symlink" | "hardlink" | null
  viewPath: string
  outputPath: string
  entryCount: number
  footprintBytes: number
  state: PreparationState
  operationId: OperationId | null
  preparedAssetIds: AssetId[]
  /** Accepted Result inputs written for a View created from results (RES-AC-04/05). */
  preparedResultIds: ResultId[]
  blocked: Array<{ input: PreparationInput; path: string; reason: string }>
  metadataDecisions: MetadataDecision[]
  launches: Array<{ at: IsoDateTime; outcome: "opened" | "missing-executable" | "launch-failed" }>
  /**
   * Set when Open found prepared entries that no longer match the preparation
   * snapshot (PREP-FR-10); cleared by the next Open that re-verifies them.
   * The View reads Unverified meanwhile.
   */
  unverified?: { at: IsoDateTime; changed: Array<{ path: string; reason: string }> } | null
  createdAt: IsoDateTime
  settledAt: IsoDateTime | null
}

// ---------------------------------------------------------------------------
// Results (PV-RES)
// ---------------------------------------------------------------------------

export type ResultKind = "final-image" | "linear-integration" | "channel-product" | "mosaic-panel"

export interface ResultRecord {
  id: ResultId
  viewId: ViewId
  path: string
  kind: ResultKind | null
  channel: string | null
  discovered: "output-location" | "attached"
  processingState: "pending" | "written" | "unknown"
  /** View association, separate from input-frame lineage. */
  association: "tool-recorded" | "user-linked"
  lineage: "tool-recorded" | "unknown"
  acceptance: "candidate" | "accepted"
  acceptedAt: IsoDateTime | null
  sha256: string
  /** "drifted" when bytes changed outside PlateVault after acceptance. */
  contentState: "unchanged" | "drifted"
}

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
  | "adopt-master"
  | "prepare"
  | "cleanup"
  | "archive"
  | "filing"

export type OperationStatus = "running" | "paused" | "succeeded" | "partial" | "failed" | "canceled" | "interrupted"

export type OperationItemStatus = "pending" | "running" | "done" | "blocked" | "failed" | "skipped" | "uncertain"

export interface OperationItem {
  id: string
  label: string
  path: string | null
  status: OperationItemStatus
  /** Kind-specific phase, for example "destination-verified". */
  phase: string | null
  detail: string | null
}

export interface OperationScope {
  /**
   * Every View the operation can affect. Archive and filing record the Views
   * whose members they move, so Mark complete sees them (RES-AC-07, D09).
   */
  viewIds?: ViewId[]
  locationIds?: LocationId[]
  sessionIds?: SessionId[]
  targetId?: TargetId
}

export interface Operation {
  id: OperationId
  kind: OperationKind
  title: string
  status: OperationStatus
  scope: OperationScope
  progress: { done: number; total: number; unit: string }
  items: OperationItem[]
  summary: string | null
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
  title: string
  detail: string | null
  operationId: OperationId | null
  /** Hash route of the surface that owns the outcome. */
  href: string | null
}

// ---------------------------------------------------------------------------
// Settings, simulation and the root state
// ---------------------------------------------------------------------------

export interface AppSettings {
  defaultSiteId: SiteId | null
  planningSiteId: SiteId | null
  onboarding: {
    completedAt: IsoDateTime | null
    /** Optional roles the user chose to set up later. */
    deferredRoles: LocationRole[]
    tourCompletedAt: IsoDateTime | null
    checklistHidden: boolean
  }
  /** Last chosen View parent folder; no root is assumed on first use. */
  lastViewParent: string | null
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
}

export interface Catalog {
  locations: Record<LocationId, Location>
  assets: Record<AssetId, Asset>
  sessions: Record<SessionId, Session>
  targets: Record<TargetId, Target>
  cameras: Record<CameraId, Camera>
  telescopes: Record<TelescopeId, Telescope>
  opticalTrains: Record<OpticalTrainId, OpticalTrain>
  filters: Record<FilterId, FilterDef>
  sites: Record<SiteId, ObservingSite>
  projects: Record<ProjectId, Project>
  views: Record<ViewId, View>
  measurements: Record<AssetId, FrameMeasurement>
  measurementImports: Record<MeasurementImportId, MeasurementImport>
  masters: Record<MasterId, CalibrationMaster>
  profiles: Record<ProfileId, ApplicationProfile>
  preparations: Record<PreparationId, Preparation>
  results: Record<ResultId, ResultRecord>
  plans: Record<TargetId, ObservingPlan>
  reminders: ReminderSettings
  calendarExports: CalendarExport[]
}

export type SeedName = "empty" | "demo"
