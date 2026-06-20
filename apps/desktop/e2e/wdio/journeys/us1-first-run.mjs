// Feature 037 US3 — T024 journey: first-run setup -> register sources (US1).
//
// Drives the REAL Tauri webview through the first-run wizard and asserts a
// genuine UI -> IPC -> backend round-trip (FR-008): the two source folders the
// user adds in the wizard are persisted and read back via the real `roots_list`
// command.
//
// Wizard shape (apps/desktop/src/features/setup/SetupWizard.tsx):
//   step 0 Source folders -> 1 Tools -> 2 Catalogs -> 3 Confirm -> 4 Scan
// REQUIRED_KINDS = ['light_frames', 'project'] (sources-store.ts), so both must
// be added before the wizard will advance. The nav buttons have no test ids, so
// they are clicked by their visible label. The Confirm step's "Start scan →"
// button is what calls `roots.register.batch`.
//
// The round-trip read uses `window.__ALM_E2E__.invoke` — a VITE_E2E-gated bridge
// installed in main.tsx (withGlobalTauri is off, so window.__TAURI__ is absent).

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { freshDb, startHarness, log } from "../harness.mjs";

const STEP_TIMEOUT_MS = 20_000;

/** Create a unique, real, absolute temp dir (register validates existence). */
function makeTempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `alm-e2e-${prefix}-`));
}

async function setPathOverride(browser, kind, dirPath) {
  const input = await browser.$(`[data-testid="e2e-path-input-${kind}"]`);
  await input.waitForExist({ timeout: STEP_TIMEOUT_MS });
  await input.setValue(dirPath);
  const addBtn = await browser.$(`[data-testid="e2e-add-path-btn-${kind}"]`);
  await addBtn.click();
  // The kind's requirement chip flips to satisfied once a valid source is added.
  const status = await browser.$(`[data-testid="requirement-status-${kind}"]`);
  await status.waitForExist({ timeout: STEP_TIMEOUT_MS });
  log(`added ${kind} source: ${dirPath}`);
}

/** Click a footer button by its (case-insensitive) visible label substring. */
async function clickButtonByText(browser, text) {
  const btn = await browser.$(`button*=${text}`);
  await btn.waitForClickable({ timeout: STEP_TIMEOUT_MS });
  await btn.click();
  log(`clicked button: "${text}"`);
}

async function main() {
  freshDb();

  const lightDir = makeTempDir("light");
  const projectDir = makeTempDir("project");

  const { browser, stop } = await startHarness();
  let failure;
  try {
    // The first-run wizard renders the Source folders step (step 0) first.
    const lightGroup = await browser.$('[data-testid="source-group-light_frames"]');
    await lightGroup.waitForExist({ timeout: STEP_TIMEOUT_MS });
    log("first-run wizard: Source folders step visible");

    // Add the two required sources via the CI-only typeable path override.
    await setPathOverride(browser, "light_frames", lightDir);
    await setPathOverride(browser, "project", projectDir);

    // Advance Source folders -> Processing Tools -> Configuration -> Confirm.
    // Footer text is `Continue to {STEPS[next].label.toLowerCase()}` (see
    // SetupWizard.tsx STEPS), so the labels must match the real step names.
    await clickButtonByText(browser, "Continue to processing tools");
    await clickButtonByText(browser, "Continue to configuration");
    await clickButtonByText(browser, "Continue to confirm");

    // Confirm step: "Start scan →" registers the batch (roots.register.batch)
    // and advances to the Scan step.
    await clickButtonByText(browser, "Start scan");

    // Round-trip assertion (FR-008): read the registered roots back from the
    // real backend over the real IPC path and verify both folders persisted.
    const roots = await browser.executeAsync((done) => {
      const bridge = window.__ALM_E2E__;
      if (!bridge || typeof bridge.invoke !== "function") {
        done({ __err: "window.__ALM_E2E__.invoke missing (VITE_E2E build?)" });
        return;
      }
      bridge
        .invoke("roots_list")
        .then((r) => done(r))
        .catch((e) => done({ __err: String(e) }));
    });

    if (roots && roots.__err) {
      throw new Error(`roots_list round-trip failed: ${roots.__err}`);
    }
    if (!Array.isArray(roots)) {
      throw new Error(`roots_list returned non-array: ${JSON.stringify(roots)}`);
    }

    // Match by basename — the backend may canonicalize/normalize the stored
    // path (symlinks, trailing slash), but the unique mkdtemp basename survives.
    const paths = roots.map((r) => String(r.path || ""));
    const hasLight = paths.some((p) => p.includes(path.basename(lightDir)));
    const hasProject = paths.some((p) => p.includes(path.basename(projectDir)));

    log(`roots_list returned ${roots.length} root(s): ${JSON.stringify(paths)}`);
    if (!hasLight || !hasProject) {
      throw new Error(
        `registered roots missing expected folders ` +
          `(light=${hasLight}, project=${hasProject}); got ${JSON.stringify(paths)}`,
      );
    }

    log("PASS: first-run sources persisted and read back via real roots_list");
  } catch (e) {
    failure = e;
    // Diagnostics to make CI-only failures actionable.
    try {
      log(`current url = ${await browser.getUrl()}`);
    } catch {
      // ignore
    }
    try {
      const src = await browser.getPageSource();
      log(`page source (first 1200): ${src.slice(0, 1200)}`);
    } catch {
      // ignore
    }
  } finally {
    await stop();
    for (const dir of [lightDir, projectDir]) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // best-effort cleanup
      }
    }
  }

  if (failure) {
    log(`FAIL: ${failure.message}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
