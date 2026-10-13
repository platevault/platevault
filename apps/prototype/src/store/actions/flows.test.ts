import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { groupFlowState, groupStepLink } from "@/domain/derive"
import { createSeed } from "@/domain/seed"
import type { Run } from "@/domain/types"
import { m } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { groupFlow, type GroupFlowHost } from "./flows"
import { removeRunSessions } from "./runs"

// The run group's Proceed acts on every live panel (§5.2) on the demo IC 5070 mosaic: Panel 1 waits at Results, Panel 2 is Partial at Prepare, Panel 3's run is in the Trash.
const GROUP = "grp_ic5070"
const P1 = "run_ic5070_p1"
const P2 = "run_ic5070_p2"
const P3 = "run_ic5070_p3"

let demo: PrototypeState
beforeAll(() => {
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

const run = (id: string): Run => store.getState().catalog.runs[id]!
const group = () => store.getState().catalog.runGroups[GROUP]!
const noPrepare: GroupFlowHost = { prepare: { start: () => ({ ok: true }) } }
const flow = (host: GroupFlowHost = noPrepare) => groupFlow(store.getState(), group(), m, host)
const current = () => groupFlowState(store.getState(), group()).current

function editRun(id: string, patch: Partial<Run>) {
  store.setState((s) => ({ ...s, catalog: { ...s.catalog, runs: { ...s.catalog.runs, [id]: { ...s.catalog.runs[id]!, ...patch } } } }))
}

/** Panel 2's preparation reads Prepared, so both panels wait at Results. */
function prepareP2() {
  store.setState((s) => {
    const preparations = { ...s.catalog.preparations }
    for (const prep of Object.values(preparations)) if (prep.runId === P2) preparations[prep.id] = { ...prep, state: "prepared", unverified: null }
    return { ...s, catalog: { ...s.catalog, preparations } }
  })
}

describe("run group Proceed fans out over the live panels (§5.2)", () => {
  it("Select saves every panel's draft", async () => {
    const sessionOf = (id: string) => run(id).revisions.at(-1)!.sessions[0]!.sessionId
    expect(removeRunSessions(P1, [sessionOf(P1)]).ok).toBe(true)
    expect(removeRunSessions(P2, [sessionOf(P2)]).ok).toBe(true)
    const revisions = [run(P1).revisions.length, run(P2).revisions.length]
    const select = flow()
    expect(current()).toBe("select")
    expect(select.next).toEqual(groupStepLink(group(), "calibrate"))
    expect(await select.proceed!.run()).toEqual({ ok: true })
    expect([run(P1).draft, run(P2).draft]).toEqual([null, null])
    expect([run(P1).revisions.length, run(P2).revisions.length]).toEqual(revisions.map((n) => n + 1))
    expect(current()).toBe("prepare")
  })

  it("Calibrate records every panel's calibration", async () => {
    editRun(P1, { calibration: [] })
    editRun(P2, { calibration: [] })
    expect(current()).toBe("calibrate")
    expect(await flow().proceed!.run()).toEqual({ ok: true })
    expect(run(P1).calibration.length).toBeGreaterThan(0)
    expect(run(P2).calibration.length).toBeGreaterThan(0)
    expect(current()).toBe("prepare")
  })

  it("Prepare runs the host's Prepare all with its confirm", async () => {
    const start = vi.fn(() => ({ ok: true }) as const)
    const confirm = { title: "Prepare all?", confirm: { label: "Prepare all" } }
    const proceed = flow({ prepare: { start, confirm } }).proceed!
    expect(proceed.confirm).toBe(confirm)
    expect(await proceed.run()).toEqual({ ok: true })
    expect(start).toHaveBeenCalledTimes(1)
  })

  it("Finish all panels finishes every live panel's run, after a confirm listing each panel's run view", async () => {
    prepareP2()
    expect(current()).toBe("results")
    const proceed = flow().proceed!
    expect(proceed.label).toBe("Finish all panels")
    expect(proceed.confirm?.groups?.map((g) => g.label)).toEqual(["Panel 1", "Panel 2"])
    expect(proceed.confirm?.groups?.every((g) => g.rows.length > 0)).toBe(true)
    expect(await proceed.run()).toEqual({ ok: true })
    expect([run(P1).completion, run(P2).completion]).toEqual(["complete", "complete"])
    expect(run(P3).completion).not.toBe("complete")
    const finished = flow()
    expect(finished.proceed).toBeNull()
    expect(finished.steps.find((s) => s.id === "results")?.state).toBe("finished")
  })
})
