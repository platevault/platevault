/**
 * Settings writes shared by every screen (foundation-owned): goal templates
 * (D-W30, D-W47), naming templates and the tokens they omit (D-W20,
 * STO-IMP-FR-07), application profiles (PREP-FR-01, PREP-FR-02), the default
 * View mode, the GROUP and PANEL keywords and the matching thresholds
 * (PREP-FR-04, PRJ-FR-28, D-W114), and the dated rig versions and camera
 * calibration facts that matching reads (PLAN-EQ-FR-07, LIB-FR-26,
 * CAL-FR-22). The Equipment records themselves (cameras, telescopes,
 * reducers, filters, rigs) write through Settings › Equipment's own actions
 * (`e-targets-plan-settings/settings-actions.ts`). Failed writes stay unsaved
 * with Retry; the last saved value stays in effect.
 */
import { calibrateSessions } from "@/domain/calibration"
import { currentRigVersion, sessionRigVersion } from "@/domain/indexing"
import { FRAMING_LIMIT_RANGE, GROUP_KEYWORD, GROUP_KEYWORD_KINDS, MODE_NAME } from "@/domain/labels"
import { PROFILE_IDS } from "@/domain/seed"
import { clampMoonAvoidance, type MoonAvoidance } from "@/domain/planning"
import { NAMING_TOKENS, validateNamingTemplate } from "@/domain/templates"
import type {
  ApplicationProfile,
  Band,
  Camera,
  CameraId,
  Catalog,
  GoalTemplate,
  GoalTemplateId,
  GroupKeywordKind,
  GroupKeywords,
  InputMode,
  IsoDateTime,
  LocationId,
  MatchingSettings,
  NamingFrameType,
  NamingToken,
  NightDate,
  OpticalTrainId,
  ProfileId,
  RigVersion,
  SimulatedApp,
} from "@/domain/types"
import { joinRefs, type MessageRef, msg, nightRef, verbatim } from "@/lib/i18n"
import { type CommitResult, commit, nowIso, type PrototypeState, store, withCatalog } from "@/store/core"
import { freshId, MISSING, recordSaved, refuse } from "./shared"

// ---------------------------------------------------------------------------
// Archive locations (P-ARC1) and the Moon rule (planning)
// ---------------------------------------------------------------------------

/** Make an archive location the Default; a Project may still pick another (`setProjectArchiveLocation`). */
export function setDefaultArchiveLocation(locationId: LocationId): CommitResult {
  const location = store.getState().catalog.locations[locationId]
  const href = "/settings/locations"
  if (!location) return MISSING
  if (location.role !== "archive" || location.retiredAt) return refuse(msg("store_refused", { label: msg("settings_make_default") }), [msg("store_reason_not_archive_location")], href)
  const result = commit(msg("store_label_default_archive_location"), (s) => ({ ...s, settings: { ...s.settings, defaultArchiveLocationId: locationId } }), { href })
  if (result.ok) recordSaved(msg("store_saved_default_archive", { name: location.displayName }), null, href)
  return result
}

/** One filter's Moon-avoidance curve (C6): the patch is merged and clamped to `MOON_AVOIDANCE_LIMITS`, so the width never reaches zero. */
export function setMoonAvoidance(band: Band, patch: Partial<MoonAvoidance>): CommitResult {
  return commit(msg("targets_moon_limits_for", { band }), (s) => {
    const next = clampMoonAvoidance({ ...s.settings.moonAvoidance[band], ...patch })
    return { ...s, settings: { ...s.settings, moonAvoidance: { ...s.settings.moonAvoidance, [band]: next } } }
  }, { href: "/plan" })
}

// ---------------------------------------------------------------------------
// Goal templates
// ---------------------------------------------------------------------------

/**
 * Create or update a user template; built-ins cannot be edited or deleted (PRJ-FR-12).
 * An update without `conditions` keeps the ones the template holds (C7), so an editor that only shows the values loses none.
 */
export function saveGoalTemplate(template: Omit<GoalTemplate, "id" | "source"> & { id: GoalTemplateId | null }): { result: CommitResult; id: GoalTemplateId } {
  const id = template.id ?? freshId("gtpl", template.name)
  const conditions = template.conditions ?? (template.id ? store.getState().catalog.goalTemplates[template.id]?.conditions : undefined)
  const record: GoalTemplate = { ...template, id, source: "user", ...(conditions ? { conditions } : {}) }
  const href = "/settings/goal-templates"
  const result = commit(msg("store_label_goal_template", { name: record.name }), (s) => withCatalog(s, (c) => ({ ...c, goalTemplates: { ...c.goalTemplates, [id]: record } })), { href })
  if (result.ok) recordSaved(msg("store_saved_goal_template", { name: record.name }), null, href)
  return { result, id }
}

export function deleteGoalTemplate(id: GoalTemplateId): CommitResult {
  const template = store.getState().catalog.goalTemplates[id]
  if (!template) return MISSING
  const href = "/settings/goal-templates"
  const result = commit(msg("template_delete_change", { name: template.name }), (s) =>
    withCatalog(s, (c) => {
      const { [id]: _removed, ...goalTemplates } = c.goalTemplates
      return { ...c, goalTemplates }
    }),
    { href },
  )
  if (result.ok) recordSaved(msg("store_saved_goal_template_deleted", { name: template.name }), msg("store_goal_template_deleted_detail"), href)
  return result
}

// ---------------------------------------------------------------------------
// Naming templates
// ---------------------------------------------------------------------------

/** Save one type's template, or null to restore its default. Invalid templates are refused inline (STO-IMP-AC-08). */
export function setNamingTemplate(type: NamingFrameType, template: string | null): CommitResult {
  const href = "/settings/naming"
  if (template !== null) {
    const errors = validateNamingTemplate(template)
    if (errors.length > 0) return refuse(msg("store_refused", { label: msg("store_label_naming_template", { type }) }), errors, href)
  }
  const result = commit(msg("store_label_naming_template", { type }), (s) => {
    const naming = { ...s.settings.naming }
    if (template === null) delete naming[type]
    else naming[type] = template
    return { ...s, settings: { ...s.settings, naming } }
  }, { href })
  if (result.ok) recordSaved(template === null ? msg("store_saved_naming_default", { type }) : msg("store_saved_naming_template", { type }), template === null ? null : verbatim(template), href)
  return result
}

/** The tokens every template leaves out when their value is missing (wmbp9), in token order; the rest write their fallback. */
export function setNamingOmit(tokens: readonly NamingToken[]): CommitResult {
  const namingOmit = NAMING_TOKENS.map((t) => t.token).filter((token) => tokens.includes(token))
  const href = "/settings/naming"
  const result = commit(msg("store_label_naming_omit"), (s) => ({ ...s, settings: { ...s.settings, namingOmit } }), { href })
  if (result.ok) recordSaved(msg("store_saved_naming_omit"), namingOmit.length > 0 ? verbatim(namingOmit.map((token) => `{${token}}`).join(" ")) : null, href)
  return result
}

// ---------------------------------------------------------------------------
// Application profiles and the simulated computer
// ---------------------------------------------------------------------------

function patchProfile(profileId: ProfileId, label: MessageRef, patch: Partial<ApplicationProfile>): CommitResult {
  if (!store.getState().catalog.profiles[profileId]) return MISSING
  return commit(label, (s) => withCatalog(s, (c) => ({ ...c, profiles: { ...c.profiles, [profileId]: { ...c.profiles[profileId]!, ...patch } } })), { href: "/settings/applications" })
}

/** Executable state as PlateVault observes it on the simulated computer. */
export function observeExecutable(path: string | null): "not-configured" | "found" | "missing" {
  if (!path) return "not-configured"
  return store.getState().disk.apps.some((app) => app.present && app.path === path) ? "found" : "missing"
}

export function locateExecutable(profileId: ProfileId, path: string): CommitResult {
  const profile = store.getState().catalog.profiles[profileId]
  return patchProfile(profileId, profile ? msg("settings_locate_named", { name: profile.name }) : msg("store_label_locate_application"), { executablePath: path, executableState: observeExecutable(path) })
}

export function checkExecutable(profileId: ProfileId): CommitResult {
  const profile = store.getState().catalog.profiles[profileId]
  if (!profile) return MISSING
  return patchProfile(profileId, msg("store_label_check_named", { name: profile.name }), { executableState: observeExecutable(profile.executablePath) })
}

export function setLaunchArgs(profileId: ProfileId, launchArgs: string): CommitResult {
  return patchProfile(profileId, msg("apps_launch_arguments"), { launchArgs })
}

const APPS_HREF = "/settings/applications"
const BUILT_IN_PROFILES: ReadonlySet<ProfileId> = new Set(Object.values(PROFILE_IDS))

/** The profile a new one is input for: its name, its executable and its launch arguments. */
export interface NewProfile {
  name: string
  executablePath: string | null
  launchArgs: string
}

/**
 * Why another profile already covers this one, per field: its name, compared
 * without case, or its executable started with the same launch arguments.
 * Empty when no profile does.
 */
export function profileDuplicates(profiles: Catalog["profiles"], input: NewProfile): { name?: MessageRef; executable?: MessageRef } {
  const name = input.name.trim()
  const launchArgs = input.launchArgs.trim()
  const others = Object.values(profiles)
  const sameName = name ? others.find((p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase()) : undefined
  const sameLaunch = input.executablePath ? others.find((p) => p.executablePath === input.executablePath && p.launchArgs.trim() === launchArgs) : undefined
  return {
    ...(sameName ? { name: msg("apps_refused_name_taken", { name: sameName.name }) } : {}),
    ...(sameLaunch ? { executable: msg("apps_refused_launch_taken", { name: sameLaunch.name }) } : {}),
  }
}

/**
 * A generic launcher profile the user adds: unverified, its executable
 * observed on the simulated computer now. Refused while another profile has
 * its name or its executable and launch arguments (`profileDuplicates`); the
 * id is then one no profile has.
 */
export function addApplicationProfile(input: NewProfile): { result: CommitResult; id: ProfileId } {
  const name = input.name.trim()
  const id = freshId("prof", name)
  const label = msg("store_label_add_named", { name })
  const duplicates = profileDuplicates(store.getState().catalog.profiles, input)
  const reasons = [duplicates.name, duplicates.executable].filter((reason): reason is MessageRef => reason !== undefined)
  if (reasons.length > 0) return { result: refuse(msg("store_refused", { label }), reasons, APPS_HREF), id }
  const profile: ApplicationProfile = {
    id,
    application: "generic",
    name,
    executablePath: input.executablePath,
    executableState: observeExecutable(input.executablePath),
    launchArgs: input.launchArgs,
    capability: { verified: false, evidence: msg("seed_apps_evidence_generic"), inputWrite: "unknown", correctedMetadata: "none", masterStacking: false },
  }
  const result = commit(label, (s) => withCatalog(s, (c) => ({ ...c, profiles: { ...c.profiles, [id]: profile } })), { href: APPS_HREF })
  if (result.ok) recordSaved(msg("store_saved_added", { name }), null, APPS_HREF)
  return { result, id }
}

/**
 * Remove a profile the user added. Built-in profiles stay, and so does a
 * profile any Project hands its View to (its View settings or its applied
 * View), so no Project loses the application it records.
 */
export function removeApplicationProfile(id: ProfileId): CommitResult {
  const { catalog } = store.getState()
  const profile = catalog.profiles[id]
  if (!profile) return MISSING
  const label = msg("project_remove_named", { name: profile.name })
  if (BUILT_IN_PROFILES.has(id)) return refuse(msg("store_refused", { label }), [msg("status_built_in")], APPS_HREF)
  const projects = Object.values(catalog.projects).filter((p) => p.settings.profileId === id || p.view?.settings.profileId === id)
  if (projects.length > 0) {
    const usedBy = joinRefs([msg("equipment_used_by_projects", { count: projects.length }), joinRefs(projects.map((p) => verbatim(p.name)), ", ")], " · ")
    return refuse(msg("store_refused", { label }), [usedBy], APPS_HREF)
  }
  const result = commit(label, (s) =>
    withCatalog(s, (c) => {
      const { [id]: _removed, ...profiles } = c.profiles
      return { ...c, profiles }
    }),
    { href: APPS_HREF },
  )
  if (result.ok) recordSaved(msg("store_saved_removed", { name: profile.name }), null, APPS_HREF)
  return result
}

/** Prototype control: move an application bundle away or arm a launch failure. Never writes the catalog. */
export function updateApp(id: string, patch: Partial<SimulatedApp>) {
  store.setState((s) => ({ ...s, disk: { ...s.disk, apps: s.disk.apps.map((app) => (app.id === id ? { ...app, ...patch } : app)) } }))
}

// ---------------------------------------------------------------------------
// Project defaults and keywords (PREP-FR-04, PRJ-FR-28, P-PREP3)
// ---------------------------------------------------------------------------

/** The View mode a new Project starts with (PREP-FR-04); an existing Project keeps its own. */
export function setDefaultInputMode(mode: InputMode): CommitResult {
  const result = commit(msg("settings_default_input_mode"), (s) => ({ ...s, settings: { ...s.settings, defaultInputMode: mode } }), { href: APPS_HREF })
  if (result.ok) recordSaved(msg("settings_default_input_mode"), MODE_NAME[mode], APPS_HREF)
  return result
}

/** The folder keywords the View already uses beside the grouping keywords: a grouping keyword may not take one of them. */
const VIEW_KEYWORDS = ["NIGHT", "GAIN", "OFFSET"]

/**
 * A letter, then letters, digits or hyphens: what WBPP's keyword list takes.
 * Its keyword field strips every other character (`[^a-z0-9-]`, so `_` too)
 * and matches the name in a path literally, case-insensitively, before a
 * `_`, `-` or space (PJSR 76e4f38c, BPP-GUI.js L420-L425, BPP-Helper.js
 * L1109-L1130).
 */
const KEYWORD_NAME = /^[A-Za-z][A-Za-z0-9-]*$/

/** True when `inner` is `outer` or a run of its hyphen-separated parts, so WBPP's match for `inner` also lands in `outer`'s folders (`[^a-zA-Z0-9]` before the name, `-` after it). */
function readsInside(outer: string, inner: string): boolean {
  return `-${outer.toUpperCase()}-`.includes(`-${inner.toUpperCase()}-`)
}

/**
 * Why the name `kind` takes cannot name View folders beside the other
 * grouping keywords (PRJ-FR-28): it is a letter then letters, digits or
 * hyphens, with no `_` (WBPP cannot hold one, and `_` ends a value); no other
 * grouping keyword has it; it is not a keyword the View already uses
 * (NIGHT, GAIN, OFFSET); and neither it nor another keyword reads inside
 * the other at a hyphen. Empty when it can.
 */
export function keywordRefusalsFor(keywords: GroupKeywords, kind: GroupKeywordKind): MessageRef[] {
  const name = keywords[kind]
  if (name.includes("_")) return [msg("settings_keyword_underscore", { name })]
  if (!KEYWORD_NAME.test(name)) return [msg("settings_keyword_invalid", { name: name || "–" })]
  if (VIEW_KEYWORDS.includes(name.toUpperCase())) return [msg("settings_keyword_reserved", { name })]
  const reasons: MessageRef[] = []
  for (const other of GROUP_KEYWORD_KINDS) {
    if (other === kind) continue
    if (keywords[other].toUpperCase() === name.toUpperCase()) reasons.push(msg("settings_keyword_same", { name, kind: GROUP_KEYWORD[other].label }))
  }
  const others = [...GROUP_KEYWORD_KINDS.filter((other) => other !== kind && keywords[other].toUpperCase() !== name.toUpperCase()).map((other) => keywords[other]), ...VIEW_KEYWORDS]
  for (const other of others) {
    if (readsInside(name, other)) reasons.push(msg("settings_keyword_overlap", { inner: other, outer: name }))
    else if (readsInside(other, name)) reasons.push(msg("settings_keyword_overlap", { inner: name, outer: other }))
  }
  return reasons
}

/** Why these grouping keyword names cannot name View folders: each kind's reasons (`keywordRefusalsFor`), in Settings' order. Empty when they can. */
export function keywordRefusals(keywords: GroupKeywords): MessageRef[] {
  return GROUP_KEYWORD_KINDS.flatMap((kind) => keywordRefusalsFor(keywords, kind))
}

const NAMING_HREF = "/settings/naming"

/** One grouping keyword name every Project uses unless it sets its own (PRJ-FR-28), trimmed; refused while it cannot name View folders beside the others. A change reaches each View on its next Apply. */
export function setGroupKeyword(kind: GroupKeywordKind, name: string): CommitResult {
  const next = { ...store.getState().settings.keywords, [kind]: name.trim() }
  const label = msg("settings_label_group_keywords")
  const reasons = keywordRefusalsFor(next, kind)
  if (reasons.length > 0) return refuse(msg("store_refused", { label: GROUP_KEYWORD[kind].label }), reasons, NAMING_HREF)
  const result = commit(label, (s) => ({ ...s, settings: { ...s.settings, keywords: next } }), { href: NAMING_HREF })
  if (result.ok) recordSaved(label, msg("store_saved_label_name", { label: GROUP_KEYWORD[kind].label, name: verbatim(next[kind]) }), NAMING_HREF)
  return result
}

/** The GROUP and PANEL keyword names every Project uses unless it sets its own (PRJ-FR-28); a change reaches each View on its next Apply. */
export function setGroupKeywords(keywords: GroupKeywords): CommitResult {
  const next = { group: keywords.group.trim(), panel: keywords.panel.trim() }
  const label = msg("settings_label_group_keywords")
  const reasons = keywordRefusals(next)
  if (reasons.length > 0) return refuse(msg("store_refused", { label }), reasons, APPS_HREF)
  const result = commit(label, (s) => ({ ...s, settings: { ...s.settings, keywords: next } }), { href: APPS_HREF })
  if (result.ok) recordSaved(label, verbatim(`${next.group} · ${next.panel}`), APPS_HREF)
  return result
}

// ---------------------------------------------------------------------------
// Matching (D-W114, PRJ-FR-31, CAL-FR-19 to CAL-FR-21)
// ---------------------------------------------------------------------------

const EQUIPMENT_HREF = "/settings/equipment"
const MATCHING_HREF = "/settings/matching"

export type MatchingPatch = { [K in keyof MatchingSettings]?: Partial<MatchingSettings[K]> }

/** A threshold in its range; a value that is not a number keeps the current one. */
function clamp(value: number | undefined, current: number, min: number, max: number, whole = false): number {
  if (value === undefined || !Number.isFinite(value)) return current
  const bounded = Math.min(max, Math.max(min, value))
  return whole ? Math.round(bounded) : bounded
}

/** The thresholds with `patch` merged in and each clamped to its range: percentages 0-100, the split limits to `FRAMING_LIMIT_RANGE`, other angles 0-90°, windows whole nights or days. */
function mergedMatching(current: MatchingSettings, patch: MatchingPatch): MatchingSettings {
  const { framing, flats, darks, bias } = current
  const f = patch.framing ?? {}
  const fl = patch.flats ?? {}
  const dk = patch.darks ?? {}
  const bs = patch.bias ?? {}
  return {
    framing: {
      overlapPct: clamp(f.overlapPct, framing.overlapPct, 0, 100),
      centreArcmin: clamp(f.centreArcmin, framing.centreArcmin, FRAMING_LIMIT_RANGE.centreArcmin.min, FRAMING_LIMIT_RANGE.centreArcmin.max),
      rotationDeg: clamp(f.rotationDeg, framing.rotationDeg, FRAMING_LIMIT_RANGE.rotationDeg.min, FRAMING_LIMIT_RANGE.rotationDeg.max),
      panelOverlapMinPct: clamp(f.panelOverlapMinPct, framing.panelOverlapMinPct, 0, 100),
      panelOverlapMaxPct: clamp(f.panelOverlapMaxPct, framing.panelOverlapMaxPct, 0, 100),
    },
    flats: { fineDeg: clamp(fl.fineDeg, flats.fineDeg, 0, 90), warnDeg: clamp(fl.warnDeg, flats.warnDeg, 0, 90), windowNights: clamp(fl.windowNights, flats.windowNights, 0, 365, true) },
    darks: { windowDays: clamp(dk.windowDays, darks.windowDays, 0, 3650, true), temperatureWarnC: clamp(dk.temperatureWarnC, darks.temperatureWarnC, 0, 50) },
    bias: { windowDays: clamp(bs.windowDays, bias.windowDays, 0, 3650, true), temperatureWarnC: clamp(bs.temperatureWarnC, bias.temperatureWarnC, 0, 50) },
  }
}

/**
 * The framing and calibration matching thresholds (D-W114). Framing applies
 * to later intake splits, import review's defaults and group placement; no
 * existing session is re-split; the calibration thresholds
 * match every kind still waiting or suggested now, as ingestion would, while
 * pins and Nos never change (CAL-FR-02). Refused when a lower bound passes
 * its upper one (panel overlap, the flats' fine and warning rotation).
 */
export function setMatchingSettings(patch: MatchingPatch): CommitResult {
  const label = msg("settings_label_matching")
  const next = mergedMatching(store.getState().settings.matching, patch)
  const reasons: MessageRef[] = []
  if (next.framing.panelOverlapMinPct > next.framing.panelOverlapMaxPct) reasons.push(msg("settings_matching_panel_overlap_order"))
  if (next.flats.fineDeg > next.flats.warnDeg) reasons.push(msg("settings_matching_flat_rotation_order"))
  if (reasons.length > 0) return refuse(msg("store_refused", { label }), reasons, MATCHING_HREF)
  const at = nowIso()
  const result = commit(
    label,
    (s) => {
      const settings = { ...s.settings, matching: next }
      return { ...s, settings, catalog: calibrateSessions(s.catalog, s.disk, settings, at) }
    },
    { href: MATCHING_HREF },
  )
  if (result.ok) recordSaved(label, null, MATCHING_HREF)
  return result
}

// ---------------------------------------------------------------------------
// Rig versions and camera calibration facts (PLAN-EQ-FR-07, LIB-FR-26, CAL-FR-22)
// ---------------------------------------------------------------------------

/** The optics a rig version records. */
export type RigOptics = Omit<RigVersion, "id" | "from">

function sameOptics(a: RigOptics, b: RigOptics): boolean {
  return (
    a.cameraId === b.cameraId &&
    a.telescopeId === b.telescopeId &&
    a.reducerId === b.reducerId &&
    a.effectiveFocalLengthMm === b.effectiveFocalLengthMm &&
    a.rotator === b.rotator &&
    a.filterIds.length === b.filterIds.length &&
    a.filterIds.every((id) => b.filterIds.includes(id))
  )
}

/**
 * Edit a rig's optics from a night on (PLAN-EQ-FR-07): the current version
 * is frozen into the history and the new one applies from `from`. Each
 * session keeps the version it recorded (LIB-FR-26), so nothing earlier is
 * remapped and no flat pin changes; a session settling its rig later takes
 * the version in effect on its night. Refused unless `from` falls after the
 * current version's first night; optics equal to the current ones write
 * nothing.
 */
export function addRigVersion(rigId: OpticalTrainId, from: NightDate, optics: RigOptics): CommitResult {
  const rig = store.getState().catalog.opticalTrains[rigId]
  if (!rig) return MISSING
  const href = `${EQUIPMENT_HREF}?rig=${rigId}`
  const label = msg("settings_label_rig_version", { name: rig.name })
  if (sameOptics(currentRigVersion(rig), optics)) return { ok: true }
  if (from <= rig.versionFrom) return refuse(msg("store_refused", { label }), [msg("settings_rig_version_after", { night: nightRef(rig.versionFrom) })], href)
  const versionId = freshId("rv", `${rigId}|${from}`)
  const result = commit(
    label,
    (s) =>
      withCatalog(s, (c) => {
        const current = c.opticalTrains[rigId]!
        const next = { ...current, ...optics, versionId, versionFrom: from, history: [...current.history, currentRigVersion(current)] }
        return { ...c, opticalTrains: { ...c.opticalTrains, [rigId]: next } }
      }),
    { href },
  )
  if (result.ok) recordSaved(msg("settings_saved_rig_version", { name: rig.name, night: nightRef(from) }), null, href)
  return result
}

/**
 * Why `alias` cannot name the camera `cameraId` (or a new camera, under an id
 * not in the catalog) whose model is `model` (LIB-FR-26, PLAN-EQ-FR-08): another
 * camera already uses it, or it is empty while another camera has this
 * model. Null when it can. `setCameraAlias`, `saveCamera` and the camera
 * dialog all apply this one rule.
 */
export function cameraAliasRefusal(catalog: Catalog, cameraId: CameraId, model: string, alias: string | null): MessageRef | null {
  const next = alias?.trim() || null
  const others = Object.values(catalog.cameras).filter((c) => c.id !== cameraId)
  const taken = next ? others.find((c) => c.physicalAlias?.toLowerCase() === next.toLowerCase()) : undefined
  if (taken) return msg("settings_camera_alias_taken", { alias: next!, name: taken.name })
  if (!next && others.some((c) => c.name.toLowerCase() === model.toLowerCase())) return msg("settings_camera_alias_needed", { name: model })
  return null
}

/**
 * Name one physical camera (LIB-FR-26): darks and bias link to it by this
 * alias once the rigs hold two cameras of its model. Unique across cameras;
 * null clears it, refused while another camera shares its model.
 */
export function setCameraAlias(cameraId: CameraId, alias: string | null): CommitResult {
  const { catalog } = store.getState()
  const camera = catalog.cameras[cameraId]
  if (!camera) return MISSING
  const href = EQUIPMENT_HREF
  const label = msg("settings_label_camera_alias", { name: camera.name })
  const next = alias?.trim() || null
  const refusal = cameraAliasRefusal(catalog, cameraId, camera.name, next)
  if (refusal) return refuse(msg("store_refused", { label }), [refusal], href)
  const result = commit(label, (s) => withCatalog(s, (c) => ({ ...c, cameras: { ...c.cameras, [cameraId]: { ...c.cameras[cameraId]!, physicalAlias: next } } })), { href })
  if (result.ok) recordSaved(msg("equipment_saved_named", { name: camera.name }), next ? verbatim(next) : null, href)
  return result
}

/**
 * The catalog after a camera's "Don't use darks" / "Don't use bias" changed
 * (CAL-FR-22): a No the camera default set goes back to waiting once the
 * default is off, and matching then settles every kind still waiting or
 * suggested, as No by the default where it is on. Pins and the user's own
 * Nos stay.
 */
function withCameraDefaults(state: PrototypeState, catalog: Catalog, camera: Camera, at: IsoDateTime): Catalog {
  let sessions = catalog.sessions
  for (const session of Object.values(catalog.sessions)) {
    if (!session.calibration || sessionRigVersion(catalog, session)?.version.cameraId !== camera.id) continue
    const calibration = { ...session.calibration }
    let changed = false
    for (const [kind, on] of [["dark", camera.noDarks], ["bias", camera.noBias]] as const) {
      const choice = calibration[kind]
      if (choice.state === "none" && choice.by === "camera-default" && !on) {
        calibration[kind] = { state: "waiting" }
        changed = true
      }
    }
    if (!changed) continue
    if (sessions === catalog.sessions) sessions = { ...catalog.sessions }
    sessions[session.id] = { ...session, calibration }
  }
  return calibrateSessions(sessions === catalog.sessions ? catalog : { ...catalog, sessions }, state.disk, state.settings, at)
}

/** A camera's "Don't use darks" and "Don't use bias" defaults (CAL-FR-22): its sessions settle as No with no warning, overridable per session. */
export function setCameraCalibrationDefaults(cameraId: CameraId, patch: Partial<Pick<Camera, "noDarks" | "noBias">>): CommitResult {
  const camera = store.getState().catalog.cameras[cameraId]
  if (!camera) return MISSING
  const href = EQUIPMENT_HREF
  const label = msg("settings_label_camera_defaults", { name: camera.name })
  const at = nowIso()
  const result = commit(
    label,
    (s) =>
      withCatalog(s, (c) => {
        const next = { ...c.cameras[cameraId]!, ...patch }
        return withCameraDefaults(s, { ...c, cameras: { ...c.cameras, [cameraId]: next } }, next, at)
      }),
    { href },
  )
  if (result.ok) recordSaved(msg("equipment_saved_named", { name: camera.name }), null, href)
  return result
}

// ---------------------------------------------------------------------------
// Windows Developer Mode (P-PREP3)
// ---------------------------------------------------------------------------

/** Check again: PlateVault reads the computer's Windows Developer Mode now. */
export function checkDeveloperMode(): CommitResult {
  return commit(msg("store_label_check_named", { name: msg("settings_developer_mode") }), (s) => ({ ...s, settings: { ...s.settings, developerModeCheck: s.faults.developerMode } }), { href: "/settings/applications" })
}

/**
 * Open Windows settings at For developers. The prototype simulates the user
 * turning Developer Mode on there; PlateVault sees it at its next check.
 */
export function openWindowsDeveloperSettings() {
  store.setState((s) => (s.faults.developerMode === "off" ? { ...s, faults: { ...s.faults, developerMode: "on" } } : s))
}
