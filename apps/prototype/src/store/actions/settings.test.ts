import { beforeAll, beforeEach, describe, expect, it } from "vitest"
import { createSeed, PROFILE_IDS } from "@/domain/seed"
import type { RunSetup } from "@/domain/types"
import { m } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { addApplicationProfile, removeApplicationProfile } from "./settings"

let demo: PrototypeState
beforeAll(() => {
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

const added = () => addApplicationProfile({ name: "  Astro Pixel Processor ", executablePath: "/Applications/APP.app", launchArgs: "--batch" })

describe("application profiles", () => {
  it("adds a generic, unverified profile and returns its id", () => {
    const { result, id } = added()
    expect(result.ok).toBe(true)
    const profile = store.getState().catalog.profiles[id]!
    expect(profile).toMatchObject({ id, application: "generic", name: "Astro Pixel Processor", executablePath: "/Applications/APP.app", launchArgs: "--batch" })
    expect(profile.capability.verified).toBe(false)
    // No bundle sits at that path on the simulated computer.
    expect(profile.executableState).toBe("missing")
    expect(addApplicationProfile({ name: "Other", executablePath: null, launchArgs: "" }).id).not.toBe(id)
  })

  it("removes an added profile that no run uses", () => {
    const { id } = added()
    expect(removeApplicationProfile(id).ok).toBe(true)
    expect(store.getState().catalog.profiles[id]).toBeUndefined()
  })

  it("refuses to remove a built-in profile", () => {
    const result = removeApplicationProfile(PROFILE_IDS.siril)
    expect(result).toMatchObject({ ok: false, reason: "refused", reasons: [m.status_built_in()] })
    expect(store.getState().catalog.profiles[PROFILE_IDS.siril]).toBeDefined()
  })

  it("refuses to remove a profile a run uses, naming the run", () => {
    const { id } = added()
    const run = Object.values(store.getState().catalog.runs).find((r) => !r.trashedAt)!
    const setup: RunSetup = { ...(run.setup ?? { inputMode: null, calibrationPolicy: "automatic", profileId: null }), profileId: id }
    store.setState((s) => ({ ...s, catalog: { ...s.catalog, runs: { ...s.catalog.runs, [run.id]: { ...run, setup } } } }))
    const result = removeApplicationProfile(id)
    expect(result.ok).toBe(false)
    if (result.ok || result.reason !== "refused") throw new Error("expected a refusal")
    expect(result.reasons).toHaveLength(1)
    expect(result.reasons[0]).toContain(m.calibration_used_by_runs({ count: 1 }))
    expect(result.reasons[0]).toContain(run.name)
    expect(store.getState().catalog.profiles[id]).toBeDefined()
  })
})
