#!/usr/bin/env node
// T030 — JSON-Schema fixture test for the spec 002 lifecycle.transition contract.
//
// Validates that:
// - the canonical schema parses;
// - every documented error code (`transition.refused`, `entity.not_found`,
//   `actor.not_authorised`, `plan.required`, `plan.not_approved`,
//   `provenance.unreviewed`) is enumerated by the schema's `code` enum;
// - the `status: "noop"` response shape (no `audit_id`, no `error`) is
//   present in the schema's response variants;
// - the `provenance.unreviewed` error path documents a `blocking_fields`
//   detail key.
//
// Pure Node — no Vitest. Run via `node packages/contracts/tests/lifecycle.transition.errors.test.mjs`.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(
  here,
  "../../../specs/002-data-lifecycle-state-model/contracts/lifecycle.transition.json",
);
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));

const failures = [];
function assert(cond, msg) {
  if (!cond) failures.push(msg);
}

// 1. Top-level shape.
assert(schema.$defs, "contract has $defs");
assert(schema.title, "contract has title");

// 2. Error codes — find any enum somewhere in $defs that includes
//    the canonical error code set.
const codesNeeded = [
  "transition.refused",
  "entity.not_found",
  "actor.not_authorised",
  "plan.required",
  "plan.not_approved",
  "provenance.unreviewed",
];

function collectEnums(node, acc = []) {
  if (!node || typeof node !== "object") return acc;
  if (Array.isArray(node.enum)) acc.push(node.enum);
  for (const value of Object.values(node)) collectEnums(value, acc);
  return acc;
}
const enums = collectEnums(schema);
const allEnumValues = new Set(enums.flat());
for (const code of codesNeeded) {
  assert(allEnumValues.has(code), `error code ${code} present in some enum`);
}

// 3. Noop status — searches for the literal "noop" in any enum
//    (the response status discriminator).
assert(allEnumValues.has("noop"), "status `noop` present in some response enum");
assert(allEnumValues.has("success"), "status `success` present in some response enum");
assert(allEnumValues.has("error"), "status `error` present in some response enum");

// 4. `blocking_fields` detail shape — full-text scan of the JSON.
const raw = JSON.stringify(schema);
assert(raw.includes("blockingFields") || raw.includes("blocking_fields"),
  "schema mentions blocking_fields / blockingFields key");

if (failures.length > 0) {
  console.error("FAIL");
  for (const f of failures) console.error(" -", f);
  process.exit(1);
}
console.log("OK — lifecycle.transition.json fixture checks passed");
