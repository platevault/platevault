// Feature 037 US3 — sequential runner for the WebdriverIO + tauri-driver suite.
//
// Each spec is a standalone script (own harness lifecycle, own fresh DB) run in
// its own process so a crash in one cannot wedge another. They run serially
// because they share the fixed frontend (:5173) and tauri-driver (:4444) ports.
// Exit code is non-zero if any spec fails. Invoked by `pnpm test:e2e:wdio`.

import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Order: title smoke first (cheapest failure), then the round-trip journeys.
const SPECS = [
  "tauri-spike.mjs",
  path.join("journeys", "us1-first-run.mjs"),
];

function runSpec(rel) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [path.join(__dirname, rel)], {
      stdio: "inherit",
    });
    child.on("exit", (code) => resolve(code ?? 1));
    child.on("error", () => resolve(1));
  });
}

async function main() {
  const failed = [];
  for (const spec of SPECS) {
    // eslint-disable-next-line no-console
    console.log(`\n[wdio-run] === ${spec} ===`);
    const code = await runSpec(spec);
    if (code !== 0) failed.push(spec);
  }

  if (failed.length > 0) {
    // eslint-disable-next-line no-console
    console.error(`[wdio-run] FAILED: ${failed.join(", ")}`);
    process.exit(1);
  }
  // eslint-disable-next-line no-console
  console.log(`[wdio-run] all ${SPECS.length} spec(s) passed`);
  process.exit(0);
}

main();
