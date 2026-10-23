import { act, render, screen } from "@testing-library/react"
import { useMemo } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_LOCALE, m } from "@/lib/i18n"
import { setLocale, useMessages } from "./preferences"

/** Words its copy once per catalogue, as a page that builds rows or columns in a memo does. */
function MemoisedCopy() {
  const messages = useMessages()
  const label = useMemo(() => messages.verb_cancel(), [messages])
  return <p>{label}</p>
}

describe("useMessages", () => {
  afterEach(() => {
    act(() => setLocale(DEFAULT_LOCALE))
  })

  it("re-words a memo that depends on the catalogue after a language switch", () => {
    render(<MemoisedCopy />)
    expect(screen.getByText(m.verb_cancel({}, { locale: "en-GB" }))).toBeInTheDocument()

    act(() => setLocale("pt-BR"))
    expect(screen.getByText(m.verb_cancel({}, { locale: "pt-BR" }))).toBeInTheDocument()

    act(() => setLocale("en-GB"))
    expect(screen.getByText(m.verb_cancel({}, { locale: "en-GB" }))).toBeInTheDocument()
  })
})

describe("Match system", () => {
  const realMatchMedia = window.matchMedia

  afterEach(() => {
    window.matchMedia = realMatchMedia
    for (const key of ["platevault.theme", "platevault.systemTheme.dark", "platevault.systemTheme.light"]) window.localStorage.removeItem(key)
  })

  /** A fresh preference store over an OS colour scheme the test flips; the store reads both when it loads. */
  async function loadWithOs(dark: boolean) {
    const os = Object.assign(new EventTarget(), { matches: dark, media: "(prefers-color-scheme: dark)", onchange: null, addListener() {}, removeListener() {} })
    window.matchMedia = () => os as unknown as MediaQueryList
    vi.resetModules()
    const preferences = await import("./preferences")
    const flip = (next: boolean) => {
      os.matches = next
      os.dispatchEvent(new Event("change"))
    }
    return { preferences, flip }
  }

  it("reads the saved pair and switches between its themes live as the OS scheme changes", async () => {
    window.localStorage.setItem("platevault.theme", "system")
    window.localStorage.setItem("platevault.systemTheme.dark", "dracula")
    window.localStorage.setItem("platevault.systemTheme.light", "solarized-light")
    const { preferences, flip } = await loadWithOs(false)
    expect(preferences.getPreferences()).toMatchObject({ theme: "system", systemThemes: { dark: "dracula", light: "solarized-light" }, resolvedTheme: "solarized-light", scheme: "light" })

    flip(true)
    expect(preferences.getPreferences()).toMatchObject({ resolvedTheme: "dracula", scheme: "dark" })
    expect(document.documentElement.dataset.theme).toBe("dracula")
    expect(document.documentElement).toHaveClass("dark")

    preferences.setSystemThemes({ dark: "nord", light: "solarized-light" })
    expect(document.documentElement.dataset.theme).toBe("nord")
    flip(false)
    expect(document.documentElement.dataset.theme).toBe("solarized-light")
    expect(document.documentElement).not.toHaveClass("dark")
  })

  it("reads a saved theme of the wrong scheme, or an unknown one, as the PlateVault theme of that scheme", async () => {
    window.localStorage.setItem("platevault.systemTheme.dark", "gruvbox-light")
    window.localStorage.setItem("platevault.systemTheme.light", "not-a-theme")
    const { preferences } = await loadWithOs(true)
    expect(preferences.getPreferences().systemThemes).toEqual({ dark: "platevault-dark", light: "platevault-light" })
  })
})
