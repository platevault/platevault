import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { liveLightSessions, sessionReadiness } from "@/domain/derive"
import { wrapUpFlowState, wrapUpStepLink } from "@/domain/project-view"
import { createSeed } from "@/domain/seed"
import type { Project } from "@/domain/types"
import { m } from "@/lib/i18n"
import { type PrototypeState, SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { sessionIntake, wrapUpFlow, type WrapUpSelection } from "./flows"

// The demo's "M 31 LRGB": Wrap up's Clean up is done, Trash and Archive are still to do.
const M31 = "prj_m31"

let demo: PrototypeState
beforeAll(() => {
  demo = { ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() }
})
beforeEach(() => {
  store.replace(structuredClone(demo))
})

const project = (): Project => store.getState().catalog.projects[M31]!
const nothing: WrapUpSelection = { offered: 0, selected: 0, start: () => [] }
const flow = (selection: WrapUpSelection = nothing) => wrapUpFlow(store.getState(), project(), m, selection)
const stepState = (id: string) => flow().steps.find((s) => s.id === id)?.state

describe("Wrap up as a flow (C3, F2, F4, F5)", () => {
  it("records a step with nothing left as Finished and moves on to the next one", async () => {
    expect(flow().current).toBe("trash")
    const trash = flow()
    expect(trash.next).toEqual(wrapUpStepLink(M31, "archive"))
    expect(await trash.proceed!.run()).toEqual({ ok: true })
    expect(stepState("trash")).toBe("finished")
    expect(flow().current).toBe("archive")
  })

  it("records a step with nothing selected as Skipped, and starts the selection's work otherwise", async () => {
    expect(await flow({ offered: 3, selected: 0, start: () => [] }).proceed!.run()).toEqual({ ok: true })
    expect(stepState("trash")).toBe("skipped")
    expect(await flow().reopen!("trash").run()).toEqual({ ok: true })
    const start = vi.fn(() => ["op_cleanup_m31"])
    const selection: WrapUpSelection = { offered: 3, selected: 2, start, confirm: { title: "Move 2 files to Trash?", confirm: { label: "Move to Trash" } } }
    const proceed = flow(selection).proceed!
    expect(proceed.confirm).toBe(selection.confirm)
    expect(await proceed.run()).toEqual({ ok: true })
    expect(start).toHaveBeenCalledTimes(1)
    // The operation it started has already succeeded, so the step reads Finished (F2).
    expect(stepState("trash")).toBe("finished")
  })

  it("closes the Project with Close project, after which every step is read-only", async () => {
    expect(await flow().proceed!.run()).toEqual({ ok: true })
    const archive = flow()
    expect(archive.current).toBe("archive")
    expect(archive.proceed!.label).toBe(m.stepflow_close_project())
    expect(archive.proceed!.confirm?.title).toBe(m.stepflow_close_project_title({ name: project().name }))
    expect(await archive.proceed!.run()).toEqual({ ok: true })
    expect(project().state).toBe("closed")
    expect(wrapUpFlowState(store.getState(), project()).closed).toBe(true)
    const closed = flow()
    expect(closed.proceed).toBeNull()
    expect(closed.next).toBeNull()
  })

  it("reopens an earlier step until Close; the later settled steps read Redo", async () => {
    expect(await flow().proceed!.run()).toEqual({ ok: true })
    const reopen = flow().reopen!("cleanup")
    expect(reopen.unavailable).toBeUndefined()
    expect(await reopen.run()).toEqual({ ok: true })
    expect(flow().current).toBe("cleanup")
    expect(stepState("trash")).toBe("redo")
  })
})

describe("session intake as a flow (§5.3)", () => {
  it("blocks the Target step until the picker holds a Target", () => {
    const { catalog } = store.getState()
    const session = liveLightSessions(catalog).find((s) => sessionReadiness(catalog, s) === "needs-target")!
    const intake = sessionIntake(store.getState(), session, m, { targetId: null, rigId: null })
    expect(intake.current).toBe("target")
    expect(intake.steps.find((s) => s.id === "target")).toMatchObject({ state: "blocked", gate: { reason: m.flow_confirm_target() } })
    expect(intake.proceed!.run()).toMatchObject({ ok: false, reason: "refused" })
  })
})
