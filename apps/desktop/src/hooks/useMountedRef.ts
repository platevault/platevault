// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * useMountedRef -- a ref that tracks whether the component is still mounted.
 *
 * For guarding `setState` in async callbacks that outlive the component. Use
 * this rather than a per-effect `let cancelled` flag when the async call is
 * also reachable from user actions (refresh, retry, save), because a flag
 * scoped to one effect run cannot reach those call sites.
 *
 * The mount assignment is the load-bearing part. Under React StrictMode in dev,
 * effects run mount -> cleanup -> mount again on the SAME instance, so a ref
 * that is only ever set to `false` by the cleanup latches `false` forever and
 * silently swallows every subsequent response. Re-arming on each mount is what
 * makes the guard correct in dev and production alike.
 */

import { useEffect, useRef, type RefObject } from 'react';

export function useMountedRef(): RefObject<boolean> {
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  return mountedRef;
}
