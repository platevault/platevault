/**
 * Every story renders inside the providers the shell gives the design-system page, with the toolbar's
 * language and theme applied through the app's own preference store, so an entry reads and looks as it does
 * in the app. The toolbar's labels and choices come from the catalogue and the app's registries.
 */
import "@/index.css"
import type { Decorator, Preview } from "@storybook/react-vite"
import { createMemoryHistory, createRootRoute, createRouter, RouterContextProvider } from "@tanstack/react-router"
import { useLayoutEffect } from "react"
import { setLocale, setTheme, type ThemePreference } from "@/app/preferences"
import { DEFAULT_THEME, isThemeId, THEMES } from "@/app/themes"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { DEFAULT_LOCALE, isLocale, LOCALE_META, LOCALES, m } from "@/lib/i18n"
import { initializeStore } from "@/store"

// The entries read the prototype store, as the design-system page does.
initializeStore()

// The entries' links (blockers, used-by previews) need a router; this one stays on its root.
const router = createRouter({ routeTree: createRootRoute(), history: createMemoryHistory() })

const withPreferences: Decorator = (Story, { globals }) => {
  const locale = isLocale(globals.locale) ? globals.locale : DEFAULT_LOCALE
  const theme: ThemePreference = globals.theme === "system" || isThemeId(globals.theme) ? globals.theme : DEFAULT_THEME
  // Before paint, so a switch never shows a frame in the previous language or theme.
  useLayoutEffect(() => setLocale(locale), [locale])
  useLayoutEffect(() => setTheme(theme), [theme])
  return <Story />
}

// The shell's RootLayout providers that the entries use.
const withShell: Decorator = (Story) => (
  <RouterContextProvider router={router}>
    <TooltipProvider delay={400}>
      <Story />
      <Toaster />
    </TooltipProvider>
  </RouterContextProvider>
)

const preview: Preview = {
  decorators: [withPreferences, withShell],
  initialGlobals: { locale: DEFAULT_LOCALE, theme: DEFAULT_THEME },
  globalTypes: {
    locale: {
      description: m.shell_language(),
      toolbar: {
        title: m.shell_language(),
        icon: "globe",
        items: LOCALES.map((id) => ({ value: id, title: LOCALE_META[id].nativeName })),
        dynamicTitle: true,
      },
    },
    theme: {
      description: m.shell_theme(),
      toolbar: {
        title: m.shell_theme(),
        icon: "paintbrush",
        items: [...THEMES.map(({ id, name }) => ({ value: id, title: name })), { value: "system", title: m.shell_theme_match_system() }],
        dynamicTitle: true,
      },
    },
  },
}

export default preview
