import { act, render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it } from "vitest"
import { getPreferences, setSystemThemes, setTheme } from "@/app/preferences"
import { DEFAULT_SYSTEM_THEMES, DEFAULT_THEME } from "@/app/themes"
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { m } from "@/lib/i18n"
import { ThemeMenuItems, ThemePicker } from "./theme-picker"

afterEach(() => {
  act(() => {
    setTheme(DEFAULT_THEME)
    setSystemThemes(DEFAULT_SYSTEM_THEMES)
  })
})

// The test setup's matchMedia matches no query: the OS reads as light.
describe("ThemePicker", () => {
  it("Match system offers a dark theme and a light theme and saves each choice", async () => {
    const user = userEvent.setup()
    render(<ThemePicker />)
    await user.click(screen.getByRole("button", { name: m.shell_theme_match_system() }))
    expect(getPreferences().theme).toBe("system")
    expect(screen.queryByRole("radiogroup", { name: m.theme_picker_theme() })).not.toBeInTheDocument()

    const dark = screen.getByRole("radiogroup", { name: m.theme_picker_dark_theme() })
    const light = screen.getByRole("radiogroup", { name: m.theme_picker_light_theme() })
    expect(within(dark).getByRole("radio", { name: "PlateVault Dark" })).toBeChecked()
    expect(within(light).getByRole("radio", { name: "PlateVault Light" })).toBeChecked()
    expect(within(light).queryByRole("radio", { name: "Nord" })).not.toBeInTheDocument()

    await user.click(within(light).getByRole("radio", { name: "Gruvbox Light" }))
    await user.click(within(dark).getByRole("radio", { name: "Nord" }))

    expect(getPreferences()).toMatchObject({ theme: "system", systemThemes: { dark: "nord", light: "gruvbox-light" }, resolvedTheme: "gruvbox-light" })
    expect(document.documentElement.dataset.theme).toBe("gruvbox-light")
    // A light theme leaves the `dark:` variant off; the dark themes turn it on.
    expect(document.documentElement).not.toHaveClass("dark")
    expect(window.localStorage.getItem("platevault.systemTheme.dark")).toBe("nord")
    expect(window.localStorage.getItem("platevault.systemTheme.light")).toBe("gruvbox-light")
  })

  it("Dark and Light keep one theme choice; leaving Match system applies the pair's theme of that mode", async () => {
    const user = userEvent.setup()
    act(() => {
      setSystemThemes({ dark: "dracula", light: "solarized-light" })
      setTheme("system")
    })
    render(<ThemePicker />)

    await user.click(screen.getByRole("button", { name: m.theme_picker_dark() }))
    expect(getPreferences().theme).toBe("dracula")
    const themes = screen.getByRole("radiogroup", { name: m.theme_picker_theme() })
    expect(within(themes).getByRole("radio", { name: "Dracula" })).toBeChecked()
    expect(screen.queryByRole("radiogroup", { name: m.theme_picker_dark_theme() })).not.toBeInTheDocument()

    await user.click(within(themes).getByRole("radio", { name: "Tokyo Night" }))
    expect(getPreferences()).toMatchObject({ theme: "tokyo-night", systemThemes: { dark: "dracula", light: "solarized-light" } })
    expect(document.documentElement.dataset.theme).toBe("tokyo-night")
    expect(document.documentElement).toHaveClass("dark")
  })
})

describe("ThemeMenuItems", () => {
  it("under Match system lists the dark and the light theme as two radio groups", async () => {
    const user = userEvent.setup()
    act(() => setTheme("system"))
    render(
      <DropdownMenu>
        <DropdownMenuTrigger>{m.shell_theme()}</DropdownMenuTrigger>
        <DropdownMenuContent>
          <ThemeMenuItems />
        </DropdownMenuContent>
      </DropdownMenu>,
    )
    await user.click(screen.getByRole("button", { name: m.shell_theme() }))
    const menu = await screen.findByRole("menu")
    expect(within(menu).getByRole("menuitemradio", { name: m.shell_theme_match_system() })).toBeChecked()
    expect(within(menu).getByRole("menuitemradio", { name: "PlateVault Dark" })).toBeChecked()

    await user.click(within(menu).getByRole("menuitemradio", { name: "Catppuccin Latte" }))
    expect(getPreferences()).toMatchObject({ theme: "system", systemThemes: { dark: "platevault-dark", light: "catppuccin-latte" }, resolvedTheme: "catppuccin-latte" })
  })
})
