/**
 * Route table (foundation-owned). Every path is fixed here and in
 * HIGH-LEVEL-DESIGN.md §5; tracks provide only the page components through
 * `src/features/<track>/routes.tsx`. Hash history keeps the static build
 * portable (Tauri in production).
 *
 * Search params are loose string maps so tracks can add keys without a
 * foundation change; the documented keys are listed in HLD §5.
 */
import { createHashHistory, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { AppShell, NotFoundPage, RootLayout, SetupShell } from "@/app/shell"
import { DesignSystemPage } from "@/app/design-system-page"
import { isLibraryEmpty } from "@/domain/derive"
import { t1Pages } from "@/features/t1/routes"
import { t2Pages } from "@/features/t2/routes"
import { t3Pages } from "@/features/t3/routes"
import { t4Pages } from "@/features/t4/routes"
import { t5Pages } from "@/features/t5/routes"
import { store } from "@/store/core"

export type SearchParams = Record<string, string | undefined>

function looseSearch(search: Record<string, unknown>): SearchParams {
  const out: SearchParams = {}
  for (const [key, value] of Object.entries(search)) {
    if (typeof value === "string") out[key] = value
    else if (typeof value === "number" || typeof value === "boolean") out[key] = String(value)
  }
  return out
}

/** Routes reachable before any location is registered (first run). */
const FIRST_RUN_ALLOWED = ["/welcome", "/setup", "/settings"]

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
  beforeLoad: ({ location }) => {
    const empty = isLibraryEmpty(store.getState().catalog)
    if (empty && !FIRST_RUN_ALLOWED.some((prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`))) {
      throw redirect({ to: "/welcome" })
    }
  },
})

const appLayout = createRoute({ getParentRoute: () => rootRoute, id: "app", component: AppShell })
const setupLayout = createRoute({ getParentRoute: () => rootRoute, id: "setup-shell", component: SetupShell })

function page<TPath extends string>(path: TPath, component: () => ReactNode) {
  return createRoute({ getParentRoute: () => appLayout, path, component, validateSearch: looseSearch })
}

const indexRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/targets" })
  },
})

// T1: onboarding (minimal shell) and Settings.
const welcomeRoute = createRoute({ getParentRoute: () => setupLayout, path: "/welcome", component: t1Pages.welcome, validateSearch: looseSearch })
const setupLocationsRoute = createRoute({ getParentRoute: () => setupLayout, path: "/setup/locations", component: t1Pages.setupLocations, validateSearch: looseSearch })
const setupIndexingRoute = createRoute({ getParentRoute: () => setupLayout, path: "/setup/indexing", component: t1Pages.setupIndexing, validateSearch: looseSearch })

const settingsRoute = page("/settings", t1Pages.settingsLayout)
const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/settings/appearance" })
  },
})
const settingsChildren = [
  createRoute({ getParentRoute: () => settingsRoute, path: "appearance", component: t1Pages.settingsAppearance, validateSearch: looseSearch }),
  createRoute({ getParentRoute: () => settingsRoute, path: "locations", component: t1Pages.settingsLocations, validateSearch: looseSearch }),
  createRoute({ getParentRoute: () => settingsRoute, path: "equipment", component: t1Pages.settingsEquipment, validateSearch: looseSearch }),
  createRoute({ getParentRoute: () => settingsRoute, path: "sites", component: t1Pages.settingsSites, validateSearch: looseSearch }),
  createRoute({ getParentRoute: () => settingsRoute, path: "applications", component: t4Pages.settingsApplications, validateSearch: looseSearch }),
  createRoute({ getParentRoute: () => settingsRoute, path: "about", component: t1Pages.settingsAbout, validateSearch: looseSearch }),
]

// T2: library.
const libraryRoutes = [
  page("/targets", t2Pages.targets),
  page("/targets/$targetId", t2Pages.target),
  page("/sessions", t2Pages.sessions),
  page("/sessions/$sessionId", t2Pages.session),
  page("/projects", t2Pages.projects),
  page("/projects/new", t2Pages.projectNew),
  page("/projects/$projectId", t2Pages.project),
  page("/activity", t2Pages.activity),
]

// T3: Views and the workspace host; T4 and T5 contribute workspace areas.
const viewsRoute = page("/views", t3Pages.views)
const viewNewRoute = page("/views/new", t3Pages.viewNew)
const viewRoute = page("/views/$viewId", t3Pages.viewWorkspace)
const viewIndexRoute = createRoute({
  getParentRoute: () => viewRoute,
  path: "/",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/views/$viewId/sessions", params })
  },
})
const viewChildren = [
  createRoute({ getParentRoute: () => viewRoute, path: "sessions", component: t3Pages.viewSessions, validateSearch: looseSearch }),
  createRoute({ getParentRoute: () => viewRoute, path: "frames", component: t3Pages.viewFrames, validateSearch: looseSearch }),
  createRoute({ getParentRoute: () => viewRoute, path: "refresh", component: t3Pages.viewRefresh, validateSearch: looseSearch }),
  createRoute({ getParentRoute: () => viewRoute, path: "calibration", component: t4Pages.viewCalibration, validateSearch: looseSearch }),
  createRoute({ getParentRoute: () => viewRoute, path: "prepare", component: t4Pages.viewPrepare, validateSearch: looseSearch }),
  createRoute({ getParentRoute: () => viewRoute, path: "results", component: t5Pages.viewResults, validateSearch: looseSearch }),
  createRoute({ getParentRoute: () => viewRoute, path: "cleanup", component: t5Pages.viewCleanup, validateSearch: looseSearch }),
]

// T4: calibration library.
const calibrationRoutes = [page("/calibration", t4Pages.calibration), page("/calibration/$calibrationId", t4Pages.calibrationItem)]

// Foundation: design-system reference (not in the sidebar; palette only).
const designSystemRoute = page("/design-system", DesignSystemPage)

// T5: storage custody and plans.
const custodyRoutes = [
  page("/storage", t5Pages.storage),
  page("/storage/archive", t5Pages.storageArchive),
  page("/storage/filing", t5Pages.storageFiling),
  page("/storage/transfers/$operationId", t5Pages.storageTransfer),
  page("/plans", t5Pages.plans),
  page("/targets/$targetId/plan", t5Pages.targetPlan),
]

const routeTree = rootRoute.addChildren([
  setupLayout.addChildren([welcomeRoute, setupLocationsRoute, setupIndexingRoute]),
  appLayout.addChildren([
    indexRoute,
    settingsRoute.addChildren([settingsIndexRoute, ...settingsChildren]),
    ...libraryRoutes,
    viewsRoute,
    viewNewRoute,
    viewRoute.addChildren([viewIndexRoute, ...viewChildren]),
    ...calibrationRoutes,
    ...custodyRoutes,
    designSystemRoute,
  ]),
])

export const router = createRouter({ routeTree, history: createHashHistory(), scrollRestoration: true })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
