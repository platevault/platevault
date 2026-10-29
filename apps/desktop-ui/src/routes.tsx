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
 * `/settings/<section>`. The Settings bead also registers a bare `/settings`
 * route (its layout or index): the source-list row and `G ,` open that path.
 * An owning page filters its rows to those with issues on
 * `?issues=with-issues` (the status-bar counters' links).
 *
 * Every app page hangs off the one app window (`AppShell`), and so does the
 * catch-all not-found route, so moving between them never remounts the
 * window or its status bar. Hash history keeps the static build portable
 * inside the Tauri webview. Search params are loose string maps, so a page
 * adds keys without a shell change.
 */
import { type AnyRoute, createHashHistory, createRootRoute, createRoute, createRouter, type RouterHistory } from "@tanstack/react-router"
import { DesignSystemPage } from "@/app/catalogue/design-system-page"
import { AppShell, NotFoundPage, RootLayout, RouteErrorPage, ShellErrorPage } from "@/app/shell"
import { HomePage } from "@/features/library/home-page"
import { ImportPage } from "@/features/library/import-page"
import { SessionPage } from "@/features/library/session-page"
import { SessionsPage } from "@/features/library/sessions-page"
import { SessionReview } from "@/features/review/review-workspace"

export type SearchParams = Record<string, string | undefined>

function looseSearch(search: Record<string, unknown>): SearchParams {
  const out: SearchParams = {}
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") out[key] = value
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value)
  }
  return out
}

/** The shell's root and app-window routes around `pages`, the routes that hang off the window, then the catch-all not-found route. */
function shellRouteTree(pages: (appWindow: AnyRoute) => AnyRoute[]) {
  const root = createRootRoute({ component: RootLayout, errorComponent: ShellErrorPage })
  const appWindow = createRoute({ getParentRoute: () => root, id: "app", component: AppShell, errorComponent: ShellErrorPage, notFoundComponent: NotFoundPage })
  const notFound = createRoute({ getParentRoute: () => appWindow, path: "$", component: NotFoundPage })
  return root.addChildren([appWindow.addChildren([...pages(appWindow), notFound])])
}

/** The shell's router over `pages`; the app passes its built pages, a test its own. */
export function createShellRouter(history: RouterHistory, pages: (appWindow: AnyRoute) => AnyRoute[]) {
  return createRouter({ routeTree: shellRouteTree(pages), history, scrollRestoration: true, defaultErrorComponent: RouteErrorPage })
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
  ]
}

/** The app's router; tests pass a memory history. */
export function createAppRouter(history: RouterHistory = createHashHistory()) {
  return createShellRouter(history, appPages)
}

export type AppRouter = ReturnType<typeof createAppRouter>
