import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { House } from "lucide-react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it } from "vitest"
import { StatusBar } from "@/components/app/status-bar"
import { m } from "@/lib/i18n"
import { AppFrame } from "./app-frame"

/** Renders inside a router: the frame's links and the status bar need one. */
async function inRouter(ui: () => ReactNode) {
  const root = createRootRoute({ component: ui })
  const router = createRouter({ routeTree: root, history: createMemoryHistory({ initialEntries: ["/"] }) })
  render(<RouterProvider router={router} />)
  await screen.findByRole("banner")
}

const sidebar = {
  nav: () => <a href="#/">{m.nav_home()}</a>,
  utilities: () => <a href="#/settings">{m.nav_settings()}</a>,
}

function Frame({ announcement = "" }: { announcement?: string }) {
  return (
    <AppFrame brand={{ name: m.app_name(), icon: House }} sidebar={sidebar} collapsed={false} onToggleCollapsed={() => undefined} toolbar={{}} statusBar={<StatusBar label={m.status_bar()} announcement={announcement} />}>
      <h1>{m.nav_home()}</h1>
    </AppFrame>
  )
}

const realMatchMedia = window.matchMedia

afterEach(() => {
  window.matchMedia = realMatchMedia
})

describe("AppFrame", () => {
  it("has the four landmarks and a skip link that focuses main", async () => {
    const user = userEvent.setup()
    await inRouter(() => <Frame />)
    expect(screen.getByRole("complementary", { name: m.shell_sidebar() })).toBeInTheDocument()
    expect(screen.getByRole("contentinfo", { name: m.status_bar() })).toBeInTheDocument()
    await user.click(screen.getByRole("link", { name: m.shell_skip_to_content() }))
    expect(screen.getByRole("main")).toHaveFocus()
  })

  it("below 768 px opens the source list as a drawer that holds focus and closes on Escape", async () => {
    window.matchMedia = (media: string): MediaQueryList => Object.assign(new EventTarget(), { matches: media.includes("max-width: 767.98px"), media, onchange: null, addListener() {}, removeListener() {} })
    const user = userEvent.setup()
    await inRouter(() => <Frame />)
    expect(screen.queryByRole("complementary")).not.toBeInTheDocument()
    const trigger = screen.getByRole("button", { name: m.shell_navigation_open() })
    await user.click(trigger)
    const drawer = await screen.findByRole("dialog", { name: m.shell_navigation() })
    // A modal sheet: focus moves in, and the rest of the window sits outside the dialog's trap.
    expect(drawer).toHaveAttribute("aria-modal", "true")
    await waitFor(() => expect(drawer).toContainElement(document.activeElement as HTMLElement))
    await user.keyboard("{Escape}")
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument())
    await waitFor(() => expect(trigger).toHaveFocus())
  })
})

describe("StatusBar", () => {
  it("announces a new phase in its polite live region", () => {
    const { rerender } = render(<StatusBar label={m.status_bar()} announcement="" />)
    const region = screen.getByRole("status")
    expect(region).toHaveTextContent("")
    rerender(<StatusBar label={m.status_bar()} announcement={m.status_bar_working()} />)
    expect(region).toHaveTextContent(m.status_bar_working())
  })
})
