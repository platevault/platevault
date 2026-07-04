#!/usr/bin/env node
// T010 — JSON-Schema fixture test for the spec 049 sourceview.generate contract.
//
// Validates that:
// - the canonical schema parses and has the expected top-level shape;
// - the request accepts `projectId`, `profileId`, `destinationOverride`,
//   `copyOptIn`, `strict` and requires `projectId`;
// - the success response requires `planId` and carries `warnings`;
// - the failure response's error codes include the documented set (FR-003,
//   FR-004b, FR-009a, FR-016, FR-021);
// - the warning codes include the documented set (FR-004b, FR-010a, FR-018,
//   FR-019).
//
// Pure Node — no Vitest. Run via
// `node packages/contracts/tests/sourceview.generate.test.mjs`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(
  here,
  "../../../specs/049-source-view-generation/contracts/sourceview.generate.json",
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

const failures = [];
function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

// 1. Top-level shape.
assert(schema.$defs, "contract has $defs");
assert(schema.title === "sourceview.generate", "contract title is sourceview.generate");
assert(schema.properties?.request, "contract has a request schema");
assert(schema.properties?.response, "contract has a response schema");

// 2. Request shape.
const request = schema.properties.request;
assert(request.required.includes("projectId"), "request requires projectId");
for (const field of ["profileId", "destinationOverride", "copyOptIn", "strict"]) {
  assert(field in request.properties, `request declares ${field}`);
}
assert(request.properties.copyOptIn.default === false, "copyOptIn defaults to false (FR-003)");

// 3. Response shape — success requires planId; failure requires errors.
const variants = schema.properties.response.oneOf;
assert(Array.isArray(variants) && variants.length === 2, "response has exactly 2 oneOf variants");
const success = variants.find((v) => v.properties?.status?.const === "success");
const failure = variants.find((v) => v.properties?.status?.const === "failure");
assert(success, "a success response variant exists");
assert(failure, "a failure response variant exists");
assert(success?.required?.includes("planId"), "success response requires planId");
assert("warnings" in (success?.properties ?? {}), "success response declares warnings");
assert(failure?.required?.includes("errors"), "failure response requires errors");

// 4. Error codes (FR-003/FR-004b/FR-009a/FR-016/FR-021).
function collectEnums(node, acc = []) {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node.enum)) acc.push(node.enum);
  for (const value of Object.values(node)) collectEnums(value, acc);
  return acc;
}
const allEnumValues = new Set(collectEnums(schema).flat());

const errorCodesNeeded = [
  "project.not_found",
  "no_selection",
  "lifecycle.read_only",
  "no_link_kind",
  "destination.collision",
  "destination.exists",
  "profile.not_found",
];
for (const code of errorCodesNeeded) {
  assert(allEnumValues.has(code), `error code ${code} present in some enum`);
}

// 5. Warning codes (FR-004b/FR-010a/FR-018/FR-019).
const warningCodesNeeded = [
  "no_calibration_applied",
  "unresolved_source",
  "capability_drift",
  "long_path",
];
for (const code of warningCodesNeeded) {
  assert(allEnumValues.has(code), `warning code ${code} present in some enum`);
}

if (failures.length > 0) {
  console.error("FAIL");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
console.log("OK — sourceview.generate.json fixture checks passed");
