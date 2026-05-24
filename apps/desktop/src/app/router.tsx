import {
  createHashHistory,
  createRouter,
  createRootRoute,
  createRoute,
  lazyRouteComponent,
} from '@tanstack/react-router';
import { Shell } from './Shell';

// Root route — Shell wraps all pages via Outlet
const rootRoute = createRootRoute({
  component: Shell,
});

// --- Sessions (default landing) ---

const sessionsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sessions',
  component: lazyRouteComponent(
    () => import('@/features/sessions/SessionsPage'),
    'SessionsPage',
  ),
});

const sessionDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/sessions/$id',
  component: lazyRouteComponent(
    () => import('@/features/sessions/SessionDetail'),
    'SessionDetail',
  ),
});

// --- Review ---

const reviewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/review',
  component: lazyRouteComponent(
    () => import('@/features/review/ReviewPage'),
    'ReviewPage',
  ),
});

// --- Calibration ---

const calibrationRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calibration',
  component: lazyRouteComponent(
    () => import('@/features/calibration/CalibrationPage'),
    'CalibrationPage',
  ),
});

const calibrationDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calibration/$id',
  component: lazyRouteComponent(
    () => import('@/features/calibration/CalibrationDetail'),
    'CalibrationDetail',
  ),
});

// --- Targets ---

const targetsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/targets',
  component: lazyRouteComponent(
    () => import('@/features/targets/TargetsPage'),
    'TargetsPage',
  ),
});

const targetDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/targets/$id',
  component: lazyRouteComponent(
    () => import('@/features/targets/TargetDetail'),
    'TargetDetail',
  ),
});

// --- Projects ---

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: lazyRouteComponent(
    () => import('@/features/projects/ProjectsPage'),
    'ProjectsPage',
  ),
});

const projectDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$id',
  component: lazyRouteComponent(
    () => import('@/features/projects/ProjectDetail'),
    'ProjectDetail',
  ),
});

const projectArtifactsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$id/artifacts',
  component: lazyRouteComponent(
    () => import('@/features/projects/ArtifactsPage'),
    'ArtifactsPage',
  ),
});

const projectNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/new',
  component: lazyRouteComponent(
    () => import('@/features/projects/wizard/WizardPage'),
    'WizardPage',
  ),
});

// --- Plans ---

const plansRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/plans',
  component: lazyRouteComponent(
    () => import('@/features/plans/PlansPage'),
    'PlansPage',
  ),
});

const planDetailRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/plans/$id',
  component: lazyRouteComponent(
    () => import('@/features/plans/PlanReview'),
    'PlanReview',
  ),
});

// --- Audit ---

const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit',
  component: lazyRouteComponent(
    () => import('@/features/audit/AuditPage'),
    'AuditPage',
  ),
});

// --- Settings ---

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: lazyRouteComponent(
    () => import('@/features/settings/SettingsPage'),
    'SettingsPage',
  ),
});

const settingsPaneRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings/$pane',
  component: lazyRouteComponent(
    () => import('@/features/settings/SettingsPage'),
    'SettingsPage',
  ),
});

// --- Setup ---

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  component: lazyRouteComponent(
    () => import('@/features/setup/SetupPage'),
    'SetupPage',
  ),
});

// --- Index redirect ---

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: lazyRouteComponent(
    () => import('@/features/sessions/SessionsPage'),
    'SessionsPage',
  ),
});

// --- Route tree ---

const routeTree = rootRoute.addChildren([
  indexRoute,
  sessionsRoute,
  sessionDetailRoute,
  reviewRoute,
  calibrationRoute,
  calibrationDetailRoute,
  targetsRoute,
  targetDetailRoute,
  projectNewRoute, // Must come before $id to avoid param collision
  projectsRoute,
  projectDetailRoute,
  projectArtifactsRoute,
  plansRoute,
  planDetailRoute,
  auditRoute,
  settingsRoute,
  settingsPaneRoute,
  setupRoute,
]);

// --- Router instance ---

const hashHistory = createHashHistory();

export const router = createRouter({
  routeTree,
  history: hashHistory,
  defaultPreload: 'intent',
});

// Type registration for TanStack Router
declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
