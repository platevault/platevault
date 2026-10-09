/**
 * Settings writes shared by every screen (foundation-owned): rigs and their
 * filter lists (D-W31, PLAN-EQ-FR-01 to PLAN-EQ-FR-06), goal templates
 * (D-W30, D-W47), naming templates (D-W20, STO-IMP-FR-07) and application
 * profiles (PREP-FR-01, PREP-FR-02). Failed writes stay unsaved with Retry;
 * the last saved value stays in effect.
 */
import { validateNamingTemplate } from "@/domain/templates"
import type { ApplicationProfile, Band, GoalTemplate, GoalTemplateId, LocationId, MoonConstraint, NamingFrameType, OpticalTrainId, ProfileId, RigFilter, SimulatedApp } from "@/domain/types"
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
  if (location.role !== "archive" || location.retiredAt) return refuse("Make default refused", ["not an archive location"], href)
  const result = commit("Default archive location", (s) => ({ ...s, settings: { ...s.settings, defaultArchiveLocationId: locationId } }), { href })
  if (result.ok) recordSaved(`Default archive: ${location.displayName}`, null, href)
  return result
}

/** One band's Moon constraint behind "good tonight"; values are clamped to their ranges. */
export function setMoonConstraint(band: Band, patch: Partial<MoonConstraint>): CommitResult {
  const href = "/plan"
  return commit(`Moon constraint for ${band}`, (s) => {
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
  const result = commit(`Filters of ${rig.name}`, (s) => withCatalog(s, (c) => ({ ...c, opticalTrains: { ...c.opticalTrains, [rigId]: { ...c.opticalTrains[rigId]!, filters } } })), { href })
  if (result.ok) recordSaved(`Filters saved: ${rig.name}`, filters.map((f) => f.name).join(", ") || "No filters", href)
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
  const result = commit(`Rename ${rig.name}`, (s) => withCatalog(s, (c) => ({ ...c, opticalTrains: { ...c.opticalTrains, [rigId]: { ...c.opticalTrains[rigId]!, name: name.trim() } } })), { href })
  if (result.ok) recordSaved(`Rig renamed: ${name.trim()}`, null, href)
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
  const result = commit(`Goal template ${record.name}`, (s) => withCatalog(s, (c) => ({ ...c, goalTemplates: { ...c.goalTemplates, [id]: record } })), { href })
  if (result.ok) recordSaved(`Goal template saved: ${record.name}`, null, href)
  return { result, id }
}

export function deleteGoalTemplate(id: GoalTemplateId): CommitResult {
  const template = store.getState().catalog.goalTemplates[id]
  if (!template) return MISSING
  const href = "/settings/goal-templates"
  const result = commit(`Delete ${template.name}`, (s) =>
    withCatalog(s, (c) => {
      const { [id]: _removed, ...goalTemplates } = c.goalTemplates
      return { ...c, goalTemplates }
    }),
    { href },
  )
  if (result.ok) recordSaved(`Goal template deleted: ${template.name}`, "Projects keep the values copied from it.", href)
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
    if (errors.length > 0) return refuse(`Naming template for ${type} refused`, errors, href)
  }
  const result = commit(`Naming template for ${type}`, (s) => {
    const naming = { ...s.settings.naming }
    if (template === null) delete naming[type]
    else naming[type] = template
    return { ...s, settings: { ...s.settings, naming } }
  }, { href })
  if (result.ok) recordSaved(template === null ? `Naming default restored: ${type}` : `Naming template saved: ${type}`, template, href)
  return result
}

// ---------------------------------------------------------------------------
// Application profiles and the simulated computer
// ---------------------------------------------------------------------------

function patchProfile(profileId: ProfileId, label: string, patch: Partial<ApplicationProfile>): CommitResult {
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
  return patchProfile(profileId, `Locate ${profile?.name ?? "application"}`, { executablePath: path, executableState: observeExecutable(path) })
}

export function checkExecutable(profileId: ProfileId): CommitResult {
  const profile = store.getState().catalog.profiles[profileId]
  if (!profile) return { ok: true }
  return patchProfile(profileId, `Check ${profile.name}`, { executableState: observeExecutable(profile.executablePath) })
}

export function setLaunchArgs(profileId: ProfileId, launchArgs: string): CommitResult {
  return patchProfile(profileId, "Launch arguments", { launchArgs })
}

/** Prototype control: move an application bundle away or arm a launch failure. Never writes the catalog. */
export function updateApp(id: string, patch: Partial<SimulatedApp>) {
  store.setState((s) => ({ ...s, disk: { ...s.disk, apps: s.disk.apps.map((app) => (app.id === id ? { ...app, ...patch } : app)) } }))
}
