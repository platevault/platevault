/**
 * Helpers for starting and stopping the real Tauri application process
 * during real-backend e2e tests.
 *
 * The Tauri process is started under xvfb (for the headless WebKit WebView)
 * and exposed via tauri-driver + WebKitWebDriver (W3C WebDriver protocol).
 *
 * Usage in a test file:
 *
 *   import { TauriApp } from "../helpers/tauri-app";
 *
 *   let app: TauriApp;
 *   test.beforeAll(async () => { app = await TauriApp.start(); });
 *   test.afterAll(async () => { await app.stop(); });
 *
 * NOTE: Individual real-backend spec files are currently skipped pending
 * spec 033 implementation. This helper is scaffolded and type-checked but
 * its `start()` path is not exercised by any live test yet.
 */

import { spawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..", "..");
const desktopDir = path.join(repoRoot, "apps", "desktop");

/** Port that tauri-driver binds on for the W3C WebDriver endpoint. */
const TAURI_DRIVER_PORT = 4444;

/** URL for the Vite dev server that the Tauri WebView will load. */
const TAURI_DEV_URL = "http://localhost:1420";

export interface TauriAppOptions {
  /** Override the port tauri-driver listens on. Default: 4444. */
  driverPort?: number;
  /** Override the Vite dev URL. Default: http://localhost:1420. */
  devUrl?: string;
  /**
   * If true, delete the SQLite database before starting the app so the
   * first-run wizard is shown. Default: false.
   */
  freshDb?: boolean;
}

/**
 * Manages the lifecycle of the real Tauri application process for e2e testing.
 *
 * Architecture:
 *  xvfb-run → tauri dev (Rust backend + WebKit WebView)
 *           → tauri-driver (W3C WebDriver bridge, port 4444)
 *           ← Playwright WebDriver session
 */
export class TauriApp {
  private driverProcess: ChildProcess | null = null;
  private readonly driverPort: number;
  private readonly devUrl: string;

  private constructor(options: Required<TauriAppOptions>) {
    this.driverPort = options.driverPort;
    this.devUrl = options.devUrl;
  }

  /**
   * Start the Tauri application and tauri-driver.
   *
   * Call this in `test.beforeAll`. The Vite dev server must already be
   * running (the Playwright webServer block in the config handles this).
   */
  static async start(options: TauriAppOptions = {}): Promise<TauriApp> {
    const opts: Required<TauriAppOptions> = {
      driverPort: options.driverPort ?? TAURI_DRIVER_PORT,
      devUrl: options.devUrl ?? TAURI_DEV_URL,
      freshDb: options.freshDb ?? false,
    };

    const instance = new TauriApp(opts);

    if (opts.freshDb) {
      await instance.deleteDatabase();
    }

    await instance.startDriver();
    return instance;
  }

  /** The W3C WebDriver endpoint URL for Playwright to connect to. */
  get webDriverUrl(): string {
    return `http://127.0.0.1:${this.driverPort}`;
  }

  /**
   * Stop the tauri-driver (and thereby the Tauri app) after tests finish.
   * Call this in `test.afterAll`.
   */
  async stop(): Promise<void> {
    if (this.driverProcess) {
      this.driverProcess.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        this.driverProcess!.once("exit", () => resolve());
        // Force-kill after 5 s if SIGTERM is ignored.
        setTimeout(() => {
          this.driverProcess?.kill("SIGKILL");
          resolve();
        }, 5_000);
      });
      this.driverProcess = null;
    }
  }

  /**
   * Delete the application SQLite database to force a fresh first-run state.
   *
   * The database path follows the Tauri app-data directory convention:
   *   Linux:   ~/.local/share/dev.astro-plan.astro-library-manager/alm.db
   *   macOS:   ~/Library/Application Support/.../alm.db
   *   Windows: %APPDATA%\...\alm.db
   */
  private async deleteDatabase(): Promise<void> {
    const { unlink } = await import("node:fs/promises");
    const { homedir } = await import("node:os");
    const dbPath = path.join(
      homedir(),
      ".local",
      "share",
      "dev.astro-plan.astro-library-manager",
      "alm.db",
    );
    try {
      await unlink(dbPath);
    } catch {
      // File may not exist on first run — ignore.
    }
  }

  /**
   * Start the `tauri-driver` process which in turn launches the Tauri app
   * under xvfb (for headless operation in WSL/CI).
   *
   * tauri-driver is a WebDriver server that wraps the native WebKit
   * WebDriver (WebKitWebDriver) to provide a W3C-compatible endpoint.
   * Playwright connects to it at `http://127.0.0.1:<driverPort>`.
   */
  private async startDriver(): Promise<void> {
    const tauriDevConfig = JSON.stringify({
      build: {
        devUrl: this.devUrl,
        beforeDevCommand: "", // Vite is already running via webServer block.
      },
    });

    // The command sequence:
    //   xvfb-run → tauri-driver --port <N> -- tauri dev --no-watch --config '{...}'
    //
    // tauri-driver starts WebKitWebDriver internally and manages the Tauri
    // process lifecycle. The `--` separates tauri-driver flags from the app
    // command that tauri-driver should invoke.
    const cmd = "xvfb-run";
    const args = [
      "-a",
      "-s",
      "-screen 0 1400x900x24",
      "tauri-driver",
      "--port",
      String(this.driverPort),
      "--",
      "pnpm",
      "--filter",
      "@astro-plan/desktop",
      "exec",
      "tauri",
      "dev",
      "--no-watch",
      "--config",
      tauriDevConfig,
    ];

    this.driverProcess = spawn(cmd, args, {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        VITE_USE_MOCKS: "false",
        // Suppress colour output from cargo to keep logs readable.
        CARGO_TERM_COLOR: "never",
      },
      detached: false,
    });

    // Wait for the driver to be ready by polling the WebDriver status endpoint.
    await this.waitForDriver();
  }

  /**
   * Poll the tauri-driver status endpoint until it responds or the timeout
   * elapses. Returns when ready, throws on timeout.
   */
  private async waitForDriver(
    timeoutMs = 60_000,
    intervalMs = 500,
  ): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      try {
        const res = await fetch(`${this.webDriverUrl}/status`);
        if (res.ok) return;
      } catch {
        // Not ready yet.
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
    throw new Error(
      `tauri-driver did not become ready within ${timeoutMs}ms at ${this.webDriverUrl}`,
    );
  }
}

/**
 * Path to the application SQLite database on Linux/WSL.
 * Use this in tests that need to seed or verify DB state directly.
 *
 * WARNING: Direct DB manipulation bypasses the application's audit and
 * lifecycle guarantees. Only use in test setup/teardown, never to simulate
 * user actions.
 */
export function appDbPath(): string {
  const { homedir } = require("node:os") as typeof import("node:os");
  return path.join(
    homedir(),
    ".local",
    "share",
    "dev.astro-plan.astro-library-manager",
    "alm.db",
  );
}
