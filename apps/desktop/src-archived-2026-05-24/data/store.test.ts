// Copyright (C) 2024-2026 Sjors Robroek
// SPDX-License-Identifier: AGPL-3.0-only

/**
 * T024 — vitest smoke test for the spec 002 read-side data layer.
 *
 * Verifies that:
 *  1. `useProvenance` returns the expected `{ data, loading, error }` shape
 *     for the dev-mode mock path (no Tauri runtime present).
 *  2. The hook signatures consumed by `ProjectsPage`, `PlanDetailPage`, and
 *     `InventoryPage` match the adapter exports — i.e. each consumed hook
 *     is callable with the documented argument list and yields a result
 *     with the documented properties.
 *
 * Tauri integration is intentionally NOT tested here — jsdom has no
 * `window.__TAURI_INTERNALS__`, which is exactly what the dev shim covers.
 */
import { describe, it, expect, beforeEach, expectTypeOf } from "vitest";
import { renderHook, act } from "@testing-library/react";

import {
  useProvenance,
  __resetProvenanceCacheForTests,
} from "./provenance";
import type { UseProvenanceResult } from "./provenance";
import type { AssetType, ProvenanceField, ProvenanceOrigin } from "../bindings";
import { isTauriRuntime } from "../api/lifecycle";

const VALID_ORIGINS: readonly ProvenanceOrigin[] = [
  "observed",
  "inferred",
  "reviewed",
  "generated",
  "planned",
  "applied",
];

beforeEach(() => {
  __resetProvenanceCacheForTests();
});

describe("isTauriRuntime in jsdom", () => {
  it("reports no Tauri runtime, so the dev shim is exercised", () => {
    expect(isTauriRuntime()).toBe(false);
  });
});

describe("useProvenance — dev-mode shape contract", () => {
  it("returns { data, loading, error } with data === ProvenanceField[] (sync path)", () => {
    const { result } = renderHook(() =>
      useProvenance("session-abc", "acquisition_session" satisfies AssetType),
    );
    // Dev shim resolves synchronously: loading is false on first render.
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeUndefined();
    expect(Array.isArray(result.current.data)).toBe(true);

    // If the synthesised payload has any rows, each row must satisfy the
    // contract shape and use one of the 6 documented origins.
    for (const row of result.current.data ?? []) {
      expect(typeof row.fieldPath).toBe("string");
      expect(typeof row.capturedAt).toBe("string");
      expect(VALID_ORIGINS).toContain(row.origin);
      expect(Array.isArray(row.history)).toBe(true);
      expect(typeof row.historyTruncated).toBe("boolean");
    }
  });

  it("returns an empty array for an unknown asset id (dev shim has no projection)", () => {
    const { result } = renderHook(() =>
      useProvenance("does-not-exist", "project" satisfies AssetType),
    );
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeUndefined();
    expect(result.current.data).toEqual([]);
  });

  it("respects optional `fieldPaths` filter on the dev shim", () => {
    const { result } = renderHook(() =>
      useProvenance("session-abc", "acquisition_session" satisfies AssetType, [
        "definitely.not.a.field",
      ]),
    );
    // Filter that matches no synthesised entries → empty list.
    expect(result.current.data).toEqual([]);
  });

  it("re-renders cleanly when the cache reset is invoked (no stale state)", () => {
    const { result, rerender } = renderHook(() =>
      useProvenance("session-abc", "acquisition_session" satisfies AssetType),
    );
    expect(result.current.loading).toBe(false);
    act(() => {
      __resetProvenanceCacheForTests();
    });
    rerender();
    expect(result.current.loading).toBe(false);
    expect(Array.isArray(result.current.data)).toBe(true);
  });
});

describe("useProvenance — type-level signature parity with component callers", () => {
  it("matches the (assetId, assetType, fieldPaths?) signature consumed by pages", () => {
    // ProjectsPage: useProvenance(projectId, "project")
    expectTypeOf(useProvenance).toBeCallableWith("p-1", "project");

    // PlanDetailPage: useProvenance(itemId, "filesystem_plan")
    expectTypeOf(useProvenance).toBeCallableWith("plan-item-1", "filesystem_plan");

    // InventoryPage: useProvenance(sessionId, "acquisition_session" | "calibration_session")
    expectTypeOf(useProvenance).toBeCallableWith("sess-1", "acquisition_session");
    expectTypeOf(useProvenance).toBeCallableWith("sess-1", "calibration_session");

    // Optional fieldPaths filter must be a string array.
    expectTypeOf(useProvenance).toBeCallableWith("p-1", "project", ["foo", "bar"]);

    // Return shape must be `UseProvenanceResult`.
    expectTypeOf<ReturnType<typeof useProvenance>>().toEqualTypeOf<UseProvenanceResult>();

    // And `data` must be `ProvenanceField[] | undefined`.
    expectTypeOf<UseProvenanceResult["data"]>().toEqualTypeOf<
      ProvenanceField[] | undefined
    >();
  });
});
