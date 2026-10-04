// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Opens the real product at a chosen destination, on the sample library.
 *
 * This is the product itself, not a rebuilt copy of it: the same navigation,
 * the same toolbars, the same lists and contextual detail, the same status
 * footer. A reviewer clicking here is exercising what ships.
 *
 * Each opening is independent. The destination is handed to the product as its
 * starting place rather than typed into an address bar, so nothing renders at
 * the wrong destination while the surface settles, and the workbench's own
 * address never changes underneath the reviewer. The sample library is put
 * back to its published starting state first, so a decision recorded in one
 * story is never visible in the next.
 */

import {
  RouterProvider,
  createMemoryHistory,
  createRouter,
} from '@tanstack/react-router';
import { useMemo } from 'react';
import { resetSampleLibrary } from '@/api/mocks';
import { router as productRouter } from '@/app/router';
import { setPreference } from '@/data/preferences';
import {
  setWalkActive,
  stopOnboardingStateSync,
} from '@/features/onboarding/store';

/** Destinations that are only reachable before a library is registered. */
const BEFORE_REGISTRATION: Record<string, true> = { '/setup': true };

export interface AppAtProps {
  /**
   * Where the product opens, e.g. `/inbox` or `/targets?selected=<id>`.
   * `/setup` opens first-run registration, which needs an unregistered
   * library, so that is arranged for it.
   */
  at: string;
  /**
   * Arrive as a first-time user, so the one-time orientation runs over the
   * surface. Default `false`: the sample library is one that has been in use,
   * and a reviewer opening a working surface wants the surface.
   */
  firstTimeHere?: boolean;
}

export function AppAt({ at, firstTimeHere = false }: AppAtProps) {
  // Built during the first render so the starting state is in place before the
  // product reads it — a library marked registered after the first paint would
  // send a reviewer to the registration wizard and straight back out again.
  const router = useMemo(() => {
    resetSampleLibrary({ orientationSeen: !firstTimeHere });
    // Drop what the previously opened surface had already read, so this one
    // reads the restored library rather than the last reviewer's copy of it.
    stopOnboardingStateSync();
    setWalkActive(false);
    setPreference('setupCompleted', BEFORE_REGISTRATION[at] !== true);
    return createRouter({
      routeTree: productRouter.routeTree,
      history: createMemoryHistory({ initialEntries: [at] }),
      defaultPreload: 'intent',
    });
  }, [at, firstTimeHere]);

  return <RouterProvider router={router} />;
}
