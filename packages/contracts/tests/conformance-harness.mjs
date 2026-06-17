#!/usr/bin/env node
/**
 * T007 — JSON-Schema conformance-test harness.
 *
 * Loads schemas from packages/contracts/schemas and the spec contracts dirs,
 * validates captured runtime request/response payloads, and FAILS on drift.
 *
 * Usage (from repo root):
 *   node packages/contracts/tests/conformance-harness.mjs
 *
 * Returns exit 0 on all-pass, exit 1 with failures listed on any drift.
 *
 * Uses AJV v8 2020-12 mode (ajv/dist/2020) which understands the
 * $schema: "https://json-schema.org/draft/2020-12/schema" dialect.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");

// Use createRequire to import CJS-only modules from ESM context.
const require = createRequire(import.meta.url);
const { Ajv2020 } = require("ajv/dist/2020");

// ── Schema loader ─────────────────────────────────────────────────────────────

function loadSchema(relPath) {
  const abs = resolve(root, relPath);
  return JSON.parse(readFileSync(abs, "utf8"));
}

// ── AJV instance ─────────────────────────────────────────────────────────────

// strict:false so unknown formats (date-time, uuid) produce warnings, not errors.
const ajv = new Ajv2020({ strict: false, allErrors: true });

// ── Test runner ───────────────────────────────────────────────────────────────

const failures = [];
const passes = [];

/**
 * Validate `payload` against `schema`.
 *   expectValid=true  → payload must pass validation.
 *   expectValid=false → payload must FAIL validation (drift injection check).
 */
function validate(label, schema, payload, expectValid = true) {
  let compiled;
  try {
    // getSchema avoids re-compilation for the same $id
    const cached = schema.$id ? ajv.getSchema(schema.$id) : null;
    if (cached) {
      compiled = cached;
    } else {
      compiled = ajv.compile(schema);
    }
  } catch (err) {
    failures.push({ label, reason: `Schema compilation failed: ${err.message}` });
    return;
  }

  const valid = compiled(payload);
  if (expectValid && !valid) {
    failures.push({
      label,
      reason: `expected VALID but got errors:\n${JSON.stringify(compiled.errors, null, 2)}`,
    });
  } else if (!expectValid && valid) {
    failures.push({
      label,
      reason: "expected INVALID (drift injection) but schema accepted the payload",
    });
  } else {
    passes.push(label);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// T063-A: LogEntry contractVersion conformance
// Schema: packages/contracts/schemas/log/LogEntry.v1.schema.json
// ─────────────────────────────────────────────────────────────────────────────

const logEntrySchema = loadSchema(
  "packages/contracts/schemas/log/LogEntry.v1.schema.json"
);

const validLogEntry = {
  id: "aud:42",
  contractVersion: "2.0.0",
  time: "2026-06-17T10:00:00Z",
  level: "info",
  source: "audit",
  message: "session.confirmed",
};

validate("T063-A LogEntry valid payload (contractVersion 2.0.0)", logEntrySchema, validLogEntry, true);

// Drift A-1: contractVersion "1" (old buggy value) must be REJECTED by const "2.0.0"
validate(
  "T063-A DRIFT: contractVersion '1' must be rejected",
  logEntrySchema,
  { ...validLogEntry, contractVersion: "1" },
  false
);

// Drift A-2: missing required field must be rejected
validate(
  "T063-A DRIFT: missing 'message' field must be rejected",
  logEntrySchema,
  {
    id: "aud:42",
    contractVersion: "2.0.0",
    time: "2026-06-17T10:00:00Z",
    level: "info",
    source: "audit",
  },
  false
);

// ─────────────────────────────────────────────────────────────────────────────
// T063-B: log.export response status field conformance
// Schema: specs/019-bottom-log-viewer/contracts/log.export.json
// ─────────────────────────────────────────────────────────────────────────────

const logExportSchema = loadSchema(
  "specs/019-bottom-log-viewer/contracts/log.export.json"
);

// Extract the success response variant (oneOf[0])
const exportSuccessVariant = logExportSchema.properties.response.oneOf[0];
const logExportSuccessSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:test:log-export-success",
  type: "object",
  required: exportSuccessVariant.required,
  properties: exportSuccessVariant.properties,
  additionalProperties: exportSuccessVariant.additionalProperties,
};

const validExportResponse = {
  status: "success",
  contractVersion: "2.0.0",
  requestId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  filePath: "/home/user/log.json",
  count: 12,
};

validate(
  "T063-B log.export success response valid (has status field)",
  logExportSuccessSchema,
  validExportResponse,
  true
);

// Drift B-1: missing status — the old Rust struct had no status field
validate(
  "T063-B DRIFT: log.export missing 'status' must be rejected",
  logExportSuccessSchema,
  {
    contractVersion: "2.0.0",
    requestId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    filePath: "/home/user/log.json",
    count: 12,
  },
  false
);

// ─────────────────────────────────────────────────────────────────────────────
// T063-C: dia: cursor in log.stream request
// Schema: specs/019-bottom-log-viewer/contracts/log.stream.json
// ─────────────────────────────────────────────────────────────────────────────

const logStreamSchema = loadSchema(
  "specs/019-bottom-log-viewer/contracts/log.stream.json"
);

const streamReqDef = logStreamSchema.properties.request;
const logStreamRequestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:test:log-stream-request",
  type: "object",
  required: streamReqDef.required,
  properties: streamReqDef.properties,
};

validate(
  "T063-C log.stream request with aud: cursor is valid",
  logStreamRequestSchema,
  {
    contractVersion: "2.0.0",
    requestId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    cursor: "aud:42",
  },
  true
);

validate(
  "T063-C log.stream request with dia: cursor must be accepted",
  logStreamRequestSchema,
  {
    contractVersion: "2.0.0",
    requestId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    cursor: "dia:7",
  },
  true
);

// ─────────────────────────────────────────────────────────────────────────────
// T063-D: artifact.classify response flat shape conformance
// Schema: specs/012-processing-artifact-observation/contracts/artifact.classify.json
// ─────────────────────────────────────────────────────────────────────────────

const artifactClassifyFullSchema = loadSchema(
  "specs/012-processing-artifact-observation/contracts/artifact.classify.json"
);

// Register the full schema to allow $ref resolution inside it
ajv.addSchema(artifactClassifyFullSchema);

const artifactResponseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:test:artifact-classify-response",
  $ref: `${artifactClassifyFullSchema.$id}#/$defs/Response`,
};

// Valid flat response (status at top level, not a nested "artifact" wrapper)
const validClassifyResponse = {
  status: "success",
  contractVersion: "2.0.0",
  requestId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
  classified: true,
  artifactId: "art-001",
  kind: "master",
  classificationSource: "manual_override",
  classificationConfidence: 1,
  updatedAt: "2026-06-17T10:00:00Z",
};

validate(
  "T063-D artifact.classify response valid (flat shape, status at root)",
  artifactResponseSchema,
  validClassifyResponse,
  true
);

// Drift D-1: missing required 'status' field at top level
validate(
  "T063-D DRIFT: artifact.classify missing 'status' must be rejected",
  artifactResponseSchema,
  {
    contractVersion: "2.0.0",
    requestId: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    classified: true,
    artifactId: "art-001",
    kind: "master",
  },
  false
);

// ─────────────────────────────────────────────────────────────────────────────
// T063-E: project.create lifecycle value conformance
// The stale comment said lifecycle is ALWAYS "setup_incomplete".
// Reality: auto-transition means it can also be "ready".
// ─────────────────────────────────────────────────────────────────────────────

const projectLifecycleSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:test:project-lifecycle",
  type: "object",
  required: ["lifecycle"],
  properties: {
    lifecycle: {
      type: "string",
      enum: ["setup_incomplete", "ready", "blocked", "archived"],
    },
  },
};

validate(
  "T063-E project.create lifecycle 'setup_incomplete' is valid",
  projectLifecycleSchema,
  { lifecycle: "setup_incomplete" },
  true
);

validate(
  "T063-E project.create lifecycle 'ready' is valid (auto-transition; stale comment was wrong)",
  projectLifecycleSchema,
  { lifecycle: "ready" },
  true
);

// Drift E-1: stale/bogus lifecycle value
validate(
  "T063-E DRIFT: lifecycle 'in_progress' is not valid",
  projectLifecycleSchema,
  { lifecycle: "in_progress" },
  false
);

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────

console.log(`\n=== T007/T063 Conformance test results ===`);
console.log(`  PASS: ${passes.length}`);
console.log(`  FAIL: ${failures.length}`);

if (passes.length > 0) {
  console.log("\nPassing:");
  for (const p of passes) {
    console.log(`  ✓ ${p}`);
  }
}

if (failures.length > 0) {
  console.error("\nFailing:");
  for (const f of failures) {
    console.error(`  ✗ ${f.label}`);
    console.error(`    Reason: ${f.reason}`);
  }
  process.exit(1);
}

console.log("\nOK — all conformance checks passed");
