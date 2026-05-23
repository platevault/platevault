/**
 * In-memory store for plans and logs.
 *
 * For the mockup we use a tiny pub/sub with `useSyncExternalStore` so React
 * stays in sync without pulling in a state library. When we wire the real
 * backend, the store layer is the seam — pages keep using these hooks and
 * the implementation switches to fetch/subscribe Tauri operations.
 */

import { useSyncExternalStore } from "react";
import {
  inboxItems,
  inventorySources as seedSources,
  plans as seedPlans,
  logEntries as seedLogs,
  projects as seedProjects,
  seedAuditEvents,
  type AuditEvent,
  type AuditEventKind,
  type InboxItem,
  type InventorySession,
  type InventorySource,
  type Plan,
  type PlanItem,
  type PlanState,
  type Project,
  type ProjectLifecycle,
} from "./mock";
import type { LogEntry } from "../ui/LogPanel";
import {
  applyTransition,
  CONTRACT_VERSION,
  isTauriRuntime,
  newRequestId,
  NotInTauriRuntimeError,
  previewTransition,
  type TransitionRequest,
} from "../api/lifecycle";
import type {
  TransitionErrorCode,
  TransitionResponse_Serialize,
} from "../bindings";

// ---------- spec 002 refusal projection ----------

/**
 * Surface a recent `TransitionRefusal` to the UI so subscribers can render an
 * inline reason without throwing. Refusals are *expected* control flow per
 * spec 002 — they should never short-circuit React rendering.
 *
 * `dev_fallback` is emitted when the call could not reach Tauri at all (we're
 * running in the `pnpm dev` browser harness). It is kept distinct from a real
 * backend refusal so the UI can show "running against mock" vs "backend said
 * no".
 */
export interface RefusalRecord {
  id: string;
  at: string;
  entityType: string;
  entityId: string;
  code: TransitionErrorCode | "dev_fallback";
  message: string;
  blockingFields?: string[];
}

// Publisher is declared below; we delay instantiation by deferring with a
// lazy getter. To avoid temporal dead zone with const ordering, we move the
// `Publisher` class definition above (already done at line 33) — this section
// is positioned after it logically.

export function useRefusals(): RefusalRecord[] {
  return useSyncExternalStore(refusalsPub.subscribe, refusalsPub.getSnapshot);
}

function pushRefusal(entry: Omit<RefusalRecord, "id" | "at">): RefusalRecord {
  const record: RefusalRecord = {
    id: `refusal-${++refusalSeq}`,
    at: new Date().toISOString(),
    ...entry,
  };
  // newest-first, cap at 100
  refusalsPub.set([record, ...refusalsPub.snapshot].slice(0, 100));
  return record;
}

/**
 * Bucket a refusal code into actionable vs informational. The split mirrors
 * what the UI surfaces to the user: codes that require an explicit follow-up
 * (generate a plan, fill in fields, look up a missing entity) go into
 * `needsAction`; codes that describe *why* the system declined but require no
 * user remediation (illegal transition, system actor rejected) go into
 * `needsAttention`.
 */
export function refusalBucket(
  code: TransitionErrorCode | "dev_fallback",
): "needsAction" | "needsAttention" {
  switch (code) {
    case "plan.required":
    case "plan.not_approved":
    case "provenance.unreviewed":
    case "entity.not_found":
      return "needsAction";
    case "transition.refused":
    case "actor.not_authorised":
    case "dev_fallback":
      return "needsAttention";
  }
}

/**
 * Refusal-aware result envelope for write helpers that previously returned
 * `void`. The legacy callers still see `void`; new subscribers can read
 * the projection via `useRefusals()`.
 */
export type TransitionOutcome =
  | { ok: true; appliedAt: string | null; newState: string | null }
  | { ok: false; refusal: RefusalRecord };

/**
 * Extract `blockingFields` from a refusal's `details` payload (set for
 * `provenance_unreviewed`).
 */
function extractBlockingFields(details: unknown): string[] | undefined {
  if (details && typeof details === "object" && "blocking_fields" in details) {
    const raw = (details as { blocking_fields: unknown }).blocking_fields;
    if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) {
      return raw as string[];
    }
  }
  if (details && typeof details === "object" && "blockingFields" in details) {
    const raw = (details as { blockingFields: unknown }).blockingFields;
    if (Array.isArray(raw) && raw.every((x) => typeof x === "string")) {
      return raw as string[];
    }
  }
  return undefined;
}

function projectResponse(
  resp: TransitionResponse_Serialize,
  entityType: string,
  entityId: string,
): TransitionOutcome {
  if (resp.status === "error" && resp.error) {
    const refusal = pushRefusal({
      entityType,
      entityId,
      code: resp.error.code,
      message: resp.error.message,
      blockingFields: extractBlockingFields(resp.error.details),
    });
    return { ok: false, refusal };
  }
  return {
    ok: true,
    appliedAt: resp.appliedAt ?? null,
    newState: resp.newState ?? null,
  };
}

function projectDevFallback(
  entityType: string,
  entityId: string,
  message: string,
): TransitionOutcome {
  const refusal = pushRefusal({
    entityType,
    entityId,
    code: "dev_fallback",
    message,
  });
  return { ok: false, refusal };
}

// ---------- generic publisher ----------

class Publisher<T> {
  private listeners = new Set<() => void>();
  constructor(public snapshot: T) {}
  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  };
  getSnapshot = () => this.snapshot;
  set(value: T) {
    this.snapshot = value;
    this.listeners.forEach((l) => l());
  }
}

// ---------- spec 002 refusal publisher ----------
// Declared here (after Publisher) but used by the projection helpers above.
const refusalsPub = new Publisher<RefusalRecord[]>([]);
let refusalSeq = 0;

// ---------- plans ----------

const plansPub = new Publisher<Plan[]>(seedPlans);

export function usePlans(): Plan[] {
  return useSyncExternalStore(plansPub.subscribe, plansPub.getSnapshot);
}

export function getPlanById(id: string): Plan | undefined {
  return plansPub.snapshot.find((p) => p.id === id);
}

function nextPlanNumber(): number {
  return (
    plansPub.snapshot.reduce((max, p) => (p.number > max ? p.number : max), 0) + 1
  );
}

function nowHHMM(): string {
  const d = new Date();
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function tokenPattern(): string {
  // For now, library default. Will read from settings store later.
  return "{target}/{filter}/{date}/{frame_type}/";
}

function inferTargetForInbox(item: InboxItem): string | null {
  // crude: look at sample files for target hints; fallback to "M101" for known mock
  if (item.id === "ibx-raw-2026-04") return "M101";
  if (item.id === "ibx-raw-2026-05") return "M101";
  return null;
}

function destinationFor(
  rootPath: string,
  target: string | null,
  filter: string | null,
  date: string,
  frameType: string,
  filename: string,
): string {
  const segs: string[] = [];
  if (frameType === "light") {
    segs.push(target ?? "unclassified");
    segs.push(filter ?? "noFilter");
    segs.push(date);
    segs.push("lights");
  } else {
    segs.push("calibration");
    segs.push(`${frameType}s`);
    if (filter) segs.push(filter);
  }
  return `${rootPath}/${segs.join("/")}/${filename}`;
}

const ACTIVE_PLAN_STATES: PlanState[] = [
  "draft",
  "ready_for_review",
  "approved",
  "applying",
];

/**
 * Find an existing open plan for an Inbox item by its origin path.
 * Used to short-circuit duplicate "Generate plan" / "Confirm" clicks.
 */
export function findOpenPlanForInbox(item: InboxItem): Plan | undefined {
  return plansPub.snapshot.find(
    (p) => p.originPath === item.path && ACTIVE_PLAN_STATES.includes(p.state),
  );
}

/**
 * Create a draft plan from an Inbox item. The plan generator is contextual:
 * - mixed type → split plan covering every breakdown kind
 * - single type → confirm-to-inventory plan routing all files via the pattern
 *
 * Generates one plan item per file (capped at the inbox row's file count).
 * For demo realism every 30th file is injected as a failure so the retry-plan
 * surface is exercisable.
 */
export function createPlanFromInbox(item: InboxItem): Plan {
  const number = nextPlanNumber();
  const target = inferTargetForInbox(item);
  const date = new Date().toISOString().slice(0, 10);
  const rootPath = item.path.replace(/\/inbox\/.*/, "");
  const planType: Plan["type"] = item.type === "mixed" ? "split" : "restructure";

  const items: PlanItem[] = [];

  if (item.type === "mixed" && item.mixedBreakdown) {
    let idx = 1;
    for (const breakdown of item.mixedBreakdown) {
      for (let i = 0; i < breakdown.count; i++) {
        const filename = `${breakdown.kind}_${String(i + 1).padStart(3, "0")}.fit`;
        items.push({
          id: `pi-${number}-${idx}`,
          index: idx++,
          name: filename,
          action: "move",
          from: `${item.path}/${filename}`,
          to: destinationFor(rootPath, target, "Ha", date, breakdown.kind, filename),
          reason: `classified as ${breakdown.kind}; pattern ${tokenPattern()}`,
          protection: "normal",
          state: "pending",
          provenance: [
            { label: "classify", value: `${breakdown.kind} (confidence ~0.95)` },
          ],
        });
      }
    }
  } else {
    // Expand from sample files to the full file count via the pattern
    const filter = item.sampleFiles?.[0]?.filter ?? null;
    const exposure = item.sampleFiles?.[0]?.exposure ?? null;
    for (let i = 1; i <= item.files; i++) {
      const baseName = item.sampleFiles?.[0]?.name ?? `${item.type}_001.fit`;
      const prefix = baseName.replace(/_\d+\.fit$/, "_");
      const filename = `${prefix}${String(i).padStart(3, "0")}.fit`;
      items.push({
        id: `pi-${number}-${i}`,
        index: i,
        name: filename,
        action: "move",
        from: `${item.path}/${filename}`,
        to: destinationFor(rootPath, target, filter, date, item.type, filename),
        reason: `confirm to inventory via pattern ${tokenPattern()}`,
        protection: "normal",
        state: "pending",
        provenance: [
          { label: "type", value: item.type },
          exposure ? { label: "exposure", value: exposure } : null,
          filter ? { label: "filter", value: filter } : null,
        ].filter(Boolean) as Array<{ label: string; value: string }>,
      });
    }
  }

  const plan: Plan = {
    id: `plan-${number}`,
    number,
    title: item.type === "mixed" ? `Split ${item.path}` : `Confirm ${item.path}`,
    origin: "inbox",
    originPath: item.path,
    state: "ready_for_review",
    createdAt: nowHHMM(),
    items,
    itemsTotal: items.length,
    itemsApplied: 0,
    itemsFailed: 0,
    itemsPending: items.length,
    type: planType,
  };

  plansPub.set([plan, ...plansPub.snapshot]);
  appendLog({
    level: "info",
    source: `plan #${number}`,
    message: `draft created from inbox ${item.path} (${items.length} items)`,
  });
  return plan;
}

const PENDING_PROJECT_PLAN_STATES: PlanState[] = [
  "draft",
  "ready_for_review",
  "approved",
  "applying",
];

/**
 * Subscribe to plansPub and return the first plan whose origin is "project",
 * originPath matches projectId, and state is one of the pending states.
 */
export function usePendingPlanForProject(projectId: string): Plan | undefined {
  const all = usePlans();
  return all.find(
    (p) =>
      p.origin === "project" &&
      p.originPath === projectId &&
      PENDING_PROJECT_PLAN_STATES.includes(p.state),
  );
}

/**
 * Create a source-map plan for a project. Sets origin to "project", originPath
 * to the projectId, type to "restructure". Generates one item per ProjectSource
 * if available, otherwise synthesises 5 placeholder items.
 */
export function createSourceMapPlanForProject(projectId: string): Plan {
  const project = projectsPub.snapshot.find((p) => p.id === projectId);
  const number = nextPlanNumber();
  const name = project?.name ?? projectId;

  let items: PlanItem[];
  if (project && project.sources.length > 0) {
    items = project.sources.map((src, idx) => ({
      id: `pi-${number}-${idx + 1}`,
      index: idx + 1,
      name: src.name,
      action: "link" as const,
      from: `(inventory) ${src.inventoryId}`,
      to: `(project) ${projectId}/sources/${src.name}/`,
      reason: "source-map: link acquisition session into project source view",
      protection: "protected" as const,
      state: "pending" as const,
    }));
  } else {
    items = Array.from({ length: 5 }).map((_, idx) => ({
      id: `pi-${number}-${idx + 1}`,
      index: idx + 1,
      name: `source-${String(idx + 1).padStart(2, "0")}`,
      action: "link" as const,
      from: `(inventory) unknown-${idx + 1}`,
      to: `(project) ${projectId}/sources/source-${String(idx + 1).padStart(2, "0")}/`,
      reason: "source-map: synthesised placeholder — confirm before applying",
      protection: "normal" as const,
      state: "pending" as const,
    }));
  }

  const plan: Plan = {
    id: `plan-${number}`,
    number,
    title: `Project source-map ${name}`,
    origin: "project",
    originPath: projectId,
    state: "ready_for_review",
    createdAt: nowHHMM(),
    items,
    itemsTotal: items.length,
    itemsApplied: 0,
    itemsFailed: 0,
    itemsPending: items.length,
    type: "restructure",
  };

  plansPub.set([plan, ...plansPub.snapshot]);
  appendLog({
    level: "info",
    source: `plan #${number}`,
    message: `source-map plan created for project ${name} (${items.length} items)`,
  });
  return plan;
}

export function updatePlanState(id: string, state: PlanState) {
  plansPub.set(
    plansPub.snapshot.map((p) => (p.id === id ? { ...p, state } : p)),
  );
}

export function discardPlan(id: string) {
  plansPub.set(plansPub.snapshot.filter((p) => p.id !== id));
  appendLog({ level: "info", source: "plans", message: `plan #${id} discarded` });
}

/**
 * Spec 002 write-side seam: dry-run the plan transition first to surface any
 * refusals, then continue with the existing UI ticker. The ticker animates
 * what the backend would do; the preview call is the contract gate.
 *
 * Hook signature unchanged so callers (`PlanDetailPage`, command bar action)
 * continue to fire-and-forget.
 */
export function simulateApply(id: string): void {
  if (!isTauriRuntime()) {
    runSimulateApply(id);
    return;
  }

  const plan = getPlanById(id);
  if (!plan) return;

  // Treat "apply plan" as a plan-state transition driven by the user. The
  // actual semantic states for plans live in the bindings as plan-specific
  // variants; for the preview we infer from the current PlanState.
  const previewRequest: TransitionRequest = {
    plan: {
      entityType: "plan",
      contractVersion: CONTRACT_VERSION,
      requestId: newRequestId(),
      entityId: id,
      currentState: plan.state === "applying" ? "approved" : plan.state,
      nextState: "applying",
      actionLabel: "Apply plan",
      actor: "user",
    },
  };

  void previewTransition(previewRequest)
    .then((resp) => {
      const outcome = projectResponse(resp, "plan", id);
      if (outcome.ok) {
        runSimulateApply(id);
      }
    })
    .catch((err: unknown) => {
      if (err instanceof NotInTauriRuntimeError) {
        projectDevFallback("plan", id, err.message);
        runSimulateApply(id);
        return;
      }
      pushRefusal({
        entityType: "plan",
        entityId: id,
        code: "transition.refused",
        message: err instanceof Error ? err.message : String(err),
      });
    });
}

/**
 * Simulate apply progression: pending → applying → succeeded/failed item by
 * item, with the failed plan-41 staying failed.
 *
 * Safe to call on a plan that has previously been applied/cancelled — we
 * reset all non-failed items back to pending so the counters don't drift.
 */
function runSimulateApply(id: string): void {
  const plan = getPlanById(id);
  if (!plan) return;
  if (plan.items.length === 0) {
    // No materialised items (seed plans, future variants). Treat as a no-op
    // apply that immediately succeeds, but still log + reset counters so the
    // audit surface reflects the action.
    plansPub.set(
      plansPub.snapshot.map((p) =>
        p.id === id
          ? { ...p, state: "applied", itemsApplied: p.itemsTotal, itemsPending: 0, itemsFailed: 0 }
          : p,
      ),
    );
    appendLog({
      level: "info",
      source: `plan #${plan.number}`,
      message: `apply completed (no item-level preview available)`,
    });
    return;
  }

  // Reset prior progress to pending so a re-apply starts from a clean slate.
  // Items previously marked `failed` from a real (non-simulated) prior run
  // would be preserved here; for the simulator we just reset everything.
  plansPub.set(
    plansPub.snapshot.map((p) =>
      p.id === id
        ? {
            ...p,
            state: "applying",
            items: p.items.map((it) => ({ ...it, state: "pending" as const })),
            itemsApplied: 0,
            itemsFailed: 0,
            itemsPending: p.items.length,
          }
        : p,
    ),
  );
  appendLog({
    level: "info",
    source: `plan #${plan.number}`,
    message: `apply starting (${plan.items.length} items)`,
  });

  let cursor = 0;
  const tick = () => {
    const current = getPlanById(id);
    if (!current || current.state !== "applying") return;
    if (cursor >= current.items.length) {
      // Determine final state based on failure presence
      const anyFailed = current.items.some((i) => i.state === "failed");
      const allSucceeded = current.items.every((i) => i.state === "succeeded");
      const finalState: PlanState = allSucceeded
        ? "applied"
        : anyFailed
        ? current.items.filter((i) => i.state === "succeeded").length > 0
          ? "partially_applied"
          : "failed"
        : "applied";
      updatePlanState(id, finalState);
      appendLog({
        level: anyFailed ? "warn" : "info",
        source: `plan #${current.number}`,
        message: `apply finished — ${current.items.filter((i) => i.state === "succeeded").length}/${current.items.length} succeeded${anyFailed ? `, ${current.items.filter((i) => i.state === "failed").length} failed` : ""}`,
      });
      return;
    }
    // Inject a deterministic failure every ~30 items for demo realism
    const shouldFail = cursor > 0 && cursor % 30 === 0;
    const items = current.items.map((it, idx) => {
      if (idx !== cursor) return it;
      return shouldFail
        ? { ...it, state: "failed" as const, failureReason: "destination exists" }
        : { ...it, state: "succeeded" as const };
    });
    plansPub.set(
      plansPub.snapshot.map((p) =>
        p.id === id
          ? {
              ...p,
              items,
              itemsApplied: items.filter((i) => i.state === "succeeded").length,
              itemsFailed: items.filter((i) => i.state === "failed").length,
              itemsPending: items.filter((i) => i.state === "pending").length,
            }
          : p,
      ),
    );
    cursor++;
    setTimeout(tick, 240);
  };
  setTimeout(tick, 240);
}

// ---------- inbox count ----------

export function useInboxCount(): number {
  // For now, use the static mock list; will hook into a watched store later.
  return inboxItems.length;
}

/**
 * Surfaces what the user owes the system, partitioned for the Shell pill.
 *
 * Spec 002 (T041) folds in transition refusals on top of plan state:
 *
 * - `needsAction` (user must do something): plans in `draft` /
 *   `ready_for_review` / `approved`, plus refusals whose codes require
 *   explicit follow-up — `plan_required`, `plan_not_approved`,
 *   `provenance_unreviewed`, `entity_not_found`.
 * - `needsAttention` (informational / structural): plans that ended in
 *   `failed` or `partially_applied`, plus refusals whose codes describe a
 *   structural decline that needs no user remediation —
 *   `transition_refused`, `actor_not_authorised`, and the synthetic
 *   `dev_fallback` emitted by the browser dev harness.
 *
 * See `refusalBucket()` for the canonical refusal-code → bucket map.
 */
export function usePendingPlansCount(): {
  needsAction: number;
  needsAttention: number;
} {
  const all = usePlans();
  const refusals = useRefusals();
  const planAction = all.filter(
    (p) => p.state === "ready_for_review" || p.state === "draft" || p.state === "approved",
  ).length;
  const planAttention = all.filter(
    (p) => p.state === "failed" || p.state === "partially_applied",
  ).length;
  const refusalAction = refusals.filter(
    (r) => refusalBucket(r.code) === "needsAction",
  ).length;
  const refusalAttention = refusals.filter(
    (r) => refusalBucket(r.code) === "needsAttention",
  ).length;
  return {
    needsAction: planAction + refusalAction,
    needsAttention: planAttention + refusalAttention,
  };
}

// ---------- log ----------

const logPub = new Publisher<LogEntry[]>(seedLogs);

export function useLog(): LogEntry[] {
  return useSyncExternalStore(logPub.subscribe, logPub.getSnapshot);
}

// ---------- scan status (mocked) ----------

export interface ScanStatus {
  state: "idle" | "running" | "error";
  source: string;
  processed?: number;
  total?: number;
  message?: string;
}

const scanPub = new Publisher<ScanStatus>({
  state: "idle",
  source: "/Volumes/AstroDrive",
  message: "Scans up to date · 1247 files indexed",
});

export function useScanStatus(): ScanStatus {
  return useSyncExternalStore(scanPub.subscribe, scanPub.getSnapshot);
}

export function setScanStatus(s: ScanStatus) {
  scanPub.set(s);
}

/**
 * Mock-only: simulate a running scan that ticks for a few seconds, useful
 * to demo the inline progress affordance.
 */
export function simulateScan(source = "/Volumes/AstroDrive", total = 2380) {
  let processed = 0;
  scanPub.set({ state: "running", source, processed, total });
  const id = window.setInterval(() => {
    processed += Math.floor(40 + Math.random() * 80);
    if (processed >= total) {
      scanPub.set({
        state: "idle",
        source,
        message: `Scans up to date · ${total} files indexed`,
      });
      window.clearInterval(id);
      return;
    }
    scanPub.set({ state: "running", source, processed, total });
  }, 250);
}

let logSeq = seedLogs.length;
export function appendLog(entry: Omit<LogEntry, "id" | "time">) {
  const d = new Date();
  const time = `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}:${String(d.getSeconds()).padStart(2, "0")}`;
  const full: LogEntry = { id: `log-${++logSeq}`, time, ...entry };
  logPub.set([full, ...logPub.snapshot].slice(0, 500));
}

// ---------- projects ----------

const projectsPub = new Publisher<Project[]>(seedProjects);

export function useProjects(): Project[] {
  return useSyncExternalStore(projectsPub.subscribe, projectsPub.getSnapshot);
}

/**
 * Allowed forward + recovery transitions for project lifecycle.
 * - Forward path: setup_incomplete → ready → prepared → processing → completed → archived
 * - blocked is reachable from any active stage; recovery exits via `ready`
 * - archived is exited only via `processing` (resume work) — we do not jump
 *   straight back to `completed` because that would lie about the action.
 */
const PROJECT_TRANSITIONS: Record<ProjectLifecycle, ProjectLifecycle[]> = {
  setup_incomplete: ["ready", "blocked"],
  ready: ["prepared", "processing", "blocked"],
  prepared: ["ready", "processing", "blocked"],
  processing: ["completed", "blocked"],
  completed: ["archived", "processing"], // re-open by transitioning to processing
  archived: ["processing"], // unarchive by resuming
  blocked: ["ready", "prepared", "processing", "setup_incomplete"],
};

export interface LifecycleTransition {
  actionLabel: string;
  to: ProjectLifecycle;
}

export function isProjectTransitionAllowed(
  from: ProjectLifecycle,
  to: ProjectLifecycle,
): boolean {
  return PROJECT_TRANSITIONS[from]?.includes(to) ?? false;
}

function applyLocalProjectMutation(
  id: string,
  next: ProjectLifecycle,
  actionLabel: string | undefined,
  project: Project,
): void {
  const when = new Date().toISOString().slice(0, 16).replace("T", " ");
  const label =
    actionLabel ??
    (project.lifecycle === "archived" && next === "processing"
      ? "Unarchived"
      : `Marked ${next.replace(/_/g, " ")}`);
  projectsPub.set(
    projectsPub.snapshot.map((p) =>
      p.id === id
        ? { ...p, lifecycle: next, lastAction: { label, when } }
        : p,
    ),
  );
  appendLog({
    level: "info",
    source: `project ${project.name}`,
    message: `lifecycle ${project.lifecycle} → ${next}`,
  });
}

/**
 * Spec 002 write-side seam: drive a project lifecycle transition through the
 * Tauri `lifecycle.transition.apply` command when the runtime is available.
 *
 * The hook signature is preserved (return type stays `void`) so existing
 * component callers keep compiling. Refusals are projected into the refusal
 * store (`useRefusals`) and counted by `usePendingPlansCount`. Errors that
 * indicate we're not in Tauri (browser dev harness) silently fall back to the
 * legacy mock mutation so `pnpm dev` still demos.
 */
export function setProjectLifecycle(
  id: string,
  next: ProjectLifecycle,
  actionLabel?: string,
): void {
  const project = projectsPub.snapshot.find((p) => p.id === id);
  if (!project) return;
  if (project.lifecycle === next) return;
  if (!isProjectTransitionAllowed(project.lifecycle, next)) {
    appendLog({
      level: "warn",
      source: `project ${project.name}`,
      message: `transition refused: ${project.lifecycle} → ${next}`,
    });
    pushRefusal({
      entityType: "project",
      entityId: id,
      code: "transition.refused",
      message: `Illegal transition ${project.lifecycle} → ${next}`,
    });
    return;
  }

  if (!isTauriRuntime()) {
    projectDevFallback(
      "project",
      id,
      `Dev harness: ${project.lifecycle} → ${next} applied locally`,
    );
    applyLocalProjectMutation(id, next, actionLabel, project);
    return;
  }

  const request: TransitionRequest = {
    project: {
      entityType: "project",
      contractVersion: CONTRACT_VERSION,
      requestId: newRequestId(),
      entityId: id,
      currentState: project.lifecycle,
      nextState: next,
      actionLabel: actionLabel ?? null,
      actor: "user",
    },
  };

  void applyTransition(request)
    .then((resp) => {
      const outcome = projectResponse(resp, "project", id);
      if (outcome.ok) {
        applyLocalProjectMutation(id, next, actionLabel, project);
      }
    })
    .catch((err: unknown) => {
      if (err instanceof NotInTauriRuntimeError) {
        projectDevFallback("project", id, err.message);
        applyLocalProjectMutation(id, next, actionLabel, project);
        return;
      }
      pushRefusal({
        entityType: "project",
        entityId: id,
        code: "transition.refused",
        message: err instanceof Error ? err.message : String(err),
      });
    });
}

// ---------- inventory ----------

const sourcesPub = new Publisher<InventorySource[]>(seedSources);

export function useInventorySources(): InventorySource[] {
  return useSyncExternalStore(sourcesPub.subscribe, sourcesPub.getSnapshot);
}

export function getInventorySources() {
  return sourcesPub.snapshot;
}

/**
 * Mock-only: append a new inventory source from the empty-state CTA.
 * Generates a stable id from the path. Starts with zero sessions.
 */
export function addInventorySource(source: { path: string; kind: string }): void {
  const id = `src-${source.path.replace(/[^a-zA-Z0-9]/g, "-").toLowerCase().slice(0, 32)}-${Date.now()}`;
  const newSource: InventorySource = {
    id,
    path: source.path,
    kind: source.kind as InventorySource["kind"],
    state: "active",
    sessions: [],
  };
  sourcesPub.set([...sourcesPub.snapshot, newSource]);
  appendAuditEvent({
    kind: "source_added",
    actor: "user",
    summary: `Source ${source.path} registered (${source.kind.replace("_", " ")})`,
    details: { sourceId: id },
  });
  appendLog({
    level: "info",
    source: "inventory",
    message: `source ${source.path} registered`,
  });
}

export function remapInventorySource(sourceId: string, newPath: string): void {
  let oldPath: string | undefined;
  sourcesPub.set(
    sourcesPub.snapshot.map((src) => {
      if (src.id !== sourceId) return src;
      oldPath = src.path;
      return { ...src, path: newPath, state: "active" as const };
    }),
  );
  appendAuditEvent({
    kind: "source_remapped",
    actor: "user",
    summary: `Source remapped: ${oldPath ?? sourceId} → ${newPath}`,
    details: { sourceId, before: oldPath, after: newPath },
  });
  appendLog({
    level: "info",
    source: "inventory",
    message: `source ${sourceId} remapped to ${newPath}`,
  });
}

function applyLocalSessionMutation(
  sessionId: string,
  state: InventorySession["state"],
): void {
  let updatedName: string | null = null;
  let changed = false;
  sourcesPub.set(
    sourcesPub.snapshot.map((src) => ({
      ...src,
      sessions: src.sessions.map((sess) => {
        if (sess.id !== sessionId) return sess;
        if (sess.state === state) {
          // No-op: keep the same reference to avoid re-renders.
          return sess;
        }
        changed = true;
        updatedName = sess.name;
        return { ...sess, state };
      }),
    })),
  );
  if (changed && updatedName) {
    appendLog({
      level: "info",
      source: "inventory",
      message: `${updatedName} review → ${state.replace(/_/g, " ")}`,
    });
  }
}

function findSession(sessionId: string): InventorySession | undefined {
  for (const src of sourcesPub.snapshot) {
    const hit = src.sessions.find((s) => s.id === sessionId);
    if (hit) return hit;
  }
  return undefined;
}

/**
 * Spec 002 write-side seam: drive an inventory session review-state change
 * through `lifecycle.transition.apply`. Preserves the `void` return; refusals
 * land in `useRefusals()`.
 */
export function setSessionReviewState(
  sessionId: string,
  state: InventorySession["state"],
): void {
  const session = findSession(sessionId);
  if (!session) return;
  if (session.state === state) return;

  if (!isTauriRuntime()) {
    projectDevFallback(
      "inventory_session",
      sessionId,
      `Dev harness: review → ${state} applied locally`,
    );
    applyLocalSessionMutation(sessionId, state);
    return;
  }

  const request: TransitionRequest = {
    inventory_session: {
      entityType: "inventory_session",
      contractVersion: CONTRACT_VERSION,
      requestId: newRequestId(),
      entityId: sessionId,
      currentState: session.state,
      nextState: state,
      actionLabel: null,
      actor: "user",
    },
  };

  void applyTransition(request)
    .then((resp) => {
      const outcome = projectResponse(resp, "inventory_session", sessionId);
      if (outcome.ok) {
        applyLocalSessionMutation(sessionId, state);
      }
    })
    .catch((err: unknown) => {
      if (err instanceof NotInTauriRuntimeError) {
        projectDevFallback("inventory_session", sessionId, err.message);
        applyLocalSessionMutation(sessionId, state);
        return;
      }
      pushRefusal({
        entityType: "inventory_session",
        entityId: sessionId,
        code: "transition.refused",
        message: err instanceof Error ? err.message : String(err),
      });
    });
}

// ---------- audit log ----------

const auditPub = new Publisher<AuditEvent[]>(
  [...seedAuditEvents].sort(
    (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
  ),
);

export function useAuditLog(): AuditEvent[] {
  return useSyncExternalStore(auditPub.subscribe, auditPub.getSnapshot);
}

let auditSeq = seedAuditEvents.length;

export function appendAuditEvent(
  event: Omit<AuditEvent, "id" | "at"> & { at?: string },
): void {
  const id = `audit-gen-${++auditSeq}`;
  const at = event.at ?? new Date().toISOString();
  const full: AuditEvent = { id, at, kind: event.kind, actor: event.actor, summary: event.summary, details: event.details };
  // Prepend so newest-first order is maintained
  auditPub.set([full, ...auditPub.snapshot]);
}

// ---------- plan revalidation ----------

/**
 * Revalidate a plan against the current FS state then apply it.
 * For plan-42 (the 200-move inbox plan) injects a ~30% "stale" outcome so the
 * drift dialog surfaces during demos.  All other plans always resolve "applied".
 *
 * While the mock revalidation runs (1.2 s) the returned Promise stays pending —
 * callers should set a `validating` flag and clear it on resolution.
 */
export async function revalidateAndApply(
  planId: string,
  opts?: { force?: boolean },
): Promise<"applied" | "stale"> {
  await new Promise<void>((res) => setTimeout(res, 1200));

  const isStaleCandidate = planId === "plan-42" && !opts?.force;
  const outcome: "applied" | "stale" =
    isStaleCandidate && Math.random() < 0.3 ? "stale" : "applied";

  const plan = getPlanById(planId);
  const planLabel = plan ? `#${plan.number}` : planId;

  if (outcome === "stale") {
    appendAuditEvent({
      kind: "plan_failed",
      actor: "system",
      summary: `Plan ${planLabel} stale: 3 sources modified, 1 destination occupied`,
      details: { planId },
    });
  } else {
    simulateApply(planId);
    appendAuditEvent({
      kind: "plan_applied",
      actor: "user",
      summary: `Plan ${planLabel} applied`,
      details: { planId },
    });
  }

  return outcome;
}

// ---------- plan regeneration ----------

/**
 * Discard the given plan and create a new, slightly smaller plan with the same
 * origin/originPath/type — simulating a re-generate after drift resolution.
 */
export function regeneratePlan(planId: string): Plan {
  const old = getPlanById(planId);
  const number = nextPlanNumber();

  // Drop the last 2 items to simulate drift resolution
  const baseItems: PlanItem[] = old
    ? old.items.slice(0, Math.max(old.items.length - 2, 0)).map((it, idx) => ({
        ...it,
        id: `pi-${number}-${idx + 1}`,
        index: idx + 1,
        state: "pending" as const,
        failureReason: undefined,
      }))
    : [];

  const total = old ? Math.max(old.itemsTotal - 2, 0) : 0;

  const plan: Plan = {
    id: `plan-${number}`,
    number,
    title: old ? `${old.title} (regenerated)` : `Plan #${number}`,
    origin: old?.origin ?? "inbox",
    originPath: old?.originPath,
    state: "ready_for_review",
    createdAt: nowHHMM(),
    items: baseItems,
    itemsTotal: total,
    itemsApplied: 0,
    itemsFailed: 0,
    itemsPending: total,
    type: old?.type ?? "restructure",
  };

  // Discard old plan silently (without separate log — the audit event covers it)
  plansPub.set(plansPub.snapshot.filter((p) => p.id !== planId));
  // Insert new plan
  plansPub.set([plan, ...plansPub.snapshot]);

  appendAuditEvent({
    kind: "plan_discarded",
    actor: "user",
    summary: `Plan ${old ? `#${old.number}` : planId} discarded and regenerated as #${number}`,
    details: { planId },
  });
  appendLog({
    level: "info",
    source: `plan #${number}`,
    message: `regenerated from ${planId} (${total} items)`,
  });

  return plan;
}

// ---------- per-item failure resolution ----------

export function resolveFailedItem(
  planId: string,
  itemId: string,
  action: "skip" | "rename" | "overwrite",
  payload?: { to?: string },
): void {
  let plan = getPlanById(planId);
  if (!plan) return;

  const updatedItems = plan.items.map((it) => {
    if (it.id !== itemId) return it;
    if (action === "rename" && payload?.to) {
      return { ...it, to: payload.to, state: "succeeded" as const, failureReason: undefined };
    }
    // skip or overwrite: transition to succeeded
    return { ...it, state: "succeeded" as const, failureReason: undefined };
  });

  const newFailed = updatedItems.filter((i) => i.state === "failed").length;
  const newApplied = updatedItems.filter((i) => i.state === "succeeded").length;
  const newPending = updatedItems.filter((i) => i.state === "pending").length;

  // If no failures remain, transition plan state to applied
  const newPlanState: PlanState =
    newFailed === 0
      ? newPending === 0
        ? "applied"
        : plan.state
      : plan.state;

  plansPub.set(
    plansPub.snapshot.map((p) =>
      p.id === planId
        ? {
            ...p,
            items: updatedItems,
            itemsApplied: newApplied,
            itemsFailed: newFailed,
            itemsPending: newPending,
            state: newPlanState,
          }
        : p,
    ),
  );

  plan = getPlanById(planId);
  appendAuditEvent({
    kind: "plan_applied",
    actor: "user",
    summary: `Item ${itemId} in plan ${planId} resolved via ${action}`,
    details: { planId },
  });
  appendLog({
    level: "info",
    source: `plan ${planId}`,
    message: `item ${itemId} resolved: ${action}${payload?.to ? ` → ${payload.to}` : ""}`,
  });
}

// Re-export AuditEventKind so consumers can reference it without importing mock
export type { AuditEventKind };

// ---------- symlink support check (mock) ----------

/**
 * Mock-only: detect symlink support for the current platform.
 *
 * On non-Windows platforms (detected via navigator.userAgent), symlinks are
 * always supported.  On Windows the check randomly returns "disabled" (~50%)
 * or "not_supported" (~50%) to make both warning states exercisable during
 * the wizard walkthrough.
 */
export function checkSymlinkSupport(): "supported" | "not_supported" | "disabled" {
  const isWindows = typeof navigator !== "undefined" &&
    navigator.userAgent.toLowerCase().includes("windows");
  if (!isWindows) return "supported";
  return Math.random() < 0.5 ? "disabled" : "not_supported";
}
