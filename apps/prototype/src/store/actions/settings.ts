/**
 * Settings writes shared by every screen (foundation-owned): rigs and their
 * filter lists (D-W31, PLAN-EQ-FR-01 to PLAN-EQ-FR-06), goal templates
 * (D-W30, D-W47), naming templates (D-W20, STO-IMP-FR-07) and application
 * profiles (PREP-FR-01, PREP-FR-02). Failed writes stay unsaved with Retry;
 * the last saved value stays in effect.
 */
import { validateNamingTemplate } from "@/domain/templates"
import type { ApplicationProfile, Band, GoalTemplate, GoalTemplateId, LocationId, MoonConstraint, NamingFrameType, OpticalTrainId, ProfileId, RigFilter, SimulatedApp } from "@/domain/types"
import { type MessageRef, msg, verbatim } from "@/lib/i18n"
import { type CommitResult, commit, store, withCatalog } from "@/store/core"
import { freshId, MISSING, recordSaved, refuse } from "./shared"

// ---------------------------------------------------------------------------
// Archive locations (P-ARC1) and Moon constraints (planning)
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

/** One band's Moon constraint behind "good tonight"; values are clamped to their ranges. */
export function setMoonConstraint(band: Band, patch: Partial<MoonConstraint>): CommitResult {
  const href = "/plan"
  return commit(msg("store_label_moon_constraint", { band }), (s) => {
    const current = s.settings.moonConstraints[band]
    const next: MoonConstraint = {
      minSeparationDeg: Math.min(180, Math.max(0, patch.minSeparationDeg ?? current.minSeparationDeg)),
      maxIlluminationPct: Math.min(100, Math.max(0, patch.maxIlluminationPct ?? current.maxIlluminationPct)),
    }
    return { ...s, settings: { ...s.settings, moonConstraints: { ...s.settings.moonConstraints, [band]: next } } }
  }, { href })
}

// ---------------------------------------------------------------------------
// Rigs and filters
// ---------------------------------------------------------------------------

/** Replace a rig's filter list; the list drives the band strip, presets and Fit (PLAN-EQ-FR-03). */
export function setRigFilters(rigId: OpticalTrainId, filters: RigFilter[]): CommitResult {
  const rig = store.getState().catalog.opticalTrains[rigId]
  if (!rig) return MISSING
  const href = "/settings/equipment"
  const result = commit(msg("equipment_filters_of", { name: rig.name }), (s) => withCatalog(s, (c) => ({ ...c, opticalTrains: { ...c.opticalTrains, [rigId]: { ...c.opticalTrains[rigId]!, filters } } })), { href })
  if (result.ok) recordSaved(msg("store_saved_filters", { name: rig.name }), filters.length > 0 ? verbatim(filters.map((f) => f.name).join(", ")) : msg("tonight_no_filters"), href)
  return result
}

/** "Add {value} to {rig}" (PLAN-EQ-FR-04): only the rig's settings change; headers stay as read. */
export function addFilterToRig(rigId: OpticalTrainId, value: string, bands: RigFilter["bands"]): CommitResult {
  const rig = store.getState().catalog.opticalTrains[rigId]
  if (!rig) return MISSING
  return setRigFilters(rigId, [...rig.filters, { id: freshId("flt", `${rigId}|${value}`), name: value, matches: [value], bands }])
}

export function renameRig(rigId: OpticalTrainId, name: string): CommitResult {
  const rig = store.getState().catalog.opticalTrains[rigId]
  if (!rig) return MISSING
  const href = "/settings/equipment"
  const result = commit(msg("equipment_rename_title", { name: rig.name }), (s) => withCatalog(s, (c) => ({ ...c, opticalTrains: { ...c.opticalTrains, [rigId]: { ...c.opticalTrains[rigId]!, name: name.trim() } } })), { href })
  if (result.ok) recordSaved(msg("store_saved_rig_renamed", { name: name.trim() }), null, href)
  return result
}

// ---------------------------------------------------------------------------
// Goal templates
// ---------------------------------------------------------------------------

/** Create or update a user template; built-ins cannot be edited or deleted (PRJ-FR-12). */
export function saveGoalTemplate(template: Omit<GoalTemplate, "id" | "source"> & { id: GoalTemplateId | null }): { result: CommitResult; id: GoalTemplateId } {
  const id = template.id ?? freshId("gtpl", template.name)
  const record: GoalTemplate = { ...template, id, source: "user" }
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
  if (!profile) return { ok: true }
  return patchProfile(profileId, msg("store_label_check_named", { name: profile.name }), { executableState: observeExecutable(profile.executablePath) })
}

export function setLaunchArgs(profileId: ProfileId, launchArgs: string): CommitResult {
  return patchProfile(profileId, msg("apps_launch_arguments"), { launchArgs })
}

/** Prototype control: move an application bundle away or arm a launch failure. Never writes the catalog. */
export function updateApp(id: string, patch: Partial<SimulatedApp>) {
  store.setState((s) => ({ ...s, disk: { ...s.disk, apps: s.disk.apps.map((app) => (app.id === id ? { ...app, ...patch } : app)) } }))
}
