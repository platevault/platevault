import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, within } from "@testing-library/react"
import type { ReactNode } from "react"
import { describe, expect, it, vi } from "vitest"
import type { StepFlow } from "@/components/app/contracts"
import { m } from "@/lib/i18n"
import { StepPage, type StepPageProps } from "./step-page"
import { Workspace } from "./workspace"

const FLOW: StepFlow = {
  steps: [
    { id: "target", label: "Target", state: "finished" },
    { id: "review", label: "Review", state: "current" },
  ],
  current: "review",
  ordered: true,
  proceed: { id: "proceed", label: "Finish review", kind: "primary", run: vi.fn() },
  next: null,
}

/** StepFooter follows links through the router, so the page renders inside one. */
function renderInRouter(node: ReactNode) {
  const router = createRouter({ routeTree: createRootRoute({ component: () => node }), history: createMemoryHistory({ initialEntries: ["/"] }) })
  return render(<RouterProvider router={router} />)
}

async function renderStep(props: Partial<StepPageProps> = {}) {
  renderInRouter(<StepPage title="NGC 7000 · 12 Oct" flow={FLOW} onSelectStep={vi.fn()} step={<div data-testid="body">frames</div>} {...props} />)
  const region = await screen.findByRole("region", { name: "Review" })
  return { region, page: region.closest<HTMLElement>("[data-template='step']")! }
}

describe("StepPage", () => {
  it("fill: the region takes the height between strip and footer, unpadded and without its own scroll", async () => {
    const { region, page } = await renderStep({ fill: true })
    expect(region).toHaveAttribute("data-step-region", "fill")
    // A flex column that takes the rest of the page's column and never scrolls: the body scrolls itself.
    for (const name of ["flex", "flex-col", "flex-1", "min-h-0", "overflow-hidden"]) expect(region).toHaveClass(name)
    expect(region.className).not.toMatch(/(^|\s)(p[xy]?-\S+|space-y-\S+|overflow-y-auto)/)
    expect(page).toHaveClass("flex", "flex-col", "min-h-0", "flex-1")
    // The footer is the page column's last row, after the region: it stays fixed while the body scrolls.
    const footer = page.querySelector<HTMLElement>("[data-step-footer]")!
    expect(footer).toBeInTheDocument()
    expect(region.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(region.contains(footer)).toBe(false)
    expect(within(footer).getByRole("button", { name: "Finish review" })).toBeInTheDocument()
  })

  it("default: the region scrolls, pads and spaces its blocks with the PageBody rhythm", async () => {
    const { region } = await renderStep()
    expect(region).toHaveAttribute("data-step-region", "")
    expect(region).toHaveClass("min-h-0", "flex-1", "overflow-y-auto", "px-5", "py-4", "space-y-5")
  })

  it("views: the tabs sit under the header and the strip, region and footer are the view's panel", async () => {
    const onChange = vi.fn()
    const { region, page } = await renderStep({
      views: { label: "Project views", value: "wrap-up", items: [{ id: "runs", label: "Runs" }, { id: "wrap-up", label: "Wrap up" }], onChange },
    })
    const tabs = within(page).getByRole("tablist", { name: "Project views" })
    expect(within(tabs).getByRole("tab", { name: "Wrap up" })).toHaveAttribute("aria-selected", "true")
    const panel = within(page).getByRole("tabpanel")
    expect(panel).toContainElement(page.querySelector<HTMLElement>("[data-step-footer]"))
    expect(panel).toContainElement(within(page).getByRole("navigation", { name: m.stepflow_steps() }))
    expect(panel).toContainElement(region)
  })
})

describe("StepPage fill with a Workspace", () => {
  it("takes the Workspace's status line into its footer, so the page keeps one footer", async () => {
    vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} })
    const { region, page } = await renderStep({
      fill: true,
      step: <Workspace label="Frames to review" toolbar={{}} list={null} listHeight="full" rowsPx={260} onRowsPx={() => {}} stage={[]} status={["20 shown"]} statusLabel="Review status" />,
    })
    const group = await within(page).findByRole("group", { name: "Review status" })
    expect(group.closest("[data-step-footer]")).not.toBeNull()
    expect(region.querySelector("[data-workspace-status]")).toBeNull()
    vi.unstubAllGlobals()
  })
})
