// Feature 037 US3 — reusable WebdriverIO + tauri-driver harness.
//
// Extracted from the proven tauri-spike.mjs. Provides:
//   - freshDb():       delete the app DB so a run starts at first-run state.
//   - startHarness():  serve the built `dist` on :5173, spawn tauri-driver,
//                      open a WebdriverIO `remote()` session against the real
//                      Tauri webview, and return { browser, stop }.
//
// The real frontend (served at the Tauri devUrl) talks to the real Tauri
// backend over IPC, so journeys exercise a genuine UI -> IPC -> backend path.
// Must run in CI (e2e.yml) or on a real desktop — a Tauri webview cannot run in
// the WSL dev sandbox.

import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// e2e/wdio -> e2e -> desktop -> apps -> repo root
export const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
export const desktopDir = path.join(repoRoot, "apps", "desktop");

const isWindows = process.platform === "win32";
const exeName = isWindows ? "desktop_shell.exe" : "desktop_shell";

// The binary loads its frontend from the Tauri `devUrl` (Vite at :5173) — even
// release builds here — so we serve the built `dist` there during the run.
// Override with TAURI_APP_BINARY (and FRONTEND_PORT) for local runs.
export const appBinary =
  process.env.TAURI_APP_BINARY ||
  path.join(repoRoot, "target", "debug", exeName);

const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 5173);
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
const DRIVER_PORT = 4444;
const DRIVER_URL = `http://127.0.0.1:${DRIVER_PORT}`;
const STARTUP_TIMEOUT_MS = 30_000;

// Tauri identifier from apps/desktop/src-tauri/tauri.conf.json. The backend
// stores its DB at `app_data_dir()/alm.db` (see src-tauri/src/main.rs).
const APP_IDENTIFIER = "dev.astro-plan.astro-library-manager";

export function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[wdio-e2e] ${msg}`);
}

/** Resolve the platform-specific Tauri `app_data_dir()` for our identifier. */
function appDataDir() {
  const home = os.homedir();
  if (process.platform === "win32") {
    const base = process.env.APPDATA || path.join(home, "AppData", "Roaming");
    return path.join(base, APP_IDENTIFIER);
  }
  if (process.platform === "darwin") {
    return path.join(home, "Library", "Application Support", APP_IDENTIFIER);
  }
  // Linux / other XDG platforms.
  const base = process.env.XDG_DATA_HOME || path.join(home, ".local", "share");
  return path.join(base, APP_IDENTIFIER);
}

/**
 * Remove the app database so the next launch begins at first-run state.
 * Deletes alm.db plus the SQLite -wal/-shm sidecars. No-op if absent.
 */
export function freshDb() {
  const dir = appDataDir();
  for (const name of ["alm.db", "alm.db-wal", "alm.db-shm"]) {
    const p = path.join(dir, name);
    try {
      fs.rmSync(p, { force: true });
    } catch (e) {
      log(`warn: could not remove ${p}: ${e.message}`);
    }
  }
  log(`fresh DB: cleared ${path.join(dir, "alm.db")}`);
}

async function waitForUrl(url, label, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`${label} did not become ready within ${timeoutMs}ms`);
}

/**
 * Start the frontend server + tauri-driver and open a WebdriverIO session.
 * Returns { browser, stop }. Always call stop() (it tears down the session and
 * both child processes) — typically in a finally block.
 */
export async function startHarness() {
  log(`app binary: ${appBinary}`);

  // `vite preview` serves the production `dist` where the binary's Tauri devUrl
  // points (:5173), so the webview loads the real UI.
  const frontend = spawn(
    "pnpm",
    ["exec", "vite", "preview", "--port", String(FRONTEND_PORT), "--strictPort"],
    { cwd: desktopDir, stdio: "inherit" },
  );
  frontend.on("error", (e) =>
    log(`failed to spawn frontend server: ${e.message}`),
  );

  // tauri-driver speaks W3C WebDriver on DRIVER_PORT and spawns the native
  // driver (WebKitWebDriver on Linux) itself, reading the app path from the
  // `tauri:options.application` capability below.
  const driver = spawn("tauri-driver", ["--port", String(DRIVER_PORT)], {
    stdio: "inherit",
  });
  driver.on("error", (e) => log(`failed to spawn tauri-driver: ${e.message}`));

  let browser;
  const stop = async () => {
    if (browser) {
      try {
        await browser.deleteSession();
      } catch {
        // session may already be gone
      }
    }
    driver.kill("SIGTERM");
    frontend.kill("SIGTERM");
  };

  try {
    await waitForUrl(FRONTEND_URL, "frontend server", STARTUP_TIMEOUT_MS);
    log(`frontend server ready at ${FRONTEND_URL}`);
    await waitForUrl(`${DRIVER_URL}/status`, "tauri-driver", STARTUP_TIMEOUT_MS);
    log("tauri-driver ready");

    // Imported lazily so a missing dep yields a clear, actionable error.
    const { remote } = await import("webdriverio");

    browser = await remote({
      hostname: "127.0.0.1",
      port: DRIVER_PORT,
      path: "/",
      connectionRetryCount: 0,
      logLevel: "error",
      // tauri-driver manages the native WebDriver itself; specifying a
      // browserName makes WebKitWebDriver reject the session as "failed to
      // match capabilities". Only tauri:options is needed.
      capabilities: {
        "tauri:options": { application: appBinary },
      },
    });

    return { browser, stop };
  } catch (e) {
    await stop();
    throw e;
  }
}
