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

const isWindows = process.platform === "win32";
const exeName = isWindows ? "desktop_shell.exe" : "desktop_shell";
// A *debug* Tauri build loads devUrl (the Vite dev server); with no server
// running the webview is blank. A release build embeds frontendDist, so the app
// is self-contained — that is what tauri-driver should launch. Override with
// TAURI_APP_BINARY when driving a `tauri dev` session locally.
const appBinary =
  process.env.TAURI_APP_BINARY ||
  path.join(repoRoot, "target", "release", exeName);

const DRIVER_PORT = 4444;
const DRIVER_URL = `http://127.0.0.1:${DRIVER_PORT}`;
const STARTUP_TIMEOUT_MS = 30_000;

function log(msg) {
  // eslint-disable-next-line no-console
  console.log(`[wdio-spike] ${msg}`);
}

async function waitForDriver(timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${DRIVER_URL}/status`);
      if (res.ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error(`tauri-driver did not become ready within ${timeoutMs}ms`);
}

async function main() {
  log(`app binary: ${appBinary}`);

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
    await waitForDriver(STARTUP_TIMEOUT_MS);
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

    // The real app shell sets this title regardless of backend data, but it
    // only renders if the real webview booted and the bundle loaded — i.e. the
    // full UI->runtime path works. Round-trip assertions come in T024–T027.
    const title = await browser.getTitle();
    log(`document.title = ${JSON.stringify(title)}`);
    if (!/Astro Library Manager/i.test(title)) {
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
  }

  if (failure) {
    log(`FAIL: ${failure.message}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
