import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it } from "vitest"
import { m } from "@/lib/i18n"
import { MasterPreview } from "./previews"

const DARK = { kind: "dark", cameraName: "ZWO ASI2600MM Pro", gain: 100, offset: 50, ccdTempC: -10, exposureS: 300, frameCount: 30 } as const

/** The preview's link goes through the router, so it renders inside one. */
function renderPreview(age: string | null) {
  const node = <MasterPreview label="masterDark_300s.xisf" link={{ to: "/calibration", search: { master: "mst_dark" } }} master={DARK} night="2026-09-14" age={age} usedBy={2} />
  const router = createRouter({ routeTree: createRootRoute({ component: () => node }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(<RouterProvider router={router} />)
}

describe("MasterPreview", () => {
  it("is a link to the master in the Calibration library", async () => {
    renderPreview(null)
    expect(await screen.findByRole("link", { name: "masterDark_300s.xisf" })).toHaveAttribute("href", "/calibration?master=mst_dark")
  })

  it("opens its card on keyboard focus, with the master's facts, its age and its Used by count", async () => {
    const user = userEvent.setup()
    renderPreview(m.flow_master_old({ n: 120 }))
    const link = await screen.findByRole("link", { name: "masterDark_300s.xisf" })
    await user.tab()
    expect(link).toHaveFocus()

    const card = await waitFor(() => {
      const element = document.querySelector<HTMLElement>("[data-preview]")
      if (!element) throw new Error("no card yet")
      return element
    })
    expect(card.textContent).toContain("ZWO ASI2600MM Pro")
    expect(card.textContent).toContain("100 · 50")
    expect(card.textContent).toContain("-10 °C")
    expect(card.textContent).toContain(m.flow_master_old({ n: 120 }))
    expect(card.textContent).toContain(m.calibration_used_by_runs({ count: 2 }))
    // The card holds no controls, so focus stays on the link.
    expect(link).toHaveFocus()
  })
})
