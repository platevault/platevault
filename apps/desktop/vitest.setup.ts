// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * Vitest setup — wires jest-dom matchers and ensures `isTauriRuntime()`
 * resolves to `false` by default so the dev-mode mock path is exercised
 * (no Tauri bridge is present in jsdom).
 */
import "@testing-library/jest-dom/vitest";

// Node 22+ exposes an experimental `localStorage` global that is `undefined`
// unless --localstorage-file is passed.  This shadows the Storage
// implementation that jsdom injects on `window`, causing
// `window.localStorage` to resolve to `undefined` in vitest's jsdom
// environment.  Fix: if the global is broken, replace it with a minimal
// in-memory Storage so component code that reads/writes localStorage works.
if (typeof window !== "undefined" && typeof window.localStorage === "undefined") {
  const store = new Map<string, string>();
  const storage: Storage = {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
  Object.defineProperty(window, "localStorage", {
    value: storage,
    writable: true,
    configurable: true,
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: storage,
    writable: true,
    configurable: true,
  });
}

// Belt-and-braces: tauri-internals is intentionally not present.
if (typeof window !== "undefined") {
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}

// ── Layout shim for @tanstack/react-virtual ──────────────────────────────────
// jsdom reports every element as 0×0 (no layout engine).  `useVirtualizer`
// measures the scroll element via `getBoundingClientRect()` and reads layout
// properties (`offsetHeight`/`scrollHeight`); with a zero-height viewport it
// would mount only the overscan window, so virtualized lists would render a
// near-empty DOM and break tests that assert on every row.  Give jsdom a
// non-trivial, deterministic viewport + element heights so the virtualizer
// measures a real window and renders the full (small, test-sized) list.
if (typeof window !== "undefined") {
  const VIEWPORT_HEIGHT = 2000;
  const ELEMENT_HEIGHT = 48;

  const originalGetRect = Element.prototype.getBoundingClientRect;
  Element.prototype.getBoundingClientRect = function (this: Element) {
    const rect = originalGetRect.call(this) as DOMRect;
    // Scroll containers (overflow-y) get the tall viewport; rows get a row
    // height.  Heuristic: anything tagged as a scroll element (role list,
    // explicit data-attr, or the known virtual-scroll class names) is treated
    // as the viewport.
    const el = this as HTMLElement;
    const isScrollParent =
      el.dataset?.virtualScroll === "true" ||
      el.classList?.contains("alm-virtual-scroll");
    const height = isScrollParent ? VIEWPORT_HEIGHT : ELEMENT_HEIGHT;
    const width = rect.width || 320;
    return {
      ...rect,
      x: rect.x || 0,
      y: rect.y || 0,
      top: rect.top || 0,
      left: rect.left || 0,
      bottom: height,
      right: width,
      width,
      height,
      toJSON: rect.toJSON?.bind(rect) ?? (() => ({})),
    } as DOMRect;
  };

  // offsetHeight / clientHeight are 0 in jsdom; give scroll containers the
  // viewport height so the virtualizer's initial measurement is non-zero.
  for (const prop of ["offsetHeight", "clientHeight"] as const) {
    Object.defineProperty(HTMLElement.prototype, prop, {
      configurable: true,
      get(this: HTMLElement) {
        const isScrollParent =
          this.dataset?.virtualScroll === "true" ||
          this.classList?.contains("alm-virtual-scroll");
        return isScrollParent ? VIEWPORT_HEIGHT : ELEMENT_HEIGHT;
      },
    });
  }
}
