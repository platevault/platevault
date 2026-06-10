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
import {
  makeValidateSearch,
  parseNumber,
  parseEnum,
  parseCsvEnum,
  FRAME_TYPES,
  INBOX_GROUPS,
  PROJECT_STATES,
} from '@/lib/route-contract';

/** Parse a path-param id to a number; NaN-safe `selected` search for redirects. */
function selectedSearch(rawId: string): { selected?: number } {
  const id = Number(rawId);
  return Number.isFinite(id) ? { selected: id } : {};
}

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
  validateSearch: makeValidateSearch({ selected: parseNumber }),
  component: lazyRouteComponent(
    () => import('@/features/sessions/SessionsPage'),
    'SessionsPage',
  ),
});

const sessionDetailRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/sessions/$id',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/sessions', search: selectedSearch(params.id) });
  },
});

// --- Inbox (was Review) ---

const inboxRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/inbox',
  validateSearch: makeValidateSearch({
    selected: parseNumber,
    type: parseEnum(FRAME_TYPES),
    group: parseEnum(INBOX_GROUPS),
  }),
  component: lazyRouteComponent(
    () => import('@/features/inbox/InboxPage'),
    'InboxPage',
  ),
});

// --- Calibration ---

const calibrationRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/calibration',
  validateSearch: makeValidateSearch({ selected: parseNumber }),
  component: lazyRouteComponent(
    () => import('@/features/calibration/CalibrationPage'),
    'CalibrationPage',
  ),
});

const calibrationDetailRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/calibration/$id',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/calibration', search: selectedSearch(params.id) });
  },
});

// --- Targets ---

const targetsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/targets',
  validateSearch: makeValidateSearch({ selected: parseNumber }),
  component: lazyRouteComponent(
    () => import('@/features/targets/TargetsPage'),
    'TargetsPage',
  ),
});

const targetDetailRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/targets/$id',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/targets', search: selectedSearch(params.id) });
  },
});

// --- Projects ---

const projectsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/projects',
  validateSearch: makeValidateSearch({
    selected: parseNumber,
    lifecycle: parseCsvEnum(PROJECT_STATES),
  }),
  component: lazyRouteComponent(
    () => import('@/features/projects/ProjectsPage'),
    'ProjectsPage',
  ),
});

const projectDetailRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/projects/$id',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/projects', search: selectedSearch(params.id) });
  },
});

const projectNewRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/projects/new',
  component: lazyRouteComponent(
    () => import('@/features/projects/wizard/WizardPage'),
    'WizardPage',
  ),
});

// --- Archive ---

const archiveRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/archive',
  validateSearch: makeValidateSearch({ selected: parseNumber }),
  component: lazyRouteComponent(
    () => import('@/features/archive/ArchivePage'),
    'ArchivePage',
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
    inboxRoute,
    sessionsRoute,
    sessionDetailRoute,
    calibrationRoute,
    calibrationDetailRoute,
    targetsRoute,
    targetDetailRoute,
    projectNewRoute,
    projectsRoute,
    projectDetailRoute,
    archiveRoute,
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
