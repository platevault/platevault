#!/usr/bin/env node
// T036 — JSON-Schema fixture test for the spec 049 sourceview.verify contract.
//
// Validates that:
// - the canonical schema parses and has the expected top-level shape;
// - the request requires `viewId`;
// - the success response requires `clean`/`brokenItems`;
// - the failure response requires `errors` and declares `view.not_found`;
// - broken-item states include the documented set (missing, moved,
//   unresolved_link, changed_kind — FR-014/FR-015).
//
// Pure Node — no Vitest. Run via
// `node packages/contracts/tests/sourceview.verify.test.mjs`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(
  here,
  "../../../specs/049-source-view-generation/contracts/sourceview.verify.json",
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

const failures = [];
function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

// 1. Top-level shape.
assert(schema.$defs, "contract has $defs");
assert(schema.title === "sourceview.verify", "contract title is sourceview.verify");
assert(schema.properties?.request, "contract has a request schema");
assert(schema.properties?.response, "contract has a response schema");

// 2. Request shape.
const request = schema.properties.request;
assert(request.required.includes("viewId"), "request requires viewId");

// 3. Response shape — success requires clean/brokenItems; failure requires errors.
const variants = schema.properties.response.oneOf;
assert(Array.isArray(variants) && variants.length === 2, "response has exactly 2 oneOf variants");
const success = variants.find((v) => v.properties?.status?.const === "success");
const failure = variants.find((v) => v.properties?.status?.const === "failure");
assert(success, "a success response variant exists");
assert(failure, "a failure response variant exists");
assert(success?.required?.includes("clean"), "success response requires clean");
assert(success?.required?.includes("brokenItems"), "success response requires brokenItems");
assert(failure?.required?.includes("errors"), "failure response requires errors");

// 4. Error codes (view.not_found).
function collectEnums(node, acc = []) {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node.enum)) acc.push(node.enum);
  for (const value of Object.values(node)) collectEnums(value, acc);
  return acc;
}
const allEnumValues = new Set(collectEnums(schema).flat());
assert(allEnumValues.has("view.not_found"), "error code view.not_found present");

// 5. Broken-item states (FR-014/FR-015: read-only, no auto-repair).
const statesNeeded = ["missing", "moved", "unresolved_link", "changed_kind"];
for (const state of statesNeeded) {
  assert(allEnumValues.has(state), `broken-item state ${state} present in some enum`);
}

if (failures.length > 0) {
  console.error("FAIL");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
console.log("OK — sourceview.verify.json fixture checks passed");
