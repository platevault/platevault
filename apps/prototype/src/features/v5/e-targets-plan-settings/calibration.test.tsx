import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { masterAge, newestVersion } from "@/domain/calibration"
import { masterPins } from "@/domain/calibration-library"
import { fileAt, makeFile, writeFiles } from "@/domain/disk"
import { createSeed } from "@/domain/seed"
import type { CalibrationMaster } from "@/domain/types"
import { fileName } from "@/lib/format"
import { m, say } from "@/lib/i18n"
import { addMasterVersion } from "@/store/actions/calibration"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"

// The Calibration library on the demo seed (CAL-FR-14, CAL-FR-15): the age badge, and Add version… adding a dated
// version that moves no session. The seed dates one dark from the clock (91 days back) and the other masters on fixed
// nights, so the age badges hold only near the seed's own day: freeze Date there, or every master turns Old after
// mid-December.
const SEED_DAY = Date.parse("2026-10-13T12:00:00Z")
let demo: PrototypeState
beforeAll(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(SEED_DAY)
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
afterAll(() => {
  vi.useRealTimers()
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

/** Every pin of `master`, as "session/kind" → the version it pins. */
function pinsOf(master: CalibrationMaster): Record<string, string> {
  return Object.fromEntries((masterPins(store.getState().catalog).get(master.id) ?? []).map((p) => [`${p.session.id}/${p.kind}`, p.versionId]))
}

/** A newer copy of `master`'s newest version in another folder: the same facts, new bytes, a later night. */
function newerCopy(master: CalibrationMaster): string {
  const state = store.getState()
  const source = fileAt(state.disk, newestVersion(master)!.path)!
  const path = `${source.path.slice(0, source.path.lastIndexOf("/"))}/Incoming/${fileName(source.path).replace(/\.xisf$/, "_new.xisf")}`
  const dateObs = new Date(Date.parse(source.header!.dateObs) + 86_400_000).toISOString()
  store.setState((s) => ({ ...s, disk: writeFiles(s.disk, [makeFile({ ...source, path, sha256: undefined, inode: undefined, header: { ...source.header!, dateObs }, modifiedAt: dateObs })]) }))
  return path
}

describe("Calibration library", () => {
  it("badges the 91-day-old dark as Old · 91 d", () => {
    const { catalog, settings } = store.getState()
    const old = Object.values(catalog.masters).flatMap((master) => {
      const age = masterAge(master, settings, Date.now())
      return age ? [say(m, age.label)] : []
    })
    expect(old).toEqual(["Old · 91 d"])
  })

  it("Add version adds a dated version to the master, and every session keeps the version it pins", () => {
    const master = Object.values(store.getState().catalog.masters).find((x) => x.kind === "dark" && Object.keys(pinsOf(x)).length > 0)
    expect(master, "a seed dark that sessions pin").toBeDefined()
    const before = pinsOf(master!)
    const path = newerCopy(master!)

    const outcome = addMasterVersion(master!.id, path)

    expect(outcome.result).toEqual({ ok: true })
    expect(outcome.masterId).toBe(master!.id)
    const after = store.getState().catalog.masters[master!.id]!
    expect(after.versions).toHaveLength(master!.versions.length + 1)
    const added = after.versions.find((v) => v.id === outcome.versionId)!
    expect(added.origin).toMatchObject({ kind: "imported", sourcePath: path })
    expect(newestVersion(after)!.id).toBe(added.id)
    // No pin moves to the new version: a session waiting for a dark may take it, a pinned one never does.
    expect(pinsOf(after)).toMatchObject(before)
  })
})
