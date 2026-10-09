/**
 * Slice C read model (pure): the layout a run or run group prepares to, the
 * preparation plan (profile, mode, corrected metadata, entries and checks),
 * Open's re-verification, Results discovery and attribution, the Clean up
 * list and the calibration readiness line. Nothing here writes; the slice's
 * actions and operation handlers in `actions.ts` and `operations.ts` do.
 */
import { calibrationPlan, type CalibrationPlan, handoffCalibration, KIND_LABEL, KINDS, type RequirementRow } from "@/domain/calibration"
import { latestCorrection } from "@/domain/corrections"
import { findPanel, findSubject, latestRevision, runPreparations, runSetup, savedContent, workingContent } from "@/domain/derive"
import { fileAt, filesUnder, freeBytes, volumeForPath } from "@/domain/disk"
import { deniedAncestor, isUnder } from "@/domain/indexing"
import { MODE_LABEL, PRODUCT_KIND_LABEL } from "@/domain/labels"
import { assetAvailability, copyAvailability, preferredCopy } from "@/domain/library"
import { memberSessions, type MemberSession } from "@/domain/membership"
import type {
  ApplicationProfile,
  Asset,
  CalibrationKind,
  CorrectionField,
  DiskFile,
  InputMode,
  MembershipRevision,
  MetadataDecision,
  MosaicPanel,
  Preparation,
  Project,
  ResultKind,
  ResultRecord,
  Run,
  RunGroup,
  Session,
  Subject,
  Volume,
} from "@/domain/types"
import { fileName, formatBytes, plural } from "@/lib/format"
import type { PrototypeState } from "@/store/core"

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

export interface RunContext {
  run: Run
  project: Project
  subject: Subject | undefined
  panel: MosaicPanel | undefined
  group: RunGroup | undefined
}

export function runContext(state: PrototypeState, runId: string): RunContext | null {
  const run = state.catalog.runs[runId]
  const project = run ? state.catalog.projects[run.projectId] : undefined
  if (!run || !project) return null
  const subject = findSubject(project, run.subjectId)
  return { run, project, subject, panel: findPanel(subject, run.panelId), group: run.groupId ? state.catalog.runGroups[run.groupId] : undefined }
}

/** Why a run's setup, calibration or preparation cannot change now; null when it can. */
export function runLock(run: Run): string | null {
  if (run.trashedAt) return `${run.name} is in the Project's Trash. Restore it first.`
  if (run.completion === "complete") return `${run.name} is Complete. Reopen it to change it.`
  return null
}

/** Live panel runs of a group in panel order; a trashed panel is skipped by every group action (D-W75). */
export function livePanelRuns(state: PrototypeState, group: RunGroup): Run[] {
  return group.runIds.map((id) => state.catalog.runs[id]).filter((r): r is Run => r !== undefined && !r.trashedAt)
}

// ---------------------------------------------------------------------------
// Layout (D-W51, D-W67, D-W73, PREP-FR-06, PREP-FR-07, PREP-FR-12)
// ---------------------------------------------------------------------------

export interface OutputParent {
  path: string | null
  origin: "run" | "group" | "last-used" | "none"
}

export function outputParentFor(state: PrototypeState, run: Run): OutputParent {
  const group = run.groupId ? state.catalog.runGroups[run.groupId] : undefined
  if (group) {
    if (group.outputParent) return { path: group.outputParent, origin: "group" }
  } else if (run.outputParent) return { path: run.outputParent, origin: "run" }
  if (state.settings.lastOutputParent) return { path: state.settings.lastOutputParent, origin: "last-used" }
  return { path: null, origin: "none" }
}

export interface ParentProblem {
  kind: "none" | "offline" | "missing" | "read-only"
  message: string
}

export function folderExists(state: PrototypeState, path: string): boolean {
  const volumeId = volumeForPath(state.disk, path)
  const volume = volumeId ? state.disk.volumes[volumeId] : undefined
  if (!volume?.mounted) return false
  if (path === volume.mountPath) return true
  return pathOccupied(state, path)
}

/** Anything at `path` on the volume mounted there: a file, an explicit folder or files under it. */
export function pathOccupied(state: PrototypeState, path: string): boolean {
  if (fileAt(state.disk, path)) return true
  const volumeId = volumeForPath(state.disk, path)
  if (!volumeId) return false
  if (state.disk.folders.some((f) => f.volumeId === volumeId && isUnder(f.path, path))) return true
  return filesUnder(state.disk, path).length > 0
}

export function parentProblem(state: PrototypeState, parent: OutputParent): ParentProblem | null {
  if (!parent.path) return { kind: "none", message: "Choose an output folder. PlateVault assumes no root on first use." }
  const volumeId = volumeForPath(state.disk, parent.path)
  const volume = volumeId ? state.disk.volumes[volumeId] : undefined
  if (!volume || !volume.mounted) return { kind: "offline", message: `${volume?.name ?? parent.path} is offline. Choose another output folder; PlateVault never substitutes another drive.` }
  if (!folderExists(state, parent.path)) return { kind: "missing", message: `${parent.path} no longer exists. Choose another output folder.` }
  if (!volume.writable || state.disk.readOnlyPaths.some((p) => isUnder(parent.path!, p))) return { kind: "read-only", message: `PlateVault cannot write to ${parent.path}: write permission is removed. Choose another output folder.` }
  return null
}

export interface RunLayout {
  parent: OutputParent
  projectDir: string | null
  /** 1 for the first prepared folder; N for `(rev N)`. */
  prepRevision: number
  /** The run folder, or a panel run's `Panel N/` folder. */
  folderPath: string | null
  /** A panel run's group folder, `<Mosaic>/` or `<Mosaic> (rev N)/`. */
  groupFolder: string | null
  /** Shared by every revision (D-W67). */
  resultsPath: string | null
  /** A group's `<Mosaic> Results/Assembled/`. */
  assembledPath: string | null
}

function groupPreparations(state: PrototypeState, group: RunGroup): Preparation[] {
  return Object.values(state.catalog.preparations).filter((p) => p.groupId === group.id)
}

/** The group revision the next Prepare all writes: always a new group folder (PREP-FR-13). */
export function nextGroupRevision(state: PrototypeState, group: RunGroup): number {
  const max = Math.max(0, ...groupPreparations(state, group).map((p) => p.prepRevision))
  return max + 1
}

/**
 * The layout the next preparation of `run` writes. A single run's later
 * revisions go to `<Run> (rev N)/`. A panel run joins the latest group
 * folder when its `Panel N/` is not there yet, otherwise it proposes the
 * next group folder; Prepare all always proposes the next group folder.
 */
export function runLayout(state: PrototypeState, run: Run, options: { groupRevision?: number } = {}): RunLayout {
  const project = state.catalog.projects[run.projectId]
  const parent = outputParentFor(state, run)
  const existing = runPreparations(state.catalog, run.id)
  const group = run.groupId ? state.catalog.runGroups[run.groupId] : undefined
  const subject = project ? findSubject(project, run.subjectId) : undefined
  const panel = findPanel(subject, run.panelId)
  const projectDir = parent.path && project ? `${parent.path}/${project.name}` : null
  if (group && subject?.mosaic && panel) {
    const preps = groupPreparations(state, group)
    const max = Math.max(0, ...preps.map((p) => p.prepRevision))
    const rev = options.groupRevision ?? (max === 0 ? 1 : existing.some((p) => p.prepRevision === max) ? max + 1 : max)
    const mosaic = subject.mosaic.name
    const recordedResults = existing.at(-1)?.resultsPath ?? null
    const recordedRoot = recordedResults ? recordedResults.slice(0, recordedResults.lastIndexOf("/")) : null
    const groupFolder = projectDir ? `${projectDir}/${mosaic}${rev > 1 ? ` (rev ${rev})` : ""}` : null
    return {
      parent,
      projectDir,
      prepRevision: rev,
      groupFolder,
      folderPath: groupFolder ? `${groupFolder}/Panel ${panel.n}` : null,
      resultsPath: recordedResults ?? (projectDir ? `${projectDir}/${mosaic} Results/Panel ${panel.n}` : null),
      assembledPath: recordedRoot ? `${recordedRoot}/Assembled` : projectDir ? `${projectDir}/${mosaic} Results/Assembled` : null,
    }
  }
  const rev = Math.max(0, ...existing.map((p) => p.prepRevision)) + 1
  return {
    parent,
    projectDir,
    prepRevision: rev,
    groupFolder: null,
    folderPath: projectDir ? `${projectDir}/${run.name}${rev > 1 ? ` (rev ${rev})` : ""}` : null,
    resultsPath: existing.at(-1)?.resultsPath ?? (projectDir ? `${projectDir}/${run.name} Results` : null),
    assembledPath: null,
  }
}

/** The group's recorded Assembled folder (D-W73), from any panel preparation, else the proposed one. */
export function groupAssembledPath(state: PrototypeState, group: RunGroup): string | null {
  const first = group.runIds.map((id) => state.catalog.runs[id]).find((r): r is Run => r !== undefined)
  return first ? runLayout(state, first).assembledPath : null
}

// ---------------------------------------------------------------------------
// Corrected metadata (PREP-FR-03)
// ---------------------------------------------------------------------------

export const FIELD_LABEL: Record<CorrectionField, string> = { target: "Target", equipment: "Equipment", filter: "Filter", exposure: "Exposure", "focal-length": "Focal length" }
export const FIELD_KEYWORD: Record<CorrectionField, string> = { target: "OBJECT", equipment: "TELESCOP", filter: "FILTER", exposure: "EXPTIME", "focal-length": "FOCALLEN" }

export type MetadataChoice = MetadataDecision["decision"]

export const METADATA_CHOICE_LABEL: Record<MetadataChoice, string> = {
  configuration: "Application configuration",
  "patched-copy": "Patched copy",
  "accept-source": "Accept the source value",
  excluded: "Exclude these inputs",
}

export interface MetadataDiff {
  key: string
  session: Session
  field: CorrectionField
  assetIds: string[]
  catalogValue: string
  sourceValue: string | null
}

/** Catalog values that differ from what the application reads in the source headers. */
export function metadataDiffs(members: MemberSession[]): MetadataDiff[] {
  const out: MetadataDiff[] = []
  for (const member of members) {
    const { session } = member
    for (const field of new Set(session.corrections.map((c) => c.field))) {
      const correction = latestCorrection(session, field)
      if (!correction || correction.observedValue === correction.correctedValue) continue
      out.push({ key: `${session.id}:${field}`, session, field, assetIds: member.included, catalogValue: correction.correctedValue, sourceValue: correction.observedValue })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Input modes (PREP-FR-04, PREP-FR-05, D04)
// ---------------------------------------------------------------------------

export type LinkType = "symlink" | "hardlink"

export interface ModeOption {
  mode: InputMode
  allowed: boolean
  reasons: string[]
  semantics: string
  footprintBytes: number
}

const MODES: InputMode[] = ["linked", "copy", "clone", "direct-source"]

function modeSemantics(mode: InputMode, linkType: LinkType): string {
  switch (mode) {
    case "linked":
      return linkType === "symlink"
        ? "A run folder of symbolic links to the originals. References, not backups: a writing application alters the source."
        : "A run folder of hard links. Same volume only; the link and the original are the same file."
    case "direct-source":
      return "No run folder entries: the profile gets the exact original paths in a file list. Nothing is linked or copied."
    case "copy":
      return "Isolated full copies of every input. Needs storage for every byte; originals are never touched."
    case "clone":
      return "Isolated copy-on-write clones on the same volume. Near-zero storage until either side changes."
  }
}

// ---------------------------------------------------------------------------
// Preparation plan (PREP-FR-04 to PREP-FR-09)
// ---------------------------------------------------------------------------

export interface PrepareEntry {
  id: string
  kind: "light" | "calibration" | "product"
  assetId: string | null
  resultId: string | null
  label: string
  sourcePath: string
  destPath: string
  fileName: string
  sizeBytes: number
  /** Reviewed catalog values an isolated entry carries in its header (PREP-FR-03). */
  patches: Array<{ field: CorrectionField; value: string }>
  /** Why the source cannot be read now; the entry is listed as blocked, never omitted. */
  unavailable: string | null
}

export interface PlanCheck {
  id: string
  label: string
  ok: boolean
  /** Blocks Prepare when not ok; otherwise a named warning (the input is blocked and the outcome is Partial). */
  blocking: boolean
  detail: string
}

export interface PrepareChoices {
  linkType: LinkType
  metadata: Record<string, MetadataChoice>
}

export const DEFAULT_CHOICES: PrepareChoices = { linkType: "symlink", metadata: {} }

export interface PreparePlan {
  run: Run
  revision: MembershipRevision | null
  profile: ApplicationProfile | null
  mode: InputMode | null
  linkType: LinkType
  modes: ModeOption[]
  layout: RunLayout
  destination: Volume | null
  free: number | null
  diffs: MetadataDiff[]
  metadata: Record<string, MetadataChoice>
  metadataExcluded: Set<string>
  entries: PrepareEntry[]
  calibration: CalibrationPlan
  footprintBytes: number
  checks: PlanCheck[]
  ready: boolean
}

function entryFromAsset(state: PrototypeState, asset: Asset, folder: string, kind: "light" | "calibration", patches: PrepareEntry["patches"]): PrepareEntry {
  const copy = preferredCopy(state.disk, state.catalog, asset)
  const availability = copyAvailability(state.disk, state.catalog, copy)
  const location = state.catalog.locations[copy.locationId]
  const volume = state.disk.volumes[location?.volumeId ?? copy.volumeId]
  const unavailable =
    availability === "available"
      ? deniedAncestor(state.disk, copy.path)
        ? `Unreadable: read access to ${copy.path} is denied`
        : null
      : availability === "offline"
        ? `Offline: ${volume?.name ?? "its volume"} is not connected`
        : availability === "retired"
          ? `Retired: ${location?.displayName ?? "its location"} is retired and never an input`
          : availability === "unreadable"
            ? `Unreadable: read access to ${copy.path} is denied`
            : `Not found at ${copy.path} at the last scan`
  const sub = kind === "calibration" ? "calibration" : "lights"
  return {
    id: `${kind === "calibration" ? "c" : "a"}:${asset.id}`,
    kind,
    assetId: asset.id,
    resultId: null,
    label: asset.fileName,
    sourcePath: copy.path,
    destPath: `${folder}/${sub}/${asset.fileName}`,
    fileName: asset.fileName,
    sizeBytes: asset.sizeBytes,
    patches,
    unavailable,
  }
}

export function preparePlan(state: PrototypeState, run: Run, choices: PrepareChoices, options: { groupRevision?: number } = {}): PreparePlan {
  const { catalog, disk } = state
  const revision = savedContent(run)
  const content = revision ?? workingContent(run)
  const setup = runSetup(catalog, run)
  const profile = setup.profileId ? (catalog.profiles[setup.profileId] ?? null) : null
  const members = content ? memberSessions(catalog, content) : []
  const calibration = calibrationPlan(catalog, disk, run, setup.calibrationPolicy, content)
  const layout = runLayout(state, run, options)
  const parentIssue = parentProblem(state, layout.parent)
  const destinationId = layout.parent.path ? volumeForPath(disk, layout.parent.path) : null
  const destination = destinationId ? (disk.volumes[destinationId] ?? null) : null
  const free = destination?.mounted ? freeBytes(disk, destination.id) : null
  const diffs = metadataDiffs(members)
  const metadata: Record<string, MetadataChoice> = {}
  const metadataExcluded = new Set<string>()
  const patched = new Map<string, PrepareEntry["patches"]>()
  for (const diff of diffs) {
    const choice = choices.metadata[diff.key]
    if (!choice) continue
    metadata[diff.key] = choice
    if (choice === "excluded") for (const id of diff.assetIds) metadataExcluded.add(id)
    if (choice === "patched-copy") for (const id of diff.assetIds) patched.set(id, [...(patched.get(id) ?? []), { field: diff.field, value: diff.catalogValue }])
  }
  const folder = layout.folderPath ?? "<output>"
  const entries: PrepareEntry[] = []
  for (const id of content?.included ?? []) {
    const asset = catalog.assets[id]
    if (!asset || metadataExcluded.has(id)) continue
    entries.push(entryFromAsset(state, asset, folder, "light", patched.get(id) ?? []))
  }
  for (const id of content?.unresolved ?? []) {
    const asset = catalog.assets[id]
    if (asset) entries.push({ ...entryFromAsset(state, asset, folder, "light", []), unavailable: entryFromAsset(state, asset, folder, "light", []).unavailable ?? "Unresolved member: it could not be read when it was selected" })
  }
  for (const resultId of content?.productInputs ?? []) {
    const result = catalog.results[resultId]
    if (!result) continue
    const file = fileAt(disk, result.path)
    entries.push({
      id: `r:${result.id}`,
      kind: "product",
      assetId: null,
      resultId: result.id,
      label: fileName(result.path),
      sourcePath: result.path,
      destPath: `${folder}/products/${fileName(result.path)}`,
      fileName: fileName(result.path),
      sizeBytes: file?.sizeBytes ?? 0,
      patches: [],
      unavailable: file ? null : `Not readable at ${result.path}`,
    })
  }
  for (const source of handoffCalibration(catalog, calibration)) {
    for (const f of source.files) {
      const asset = f.assetId ? catalog.assets[f.assetId] : undefined
      if (asset) {
        if (!entries.some((e) => e.id === `c:${asset.id}`)) entries.push(entryFromAsset(state, asset, folder, "calibration", []))
        continue
      }
      const onDisk = fileAt(disk, f.path)
      entries.push({
        id: `f:${f.path}`,
        kind: "calibration",
        assetId: null,
        resultId: null,
        label: f.fileName,
        sourcePath: f.path,
        destPath: `${folder}/calibration/${f.fileName}`,
        fileName: f.fileName,
        sizeBytes: onDisk?.sizeBytes ?? f.sizeBytes,
        patches: [],
        unavailable: onDisk ? null : `Not readable at ${f.path}`,
      })
    }
  }
  const totalBytes = entries.reduce((n, e) => n + e.sizeBytes, 0)
  const sourceVolumes = new Set(entries.map((e) => volumeForPath(disk, e.sourcePath)).filter((v): v is string => v !== null))
  const destName = destination?.name ?? "the output volume"
  const readOnlyProfile = profile?.capability.verified === true && profile.capability.inputWrite === "read-only"
  const modes: ModeOption[] = MODES.map((m) => {
    const reasons: string[] = []
    if (profile && !profile.capability.inputModes.includes(m)) reasons.push(`${profile.name} has no recorded support for ${MODE_LABEL[m]}.`)
    if ((m === "linked" || m === "direct-source") && profile && !readOnlyProfile) {
      reasons.push(`${profile.name} has ${profile.capability.inputWrite === "write-prone" ? "write-prone" : "unknown"} input-write behaviour, so it could write into your originals. Use Copy or Clone (D04).`)
    }
    if (m === "linked" && destination) {
      const can = choices.linkType === "hardlink" ? destination.links.hardlink : destination.links.symlink
      if (!can) reasons.push(`${destName} does not support ${choices.linkType === "hardlink" ? "hard links" : "symbolic links"}.`)
      else if (choices.linkType === "hardlink" && [...sourceVolumes].some((v) => v !== destination.id)) reasons.push(`Hard links need every source on ${destName}; some sources are on another volume.`)
    }
    if (m === "direct-source" && profile?.capability.directSource === "whole-folder" && (content?.excluded.length ?? 0) > 0) {
      reasons.push(`${profile.name} reads whole folders, which would hand off ${plural(content!.excluded.length, "excluded frame")}. Use a prepared mode.`)
    }
    if (m === "direct-source" && profile?.capability.directSource === "none") reasons.push(`${profile.name} records no way to pass exact source paths.`)
    if (m === "clone" && destination) {
      if (!destination.links.clone) reasons.push(`${destName} does not support clones.`)
      else if ([...sourceVolumes].some((v) => v !== destination.id)) reasons.push(`Clones need every source on ${destName}; some sources are on another volume.`)
    }
    if (m === "copy" && free !== null && totalBytes > free) reasons.push(`Copy needs ${formatBytes(totalBytes)}; ${destName} has ${formatBytes(free)} free.`)
    const footprintBytes = m === "copy" ? totalBytes : m === "clone" ? Math.round(totalBytes * 0.001) : 0
    return { mode: m, allowed: reasons.length === 0, reasons, semantics: modeSemantics(m, choices.linkType), footprintBytes }
  })
  const mode = setup.inputMode
  const chosen = mode ? modes.find((m) => m.mode === mode)! : null
  const isolated = mode === "copy" || mode === "clone"
  const checks: PlanCheck[] = []
  checks.push({ id: "membership", label: "Saved membership", ok: revision !== null, blocking: true, detail: revision ? `Revision ${revision.revision}, saved` : run.draft ? "Save the run's selection first: Prepare uses a saved revision." : "Save a selection first." })
  const calOk = calibration.policy === "off" || (calibration.rows.length > 0 && calibration.needsReview.length === 0) || (members.length === 0 && (content?.productInputs.length ?? 0) > 0)
  checks.push({
    id: "calibration",
    label: "Calibration",
    ok: calOk,
    blocking: true,
    detail: calibration.policy === "off" ? "Calibration off: none is handed off." : calOk ? `${plural(handoffCalibration(catalog, calibration).length, "input")} for ${plural(calibration.rows.length, "requirement")}` : `${plural(calibration.needsReview.length, "requirement")} need review in Calibrate.`,
  })
  checks.push({ id: "profile", label: "Application profile", ok: profile !== null, blocking: true, detail: profile ? profile.name : "Choose an application profile." })
  const products = (content?.productInputs ?? []).map((id) => catalog.results[id]).filter((r): r is ResultRecord => r !== undefined)
  if (products.length > 0 && profile) {
    const unsupported = products.filter((r) => r.kind === null || !profile.capability.productInputKinds.includes(r.kind))
    checks.push({
      id: "products",
      label: "Product inputs",
      ok: unsupported.length === 0,
      blocking: true,
      detail:
        unsupported.length === 0
          ? `${profile.name} reads ${[...new Set(products.map((r) => (r.kind ? PRODUCT_KIND_LABEL[r.kind] : "unknown kind")))].join(" and ")}`
          : `${profile.name} has no recorded support for ${unsupported.map((r) => `${fileName(r.path)} (${r.kind ? PRODUCT_KIND_LABEL[r.kind] : "unknown kind"})`).join(", ")}. Choose another application or remove it in Select.`,
    })
  }
  const undecided = diffs.filter((d) => !metadata[d.key])
  const badPatch = diffs.filter((d) => metadata[d.key] === "patched-copy" && !isolated)
  const badConfig = diffs.filter((d) => metadata[d.key] === "configuration" && profile?.capability.correctedMetadata !== "configuration")
  checks.push({
    id: "metadata",
    label: "Corrected metadata",
    ok: undecided.length === 0 && badPatch.length === 0 && badConfig.length === 0,
    blocking: true,
    detail:
      diffs.length === 0
        ? "No catalog value differs from the source headers."
        : undecided.length > 0
          ? `Choose how ${plural(undecided.length, "correction")} reach${undecided.length === 1 ? "es" : ""} the application.`
          : badPatch.length > 0
            ? `Patched copies need Copy or Clone; the mode is ${mode ? MODE_LABEL[mode] : "not chosen"}.`
            : badConfig.length > 0
              ? `${profile?.name ?? "This application"} cannot read corrected values through configuration.`
              : `${plural(diffs.length, "decision")} recorded`,
  })
  checks.push({
    id: "mode",
    label: "Input mode",
    ok: chosen?.allowed === true,
    blocking: true,
    detail: !chosen ? "Choose an input mode." : chosen.allowed ? `${MODE_LABEL[chosen.mode]}${chosen.mode === "linked" ? ` (${choices.linkType === "hardlink" ? "hard links" : "symbolic links"})` : ""}` : chosen.reasons.join(" "),
  })
  const folderTaken = layout.folderPath ? pathOccupied(state, layout.folderPath) : false
  checks.push({
    id: "destination",
    label: "Run folder",
    ok: parentIssue === null && !folderTaken,
    blocking: true,
    detail: parentIssue ? parentIssue.message : folderTaken ? `${layout.folderPath} already exists. PlateVault never reuses or clears a folder; choose another output folder.` : `${layout.folderPath} is free; write permission checked.`,
  })
  const footprintBytes = chosen?.footprintBytes ?? 0
  checks.push({ id: "space", label: "Free space", ok: free === null || footprintBytes <= free, blocking: true, detail: free === null ? "Known once an output folder is chosen." : `${formatBytes(footprintBytes)} needed, ${formatBytes(free)} free on ${destName}` })
  const unavailable = entries.filter((e) => e.unavailable !== null)
  checks.push({
    id: "sources",
    label: "Source presence",
    ok: unavailable.length === 0,
    blocking: false,
    detail: unavailable.length === 0 ? `${plural(entries.length, "source")} readable now` : `${plural(unavailable.length, "source")} cannot be read now; ${unavailable.length === 1 ? "it is" : "they are"} blocked and the outcome is Partial.`,
  })
  if (entries.length === 0) checks.push({ id: "entries", label: "Inputs", ok: false, blocking: true, detail: "Nothing to prepare: the saved membership has no included frames or product inputs." })
  const lock = runLock(run)
  if (lock) checks.unshift({ id: "lock", label: "Run state", ok: false, blocking: true, detail: lock })
  return {
    run,
    revision,
    profile,
    mode,
    linkType: choices.linkType,
    modes,
    layout,
    destination,
    free,
    diffs,
    metadata,
    metadataExcluded,
    entries,
    calibration,
    footprintBytes,
    checks,
    ready: checks.every((c) => c.ok || !c.blocking) && entries.length > unavailable.length,
  }
}

// ---------------------------------------------------------------------------
// Open re-verifies (PREP-FR-10, D19)
// ---------------------------------------------------------------------------

/** Recorded with the "prepare" operation payload; Open checks each entry against it. */
export interface PrepareJournal {
  entries: Record<string, PrepareEntry>
  snapshots: Record<string, string>
  expected: Record<string, string>
}

export interface VerifyOutcome {
  changed: Array<{ path: string; reason: string }>
  checked: number
}

/**
 * Reads only. A preparation recorded by this slice is checked against its
 * operation journal; an earlier one (the demo seed) against each frame's
 * recorded digest and its run folder entry.
 */
export function verifyPreparation(state: PrototypeState, prep: Preparation): VerifyOutcome {
  const changed: VerifyOutcome["changed"] = []
  const op = prep.operationId ? state.operations[prep.operationId] : undefined
  const journal = op?.payload as unknown as Partial<PrepareJournal> | undefined
  if (journal?.entries && journal.snapshots) {
    let checked = 0
    for (const [id, entry] of Object.entries(journal.entries)) {
      const snapshot = journal.snapshots[id]
      const prepared = entry.resultId ? prep.preparedResultIds.includes(entry.resultId) : entry.kind === "calibration" ? Boolean(snapshot) : entry.assetId !== null && prep.preparedAssetIds.includes(entry.assetId)
      if (!prepared || !snapshot) continue
      checked += 1
      const written = prep.mode === "direct-source" ? undefined : fileAt(state.disk, entry.destPath)
      if (prep.mode !== "direct-source" && !written) {
        changed.push({ path: entry.destPath, reason: "The run folder entry is missing or its volume is offline." })
        continue
      }
      const source = written?.linkTarget ?? entry.sourcePath
      const current = fileAt(state.disk, source)
      if (!current) {
        changed.push({ path: source, reason: "The source cannot be read now (offline or missing)." })
        continue
      }
      if (current.sha256 !== snapshot) {
        changed.push({ path: source, reason: "Changed since its preparation snapshot: its SHA-256 differs." })
        continue
      }
      if (written && !written.linkTarget && written.sha256 !== journal.expected?.[id]) changed.push({ path: entry.destPath, reason: "This entry no longer matches what was prepared." })
    }
    return { changed, checked }
  }
  const entries = filesUnder(state.disk, prep.folderPath)
  for (const assetId of prep.preparedAssetIds) {
    const asset = state.catalog.assets[assetId]
    if (!asset) {
      changed.push({ path: prep.folderPath, reason: "A prepared frame is no longer in the catalog." })
      continue
    }
    if (assetAvailability(state.disk, state.catalog, asset) !== "available") {
      changed.push({ path: preferredCopy(state.disk, state.catalog, asset).path, reason: "The source cannot be read now (offline or missing)." })
      continue
    }
    const sourcePath = preferredCopy(state.disk, state.catalog, asset).path
    if (fileAt(state.disk, sourcePath)?.sha256 !== asset.sha256) {
      changed.push({ path: sourcePath, reason: "Changed since it was prepared: its SHA-256 differs from the recorded digest." })
      continue
    }
    const intact = prep.mode === "direct-source" || entries.some((f) => (f.linkTarget ? asset.copies.some((c) => c.path === f.linkTarget) : f.sha256 === asset.sha256 && f.path.endsWith(`/${asset.fileName}`)))
    if (!intact) changed.push({ path: `${prep.folderPath}/lights/${asset.fileName}`, reason: "Its run folder entry is missing or no longer matches what was prepared." })
  }
  return { changed, checked: prep.preparedAssetIds.length }
}

/** The preparation of the run's latest saved revision, if any (the one Open and Clean up talk about first). */
export function currentPreparation(run: Run, preps: Preparation[]): Preparation | null {
  const latest = latestRevision(run)
  const forLatest = latest ? preps.filter((p) => p.membershipRevision === latest.revision) : []
  return forLatest.at(-1) ?? null
}

// ---------------------------------------------------------------------------
// Results (RES-FR-01 to RES-FR-04, RES-FR-08, D-W4, D-W67)
// ---------------------------------------------------------------------------

const INTERMEDIATE_DIRS = ["calibrated", "registered", "debayered", "cosmetized", "approval", "fastIntegration", "drizzle"]
const INTERMEDIATE_SUFFIX = /_(c|cc|c_r|c_cc_r|r|d|c_d_r)\.(xisf|fits?)$/i
const MASTER_CAL = /master(Dark|Flat|Bias|DarkFlat)/i

export type DiscoveredKind = { type: "product"; kind: ResultKind | null; channel: string | null; intermediate: boolean } | { type: "master"; kind: CalibrationKind; channel: string | null } | { type: "ignored" }

/** How a file in a Results folder is recognized; nothing is ever treated as accepted. */
export function recognize(file: DiskFile, assembled: boolean): DiscoveredKind {
  if (file.kind === "log" || file.kind === "text" || file.kind === "csv" || file.kind === "other") return { type: "ignored" }
  const name = fileName(file.path)
  const channel = /FILTER-([A-Za-z0-9]+)/.exec(name)?.[1] ?? null
  const master = MASTER_CAL.exec(name)
  if (master) {
    const word = master[1]!.toLowerCase()
    return { type: "master", kind: word === "darkflat" ? "dark-flat" : (word as CalibrationKind), channel }
  }
  const segments = file.path.split("/")
  const intermediate = segments.some((s) => INTERMEDIATE_DIRS.includes(s)) || INTERMEDIATE_SUFFIX.test(name)
  if (intermediate) return { type: "product", kind: null, channel, intermediate: true }
  if (assembled) return { type: "product", kind: "assembled-mosaic", channel, intermediate: false }
  if (/masterLight/i.test(name)) return { type: "product", kind: "linear-integration", channel, intermediate: false }
  if (file.kind === "tiff" || /\.(tiff?|jpe?g|png)$/i.test(name)) return { type: "product", kind: "final-image", channel, intermediate: false }
  return { type: "product", kind: null, channel, intermediate: false }
}

export interface Attribution {
  label: string
  basis: "tool" | "window" | "unknown"
}

/** Revision attribution: tool evidence, else the time window as an inference, else Unknown (D-W67). */
export function attribution(record: ResultRecord, file: DiskFile | undefined, preps: Preparation[]): Attribution {
  if (record.fromPrepRevision !== null && record.lineage === "tool-recorded") return { label: `Rev ${record.fromPrepRevision}`, basis: "tool" }
  if (!file || preps.length === 0) return { label: "Unknown", basis: "unknown" }
  const ordered = [...preps].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const at = file.modifiedAt
  for (let i = ordered.length - 1; i >= 0; i -= 1) {
    const prep = ordered[i]!
    const next = ordered[i + 1]
    const after = (prep.settledAt ?? prep.createdAt) <= at
    const before = !next || at < next.createdAt
    if (after && before) return { label: `Rev ${prep.prepRevision}`, basis: "window" }
  }
  return { label: "Unknown", basis: "unknown" }
}

export interface ResultRow {
  record: ResultRecord
  file: DiskFile | undefined
  pending: boolean
  /** The current bytes differ from the inspected digest. */
  changed: boolean
  readable: boolean
  attribution: Attribution
}

export function resultRow(state: PrototypeState, record: ResultRecord, preps: Preparation[]): ResultRow {
  const file = fileAt(state.disk, record.path)
  return {
    record,
    file,
    pending: file?.growing === true,
    changed: file !== undefined && file.sha256 !== record.sha256,
    readable: file !== undefined,
    attribution: attribution(record, file, preps),
  }
}

/** Every Results folder recorded for a run: one shared by every revision (D-W67). */
export function resultsFolders(state: PrototypeState, run: Run): string[] {
  const recorded = [...new Set(runPreparations(state.catalog, run.id).map((p) => p.resultsPath))]
  return recorded.length > 0 ? recorded : []
}

export interface DiscoveryScan {
  /** Files in the folder that are not yet listed: new candidates, intermediates and masters. */
  files: Array<{ file: DiskFile; kind: DiscoveredKind }>
}

/** Files in `folders` the catalog does not list yet; reads only. */
export function scanResultsFolders(state: PrototypeState, folders: string[], options: { assembled?: boolean } = {}): DiscoveryScan {
  const known = new Set(Object.values(state.catalog.results).map((r) => r.path))
  const masters = new Set(Object.values(state.catalog.masters).flatMap((m) => [m.path, m.origin.sourcePath]))
  const files: DiscoveryScan["files"] = []
  for (const folder of folders) {
    for (const file of filesUnder(state.disk, folder)) {
      if (known.has(file.path) || masters.has(file.path)) continue
      const kind = recognize(file, options.assembled === true)
      if (kind.type === "ignored") continue
      files.push({ file, kind })
    }
  }
  return { files }
}

// ---------------------------------------------------------------------------
// Clean up (PREP-FR-14, D-W26)
// ---------------------------------------------------------------------------

export interface CleanupEntry {
  path: string
  sizeBytes: number
  kind: "link" | "copy" | "list"
  prep: Preparation
}

export interface CleanupReview {
  entries: CleanupEntry[]
  /** Preparation folders that cannot be listed now, with the reason. */
  refused: Array<{ path: string; reason: string }>
  /** Direct-source preparations create no entries (PREP-FR-14). */
  directSource: Preparation[]
}

/** Only the entries the run's preparation revisions created: links, clones and copies. */
export function cleanupReview(state: PrototypeState, run: Run): CleanupReview {
  const out: CleanupReview = { entries: [], refused: [], directSource: [] }
  for (const prep of runPreparations(state.catalog, run.id)) {
    if (prep.mode === "direct-source") {
      out.directSource.push(prep)
      continue
    }
    const volumeId = volumeForPath(state.disk, prep.folderPath)
    const volume = volumeId ? state.disk.volumes[volumeId] : undefined
    if (!volume?.mounted) {
      out.refused.push({ path: prep.folderPath, reason: `${volume?.name ?? "Its volume"} is offline` })
      continue
    }
    for (const file of filesUnder(state.disk, prep.folderPath)) {
      out.entries.push({ path: file.path, sizeBytes: file.linkTarget ? 0 : file.sizeBytes, kind: file.linkTarget ? "link" : file.kind === "text" ? "list" : "copy", prep })
    }
  }
  return out
}

// ---------------------------------------------------------------------------
// Calibration readiness (D-W5)
// ---------------------------------------------------------------------------

export interface KindReadiness {
  kind: CalibrationKind
  matched: number
  total: number
  automatic: boolean
}

const SETTLED = new Set(["automatic", "accepted", "exception"])

export function readinessByKind(plan: CalibrationPlan): KindReadiness[] {
  return KINDS.map((kind) => {
    const rows = plan.rows.filter((r) => r.kind === kind)
    const matched = rows.filter((r) => SETTLED.has(r.state) && r.drift === null).length
    return { kind, matched, total: rows.length, automatic: rows.length > 0 && rows.every((r) => r.state === "automatic" && r.drift === null) }
  })
}

/** "dark 3/3 · flat 2/3 · bias ✓": ✓ when every requirement of the kind matched automatically. */
export function readinessText(plan: CalibrationPlan): string {
  if (plan.policy === "off") return "Calibration off: nothing is handed off"
  if (plan.rows.length === 0) return "No requirements yet: select and save sessions first"
  return readinessByKind(plan)
    .filter((k) => k.total > 0)
    .map((k) => `${KIND_LABEL[k.kind].toLowerCase()} ${k.automatic ? "✓" : `${k.matched}/${k.total}`}`)
    .join(" · ")
}

/** Candidates the automatic choice could not tell apart: compatible masters at the same night distance. */
export function tieOf(row: RequirementRow): RequirementRow["candidates"] {
  const [first, second] = row.candidates
  if (!first || !second || !first.summary.allCompatible || !second.summary.allCompatible) return []
  const night = row.member.session.night
  const distance = (n: string | null) => (n ? Math.abs(new Date(n).getTime() - new Date(night).getTime()) : Number.POSITIVE_INFINITY)
  const tied = row.candidates.filter((c) => c.summary.allCompatible && distance(c.source.night) === distance(first.source.night))
  return tied.length > 1 ? tied : []
}
