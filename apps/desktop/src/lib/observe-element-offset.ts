// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared virtualizer scroll-offset observer with debounce-timer cleanup.
 *
 * Drop-in replacement for `@tanstack/react-virtual`'s default
 * `observeElementOffset`, with one fix: it cancels its debounce fallback
 * timer on unsubscribe.
 *
 * Upstream's fallback (used whenever `scrollend` isn't supported/enabled)
 * debounces via a bare `setTimeout` whose id lives in a private closure with
 * no cancel handle (`@tanstack/virtual-core` `dist/esm/utils.js` `debounce()`
 * — confirmed unfixed through 3.17.5, the latest release as of this writing).
 * The unsubscribe function the library returns only removes the scroll
 * listeners; it never clears that timer. A scroll shortly before unmount
 * therefore leaves a real timer pending that fires later — potentially
 * after the owning test environment has been torn down, which is what
 * produced astro-plan-99u's "ReferenceError: window is not defined" (every
 * test passing, one stray async error failing the whole vitest run).
 */

import type { Virtualizer } from '@tanstack/react-virtual';

const scrollListenerOptions: AddEventListenerOptions = { passive: true };
// jsdom (and any browser without the `scrollend` event) never satisfies this,
// so every test run exercises the debounce fallback path below.
const supportsScrollend =
  typeof window === 'undefined' ? true : 'onscrollend' in window;

export function observeElementOffsetWithCleanup<T extends Element>(
  instance: Virtualizer<T, Element>,
  cb: (offset: number, isScrolling: boolean) => void,
): (() => void) | undefined {
  const element = instance.scrollElement;
  if (!element) return undefined;
  const targetWindow = instance.targetWindow;
  if (!targetWindow) return undefined;

  const registerScrollendEvent =
    instance.options.useScrollendEvent && supportsScrollend;
  let offset = 0;
  // `Window['setTimeout']`, not the bare global — the ambient global
  // `setTimeout` resolves to Node's `NodeJS.Timeout`-returning overload in
  // this project's type graph, which is incompatible with `Window`'s
  // number-returning DOM signature that `targetWindow.setTimeout` actually
  // uses at runtime.
  let fallbackTimeoutId: ReturnType<Window['setTimeout']> | undefined;

  const readOffset = () => {
    const { horizontal, isRtl } = instance.options;
    return horizontal
      ? element.scrollLeft * ((isRtl && -1) || 1)
      : element.scrollTop;
  };

  const scheduleFallback = () => {
    if (fallbackTimeoutId !== undefined) {
      targetWindow.clearTimeout(fallbackTimeoutId);
    }
    fallbackTimeoutId = targetWindow.setTimeout(() => {
      fallbackTimeoutId = undefined;
      cb(offset, false);
    }, instance.options.isScrollingResetDelay);
  };

  const createHandler = (isScrolling: boolean) => () => {
    offset = readOffset();
    if (!registerScrollendEvent) scheduleFallback();
    cb(offset, isScrolling);
  };
  const handler = createHandler(true);
  const endHandler = createHandler(false);

  element.addEventListener('scroll', handler, scrollListenerOptions);
  if (registerScrollendEvent) {
    element.addEventListener('scrollend', endHandler, scrollListenerOptions);
  }

  return () => {
    element.removeEventListener('scroll', handler);
    if (registerScrollendEvent) {
      element.removeEventListener('scrollend', endHandler);
    }
    if (fallbackTimeoutId !== undefined) {
      targetWindow.clearTimeout(fallbackTimeoutId);
      fallbackTimeoutId = undefined;
    }
  };
}
