// Feature 037 US3 — WebdriverIO + tauri-driver SPIKE (research D3 revision).
//
// Proves the real UI->IPC->backend path is drivable: Playwright cannot connect
// to an external W3C WebDriver endpoint, so the real-webview journeys use
// WebdriverIO's `remote()` against `tauri-driver` (which launches the built
// debug binary and proxies to the native WebDriver — WebKitWebDriver on Linux).
//
// This is a standalone script (no @wdio/cli runner) so the dependency surface
// stays minimal. Exit code 0 = pass. It MUST run in CI Stage B (or on a real
// desktop) — a Tauri webview cannot run in the WSL dev sandbox.
//
// Once green, the T024–T027 journeys build real round-trips (fresh DB +
// mutation/audit assertions via e2e/helpers/db.ts) on this same mechanism.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// e2e/wdio -> e2e -> desktop -> apps -> repo root
const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const desktopDir = path.join(repoRoot, "apps", "desktop");

const isWindows = process.platform === "win32";
const exeName = isWindows ? "desktop_shell.exe" : "desktop_shell";
// The binary loads its frontend from the Tauri `devUrl` (Vite at :5173) — even
// release builds here — so we serve the built `dist` there during the run. The
// frontend is real and talks to the real Tauri backend over IPC (not a mock).
// Override with TAURI_APP_BINARY (and FRONTEND_PORT) for local runs.
const appBinary =
  process.env.TAURI_APP_BINARY ||
  path.join(repoRoot, "target", "debug", exeName);

const FRONTEND_PORT = Number(process.env.FRONTEND_PORT || 5173);
const FRONTEND_URL = `http://localhost:${FRONTEND_PORT}`;
const DRIVER_PORT = 4444;
const DRIVER_URL = `http://127.0.0.1:${DRIVER_PORT}`;
const STARTUP_TIMEOUT_MS = 30_000;

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[wdio-spike] ${msg}`);
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

async function main() {
  log(`app binary: ${appBinary}`);

  // Serve the built frontend where the binary's Tauri devUrl points (:5173), so
  // the webview loads the real UI. `vite preview` serves the production `dist`.
  const frontend = spawn(
    "pnpm",
    ["exec", "vite", "preview", "--port", String(FRONTEND_PORT), "--strictPort"],
    { cwd: desktopDir, stdio: "inherit" },
  );
  frontend.on("error", (e) => log(`failed to spawn frontend server: ${e.message}`));

  // tauri-driver speaks W3C WebDriver on DRIVER_PORT and spawns the native
  // driver (WebKitWebDriver) itself. It reads the app path from the
  // `tauri:options.application` capability below.
  const driver = spawn("tauri-driver", ["--port", String(DRIVER_PORT)], {
    stdio: "inherit",
  });
  driver.on("error", (e) => {
    log(`failed to spawn tauri-driver: ${e.message}`);
  });

  let browser;
  let failure;
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
      // browserName makes the native driver (WebKitWebDriver) reject the
      // session as "failed to match capabilities". Only tauri:options is needed.
      capabilities: {
        "tauri:options": { application: appBinary },
      },
    });

    // index.html sets a static <title>, so once the embedded frontend loads the
    // title is "Astro Library Manager". Poll to allow for webview startup +
    // navigation latency under xvfb. Round-trip assertions come in T024–T027.
    let title = "";
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      title = await browser.getTitle();
      if (/Astro Library Manager/i.test(title)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    log(`document.title = ${JSON.stringify(title)}`);
    if (!/Astro Library Manager/i.test(title)) {
      // Diagnostics: what did the webview actually load?
      try {
        log(`current url = ${await browser.getUrl()}`);
      } catch (e) {
        log(`getUrl failed: ${e.message}`);
      }
      try {
        const src = await browser.getPageSource();
        log(`page source (first 800): ${src.slice(0, 800)}`);
      } catch (e) {
        log(`getPageSource failed: ${e.message}`);
      }
      throw new Error(`unexpected app title: ${JSON.stringify(title)}`);
    }
    log("PASS: real Tauri webview booted and is drivable via WebdriverIO");
  } catch (e) {
    failure = e;
  } finally {
    if (browser) {
      try {
        await browser.deleteSession();
      } catch {
        // session may already be gone
      }
    }
    driver.kill("SIGTERM");
    frontend.kill("SIGTERM");
  }

  if (failure) {
    log(`FAIL: ${failure.message}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
