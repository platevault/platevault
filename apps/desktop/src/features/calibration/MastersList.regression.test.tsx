/// <reference types="@testing-library/jest-dom" />
/**
 * Regression R-2 — MastersList renders with null/undefined fingerprints.
 *
 * Before the 2026-06-17 fix, `MastersList.tsx:126` threw:
 *   `Cannot read properties of undefined (reading 'gain')`
 * when mapping master dimensions for a master whose `fingerprint` field was
 * null, undefined, or had any numeric field missing. This crashed the
 * `/calibration` screen for every real user (the Calibration ledger is
 * unreachable until this is fixed).
 *
 * Fix: `MastersList.tsx` now null-guards every `fingerprint` field with
 * optional chaining (`fp?.gain`) and a null check before formatting.
 *
 * This test pins that behaviour so it cannot silently regress.
 * It is intentionally separate from the main `MastersList.test.tsx` suite
 * so it is easy to identify as a regression guard.
 *
 * Verification layers:
 *   VC  — vitest component (this file)
 *
 * See:
 *   - docs/development/autonomous-run-2026-06-validation-findings.md § R-2
 *   - docs/development/test-strategy-033.md § J-3.2
 *   - apps/desktop/src/features/calibration/MastersList.tsx  (fp?.gain null-guard)
 */

import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { MastersList } from "./MastersList";
import type { CalibrationMaster } from "@/bindings/types";

// ── Fixtures — null and incomplete fingerprints ────────────────────────────

/**
 * A master with `fingerprint: null`.
 * This is the exact shape that triggered the original crash when the
 * calibration masters list/get returned real (not fixture) rows with no
 * fingerprint populated.
 */
const masterWithNullFingerprint: CalibrationMaster = {
  id: "reg-r2-null",
  kind: "dark",
  fingerprint: null as unknown as CalibrationMaster["fingerprint"],
  source_session_id: "ses-001",
  created_at: "2026-01-01T00:00:00Z",
  age_days: 45,
  size_bytes: 64 * 1024 * 1024,
  used_by_session_ids: [],
  used_by_project_ids: [],
};

/**
 * A master with `fingerprint: undefined`.
 * Equivalent scenario — the backend might omit the field entirely.
 */
const masterWithUndefinedFingerprint: CalibrationMaster = {
  id: "reg-r2-undef",
  kind: "flat",
  fingerprint: undefined as unknown as CalibrationMaster["fingerprint"],
  source_session_id: "ses-002",
  created_at: "2026-02-01T00:00:00Z",
  age_days: 10,
  size_bytes: 32 * 1024 * 1024,
  used_by_session_ids: [],
  used_by_project_ids: [],
};

/**
 * A master whose fingerprint exists but has all numeric fields undefined.
 * Exercises the per-field optional chaining guards.
 */
const masterWithSparseFingerprint: CalibrationMaster = {
  id: "reg-r2-sparse",
  kind: "bias",
  fingerprint: {
    camera: "ASI2600MM",
    // gain, temp_c, exposure_s, binning all missing — the original crash site
    gain: undefined as unknown as number,
    temp_c: undefined as unknown as number,
    exposure_s: undefined as unknown as number,
    binning: undefined as unknown as string,
  },
  source_session_id: "ses-003",
  created_at: "2026-03-01T00:00:00Z",
  age_days: 5,
  size_bytes: 8 * 1024 * 1024,
  used_by_session_ids: [],
  used_by_project_ids: [],
};

// ── Tests ──────────────────────────────────────────────────────────────────

describe("MastersList R-2 regression · null/undefined fingerprints", () => {
  it("R-2.1 · renders without crashing when fingerprint is null", () => {
    // This is the exact crash condition from the original bug report.
    // The component must not throw even if fingerprint is null.
    expect(() => {
      render(
        <MastersList
          masters={[masterWithNullFingerprint]}
          loading={false}
          error={undefined}
          selected={null}
          onSelect={vi.fn()}
        />,
      );
    }).not.toThrow();

    // The DARKS group should be rendered (the master has kind='dark').
    expect(screen.getByText("DARKS")).toBeInTheDocument();
  });

  it("R-2.2 · renders without crashing when fingerprint is undefined", () => {
    expect(() => {
      render(
        <MastersList
          masters={[masterWithUndefinedFingerprint]}
          loading={false}
          error={undefined}
          selected={null}
          onSelect={vi.fn()}
        />,
      );
    }).not.toThrow();

    expect(screen.getByText("FLATS")).toBeInTheDocument();
  });

  it("R-2.3 · renders without crashing when all fingerprint numeric fields are undefined", () => {
    expect(() => {
      render(
        <MastersList
          masters={[masterWithSparseFingerprint]}
          loading={false}
          error={undefined}
          selected={null}
          onSelect={vi.fn()}
        />,
      );
    }).not.toThrow();

    expect(screen.getByText("BIAS")).toBeInTheDocument();
  });

  it("R-2.4 · renders a mixed list including null-fingerprint and normal masters without crash", () => {
    const normalMaster: CalibrationMaster = {
      id: "normal-dark",
      kind: "dark",
      fingerprint: {
        camera: "ASI2600MM",
        gain: 100,
        temp_c: -10,
        exposure_s: 300,
        binning: "1x1",
      },
      source_session_id: "ses-004",
      created_at: "2026-04-01T00:00:00Z",
      age_days: 20,
      size_bytes: 128 * 1024 * 1024,
      used_by_session_ids: [],
      used_by_project_ids: [],
    };

    expect(() => {
      render(
        <MastersList
          masters={[masterWithNullFingerprint, normalMaster]}
          loading={false}
          error={undefined}
          selected={null}
          onSelect={vi.fn()}
        />,
      );
    }).not.toThrow();

    // Both masters are in the DARKS group; the group header appears once.
    expect(screen.getByText("DARKS")).toBeInTheDocument();
  });

  it("R-2.5 · null-fingerprint master does not render gain/temp/exp text (graceful empty)", () => {
    render(
      <MastersList
        masters={[masterWithNullFingerprint]}
        loading={false}
        error={undefined}
        selected={null}
        onSelect={vi.fn()}
      />,
    );

    // The camera name from the fingerprint-fallback logic should not throw.
    // We just assert no crash above; here we also confirm no "undefined"
    // text leaks into the rendered output.
    const allText = document.body.textContent ?? "";
    expect(allText).not.toContain("undefined");
    expect(allText).not.toContain("NaN");
  });
});
