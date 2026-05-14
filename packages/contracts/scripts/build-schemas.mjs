import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { spawnSync } from "node:child_process";

const schemasDir = new URL("../schemas", import.meta.url).pathname;
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

rmSync(generatedDir, { recursive: true, force: true });
mkdirSync(generatedDir, { recursive: true });

const schemas = findSchemas(schemasDir);

if (schemas.length === 0) {
  writeFileSync(
    join(generatedDir, "contracts.d.ts"),
    "export {};\n",
    "utf8",
  );
  console.log("No contract schemas found yet; wrote placeholder declarations.");
  process.exit(0);
}

for (const schema of schemas) {
  const outputName = basename(schema, ".schema.json") + ".d.ts";
  const output = join(generatedDir, outputName);
  const result = spawnSync(
    "json2ts",
    ["-i", schema, "-o", output, "--unreachableDefinitions"],
    { stdio: "inherit" },
  );

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
