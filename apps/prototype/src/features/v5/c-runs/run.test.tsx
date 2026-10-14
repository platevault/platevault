import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeEach, describe, expect, it } from "vitest"
import { fileAt } from "@/domain/disk"
import { createSeed } from "@/domain/seed"
import { fileName, formatBytes } from "@/lib/format"
import { m } from "@/lib/i18n"
import { markFrames } from "@/store/actions/library"
import { SCHEMA_VERSION, store } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { RunPage } from "./run"

// The run page on the demo library: Panel 1 of the IC 5070 mosaic waits at Results; NGC 7000 dual-band Esprit is at Calibrate, not prepared.
const PANEL_RUN = { projectId: "prj_cygnus", runId: "run_ic5070_p1" }
const OSC_RUN = { projectId: "prj_cygnus", runId: "run_ngc_osc" }

beforeEach(() => {
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

/** The run page at one step, inside a router with the run route. */
function renderRun(run: { projectId: string; runId: string }, step: string) {
  const root = createRootRoute()
  const runRoute = createRoute({ getParentRoute: () => root, path: "/projects/$projectId/runs/$runId/$step", component: RunPage })
  const router = createRouter({ routeTree: root.addChildren([runRoute]), history: createMemoryHistory({ initialEntries: [`/projects/${run.projectId}/runs/${run.runId}/${step}`] }) })
  render(<RouterProvider router={router} />)
  return router
}

/** The StepFooter once the route has rendered. */
async function footer(): Promise<HTMLElement> {
  return waitFor(() => {
    const element = document.querySelector<HTMLElement>("[data-step-footer]")
    if (!element) throw new Error("no step footer yet")
    return element
  })
}

describe("Run page: Finish run (C2, §5.4)", () => {
  it("confirms, then reads Results finished with no Proceed", async () => {
    const user = userEvent.setup()
    renderRun(PANEL_RUN, "results")
    await user.click(await within(await footer()).findByRole("button", { name: `${m.stepflow_finish_run()}…` }))
    const dialog = await screen.findByRole("alertdialog", { name: m.stepflow_finish_run_title({ name: store.getState().catalog.runs[PANEL_RUN.runId]!.name }) })
    await user.click(within(dialog).getByRole("button", { name: m.stepflow_finish_run() }))

    expect(store.getState().catalog.runs[PANEL_RUN.runId]!.completion).toBe("complete")
    expect(await screen.findByText(m.stepflow_step_finished({ step: m.step_results() }))).toBeDefined()
    expect(within(await footer()).queryByRole("button", { name: new RegExp(`^(${m.stepflow_proceed()}|${m.stepflow_finish_run()})`) })).toBeNull()
    expect((await footer()).textContent).toContain(m.stepflow_finished_on({ date: "" }).trim())
  })

  /** Opens Finish run's confirm and returns the dialog. */
  async function openFinish(user: ReturnType<typeof userEvent.setup>) {
    renderRun(PANEL_RUN, "results")
    await user.click(await within(await footer()).findByRole("button", { name: `${m.stepflow_finish_run()}…` }))
    return screen.findByRole("alertdialog", { name: m.stepflow_finish_run_title({ name: store.getState().catalog.runs[PANEL_RUN.runId]!.name }) })
  }

  it("lists Products, empty when nothing was accepted, then the Run view it removes", async () => {
    const user = userEvent.setup()
    const dialog = await openFinish(user)
    const groups = within(dialog).getAllByRole("listitem").map((item) => item.textContent ?? "")
    expect(groups[0]).toBe(m.dialog_group({ label: m.run_results_products(), count: 0, size: formatBytes(0) }))
    expect(groups[1]).toContain(m.run_check_mode())
  })

  it("lists each accepted Result under Products: file, folder and size, staying where it is", async () => {
    // Panel 1 with one accepted Result: Run A's Ha master, attributed to the panel run.
    const seed = createSeed("demo")
    const source = seed.catalog.results.res_ngc_ha!
    seed.catalog.results.res_p1_ha = { ...source, id: "res_p1_ha", runId: PANEL_RUN.runId }
    store.replace({ ...seed, schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
    const size = formatBytes(fileAt(seed.disk, source.path)!.sizeBytes)
    const user = userEvent.setup()
    const dialog = await openFinish(user)

    await user.click(within(dialog).getByRole("button", { name: m.dialog_group({ label: m.run_results_products(), count: 1, size }) }))
    const row = within(within(dialog).getByRole("table", { name: m.run_results_products() })).getByRole("row", { name: new RegExp(fileName(source.path)) })
    expect(row.textContent).toContain(source.path.slice(0, source.path.lastIndexOf("/")))
    expect(row.textContent).toContain(m.dialog_to_keep())
    expect(row.textContent).toContain(size)
  })
})

describe("Run page: Inputs changed (C10)", () => {
  it("reads Inputs changed · Refresh on Select and Prepare after a frame is marked Unusable", async () => {
    const frame = store.getState().catalog.runs[OSC_RUN.runId]!.revisions.at(-1)!.included[0]!
    expect(markFrames([frame], "unusable", "/sessions").ok).toBe(true)

    const router = renderRun(OSC_RUN, "select")
    expect(await within(await footer()).findByText(m.flow_inputs_changed())).toBeDefined()
    await router.navigate({ to: "/projects/$projectId/runs/$runId/$step", params: { ...OSC_RUN, step: "prepare" } })
    expect(await within(await footer()).findByText(m.flow_inputs_changed())).toBeDefined()
  })
})
