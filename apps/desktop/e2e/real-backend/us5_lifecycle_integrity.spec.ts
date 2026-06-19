/**
 * Spec 033 US5 — Trustworthy project lifecycle (real-backend e2e)
 *
 * These tests verify that user-IPC and automatic lifecycle transitions both
 * read from the canonical `projects.lifecycle` table (migration 0036), that
 * `BlockedBanner` surfaces the typed blocked-reason kind from the real DTO,
 * and that auto transitions write audit rows.
 *
 * STATUS: Skipped pending T006 tauri-driver real-backend harness.
 *
 * Wiring status (spec 033 T050/T051/T052/T053/T054/T055 completed):
 *   [x] Migration 0036 — projects.lifecycle canonical table (D2)
 *   [x] Migration 0037 — typed blocked_reason_kind + blocked_reason_note
 *   [x] transition_use_case.rs re-pointed to projects.lifecycle (FR-019)
 *   [x] BlockedBanner DTO surfaces typed blocked_reason_kind (FR-020)
 *   [x] Auto block/ready/unarchive write audit rows; project.unarchived emitted (FR-021)
 *   [x] Lifecycle filter is multi-select (FR-022)
 *   [x] Rust unit tests (lifecycle_canonical.rs, transition_apply.rs) passing
 *
 * The Rust-level tests prove the single-table invariant and audit emission.
 * This e2e spec provides the real-UI round-trip layer: navigate to a project,
 * trigger a transition via the UI, assert the lifecycle pill updates.
 *
 * Blocked on: T006 (tauri-driver + WebKitWebDriver W3C session harness).
 *
 * See:
 *   - docs/development/autonomous-run-2026-06-validation-findings.md § T1-3
 *   - specs/033-validation-bugfix-remediation/tasks.md § T049, T050-T055
 *   - docs/development/test-strategy-033.md § J-4.2, § 009-4 through 009-8
 */
import { test, expect } from "@playwright/test";

test.describe("US5 · Project lifecycle integrity (real backend)", () => {
  test.skip(
    "009-4 · blockedReason in ProjectDetail comes from real DTO, not hardcoded user",
    async ({ page }) => {
      // Arrange: seed a project in blocked state with typed reason kind = "missing_calibration".
      // Act: navigate to the project detail page.
      // Assert: BlockedBanner renders "missing_calibration" (not hardcoded "user");
      //         the typed kind field is visible in the detail pane.
      void page;
      expect(true).toBe(false);
    },
  );

  test.skip(
    "009-5 · Auto-block writes audit row (not event-bus only)",
    async ({ page }) => {
      // Arrange: create a project; satisfy the condition that auto-blocks it.
      // Act: trigger the auto-block path via the real backend.
      // Assert: audit_events table has a row for the auto-block; projects.lifecycle
      //         column reflects the new state; both IPC and auto path read the
      //         same table row.
      void page;
      expect(true).toBe(false);
    },
  );

  test.skip(
    "009-6 · Single canonical lifecycle table (projects.lifecycle, not project.state)",
    async ({ page }) => {
      // Arrange: seed a project; apply a transition via user IPC.
      // Act: read lifecycle state from both the IPC response and a DB helper query.
      // Assert: both read the same projects.lifecycle row; no project.state column exists.
      void page;
      expect(true).toBe(false);
    },
  );

  test.skip(
    "009-7 · project.unarchived event emitted on unarchive transition",
    async ({ page }) => {
      // Arrange: seed a project in archived state.
      // Act: trigger unarchive via the lifecycle IPC.
      // Assert: project.unarchived event appears in the audit_events table;
      //         lifecycle pill in the project list updates.
      void page;
      expect(true).toBe(false);
    },
  );

  test.skip(
    "009-8 · Lifecycle filter multi-select (shows multiple states simultaneously)",
    async ({ page }) => {
      // Arrange: seed projects in processing, completed, archived states.
      // Act: select both processing and completed in the lifecycle filter.
      // Assert: both processing and completed rows appear; archived is hidden.
      void page;
      expect(true).toBe(false);
    },
  );
});
