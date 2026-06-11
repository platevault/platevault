import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

const schemasDir = new URL("../schemas", import.meta.url).pathname;
const specsDir = new URL("../../../specs", import.meta.url).pathname;
const generatedDir = new URL("../src/generated", import.meta.url).pathname;

function findSchemas(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      return findSchemas(path);
    }
    return entry.isFile() && entry.name.endsWith(".schema.json") ? [path] : [];
  });
}

// SpecKit-managed contracts live under `specs/<NNN>-<slug>/contracts/*.json`.
// Only the contracts listed below are wired into the TS generation pipeline —
// other specs reference remote `$ref`s that json2ts cannot resolve offline.
// Add to this allowlist as each spec's contracts settle.
const SPEC_CONTRACT_ALLOWLIST = [
  "002-data-lifecycle-state-model/contracts/lifecycle.transition.json",
  "002-data-lifecycle-state-model/contracts/provenance.read.json",
  "003-first-run-source-setup/contracts/roots.register.json",
  "003-first-run-source-setup/contracts/roots.register.batch.json",
  "003-first-run-source-setup/contracts/firstrun.complete.json",
  "003-first-run-source-setup/contracts/firstrun.restart.json",
  "003-first-run-source-setup/contracts/audit.first_run.completed.json",
  "004-native-filesystem-controls/contracts/native.directory.pick.json",
  "004-native-filesystem-controls/contracts/native.file.pick.json",
  "004-native-filesystem-controls/contracts/native.reveal.json",
  "022-mantine-prototype-design-system/contracts/theme.get.json",
  "022-mantine-prototype-design-system/contracts/theme.set.json",
  // Spec 013 — Target Lookup From FITS OBJECT
  "013-target-lookup-from-fits-object/contracts/target.lookup.json",
  "013-target-lookup-from-fits-object/contracts/target.resolve.json",
  // Spec 006 — Inventory Lifecycle
  "006-inventory-library-lifecycle/contracts/inventory.list.json",
  "006-inventory-library-lifecycle/contracts/inventory.session.review.json",
  // Spec 012 — Processing Artifact Observation
  "012-processing-artifact-observation/contracts/artifact.list.json",
  "012-processing-artifact-observation/contracts/artifact.classify.json",
  "012-processing-artifact-observation/contracts/workflow.run_completed.json",
  // Spec 019 — Bottom Log Viewer
  "019-bottom-log-viewer/contracts/log.stream.json",
  "019-bottom-log-viewer/contracts/log.export.json",
];

function findSpecContracts() {
  return SPEC_CONTRACT_ALLOWLIST.map((rel) => join(specsDir, rel)).filter((path) => {
    try {
      readdirSync(join(path, "..")); // ensure parent exists
      return true;
    } catch {
      return false;
    }
  });
}

rmSync(generatedDir, { recursive: true, force: true });
mkdirSync(generatedDir, { recursive: true });

const schemas = [...findSchemas(schemasDir), ...findSpecContracts()];

if (schemas.length === 0) {
  writeFileSync(
    join(generatedDir, "contracts.d.ts"),
    "export {};\n",
    "utf8",
  );
  console.log("No contract schemas found yet; wrote placeholder declarations.");
  process.exit(0);
}

let exitCode = 0;
for (const schema of schemas) {
  const stem = basename(schema, ".schema.json").replace(/\.json$/, "");
  const output = join(generatedDir, `${stem}.d.ts`);
  const result = spawnSync(
    "json2ts",
    ["-i", schema, "-o", output, "--unreachableDefinitions"],
    { stdio: "inherit" },
  );

  if (result.status !== 0) {
    console.error(`json2ts failed on ${schema}`);
    exitCode = result.status ?? 1;
  }
}

process.exit(exitCode);
