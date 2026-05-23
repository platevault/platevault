/**
 * T042 — vitest coverage for the spec 002 write-side store seam.
 *
 * Verifies that:
 *  1. Refused transitions surface in `useRefusals()` with the correct
 *     `code`, and that `refusalBucket()` classifies each documented refusal
 *     code into `needsAction` vs `needsAttention`.
 *  2. `usePendingPlansCount` partitions both plan states and refusals into
 *     the right bucket, including the plan-state-only paths (`draft`,
 *     `ready_for_review`, `approved` → action; `failed`, `partially_applied`
 *     → attention).
 *  3. In the dev harness (no `__TAURI_INTERNALS__`, stripped by
 *     `vitest.setup.ts`), `setProjectLifecycle` pushes a synthetic
 *     `dev_fallback` refusal AND still applies the legacy mock mutation so
 *     the demo continues to advance state.
 *
 * Implementation note: the store mutates module-level publishers. We import
 * fresh via `vi.resetModules()` in `beforeEach` so each test starts from a
 * known seed and refusal sequence.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";

import type { TransitionErrorCode } from "../bindings";

// Stand-in mock for the lifecycle adapter. The store's dev-harness branch
// short-circuits before reaching these (no `__TAURI_INTERNALS__`), so the
// mocks exist only to ensure no real Tauri command attempts to fire.
vi.mock("../api/lifecycle", async () => {
  const actual = await vi.importActual<typeof import("../api/lifecycle")>(
    "../api/lifecycle",
  );
  return {
    ...actual,
    // Force the dev path even if a test forgets to strip the bridge.
    isTauriRuntime: () => false,
    applyTransition: vi.fn(async () => {
      throw new actual.NotInTauriRuntimeError("lifecycleTransitionApply");
    }),
    previewTransition: vi.fn(async () => {
      throw new actual.NotInTauriRuntimeError("lifecycleTransitionPreview");
    }),
  };
});

type StoreModule = typeof import("./store");

async function freshStore(): Promise<StoreModule> {
  vi.resetModules();
  return (await import("./store")) as StoreModule;
}

beforeEach(() => {
  // Belt-and-braces: vitest.setup.ts already strips __TAURI_INTERNALS__,
  // but a future test could install it. Reset both module graph and the
  // bridge marker so each test starts cold.
  if (typeof window !== "undefined") {
    delete (window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__;
  }
});

afterEach(() => {
  vi.clearAllMocks();
});

// ----------------------------------------------------------------------------
// 1. refusalBucket — exhaustive code → bucket map
// ----------------------------------------------------------------------------

describe("refusalBucket", () => {
  it.each([
    ["plan.required", "needsAction"],
    ["plan.not_approved", "needsAction"],
    ["provenance.unreviewed", "needsAction"],
    ["entity.not_found", "needsAction"],
    ["transition.refused", "needsAttention"],
    ["actor.not_authorised", "needsAttention"],
    ["dev_fallback", "needsAttention"],
  ] as ReadonlyArray<[TransitionErrorCode | "dev_fallback", "needsAction" | "needsAttention"]>)(
    "%s → %s",
    async (code, bucket) => {
      const store = await freshStore();
      expect(store.refusalBucket(code)).toBe(bucket);
    },
  );
});

// ----------------------------------------------------------------------------
// 2. Refused-edge UI projection
// ----------------------------------------------------------------------------

describe("setProjectLifecycle — refused edges surface refusals", () => {
  it("rejects an illegal transition with code `transition.refused` (needsAttention)", async () => {
    const store = await freshStore();
    // Seed project `prj-m101` ships in lifecycle "processing". The transition
    // map (see store.ts) does NOT permit processing → ready, so this edge
    // is refused before any Tauri call.
    const hook = renderHook(() => store.useRefusals());
    act(() => {
      store.setProjectLifecycle("prj-m101", "ready");
    });
    const refusals = hook.result.current;
    expect(refusals.length).toBeGreaterThan(0);
    const latest = refusals[0];
    expect(latest.code).toBe("transition.refused");
    expect(latest.entityType).toBe("project");
    expect(latest.entityId).toBe("prj-m101");
    expect(store.refusalBucket(latest.code)).toBe("needsAttention");
  });

  it("pushes a `dev_fallback` refusal (needsAttention) on a legal transition in the dev harness", async () => {
    const store = await freshStore();
    const hook = renderHook(() => store.useRefusals());
    // prj-m101 (processing) → completed is a legal transition; in the dev
    // harness the store emits a `dev_fallback` refusal and still applies
    // the local mock mutation.
    act(() => {
      store.setProjectLifecycle("prj-m101", "completed");
    });
    const refusals = hook.result.current;
    expect(refusals.length).toBeGreaterThan(0);
    expect(refusals[0].code).toBe("dev_fallback");
    expect(store.refusalBucket(refusals[0].code)).toBe("needsAttention");
  });
});

describe("setSessionReviewState — dev-fallback path", () => {
  it("pushes `dev_fallback` and advances local state when a session review changes", async () => {
    const store = await freshStore();
    // Discover any session id from the seed inventory so the test does not
    // depend on hand-rolled fixtures.
    const seedSource = store.getInventorySources()[0];
    const seedSession = seedSource?.sessions[0];
    if (!seedSession) {
      throw new Error("expected at least one seed inventory session");
    }
    // Pick any state different from the seed value so the no-op short-circuit
    // doesn't swallow the call.
    const nextState =
      seedSession.state === "needs_review" ? "confirmed" : "needs_review";

    const hook = renderHook(() => store.useRefusals());
    act(() => {
      store.setSessionReviewState(seedSession.id, nextState);
    });

    const refusals = hook.result.current;
    expect(refusals[0].code).toBe("dev_fallback");
    expect(refusals[0].entityType).toBe("inventory_session");
    expect(refusals[0].entityId).toBe(seedSession.id);

    // Legacy mock mutation should have applied alongside the refusal.
    const after = store
      .getInventorySources()
      .flatMap((src) => src.sessions)
      .find((s) => s.id === seedSession.id);
    expect(after?.state).toBe(nextState);
  });
});

describe("simulateApply — dev-fallback path", () => {
  it("runs the legacy ticker without throwing in the dev harness", async () => {
    const store = await freshStore();
    const allPlans = renderHook(() => store.usePlans()).result.current;
    const target = allPlans[0];
    if (!target) {
      throw new Error("expected at least one seed plan");
    }
    // simulateApply's dev-harness branch calls runSimulateApply directly
    // (no refusal). The async ticker is fire-and-forget, but the call
    // itself must not throw.
    expect(() => store.simulateApply(target.id)).not.toThrow();
  });
});

// ----------------------------------------------------------------------------
// 3. usePendingPlansCount partition
// ----------------------------------------------------------------------------

describe("usePendingPlansCount partition", () => {
  it("counts seed plan states into action/attention buckets", async () => {
    const store = await freshStore();
    const plans = renderHook(() => store.usePlans()).result.current;
    const expectedAction = plans.filter(
      (p) =>
        p.state === "ready_for_review" ||
        p.state === "draft" ||
        p.state === "approved",
    ).length;
    const expectedAttention = plans.filter(
      (p) => p.state === "failed" || p.state === "partially_applied",
    ).length;

    const counts = renderHook(() => store.usePendingPlansCount()).result.current;
    expect(counts.needsAction).toBe(expectedAction);
    expect(counts.needsAttention).toBe(expectedAttention);
  });

  it("adds a `dev_fallback` refusal to `needsAttention` only", async () => {
    const store = await freshStore();
    const before = renderHook(() => store.usePendingPlansCount()).result.current;

    // Trigger a legal transition in the dev harness → emits dev_fallback.
    act(() => {
      store.setProjectLifecycle("prj-m101", "completed");
    });

    const after = renderHook(() => store.usePendingPlansCount()).result.current;
    expect(after.needsAttention).toBe(before.needsAttention + 1);
    expect(after.needsAction).toBe(before.needsAction);
  });

  it("adds a `transition.refused` refusal to `needsAttention` only", async () => {
    const store = await freshStore();
    const before = renderHook(() => store.usePendingPlansCount()).result.current;

    // Illegal transition: processing → ready is not in the allow-map.
    act(() => {
      store.setProjectLifecycle("prj-m101", "ready");
    });

    const after = renderHook(() => store.usePendingPlansCount()).result.current;
    expect(after.needsAttention).toBe(before.needsAttention + 1);
    expect(after.needsAction).toBe(before.needsAction);
  });

  it("partitions multiple refusal codes correctly across both buckets", async () => {
    const store = await freshStore();

    // Drive two independent refusals: one needsAttention (illegal edge on
    // prj-m101) and one needsAttention (dev_fallback on prj-andromeda
    // legal edge). Then verify the counts move by exactly the expected
    // amount in each bucket.
    const before = renderHook(() => store.usePendingPlansCount()).result.current;

    act(() => {
      store.setProjectLifecycle("prj-m101", "ready"); // illegal → refused
      store.setProjectLifecycle("prj-andromeda", "processing"); // legal → dev_fallback
    });

    const after = renderHook(() => store.usePendingPlansCount()).result.current;
    expect(after.needsAttention).toBe(before.needsAttention + 2);
    expect(after.needsAction).toBe(before.needsAction);
  });
});

// ----------------------------------------------------------------------------
// 4. Dev-harness verification — Tauri bridge absent
// ----------------------------------------------------------------------------

describe("dev harness — Tauri bridge absent", () => {
  it("`isTauriRuntime()` reports false so the dev fallback branch is taken", async () => {
    const { isTauriRuntime } = await import("../api/lifecycle");
    expect(isTauriRuntime()).toBe(false);
  });

  it("setProjectLifecycle pushes `dev_fallback` AND advances the project lifecycle locally", async () => {
    const store = await freshStore();
    const projects = renderHook(() => store.useProjects()).result.current;
    const target = projects.find((p) => p.id === "prj-m101");
    if (!target) throw new Error("expected seed project prj-m101");
    expect(target.lifecycle).toBe("processing");

    const refusals = renderHook(() => store.useRefusals());
    act(() => {
      store.setProjectLifecycle("prj-m101", "completed");
    });

    // Refusal projected
    expect(refusals.result.current[0].code).toBe("dev_fallback");

    // Local mutation applied
    const updated = renderHook(() => store.useProjects()).result.current.find(
      (p) => p.id === "prj-m101",
    );
    expect(updated?.lifecycle).toBe("completed");
  });
});
