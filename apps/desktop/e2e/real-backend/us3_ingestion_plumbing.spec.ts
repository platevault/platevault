/**
 * Spec 033 US3 — Ingestion data plumbing (real-backend e2e)
 *
 * These tests verify that ingest → sessions → calibration → target flows
 * actually populate the data that enables dependent features.
 *
 * STATUS: All tests are skipped pending spec 033 US3 implementation.
 * The key gaps are:
 *   - inbox confirm does not set session root_id (006)
 *   - calibration_fingerprint / acquisition_fingerprint not populated from
 *     ingestion metadata (007)
 *   - target_id FK not populated from ingestion (023)
 *   - search.global returns fixture data regardless of query (023 T1-7)
 *
 * See:
 *   - docs/development/autonomous-run-2026-06-validation-findings.md § T1-7
 *   - docs/development/test-strategy-033.md § J-2.4, J-2.5, J-3.5, J-3.6, J-8.1
 */
import { test, expect } from "@playwright/test";

test.describe("US3 · Ingestion data plumbing (real backend)", () => {
  test.skip(
    "J-2.4 · Sessions appear grouped after inbox confirm (root_id set)",
    async ({ page }) => {
      // Arrange: seed an inbox item confirmed against a real library root.
      // Act: navigate to /sessions.
      // Assert: session appears in the list grouped by root; root_id is not null.
      void page;
      expect(true).toBe(false);
    },
  );

  test.skip(
    "J-3.5 · Calibration suggest returns real candidates after fingerprint population",
    async ({ page }) => {
      // Arrange: seed a light session with acquisition_fingerprint populated;
      //          seed a calibration master with matching fingerprint.
      // Act: invoke calibration.suggest for the session.
      // Assert: candidates list is non-empty and matches the seeded master.
      void page;
      expect(true).toBe(false);
    },
  );

  test.skip(
    "J-8.1 · search.global returns real target by name from DB",
    async ({ page }) => {
      // Arrange: seed a target row with a unique name.
      // Act: invoke search.global with that name.
      // Assert: result contains the target with matching name.
      void page;
      expect(true).toBe(false);
    },
  );

  test.skip(
    "J-8.2 · search.global matches on alias, returns aliased result",
    async ({ page }) => {
      // Arrange: seed a target with an alias; alias differs from primary name.
      // Act: invoke search.global with the alias.
      // Assert: result contains the target; sublabel surfaces the matched alias.
      void page;
      expect(true).toBe(false);
    },
  );
});
