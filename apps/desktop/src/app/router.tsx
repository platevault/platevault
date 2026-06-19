import {
  createHashHistory,
  createRouter,
  createRootRoute,
  createRoute,
  lazyRouteComponent,
  redirect,
  Navigate,
  Outlet,
} from '@tanstack/react-router';
import { Shell } from './Shell';
import { checkFirstRunComplete } from './first-run';
import {
  makeValidateSearch,
  parseNumber,
  parseString,
  parseEnum,
  parseCsvEnum,
  FRAME_TYPES,
  INBOX_GROUPS,
  PROJECT_STATES,
  INVENTORY_FRAME_FILTERS,
  REVIEW_FILTERS,
} from '@/lib/route-contract';

/** Parse a path-param id to a number; NaN-safe `selected` search for redirects. */
function selectedSearch(rawId: string): { selected?: number } {
  const id = Number(rawId);
  return Number.isFinite(id) ? { selected: id } : {};
}

/** String `selected` redirect for routes where IDs are UUIDs (e.g. sessions). */
function selectedSearchString(rawId: string): { selected?: string } {
  return rawId && rawId.trim() !== '' ? { selected: rawId.trim() } : {};
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
  validateSearch: makeValidateSearch({
    // Spec 006: session IDs are UUIDs (switched from legacy numeric fixtures).
    selected: parseString,
    // Spec 006 inventory filters — applied server-side by inventory.list.
    sourceFilter: parseEnum(['all'] as const),
    frameFilter: parseEnum(INVENTORY_FRAME_FILTERS),
    reviewFilter: parseEnum(REVIEW_FILTERS),
  }),
  component: lazyRouteComponent(
    () => import('@/features/sessions/SessionsPage'),
    'SessionsPage',
  ),
});

const sessionDetailRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/sessions/$id',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/sessions', search: selectedSearchString(params.id) });
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

// spec 007: calibration IDs are UUIDs from the real backend (switched from
// legacy numeric fixtures). Route search uses parseString.
const calibrationRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/calibration',
  validateSearch: makeValidateSearch({ selected: parseString }),
  component: lazyRouteComponent(
    () => import('@/features/calibration/CalibrationPage'),
    'CalibrationPage',
  ),
});

const calibrationDetailRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/calibration/$id',
  beforeLoad: ({ params }) => {
    throw redirect({ to: '/calibration', search: selectedSearchString(params.id) });
  },
});

// --- Targets ---
//
// spec 023: target IDs are UUIDs (strings), not legacy numeric fixture IDs.
// `selected` uses parseString so Cmd+K navigation (which uses UUID routes like
// /targets/550e8400-...) redirects cleanly to /targets?selected=<uuid>.

const targetsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/targets',
  validateSearch: makeValidateSearch({ selected: parseString }),
  component: lazyRouteComponent(
    () => import('@/features/targets/TargetsPage'),
    'TargetsPage',
  ),
});

const targetDetailRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/targets/$id',
  beforeLoad: ({ params }) => {
    // Redirect deep-link /targets/<uuid> → /targets?selected=<uuid>
    // so Cmd+K target results land on the list+detail view with the right
    // target pre-selected (spec 023 T008).
    throw redirect({ to: '/targets', search: selectedSearchString(params.id) });
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

// --- Developer Contract Diagnostics (spec 021, T075) ---
// Compile-time gate: only registered when VITE_DEV_TOOLS="true".
// Release builds set VITE_DEV_TOOLS="false" (default in vite.config.ts),
// so this import and the entire @/dev/ContractsPage chunk are tree-shaken
// out of the production bundle (T072 / FR-031 / SC-009).
const DEV_TOOLS_ENABLED = import.meta.env.VITE_DEV_TOOLS === 'true';

const devContractsRoute = DEV_TOOLS_ENABLED
  ? createRoute({
      getParentRoute: () => shellRoute,
      path: '/dev/contracts',
      component: lazyRouteComponent(
        () => import('@/dev/ContractsPage'),
        'ContractsPage',
      ),
    })
  : null;

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

const indexRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/',
  beforeLoad: async () => {
    const complete = await checkFirstRunComplete();
    if (!complete) {
      throw redirect({ to: '/setup' });
    }
    // Setup complete: land on the Sessions ledger. We MUST redirect rather than
    // render SessionsPage here — SessionsPage calls useSearch({from:'/shell/sessions'}),
    // which throws an invariant when the active match is the index route ('/shell/').
    throw redirect({ to: '/sessions' });
  },
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
    // Developer Contract Diagnostics (spec 021 / T075): only present in dev-tools builds.
    ...(devContractsRoute ? [devContractsRoute] : []),
  ]),
]);

// --- Router instance ---

const hashHistory = createHashHistory();

export const router = createRouter({
  routeTree,
  history: hashHistory,
  defaultPreload: 'intent',
  // Unknown routes (stale deep links) fall through to the index resolver
  // rather than flashing a blank not-found page (spec 020 US3 / T031).
  defaultNotFoundComponent: () => <Navigate to="/" />,
});

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
