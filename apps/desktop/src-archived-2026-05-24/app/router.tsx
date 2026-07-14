// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  useRouterState,
} from "@tanstack/react-router";

import { InventoryPage } from "../features/inventory/InventoryPage";
import { InboxPage } from "../features/inbox/InboxPage";
import { ProjectsPage } from "../features/projects/ProjectsPage";
import { ActivityPage } from "../features/activity/ActivityPage";
import { PlanDetailPage } from "../features/plans/PlanDetailPage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { WelcomePage } from "../features/welcome/WelcomePage";
import { Shell } from "./Shell";

const rootRoute = createRootRoute({
  component: () => {
    // The first-run wizard is a fullscreen onboarding experience and must
    // not render inside the Shell chrome (sidebar, breadcrumb, status bar).
    // Otherwise "Restart setup wizard" lands the user on a page that looks
    // like a settings sub-page rather than a fresh wizard.
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    if (pathname === "/welcome") {
      return <Outlet />;
    }
    return (
      <Shell>
        <Outlet />
      </Shell>
    );
  },
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
  ): {
    id?: string;
    source?: string;
    frame?: string;
    states?: string;
    group?: "source" | "target" | "date";
    sort?: string;
  } => ({
    id: parseId(search.id),
    source: parseId(search.source),
    frame: parseId(search.frame),
    states: parseId(search.states),
    group:
      search.group === "target" || search.group === "date" ? (search.group as "target" | "date") : undefined,
    sort: parseId(search.sort),
  }),
  component: InventoryPage,
});

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  validateSearch: (
    search: Record<string, unknown>,
  ): { id?: string; type?: string; source?: string; sort?: string } => ({
    id: parseId(search.id),
    type: parseId(search.type),
    source: parseId(search.source),
    sort: parseId(search.sort),
  }),
  component: InboxPage,
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    id?: string;
    lifecycle?: string;
    tool?: string;
    tab?: "overview" | "sources" | "plans" | "activity";
    sort?: string;
  } => {
    const tab =
      search.tab === "sources" ||
      search.tab === "plans" ||
      search.tab === "activity"
        ? (search.tab as "sources" | "plans" | "activity")
        : undefined;
    return {
      id: parseId(search.id),
      lifecycle: parseId(search.lifecycle),
      tool: parseId(search.tool),
      tab,
      sort: parseId(search.sort),
    };
  },
  component: ProjectsPage,
});

const plansIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/plans",
  component: () => <Navigate to="/activity" replace />,
});

const activityRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/activity",
  validateSearch: (
    search: Record<string, unknown>,
  ): {
    id?: string;
    states?: string;
    origins?: string;
    sort?: string;
  } => ({
    id: parseId(search.id),
    states: parseId(search.states),
    origins: parseId(search.origins),
    sort: parseId(search.sort),
  }),
  component: ActivityPage,
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

// Backward-compat: old "application-log" param → new "audit" section id.
const settingsApplicationLogRedirectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/application-log",
  component: () => <Navigate to="/settings/$section" params={{ section: "audit" }} replace />,
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
  activityRoute,
  planDetailRoute,
  settingsRedirectRoute,
  settingsApplicationLogRedirectRoute,
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
