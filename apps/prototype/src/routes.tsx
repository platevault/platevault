/**
 * Route table (foundation-owned). Every path of HARNESS-V5-IA.md is fixed
 * here; screens provide only their page components, from the stable files
 * listed in HARNESS-V5-IA.md § Foundation contract. Hash history keeps the
 * static build portable (Tauri in production).
 *
 * Search params are loose string maps so screens can add keys without a
 * foundation change. Documented keys: `/projects/$projectId?start=run`
 * (open Start a run), `?stage=wrap-up` (the Wrap up stage),
 * `?candidates=unreviewed`, `?mosaic=new|<subjectId>` (the mosaic editor);
 * `/projects/$projectId/runs/$runId/review?filter=unreviewed`; `/plan?project=`.
 */
import { createHashHistory, createRootRoute, createRoute, createRouter, redirect } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { DesignSystemPage } from "@/app/design-system-page"
import { AppShell, NotFoundPage, RootLayout, SetupShell } from "@/app/shell"
import { isLibraryEmpty } from "@/domain/library"
import { AboutPage } from "@/features/t1/settings/about-page"
import { AppearancePage } from "@/features/t1/settings/appearance-page"
import { LocationsPage } from "@/features/t1/settings/locations-page"
import { SettingsLayout } from "@/features/t1/settings/settings-layout"
import { SitesPage } from "@/features/t1/settings/sites-page"
import { TargetLookupPage } from "@/features/t1/settings/target-lookup-page"
import { SetupIndexingPage, SetupLocationsPage, WelcomePage } from "@/features/t1/setup/setup-pages"
import { SettingsApplicationsPage } from "@/features/t4/applications"
import { HomePage } from "@/features/v5/a-home/home"
import { ImportRoute } from "@/features/v5/a-home/import"
import { SessionPage } from "@/features/v5/a-home/session"
import { SessionsPage } from "@/features/v5/a-home/sessions"
import { ProjectPage } from "@/features/v5/b-projects/project"
import { ProjectsPage } from "@/features/v5/b-projects/projects"
import { ProjectTrashPage } from "@/features/v5/b-projects/trash"
import { RunGroupPage } from "@/features/v5/c-runs/group"
import { RunPage } from "@/features/v5/c-runs/run"
import { ActivityPage } from "@/features/v5/e-targets-plan-settings/activity"
import { CalibrationPage } from "@/features/v5/e-targets-plan-settings/calibration"
import { PlanPage } from "@/features/v5/e-targets-plan-settings/plan"
import { CalibrationSettingsPage } from "@/features/v5/e-targets-plan-settings/settings-calibration"
import { EquipmentSettingsPage } from "@/features/v5/e-targets-plan-settings/settings-equipment"
import { GoalTemplatesSettingsPage } from "@/features/v5/e-targets-plan-settings/settings-goal-templates"
import { NamingSettingsPage } from "@/features/v5/e-targets-plan-settings/settings-naming"
import { StoragePage } from "@/features/v5/e-targets-plan-settings/storage"
import { TargetPage } from "@/features/v5/e-targets-plan-settings/target"
import { TargetsPage } from "@/features/v5/e-targets-plan-settings/targets"
import { runPipeline } from "@/domain/derive"
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

/** Routes reachable before onboarding completes (first run, and setup resumed after a reload). */
const FIRST_RUN_ALLOWED = ["/welcome", "/setup", "/settings"]

const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFoundPage,
  beforeLoad: ({ location }) => {
    const { catalog, settings } = store.getState()
    if (settings.onboarding.completedAt || FIRST_RUN_ALLOWED.some((prefix) => location.pathname === prefix || location.pathname.startsWith(`${prefix}/`))) return
    // No location yet: start at Welcome. A location but unfinished setup: resume at the setup steps.
    throw redirect({ to: isLibraryEmpty(catalog) ? "/welcome" : "/setup/locations" })
  },
})

const appLayout = createRoute({ getParentRoute: () => rootRoute, id: "app", component: AppShell })
const setupLayout = createRoute({ getParentRoute: () => rootRoute, id: "setup-shell", component: SetupShell })

function page<TPath extends string>(path: TPath, component: () => ReactNode) {
  return createRoute({ getParentRoute: () => appLayout, path, component, validateSearch: looseSearch })
}

// Onboarding (v4, minimal shell).
const welcomeRoute = createRoute({ getParentRoute: () => setupLayout, path: "/welcome", component: WelcomePage, validateSearch: looseSearch })
const setupLocationsRoute = createRoute({ getParentRoute: () => setupLayout, path: "/setup/locations", component: SetupLocationsPage, validateSearch: looseSearch })
const setupIndexingRoute = createRoute({ getParentRoute: () => setupLayout, path: "/setup/indexing", component: SetupIndexingPage, validateSearch: looseSearch })

// S1 Home is the start page (D-W39); S13 Import is a sheet over `/import`.
const homeRoute = page("/", HomePage)
const importRoute = page("/import", ImportRoute)

// S2, S3, S8: Projects. S4 New Project is a sheet; Wrap up is S3's `?stage=wrap-up`.
const projectsRoute = page("/projects", ProjectsPage)
const projectRoute = page("/projects/$projectId", ProjectPage)
const projectTrashRoute = page("/projects/$projectId/trash", ProjectTrashPage)

// S5 Run (S6 Review is its review step) and S7 Run group. A bare run or group opens its current step.
const runIndexRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/projects/$projectId/runs/$runId",
  beforeLoad: ({ params }) => {
    const state = store.getState()
    const run = state.catalog.runs[params.runId]
    const step = run ? runPipeline(state, run).current.id : "select"
    throw redirect({ to: "/projects/$projectId/runs/$runId/$step", params: { ...params, step } })
  },
})
const runRoute = page("/projects/$projectId/runs/$runId/$step", RunPage)
const groupIndexRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/projects/$projectId/groups/$groupId",
  beforeLoad: ({ params }) => {
    throw redirect({ to: "/projects/$projectId/groups/$groupId/$step", params: { ...params, step: "select" } })
  },
})
const groupRoute = page("/projects/$projectId/groups/$groupId/$step", RunGroupPage)

// S10 Targets, S11 Plan.
const targetsRoute = page("/targets", TargetsPage)
const targetRoute = page("/targets/$targetId", TargetPage)
const planRoute = page("/plan", PlanPage)

// Library: S12 Sessions, S14 Calibration, S15 Storage. Footer: S17 Activity.
const sessionsRoute = page("/sessions", SessionsPage)
const sessionRoute = page("/sessions/$sessionId", SessionPage)
const calibrationRoute = page("/calibration", CalibrationPage)
const storageRoute = page("/storage", StoragePage)
const activityRoute = page("/activity", ActivityPage)

// S16 Settings: v4's settled sections plus Equipment, Goal templates and Naming.
const settingsRoute = page("/settings", SettingsLayout)
const settingsIndexRoute = createRoute({
  getParentRoute: () => settingsRoute,
  path: "/",
  beforeLoad: () => {
    throw redirect({ to: "/settings/appearance" })
  },
})
function settingsChild<TPath extends string>(path: TPath, component: () => ReactNode) {
  return createRoute({ getParentRoute: () => settingsRoute, path, component, validateSearch: looseSearch })
}
const settingsChildren = [
  settingsChild("appearance", AppearancePage),
  settingsChild("locations", LocationsPage),
  settingsChild("equipment", EquipmentSettingsPage),
  settingsChild("goal-templates", GoalTemplatesSettingsPage),
  settingsChild("naming", NamingSettingsPage),
  settingsChild("calibration", CalibrationSettingsPage),
  settingsChild("sites", SitesPage),
  settingsChild("targets", TargetLookupPage),
  settingsChild("applications", SettingsApplicationsPage),
  settingsChild("about", AboutPage),
]

// Foundation: design-system reference (not in the source list; palette only).
const designSystemRoute = page("/design-system", DesignSystemPage)

const routeTree = rootRoute.addChildren([
  setupLayout.addChildren([welcomeRoute, setupLocationsRoute, setupIndexingRoute]),
  appLayout.addChildren([
    homeRoute,
    importRoute,
    projectsRoute,
    projectRoute,
    projectTrashRoute,
    runIndexRoute,
    runRoute,
    groupIndexRoute,
    groupRoute,
    targetsRoute,
    targetRoute,
    planRoute,
    sessionsRoute,
    sessionRoute,
    calibrationRoute,
    storageRoute,
    activityRoute,
    settingsRoute.addChildren([settingsIndexRoute, ...settingsChildren]),
    designSystemRoute,
  ]),
])

export const router = createRouter({ routeTree, history: createHashHistory(), scrollRestoration: true })

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router
  }
}
