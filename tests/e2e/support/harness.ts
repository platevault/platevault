// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Shared Playwright mock-e2e harness (test/support only — NOT product code).
 *
 * Exports a drop-in `test`/`expect` pair that auto-installs a first-party
 * Tauri `Channel` polyfill on every test's page, plus small seed helpers. This
 * REPLACES the per-spec `addInitScript` shims (previously duplicated in
 * `cleanup_review.spec.ts` etc.) with one global init hook.
 *
 * ── Channel polyfill: why it's needed, and how it aligns with `core.isTauri()`
 *
 * Backend-driven apply flows (`plans_apply_real`, and the inbox apply-one path)
 * bridge live progress onto a `@tauri-apps/api/core` `Channel`. `Channel`'s
 * constructor unconditionally calls `window.__TAURI_INTERNALS__.transformCallback`
 * (see `@tauri-apps/api` `core.js`) — a runtime that only exists inside a real
 * Tauri webview. Under the plain Vite dev server this Playwright suite drives,
 * that object is absent, so the constructor throws BEFORE the mock IPC can
 * stream any event and the apply UI shows "…apply failed".
 *
 * The polyfill provides ONLY the one method the `Channel` constructor needs. It
 * deliberately does NOT set `window.isTauri`, which is the field
 * `@tauri-apps/api`'s `core.isTauri()` actually reads
 * (`return !!(globalThis || window).isTauri`). Spec 051 swaps the product-code
 * `__TAURI_INTERNALS__` sniff in `apps/desktop/src/lib/window.ts` for
 * `core.isTauri()`; because this harness leaves `window.isTauri` unset,
 * `core.isTauri()` still correctly returns `false` in the mock env (it is not a
 * real Tauri host), so the polyfill is orthogonal to — and does not reintroduce
 * — any product-code environment sniff. The mock invoke layer is selected by
 * `VITE_USE_MOCKS`, independent of both.
 */

import { test as base, expect, type Page } from '@playwright/test';

/**
 * Install the minimal `window.__TAURI_INTERNALS__.transformCallback` the
 * `@tauri-apps/api/core` `Channel` constructor requires. Runs as an init script
 * so it is present before any app module (or navigation) evaluates.
 */
export async function installTauriChannelPolyfill(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Preserve any pre-existing internals object; only supply the one method.
    const w = window as unknown as {
      __TAURI_INTERNALS__?: {
        transformCallback?: (cb: unknown, once?: boolean) => number;
      };
    };
    let nextCallbackId = 1;
    const existing = w.__TAURI_INTERNALS__ ?? {};
    if (typeof existing.transformCallback !== 'function') {
      existing.transformCallback = () => nextCallbackId++;
    }
    w.__TAURI_INTERNALS__ = existing;
  });
}

/**
 * Seed first-run as complete so the app lands on real content, not the wizard.
 *
 * MERGES into any existing `alm-preferences` rather than replacing it. This
 * runs via `addInitScript`, so it re-executes on EVERY navigation *including
 * reloads* — a wholesale `setItem` therefore silently wiped every other
 * preference each time a spec reloaded the page.
 *
 * That went unnoticed while all cross-reload UI state lived in its own
 * top-level localStorage keys. Once dock placement moved into the typed
 * preferences blob (#1158), it made "persists across a reload" specs fail
 * against a perfectly working app: the seed erased the pin mid-test. Any
 * future preference would have hit the same trap, so merge here rather than
 * special-casing one key.
 *
 * By default this ALSO marks the spec-056 US1 orientation walk done, because
 * seeding setup alone would otherwise auto-launch the modal walk (it navigates
 * to /inbox and dims the page) over every unrelated spec, intercepting its flow.
 * Onboarding stays ENABLED (the checklist still renders — this is not
 * `disableOnboarding`); only the once-per-install walk is suppressed. The one
 * suite that tests the walk itself passes `{ suppressWalk: false }` so the
 * mock's own persisted `orientationDone` governs auto-run (needed for the
 * "never auto-runs after restart" assertion — an unconditional init-script seed
 * would re-clobber the persisted flag on every reload).
 */
export function seedSetupComplete(
  page: Page,
  opts?: { suppressWalk?: boolean },
): void {
  page.addInitScript(() => {
    let existing: Record<string, unknown> = {};
    try {
      const raw = window.localStorage.getItem('alm-preferences');
      if (raw) existing = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      // Corrupt or unreadable value — fall back to seeding a fresh object.
    }
    window.localStorage.setItem(
      'alm-preferences',
      JSON.stringify({ ...existing, setupCompleted: true }),
    );
  });
  if (opts?.suppressWalk !== false) {
    seedOnboarding(page, { flags: { orientationDone: true } });
  }
}

/**
 * Seed onboarding flags and/or settled item states into the mock's
 * `localStorage` persistence store before the app boots. Merges into any
 * existing seed (spread-then-override) so successive calls compose and a
 * mock-persisted flag survives an init-script re-run on reload.
 *
 * The mock (`apps/desktop/src/api/mocks.ts`, `E2E_ONBOARDING_STORE_ID`) hydrates
 * this blob on first read and re-persists on every mutation. Seeding
 * `orientationDone: true` lets a US2+ checklist spec run the checklist WITHOUT
 * the US1 orientation walk auto-launching over it — onboarding stays enabled
 * (unlike `disableOnboarding`, which suppresses the checklist itself).
 */
export function seedOnboarding(
  page: Page,
  seed: {
    flags?: {
      orientationDone?: boolean;
      sectionHidden?: boolean;
      sidebarCollapsed?: boolean;
    };
    items?: Record<string, { state: string; source?: string }>;
  },
): void {
  page.addInitScript((s) => {
    const KEY = 'alm-e2e-onboarding';
    const raw = window.localStorage.getItem(KEY);
    const cur = (raw ? JSON.parse(raw) : {}) as {
      flags?: Record<string, unknown>;
      items?: Record<string, unknown>;
    };
    window.localStorage.setItem(
      KEY,
      JSON.stringify({
        flags: { ...(cur.flags ?? {}), ...(s.flags ?? {}) },
        items: { ...(cur.items ?? {}), ...(s.items ?? {}) },
      }),
    );
  }, seed);
}

/**
 * Seed the given onboarding items as BLOCKED (their prerequisite unmet).
 *
 * The mock defaults every prerequisite to satisfied, because the mock library
 * ships populated and the real backend derives `met` from library milestones
 * rather than checklist state. This opts specific rows into the blocked branch.
 */
export function seedOnboardingUnmet(page: Page, itemIds: string[]): void {
  page.addInitScript((ids) => {
    window.localStorage.setItem(
      'alm-e2e-onboarding-unmet',
      JSON.stringify(ids),
    );
  }, itemIds);
}

/** Make the mock library report zero sessions (`inventory.list` → no sources). */
export function seedEmptyInventory(page: Page): void {
  page.addInitScript(() => {
    window.localStorage.setItem('alm-e2e-empty-inventory', 'true');
  });
}

/**
 * Suppress all spec-056 onboarding surfaces (orientation walk, checklist
 * accordion auto-expand, find-it spotlights) so their overlays never intercept
 * clicks or steal focus from the surface under test.
 *
 * Sets the deterministic suppression flag the onboarding store reads
 * (`isOnboardingSuppressed()` in `apps/desktop/src/features/onboarding/store.ts`,
 * exported as `ONBOARDING_SUPPRESSED_STORE_ID`). Installed as an init script so
 * the flag is present in localStorage before any app module evaluates — the
 * store reads it at launch, so an after-load style/DOM tweak would be too late.
 */
export async function disableOnboarding(page: Page): Promise<void> {
  // Init script: present before the app boots on the next (and every future)
  // navigation — the deterministic pre-boot path (mirrors seedSetupComplete).
  await page.addInitScript(() => {
    window.localStorage.setItem('alm-onboarding-suppressed', 'true');
  });
  // Also set it on the already-loaded origin: the existing call sites invoke
  // this after `page.goto`, and the onboarding store reads the flag live
  // (`isOnboardingSuppressed()`), so writing now suppresses the current page
  // too. A no-op (opaque origin) when called before the first navigation.
  await page
    .evaluate(() => {
      try {
        window.localStorage.setItem('alm-onboarding-suppressed', 'true');
      } catch {
        /* opaque origin (about:blank) — the init script covers this case */
      }
    })
    .catch(() => {
      /* no page context yet — the init script covers this case */
    });
}

/**
 * Dismiss the first-run orientation walk (spec 056 US1) if it auto-launches.
 *
 * On this integrated branch the walk auto-runs whenever `setupCompleted` is true
 * and the mock `orientationDone` flag is false (a fresh mock page), covering the
 * viewport with its modal joyride overlay — which intercepts every click on the
 * checklist / spotlight surfaces that the US2–US5 specs exercise. Escape closes
 * the walk (`dismissKeyAction: 'close'`) and flips the mock `orientationDone`
 * flag, so it stays gone for the rest of the session. No-op if the walk never
 * appears. Callers that started on a non-Inbox route should re-navigate after,
 * since the walk's first stop navigates to `/inbox` before it is dismissed.
 */
export async function dismissOrientationWalk(page: Page): Promise<void> {
  const overlay = page.locator('.react-joyride__overlay');
  try {
    await overlay.waitFor({ state: 'visible', timeout: 6_000 });
  } catch {
    return; // the walk never launched (e.g. onboarding suppressed)
  }
  await page.keyboard.press('Escape');
  await overlay.waitFor({ state: 'detached', timeout: 6_000 }).catch(() => {
    /* best-effort: proceed even if teardown lags */
  });
}

/**
 * Seed first-run complete, navigate to `hash`, and clear the auto-launched
 * orientation walk so the onboarding surfaces under test are interactable.
 *
 * The walk's first stop navigates to `/inbox`, so after dismissal we may be off
 * the requested route; a second navigation returns there (and dismisses the walk
 * again, since reloading resets the mock `orientationDone` flag). `hash` is a
 * hash route like `/#/projects`.
 */
export async function landOnMockRoute(page: Page, hash: string): Promise<void> {
  seedSetupComplete(page);
  await page.goto(hash);
  await dismissOrientationWalk(page);
  const route = hash.replace(/^\/#/, '');
  if (!page.url().includes(route)) {
    await page.goto(hash);
    await dismissOrientationWalk(page);
  }
}

/** Sidebar trigger that opens the Getting-started flyout. */
export const ONB_RING = '.pv-onb-ring';
/** The checklist itself — only in the DOM while the flyout is open. */
export const ONB_SECTION = '.pv-onb-checklist';

/**
 * Open the Getting-started flyout and wait for the checklist inside it.
 *
 * The checklist is NOT inline in the sidebar: `ChecklistPopover` portals it to
 * `document.body`, so `.pv-onb-checklist` does not exist until the ring
 * trigger is clicked. Any spec asserting on checklist content must call this
 * after landing on its route — four spec files failed precisely because they
 * assumed the pre-redesign inline host.
 *
 * Idempotent: the trigger TOGGLES, so this clicks only when `aria-expanded` is
 * not already `"true"`. That matters because several flows (clicking a nav
 * link, reloading) close the flyout as a side effect, and a blind second click
 * would re-close what the caller wanted open.
 */
export async function openChecklist(page: Page): Promise<void> {
  const ring = page.locator(ONB_RING);
  await expect(ring).toBeVisible({ timeout: 8_000 });
  if ((await ring.getAttribute('aria-expanded')) !== 'true') {
    await ring.click();
  }
  await expect(page.locator(ONB_SECTION)).toBeVisible({ timeout: 8_000 });
}

/**
 * Drop-in replacement for `@playwright/test`'s `test`: identical, except every
 * test's `page` has the Tauri `Channel` polyfill installed automatically.
 */
export const test = base.extend({
  page: async ({ page }, use) => {
    await installTauriChannelPolyfill(page);
    await use(page);
  },
});

export { expect };
