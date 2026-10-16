import { createMemoryHistory, createRootRoute, createRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { closeSheet } from "@/app/ui-state"
import { copyToOutputRefusal, outputRows, processingFiles, processingMasters } from "@/domain/project-view"
import { createSeed } from "@/domain/seed"
import type { Project } from "@/domain/types"
import { m, say } from "@/lib/i18n"
import { SCHEMA_VERSION, store } from "@/store/core"
import { hideMasterOffer } from "@/store/actions/project-view"
import { rerunTool } from "@/store/simulation"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { channelOptions } from "./output-step"
import { ProjectPage } from "./project"

const CYGNUS = "prj_cygnus"
const project = (): Project => store.getState().catalog.projects[CYGNUS]!

beforeEach(() => {
  closeSheet()
  store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
})

function renderOutput() {
  const root = createRootRoute()
  const route = createRoute({ getParentRoute: () => root, path: "/projects/$projectId", component: ProjectPage, validateSearch: (s: Record<string, unknown>) => s })
  const router = createRouter({ routeTree: root.addChildren([route]), history: createMemoryHistory({ initialEntries: [`/projects/${CYGNUS}?stage=output`] }) })
  render(<RouterProvider router={router} />)
}

describe("Output (RES-AC-01/02/23-28)", () => {
  const original = globalThis.ResizeObserver
  beforeAll(() => {
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  })
  afterAll(() => {
    globalThis.ResizeObserver = original
  })

  it("lists every file in Output with its relative path, a growing one as Still being written, and no Accept", async () => {
    renderOutput()
    const table = await screen.findByRole("table", { name: m.project_output_of({ name: project().name }) })
    expect(within(table).getByText("NGC7000-HOO-starless.tif")).toBeInTheDocument()
    expect(within(table).getByText(m.store_reason_still_being_written())).toBeInTheDocument()
    expect(screen.queryByRole("button", { name: /accept/i })).toBeNull()
  })

  it("keeps Rescan in More, and shows Loading while it reads Output again", async () => {
    renderOutput()
    const user = userEvent.setup()
    await screen.findByRole("table", { name: m.project_output_of({ name: project().name }) })
    await user.click(screen.getByRole("button", { name: m.common_more() }))
    await user.click(await screen.findByRole("menuitem", { name: m.location_rescan() }))
    expect(await screen.findByRole("table", { name: m.table_loading({ name: m.project_output_of({ name: project().name }) }) })).toBeInTheDocument()
    expect(await screen.findByRole("table", { name: m.project_output_of({ name: project().name }) }, { timeout: 2000 })).toBeInTheDocument()
  })

  it("Copy to Output never overwrites a name Output holds, and a tool rerun leaves Output unchanged", () => {
    const source = processingFiles(store.getState(), project()).find((f) => f.path.endsWith("masterLight_BIN-1_FILTER-Ha.xisf"))!
    expect(say(m, copyToOutputRefusal(store.getState(), project(), source.path, "NGC7000-HOO.tif")!)).toBe(m.output_refused_exists({ name: "NGC7000-HOO.tif" }))
    expect(copyToOutputRefusal(store.getState(), project(), source.path, "NGC7000-Ha-master.xisf")).toBeNull()
    const before = outputRows(store.getState(), project()).rows.map((r) => [r.path, r.file.sha256])
    expect(rerunTool(CYGNUS)).toBe(true)
    expect(outputRows(store.getState(), project()).rows.map((r) => [r.path, r.file.sha256])).toEqual(before)
  })

  it("offers a generated master once per file and digest: a hidden offer is not offered again", () => {
    const flat = processingMasters(store.getState(), project()).find((o) => o.kind === "flat")!
    expect(hideMasterOffer(CYGNUS, flat.file.path).ok).toBe(true)
    expect(processingMasters(store.getState(), project()).some((o) => o.file.path === flat.file.path)).toBe(false)
  })

  it("Channel is a dropdown of the band and OSC channels plus the Project's filters", () => {
    const options = channelOptions(m, ["Ha", "OIII"], "HOO").map((o) => o.value)
    expect(options).toEqual(expect.arrayContaining(["", "L", "Ha", "OIII", "OSC", "HOO"]))
  })
})
