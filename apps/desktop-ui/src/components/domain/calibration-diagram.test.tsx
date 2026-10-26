import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import { DIAGRAM_GROUPS, DIAGRAM_MIXED, DIAGRAM_ONE_GROUP, DIAGRAM_PANELS } from "@/app/catalogue/fixtures/calibration"
import { m, say } from "@/lib/i18n"
import { CalibrationDiagram } from "./calibration-diagram"
import { NO_KIND_NAME } from "./calibration-model"

function inRouter(node: ReactNode) {
  const router = createRouter({ routeTree: createRootRoute({ component: () => node }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  return render(<RouterProvider router={router} />)
}

describe("CalibrationDiagram", () => {
  it("holds no control: names are links, No reads as a word, and each group and night is a heading", async () => {
    inRouter(<CalibrationDiagram groups={DIAGRAM_GROUPS} />)
    expect(await screen.findByRole("heading", { level: 3, name: "RedCat 51 / ASI2600MM" })).toBeInTheDocument()
    expect(screen.getByRole("heading", { level: 4, name: /NIGHT_2026-09-18/ })).toBeInTheDocument()
    expect(screen.getByText("GROUP_RedCat-51-ASI2600MM")).toBeInTheDocument()
    expect(screen.getByText(say(m, NO_KIND_NAME.bias))).toBeInTheDocument()
    expect(screen.queryAllByRole("button")).toEqual([])
    expect(screen.queryAllByRole("checkbox")).toEqual([])
    expect(screen.getAllByRole("link").length).toBeGreaterThan(5)
  })

  it("one group: no group folder", async () => {
    inRouter(<CalibrationDiagram groups={DIAGRAM_ONE_GROUP} />)
    expect(await screen.findByRole("heading", { level: 3, name: "FRA400 / ASI2600MM" })).toBeInTheDocument()
    expect(screen.queryByText(/^GROUP_/)).not.toBeInTheDocument()
  })

  it("marks mixed versions on the group and in each night that carries them", async () => {
    inRouter(<CalibrationDiagram groups={DIAGRAM_MIXED} />)
    expect(await screen.findByText(m.calibration_diagram_mixed_darks())).toBeInTheDocument()
    const mixedCells = DIAGRAM_MIXED.flatMap((g) => g.nights.flatMap((n) => n.lights.flatMap((l) => l.calibration.filter((c) => c.mixed))))
    expect(screen.getAllByText(m.calibration_diagram_in_night()).length).toBe(mixedCells.length)
    expect(screen.getByRole("heading", { level: 4, name: /NIGHT_2026-09-20-2/ })).toBeInTheDocument()
  })

  it("marks a mosaic panel group", async () => {
    inRouter(<CalibrationDiagram groups={DIAGRAM_PANELS} />)
    expect(await screen.findByText("PANEL_Panel-1")).toBeInTheDocument()
    expect(screen.getAllByText(m.common_mosaic_panel())).toHaveLength(DIAGRAM_PANELS.length)
  })

  it("previews a master's own version on keyboard focus", async () => {
    const user = userEvent.setup()
    inRouter(<CalibrationDiagram groups={DIAGRAM_ONE_GROUP} />)
    const first = (await screen.findAllByRole("link"))[0]!
    for (let i = 0; i < 10 && !document.activeElement?.closest("[data-diagram-kind]"); i++) await user.tab()
    expect(document.activeElement).not.toBe(first)
    expect(await within(document.body).findByText(m.calibration_version())).toBeInTheDocument()
  })

  it("shows its loading, empty and error states", async () => {
    const onRetry = vi.fn()
    const { unmount } = inRouter(<CalibrationDiagram groups={[]} />)
    expect(await screen.findByText(m.calibration_diagram_empty())).toBeInTheDocument()
    unmount()
    const loading = inRouter(<CalibrationDiagram groups={[]} loading />)
    expect(await screen.findByRole("status")).toHaveTextContent(m.calibration_diagram_loading())
    loading.unmount()
    inRouter(<CalibrationDiagram groups={[]} error={{ message: "Can't read the plan", onRetry }} />)
    await userEvent.setup().click(await screen.findByRole("button", { name: m.verb_retry() }))
    expect(onRetry).toHaveBeenCalledOnce()
  })
})
