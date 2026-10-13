import { render, screen, within } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { GATE_WORD, type GateState, runPipeline } from "@/domain/derive"
import { STEP_NAME } from "@/domain/labels"
import { createSeed } from "@/domain/seed"
import { m, say } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { RunStepCatalogue } from "./run-step"

const STEPS = ["select", "review", "calibrate", "prepare", "results", "done"] as const
const STATES: GateState[] = ["done", "ready", "review", "blocked", "running", "partial", "idle"]

function load(seed: "demo" | "empty") {
  store.replace({ ...createSeed(seed), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
}

/** Each step's accessible text in a rail: its name, ": ", its gate word and any status. */
function railSteps(rail: HTMLElement) {
  return within(rail)
    .getAllByRole("listitem")
    .map((item) => item.textContent?.replace(/\s+/g, " ").trim())
}

describe("RunStepCatalogue", () => {
  beforeEach(() => load("demo"))

  it("renders the sample rails with every step name and gate word, and the demo run's own rail", () => {
    render(<RunStepCatalogue />)
    const [full, compact] = screen.getAllByRole("list", { name: m.stepflow_steps() })
    const expected = STEPS.map((id, index) => {
      const status = id === "calibrate" ? ` · ${m.status_partial()}` : ""
      return `${say(m, STEP_NAME[id])}: ${say(m, GATE_WORD[STATES[index % STATES.length]!])}${status}`
    })
    expect(railSteps(full!)).toEqual(expected)
    expect(railSteps(compact!)).toEqual(expected)
    expect(within(full!).getByRole("listitem", { current: "step" })).toHaveTextContent(say(m, STEP_NAME.calibrate))

    const { catalog } = store.getState()
    const run = Object.values(catalog.runs).find((r) => !r.trashedAt)!
    const pipeline = runPipeline(store.getState(), run)
    const live = screen.getByRole("list", { name: m.catalogue_run_step_rail_of({ name: run.name }) })
    expect(within(live).getAllByRole("listitem")).toHaveLength(pipeline.steps.length)
    pipeline.steps.forEach((step, index) => expect(within(live).getAllByRole("listitem")[index]).toHaveTextContent(say(m, STEP_NAME[step.id])))
  })

  it("renders the sample rails alone in an empty library", () => {
    load("empty")
    render(<RunStepCatalogue />)
    expect(screen.getAllByRole("list")).toHaveLength(2)
    expect(screen.getAllByRole("list", { name: m.stepflow_steps() })).toHaveLength(2)
  })
})