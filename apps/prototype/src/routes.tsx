/**
 * Route table (foundation-owned). Every path of HARNESS-V5-IA.md is fixed
 * here; screens provide only their page components, from the stable files
 * listed in HARNESS-V5-IA.md § Foundation contract. Hash history keeps the
 * static build portable (Tauri in production).
 *
 * Search params are loose string maps so screens can add keys without a
 * foundation change. Documented keys: `/projects/$projectId?stage=` (the
 * Project tab: sessions, calibrate, view, output or wrap-up; Wrap up takes
 * `&step=`), `?add=goal` (open Add goal);
 * `/targets?view=planned` (the Planned view), `?night=YYYY-MM-DD` (the night
 * planning values use; tonight when absent or past), `?project=`;
 * `/sessions?duplicates=review` (the Duplicates review over Sessions › Duplicates);
 * `/import?step=` and `/sessions/$sessionId?step=` (the staged Import and
 * intake flows; without `step` the plain view shows).
 */
import { createHashHistory, createRootRoute, createRoute, createRouter, redirect, useSearch } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { DesignSystemPage } from "@/app/design-system-page"
import { AppShell, NotFoundPage, RootLayout, SetupShell } from "@/app/shell"
import { isLibraryEmpty } from "@/domain/library"
import { DuplicatesReview } from "@/features/t1/components/duplicates-review"
import { AboutPage } from "@/features/t1/settings/about-page"
import { HelpPage } from "@/features/t1/settings/help-page"
import { AppearancePage } from "@/features/t1/settings/appearance-page"
import { LocationsPage } from "@/features/t1/settings/locations-page"
import { SettingsLayout } from "@/features/t1/settings/settings-layout"
import { SitesPage } from "@/features/t1/settings/sites-page"
import { TargetLookupPage } from "@/features/t1/settings/target-lookup-page"
import { SetupLanguagePage } from "@/features/t1/setup/setup-language"
import { SetupIndexingPage, SetupLocationsPage, WelcomePage } from "@/features/t1/setup/setup-pages"
import { SettingsApplicationsPage } from "@/features/t4/applications"
import { HomePage } from "@/features/v5/a-home/home"
import { ImportPage } from "@/features/v5/a-home/import"
import { SessionPage } from "@/features/v5/a-home/session"
import { SessionIntakePage } from "@/features/v5/a-home/session-intake"
import { SessionsPage } from "@/features/v5/a-home/sessions"
import { ProjectPage } from "@/features/v5/b-projects/project"
import { ProjectsPage } from "@/features/v5/b-projects/projects"
import { SessionReview } from "@/features/v5/d-review/review"
import { ActivityPage } from "@/features/v5/e-targets-plan-settings/activity"
import { CalibrationPage } from "@/features/v5/e-targets-plan-settings/calibration"
import { CalibrationProcessPage } from "@/features/v5/e-targets-plan-settings/calibration-process"
import { AddFilterToRig, EquipmentSettingsPage } from "@/features/v5/e-targets-plan-settings/settings-equipment"
import { GoalTemplatesSettingsPage } from "@/features/v5/e-targets-plan-settings/settings-goal-templates"
import { MatchingSettingsPage } from "@/features/v5/e-targets-plan-settings/settings-matching"
import { NamingSettingsPage } from "@/features/v5/e-targets-plan-settings/settings-naming"
import { TargetPage } from "@/features/v5/e-targets-plan-settings/target"
import { TargetsPage } from "@/features/v5/e-targets-plan-settings/targets"
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
    // No location yet: start at the Language step. A location but unfinished setup: resume at the setup steps.
    throw redirect({ to: isLibraryEmpty(catalog) ? "/setup/language" : "/setup/locations" })
  },
})

const appLayout = createRoute({ getParentRoute: () => rootRoute, id: "app", component: AppShell })
const setupLayout = createRoute({ getParentRoute: () => rootRoute, id: "setup-shell", component: SetupShell })

function page<TPath extends string>(path: TPath, component: () => ReactNode) {
  return createRoute({ getParentRoute: () => appLayout, path, component, validateSearch: looseSearch })
}

/** A route whose `?step=` shows its staged flow (a StepPage) in place of the plain view. */
function stepFlowOr(Plain: () => ReactNode, Flow: () => ReactNode) {
  return function StepFlowRoute() {
    const { step } = useSearch({ strict: false }) as SearchParams
    return step ? <Flow /> : <Plain />
  }
}

// Onboarding (v4, minimal shell).
const setupLanguageRoute = createRoute({ getParentRoute: () => setupLayout, path: "/setup/language", component: SetupLanguagePage, validateSearch: looseSearch })
const welcomeRoute = createRoute({ getParentRoute: () => setupLayout, path: "/welcome", component: WelcomePage, validateSearch: looseSearch })
const setupLocationsRoute = createRoute({ getParentRoute: () => setupLayout, path: "/setup/locations", component: SetupLocationsPage, validateSearch: looseSearch })
const setupIndexingRoute = createRoute({ getParentRoute: () => setupLayout, path: "/setup/indexing", component: SetupIndexingPage, validateSearch: looseSearch })

// S1 Home is the start page (D-W39); S13 Import is a StepPage at `/import` (`?step=source|preview`).
const homeRoute = page("/", HomePage)
const importRoute = page("/import", ImportPage)

// S2, S3: Projects. S4 New Project is a sheet; the Project's tabs are S3's `?stage=`.
const projectsRoute = page("/projects", ProjectsPage)
const projectRoute = page("/projects/$projectId", ProjectPage)

// S10 Targets. `/plan` (S11, merged into Targets by P-PLAN2) redirects to the Planned view, or a Project-scoped Plan to that Project's Targets.
const targetsRoute = page("/targets", TargetsPage)
const targetRoute = page("/targets/$targetId", TargetPage)
const planRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/plan",
  validateSearch: looseSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/targets", search: { ...search, view: search.project ? undefined : "planned" } })
  },
})

// Library: S12 Sessions (`?step=` is a session's intake flow), S14 Calibration with its process flows; `/storage` (S15, P-STO2) redirects to Settings › Locations. Footer: S17 Activity.
// Its Duplicates facet's review dialog (`?duplicates=review`, P-STO2) is injected here.
const sessionsRoute = page("/sessions", () => <SessionsPage duplicatesReview={DuplicatesReview} />)
// `?step=target|rig|review` is session intake; its Review step body is the review workspace (P4), injected here.
const sessionRoute = page("/sessions/$sessionId", stepFlowOr(SessionPage, () => <SessionIntakePage review={SessionReview} addFilter={AddFilterToRig} />))
const calibrationRoute = page("/calibration", CalibrationPage)
const calibrationProcessRoute = page("/calibration/processes/$processId/$step", CalibrationProcessPage)
const storageRoute = createRoute({
  getParentRoute: () => appLayout,
  path: "/storage",
  beforeLoad: () => {
    throw redirect({ to: "/settings/locations" })
  },
})
const activityRoute = page("/activity", ActivityPage)

// S16 Settings: v4's settled sections plus Equipment, Goal templates, Naming and Help.
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
  settingsChild("matching", MatchingSettingsPage),
  settingsChild("goal-templates", GoalTemplatesSettingsPage),
  settingsChild("naming", NamingSettingsPage),
  settingsChild("sites", SitesPage),
  settingsChild("targets", TargetLookupPage),
  settingsChild("applications", SettingsApplicationsPage),
  settingsChild("about", AboutPage),
  settingsChild("help", HelpPage),
]

// Foundation: design-system reference (not in the source list; palette only).
const designSystemRoute = page("/design-system", DesignSystemPage)

const routeTree = rootRoute.addChildren([
  setupLayout.addChildren([setupLanguageRoute, welcomeRoute, setupLocationsRoute, setupIndexingRoute]),
  appLayout.addChildren([
    homeRoute,
    importRoute,
    projectsRoute,
    projectRoute,
    targetsRoute,
    targetRoute,
    planRoute,
    sessionsRoute,
    sessionRoute,
    calibrationRoute,
    calibrationProcessRoute,
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
