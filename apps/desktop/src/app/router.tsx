import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
} from "@tanstack/react-router";

import { InventoryPage } from "../features/inventory/InventoryPage";
import { InboxPage } from "../features/inbox/InboxPage";
import { ProjectsPage } from "../features/projects/ProjectsPage";
import { PlansListPage } from "../features/plans/PlansListPage";
import { PlanDetailPage } from "../features/plans/PlanDetailPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { WelcomePage } from "../features/welcome/WelcomePage";
import { Shell } from "./Shell";

const rootRoute = createRootRoute({
  component: () => (
    <Shell>
      <Outlet />
    </Shell>
  ),
});

function parseId(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => {
    const completed =
      typeof window !== "undefined" &&
      localStorage.getItem("alm.first-run.completed") === "1";
    return completed ? <Navigate to="/inventory" replace /> : <Navigate to="/welcome" replace />;
  },
});

const welcomeRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/welcome",
  component: WelcomePage,
});

const inventoryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inventory",
  validateSearch: (
    search: Record<string, unknown>,
  ): { id?: string; source?: string; frame?: string; review?: string } => ({
    id: parseId(search.id),
    source: parseId(search.source),
    frame: parseId(search.frame),
    review: parseId(search.review),
  }),
  component: InventoryPage,
});

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  validateSearch: (
    search: Record<string, unknown>,
  ): { id?: string; type?: string; source?: string } => ({
    id: parseId(search.id),
    type: parseId(search.type),
    source: parseId(search.source),
  }),
  component: InboxPage,
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  validateSearch: (
    search: Record<string, unknown>,
  ): { id?: string; lifecycle?: string; tool?: string } => ({
    id: parseId(search.id),
    lifecycle: parseId(search.lifecycle),
    tool: parseId(search.tool),
  }),
  component: ProjectsPage,
});

const plansIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/plans",
  validateSearch: (
    search: Record<string, unknown>,
  ): { state?: string; origin?: string } => ({
    state: parseId(search.state),
    origin: parseId(search.origin),
  }),
  component: PlansListPage,
});

const planDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/plans/$planId",
  component: PlanDetailPage,
});

const settingsRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: () => <Navigate to="/settings/$section" params={{ section: "data-sources" }} replace />,
});

const settingsSectionRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$section",
  component: SettingsPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  welcomeRoute,
  inventoryRoute,
  inboxRoute,
  projectsRoute,
  plansIndexRoute,
  planDetailRoute,
  settingsRedirectRoute,
  settingsSectionRoute,
]);

export const router = createRouter({
  history: createHashHistory(),
  routeTree,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
