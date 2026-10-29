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
 * `/settings/<section>`. An owning page filters its rows to those with
 * issues on `?issues=with-issues` (the status-bar counters' links).
 *
 * Hash history keeps the static build portable inside the Tauri webview.
 * Search params are loose string maps, so a page adds keys without a shell
 * change.
 */
import { createHashHistory, createRootRoute, createRoute, createRouter, type RouterHistory } from "@tanstack/react-router"
import { DesignSystemPage } from "@/app/catalogue/design-system-page"
import { AppShell, NotFoundPage, RootLayout, RouteErrorPage, ShellErrorPage } from "@/app/shell"

export type SearchParams = Record<string, string | undefined>

function looseSearch(search: Record<string, unknown>): SearchParams {
  const out: SearchParams = {}
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") out[key] = value
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value)
  }
  return out
}

const rootRoute = createRootRoute({ component: RootLayout, errorComponent: ShellErrorPage, notFoundComponent: NotFoundPage })

const appLayout = createRoute({ getParentRoute: () => rootRoute, id: "app", component: AppShell, errorComponent: ShellErrorPage })

// The design-system reference: the palette lists it, the source list does not.
const designSystemRoute = createRoute({ getParentRoute: () => appLayout, path: "/design-system", component: DesignSystemPage, validateSearch: looseSearch })

const routeTree = rootRoute.addChildren([appLayout.addChildren([designSystemRoute])])

/** The app's router; tests pass a memory history. */
export function createAppRouter(history: RouterHistory = createHashHistory()) {
  return createRouter({ routeTree, history, scrollRestoration: true, defaultErrorComponent: RouteErrorPage })
}

export type AppRouter = ReturnType<typeof createAppRouter>
