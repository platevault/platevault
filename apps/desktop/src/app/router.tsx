import {
  createHashHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
} from "@tanstack/react-router";

import { InboxPage } from "../features/inbox/InboxPage";
import { LibraryInventoryPage } from "../features/library/LibraryInventoryPage";
import { ProjectWorkspacePage } from "../features/projects/ProjectWorkspacePage";
import { SettingsPage } from "../features/settings/SettingsPage";
import { FrameworkReviewPage } from "../features/framework-review/FrameworkReviewPage";
import { App } from "./App";

const rootRoute = createRootRoute({
  component: App,
});

const inboxFrameFilters = ["all", "lights", "darks", "bias", "flats", "mixed", "unknown"] as const;
const libraryFrameFilters = inboxFrameFilters;

type InboxRouteFilter = (typeof inboxFrameFilters)[number];
type LibraryRouteFilter = (typeof libraryFrameFilters)[number];

type InboxRouteSearch = {
  frame?: InboxRouteFilter;
  selected?: string;
};

type LibraryRouteSearch = {
  frame?: LibraryRouteFilter;
  selected?: string;
};

function parseSearchString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim().length > 0) {
    return value;
  }

  return undefined;
}

function parseRouteSearchFilter<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  if (allowed.includes(value as T)) {
    return value as T;
  }

  return undefined;
}

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: () => <Navigate to="/inbox" replace />,
});

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/inbox",
  validateSearch: (search: Record<string, unknown>): InboxRouteSearch => ({
    frame: parseRouteSearchFilter(search.frame, inboxFrameFilters),
    selected: parseSearchString(search.selected),
  }),
  component: InboxPage,
});

const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/library",
  validateSearch: (search: Record<string, unknown>): LibraryRouteSearch => ({
    frame: parseRouteSearchFilter(search.frame, libraryFrameFilters),
    selected: parseSearchString(search.selected),
  }),
  component: LibraryInventoryPage,
});

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/projects",
  component: ProjectWorkspacePage,
});

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings",
  component: SettingsPage,
});

const frameworkReviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/framework-review",
  validateSearch: (search: Record<string, unknown>): { page?: string } => ({
    page: typeof search.page === "string" ? search.page : undefined,
  }),
  component: FrameworkReviewPage,
});

const routeTree = rootRoute.addChildren([
  indexRoute,
  inboxRoute,
  libraryRoute,
  projectsRoute,
  settingsRoute,
  frameworkReviewRoute,
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
