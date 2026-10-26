/**
 * Runs before each test file: what jsdom lacks and the app reads at import,
 * Testing Library's matchers and cleanup, and the locale every suite renders
 * in. Tests find controls by their catalogue copy (`m.verb_cancel()`), so
 * they hold in any locale.
 */
import "@testing-library/jest-dom/vitest"
import { cleanup } from "@testing-library/react"
import { afterEach } from "vitest"

// jsdom has no matchMedia, and preferences.ts asks for the OS colour scheme at import: no query matches.
window.matchMedia = (media: string): MediaQueryList =>
  Object.assign(new EventTarget(), { matches: false, media, onchange: null, addListener() {}, removeListener() {} }) as MediaQueryList

// After the shim: preferences.ts reads matchMedia when it loads.
const { setLocale } = await import("@/app/preferences")
const { DEFAULT_LOCALE } = await import("@/lib/i18n")
setLocale(DEFAULT_LOCALE)

afterEach(() => {
  cleanup()
})
