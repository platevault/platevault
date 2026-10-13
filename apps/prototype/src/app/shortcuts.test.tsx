import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { useGlobalShortcuts } from "./shortcuts"

/** A step page on screen, as StepPage renders it: the StepFooter's Proceed is its last action. */
function Page({ proceed, disabled = false }: { proceed: () => void; disabled?: boolean }) {
  useGlobalShortcuts()
  return (
    <main id="main" tabIndex={-1}>
      <div data-template="step">
        <footer data-step-footer="current">
          <button type="button" data-action="skip">
            Skip
          </button>
          <button type="button" data-action="proceed" disabled={disabled} onClick={proceed}>
            Proceed
          </button>
        </footer>
      </div>
    </main>
  )
}

async function mount(ui: () => React.ReactNode) {
  const root = createRootRoute({ component: ui })
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(<RouterProvider router={router} />)
  await screen.findByRole("main")
}

describe("⌘↩", () => {
  it("runs the Proceed of the step page on screen", async () => {
    const user = userEvent.setup()
    const proceed = vi.fn()
    await mount(() => <Page proceed={proceed} />)
    screen.getByRole("main").focus()
    await user.keyboard("{Meta>}{Enter}{/Meta}")
    expect(proceed).toHaveBeenCalledOnce()
    expect(screen.getByRole("button", { name: "Proceed" })).toHaveFocus()
  })

  it("runs nothing while Proceed is unavailable", async () => {
    const user = userEvent.setup()
    const proceed = vi.fn()
    await mount(() => <Page proceed={proceed} disabled />)
    screen.getByRole("main").focus()
    await user.keyboard("{Control>}{Enter}{/Control}")
    expect(proceed).not.toHaveBeenCalled()
  })
})
