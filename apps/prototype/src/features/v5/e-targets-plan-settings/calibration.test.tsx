import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { masterAge } from "@/domain/calibration"
import { masterUsage } from "@/domain/calibration-library"
import { masterReplacementRuns } from "@/domain/derive"
import { fileAt, makeFile, writeFiles } from "@/domain/disk"
import { createSeed } from "@/domain/seed"
import type { CalibrationMaster } from "@/domain/types"
import { m, say } from "@/lib/i18n"
import { replaceMaster } from "@/store/actions/calibration"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"

// The Calibration library on the demo seed (C9): the age badge, and Replace… re-pointing only unfinished runs.
// The seed dates one dark from the clock (91 days back) and the other masters on fixed nights, so the age
// badges hold only near the seed's own day: freeze Date there, or every master turns Old after mid-December.
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

/** Runs that hand off `master`, open and finished. */
function users(master: CalibrationMaster) {
  const { catalog, disk } = store.getState()
  const runs = (masterUsage(catalog, disk).get(master.id) ?? []).map((u) => u.run)
  return { open: runs.filter((r) => r.completion !== "complete").map((r) => r.id), finished: runs.filter((r) => r.completion === "complete").map((r) => r.id) }
}

/** A newer copy of `master`'s file in another folder: the same facts, new bytes, a later night. */
function newerCopy(master: CalibrationMaster): string {
  const state = store.getState()
  const source = fileAt(state.disk, master.path)!
  const path = `${master.path.slice(0, master.path.lastIndexOf("/"))}/Incoming/${source.path.split("/").pop()!.replace(/\.xisf$/, "_new.xisf")}`
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

  it("Replace re-points the open runs, and finished runs keep their old master", () => {
    const master = Object.values(store.getState().catalog.masters).find((x) => {
      const { open, finished } = users(x)
      return open.length > 0 && finished.length > 0
    })
    expect(master, "a seed master that open and finished runs both use").toBeDefined()
    const before = users(master!)
    expect(masterReplacementRuns(store.getState(), master!.id).map((r) => r.id).sort()).toEqual([...before.open].sort())

    const outcome = replaceMaster(master!.id, newerCopy(master!))

    expect(outcome.result).toEqual({ ok: true })
    expect([...outcome.repointed].sort()).toEqual([...before.open].sort())
    const replaced = store.getState().catalog.masters[master!.id]!
    expect(replaced.replacedBy).toBe(outcome.masterId)
    expect(users(replaced)).toEqual({ open: [], finished: before.finished })
    expect(users(store.getState().catalog.masters[outcome.masterId!]!).open.sort()).toEqual([...before.open].sort())
  })
})
