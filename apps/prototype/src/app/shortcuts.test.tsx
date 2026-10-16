import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import { setLocale } from "@/app/preferences"
import { DEFAULT_LOCALE, m } from "@/lib/i18n"
import { ShortcutsDialog, useGlobalShortcuts } from "./shortcuts"
import { closePanel, openPanel } from "./ui-state"

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

/** The keys the `?` dialog lists for the shortcut named `label`. */
function keysOf(label: string): string[] {
  const row = screen.getByRole("rowheader", { name: label }).closest("tr")!
  return Array.from(row.querySelectorAll("[data-slot=kbd]"), (key) => key.textContent ?? "")
}

// P-KBD1: the table keys in the `?` dialog.
describe("ShortcutsDialog", () => {
  afterEach(() => {
    closePanel()
    setLocale(DEFAULT_LOCALE)
  })

  it.each(["en-GB", "pt-BR"] as const)("lists the table row keys in %s: ↑ ↓, Home / End, Page Up / Down, Enter and Space", async (locale) => {
    setLocale(locale)
    openPanel("shortcuts")
    render(<ShortcutsDialog />)
    expect(await screen.findByRole("dialog", { name: m.shortcuts_title({}, { locale }) })).toBeInTheDocument()
    expect(keysOf(m.shortcuts_move_rows({}, { locale }))).toEqual(["↑", "↓"])
    expect(keysOf(m.shortcuts_first_last_row({}, { locale }))).toEqual([m.key_home({}, { locale }), m.key_end({}, { locale })])
    expect(keysOf(m.shortcuts_page_rows({}, { locale }))).toEqual([m.key_page_up({}, { locale }), m.key_page_down({}, { locale })])
    expect(keysOf(m.shortcuts_open_row({}, { locale }))).toEqual(["↩"])
    expect(keysOf(m.shortcuts_select_row({}, { locale }))).toEqual([m.key_space({}, { locale })])
  })
})
