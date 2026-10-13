/**
 * Every story renders inside the providers the shell gives the design-system page, with the toolbar's
 * language and theme applied through the app's own preference store, so an entry reads and looks as it does
 * in the app. The toolbar's labels and choices come from the catalogue and the app's registries.
 */
import "@/index.css"
import type { Decorator, Preview } from "@storybook/react-vite"
import { createMemoryHistory, createRootRoute, createRouter, RouterProvider } from "@tanstack/react-router"
import { type ComponentType, createContext, useContext, useLayoutEffect, useState } from "react"
import { setLocale, setTheme, type ThemePreference } from "@/app/preferences"
import { DEFAULT_THEME, isThemeId, THEMES } from "@/app/themes"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { DEFAULT_LOCALE, isLocale, LOCALE_META, LOCALES, m } from "@/lib/i18n"
import { initializeStore } from "@/store"

// The entries read the prototype store, as the design-system page does.
initializeStore()

/** The story the router's one route renders: the decorator provides it, so the route always shows the current story. */
const CurrentStory = createContext<ComponentType>(() => null)

function StoryRoute() {
  const Story = useContext(CurrentStory)
  return <Story />
}

/**
 * The entries are written for the design-system page: their links and step flows read and write that page's
 * search params (`useSearch`, `navigate({ to: "/design-system" })`), which needs a matched route. Each story gets
 * its own router on that path, so one story's params never reach the next. Every path renders the story.
 */
function createStoryRouter() {
  return createRouter({ routeTree: createRootRoute({ component: StoryRoute }), history: createMemoryHistory({ initialEntries: ["/design-system"] }) })
}

const withPreferences: Decorator = (Story, { globals }) => {
  const locale = isLocale(globals.locale) ? globals.locale : DEFAULT_LOCALE
  const theme: ThemePreference = globals.theme === "system" || isThemeId(globals.theme) ? globals.theme : DEFAULT_THEME
  // Before paint, so a switch never shows a frame in the previous language or theme.
  useLayoutEffect(() => setLocale(locale), [locale])
  useLayoutEffect(() => setTheme(theme), [theme])
  return <Story />
}

// The shell's RootLayout providers that the entries use.
const withShell: Decorator = (Story) => {
  const [router] = useState(createStoryRouter)
  return (
    <TooltipProvider delay={400}>
      <CurrentStory.Provider value={Story}>
        <RouterProvider router={router} />
      </CurrentStory.Provider>
      <Toaster />
    </TooltipProvider>
  )
}

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
