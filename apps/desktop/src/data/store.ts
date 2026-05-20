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
 * Simulate apply progression: pending → applying → succeeded/failed item by
 * item, with the failed plan-41 staying failed.
 *
 * Safe to call on a plan that has previously been applied/cancelled — we
 * reset all non-failed items back to pending so the counters don't drift.
 */
export function simulateApply(id: string) {
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

export function usePendingPlansCount(): {
  needsAction: number;
  needsAttention: number;
} {
  const all = usePlans();
  const needsAction = all.filter(
    (p) => p.state === "ready_for_review" || p.state === "draft" || p.state === "approved",
  ).length;
  const needsAttention = all.filter(
    (p) => p.state === "failed" || p.state === "partially_applied",
  ).length;
  return { needsAction, needsAttention };
}

// ---------- log ----------

const logPub = new Publisher<LogEntry[]>(seedLogs);

export function useLog(): LogEntry[] {
  return useSyncExternalStore(logPub.subscribe, logPub.getSnapshot);
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

export function setProjectLifecycle(
  id: string,
  next: ProjectLifecycle,
  actionLabel?: string,
) {
  const project = projectsPub.snapshot.find((p) => p.id === id);
  if (!project) return;
  if (project.lifecycle === next) return;
  if (!isProjectTransitionAllowed(project.lifecycle, next)) {
    appendLog({
      level: "warn",
      source: `project ${project.name}`,
      message: `transition refused: ${project.lifecycle} → ${next}`,
    });
    return;
  }
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

// ---------- inventory ----------

const sourcesPub = new Publisher<InventorySource[]>(seedSources);

export function useInventorySources(): InventorySource[] {
  return useSyncExternalStore(sourcesPub.subscribe, sourcesPub.getSnapshot);
}

export function getInventorySources() {
  return sourcesPub.snapshot;
}

export function setSessionReviewState(
  sessionId: string,
  state: InventorySession["state"],
) {
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
