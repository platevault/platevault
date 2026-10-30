/**
 * The Settings area's library host for tests: a small stateful catalog
 * answering by command, so a save a test makes is what the next read (and a
 * remounted page) shows; every call is recorded with its arguments. `fail`
 * makes the next call of a command answer with the library's structured
 * refusal instead.
 */
import type { Camera, GoalTemplate, HomeCriteria, LocationState, NamingTemplate, NativePathWire, ObservingSite, PlanCriteria, Profile, Rig, ScanOperation, WorkflowSettingsRecord_Serialize } from "@/api/ipc"

export const CRITERIA: PlanCriteria = { minAltitudeDeg: 30, darkness: "astronomical", moon: { kind: "below_horizon" }, minDurationMinutes: 60 }

export function nativePath(display: string): NativePathWire {
  return { encoding: "unix-bytes", payload: Array.from(new TextEncoder().encode(display)), display }
}

export function location(id: string, name: string, role: LocationState["location"]["role"], over: Partial<LocationState["location"]> = {}): LocationState {
  return {
    location: {
      id,
      name,
      path: nativePath(`/Astro/${name}`),
      role,
      identity: { volume: { kind: "uuid", value: "vol-1" }, fileId: null } as never,
      decisionRevision: 1,
      availability: "available",
      lastObservedAt: null,
      lifecycle: "active",
      volumeKind: "local",
      ...over,
    },
    failure: null,
  }
}

export function scan(id: string, locationId: string, state: ScanOperation["state"] = "completed"): ScanOperation {
  return {
    id,
    locationId,
    state,
    progress: { discovered: 12, metadataRead: 10, unsupported: 1, unreadable: 0, completeDirectories: 3 } as ScanOperation["progress"],
    issues: [],
    completeScopes: [],
    incompleteScopes: [],
    startedAt: "2026-10-29T20:00:00Z",
    finishedAt: state === "running" ? null : "2026-10-29T20:05:00Z",
  }
}

const RIG: Rig = {
  equipment: { id: "rig-1", name: "RedCat 51", camera: "ASI2600MM", telescope: "RedCat 51", focalLengthMm: 250, pixelSizeUm: 3.76, sensorWidthPx: 6248, sensorHeightPx: 4176, colorKind: "mono", decisionRevision: 4, state: "confirmed", provenance: { source: "user" } },
  filters: { equipmentId: "rig-1", revision: 2, filters: [{ id: "f-ha", name: "Ha", matchValues: ["Ha"], bands: ["Ha"] }] },
  bands: ["Ha"],
  fieldOfView: null,
}

const CAMERA: Camera = { id: "cam-1", model: "ASI2600MM", alias: null, noDarks: false, noBias: false, revision: 3 }

const SITE: ObservingSite = { id: "site-1", name: "Backyard", latitudeDeg: 52.1, longitudeDeg: 5.1, elevationM: 10, timeZone: "Europe/Amsterdam", revision: 2, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }

const CURVE = { distanceDeg: 120, widthDays: 7 }

export const WORKFLOW: WorkflowSettingsRecord_Serialize = {
  revision: 5,
  settings: {
    framing: { minOverlapPercent: 80, panelOverlapPercent: [5, 40], maxCentreOffsetArcmin: 5, maxRotationDeg: 2 },
    flats: { fineWithinDeg: 1, offeredWithinDeg: 5, windowNights: 1 },
    darkBias: { windowDays: 90 },
    keywords: { group: "GROUP", panel: "PANEL" },
    viewMode: "symlinks",
    calibration: { keepRawFrames: false, oldMasterAfterDays: 180 },
    moonAvoidance: { L: CURVE, R: CURVE, G: CURVE, B: CURVE, Ha: { distanceDeg: 60, widthDays: 5 }, SII: CURVE, OIII: CURVE },
  },
}

const NAMING: NamingTemplate[] = [{ frameType: "light", template: "{target}/{filter}", defaultTemplate: "{target}/{filter}", overridden: false }]

const TEMPLATES: GoalTemplate[] = [
  { id: "builtin:hoo", name: "HOO", builtin: true, revision: 1, goals: [{ kind: "integration", channel: "Ha", goalSeconds: 36_000 }] },
  { id: "tpl-1", name: "My LRGB", builtin: false, revision: 2, goals: [{ kind: "frame_count", channel: "L", goalFrames: 120 }] },
]

const PROFILE: Profile = { id: "prof-1", name: "PixInsight", kind: "wbpp", executable: nativePath("/Applications/PixInsight.app"), args: ["{view}"], capabilityEvidence: {}, revision: 1, createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }

export interface Catalog {
  locations: LocationState[]
  scans: ScanOperation[]
  criteria: HomeCriteria
  workflow: WorkflowSettingsRecord_Serialize
  rigs: Rig[]
  cameras: Camera[]
  sites: ObservingSite[]
  defaultSiteId: string | null
  settingsRevision: number
  naming: NamingTemplate[]
  templates: GoalTemplate[]
  profiles: Profile[]
  /** What the next `library_pick_folder` / `library_pick_file` answers: a path, or `null` for Cancel. */
  picked: NativePathWire | null
}

export function catalog(over: Partial<Catalog> = {}): Catalog {
  return {
    locations: [],
    scans: [],
    criteria: { criteria: null, revision: 0 },
    workflow: structuredClone(WORKFLOW),
    rigs: [structuredClone(RIG)],
    cameras: [CAMERA],
    sites: [SITE],
    defaultSiteId: SITE.id,
    settingsRevision: 5,
    naming: NAMING,
    templates: TEMPLATES,
    profiles: [PROFILE],
    picked: null,
    ...over,
  }
}

/** The library's structured refusal, as the generated client receives it. */
export function refusal(code: string, retry = "retry", currentRevision: number | null = null) {
  return { code, identity: null, scope: null, retry, currentRevision, successors: [], window: null, correction: null }
}

/** The stateful host over `state`; a test installs `handler` with `mockIPC`. */
export function settingsHost(state: Catalog = catalog()) {
  const calls: { command: string; args: Record<string, unknown> }[] = []
  const failures = new Map<string, ReturnType<typeof refusal>>()
  let next = 1
  const handler = (command: string, args?: unknown): unknown => {
    const a = (args ?? {}) as Record<string, unknown>
    if (command === "plugin:event|listen") return a.handler
    if (command === "plugin:event|unlisten") return null
    calls.push({ command, args: a })
    const failure = failures.get(command)
    if (failure) {
      failures.delete(command)
      throw failure
    }
    switch (command) {
      case "library_issues":
        return { issues: [], dismissed: [], counts: { danger: 0, warning: 0, info: 0 }, pages: [] }
      case "library_list_locations":
        return state.locations
      case "library_list_operations": {
        const listed = a.locationId ? state.scans.filter((s) => s.locationId === a.locationId) : state.scans
        return listed.slice(a.offset as number, (a.offset as number) + (a.limit as number))
      }
      case "library_check_symlinks":
        return "developer_mode_off"
      case "library_pick_folder":
      case "library_pick_file":
        return state.picked
      case "library_register_location": {
        const created = location(`loc-${next++}`, a.displayName as string, a.role as LocationState["location"]["role"], { path: a.path as NativePathWire })
        state.locations = [...state.locations, created]
        return created.location
      }
      case "library_start_scan": {
        const started = scan(`scan-${next++}`, a.locationId as string, "running")
        state.scans = [started, ...state.scans]
        return started
      }
      case "planning_home_criteria":
        return state.criteria
      case "planning_save_home_criteria":
        if (a.expectedRevision !== state.criteria.revision) throw refusal("conflict", "review", state.criteria.revision)
        state.criteria = { criteria: a.criteria as PlanCriteria, revision: state.criteria.revision + 1 }
        return state.criteria
      case "workflow_settings_get":
        return state.workflow
      case "workflow_settings_save":
        if (a.expectedRevision !== state.workflow.revision) throw refusal("conflict", "review", state.workflow.revision)
        state.workflow = { settings: a.settings as WorkflowSettingsRecord_Serialize["settings"], revision: state.workflow.revision + 1 }
        return state.workflow
      case "library_list_rig_filters":
        return state.rigs
      case "library_list_cameras":
        return state.cameras
      case "library_list_equipment":
        return state.rigs.map((r) => r.equipment)
      case "library_save_equipment": {
        const input = a.equipment as Rig["equipment"]
        const old = state.rigs.find((r) => r.equipment.id === input.id)
        if (old && a.expectedRevision !== old.equipment.decisionRevision) throw refusal("conflict", "review", old.equipment.decisionRevision)
        const saved: Rig = old
          ? { ...old, equipment: { ...old.equipment, ...input, id: old.equipment.id, decisionRevision: old.equipment.decisionRevision + 1 } }
          : { ...structuredClone(RIG), equipment: { ...RIG.equipment, ...input, id: `rig-${next++}`, decisionRevision: 1 } }
        state.rigs = old ? state.rigs.map((r) => (r === old ? saved : r)) : [...state.rigs, saved]
        return saved.equipment
      }
      case "library_delete_equipment":
        state.rigs = state.rigs.filter((r) => r.equipment.id !== a.equipmentId)
        return null
      case "library_save_camera": {
        const input = a.input as Camera
        const old = state.cameras.find((camera) => camera.id === input.id)
        if (old && input.revision !== old.revision) throw refusal("conflict", "review", old.revision)
        if (state.cameras.some((camera) => camera.id !== input.id && camera.model.toLowerCase() === input.model.toLowerCase() && camera.alias === input.alias)) {
          throw refusal("invalid_input", "none")
        }
        const saved: Camera = { ...input, id: old?.id ?? `cam-${next++}`, revision: old ? old.revision + 1 : 1 }
        state.cameras = old ? state.cameras.map((camera) => (camera === old ? saved : camera)) : [...state.cameras, saved]
        return saved
      }
      case "library_delete_camera":
        state.cameras = state.cameras.filter((c) => c.id !== a.cameraId)
        return null
      case "planning_list_sites":
        return { sites: state.sites, defaultSiteId: state.defaultSiteId, settingsRevision: state.settingsRevision }
      case "planning_set_default_site":
        state.defaultSiteId = a.siteId as string | null
        state.settingsRevision += 1
        return { settings: { defaultSiteId: state.defaultSiteId, revision: state.settingsRevision }, needsReconfirmation: [] }
      case "naming_get":
        return state.naming
      case "goal_template_list":
        return state.templates
      case "prepare_profiles":
        return state.profiles
      case "pix_list_measurement_runs":
      case "calibration_list_adoptions":
        return []
      default:
        return null
    }
  }
  return {
    handler,
    state,
    calls,
    sent: (command: string) => calls.filter((c) => c.command === command).map((c) => c.args),
    /** The next call of `command` is refused with `code`. */
    fail: (command: string, code: string, retry = "retry") => failures.set(command, refusal(code, retry)),
  }
}
