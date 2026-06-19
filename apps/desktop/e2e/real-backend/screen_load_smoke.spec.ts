// Feature 037 — Layer-2 screen-load smoke (chromium-real-env project).
//
// Runs against the built frontend with VITE_USE_MOCKS=false (no mock layer).
// This is the one real-env E2E that is verifiable without tauri-driver: it
// proves the app shell boots and renders rather than white-screen-crashing.
// Full UI->IPC->backend round-trips run via the webkit/tauri-driver project
// (CI Stage B / Windows) — see the us*_*.spec.ts journeys.
import { test, expect } from "@playwright/test";

test.describe("real-env shell smoke", () => {
  test("app boots and renders the shell with mocks disabled", async ({ page }) => {
    const errors: string[] = [];
    page.on("pageerror", (e) => errors.push(String(e)));

    await page.goto("/");

    // The document title is set by the app shell regardless of backend data.
    await expect(page).toHaveTitle(/Astro Library Manager/i);

    // The root renders *something* (no blank white-screen crash).
    const body = page.locator("body");
    await expect(body).not.toBeEmpty();

    // No uncaught JS errors during boot.
    expect(errors, `uncaught page errors: ${errors.join("; ")}`).toEqual([]);
  });
});
