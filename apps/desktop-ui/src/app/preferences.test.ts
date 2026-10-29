import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { AppearancePreferences, PreferencesView } from "@/api/ipc"

type Shell = typeof globalThis & { isTauri?: boolean }

const stored: AppearancePreferences = {
  theme: { mode: "fixed", theme: "gruvbox-light" },
  systemThemes: { dark: "dracula", light: "solarized-light" },
  language: "pt-BR",
  singleKeyShortcuts: false,
}

/** A fresh preferences module, as a page load reads it. */
async function load() {
  return import("./preferences")
}

function inShell(answer: (command: string, args: unknown) => unknown): [string, unknown][] {
  const calls: [string, unknown][] = []
  ;(globalThis as Shell).isTauri = true
  mockIPC((command, args) => {
    calls.push([command, args])
    return answer(command, args)
  })
  return calls
}

const view = (preferences: AppearancePreferences): PreferencesView => ({ preferences, fallbacks: [] })

beforeEach(() => {
  vi.resetModules()
  window.localStorage.clear()
})

afterEach(() => {
  delete window.__PLATEVAULT_PREFERENCES__
  delete (globalThis as Shell).isTauri
  clearMocks()
})

// The test setup's matchMedia matches no query: the OS reads as light.
describe("preferences", () => {
  it("paints the preferences the shell handed over before anything renders", async () => {
    window.__PLATEVAULT_PREFERENCES__ = view(stored)
    const { getPreferences } = await load()

    expect(getPreferences()).toEqual({
      theme: "gruvbox-light",
      resolvedTheme: "gruvbox-light",
      systemThemes: { dark: "dracula", light: "solarized-light" },
      scheme: "light",
      locale: "pt-BR",
      singleKeyShortcuts: false,
    })
    const root = document.documentElement
    expect(root.dataset.theme).toBe("gruvbox-light")
    expect(root).not.toHaveClass("dark")
    expect(root.lang).toBe("pt-BR")
  })

  it("follows the handed values up with the store's own read", async () => {
    window.__PLATEVAULT_PREFERENCES__ = view(stored)
    const calls = inShell(() => view({ ...stored, theme: { mode: "system" } }))
    const { getPreferences } = await load()

    await vi.waitFor(() => expect(getPreferences().theme).toBe("system"))
    expect(getPreferences().resolvedTheme).toBe("solarized-light")
    expect(calls.map(([command]) => command)).toEqual(["library_preferences"])
  })

  it("keeps a change made before the store's read returns", async () => {
    let answer: (value: PreferencesView) => void = () => {}
    const calls = inShell((command) =>
      command === "library_preferences" ? new Promise<PreferencesView>((resolve) => (answer = resolve)) : view(stored),
    )
    const { getPreferences, setTheme } = await load()

    setTheme("nord")
    answer(view(stored))
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(getPreferences().theme).toBe("nord")
    expect(calls[1]).toEqual(["library_change_preference", { change: { field: "theme", choice: { mode: "fixed", theme: "nord" } } }])
  })

  it("saves each change to the settings store in order, and nothing to the webview's storage", async () => {
    const calls = inShell(() => view(stored))
    const { getPreferences, setLocale, setSingleKeyShortcuts, setSystemThemes, setTheme } = await load()

    setTheme("system")
    setSystemThemes({ dark: "tokyo-night", light: "catppuccin-latte" })
    setLocale("pt-BR")
    setSingleKeyShortcuts(false)

    expect(getPreferences()).toMatchObject({ theme: "system", resolvedTheme: "catppuccin-latte", locale: "pt-BR", singleKeyShortcuts: false })
    await vi.waitFor(() => expect(calls).toHaveLength(5))
    expect(calls.slice(1).map(([, args]) => (args as { change: unknown }).change)).toEqual([
      { field: "theme", choice: { mode: "system" } },
      { field: "systemThemes", themes: { dark: "tokyo-night", light: "catppuccin-latte" } },
      { field: "language", language: "pt-BR" },
      { field: "singleKeyShortcuts", enabled: false },
    ])
    expect(window.localStorage).toHaveLength(0)
  })

  it("Restore defaults returns PlateVault Dark, the PlateVault pair, English (UK) and shortcuts on", async () => {
    window.__PLATEVAULT_PREFERENCES__ = view({ ...stored, theme: { mode: "system" } })
    const calls = inShell(() => view(stored))
    const { getPreferences, restoreDefaultPreferences } = await load()
    await vi.waitFor(() => expect(calls).toHaveLength(1))

    restoreDefaultPreferences()

    expect(getPreferences()).toEqual({
      theme: "platevault-dark",
      resolvedTheme: "platevault-dark",
      systemThemes: { dark: "platevault-dark", light: "platevault-light" },
      scheme: "dark",
      locale: "en-GB",
      singleKeyShortcuts: true,
    })
    expect(document.documentElement).toHaveClass("dark")
    await vi.waitFor(() => expect(calls).toHaveLength(2))
    expect(calls[1]?.[0]).toBe("library_restore_default_preferences")
  })

  it("outside the desktop shell starts from the defaults and calls no store", async () => {
    const calls: string[] = []
    mockIPC((command) => {
      calls.push(command)
    })
    const { getPreferences, setTheme } = await load()

    expect(getPreferences()).toMatchObject({ theme: "platevault-dark", locale: "en-GB", singleKeyShortcuts: true })
    setTheme("nord")
    expect(getPreferences().theme).toBe("nord")
    await Promise.resolve()
    expect(calls).toEqual([])
  })
})
