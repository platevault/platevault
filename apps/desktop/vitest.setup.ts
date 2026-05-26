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
  // @ts-expect-error — testing-only stub
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}
