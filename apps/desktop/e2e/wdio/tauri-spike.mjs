// Feature 037 US3 — WebdriverIO + tauri-driver smoke (research D3 revision).
//
// Proves the real UI->IPC->backend path is drivable: Playwright cannot connect
// to an external W3C WebDriver endpoint, so the real-webview journeys use
// WebdriverIO's `remote()` against `tauri-driver` (which launches the built
// binary and proxies to the native WebDriver — WebKitWebDriver on Linux).
//
// This is the minimal smoke: boot the real webview and assert the document
// title. The full round-trip journeys (T024–T027) live in ./journeys/ and build
// on the same `harness.mjs`; assertions there read back through real IPCs (e.g.
// roots_list) — no better-sqlite3 DB reader is used.
//
// Exit code 0 = pass. MUST run in CI (e2e.yml) or on a real desktop — a Tauri
// webview cannot run in the WSL dev sandbox.

import { startHarness, log } from "./harness.mjs";

async function main() {
  const { browser, stop } = await startHarness();
  let failure;
  try {
    // index.html sets a static <title>, so once the embedded frontend loads the
    // title is "Astro Library Manager". Poll to allow for webview startup +
    // navigation latency under xvfb.
    let title = "";
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      title = await browser.getTitle();
      if (/Astro Library Manager/i.test(title)) break;
      await new Promise((r) => setTimeout(r, 1000));
    }
    log(`document.title = ${JSON.stringify(title)}`);
    if (!/Astro Library Manager/i.test(title)) {
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
    await stop();
  }

  if (failure) {
    log(`FAIL: ${failure.message}`);
    process.exit(1);
  }
  process.exit(0);
}

main();
