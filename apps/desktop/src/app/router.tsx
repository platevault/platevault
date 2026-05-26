import {
  createHashHistory,
  createRouter,
  createRootRoute,
  createRoute,
  lazyRouteComponent,
  redirect,
  Outlet,
} from '@tanstack/react-router';
import { Shell } from './Shell';
import { getPreferences } from '@/data/preferences';

// Root route — bare Outlet so setup can render without the shell
const rootRoute = createRootRoute({
  component: () => <Outlet />,
});

// Shell layout — wraps all app pages (not setup)
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',
  component: Shell,
});

// --- Sessions (default landing) ---

const sessionsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/sessions',
  component: lazyRouteComponent(
    () => import('@/features/sessions/SessionsPage'),
    'SessionsPage',
  ),
});

const sessionDetailRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/sessions/$id',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/sessions',
      search: { selected: params.id },
    });
  },
});

// --- Review ---

const reviewRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/review',
  component: lazyRouteComponent(
    () => import('@/features/review/ReviewPage'),
    'ReviewPage',
  ),
});

// --- Calibration ---

const calibrationRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/calibration',
  component: lazyRouteComponent(
    () => import('@/features/calibration/CalibrationPage'),
    'CalibrationPage',
  ),
});

const calibrationDetailRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/calibration/$id',
  component: lazyRouteComponent(
    () => import('@/features/calibration/CalibrationDetail'),
    'CalibrationDetail',
  ),
});

// --- Targets ---

const targetsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/targets',
  component: lazyRouteComponent(
    () => import('@/features/targets/TargetsPage'),
    'TargetsPage',
  ),
});

const targetDetailRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/targets/$id',
  component: lazyRouteComponent(
    () => import('@/features/targets/TargetDetail'),
    'TargetDetail',
  ),
});

// --- Projects ---

const projectsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/projects',
  component: lazyRouteComponent(
    () => import('@/features/projects/ProjectsPage'),
    'ProjectsPage',
  ),
});

const projectDetailRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/projects/$id',
  component: lazyRouteComponent(
    () => import('@/features/projects/ProjectDetail'),
    'ProjectDetail',
  ),
});

const projectArtifactsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/projects/$id/artifacts',
  component: lazyRouteComponent(
    () => import('@/features/projects/ArtifactsPage'),
    'ArtifactsPage',
  ),
});

const projectNewRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/projects/new',
  component: lazyRouteComponent(
    () => import('@/features/projects/wizard/WizardPage'),
    'WizardPage',
  ),
});

// --- Plans ---

const plansRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/plans',
  component: lazyRouteComponent(
    () => import('@/features/plans/PlansPage'),
    'PlansPage',
  ),
});

const planDetailRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/plans/$id',
  beforeLoad: ({ params }) => {
    throw redirect({
      to: '/plans',
      search: { selected: params.id },
    });
  },
});

// --- Audit ---

const auditRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/audit',
  component: lazyRouteComponent(
    () => import('@/features/audit/AuditPage'),
    'AuditPage',
  ),
});

// --- Settings ---

const settingsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings',
  component: lazyRouteComponent(
    () => import('@/features/settings/SettingsPage'),
    'SettingsPage',
  ),
});

const settingsPaneRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/settings/$pane',
  component: lazyRouteComponent(
    () => import('@/features/settings/SettingsPage'),
    'SettingsPage',
  ),
});

// --- Setup (standalone, no shell) ---

const setupRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/setup',
  component: lazyRouteComponent(
    () => import('@/features/setup/SetupPage'),
    'SetupPage',
  ),
});

// --- Index redirect (first-run gate) ---

async function checkFirstRunComplete(): Promise<boolean> {
  const prefs = getPreferences();
  if (prefs.setupCompleted) return true;

  const useMocks = import.meta.env.VITE_USE_MOCKS === 'true';
  if (useMocks) return !!prefs.setupCompleted;

  try {
    const { commands } = await import('@/bindings/index');
    const result = await commands.firstrunState();
    if (result.status === 'ok') return result.data.completedAt !== null;
    return !!prefs.setupCompleted;
  } catch {
    return !!prefs.setupCompleted;
  }
}

const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  beforeLoad: async () => {
    const complete = await checkFirstRunComplete();
    if (!complete) {
      throw redirect({ to: '/setup' });
    }
  },
  component: lazyRouteComponent(
    () => import('@/features/sessions/SessionsPage'),
    'SessionsPage',
  ),
});

// --- Route tree ---

const routeTree = rootRoute.addChildren([
  setupRoute,
  shellRoute.addChildren([
    indexRoute,
    sessionsRoute,
    sessionDetailRoute,
    reviewRoute,
    calibrationRoute,
    calibrationDetailRoute,
    targetsRoute,
    targetDetailRoute,
    projectNewRoute,
    projectsRoute,
    projectDetailRoute,
    projectArtifactsRoute,
    plansRoute,
    planDetailRoute,
    auditRoute,
    settingsRoute,
    settingsPaneRoute,
  ]),
]);

// --- Router instance ---

const hashHistory = createHashHistory();

export const router = createRouter({
  routeTree,
  history: hashHistory,
  defaultPreload: 'intent',
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
