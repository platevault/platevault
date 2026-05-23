/**
 * Vitest setup — wires jest-dom matchers and ensures `isTauriRuntime()`
 * resolves to `false` by default so the dev-mode mock path is exercised
 * (no Tauri bridge is present in jsdom).
 */
import "@testing-library/jest-dom/vitest";

// Belt-and-braces: tauri-internals is intentionally not present.
if (typeof window !== "undefined") {
  // @ts-expect-error — testing-only stub
  delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
}
