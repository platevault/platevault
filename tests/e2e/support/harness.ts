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

import { test as base, expect, type Page } from "@playwright/test";

/**
 * Install the minimal `window.__TAURI_INTERNALS__.transformCallback` the
 * `@tauri-apps/api/core` `Channel` constructor requires. Runs as an init script
 * so it is present before any app module (or navigation) evaluates.
 */
export async function installTauriChannelPolyfill(page: Page): Promise<void> {
  await page.addInitScript(() => {
    // Preserve any pre-existing internals object; only supply the one method.
    const w = window as unknown as {
      __TAURI_INTERNALS__?: { transformCallback?: (cb: unknown, once?: boolean) => number };
    };
    let nextCallbackId = 1;
    const existing = w.__TAURI_INTERNALS__ ?? {};
    if (typeof existing.transformCallback !== "function") {
      existing.transformCallback = () => nextCallbackId++;
    }
    w.__TAURI_INTERNALS__ = existing;
  });
}

/** Seed first-run as complete so the app lands on real content, not the wizard. */
export function seedSetupComplete(page: Page): void {
  page.addInitScript(() => {
    window.localStorage.setItem(
      "alm-preferences",
      JSON.stringify({ setupCompleted: true }),
    );
  });
}

/**
 * Hide the spec-010 guided-tour joyride portal. It is explicitly non-modal
 * (`blockTargetInteraction: false`), so hiding it does not change behavior under
 * test — it only removes an unrelated onboarding overlay whose backdrop can
 * intercept clicks aimed at elements sharing a `data-guide-anchor` selector.
 */
export async function disableGuidedTourOverlay(page: Page): Promise<void> {
  await page.addStyleTag({
    content: "#react-joyride-portal { display: none !important; }",
  });
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
