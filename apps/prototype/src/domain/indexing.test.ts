import { describe, expect, it } from "vitest"
import { m } from "@/lib/i18n"
import type { World } from "./derive"
import { makeFile, writeFiles } from "./disk"
import { framingOf, ingestFiles, isUnder, listLocation, NO_MASTER_CAMERAS, sessionFraming, splitByFraming } from "./indexing"
import { sessionLongLabel } from "./membership"
import { arrivalFiles, createSeed } from "./seed"
import type { DiskFile, FrameHeader, Location, Session } from "./types"

const NOW = "2026-10-13T12:00:00.000Z"
const MARGINS = createSeed("demo").settings.matching.framing

/** A light of 300 s SII on 12 Oct, `minute` minutes into the night, its centre `offset` centre margins north of the first; no pointing with `offset` null. */
function header(minute: number, offset: number | null): FrameHeader {
  const base = arrivalFiles()[0]!.header!
  const time = new Date(Date.parse("2026-10-12T20:00:00.000Z") + minute * 60_000).toISOString()
  return { ...base, imageType: "light", filter: "SII", exposureS: 300, dateObs: time, ra: offset === null ? null : base.ra, dec: offset === null ? null : base.dec! + offset * marginDeg(), rotationDeg: offset === null ? null : base.rotationDeg }
}

/** The centre margin of the template rig's field, in degrees. */
function marginDeg(): number {
  return (framingOf(arrivalFiles()[0]!.header!)!.fieldDeg! * MARGINS.centrePct) / 100
}

describe("splitByFraming: each frame compared with its framing's first frame in capture order (D-W107)", () => {
  it("splits frames listed out of capture order by capture time, not by their listed order", () => {
    // A drift listed newest first: read in listed order, the newest frame would anchor and take the middle one.
    const listed = [header(20, 1.4), header(10, 0.7), header(0, 0)]
    const { framings } = splitByFraming(listed, (h) => h, MARGINS)
    expect(framings.map((f) => f.map((h) => h.dateObs))).toEqual([[header(0, 0).dateObs, header(10, 0.7).dateObs], [header(20, 1.4).dateObs]])
  })

  it("splits a drift where each frame is within the margin of the one before but not of the first; never chains", () => {
    const drift = [0, 0.7, 1.4, 2.1].map((offset, i) => header(i * 10, offset))
    const { framings } = splitByFraming(drift, (h) => h, MARGINS)
    expect(framings.map((f) => f.length)).toEqual([2, 2])
    expect(framings[1]![0]!.dec).toBe(drift[2]!.dec)
  })

  it("rejoins an earlier framing when the mount returns to it (A A B B A A)", () => {
    const frames = [0, 0, 3, 3, 0, 0].map((offset, i) => header(i * 10, offset))
    const { framings } = splitByFraming(frames, (h) => h, MARGINS)
    expect(framings.map((f) => f.map((h) => frames.indexOf(h)))).toEqual([
      [0, 1, 4, 5],
      [2, 3],
    ])
  })

  it("keeps frames with no pointing apart: they never join a framing", () => {
    const frames = [header(0, null), header(10, 0), header(20, null), header(30, 0)]
    const { framings, unpointed } = splitByFraming(frames, (h) => h, MARGINS)
    expect(framings.map((f) => f.map((h) => frames.indexOf(h)))).toEqual([[1, 3]])
    expect(unpointed.map((h) => frames.indexOf(h))).toEqual([0, 2])
  })
})

/** A fresh demo library and the Captures location new captures arrive in. */
function world(): { world: World; location: Location } {
  const w: World = structuredClone(createSeed("demo"))
  const path = arrivalFiles()[0]!.path
  return { world: w, location: Object.values(w.catalog.locations).find((l) => l.role === "captures" && isUnder(path, l.path))! }
}

/** SII lights written under the location, one per header, named so the path order differs from the capture order. */
function lights(location: Location, headers: FrameHeader[]): DiskFile[] {
  return headers.map((h, i) => makeFile({ path: `${location.path}/SII/Light_SII_${String(headers.length - i).padStart(3, "0")}.fits`, volumeId: location.volumeId, sizeBytes: 32_000_000, kind: "fits", header: h, modifiedAt: NOW }))
}

/** The sessions the ingestion gave `files`, in session framing order, each as the indexes of its frames. */
function sessionsOf(w: World, files: DiskFile[]): Array<{ session: Session; frames: number[] }> {
  const index = new Map(files.map((f, i) => [f.path, i]))
  const sessions = new Map<string, Session>()
  for (const asset of Object.values(w.catalog.assets)) {
    const at = asset.copies.find((c) => index.has(c.path))
    if (at && asset.sessionId) sessions.set(asset.sessionId, w.catalog.sessions[asset.sessionId]!)
  }
  return [...sessions.values()]
    .sort((a, b) => a.framing - b.framing)
    .map((session) => ({
      session,
      frames: session.assetIds.map((id) => index.get(w.catalog.assets[id]!.copies[0]!.path)!).sort((a, b) => a - b),
    }))
}

describe("Intake: the same split when files are read into the library (D-W107, LIB-FR-04)", () => {
  it("lists readable files in capture order and splits a drift, a return and frames with no pointing as import review does", () => {
    const { world: w, location } = world()
    // Captured A, A, (drift) A+0.7, B, B, A, A, then two frames with no pointing; the file names count down.
    const offsets = [0, 0, 0.7, 3, 3, 0, 0, null, null]
    const files = lights(location, offsets.map((offset, i) => header(i * 10, offset)))
    w.disk = writeFiles(w.disk, files)
    const readable = listLocation(w.disk, location).readable.filter((f) => files.includes(f))
    expect(readable.map((f) => files.indexOf(f))).toEqual(offsets.map((_, i) => i))

    w.catalog = ingestFiles(w.catalog, w.disk, w.settings, location, [...files].reverse(), NOW, NO_MASTER_CAMERAS)
    const sessions = sessionsOf(w, files)
    expect(sessions.map((s) => [s.session.framing, s.frames])).toEqual([
      [1, [0, 1, 2, 5, 6]],
      [2, [3, 4]],
      [3, [7, 8]],
    ])
    // The session with no pointing reads as Framing unknown: no framing to place it by.
    expect(sessions.map((s) => sessionFraming(w.catalog, s.session) === null)).toEqual([false, false, true])
    expect(sessionLongLabel(m, sessions[2]!.session)).toMatch(new RegExp(`${m.domain_session_framing_unknown()}$`))

    const preview = splitByFraming(files, (f) => f.header!, w.settings.matching.framing)
    expect(preview.framings.map((f) => f.map((file) => files.indexOf(file)).sort((a, b) => a - b))).toEqual([sessions[0]!.frames, sessions[1]!.frames])
    expect(preview.unpointed.map((f) => files.indexOf(f))).toEqual(sessions[2]!.frames)
  })

  it("compares a later frame with the session's first frame, never its mean, and never puts a pointed frame in the Framing unknown session", () => {
    const { world: w, location } = world()
    const first = lights(location, [header(0, 0), header(10, 0.9), header(20, null)])
    w.disk = writeFiles(w.disk, first)
    w.catalog = ingestFiles(w.catalog, w.disk, w.settings, location, first, NOW, NO_MASTER_CAMERAS)
    // 1.2 margins from the first frame but within one of the session's mean pointing (0.45).
    const later = [makeFile({ path: `${location.path}/SII/Light_SII_later.fits`, volumeId: location.volumeId, sizeBytes: 32_000_000, kind: "fits", header: header(30, 1.2), modifiedAt: NOW })]
    w.disk = writeFiles(w.disk, later)
    w.catalog = ingestFiles(w.catalog, w.disk, w.settings, location, later, NOW, NO_MASTER_CAMERAS)
    const all = [...first, ...later]
    expect(sessionsOf(w, all).map((s) => s.frames)).toEqual([[0, 1], [2], [3]])
    expect(sessionFraming(w.catalog, sessionsOf(w, all)[1]!.session)).toBeNull()
  })
})
