/**
 * A Project's View, Apply, Output and Wrap up (F4: D-W93 to D-W116,
 * VSEL-FR-12 to VSEL-FR-21, PREP-FR-06 to PREP-FR-19, RES-FR-01 to RES-FR-11,
 * PRJ-FR-14, PRJ-FR-27 to PRJ-FR-31). Pure: nothing here writes state; the
 * writes are in `src/store/actions/project-view.ts` and `projects.ts`.
 *
 * The Project's inputs, groups and settings are the desired state; its
 * `view` is the applied state the last Apply built. Every difference is a
 * pending change labelled with its source: the Project's own edits, which
 * it can discard, and changes from the Library (a rejected frame) or a
 * session's calibration (a reassigned pin), fixed at their source or by
 * removing the session (D-W109). Apply builds a complete `View (building)/`
 * from the originals only, verifies it and swaps it in; the old View
 * becomes `View (previous)/`, whose leftovers the next Apply waits on
 * (D-W110). Tools work in `Processing/<Tool>/`; Results live in `Output/`.
 */
import { KIND_NAME, masterKindOf, PIN_KINDS, sameChoice, sessionPinProblems, type CalSource, sourceFor, sourceKey, type PinProblem } from "./calibration"
import { type OfferEntry, type OfferRefusal, sessionsInTransfer, type TrashOffer, trashOffer, unusableFramesOffer } from "./archive"
import {
  findSubject,
  finishedOn,
  type FlowGate,
  goalProgress,
  heldCalibration,
  isLocked,
  isMosaic,
  liveAssetIds,
  type DerivedStep,
  type NextAction,
  openStepState,
  planningSite,
  projectLink,
  projectSessionsNeedingReview,
  projectSuggestions,
  rigName,
  runningGate,
  sessionIntakeLink,
  sessionRigId,
  sessionUnreviewedFrames,
  type StepLink,
  subjectCentre,
  subjectRef,
  subjectTarget,
  unsettled,
  viewCorrections,
  type World,
} from "./derive"
import { fakeSha256, fileAt, filesUnder, freeBytes, makeFile, trashRefusal, volumeForPath } from "./disk"
import { deniedAncestor, isUnder, sameFraming, sessionFraming, sessionRigVersion, stableHash } from "./indexing"
import { WRAP_UP_NAME, WRAP_UP_STEPS } from "./labels"
import { assetAvailability, preferredCopy } from "./library"
import { frameOut, framesRef, sessionExposureS, sessionLongRef } from "./membership"
import { bestWindowTonight, defaultCriteria } from "./planning"
import { keptCopy, type TrashBlock, trashBlock, type TrashItem, viewLinks } from "./storage"
import type {
  AppliedView,
  ApplicationKind,
  AssetId,
  CalibrationChoice,
  CalibrationKind,
  Catalog,
  CorrectionField,
  Disk,
  DiskFile,
  FrameHeader,
  GroupKeywords,
  InputMode,
  IsoDateTime,
  Operation,
  OperationId,
  OperationKind,
  OutputKind,
  OutputMeta,
  PinKind,
  PreviousLeftover,
  ProcessingMasterOffer,
  ProfileId,
  Project,
  ProjectGroup,
  ProjectGroupId,
  ProjectId,
  ProjectInput,
  ProjectState,
  Session,
  SessionId,
  ViewEntry,
  ViewLayout,
  ViewSource,
  WrapUpStepId,
  WrapUpStepRecord,
} from "./types"
import { formatCount } from "@/lib/format"
import { joinRefs, m, type MessageRef, type Messages, msg, say, verbatim } from "@/lib/i18n"

// ---------------------------------------------------------------------------
// Folders (PREP-FR-06, PRJ-FR-27)
// ---------------------------------------------------------------------------

export const VIEW_FOLDER = "View"
export const BUILDING_FOLDER = "View (building)"
export const PREVIOUS_FOLDER = "View (previous)"
export const PROCESSING_FOLDER = "Processing"
export const OUTPUT_FOLDER = "Output"
/** Each mosaic panel's result folder under `Output/` (RES-FR-08). */
export const PANELS_FOLDER = "Panels"

/** The Project folder's name: the Project name with path separators and reserved characters replaced. */
export function projectFolderName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]/g, "-") || "Project"
}

/**
 * A group, filter or keyword value as a folder token (PRJ-FR-27, D-W114):
 * spaces become hyphens and only letters, digits and `- ( ) : .` stay, the
 * characters WBPP accepts in a keyword value. The exact set is provisional
 * (OPEN: still to verify against WBPP).
 */
export function folderToken(value: string): string {
  const token = value.trim().replace(/\s+/g, "-").replace(/[^A-Za-z0-9\-():.]/g, "").replace(/-{2,}/g, "-").replace(/^-|-$/g, "")
  return token || "-"
}

export interface ProjectPaths {
  /** `<Processing parent>/<Project>`. */
  root: string
  view: string
  building: string
  previous: string
  processing: string
  output: string
}

/** The Project folder and its parts; null until a Processing parent is chosen (no root is assumed on first use, PREP-FR-06). */
export function projectPaths(world: Pick<World, "settings">, project: Pick<Project, "folderPath" | "name" | "settings">): ProjectPaths | null {
  const parent = project.settings.processingParent ?? world.settings.lastProcessingParent
  const root = project.folderPath ?? (parent ? `${parent}/${projectFolderName(project.name)}` : null)
  if (!root) return null
  return { root, view: `${root}/${VIEW_FOLDER}`, building: `${root}/${BUILDING_FOLDER}`, previous: `${root}/${PREVIOUS_FOLDER}`, processing: `${root}/${PROCESSING_FOLDER}`, output: `${root}/${OUTPUT_FOLDER}` }
}

/** A tool's working and output folder, `Processing/<Tool>/` (PREP-FR-07): one per tool, never `Output/`. */
export function toolFolder(paths: ProjectPaths, tool: string): string {
  return `${paths.processing}/${projectFolderName(tool)}`
}

// ---------------------------------------------------------------------------
// Groups (PRJ-FR-27 to PRJ-FR-31)
// ---------------------------------------------------------------------------

/** The keyword names the Project's folders use: its own, else Settings' (PRJ-FR-28). */
export function groupKeywords(world: Pick<World, "settings">, project: Pick<Project, "settings">): GroupKeywords {
  return project.settings.keywords ?? world.settings.keywords
}

/** `GROUP_RedCat-51` or `PANEL_Panel-2`: a group's folder, used only when the Project has two or more groups. */
export function groupFolder(world: Pick<World, "settings">, project: Pick<Project, "settings">, group: ProjectGroup): string {
  const keywords = groupKeywords(world, project)
  return `${group.panel ? keywords.panel : keywords.group}_${folderToken(group.name)}`
}

/**
 * The optics a group shares (PRJ-FR-31): camera, telescope, focal length
 * and reducer of the session's rig version. A rig version that changes only
 * filters keeps the group; null without a settled rig.
 */
export function opticsKey(catalog: Catalog, session: Session): string | null {
  const rig = sessionRigVersion(catalog, session)
  if (!rig) return null
  const v = rig.version
  return [rig.rigId, v.cameraId, v.telescopeId, v.effectiveFocalLengthMm, v.reducerId].join("|")
}

/** The held sessions of one group. */
export function groupInputs(project: Pick<Project, "inputs">, groupId: ProjectGroupId): ProjectInput[] {
  return project.inputs.filter((i) => i.groupId === groupId)
}

/** Where an added session goes: an existing group with its optics and framing, else a new group with its default name and panel mark. */
export interface GroupPlacement {
  groupId: ProjectGroupId | null
  name: string
  panel: boolean
}

const PANEL_IN_NAME = /panel\s*(\d+)/i

/**
 * The group a session joins when added (PRJ-FR-27, PRJ-FR-31): the first
 * group holding a session with the same optics and framing (the framing
 * margins of Settings). Otherwise a new group named by the defaults: the
 * rig's name; "<Rig> · Framing 2" for a second framing on that rig; and in
 * a mosaic "Panel N", N from the capture name when it holds one, else the
 * next number.
 */
export function groupPlacement(m: Messages, world: Pick<World, "catalog" | "settings">, project: Pick<Project, "inputs" | "groups">, session: Session): GroupPlacement {
  const { catalog } = world
  const optics = opticsKey(catalog, session)
  const framing = sessionFraming(catalog, session)
  for (const group of project.groups) {
    const members = groupInputs(project, group.id).map((i) => catalog.sessions[i.sessionId]).filter((s): s is Session => s !== undefined)
    if (members.some((s) => opticsKey(catalog, s) === optics && sameFraming(sessionFraming(catalog, s), framing, world.settings.matching.framing))) return { groupId: group.id, name: group.name, panel: group.panel }
  }
  if (isMosaic(project)) return { groupId: null, name: panelGroupName(m, project, [session.objectLabel]), panel: true }
  const taken = new Set(project.groups.map((g) => g.name))
  const rig = rigName(m, catalog, sessionRigId(session))
  const onRig = project.groups.filter((g) => groupInputs(project, g.id).some((i) => sessionRigId(catalog.sessions[i.sessionId] ?? session) === sessionRigId(session))).length
  if (onRig === 0 && !taken.has(rig)) return { groupId: null, name: rig, panel: false }
  let n = Math.max(2, onRig + 1)
  while (taken.has(say(m, msg("project_group_framing_n", { rig, n })))) n += 1
  return { groupId: null, name: say(m, msg("project_group_framing_n", { rig, n })), panel: false }
}

/**
 * "Panel N", the default name of a mosaic panel group (PRJ-FR-29): N from
 * the first capture (NINA) name that holds one ("IC 5070 Panel 2"), else
 * the next panel number; the first name no other group has. `except` is a
 * group being marked as a panel, which counts neither as a panel nor as a
 * name taken.
 */
export function panelGroupName(m: Messages, project: Pick<Project, "groups">, captureNames: ReadonlyArray<string | null>, except: ProjectGroupId | null = null): string {
  const others = project.groups.filter((g) => g.id !== except)
  const taken = new Set(others.map((g) => g.name))
  const fromCapture = captureNames.map((name) => PANEL_IN_NAME.exec(name ?? "")?.[1]).find((n) => n !== undefined)
  let n = fromCapture ? Number(fromCapture) : others.filter((g) => g.panel).length + 1
  while (taken.has(say(m, msg("common_panel_n", { n })))) n += 1
  return say(m, msg("common_panel_n", { n }))
}

/** "<Group> · 2": the default name of a group split from `group` (PRJ-FR-27), the first number not taken. */
export function splitGroupName(m: Messages, project: Pick<Project, "groups">, group: ProjectGroup): string {
  const taken = new Set(project.groups.map((g) => g.name))
  let n = 2
  while (taken.has(say(m, msg("project_group_split_n", { name: group.name, n })))) n += 1
  return say(m, msg("project_group_split_n", { name: group.name, n }))
}

// ---------------------------------------------------------------------------
// The planned View (PREP-FR-16, PREP-FR-19, D-W108)
// ---------------------------------------------------------------------------

/** One entry the next Apply would place. */
export interface PlannedEntry {
  /** Path under `View/`. */
  path: string
  source: ViewSource
  role: ViewEntry["role"]
  sessionId: SessionId | null
  groupId: ProjectGroupId | null
  /** The readable original it is built from, and its SHA-256 now. */
  originalPath: string
  sha256: string
  sizeBytes: number
  /** The corrected header values an isolated patched copy writes (PREP-FR-03); empty for a plain entry. */
  patches: Array<{ field: CorrectionField; value: string }>
}

export interface ViewPlan {
  entries: PlannedEntry[]
  layout: ViewLayout
  /** Frames the Project uses that no readable copy holds now: Apply cannot place them (VSEL-FR-14). */
  unresolved: Array<{ sessionId: SessionId; assetId: AssetId; path: string | null }>
  /** Pinned calibration files that cannot be read now, or whose source is gone. */
  unreadableCalibration: Array<{ sessionId: SessionId; kind: PinKind; path: string | null }>
  /** Bytes a build writes: every copy entry in full, each an independent file made from its original (never a hard link, D-W81), and every isolated patched copy. */
  bytes: number
}

/** Whether an entry is written as a copy: in Copies mode, or as an isolated patched copy in either mode. */
export function isCopyEntry(mode: InputMode, entry: Pick<PlannedEntry, "patches">): boolean {
  return mode === "copy" || entry.patches.length > 0
}

/** An entry's identity, which keeps its name for life (PREP-FR-19). */
export function sourceIdentity(source: ViewSource): string {
  return source.type === "asset" ? `asset:${source.assetId}` : `master:${source.masterId}:${source.versionId}`
}

function cameraKey(catalog: Catalog, session: Session): string {
  return sessionRigVersion(catalog, session)?.version.cameraId ?? session.cameraName ?? "?"
}

/** The settings a dark or bias source matches: a master record, or a raw set's camera settings. */
function calibrationSettingsKey(source: CalSource): string {
  if (source.source.type === "master") return `m:${source.source.masterId}`
  return `r:${[source.kind, source.cameraName, source.exposureS, source.gain, source.offset, source.binning, source.ccdTempC].join("|")}`
}

function readable(world: Pick<World, "disk">, path: string): DiskFile | undefined {
  const file = fileAt(world.disk, path)
  if (!file || world.disk.deniedPaths.some((d) => isUnder(path, d))) return undefined
  return file
}

/** A file name with a "-N" suffix before its extension. */
function suffixed(name: string, n: number): string {
  const dot = name.lastIndexOf(".")
  return dot > 0 ? `${name.slice(0, dot)}-${n}${name.slice(dot)}` : `${name}-${n}`
}

/**
 * The View the next Apply builds (PREP-FR-16): a `GROUP_`/`PANEL_` folder
 * per group only with two or more groups; `NIGHT_<date>/Lights/<filter>/`
 * and `Flats/<filter>/` per night, flats beside the lights they calibrate,
 * a second flat set for one group, night and filter in `NIGHT_<date>-2`;
 * `Darks/` and `Bias/` at the top with one camera and inside each group
 * with several, shared unless the Project mixes versions with the same
 * settings, when each goes into the night folders of the lights that use
 * it; the gain and offset are part of the folder name itself when the
 * Project mixes them, filter, gain, offset and exposure in that order
 * (`Ha_GAIN_120_OFFSET_50_300s`, D-W108; the order and the exposure part
 * are provisional). Entries keep
 * their names for life: a newcomer that clashes takes a suffix
 * (PREP-FR-19). A Closed Project plans from its frozen calibration.
 */
export function viewPlan(world: Pick<World, "catalog" | "disk" | "settings">, project: Project): ViewPlan {
  const { catalog, disk } = world
  const held = project.inputs.flatMap((input) => {
    const session = catalog.sessions[input.sessionId]
    return session ? [{ input, session, calibration: heldCalibration(catalog, project, session.id) }] : []
  })
  const groupsUsed = project.groups.filter((g) => held.some((h) => h.input.groupId === g.id))
  const layout: ViewLayout = {
    groupLevel: groupsUsed.length > 1,
    gain: new Set(held.map((h) => h.session.gain)).size > 1,
    offset: new Set(held.map((h) => h.session.offset)).size > 1,
    perGroupDarks: new Set(held.map((h) => cameraKey(catalog, h.session))).size > 1,
  }
  const groupPart = (groupId: ProjectGroupId): string[] => {
    const group = groupsUsed.find((g) => g.id === groupId)
    return layout.groupLevel && group ? [groupFolder(world, project, group)] : []
  }
  /**
   * The settings part of a folder name (D-W108): the filter folder alone,
   * or, when the Project mixes gain or offset, one name holding the filter,
   * the mixed GAIN_ and OFFSET_ values and, for lights, the exposure.
   * Darks and bias name only the mixed values.
   */
  const settingsPart = (s: Session, part: "lights" | "flats" | "calibration"): string[] => {
    const mixed = layout.gain || layout.offset
    const parts = [
      ...(part !== "calibration" && s.channel ? [folderToken(s.channel)] : []),
      ...(layout.gain ? [`GAIN_${folderToken(String(s.gain ?? "none"))}`] : []),
      ...(layout.offset ? [`OFFSET_${folderToken(String(s.offset ?? "none"))}`] : []),
      ...(part === "lights" && mixed ? [`${folderToken(String(Number(sessionExposureS(s).toFixed(3))))}s`] : []),
    ]
    return parts.length > 0 ? [parts.join("_")] : []
  }

  // A second flat set for one group, night and filter gets its own night folder.
  const flatSets = new Map<string, string[]>()
  const flatSetKey = (h: (typeof held)[number]) => [h.input.groupId, h.session.night, h.session.channel ?? ""].join("|")
  const flatKey = (h: (typeof held)[number]) => (h.calibration?.flat.state === "pinned" ? sourceKey(h.calibration.flat.source) : "none")
  for (const h of held) {
    const list = flatSets.get(flatSetKey(h)) ?? []
    if (!list.includes(flatKey(h))) list.push(flatKey(h))
    flatSets.set(flatSetKey(h), list)
  }
  const nightFolder = (h: (typeof held)[number]) => {
    const index = flatSets.get(flatSetKey(h))!.indexOf(flatKey(h))
    return `NIGHT_${h.session.night}${index > 0 ? `-${index + 1}` : ""}`
  }

  const unreadableCalibration: ViewPlan["unreadableCalibration"] = []
  const sources = new Map<string, CalSource | null>()
  const sourceOf = (choice: CalibrationChoice): CalSource | null => {
    if (choice.state !== "pinned") return null
    const key = sourceKey(choice.source)
    if (!sources.has(key)) sources.set(key, sourceFor(catalog, disk, choice.source))
    return sources.get(key) ?? null
  }
  // Darks and bias go per night when one scope mixes versions with the same settings.
  const versions = new Map<string, Set<string>>()
  const scopeKey = (h: (typeof held)[number], kind: PinKind, source: CalSource) => [layout.perGroupDarks ? h.input.groupId : "all", kind, calibrationSettingsKey(source)].join("|")
  for (const h of held) {
    for (const kind of ["dark", "bias"] as const) {
      const choice = h.calibration?.[kind]
      const source = choice ? sourceOf(choice) : null
      if (!choice || choice.state !== "pinned" || !source) continue
      const key = scopeKey(h, kind, source)
      versions.set(key, (versions.get(key) ?? new Set()).add(sourceKey(choice.source)))
    }
  }

  const corrections = viewCorrections(catalog, project.inputs, project.settings.profileId ? (catalog.profiles[project.settings.profileId] ?? null) : null)
  const patchesFor = new Map<AssetId, PlannedEntry["patches"]>()
  for (const d of corrections.decisions) if (d.decision === "patched-copy") patchesFor.set(d.assetId, [...(patchesFor.get(d.assetId) ?? []), { field: d.field, value: d.corrected }])

  type Draft = Omit<PlannedEntry, "path"> & { folder: string; name: string; identity: string }
  const drafts = new Map<string, Draft>()
  const add = (draft: Draft) => {
    const key = `${draft.folder}|${draft.identity}`
    if (!drafts.has(key)) drafts.set(key, draft)
  }
  const unresolved: ViewPlan["unresolved"] = []

  for (const h of held) {
    const { input, session } = h
    const group = groupPart(input.groupId)
    const night = nightFolder(h)
    for (const id of session.assetIds) {
      if (frameOut(catalog, input, id) !== null) continue
      const asset = catalog.assets[id]!
      if (assetAvailability(disk, catalog, asset) !== "available") {
        unresolved.push({ sessionId: session.id, assetId: id, path: asset.copies[0]?.path ?? null })
        continue
      }
      const copy = preferredCopy(disk, catalog, asset)
      add({
        folder: [...group, night, "Lights", ...settingsPart(session, "lights")].join("/"),
        name: asset.fileName,
        identity: `asset:${id}`,
        source: { type: "asset", assetId: id },
        role: "light",
        sessionId: session.id,
        groupId: input.groupId,
        originalPath: copy.path,
        sha256: asset.sha256,
        sizeBytes: asset.sizeBytes,
        patches: patchesFor.get(id) ?? [],
      })
    }
    for (const kind of PIN_KINDS) {
      const choice = h.calibration?.[kind]
      if (!choice || choice.state !== "pinned") continue
      const source = sourceOf(choice)
      if (!source) {
        unreadableCalibration.push({ sessionId: session.id, kind, path: null })
        continue
      }
      const folder =
        kind === "flat"
          ? [...group, night, "Flats", ...settingsPart(session, "flats")]
          : (versions.get(scopeKey(h, kind, source))?.size ?? 0) > 1
            ? [...group, night, kind === "dark" ? "Darks" : "Bias", ...settingsPart(session, "calibration")]
            : [...(layout.perGroupDarks ? group : []), kind === "dark" ? "Darks" : "Bias", ...settingsPart(session, "calibration")]
      for (const file of source.files) {
        const found = readable(world, file.path)
        if (!found) {
          unreadableCalibration.push({ sessionId: session.id, kind, path: file.path })
          continue
        }
        const viewSource: ViewSource = choice.source.type === "master" ? { type: "master", masterId: choice.source.masterId, versionId: choice.source.versionId } : { type: "asset", assetId: file.assetId ?? "" }
        add({
          folder: folder.join("/"),
          name: file.path.slice(file.path.lastIndexOf("/") + 1),
          identity: sourceIdentity(viewSource),
          source: viewSource,
          role: kind,
          sessionId: session.id,
          groupId: input.groupId,
          originalPath: file.path,
          sha256: file.sha256,
          sizeBytes: found.sizeBytes,
          patches: [],
        })
      }
    }
  }

  // Names are fixed for life (PREP-FR-19): an entry keeps the name the applied View gave it; a newcomer that clashes takes a suffix.
  const kept = new Map<string, string>()
  for (const entry of project.view?.entries ?? []) kept.set(sourceIdentity(entry.source), entry.path.slice(entry.path.lastIndexOf("/") + 1))
  const byFolder = new Map<string, Draft[]>()
  for (const draft of drafts.values()) byFolder.set(draft.folder, [...(byFolder.get(draft.folder) ?? []), draft])
  const entries: PlannedEntry[] = []
  for (const [folder, list] of byFolder) {
    const taken = new Set<string>()
    const ordered = [...list].sort((a, b) => Number(kept.has(b.identity)) - Number(kept.has(a.identity)))
    for (const { folder: _folder, name, identity, ...entry } of ordered) {
      let chosen = kept.get(identity) ?? name
      for (let n = 2; taken.has(chosen); n += 1) chosen = suffixed(name, n)
      taken.add(chosen)
      entries.push({ ...entry, path: `${folder}/${chosen}` })
    }
  }
  entries.sort((a, b) => a.path.localeCompare(b.path))

  const mode = project.settings.mode
  const bytes = entries.reduce((sum, entry) => (isCopyEntry(mode, entry) ? sum + entry.sizeBytes : sum), 0)
  return { entries, layout, unresolved, unreadableCalibration, bytes }
}

/** One folder of the planned View, for the Apply sheet's folder tree (VSEL-FR-14). */
export interface ViewFolderNode {
  name: string
  /** Path under `View/`; "" for the root. */
  path: string
  /** Entries directly inside. */
  entries: number
  /** Bytes of the entries directly inside (0 for links). */
  bytes: number
  children: ViewFolderNode[]
}

/** The folder tree of a set of entries, folders in name order. */
export function viewTree(entries: ReadonlyArray<Pick<PlannedEntry, "path" | "sizeBytes">>, mode: InputMode): ViewFolderNode {
  const root: ViewFolderNode = { name: VIEW_FOLDER, path: "", entries: 0, bytes: 0, children: [] }
  for (const entry of entries) {
    const parts = entry.path.split("/")
    let node = root
    for (const part of parts.slice(0, -1)) {
      const path = node.path ? `${node.path}/${part}` : part
      let child = node.children.find((c) => c.name === part)
      if (!child) {
        child = { name: part, path, entries: 0, bytes: 0, children: [] }
        node.children.push(child)
        node.children.sort((a, b) => a.name.localeCompare(b.name))
      }
      node = child
    }
    node.entries += 1
    if (mode === "copy") node.bytes += entry.sizeBytes
  }
  return root
}

/** Siril's standard folders in one working set (PREP-FR-17). */
export type SirilFolder = "lights" | "flats" | "darks" | "biases"

const SIRIL_FOLDER: Record<ViewEntry["role"], SirilFolder> = { light: "lights", flat: "flats", dark: "darks", bias: "biases" }

/** The application whose working sets link into View (PREP-FR-17): its sets are symlinks in either View mode. */
export const SIRIL_TOOL = "Siril"

/** One Siril working set under `Processing/Siril/`: each of its files a symlink to one View entry. */
export interface SirilSet {
  /** The set's folder: "GROUP_RedCat-51_Ha", with "_NIGHT_2026-10-12" when that night's flats differ from the set's other nights. */
  name: string
  /** `target` is the entry's path under `View/`. */
  links: Array<{ folder: SirilFolder; name: string; target: string }>
}

/**
 * Siril's working sets for a planned View (PREP-FR-17; provisional): one set
 * per group and light folder (the filter, with the mixed GAIN_/OFFSET_ and
 * exposure parts), and one per night when the nights' flats differ. Each
 * set links its lights and the flats, darks and bias those lights' sessions
 * have pinned, taken from the night folder of the lights where the View
 * places them there, else from the shared `Darks/` and `Bias/`.
 */
export function sirilSets(catalog: Catalog, project: Project, plan: Pick<ViewPlan, "entries" | "layout">): SirilSet[] {
  const identities = (sessionId: SessionId, kind: PinKind): Set<string> => {
    const choice = heldCalibration(catalog, project, sessionId)?.[kind]
    if (choice?.state !== "pinned") return new Set()
    const source = choice.source
    if (source.type === "master") return new Set([`master:${source.masterId}:${source.versionId}`])
    return new Set((catalog.sessions[source.sessionId]?.assetIds ?? []).map((id) => `asset:${id}`))
  }
  type Night = { folder: string; prefix: string; lights: PlannedEntry[]; calibration: PlannedEntry[] }
  const bases = new Map<string, Map<string, Night>>()
  for (const entry of plan.entries) {
    if (entry.role !== "light") continue
    const parts = entry.path.split("/")
    const at = parts.indexOf("Lights")
    if (at < 1) continue
    const group = plan.layout.groupLevel ? parts[0]! : null
    const base = [group, parts.slice(at + 1, -1).join("_")].filter(Boolean).join("_") || SIRIL_FOLDER.light
    const nights = bases.get(base) ?? new Map<string, Night>()
    const prefix = parts.slice(0, at).join("/")
    const night = nights.get(prefix) ?? { folder: parts[at - 1]!, prefix, lights: [], calibration: [] }
    night.lights.push(entry)
    nights.set(prefix, night)
    bases.set(base, nights)
  }
  const pick = (night: Night, kind: PinKind): PlannedEntry[] => {
    const wanted = new Set(night.lights.flatMap((l) => (l.sessionId ? [...identities(l.sessionId, kind)] : [])))
    const matching = plan.entries.filter((e) => e.role === kind && wanted.has(sourceIdentity(e.source)))
    const inNight = matching.filter((e) => isUnder(e.path, night.prefix))
    if (inNight.length > 0 || kind === "flat") return inNight
    const group = night.prefix.includes("/") ? night.prefix.slice(0, night.prefix.indexOf("/")) : null
    const shared = matching.filter((e) => !/(^|\/)NIGHT_/.test(e.path))
    return group && plan.layout.perGroupDarks ? shared.filter((e) => isUnder(e.path, group)) : shared
  }
  const sets: SirilSet[] = []
  for (const [base, nights] of bases) {
    for (const night of nights.values()) night.calibration = PIN_KINDS.flatMap((kind) => pick(night, kind))
    const flatKey = (night: Night) =>
      night.calibration
        .filter((e) => e.role === "flat")
        .map((e) => sourceIdentity(e.source))
        .sort()
        .join("|")
    const perNight = new Set([...nights.values()].map(flatKey)).size > 1
    const groups = perNight ? [...nights.values()].map((n) => ({ name: `${base}_${n.folder}`, nights: [n] })) : [{ name: base, nights: [...nights.values()] }]
    for (const { name, nights: members } of groups) {
      const links: SirilSet["links"] = []
      const taken = new Map<SirilFolder, Set<string>>()
      const seen = new Set<string>()
      for (const entry of members.flatMap((n) => [...n.lights, ...n.calibration])) {
        const identity = `${entry.role}:${sourceIdentity(entry.source)}`
        if (seen.has(identity)) continue
        seen.add(identity)
        const folder = SIRIL_FOLDER[entry.role]
        const used = taken.get(folder) ?? new Set<string>()
        const own = entry.path.slice(entry.path.lastIndexOf("/") + 1)
        let chosen = own
        for (let n = 2; used.has(chosen); n += 1) chosen = suffixed(own, n)
        used.add(chosen)
        taken.set(folder, used)
        links.push({ folder, name: chosen, target: entry.path })
      }
      sets.push({ name, links })
    }
  }
  return sets.sort((a, b) => a.name.localeCompare(b.name))
}

/** What placing one planned entry writes, or why it cannot (PREP-FR-09). */
export type PlacedEntry = { ok: true; file: DiskFile; entry: ViewEntry } | { ok: false; reason: MessageRef }

/**
 * Whether a plain copy of `originalPath` written to `path` is a clone (F2,
 * PREP-AC-25): both sit on one mounted local volume whose file system
 * clones. The prototype reads a local volume that holds symlinks as one that
 * clones (APFS); exFAT and network shares write a full copy. A clone is still
 * an independent file: changing it never changes the original or another
 * copy, and its logical size is what the footprint counts (D-W81).
 */
export function clonesCopy(disk: Disk, originalPath: string, path: string): boolean {
  const volumeId = volumeForPath(disk, path)
  const volume = volumeId ? disk.volumes[volumeId] : undefined
  return Boolean(volume?.mounted && volume.symlinks && !volume.network && volumeForPath(disk, originalPath) === volumeId)
}

/** A header with the corrected values an isolated patched copy writes (PREP-FR-03). */
function patchedHeader(header: FrameHeader | null, patches: PlannedEntry["patches"]): FrameHeader | null {
  if (!header || patches.length === 0) return header
  const out = { ...header }
  for (const { field, value } of patches) {
    if (field === "target") out.object = value
    else if (field === "equipment") out.telescope = value
    else if (field === "filter") out.filter = value
    else if (field === "exposure") out.exposureS = Number.parseFloat(value)
    else out.focalLengthMm = Number.parseFloat(value)
  }
  return out
}

/**
 * One planned entry written under `root` (`View (building)/`) from its
 * original only (PREP-FR-06, PREP-FR-09): a symlink, a copy, or an isolated
 * patched copy. The original must be readable and still hold the bytes the
 * plan read, and nothing may sit at the destination. Every copy is its own
 * file, cloned where the volume can, never a hard link to an original or to
 * another copy (D-W81). Pure: the caller writes `file` to the disk.
 */
export function placeEntry(disk: Disk, planned: PlannedEntry, root: string, mode: InputMode, at: IsoDateTime): PlacedEntry {
  const denied = deniedAncestor(disk, planned.originalPath)
  if (denied) return { ok: false, reason: msg("op_prep_denied", { path: planned.originalPath }) }
  const source = fileAt(disk, planned.originalPath)
  if (!source) return { ok: false, reason: msg("op_prep_not_reachable", { path: planned.originalPath }) }
  if (source.sha256 !== planned.sha256) return { ok: false, reason: msg("op_prep_source_changed") }
  const path = `${root}/${planned.path}`
  if (fileAt(disk, path)) return { ok: false, reason: msg("op_prep_destination_exists", { path }) }
  if (disk.readOnlyPaths.some((p) => isUnder(path, p))) return { ok: false, reason: msg("op_prep_write_removed", { folder: root }) }
  const volumeId = volumeForPath(disk, path)
  if (!volumeId || !disk.volumes[volumeId]?.mounted) return { ok: false, reason: msg("op_prep_destination_offline", { folder: root }) }
  const copy = isCopyEntry(mode, planned)
  const plain = planned.patches.length === 0
  const file = copy
    ? makeFile({
        path,
        volumeId,
        sizeBytes: source.sizeBytes,
        kind: source.kind,
        header: patchedHeader(source.header, planned.patches),
        pixelTruth: source.pixelTruth,
        sha256: plain ? source.sha256 : fakeSha256(path, 7),
        modifiedAt: at,
      })
    : makeFile({ path, volumeId, sizeBytes: 0, kind: source.kind, linkTarget: source.path, modifiedAt: at })
  return {
    ok: true,
    file,
    entry: { path: planned.path, source: planned.source, role: planned.role, originalPath: source.path, sha256: source.sha256, sizeBytes: copy ? source.sizeBytes : 0, copySha256: copy ? file.sha256 : null },
  }
}

/** Whether a placed entry reads back as written: a copy's bytes, or a link to an original that still holds the planned bytes. */
export function entryVerified(disk: Disk, root: string, entry: ViewEntry): boolean {
  const file = fileAt(disk, `${root}/${entry.path}`)
  if (!file) return false
  if (entry.copySha256 !== null) return file.sha256 === entry.copySha256
  return file.linkTarget === entry.originalPath && fileAt(disk, entry.originalPath)?.sha256 === entry.sha256
}

/**
 * The applied state an Apply records once its build swapped in
 * (VSEL-FR-16): the desired inputs, groups and settings as they were, the
 * calibration each held session read, and the entries it placed.
 */
export function appliedViewFor(world: Pick<World, "catalog">, project: Project, folderPath: string, entries: ViewEntry[], layout: ViewLayout, at: IsoDateTime, operationId: OperationId): AppliedView {
  const calibration: AppliedView["calibration"] = {}
  for (const input of project.inputs) {
    const cal = heldCalibration(world.catalog, project, input.sessionId)
    if (cal) calibration[input.sessionId] = cal
  }
  return { at, operationId, folderPath, settings: structuredClone(project.settings), inputs: structuredClone(project.inputs), groups: structuredClone(project.groups), calibration, entries, layout }
}

// ---------------------------------------------------------------------------
// Pending changes (VSEL-FR-12, D-W109)
// ---------------------------------------------------------------------------

/** Who made a pending change: the Project's own edit, the Library (a rejected or trashed frame), or a session's calibration. */
export type ChangeSource = "project" | "library" | "calibration"

export const CHANGE_SOURCE_NAME: Record<ChangeSource, MessageRef> = {
  project: msg("project_change_source_project"),
  library: msg("project_change_source_library"),
  calibration: msg("project_change_source_calibration"),
}

interface ChangeBase {
  /** Stable while the change holds. */
  id: string
  source: ChangeSource
  /** "Added Ha · 18 Sep · 300 s (55 frames)". */
  label: MessageRef
  /** Where the change is fixed: the session for a Library or calibration change (D-W109); null for the Project's own. */
  link: StepLink | null
}

export type PendingChange = ChangeBase &
  (
    | { kind: "session-added"; sessionId: SessionId; groupId: ProjectGroupId }
    | { kind: "session-removed"; sessionId: SessionId }
    | { kind: "session-moved"; sessionId: SessionId; from: ProjectGroupId; to: ProjectGroupId }
    | { kind: "frames-excluded" | "frames-included" | "frames-rejected" | "frames-restored"; sessionId: SessionId; assetIds: AssetId[] }
    | { kind: "calibration-changed"; sessionId: SessionId; pinKind: PinKind; from: CalibrationChoice; to: CalibrationChoice }
    | { kind: "group-renamed"; groupId: ProjectGroupId; from: string; to: string }
    | { kind: "mode-changed"; from: InputMode; to: InputMode }
    | { kind: "application-changed"; from: ProfileId | null; to: ProfileId | null }
    | { kind: "keywords-changed"; from: GroupKeywords | null; to: GroupKeywords | null }
  )

/** A Project can discard only its own edits (D-W109). */
export function isDiscardable(change: PendingChange): boolean {
  return change.source === "project"
}

function sessionLabel(catalog: Catalog, sessionId: SessionId): MessageRef {
  const session = catalog.sessions[sessionId]
  return session ? sessionLongRef(session) : msg("domain_diff_session_missing")
}

function groupName(groups: ProjectGroup[], id: ProjectGroupId): MessageRef {
  const group = groups.find((g) => g.id === id)
  return group ? verbatim(group.name) : msg("project_group_missing")
}

/** Frames of a held session that are in for this Project, catalog facts only (availability decides placement, not intent). */
function inFrames(catalog: Catalog, input: ProjectInput): Set<AssetId> {
  return new Set((catalog.sessions[input.sessionId]?.assetIds ?? []).filter((id) => frameOut(catalog, input, id) === null))
}

const FRAMES_CHANGE_KEY = {
  "frames-excluded": "project_change_frames_excluded",
  "frames-included": "project_change_frames_included",
  "frames-rejected": "project_change_frames_rejected",
  "frames-restored": "project_change_frames_restored",
} as const

/**
 * Every difference between the desired state and the applied View, with its
 * source (VSEL-FR-12). Empty before the first Apply (it builds the View
 * from the desired state) and for a Closed Project, which takes no incoming
 * changes.
 */
export function pendingChanges(world: Pick<World, "catalog" | "disk">, project: Project): PendingChange[] {
  const view = project.view
  if (!view || isLocked(project)) return []
  const { catalog } = world
  const out: PendingChange[] = []
  const applied = new Map(view.inputs.map((i) => [i.sessionId, i]))
  const desired = new Map(project.inputs.map((i) => [i.sessionId, i]))
  const placed = new Set(view.entries.flatMap((e) => (e.role === "light" && e.source.type === "asset" ? [e.source.assetId] : [])))
  const sessionLink = (sessionId: SessionId) => ({ to: "/sessions/$sessionId", params: { sessionId } })
  for (const [sessionId, input] of desired) {
    const before = applied.get(sessionId)
    if (!before) {
      const frames = inFrames(catalog, input).size
      out.push({ id: `add|${sessionId}`, kind: "session-added", sessionId, groupId: input.groupId, source: "project", label: msg("project_change_session_added", { session: sessionLabel(catalog, sessionId), frames: framesRef(frames) }), link: null })
      continue
    }
    if (before.groupId !== input.groupId) {
      out.push({
        id: `move|${sessionId}|${before.groupId}|${input.groupId}`,
        kind: "session-moved",
        sessionId,
        from: before.groupId,
        to: input.groupId,
        source: "project",
        label: msg("project_change_session_moved", { session: sessionLabel(catalog, sessionId), from: groupName(view.groups, before.groupId), to: groupName(project.groups, input.groupId) }),
        link: null,
      })
    }
    const want = inFrames(catalog, input)
    const had = new Set((catalog.sessions[sessionId]?.assetIds ?? []).filter((id) => placed.has(id)))
    const byKind: Record<"frames-excluded" | "frames-included" | "frames-rejected" | "frames-restored", AssetId[]> = { "frames-excluded": [], "frames-included": [], "frames-rejected": [], "frames-restored": [] }
    for (const id of had) {
      if (want.has(id)) continue
      const projectMade = input.excluded.includes(id) !== before.excluded.includes(id) || input.included.includes(id) !== before.included.includes(id)
      byKind[projectMade ? "frames-excluded" : "frames-rejected"].push(id)
    }
    for (const id of want) {
      if (had.has(id)) continue
      const projectMade = input.excluded.includes(id) !== before.excluded.includes(id) || input.included.includes(id) !== before.included.includes(id)
      byKind[projectMade ? "frames-included" : "frames-restored"].push(id)
    }
    for (const kind of ["frames-excluded", "frames-included", "frames-rejected", "frames-restored"] as const) {
      const assetIds = byKind[kind]
      if (assetIds.length === 0) continue
      const source: ChangeSource = kind === "frames-excluded" || kind === "frames-included" ? "project" : "library"
      out.push({ id: `${kind}|${sessionId}|${assetIds.length}`, kind, sessionId, assetIds, source, label: msg(FRAMES_CHANGE_KEY[kind], { session: sessionLabel(catalog, sessionId), frames: framesRef(assetIds.length) }), link: source === "library" ? sessionLink(sessionId) : null })
    }
    const now = catalog.sessions[sessionId]?.calibration
    const then = view.calibration[sessionId]
    if (now && then) {
      for (const pinKind of PIN_KINDS) {
        if (sameChoice(then[pinKind], now[pinKind])) continue
        out.push({
          id: `cal|${sessionId}|${pinKind}`,
          kind: "calibration-changed",
          sessionId,
          pinKind,
          from: then[pinKind],
          to: now[pinKind],
          source: "calibration",
          label: msg("project_change_calibration", { kind: KIND_NAME[pinKind], session: sessionLabel(catalog, sessionId) }),
          link: sessionLink(sessionId),
        })
      }
    }
  }
  for (const sessionId of applied.keys()) {
    if (!desired.has(sessionId)) out.push({ id: `remove|${sessionId}`, kind: "session-removed", sessionId, source: "project", label: msg("project_change_session_removed", { session: sessionLabel(catalog, sessionId) }), link: null })
  }
  for (const group of project.groups) {
    const before = view.groups.find((g) => g.id === group.id)
    if (before && before.name !== group.name) out.push({ id: `rename|${group.id}`, kind: "group-renamed", groupId: group.id, from: before.name, to: group.name, source: "project", label: msg("project_change_group_renamed", { from: before.name, to: group.name }), link: null })
  }
  const s = project.settings
  const a = view.settings
  if (s.mode !== a.mode) out.push({ id: "mode", kind: "mode-changed", from: a.mode, to: s.mode, source: "project", label: msg("project_change_mode", { mode: s.mode === "copy" ? msg("domain_mode_copy") : msg("domain_mode_symlink") }), link: null })
  if (s.profileId !== a.profileId) out.push({ id: "app", kind: "application-changed", from: a.profileId, to: s.profileId, source: "project", label: msg("project_change_application"), link: null })
  if (JSON.stringify(s.keywords) !== JSON.stringify(a.keywords)) out.push({ id: "keywords", kind: "keywords-changed", from: a.keywords, to: s.keywords, source: "project", label: msg("project_change_keywords"), link: null })
  return out
}

// ---------------------------------------------------------------------------
// The applied View on disk and View (previous)/ (VSEL-FR-14, VSEL-FR-20, D-W110)
// ---------------------------------------------------------------------------

export interface ViewDrift {
  /** Entries PlateVault placed that now differ: a copy rewritten by a tool, or an entry gone. */
  changed: Array<{ entry: ViewEntry; state: "changed" | "missing" }>
  /** Files in the View PlateVault didn't place (a DSS `.Info.txt`, Siril `process/`, the user's notes), by path under `View/`. */
  unplaced: Array<{ path: string; sizeBytes: number }>
}

/** What the applied View holds now against what Apply placed. Empty without a View or while its volume is offline. */
export function viewDrift(world: Pick<World, "disk">, project: Pick<Project, "view">): ViewDrift {
  const view = project.view
  if (!view) return { changed: [], unplaced: [] }
  const folder = view.folderPath
  const volumeId = volumeForPath(world.disk, folder)
  if (!volumeId || !world.disk.volumes[volumeId]?.mounted) return { changed: [], unplaced: [] }
  const placed = new Set(view.entries.map((e) => `${folder}/${e.path}`))
  const changed: ViewDrift["changed"] = []
  for (const entry of view.entries) {
    const file = fileAt(world.disk, `${folder}/${entry.path}`)
    if (!file) changed.push({ entry, state: "missing" })
    else if (entry.copySha256 !== null && file.sha256 !== entry.copySha256) changed.push({ entry, state: "changed" })
    else if (entry.copySha256 === null && file.linkTarget !== entry.originalPath) changed.push({ entry, state: "changed" })
  }
  const unplaced = filesUnder(world.disk, folder)
    .filter((f) => !placed.has(f.path))
    .map((f) => ({ path: f.path.slice(folder.length + 1), sizeBytes: f.sizeBytes }))
    .sort((a, b) => a.path.localeCompare(b.path))
  return { changed, unplaced }
}

/** The leftovers in `View (previous)/` still to review: the next Apply waits on them (D-W110). A kept one is not asked about again (provisional). */
export function unreviewedLeftovers(project: Pick<Project, "previous">): PreviousLeftover[] {
  return project.previous?.leftovers.filter((l) => !l.kept) ?? []
}

// ---------------------------------------------------------------------------
// Apply (PREP-FR-06, PREP-FR-08, PREP-FR-09, VSEL-FR-14, VSEL-FR-21)
// ---------------------------------------------------------------------------

/** Kinds that work on one Project: one PlateVault operation per Project at a time (PREP-FR-19, provisional). */
const PROJECT_OPERATION_KINDS: ReadonlySet<OperationKind> = new Set(["apply", "cleanup", "trash", "archive", "copy-to-output"])

/** The PlateVault operation working on the Project now, if any (the writer guard; not a lock against external tools). */
export function projectOperation(world: Pick<World, "operations">, projectId: ProjectId): Operation | null {
  return Object.values(world.operations).find((op) => op.scope.projectId === projectId && PROJECT_OPERATION_KINDS.has(op.kind) && unsettled(op)) ?? null
}

export type ApplyRefusal =
  | { kind: "locked" }
  | { kind: "busy"; operation: Operation }
  | { kind: "no-folder" }
  | { kind: "no-inputs" }
  | { kind: "nothing-to-apply" }
  | { kind: "unsettled"; sessions: Session[] }
  | { kind: "offline"; paths: string[] }
  | { kind: "pin-drift"; problems: Array<PinProblem & { session: Session }> }
  | { kind: "previous-unreviewed"; leftovers: PreviousLeftover[] }
  | { kind: "space"; neededBytes: number; freeBytes: number }
  | { kind: "developer-mode" }
  | { kind: "no-symlinks"; volume: string }

/** The Apply sheet's content (VSEL-FR-14, PREP-FR-08): what Apply would do now, and why it is refused. */
export interface ApplyPlan {
  projectId: ProjectId
  /** The Project revision the sheet was built from (D08). */
  revision: number
  /** A digest of everything the build depends on: Apply is refused when it changed after the sheet opened (VSEL-FR-21, provisional). */
  fingerprint: string
  /** No View yet: this Apply builds the first one. */
  first: boolean
  paths: ProjectPaths | null
  mode: InputMode
  plan: ViewPlan
  changes: PendingChange[]
  /** The layout changes: the user must re-add View in their tool (PRJ-FR-28, provisional copy). */
  layoutChanged: Array<keyof ViewLayout>
  tree: ViewFolderNode
  /** The applied View's copies that differ from what PlateVault placed: the new View gets fresh copies, the changed ones stay in `View (previous)/`. */
  drift: ViewDrift
  corrections: ReturnType<typeof viewCorrections>
  space: { neededBytes: number; freeBytes: number; twoViews: boolean }
  /** Siril's working sets the Apply links into `Processing/Siril/` (PREP-FR-17, provisional); null for any other application. */
  siril: SirilSet[] | null
  refusals: ApplyRefusal[]
}

/** The application kind of the Project's profile, or null with none chosen. */
export function projectApplication(catalog: Catalog, project: Pick<Project, "settings">): ApplicationKind | null {
  return project.settings.profileId ? (catalog.profiles[project.settings.profileId]?.application ?? null) : null
}

/**
 * Whether Apply writes symlinks (PREP-FR-15, PREP-FR-17): a Symlinks View,
 * or a Siril Project in either mode, whose `Processing/Siril/` sets are
 * symlinks (provisional consequence, PR #1804). Without symlinks (Windows
 * with Developer Mode off) such an Apply is refused, with no fallback.
 */
export function needsSymlinks(catalog: Catalog, project: Pick<Project, "settings">): boolean {
  return project.settings.mode === "symlink" || projectApplication(catalog, project) === "siril"
}

/**
 * The one rule for Apply's symlinks (PREP-FR-15, PREP-FR-17, PREP-AC-03;
 * provisional): when the Project needs symlinks (`needsSymlinks`), Windows
 * with Developer Mode off refuses, and so does a processing location whose
 * volume can't hold symlinks (exFAT, FAT): the user chooses another
 * location. No junction, copy or other fallback is tried. Null when Apply
 * can write its links, or writes none.
 */
export function symlinkRefusal(world: Pick<World, "catalog" | "disk" | "settings">, project: Pick<Project, "settings">, paths: Pick<ProjectPaths, "root"> | null): ApplyRefusal | null {
  if (!needsSymlinks(world.catalog, project)) return null
  if (world.settings.developerModeCheck === "off") return { kind: "developer-mode" }
  const volumeId = paths ? volumeForPath(world.disk, paths.root) : null
  const volume = volumeId ? world.disk.volumes[volumeId] : undefined
  return volume && !volume.symlinks ? { kind: "no-symlinks", volume: volume.name } : null
}

function layoutDiff(before: ViewLayout | null, after: ViewLayout): Array<keyof ViewLayout> {
  if (!before) return []
  return (Object.keys(after) as Array<keyof ViewLayout>).filter((k) => before[k] !== after[k])
}

/** What Apply would do now: the plan, the changes, the tree, the space and every refusal (VSEL-FR-14). */
export function applyPlan(world: World, project: Project): ApplyPlan {
  const { catalog, disk } = world
  const plan = viewPlan(world, project)
  const changes = pendingChanges(world, project)
  const paths = projectPaths(world, project)
  const drift = viewDrift(world, project)
  const mode = project.settings.mode
  const volumeId = paths ? volumeForPath(disk, paths.root) : null
  const free = volumeId ? freeBytes(disk, volumeId) : 0
  const refusals: ApplyRefusal[] = []
  const busy = projectOperation(world, project.id)
  const unsettledSessions = project.inputs.map((i) => catalog.sessions[i.sessionId]).filter((s): s is Session => s !== undefined && !PIN_KINDS.every((k) => s.calibration?.[k].state === "pinned" || s.calibration?.[k].state === "none"))
  const pinProblems = project.inputs.flatMap((i) => {
    const session = catalog.sessions[i.sessionId]
    return session ? sessionPinProblems(disk, session.calibration).filter((p) => p.state !== "unreadable").map((p) => ({ ...p, session })) : []
  })
  const offline = [...new Set([...plan.unresolved.map((u) => u.path ?? u.assetId), ...plan.unreadableCalibration.flatMap((c) => (c.path ? [c.path] : []))])]
  if (isLocked(project)) refusals.push({ kind: "locked" })
  if (busy) refusals.push({ kind: "busy", operation: busy })
  if (!paths) refusals.push({ kind: "no-folder" })
  if (project.inputs.length === 0 && !project.view) refusals.push({ kind: "no-inputs" })
  if (project.view && changes.length === 0 && drift.changed.length === 0) refusals.push({ kind: "nothing-to-apply" })
  if (unsettledSessions.length > 0) refusals.push({ kind: "unsettled", sessions: unsettledSessions })
  if (pinProblems.length > 0) refusals.push({ kind: "pin-drift", problems: pinProblems })
  if (offline.length > 0) refusals.push({ kind: "offline", paths: offline })
  const leftovers = unreviewedLeftovers(project)
  if (leftovers.length > 0) refusals.push({ kind: "previous-unreviewed", leftovers })
  if (paths && plan.bytes > free) refusals.push({ kind: "space", neededBytes: plan.bytes, freeBytes: free })
  const links = symlinkRefusal(world, project, paths)
  if (links) refusals.push(links)
  const fingerprint = stableHash(
    JSON.stringify({
      entries: plan.entries.map((e) => [e.path, sourceIdentity(e.source), e.sha256, e.originalPath, e.patches]),
      mode,
      profile: project.settings.profileId,
      layout: plan.layout,
      changes: changes.map((c) => c.id),
      drift: drift.changed.map((c) => c.entry.path),
    }),
  )
  return {
    projectId: project.id,
    revision: project.revision,
    fingerprint,
    first: project.view === null,
    paths,
    mode,
    plan,
    changes,
    layoutChanged: layoutDiff(project.view?.layout ?? null, plan.layout),
    tree: viewTree(plan.entries, mode),
    drift,
    corrections: viewCorrections(catalog, project.inputs, project.settings.profileId ? (catalog.profiles[project.settings.profileId] ?? null) : null),
    space: { neededBytes: plan.bytes, freeBytes: free, twoViews: mode === "copy" },
    siril: projectApplication(catalog, project) === "siril" ? sirilSets(catalog, project, plan) : null,
    refusals,
  }
}

/** One refusal in words: "2 originals are offline", "Review View (previous) first". */
export function applyRefusalRef(refusal: ApplyRefusal): MessageRef {
  switch (refusal.kind) {
    case "locked":
      return msg("apply_refused_locked")
    case "busy":
      return msg("domain_operation_running", { title: refusal.operation.title })
    case "no-folder":
      return msg("apply_refused_no_folder")
    case "no-inputs":
      return msg("apply_refused_no_inputs")
    case "nothing-to-apply":
      return msg("apply_refused_nothing")
    case "unsettled":
      return msg("apply_refused_unsettled", { count: refusal.sessions.length })
    case "offline":
      return msg("apply_refused_offline", { count: refusal.paths.length })
    case "pin-drift":
      return msg("apply_refused_pin_drift", { count: refusal.problems.length })
    case "previous-unreviewed":
      return msg("apply_refused_previous", { count: refusal.leftovers.length })
    case "space":
      return msg("apply_refused_space")
    case "developer-mode":
      return msg("apply_refused_developer_mode")
    case "no-symlinks":
      return msg("apply_refused_no_symlinks", { name: refusal.volume })
  }
}

// ---------------------------------------------------------------------------
// Output (RES-FR-01, RES-FR-02, RES-FR-08, RES-FR-11, CAL-FR-06)
// ---------------------------------------------------------------------------

/** One file in `Output/`: Kind and Channel as the user set them, its availability from the disk. */
export interface OutputRow {
  /** Path under `Output/`. */
  path: string
  file: DiskFile
  kind: OutputKind | null
  channel: string | null
  copiedFrom: string | null
  /** "writing" while a tool or a copy is still writing it ("Still being written"). */
  state: "writing" | "available"
  /** A mosaic panel's result: the folder under `Output/Panels/`; null in `Output/` itself (RES-FR-08). */
  panel: string | null
}

/** The Project's Results (RES-FR-01): every file under `Output/`, watched recursively. `online` is false while its volume is not mounted. */
export function outputRows(world: Pick<World, "disk" | "settings">, project: Project): { rows: OutputRow[]; online: boolean } {
  const paths = projectPaths(world, project)
  if (!paths) return { rows: [], online: true }
  const volumeId = volumeForPath(world.disk, paths.output)
  if (!volumeId || !world.disk.volumes[volumeId]?.mounted) return { rows: [], online: false }
  const rows = filesUnder(world.disk, paths.output)
    .map((file): OutputRow => {
      const path = file.path.slice(paths.output.length + 1)
      const meta: OutputMeta | undefined = project.output[path]
      const panel = path.startsWith(`${PANELS_FOLDER}/`) ? (path.split("/")[1] ?? null) : null
      return { path, file, kind: meta?.kind ?? null, channel: meta?.channel ?? null, copiedFrom: meta?.copiedFrom ?? null, state: file.growing ? "writing" : "available", panel }
    })
    .sort((a, b) => a.path.localeCompare(b.path))
  return { rows, online: true }
}

/** The files in the Project's `Processing/` folder: the tools' work, which a rerun may overwrite (PREP-FR-07). */
export function processingFiles(world: Pick<World, "disk" | "settings">, project: Project): DiskFile[] {
  const paths = projectPaths(world, project)
  return paths ? filesUnder(world.disk, paths.processing).sort((a, b) => a.path.localeCompare(b.path)) : []
}

/**
 * Why Copy to Output is refused (RES-FR-02): the Project is closed, the
 * source is not a readable, finished file in its `Processing/` folder, the
 * name is empty or leaves `Output/`, or a file already has that name (never
 * overwritten; the user chooses another). Null when it can go ahead.
 */
export function copyToOutputRefusal(world: Pick<World, "disk" | "settings">, project: Project, sourcePath: string, name: string): MessageRef | null {
  if (isLocked(project)) return msg("apply_refused_locked")
  const paths = projectPaths(world, project)
  if (!paths || !isUnder(sourcePath, paths.processing)) return msg("output_refused_not_processing")
  const source = readable(world, sourcePath)
  if (!source) return msg("output_refused_unreadable", { path: sourcePath })
  if (source.growing) return msg("output_refused_writing")
  const clean = name.trim()
  if (!clean || clean.startsWith("/") || clean.split("/").some((part) => part === ".." || part === "")) return msg("output_refused_name")
  if (fileAt(world.disk, `${paths.output}/${clean}`)) return msg("output_refused_exists", { name: clean })
  return null
}

/** A generated master in `Processing/`, offered once per file and digest on the Output step (CAL-FR-06, provisional). */
export interface ProcessingMaster {
  file: DiskFile
  kind: CalibrationKind
  offer: ProcessingMasterOffer | null
}

/**
 * Generated masters found in the Project's `Processing/` folder that are
 * still to offer: not hidden or adopted for that digest, not a version the
 * library already holds, and no longer being written.
 */
export function processingMasters(world: Pick<World, "catalog" | "disk" | "settings">, project: Project): ProcessingMaster[] {
  const held = new Set(Object.values(world.catalog.masters).flatMap((mst) => mst.versions.flatMap((v) => [v.sha256, v.adoption?.verifiedSha256 ?? ""])))
  return processingFiles(world, project).flatMap((file) => {
    const kind = masterKindOf(file)
    if (!kind || kind === "dark-flat" || file.growing || held.has(file.sha256)) return []
    const offer = project.masterOffers.find((o) => o.sha256 === file.sha256) ?? null
    if (offer && offer.state !== "offered") return []
    return [{ file, kind, offer }]
  })
}

// ---------------------------------------------------------------------------
// Project tabs and Next (PRJ-FR-07, PRJ-FR-18)
// ---------------------------------------------------------------------------

export type ProjectTabId = "sessions" | "calibrate" | "view" | "output" | "wrap-up"

export const PROJECT_TABS: ProjectTabId[] = ["sessions", "calibrate", "view", "output", "wrap-up"]

export const PROJECT_TAB_NAME: Record<ProjectTabId, MessageRef> = {
  sessions: msg("project_tab_sessions"),
  calibrate: msg("project_tab_calibrate"),
  view: msg("project_tab_view"),
  output: msg("project_tab_output"),
  "wrap-up": msg("wrapup_action"),
}

export interface ProjectTabs {
  status: ProjectState
  tabs: Array<{ id: ProjectTabId; label: MessageRef; count: number | null }>
  /** Pending changes: the View step's count (VSEL-FR-16). */
  pending: number
}

/** The Project page's tabs with their counts: sessions held, pending changes on View, Results in Output. */
export function projectTabs(world: World, project: Project): ProjectTabs {
  const pending = pendingChanges(world, project).length
  const counts: Record<ProjectTabId, number | null> = {
    sessions: project.inputs.length,
    calibrate: null,
    view: project.view ? pending : null,
    output: outputRows(world, project).rows.length,
    "wrap-up": null,
  }
  return { status: project.state, tabs: PROJECT_TABS.map((id) => ({ id, label: PROJECT_TAB_NAME[id], count: counts[id] })), pending }
}

/** A link to one of the Project's tabs. */
export function projectTabLink(projectId: ProjectId, tab: ProjectTabId): StepLink {
  return projectLink(projectId, { stage: tab })
}

/**
 * A Project's one Next action, the first rule that applies (PRJ-FR-18):
 * 1. sessions it matches have Unreviewed frames: "Review N new frames";
 * 2. it holds no session yet and suggestions can be added: "Add N sessions";
 * 3. Apply is waiting: the first Apply, or "Apply N changes", with the first refusal as its reason;
 * 4. every goal is met: "Wrap up";
 * 5. an unmet goal has a window tonight: "Plan tonight".
 * A Closed Project has no Next.
 */
export function projectNext(world: World, project: Project, nowMs: number): NextAction | null {
  const { catalog } = world
  if (isLocked(project)) return null
  const waiting = projectSessionsNeedingReview(catalog, project)
  const unreviewed = waiting.reduce((n, c) => n + sessionUnreviewedFrames(catalog, c.session), 0)
  if (unreviewed > 0) {
    const first = waiting.find((c) => sessionUnreviewedFrames(catalog, c.session) > 0)!
    return { label: msg("domain_next_review_new_frames", { count: unreviewed, n: formatCount(unreviewed) }), reason: msg("flow_reason_sessions_need_review"), link: sessionIntakeLink(first.session.id, "review") }
  }
  const addable = projectSuggestions(catalog, project).filter((s) => !s.blocked)
  if (project.inputs.length === 0) {
    return addable.length > 0 ? { label: msg("domain_next_add_sessions", { count: addable.length }), reason: msg("domain_reason_sessions_suggested"), link: projectTabLink(project.id, "sessions") } : null
  }
  const plan = applyPlan(world, project)
  const blocking = plan.refusals.find((r) => r.kind !== "nothing-to-apply")
  if (plan.first || plan.changes.length > 0) {
    return {
      label: plan.first ? msg("domain_next_apply_first") : msg("domain_next_apply_changes", { count: plan.changes.length }),
      reason: blocking ? applyRefusalRef(blocking) : plan.first ? msg("domain_reason_view_not_built") : msg("domain_reason_changes_pending"),
      link: projectTabLink(project.id, "view"),
    }
  }
  const progress = goalProgress(catalog, project)
  if (progress.length > 0 && progress.every((g) => g.met)) return { label: msg("wrapup_action"), reason: msg("domain_reason_goals_met"), link: projectTabLink(project.id, "wrap-up") }
  const site = planningSite(world)
  if (site) {
    for (const goal of progress.filter((g) => !g.met)) {
      const subject = findSubject(project, goal.goal.subjectId)
      const centre = subject ? subjectCentre(catalog, subject) : null
      const target = subject ? subjectTarget(catalog, subject) : undefined
      if (!subject || !centre || !target) continue
      if (bestWindowTonight({ ...target, ...centre }, site, defaultCriteria(site), nowMs)) {
        return { label: msg("target_plan_tonight"), reason: msg("domain_reason_window_tonight", { line: goal.line, subject: subjectRef(catalog, subject) }), link: { to: "/plan", search: { project: project.id } } }
      }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// Wrap up (PRJ-FR-14, PRJ-FR-15, C3, F2)
// ---------------------------------------------------------------------------

/** Where Wrap up's StepPage lives: the Project's Wrap up tab, one step at a time. */
export function wrapUpStepLink(projectId: ProjectId, step: WrapUpStepId): StepLink {
  return projectLink(projectId, { stage: "wrap-up", step })
}

/**
 * Whether Wrap up can open now (PRJ-FR-14). Provisional (lead, decision
 * record §2): it opens only while no change is pending and no other
 * PlateVault operation works on the Project. This is the one place the
 * rule lives; Wrap up's own steps' operations do not close it.
 */
export function wrapUpGate(world: Pick<World, "catalog" | "disk" | "operations">, project: Project): FlowGate | null {
  if (isLocked(project)) return null
  const own = new Set(Object.values(project.wrapUp).flatMap((r) => r?.operationIds ?? []))
  const busy = Object.values(world.operations).find((op) => op.scope.projectId === project.id && PROJECT_OPERATION_KINDS.has(op.kind) && unsettled(op) && !own.has(op.id))
  if (busy) return runningGate([busy])
  const pending = pendingChanges(world, project).length
  if (pending > 0) return { reason: msg("flow_wrapup_pending", { count: pending }), blockers: [{ label: msg("flow_wrapup_apply_or_discard"), link: projectTabLink(project.id, "view") }] }
  return null
}

/** A step record's state from its operations (F2): Finished only once every one succeeded. */
export type WrapUpRecordState = "todo" | "running" | "finished" | "skipped" | "redo"

export function wrapUpRecordState(operations: Record<string, Operation>, record: WrapUpStepRecord | undefined): { state: WrapUpRecordState; failed: Operation | null; running: Operation[] } {
  if (!record) return { state: "todo", failed: null, running: [] }
  if (record.redo) return { state: "redo", failed: null, running: [] }
  if (record.state === "skipped") return { state: "skipped", failed: null, running: [] }
  const ops = record.operationIds.map((id) => operations[id]).filter((op): op is Operation => op !== undefined)
  const running = ops.filter(unsettled)
  if (running.length > 0) return { state: "running", failed: null, running }
  const failed = ops.find((op) => op.status !== "succeeded") ?? null
  return { state: failed ? "todo" : "finished", failed, running: [] }
}

export interface WrapUpFlowState {
  /** Wrap up can be worked on: the Project is open and `wrapUpGate` lets it. */
  available: boolean
  /** Why it is not available yet; null when it is, or the Project is closed. */
  unavailable: FlowGate | null
  steps: Array<DerivedStep<WrapUpStepId>>
  /** The first step not finished or skipped, in the strict order (C3); Archive once the Project is closed. */
  current: WrapUpStepId
  /** Close project succeeded: the Project is locked (PRJ-FR-25). */
  closed: boolean
  /** The Close project archive transfer while it runs ("Closing"). */
  closing: Operation[]
}

/**
 * Wrap up: Clean up → Trash → Archive, strictly in that order (C3), each
 * optional. A later step is read-only until the earlier ones are finished
 * or skipped; an earlier one reopens until Close, and the steps after it
 * read Redo. A step finishes when its operations succeed, not when they
 * start (F2). Archive's last action is Close project: the Project closes
 * now with no archive, or when its archive transfer succeeds.
 */
export function wrapUpFlowState(world: World, project: Project): WrapUpFlowState {
  const closed = isLocked(project)
  const gate = closed ? null : wrapUpGate(world, project)
  const records = WRAP_UP_STEPS.map((id) => ({ id, record: project.wrapUp[id], ...wrapUpRecordState(world.operations, project.wrapUp[id]) }))
  const settled = (s: WrapUpRecordState) => s === "finished" || s === "skipped"
  const firstOpen = records.find((r) => !settled(r.state))
  const current: WrapUpStepId = closed || !firstOpen ? "archive" : firstOpen.id
  const position = WRAP_UP_STEPS.indexOf(current)
  const steps = records.map(({ id, record, state, failed, running }, index): DerivedStep<WrapUpStepId> => {
    const summary = state === "finished" && record ? finishedOn(record.at) : state === "skipped" ? msg("status_skipped") : state === "running" ? msg("status_running") : (failed?.summary ?? null)
    if ((closed || index < position) && settled(state)) return { id, state, gate: null, summary }
    if (index > position) return { id, state: record ? "redo" : "todo", gate: null, summary }
    const stepGate = closed ? null : (gate ?? runningGate(running))
    return { id, state: settled(state) ? state : openStepState(true, stepGate, false), gate: stepGate, summary }
  })
  const archive = records.find((r) => r.id === "archive")!
  return { available: !closed && gate === null, unavailable: gate, steps, current, closed, closing: closed ? [] : archive.running }
}

export interface WrapUpStep {
  id: WrapUpStepId
  label: MessageRef
  state: "todo" | "done" | "skipped"
  at: IsoDateTime | null
}

/** The Project's Wrap up as lists and Home read it. */
export interface ProjectWrapUp {
  available: boolean
  steps: WrapUpStep[]
  /** The first step still to do; null once the Project is closed. */
  current: WrapUpStepId | null
}

export function wrapUpSummary(world: World, project: Project): ProjectWrapUp {
  const flow = wrapUpFlowState(world, project)
  return {
    available: flow.available,
    steps: flow.steps.map((step) => ({ id: step.id, label: WRAP_UP_NAME[step.id], state: step.state === "finished" ? "done" : step.state === "skipped" ? "skipped" : "todo", at: project.wrapUp[step.id]?.at ?? null })),
    current: flow.closed ? null : flow.current,
  }
}

// --- Wrap up offers ---------------------------------------------------------

type OfferWorld = Pick<World, "catalog" | "disk" | "operations" | "settings">

/** The live frames of the sessions the Project holds. */
function heldAssetIds(catalog: Catalog, project: Project): AssetId[] {
  return project.inputs.flatMap((input) => {
    const session = catalog.sessions[input.sessionId]
    return session ? liveAssetIds(catalog, session) : []
  })
}

/**
 * Clean up (PRJ-FR-14, F1): the View's entries, its copies ticked and its
 * symlinks left unticked (kept), and what `View (previous)/` still holds,
 * ticked (provisional). Output is never offered.
 */
export function viewCleanupOffer(world: OfferWorld, project: Project): TrashOffer {
  const { disk, catalog } = world
  const links = viewLinks(catalog, disk)
  const entries: OfferEntry[] = []
  const refusals: OfferRefusal[] = []
  const items: TrashItem[] = []
  const files = [...(project.view ? filesUnder(disk, project.view.folderPath) : []), ...(project.previous ? filesUnder(disk, project.previous.folderPath) : [])]
  for (const file of files) {
    const label = file.path.slice(file.path.lastIndexOf("/") + 1)
    const reason = trashRefusal(disk, file.path)
    if (reason) {
      refusals.push({ key: file.path, label, path: file.path, reason })
      continue
    }
    const previous = project.previous ? isUnder(file.path, project.previous.folderPath) : false
    entries.push({ key: file.path, label, path: file.path, detail: previous ? m.wrapup_cleanup_previous() : file.linkTarget ? m.wrapup_cleanup_link() : m.wrapup_cleanup_copy(), sizeBytes: file.linkTarget ? 0 : file.sizeBytes, preselected: previous || !file.linkTarget })
    items.push({ path: file.path })
  }
  return trashOffer("view-cleanup", disk, links, entries, refusals, items)
}

/** Wrap up's rejected-frames offer: the library-Unusable frames of the sessions the Project holds. */
export function rejectedFramesOffer(world: OfferWorld, project: Project): TrashOffer {
  return unusableFramesOffer(world, heldAssetIds(world.catalog, project))
}

/** "Move N Processing files to Trash" (PRJ-FR-15): the tools' files in `Processing/`, each selectable; Output is never offered. */
export function processingFilesOffer(world: OfferWorld, project: Project): TrashOffer {
  const { disk, catalog } = world
  const links = viewLinks(catalog, disk)
  const entries: OfferEntry[] = []
  const refusals: OfferRefusal[] = []
  const items: TrashItem[] = []
  const paths = projectPaths(world, project)
  for (const file of processingFiles(world, project)) {
    const label = file.path.slice(file.path.lastIndexOf("/") + 1)
    const block = trashBlock(disk, links, file.path)
    if (block) {
      refusals.push({ key: file.path, label, path: file.path, ...block })
      continue
    }
    entries.push({ key: file.path, label, path: file.path, detail: paths ? file.path.slice(paths.processing.length + 1) : null, sizeBytes: file.linkTarget ? 0 : file.sizeBytes, preselected: true })
    items.push({ path: file.path })
  }
  return trashOffer("processing-files", disk, links, entries, refusals, items)
}

/**
 * "Move N duplicate copies to Trash" (D-W74, D-W116): byte-identical extra
 * copies of the Project's frames. Each frame keeps one copy (`keptCopy`); its
 * record, quality and Project inputs stay.
 */
export function duplicatesOffer(world: OfferWorld, project: Project): TrashOffer {
  const { catalog, disk } = world
  const moving = sessionsInTransfer(world.operations)
  const links = viewLinks(catalog, disk)
  const entries: OfferEntry[] = []
  const refusals: OfferRefusal[] = []
  const items: TrashItem[] = []
  for (const id of heldAssetIds(catalog, project)) {
    const asset = catalog.assets[id]
    if (!asset || asset.copies.length < 2) continue
    const kept = keptCopy(catalog, disk, asset)
    if (!kept) continue
    const keptName = catalog.locations[kept.locationId]?.displayName ?? kept.path
    for (const copy of asset.copies) {
      if (copy === kept || copy.sha256 !== asset.sha256) continue
      const key = `${id}|${copy.path}`
      const label = m.wrapup_copy_on({ name: asset.fileName, location: catalog.locations[copy.locationId]?.displayName ?? m.wrapup_unknown_location() })
      const block: TrashBlock | null =
        asset.sessionId && moving.has(asset.sessionId) ? { reason: msg("wrapup_refusal_archive_moving") } : trashRefusal(disk, kept.path) ? { reason: msg("wrapup_refusal_kept_copy_unverified", { name: keptName }) } : trashBlock(disk, links, copy.path)
      if (block) {
        refusals.push({ key, label, path: copy.path, ...block })
        continue
      }
      entries.push({ key, label, path: copy.path, detail: m.wrapup_keeps_copy_on({ name: keptName, path: kept.path }), sizeBytes: asset.sizeBytes, preselected: true })
      items.push({ path: copy.path, assetId: id })
    }
  }
  return trashOffer("duplicate-copies", disk, links, entries, refusals, items)
}

/** The Trash step's offers, in the order Wrap up lists them. */
export const TRASH_OFFER_KINDS = ["rejected-frames", "processing-files", "duplicate-copies"] as const

export type TrashOfferKind = (typeof TRASH_OFFER_KINDS)[number]

export function trashOffers(world: OfferWorld, project: Project): Record<TrashOfferKind, TrashOffer> {
  return { "rejected-frames": rejectedFramesOffer(world, project), "processing-files": processingFilesOffer(world, project), "duplicate-copies": duplicatesOffer(world, project) }
}

/** The paths one offered entry hands to the OS Trash: every copy of a frame (they move together), or the one file. */
export function entryItems(offer: TrashOffer, entry: OfferEntry): TrashItem[] {
  return offer.items.filter((item) => (item.assetId !== undefined && item.assetId === entry.key) || item.path === entry.path)
}

// ---------------------------------------------------------------------------
// Issues a Project row carries (F7, D-W92)
// ---------------------------------------------------------------------------

/** Join refs for a short list: "Ha · 18 Sep, OIII · 24 Sep". */
export function sessionsRef(catalog: Catalog, sessionIds: SessionId[]): MessageRef {
  return joinRefs(sessionIds.map((id) => sessionLabel(catalog, id)), ", ")
}
