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
// Spec 007 T015/T020/T024 — calibration.match.suggest response shape
// (dark/flat/bias) conformance, plus T041/T042 error-path coverage.
// Schema: specs/007-calibration-matching-rules/contracts/calibration.match.suggest.json
// ─────────────────────────────────────────────────────────────────────────────

const suggestSchema = loadSchema(
  "specs/007-calibration-matching-rules/contracts/calibration.match.suggest.json"
);
ajv.addSchema(suggestSchema);

const suggestResponseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:test:calibration-match-suggest-response",
  $ref: `${suggestSchema.$id}#/$defs/Response`,
};

const sessionId = "3fa85f64-5717-4562-b3fc-2c963f66afa6";
const requestId = "5b6a2a3e-6b1e-4a3e-9e2a-0b1c2d3e4f5a";

function suggestMatch(overrides = {}) {
  return {
    sessionId,
    masterId: "8c2b1a4e-1234-4a3e-9e2a-0b1c2d3e4f5a",
    calibrationType: "dark",
    confidence: 0.92,
    dimensionsMatched: [{ dimension: "exposure", observed: 300, reference: 300, delta: 0 }],
    dimensionsMismatched: [],
    selectionReason: "same_session",
    ...overrides,
  };
}

// T015: dark match response.
validate(
  "T015 calibration.match.suggest dark match response is valid",
  suggestResponseSchema,
  {
    status: "success",
    contractVersion: "2.0.0",
    requestId,
    suggestStatus: "match",
    matches: [suggestMatch({ calibrationType: "dark" })],
  },
  true
);

validate(
  "T015 DRIFT: dark match missing 'confidence' must be rejected",
  suggestResponseSchema,
  {
    status: "success",
    contractVersion: "2.0.0",
    requestId,
    suggestStatus: "match",
    matches: [
      (() => {
        const { confidence, ...rest } = suggestMatch({ calibrationType: "dark" });
        return rest;
      })(),
    ],
  },
  false
);

// T020: flat match response, asserting selectionReason is present and constrained.
validate(
  "T020 calibration.match.suggest flat match response includes selectionReason",
  suggestResponseSchema,
  {
    status: "success",
    contractVersion: "2.0.0",
    requestId,
    suggestStatus: "match",
    matches: [suggestMatch({ calibrationType: "flat", selectionReason: "compatible_fallback" })],
  },
  true
);

validate(
  "T020 DRIFT: flat match with invalid selectionReason value must be rejected",
  suggestResponseSchema,
  {
    status: "success",
    contractVersion: "2.0.0",
    requestId,
    suggestStatus: "match",
    matches: [suggestMatch({ calibrationType: "flat", selectionReason: "bogus_reason" })],
  },
  false
);

// T024: bias ambiguous response with two candidates and a populated mismatch list.
validate(
  "T024 calibration.match.suggest bias ambiguous response is valid",
  suggestResponseSchema,
  {
    status: "success",
    contractVersion: "2.0.0",
    requestId,
    suggestStatus: "ambiguous",
    matches: [
      suggestMatch({ calibrationType: "bias", confidence: 0.6 }),
      suggestMatch({
        calibrationType: "bias",
        confidence: 0.58,
        selectionReason: "same_night",
        dimensionsMismatched: [{ dimension: "gain", reason: "out_of_tolerance", delta: 0.5 }],
      }),
    ],
  },
  true
);

validate(
  "T024 DRIFT: bias mismatch entry missing required 'reason' must be rejected",
  suggestResponseSchema,
  {
    status: "success",
    contractVersion: "2.0.0",
    requestId,
    suggestStatus: "ambiguous",
    matches: [
      suggestMatch({
        calibrationType: "bias",
        dimensionsMismatched: [{ dimension: "gain", delta: 0.5 }],
      }),
    ],
  },
  false
);

// T042: observer_location_missing is a *result* status (not an error) on suggest.
validate(
  "T042 calibration.match.suggest observer_location_missing result status is valid",
  suggestResponseSchema,
  {
    status: "success",
    contractVersion: "2.0.0",
    requestId,
    suggestStatus: "observer_location_missing",
  },
  true
);

// T041: session.mixed_state surfaces as a hard error on suggest.
validate(
  "T041 calibration.match.suggest session.mixed_state error response is valid",
  suggestResponseSchema,
  {
    status: "error",
    contractVersion: "2.0.0",
    requestId,
    error: { code: "session.mixed_state", message: "Session type is mixed; split required before matching." },
  },
  true
);

validate(
  "T041 DRIFT: unknown error code on suggest must be rejected",
  suggestResponseSchema,
  {
    status: "error",
    contractVersion: "2.0.0",
    requestId,
    error: { code: "not.a.real.code", message: "bogus" },
  },
  false
);

// ─────────────────────────────────────────────────────────────────────────────
// Spec 007 T029 — calibration.match.assign response shape: success,
// incompatible.dimensions, master.not_found.
// Schema: specs/007-calibration-matching-rules/contracts/calibration.match.assign.json
// ─────────────────────────────────────────────────────────────────────────────

const assignSchema = loadSchema(
  "specs/007-calibration-matching-rules/contracts/calibration.match.assign.json"
);
ajv.addSchema(assignSchema);

const assignResponseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:test:calibration-match-assign-response",
  $ref: `${assignSchema.$id}#/$defs/Response`,
};

validate(
  "T029 calibration.match.assign success response is valid",
  assignResponseSchema,
  {
    status: "success",
    contractVersion: "2.0.0",
    requestId,
    assigned: {
      assignmentId: "1a2b3c4d-5e6f-4a3e-9e2a-0b1c2d3e4f5a",
      sessionId,
      masterId: "8c2b1a4e-1234-4a3e-9e2a-0b1c2d3e4f5a",
      calibrationType: "dark",
      wasOverride: false,
    },
    confidence: 0.9,
  },
  true
);

validate(
  "T029 calibration.match.assign incompatible.dimensions error is valid",
  assignResponseSchema,
  {
    status: "error",
    contractVersion: "2.0.0",
    requestId,
    error: {
      code: "incompatible.dimensions",
      message: "Master gain does not match the session within tolerance.",
      details: { dimensions: ["gain"] },
    },
  },
  true
);

validate(
  "T029 calibration.match.assign master.not_found error is valid",
  assignResponseSchema,
  {
    status: "error",
    contractVersion: "2.0.0",
    requestId,
    error: { code: "master.not_found", message: "No calibration master exists with that id." },
  },
  true
);

validate(
  "T029 DRIFT: assign success without 'assigned' must be rejected",
  assignResponseSchema,
  {
    status: "success",
    contractVersion: "2.0.0",
    requestId,
    confidence: 0.9,
  },
  false
);

// ─────────────────────────────────────────────────────────────────────────────
// Spec 007 T037 — calibration.match.suggest.batch: all-success, partial
// (one observer_location_missing item + one hard error), all-error.
// Schema: specs/007-calibration-matching-rules/contracts/calibration.match.suggest.batch.json
// ─────────────────────────────────────────────────────────────────────────────

const batchSchema = loadSchema(
  "specs/007-calibration-matching-rules/contracts/calibration.match.suggest.batch.json"
);
ajv.addSchema(batchSchema);

const batchResponseSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:test:calibration-match-suggest-batch-response",
  $ref: `${batchSchema.$id}#/$defs/Response`,
};

validate(
  "T037 calibration.match.suggest.batch all-success response is valid",
  batchResponseSchema,
  {
    status: "success",
    contractVersion: "1.0",
    requestId,
    results: [
      {
        sessionId,
        calibrationType: "dark",
        status: "match",
        candidates: [
          (() => {
            // Batch CalibrationMatch has no sessionId field (it's implied by
            // the enclosing SessionResult), unlike suggest's CalibrationMatch.
            const { sessionId: _omit, ...candidate } = suggestMatch();
            return candidate;
          })(),
        ],
      },
    ],
  },
  true
);

validate(
  "T037 calibration.match.suggest.batch partial response is valid",
  batchResponseSchema,
  {
    status: "partial",
    contractVersion: "1.0",
    requestId,
    results: [{ sessionId, calibrationType: "flat", status: "observer_location_missing" }],
    errors: [
      {
        code: "session.not_found",
        message: "Session no longer exists.",
        sessionId: "9d8e7f6a-5b4c-4a3e-9e2a-0b1c2d3e4f5a",
      },
    ],
  },
  true
);

validate(
  "T037 calibration.match.suggest.batch all-error response is valid",
  batchResponseSchema,
  {
    status: "error",
    contractVersion: "1.0",
    requestId,
    errors: [{ code: "contract.version_unsupported", message: "Unsupported contract version." }],
  },
  true
);

validate(
  "T037 DRIFT: batch partial status without 'errors' must be rejected",
  batchResponseSchema,
  {
    status: "partial",
    contractVersion: "1.0",
    requestId,
    results: [{ sessionId, calibrationType: "flat", status: "observer_location_missing" }],
  },
  false
);

// ─────────────────────────────────────────────────────────────────────────────
// Spec 012 T017 — artifact.classify error-path conformance (complements the
// T063-D success/drift fixtures above): artifact.not_found and a request
// carrying kind=null (clear override, A6).
// Schema: specs/012-processing-artifact-observation/contracts/artifact.classify.json
// ─────────────────────────────────────────────────────────────────────────────

const artifactRequestSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "urn:test:artifact-classify-request",
  $ref: `${artifactClassifyFullSchema.$id}#/$defs/Request`,
};

validate(
  "T017 artifact.classify clear-override request (kind: null) is valid",
  artifactRequestSchema,
  {
    contractVersion: "2.0.0",
    requestId,
    artifactId: "art-001",
    kind: null,
  },
  true
);

validate(
  "T017 artifact.classify artifact.not_found error response is valid",
  artifactResponseSchema,
  {
    status: "error",
    contractVersion: "2.0.0",
    requestId,
    error: { code: "artifact.not_found", message: "No artifact exists with that id." },
  },
  true
);

validate(
  "T017 DRIFT: artifact.classify request with invalid kind enum value must be rejected",
  artifactRequestSchema,
  {
    contractVersion: "2.0.0",
    requestId,
    artifactId: "art-001",
    kind: "raw",
  },
  false
);

// ─────────────────────────────────────────────────────────────────────────────
// Spec 025 T009/T029/T035/T036/T048 — plan.apply/cancel/item.skip/item.retry/
// resume response shapes. These contracts nest `$defs` off the schema root
// (not off a $id-addressable Request/Response pair), so build a wrapper that
// carries the response variant's shape plus the root `$defs` for `$ref`
// resolution instead of using `ajv.addSchema`.
// ─────────────────────────────────────────────────────────────────────────────

function responseSchema(fullSchema, testId) {
  return {
    $schema: "https://json-schema.org/draft/2020-12/schema",
    $id: `urn:test:${testId}`,
    oneOf: fullSchema.properties.response.oneOf,
    $defs: fullSchema.$defs,
  };
}

// T009: plan.apply response shape (success + failure).
const planApplySchema = loadSchema("specs/025-filesystem-plan-application/contracts/plan.apply.json");
const planApplyResponseSchema = responseSchema(planApplySchema, "plan-apply-response");

validate(
  "T009 plan.apply success response is valid",
  planApplyResponseSchema,
  {
    status: "success",
    contractVersion: "2.0.0",
    requestId,
    planId: "plan-001",
    runId: "run-001",
    newState: "applying",
  },
  true
);

validate(
  "T009 plan.apply failure response (plan.invalid_state) is valid",
  planApplyResponseSchema,
  {
    status: "failure",
    contractVersion: "2.0.0",
    requestId,
    errors: [{ code: "plan.invalid_state", message: "plan is not approved", currentState: "applying" }],
  },
  true
);

validate(
  "T009 DRIFT: plan.apply success without 'runId' must be rejected",
  planApplyResponseSchema,
  {
    status: "success",
    contractVersion: "2.0.0",
    requestId,
    planId: "plan-001",
    newState: "applying",
  },
  false
);

// T029 (spec 025): plan.cancel response shape.
const planCancelSchema = loadSchema("specs/025-filesystem-plan-application/contracts/plan.cancel.json");
const planCancelResponseSchema = responseSchema(planCancelSchema, "plan-cancel-response");

validate(
  "025-T029 plan.cancel success response is valid",
  planCancelResponseSchema,
  {
    status: "success",
    contractVersion: "2.0.0",
    requestId,
    planId: "plan-001",
    cancelledAt: "2026-07-09T00:00:00Z",
    itemsApplied: 3,
    itemsCancelled: 2,
  },
  true
);

validate(
  "025-T029 plan.cancel plan.not_in_apply failure response is valid",
  planCancelResponseSchema,
  {
    status: "failure",
    contractVersion: "2.0.0",
    requestId,
    errors: [{ code: "plan.not_in_apply", message: "plan is not applying or paused", currentState: "applied" }],
  },
  true
);

// T035: plan.item.skip response shape.
const planItemSkipSchema = loadSchema(
  "specs/025-filesystem-plan-application/contracts/plan.item.skip.json"
);
const planItemSkipResponseSchema = responseSchema(planItemSkipSchema, "plan-item-skip-response");

validate(
  "T035 plan.item.skip success response is valid",
  planItemSkipResponseSchema,
  { status: "success", contractVersion: "2.0.0", requestId, itemId: "item-001", newState: "skipped" },
  true
);

validate(
  "T035 plan.item.skip item.not_pending failure response is valid",
  planItemSkipResponseSchema,
  {
    status: "failure",
    contractVersion: "2.0.0",
    requestId,
    errors: [{ code: "item.not_pending", message: "item is not pending", currentItemState: "succeeded" }],
  },
  true
);

// T036: plan.item.retry response shape.
const planItemRetrySchema = loadSchema(
  "specs/025-filesystem-plan-application/contracts/plan.item.retry.json"
);
const planItemRetryResponseSchema = responseSchema(planItemRetrySchema, "plan-item-retry-response");

validate(
  "T036 plan.item.retry success response is valid",
  planItemRetryResponseSchema,
  { status: "success", contractVersion: "2.0.0", requestId, itemId: "item-001", newState: "applying" },
  true
);

validate(
  "T036 plan.item.retry item.not_failed failure response is valid",
  planItemRetryResponseSchema,
  {
    status: "failure",
    contractVersion: "2.0.0",
    requestId,
    errors: [{ code: "item.not_failed", message: "item is not failed", currentItemState: "pending" }],
  },
  true
);

// T048: plan.resume response shape — success and `run.not_paused` (the two
// paths actually implemented by `resume_plan`; see crates/app/core/src/plan_apply.rs).
// The re-validation failure codes (`volume.still.unavailable`, `disk.still.full`,
// `item.still.stale`) are schema-valid but NOT YET produced by the
// implementation — resume_plan's docstring documents trusting the caller for
// v1. Tracked as a follow-up (see tasks.md).
const planResumeSchema = loadSchema("specs/025-filesystem-plan-application/contracts/plan.resume.json");
const planResumeResponseSchema = responseSchema(planResumeSchema, "plan-resume-response");

validate(
  "T048 plan.resume success response is valid",
  planResumeResponseSchema,
  {
    status: "success",
    contractVersion: "2.0.0",
    requestId,
    planId: "plan-001",
    runId: "run-001",
    resumedAt: "2026-07-09T00:00:00Z",
  },
  true
);

validate(
  "T048 plan.resume run.not_paused failure response is valid",
  planResumeResponseSchema,
  {
    status: "failure",
    contractVersion: "2.0.0",
    requestId,
    errors: [{ code: "run.not_paused", message: "plan is not paused" }],
  },
  true
);

validate(
  "T048 plan.resume item.still.stale failure response is schema-valid (code reserved, not yet produced)",
  planResumeResponseSchema,
  {
    status: "failure",
    contractVersion: "2.0.0",
    requestId,
    errors: [{ code: "item.still.stale", message: "source file changed again while paused" }],
  },
  true
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
