import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { getPreferences, setLocale, setSystemThemes, setTheme } from "@/app/preferences"
import { DEFAULT_SYSTEM_THEMES, DEFAULT_THEME } from "@/app/themes"
import { DEFAULT_LOCALE, m } from "@/lib/i18n"
import { AppearancePage } from "./appearance-page"

function renderPage() {
  const router = createRouter({ routeTree: createRootRoute({ component: AppearancePage }), history: createMemoryHistory({ initialEntries: ["/settings/appearance"] }) })
  return render(<RouterProvider router={router} />)
}

afterEach(() => {
  act(() => {
    setTheme(DEFAULT_THEME)
    setSystemThemes(DEFAULT_SYSTEM_THEMES)
    setLocale(DEFAULT_LOCALE)
  })
})

describe("Settings › Appearance", () => {
  it("shows the language as one select", async () => {
    renderPage()
    expect(await screen.findByRole("combobox", { name: m.shell_language() })).toBeInTheDocument()
    expect(screen.getAllByText(m.shell_language())).toHaveLength(1)
  })

  it("Restore defaults resets the Match system pair as well as the theme and language", async () => {
    const user = userEvent.setup()
    act(() => {
      setTheme("system")
      setSystemThemes({ dark: "nord", light: "gruvbox-light" })
    })
    renderPage()

    await user.click(await screen.findByRole("button", { name: new RegExp(m.settings_restore_defaults()) }))
    const dialog = await screen.findByRole("alertdialog")
    await user.click(within(dialog).getByRole("button", { name: m.settings_restore_defaults() }))

    expect(getPreferences()).toMatchObject({ theme: DEFAULT_THEME, systemThemes: DEFAULT_SYSTEM_THEMES, locale: DEFAULT_LOCALE })
    expect(window.localStorage.getItem("platevault.systemTheme.dark")).toBe(DEFAULT_SYSTEM_THEMES.dark)
    expect(window.localStorage.getItem("platevault.systemTheme.light")).toBe(DEFAULT_SYSTEM_THEMES.light)
  })

  it("Restore defaults is available when only the Match system pair differs", async () => {
    act(() => setSystemThemes({ dark: "nord", light: DEFAULT_SYSTEM_THEMES.light }))
    renderPage()
    expect(await screen.findByRole("button", { name: new RegExp(m.settings_restore_defaults()) })).toBeEnabled()
  })
})
