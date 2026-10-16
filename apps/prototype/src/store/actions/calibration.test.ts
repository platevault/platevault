import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { calibrateSessions, calibrationSources, candidatesFor } from "@/domain/calibration"
import { masterPins, masterProjects } from "@/domain/calibration-library"
import { calibrationQueue } from "@/domain/derive"
import { fakeSha256, fileAt, makeFile, removeFile, writeFiles } from "@/domain/disk"
import { createSeed } from "@/domain/seed"
import type { CalibrationChoice, CalibrationSource, DiskFile, MasterId, PinKind, SessionId } from "@/domain/types"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import type { OperationHandler } from "@/store/operations"
import { toolFinishedStacking } from "@/store/simulation"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import {
  addMasterVersion,
  alsoUseCalibration,
  CALIBRATION_HANDLERS,
  confirmCalibration,
  hideMaster,
  importMasterFiles,
  pickCalibration,
  restoreMaster,
  setKeepRawCalibration,
  setMasterCamera,
  setNoCalibration,
  startStack,
  trashMaster,
} from "./calibration"
import { FOUNDATION_HANDLERS } from "./trash"

// Calibration writes in the F4 model: the stack-master process registers versions, pins are written on sessions,
// a new version repoints nothing, Hide and Move to Trash wait for no Project and re-match nothing, and pin drift
// puts a session in Needs calibration.
const SEED_DAY = Date.parse("2026-10-13T12:00:00Z")
const DARK_300 = "mst_49epv6"
const HA_FLAT = "mst_1h5jlfp"
const BIAS_USED = "mst_pwsu0b"

let demo: PrototypeState
let seededOps: Set<string>
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] })
  vi.setSystemTime(SEED_DAY)
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
  seededOps = new Set(Object.keys(demo.operations))
})
afterAll(() => {
  vi.useRealTimers()
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

const HANDLERS = new Map<string, OperationHandler>([...FOUNDATION_HANDLERS, ...CALIBRATION_HANDLERS].map((h) => [h.kind, h]))

/** Step the operations a test started (not the seed's) until they settle, as the ticker would. */
function drain() {
  for (let tick = 0; tick < 100; tick++) {
    const running = Object.values(store.getState().operations).filter((op) => op.status === "running" && !seededOps.has(op.id) && HANDLERS.has(op.kind))
    if (running.length === 0) return
    store.setState((s) => running.reduce((next, op) => (next.operations[op.id]?.status === "running" ? HANDLERS.get(op.kind)!.step(next, next.operations[op.id]!) : next), s))
  }
  throw new Error("operations did not settle")
}

const catalog = () => store.getState().catalog
const choice = (sessionId: SessionId, kind: PinKind): CalibrationChoice => catalog().sessions[sessionId]!.calibration![kind]
const queue = () => calibrationQueue(catalog(), store.getState().disk).map((s) => s.id)

/** Every pin in the library, by session and kind. */
function allPins(): Record<string, CalibrationChoice> {
  const out: Record<string, CalibrationChoice> = {}
  for (const session of Object.values(catalog().sessions)) {
    if (!session.calibration) continue
    for (const kind of ["dark", "flat", "bias"] as const) if (session.calibration[kind].state === "pinned") out[`${session.id}/${kind}`] = session.calibration[kind]
  }
  return out
}

function masterFile(masterId: MasterId, newest = true): DiskFile {
  const versions = [...catalog().masters[masterId]!.versions].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  return fileAt(store.getState().disk, (newest ? versions.at(-1) : versions[0])!.path)!
}

/** A master file stacked elsewhere, put where Import masters reads it: `from`'s header with `patch`. */
function incomingMaster(from: DiskFile, name: string, patch: Partial<NonNullable<DiskFile["header"]>>): string {
  const path = `/Volumes/Astro-T7/Incoming/${name}.xisf`
  const file = makeFile({ path, volumeId: from.volumeId, sizeBytes: from.sizeBytes, kind: from.kind, header: { ...from.header!, ...patch }, sha256: fakeSha256(path, 7), pixelTruth: from.pixelTruth, modifiedAt: "2026-10-12T09:00:00.000Z" })
  store.setState((s) => ({ ...s, disk: writeFiles(s.disk, [file]) }))
  return path
}

/** The bytes at `path` change in place. */
function rewrite(path: string) {
  store.setState((s) => {
    const file = fileAt(s.disk, path)!
    return { ...s, disk: writeFiles(s.disk, [{ ...file, sha256: fakeSha256(path, 99) }]) }
  })
}

/** No Project holds a session that pins `masterId` any more, so Hide and Move to Trash may act on it. */
function freeMaster(masterId: MasterId) {
  store.setState((s) => {
    const pinned = new Set((masterPins(s.catalog).get(masterId) ?? []).map((p) => p.session.id))
    const projects = Object.fromEntries(
      Object.entries(s.catalog.projects).map(([id, p]) => [
        id,
        { ...p, inputs: p.inputs.filter((i) => !pinned.has(i.sessionId)), snapshot: p.snapshot ? { ...p.snapshot, calibration: Object.fromEntries(Object.entries(p.snapshot.calibration).filter(([sessionId]) => !pinned.has(sessionId))) } : null },
      ]),
    )
    return { ...s, catalog: { ...s.catalog, projects } }
  })
  expect(masterProjects(catalog(), masterPins(catalog()), masterId)).toEqual([])
}

/** Sessions that pin or are suggested a version of `masterId`, per kind. */
function namingSessions(masterId: MasterId): Array<{ sessionId: SessionId; kind: PinKind }> {
  return Object.values(catalog().sessions).flatMap((s) =>
    s.supersededBy || !s.calibration
      ? []
      : (["dark", "flat", "bias"] as const).flatMap((kind) => {
          const c = s.calibration![kind]
          return (c.state === "pinned" || c.state === "suggested") && c.source.type === "master" && c.source.masterId === masterId ? [{ sessionId: s.id, kind }] : []
        }),
  )
}

const versionOf = (masterId: MasterId, index: number): CalibrationSource => {
  const versions = [...catalog().masters[masterId]!.versions].sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
  return { type: "master", masterId, versionId: versions[index]!.id }
}

describe("the stack-master process, without runs (P-CAL3)", () => {
  it("stacks a raw flat, detects it and registers it as a stacked version; no pin moves", () => {
    expect(setKeepRawCalibration(true).ok).toBe(true)
    const before = allPins()
    const { result, operationId } = startStack("ses_1cxwjbf", "prof_pixinsight")
    expect(result).toEqual({ ok: true })
    expect(toolFinishedStacking("cpr_ses_1cxwjbf")).toBe(true)
    drain()

    const process = catalog().calibrationProcesses.cpr_ses_1cxwjbf!
    expect(Object.values(process.steps).map((s) => s.state)).toEqual(["done", "done", "done", "done", "done"])
    expect(process.raws).toBe("kept")
    expect(store.getState().operations[operationId!]!.status).toBe("succeeded")
    const version = catalog().masters[process.masterId!]!.versions.find((v) => v.id === process.versionId)!
    expect(version.path).toBe(process.storagePath)
    expect(version.origin).toMatchObject({ kind: "stacked", sessionId: "ses_1cxwjbf", sourcePath: process.detected!.path })
    expect(version.adoption?.verifiedSha256).toBe(fileAt(store.getState().disk, version.path)!.sha256)
    for (const [key, pin] of Object.entries(before)) expect(allPins()[key], key).toEqual(pin)
  })
})

describe("Import masters (CAL-FR-13): Duplicate, New version and New", () => {
  it("refuses a Duplicate, adds a New version to its record and makes a New master, both imported", () => {
    const base = masterFile(DARK_300)
    const versions = catalog().masters[DARK_300]!.versions.length
    const before = allPins()
    const duplicate = `/Volumes/Astro-T7/Incoming/copy.xisf`
    store.setState((s) => ({ ...s, disk: writeFiles(s.disk, [{ ...base, path: duplicate }]) }))
    const newer = incomingMaster(base, "dark-300-oct", { dateObs: "2026-10-10T18:00:00.000Z" })
    const fresh = incomingMaster(base, "dark-60-oct", { dateObs: "2026-10-10T18:00:00.000Z", exposureS: 60 })

    const camera = catalog().masters[DARK_300]!.cameraId
    const [dup, version, created] = importMasterFiles([duplicate, newer, fresh].map((path) => ({ path, cameraId: camera })))

    expect(dup!.match?.kind).toBe("duplicate")
    expect(dup!.result.ok).toBe(false)
    expect(dup!.masterId).toBeNull()
    expect(version!.match?.kind).toBe("version")
    expect(version!.result).toEqual({ ok: true })
    expect(version!.masterId).toBe(DARK_300)
    expect(catalog().masters[DARK_300]!.versions).toHaveLength(versions + 1)
    expect(catalog().masters[DARK_300]!.versions.find((v) => v.id === version!.versionId)!.origin).toMatchObject({ kind: "imported", sourcePath: newer, sessionId: null })
    expect(created!.match?.kind).toBe("new")
    expect(created!.result).toEqual({ ok: true })
    expect(created!.masterId).not.toBe(DARK_300)
    expect(catalog().masters[created!.masterId!]!.exposureS).toBe(60)
    expect(catalog().masters[created!.masterId!]!.versions.map((v) => v.origin.kind)).toEqual(["imported"])
    for (const [key, pin] of Object.entries(before)) expect(allPins()[key], key).toEqual(pin)
  })

  it("links each file to the camera chosen for it: another camera of the model makes a New record, none chosen is refused (LIB-FR-26)", () => {
    const base = masterFile(DARK_300)
    const first = catalog().masters[DARK_300]!.cameraId!
    const second = Object.values(catalog().cameras).find((c) => c.id !== first && c.name === catalog().cameras[first]!.name)!
    const fromSecond = incomingMaster(base, "dark-300-cam2", { dateObs: "2026-10-10T18:00:00.000Z" })
    const unchosen = incomingMaster(base, "dark-300-unknown", { dateObs: "2026-10-11T18:00:00.000Z" })
    const versions = catalog().masters[DARK_300]!.versions

    const [linked, refused] = importMasterFiles([
      { path: fromSecond, cameraId: second.id },
      { path: unchosen, cameraId: null },
    ])

    expect(linked!.match?.kind).toBe("new")
    expect(linked!.result).toEqual({ ok: true })
    expect(linked!.masterId).not.toBe(DARK_300)
    expect(catalog().masters[linked!.masterId!]!.cameraId).toBe(second.id)
    expect(refused!.result.ok).toBe(false)
    expect(refused!.masterId).toBeNull()
    expect(catalog().masters[DARK_300]!.versions).toEqual(versions)
  })
})

describe("Add version (CAL-FR-14) repoints nothing", () => {
  it("adds a dated version: every session keeps the version it pins", () => {
    const pinned = namingSessions(DARK_300).filter((p) => choice(p.sessionId, p.kind).state === "pinned")
    expect(pinned.length).toBeGreaterThan(0)
    const before = allPins()
    const path = incomingMaster(masterFile(DARK_300), "dark-300-new", { dateObs: "2026-10-11T18:00:00.000Z" })

    const outcome = addMasterVersion(DARK_300, path)

    expect(outcome.result).toEqual({ ok: true })
    expect(outcome.masterId).toBe(DARK_300)
    expect(catalog().masters[DARK_300]!.versions.some((v) => v.id === outcome.versionId)).toBe(true)
    expect(allPins()).toEqual(before)
  })

  it("refuses a file that is not a new version of that master, and a Duplicate", () => {
    const masters = catalog().masters
    const other = incomingMaster(masterFile(DARK_300), "dark-60", { exposureS: 60 })
    expect(addMasterVersion(DARK_300, other).result.ok).toBe(false)
    expect(addMasterVersion(DARK_300, masterFile(DARK_300).path).result.ok).toBe(false)
    expect(catalog().masters).toEqual(masters)
  })
})

describe("Hide and Move to Trash (CAL-FR-16/17)", () => {
  it("refuses both while a Project uses the master through its sessions, naming the Projects", () => {
    const projects = masterProjects(catalog(), masterPins(catalog()), BIAS_USED).map((p) => p.name)
    expect(projects.length).toBeGreaterThan(0)
    const hidden = hideMaster(BIAS_USED)
    expect(hidden.ok).toBe(false)
    expect(hidden.ok === false && hidden.reason === "refused" ? hidden.reasons : []).toEqual(projects)
    const trashed = trashMaster(BIAS_USED)
    expect(trashed.result.ok).toBe(false)
    expect(trashed.operationId).toBeNull()
    expect(catalog().masters[BIAS_USED]!.hiddenAt).toBeUndefined()
  })

  it("hides an unused master: its sessions wait for calibration again, with no re-match", () => {
    freeMaster(HA_FLAT)
    const released = namingSessions(HA_FLAT)
    expect(released.some((p) => choice(p.sessionId, p.kind).state === "pinned")).toBe(true)
    const others = Object.fromEntries(Object.entries(allPins()).filter(([key]) => !released.some((p) => key === `${p.sessionId}/${p.kind}`)))

    expect(hideMaster(HA_FLAT)).toEqual({ ok: true })

    expect(catalog().masters[HA_FLAT]!.hiddenAt).toBeDefined()
    for (const p of released) expect(choice(p.sessionId, p.kind)).toEqual({ state: "waiting" })
    expect(queue()).toEqual(expect.arrayContaining(released.map((p) => p.sessionId)))
    // Matching now would fill some of them; Hide left that to the user (no automatic re-match).
    const { disk, settings } = store.getState()
    const rematched = calibrateSessions(catalog(), disk, settings, "2026-10-13T12:00:00.000Z")
    expect(released.some((p) => rematched.sessions[p.sessionId]!.calibration![p.kind].state !== "waiting")).toBe(true)
    // The hidden master is never offered.
    const sources = calibrationSources(catalog(), disk)
    expect(sources.some((s) => s.source.type === "master" && s.source.masterId === HA_FLAT)).toBe(false)
    expect(Object.fromEntries(Object.entries(allPins()).filter(([key]) => key in others))).toEqual(others)

    expect(restoreMaster(HA_FLAT)).toEqual({ ok: true })
    expect(catalog().masters[HA_FLAT]!.hiddenAt).toBeUndefined()
    for (const p of released) expect(choice(p.sessionId, p.kind)).toEqual({ state: "waiting" })
  })

  it("moves an unused master's every version to the OS Trash: it leaves the library and its sessions wait", () => {
    freeMaster(HA_FLAT)
    const released = namingSessions(HA_FLAT)
    const paths = catalog().masters[HA_FLAT]!.versions.map((v) => v.path)

    const { result, operationId } = trashMaster(HA_FLAT)

    expect(result).toEqual({ ok: true })
    expect(catalog().masters[HA_FLAT]).toBeUndefined()
    for (const p of released) expect(choice(p.sessionId, p.kind)).toEqual({ state: "waiting" })
    drain()
    expect(store.getState().operations[operationId!]!.status).toBe("succeeded")
    const { disk } = store.getState()
    for (const path of paths) {
      expect(fileAt(disk, path)).toBeUndefined()
      expect(disk.trash.some((t) => t.originalPath === path)).toBe(true)
    }
    expect(Object.values(catalog().trashEpisodes).some((e) => e.kind === "calibration-master" && e.items.every((i) => i.outcome === "trashed"))).toBe(true)
  })
})

describe("pin writes on sessions (LIB-FR-23, LIB-FR-25)", () => {
  const SUGGESTED = "ses_1v704nq"

  it("Confirm makes a suggestion the user's pin with its evidence", () => {
    const suggested = choice(SUGGESTED, "flat")
    expect(suggested.state).toBe("suggested")
    expect(confirmCalibration([{ sessionId: SUGGESTED, kind: "flat" }])).toEqual({ ok: true })
    const pinned = choice(SUGGESTED, "flat")
    expect(pinned).toMatchObject({ state: "pinned", by: "user" })
    expect(pinned.state === "pinned" && suggested.state === "suggested" ? [pinned.source, pinned.evidence] : null).toEqual(suggested.state === "suggested" ? [suggested.source, suggested.evidence] : null)
  })

  it("Confirm is refused when the suggested file changed since: the suggestion stays", () => {
    const suggested = choice(SUGGESTED, "flat")
    rewrite(masterFile(HA_FLAT).path)
    expect(confirmCalibration([{ sessionId: SUGGESTED, kind: "flat" }]).ok).toBe(false)
    expect(choice(SUGGESTED, "flat")).toEqual(suggested)
  })

  it("Choose pins an offered source by the user, over a pin, and refuses one that is not offered", () => {
    const older = versionOf(DARK_300, 0)
    const revision = catalog().sessions[SUGGESTED]!.revision
    expect(pickCalibration(SUGGESTED, "dark", older, revision)).toEqual({ ok: true })
    expect(choice(SUGGESTED, "dark")).toMatchObject({ state: "pinned", by: "user", source: older })

    const before = choice(SUGGESTED, "flat")
    const oiii: CalibrationSource = versionOf("mst_bmjp84", 0)
    expect(pickCalibration(SUGGESTED, "flat", oiii, catalog().sessions[SUGGESTED]!.revision).ok).toBe(false)
    expect(choice(SUGGESTED, "flat")).toEqual(before)
  })

  it("No settles a kind with no reason, by the user", () => {
    expect(setNoCalibration([{ sessionId: "ses_9ddkg4", kind: "flat" }])).toEqual({ ok: true })
    expect(choice("ses_9ddkg4", "flat")).toMatchObject({ state: "none", by: "user" })
  })

  it("Also use pins a source on sessions set to No, and refuses a session that is not", () => {
    const source = versionOf(HA_FLAT, 0)
    expect(setNoCalibration([{ sessionId: SUGGESTED, kind: "flat" }]).ok).toBe(true)
    const other = "ses_1g6auvp"
    const otherBefore = choice(other, "flat")
    expect(otherBefore.state).toBe("suggested")

    expect(alsoUseCalibration(source, [SUGGESTED, other]).ok).toBe(false)
    expect(choice(SUGGESTED, "flat").state).toBe("none")

    expect(alsoUseCalibration(source, [SUGGESTED])).toEqual({ ok: true })
    expect(choice(SUGGESTED, "flat")).toMatchObject({ state: "pinned", by: "user", source })
    expect(choice(other, "flat")).toEqual(otherBefore)
  })

  it("Link camera narrows a master to one physical camera and refuses another model; no pin moves", () => {
    const before = allPins()
    expect(setMasterCamera(DARK_300, "cam_533").ok).toBe(false)
    expect(setMasterCamera(DARK_300, "cam_2600b")).toEqual({ ok: true })
    expect(catalog().masters[DARK_300]!.cameraId).toBe("cam_2600b")
    expect(allPins()).toEqual(before)
    // Sessions of the other ASI2600MM are no longer offered it.
    const session = catalog().sessions[SUGGESTED]!
    const { disk, settings } = store.getState()
    expect(candidatesFor(catalog(), settings, session, "dark", calibrationSources(catalog(), disk)).some((c) => c.source.source.type === "master" && c.source.source.masterId === DARK_300)).toBe(false)
  })
})

describe("pin drift (D-W113; owner record section 9)", () => {
  const SESSION = "ses_iba297"

  it("a pinned file that changes or goes missing keeps its pin and puts the session in Needs calibration until reassigned", () => {
    expect(queue()).not.toContain(SESSION)
    const dark = choice(SESSION, "dark")
    expect(dark.state === "pinned" && dark.source.type === "master").toBe(true)
    rewrite(dark.state === "pinned" ? dark.evidence.files[0]!.path : "")

    expect(queue()).toContain(SESSION)
    expect(choice(SESSION, "dark")).toEqual(dark)

    expect(pickCalibration(SESSION, "dark", versionOf(DARK_300, 0), catalog().sessions[SESSION]!.revision)).toEqual({ ok: true })
    expect(queue()).not.toContain(SESSION)

    const bias = choice(SESSION, "bias")
    const biasPath = bias.state === "pinned" ? bias.evidence.files[0]!.path : ""
    store.setState((s) => ({ ...s, disk: removeFile(s.disk, fileAt(s.disk, biasPath)!.volumeId, biasPath) }))
    expect(queue()).toContain(SESSION)
    expect(choice(SESSION, "bias")).toEqual(bias)
  })
})
