/**
 * The route table (shell-owned). The router alone composes pages: a feature
 * exports its page components and the shell registers them here, so a
 * feature never imports another (I6). Session intake receives the review
 * workspace through `SessionIntakeProps` (app/shell-contract.ts) from this
 * file, never from the review feature.
 *
 * Only built pages are registered. The source list, go-to keys, palette and
 * status-bar links follow the registered routes (app/navigation.ts), so a
 * page lights up its row, key and links by adding its route here. Paths
 * follow HARNESS-V5-IA § Screens: `/`, `/projects`, `/projects/$projectId`,
 * `/targets`, `/targets/$targetId`, `/sessions`, `/sessions/$sessionId`
 * (`?step=` is session intake), `/import`, `/calibration`, `/activity`,
 * `/settings/<section>` and `/setup/<step>`. Bare `/settings` opens the
 * first section: the source-list row and `G ,` open that path.
 * An owning page filters its rows to those with issues on
 * `?issues=with-issues` (the status-bar counters' links).
 *
 * Every app page hangs off the one app window (`AppShell`), and so does the
 * catch-all not-found route, so moving between them never remounts the
 * window or its status bar. First-run setup is the one exception: its step
 * pages hang off the root (`framelessPages`) and draw their own SetupFrame,
 * with no source list, toolbar or status bar. Hash history keeps the static
 * build portable inside the Tauri webview. Search params are loose string
 * maps, so a page adds keys without a shell change.
 */
import { type AnyRoute, createHashHistory, createRootRoute, createRoute, createRouter, redirect, type RouterHistory } from "@tanstack/react-router"
import type { JSX } from "react"
import { DesignSystemPage } from "@/app/catalogue/design-system-page"
import { AppShell, NotFoundPage, RootLayout, RouteErrorPage, ShellErrorPage } from "@/app/shell"
import { HomePage } from "@/features/library/home-page"
import { ImportPage } from "@/features/library/import-page"
import { SessionPage } from "@/features/library/session-page"
import { SessionsPage } from "@/features/library/sessions-page"
import { SessionReview } from "@/features/review/review-workspace"
import { ProjectPage } from "@/features/projects/project-page"
import { ProjectsPage } from "@/features/projects/projects-page"
import { TargetPage } from "@/features/targets/target"
import { TargetsPage } from "@/features/targets/targets"
import { ActivityPage } from "@/features/settings/activity-page"
import { AboutPage } from "@/features/settings/about-page"
import { AppearancePage } from "@/features/settings/appearance-page"
import { ApplicationsPage } from "@/features/settings/applications-page"
import { EquipmentPage } from "@/features/settings/equipment-page"
import { GoalTemplatesPage } from "@/features/settings/goal-templates-page"
import { HelpPage } from "@/features/settings/help-page"
import { SettingsLayout } from "@/features/settings/layout"
import { LocationsPage } from "@/features/settings/locations-page"
import { MatchingPage } from "@/features/settings/matching-page"
import { NamingPage } from "@/features/settings/naming-page"
import { SetupIndexPage, SetupLocationsPage, WelcomePage } from "@/features/settings/setup-pages"
import { SitesPage } from "@/features/settings/sites-page"
import { TargetLookupPage } from "@/features/settings/target-lookup-page"

export type SearchParams = Record<string, string | undefined>

function looseSearch(search: Record<string, unknown>): SearchParams {
  const out: SearchParams = {}
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") out[key] = value
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value)
  }
  return out
}

/** Pages that draw their own frame: they hang off the root, outside the app window. */
type FramelessPages = (root: AnyRoute) => AnyRoute[]

/** The shell's root and app-window routes around `pages`, the routes that hang off the window, then the catch-all not-found route; `frameless` pages hang off the root itself. */
function shellRouteTree(pages: (appWindow: AnyRoute) => AnyRoute[], frameless: FramelessPages) {
  const root = createRootRoute({ component: RootLayout, errorComponent: ShellErrorPage })
  const appWindow = createRoute({ getParentRoute: () => root, id: "app", component: AppShell, errorComponent: ShellErrorPage, notFoundComponent: NotFoundPage })
  const notFound = createRoute({ getParentRoute: () => appWindow, path: "$", component: NotFoundPage })
  return root.addChildren([...frameless(root), appWindow.addChildren([...pages(appWindow), notFound])])
}

/** The shell's router over `pages`; the app passes its built pages, a test its own. */
export function createShellRouter(history: RouterHistory, pages: (appWindow: AnyRoute) => AnyRoute[], frameless: FramelessPages = () => []) {
  return createRouter({ routeTree: shellRouteTree(pages, frameless), history, scrollRestoration: true, defaultErrorComponent: RouteErrorPage })
}

/** Settings: the section list beside the open section; bare `/settings` opens the first section. */
function settingsPages(appWindow: AnyRoute): AnyRoute {
  const settings = createRoute({ getParentRoute: () => appWindow, path: "/settings", component: SettingsLayout, validateSearch: looseSearch })
  const section = (path: string, component: () => JSX.Element) => createRoute({ getParentRoute: () => settings, path, component, validateSearch: looseSearch })
  return settings.addChildren([
    createRoute({ getParentRoute: () => settings, path: "/", beforeLoad: () => { throw redirect({ to: "/settings/appearance", replace: true }) } }),
    section("/appearance", AppearancePage),
    section("/help", HelpPage),
    section("/locations", LocationsPage),
    section("/equipment", EquipmentPage),
    section("/matching", MatchingPage),
    section("/naming", NamingPage),
    section("/sites", SitesPage),
    section("/targets", TargetLookupPage),
    section("/goal-templates", GoalTemplatesPage),
    section("/applications", ApplicationsPage),
    section("/about", AboutPage),
  ])
}

/** First-run setup's step pages (LIB-FR-01, LIB-FR-31): Welcome, Locations and Index, each in its own SetupFrame. */
function setupPages(root: AnyRoute): AnyRoute[] {
  return [
    createRoute({ getParentRoute: () => root, path: "/setup", component: WelcomePage, validateSearch: looseSearch }),
    createRoute({ getParentRoute: () => root, path: "/setup/locations", component: SetupLocationsPage, validateSearch: looseSearch }),
    createRoute({ getParentRoute: () => root, path: "/setup/index", component: SetupIndexPage, validateSearch: looseSearch }),
  ]
}

/** The built pages. */
function appPages(appWindow: AnyRoute): AnyRoute[] {
  return [
    // The design-system reference: the palette lists it, the source list does not.
    createRoute({ getParentRoute: () => appWindow, path: "/design-system", component: DesignSystemPage, validateSearch: looseSearch }),
    createRoute({ getParentRoute: () => appWindow, path: "/", component: HomePage, validateSearch: looseSearch }),
    createRoute({ getParentRoute: () => appWindow, path: "/sessions", component: SessionsPage, validateSearch: looseSearch }),
    createRoute({ getParentRoute: () => appWindow, path: "/sessions/$sessionId", component: () => <SessionPage review={SessionReview} />, validateSearch: looseSearch }),
    createRoute({ getParentRoute: () => appWindow, path: "/import", component: ImportPage, validateSearch: looseSearch }),
    createRoute({ getParentRoute: () => appWindow, path: "/projects", component: ProjectsPage, validateSearch: looseSearch }),
    createRoute({ getParentRoute: () => appWindow, path: "/projects/$projectId", component: ProjectPage, validateSearch: looseSearch }),
    createRoute({ getParentRoute: () => appWindow, path: "/targets", component: TargetsPage, validateSearch: looseSearch }),
    createRoute({ getParentRoute: () => appWindow, path: "/targets/$targetId", component: TargetPage, validateSearch: looseSearch }),
    createRoute({ getParentRoute: () => appWindow, path: "/activity", component: ActivityPage, validateSearch: looseSearch }),
    settingsPages(appWindow),
  ]
}

/** The app's router; tests pass a memory history. */
export function createAppRouter(history: RouterHistory = createHashHistory()) {
  return createShellRouter(history, appPages, setupPages)
}

export type AppRouter = ReturnType<typeof createAppRouter>
