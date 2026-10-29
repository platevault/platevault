/**
 * The shell's first-frame script (apps/desktop/src-tauri/src/commands/
 * first_frame.js), run as `appearance.rs` calls it: the file's function
 * with a stored view and the registry's dark themes, before the page loads.
 * `appearance.rs` pins how its script calls the function.
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { runInThisContext } from "node:vm"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { AppearancePreferences, PreferencesView } from "@/api/ipc"
import { THEMES } from "./themes"

type PaintFirstFrame = (view: PreferencesView, darkThemes: readonly string[]) => void

/** The file holds one function expression; evaluating it yields that function, and the views go in as arguments. */
const SCRIPT = path.join(import.meta.dirname, "../../../desktop/src-tauri/src/commands/first_frame.js")
const paintFirstFrame = runInThisContext(readFileSync(SCRIPT, "utf8")) as PaintFirstFrame
const DARK = THEMES.filter((theme) => theme.scheme === "dark").map((theme) => theme.id)

const DEFAULTS: AppearancePreferences = {
  theme: { mode: "fixed", theme: "platevault-dark" },
  systemThemes: { dark: "platevault-dark", light: "platevault-light" },
  language: "en-GB",
  singleKeyShortcuts: true,
}

/** Runs the initialization script the shell builds for `view`. */
function runFirstFrame(view: PreferencesView): void {
  paintFirstFrame(view, DARK)
}

/** The OS colour scheme the script reads for Match system. */
function osIsDark(dark: boolean): void {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (media) => Object.assign(new EventTarget(), { matches: dark && media === "(prefers-color-scheme: dark)", media, onchange: null, addListener() {}, removeListener() {} }) as MediaQueryList,
  )
}

function painted(root: HTMLElement = document.documentElement) {
  return { theme: root.dataset.theme, dark: root.classList.contains("dark"), lang: root.lang }
}

const root = document.documentElement
const before = { theme: root.dataset.theme, dark: root.classList.contains("dark"), lang: root.lang }

afterEach(() => {
  vi.restoreAllMocks()
  delete window.__PLATEVAULT_PREFERENCES__
  if (before.theme === undefined) delete root.dataset.theme
  else root.dataset.theme = before.theme
  root.classList.toggle("dark", before.dark)
  root.lang = before.lang
})

describe("first-frame script", () => {
  it("paints a fixed dark theme with its dark class and publishes the view", () => {
    const view: PreferencesView = { preferences: { ...DEFAULTS, theme: { mode: "fixed", theme: "nord" } }, fallbacks: [] }
    runFirstFrame(view)
    expect(painted()).toEqual({ theme: "nord", dark: true, lang: "en-GB" })
    expect(window.__PLATEVAULT_PREFERENCES__).toEqual(view)
  })

  it("Match system paints the pair's theme for the OS scheme", () => {
    const preferences: AppearancePreferences = { ...DEFAULTS, theme: { mode: "system" }, systemThemes: { dark: "dracula", light: "catppuccin-latte" } }
    osIsDark(true)
    runFirstFrame({ preferences, fallbacks: [] })
    expect(painted()).toEqual({ theme: "dracula", dark: true, lang: "en-GB" })

    osIsDark(false)
    runFirstFrame({ preferences, fallbacks: [] })
    expect(painted()).toEqual({ theme: "catppuccin-latte", dark: false, lang: "en-GB" })
  })

  it("sets the stored language", () => {
    runFirstFrame({ preferences: { ...DEFAULTS, theme: { mode: "fixed", theme: "solarized-light" }, language: "pt-BR" }, fallbacks: [] })
    expect(painted()).toEqual({ theme: "solarized-light", dark: false, lang: "pt-BR" })
  })

  it("an unknown stored value paints the default the store read it as, and hands its reason on", () => {
    // The store reads `"theme": "neon"` as PlateVault Dark and records why (core preferences.rs).
    const view: PreferencesView = {
      preferences: DEFAULTS,
      fallbacks: [{ field: "theme", stored: '{"mode":"fixed","theme":"neon"}', reason: "unknown" }],
    }
    runFirstFrame(view)
    expect(painted()).toEqual({ theme: "platevault-dark", dark: true, lang: "en-GB" })
    expect(window.__PLATEVAULT_PREFERENCES__?.fallbacks).toEqual(view.fallbacks)
  })

  it("waits for the root element when the document has none yet", async () => {
    document.removeChild(root)
    const fresh = document.createElement("html")
    try {
      runFirstFrame({ preferences: { ...DEFAULTS, theme: { mode: "fixed", theme: "gruvbox-light" }, language: "pt-BR" }, fallbacks: [] })
      document.appendChild(fresh)
      await vi.waitFor(() => expect(painted(fresh)).toEqual({ theme: "gruvbox-light", dark: false, lang: "pt-BR" }))
    } finally {
      document.replaceChild(root, fresh)
    }
  })
})
