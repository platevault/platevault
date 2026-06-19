/**
 * Spec 033 US2 — Subscriber startup wiring (real-backend e2e)
 *
 * These tests verify that the event-bus subscribers that were built but
 * never spawned at startup actually fire on the real application.
 *
 * STATUS: Tests remain skipped pending the T006 tauri-driver real-backend harness.
 * The Rust-level integration tests (T027/T028) prove the subscribers fire correctly.
 * These e2e tests (T024/T025) provide the real-UI layer once T006 is complete.
 *
 * Wiring status (spec 033 T027/T028/T029 completed):
 *   [x] spawn_workflow_run_subscriber → spawned in run_app (lib.rs)
 *   [x] artifact watcher loop         → spawn_artifact_watcher in run_app (lib.rs)
 *   [x] guided auto-advance           → startGuidedEventBridge (eventBridge.ts)
 *   [x] start_inbox_plan_listener     → already spawned (fixed 2026-06-17)
 *   [x] start_log_forwarder           → already spawned (fixed 2026-06-17)
 *
 * Blocked on: T006 (tauri-driver + WebKitWebDriver W3C session harness).
 *
 * See:
 *   - docs/development/autonomous-run-2026-06-validation-findings.md § theme #1
 *   - specs/033-validation-bugfix-remediation/tasks.md § T006, T024, T025
 */
import { test, expect } from "@playwright/test";

test.describe("US2 · Subscriber startup wiring (real backend)", () => {
  test.skip(
    "J-6.4 · Manifest auto-generates on workflow run completion",
    async () => {
      // Arrange: create a project with a completed workflow run in the DB.
      // Act: start the app (which should spawn spawn_workflow_run_subscriber).
      // Assert: within timeout, a manifest file appears on disk at the
      //         project root; the manifests table has a new row.
      expect(true).toBe(false);
    },
  );

  test.skip(
    "012-4 · Artifact watcher registers watch paths and fires artifact.detected",
    async () => {
      // Arrange: register a library root; start the app.
      // Act: drop a new FITS file into the watched root.
      // Assert: within timeout, an artifact row appears in the DB with
      //         state=detected; audit row written.
      expect(true).toBe(false);
    },
  );

  test.skip(
    "010-2 · Guided step advances on completeGuidedStep IPC",
    async () => {
      // Arrange: start the app with guided flow in inbox.confirm_first state.
      // Act: trigger the domain event that should advance the step
      //      (e.g. confirm an inbox item).
      // Assert: guided flow state advances to the next step in DB.
      expect(true).toBe(false);
    },
  );
});
