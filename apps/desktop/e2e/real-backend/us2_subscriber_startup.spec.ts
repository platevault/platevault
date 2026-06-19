/**
 * Spec 033 US2 — Subscriber startup wiring (real-backend e2e)
 *
 * These tests verify that the event-bus subscribers that were built but
 * never spawned at startup actually fire on the real application.
 *
 * STATUS: All tests are skipped pending spec 033 implementation (US2 wiring pass).
 * Do NOT unskip until the following subscribers are started in run_app:
 *   - spawn_workflow_run_subscriber (024 manifests)
 *   - artifact watcher loop (012)
 *   - guided auto-advance (010)
 *
 * Note: start_inbox_plan_listener and start_log_forwarder ARE already spawned
 * (fixed 2026-06-17). Those are covered by the R-3 regression test.
 *
 * See:
 *   - docs/development/autonomous-run-2026-06-validation-findings.md § theme #1
 *   - docs/development/test-strategy-033.md § J-2.8, J-6.4, 012-4, 024-3
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
