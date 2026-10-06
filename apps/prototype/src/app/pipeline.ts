/**
 * View pipeline (Harness V3, from direction C): one read-only derivation of
 * where a View stands, for the Work queue, the View workspace rail and the
 * inspector. It reads the same domain helpers the areas use and writes
 * nothing; every action it names is a route to the area that owns the real
 * control, so preview-then-confirm stays with that area.
 *
 * Stages are the View areas, in order. A gate is one of: done, ready (an
 * action is waiting for you), blocked (something must be fixed first),
 * running, advisory (worth doing, never blocks) or waiting (an earlier stage
 * decides). The Next action is the first ready or blocked stage, else the
 * first advisory one.
 */
import { membershipSummary, viewStatus } from "@/domain/derive"
import type { Catalog, Disk, View, ViewStatus } from "@/domain/types"
import type { AssignmentBasis } from "@/store/slices/t4"
import { contentOf, emptyContent, latestRevision } from "@/features/t3/model"
import { calibrationPlan } from "@/features/t4/domain"
import { formatDuration, plural } from "@/lib/format"

export type StageId = "sessions" | "frames" | "calibration" | "prepare" | "results" | "cleanup"
export type GateState = "done" | "ready" | "blocked" | "running" | "advisory" | "waiting"

export interface Stage {
  id: StageId
  /** The View area's own name (Sessions, Frames…). */
  label: string
  state: GateState
  /** One line: what the gate found. */
  gate: string
  /** The verb waiting here, when there is one. */
  action: string | null
}

export interface NextAction {
  stage: StageId
  label: string
  reason: string
  to: string
}

export interface Pipeline {
  stages: Stage[]
  /** The stage the Next action sits in, else the last done one. */
  current: StageId
  next: NextAction | null
  status: ViewStatus
}

export const STAGE_LABEL: Record<StageId, string> = {
  sessions: "Sessions",
  frames: "Frames",
  calibration: "Calibration",
  prepare: "Prepare",
  results: "Results",
  cleanup: "Cleanup",
}

export const GATE_LABEL: Record<GateState, string> = {
  done: "Done",
  ready: "Ready",
  blocked: "Blocked",
  running: "Running",
  advisory: "Advisory",
  waiting: "Waiting",
}

type Gate = Omit<Stage, "id" | "label">

export function viewPipeline(catalog: Catalog, disk: Disk, view: View, decisions: Record<string, AssignmentBasis>): Pipeline {
  const saved = latestRevision(view)
  const content = contentOf(view.draft ?? saved ?? emptyContent())
  const summary = membershipSummary(catalog, content)
  const status = viewStatus(catalog, view)
  const preparations = Object.values(catalog.preparations)
    .filter((p) => p.viewId === view.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const latestPrep = preparations.at(-1) ?? null
  const hasMembers = content.included.length > 0 || content.productInputs.length > 0

  const sessions: Gate = !hasMembers
    ? { state: "blocked", gate: "No sessions selected", action: "Select sessions" }
    : summary.unresolved > 0
      ? { state: "blocked", gate: `${plural(summary.unresolved, "unresolved member")}`, action: "Resolve members" }
      : view.draft
        ? { state: "ready", gate: "Unsaved changes", action: "Save View" }
        : {
            state: "done",
            gate: `${plural(summary.included.frames, "light")} · ${formatDuration(summary.included.seconds)}${saved ? ` · revision ${saved.revision}` : ""}`,
            action: null,
          }

  const frames: Gate = !hasMembers
    ? { state: "waiting", gate: "Select sessions first", action: null }
    : summary.unreviewed > 0
      ? { state: "advisory", gate: `${plural(summary.unreviewed, "included frame")} Unreviewed`, action: "Review frames" }
      : { state: "done", gate: `${plural(summary.excluded, "frame")} excluded · no Unreviewed`, action: null }

  const plan = hasMembers ? calibrationPlan(catalog, disk, view, content, decisions) : null
  const calibration: Gate =
    !plan || plan.rows.length === 0
      ? hasMembers
        ? { state: "done", gate: "No calibration inputs needed", action: null }
        : { state: "waiting", gate: "Select sessions first", action: null }
      : plan.drifted > 0
        ? { state: "blocked", gate: `${plural(plan.drifted, "input")} changed since accepted`, action: "Resolve calibration" }
        : plan.counts.unresolved + plan.counts.deferred > 0
          ? { state: "blocked", gate: `${plural(plan.counts.unresolved + plan.counts.deferred, "requirement")} unresolved`, action: "Resolve calibration" }
          : plan.counts.suggested > 0
            ? { state: "ready", gate: `${plural(plan.counts.suggested, "suggestion")} to accept`, action: "Accept calibration" }
            : {
                state: "done",
                gate: `${plan.counts.accepted} accepted${plan.counts.exception > 0 ? ` · ${plural(plan.counts.exception, "exception")}` : ""}`,
                action: null,
              }

  const prepRunning = latestPrep?.state === "running" || latestPrep?.state === "paused"
  const prepare: Gate =
    status === "complete" || status === "prepared"
      ? { state: "done", gate: `Prepared${latestPrep ? `: ${plural(latestPrep.entryCount, "entry", "entries")}` : ""}`, action: null }
      : status === "unverified"
        ? { state: "blocked", gate: "Entries changed since preparation", action: "Check preparation" }
        : prepRunning
          ? { state: "running", gate: latestPrep?.state === "paused" ? "Preparation paused" : "Preparing", action: null }
          : latestPrep && saved && latestPrep.membershipRevision === saved.revision && (latestPrep.state === "partial" || latestPrep.state === "failed")
            ? { state: "blocked", gate: `Last preparation ${latestPrep.state === "partial" ? "Partial" : "Failed"}`, action: "Retry preparation" }
            : !saved || view.draft
              ? { state: "waiting", gate: "Save View first", action: null }
              : calibration.state === "blocked" || calibration.state === "ready"
                ? { state: "waiting", gate: "Calibration first", action: null }
                : { state: "ready", gate: "Ready to review", action: "Review preparation" }

  const accepted = Object.values(catalog.results).filter((r) => r.viewId === view.id && r.acceptance === "accepted").length
  const results: Gate = view.completedAt
    ? { state: "done", gate: `Processing complete${accepted > 0 ? ` · ${accepted} accepted` : ""}`, action: null }
    : status === "prepared" || status === "unverified"
      ? accepted > 0
        ? { state: "ready", gate: `${accepted} accepted`, action: "Mark processing complete" }
        : { state: "ready", gate: "Process, then check outputs", action: "Check for results" }
      : { state: "waiting", gate: "After preparation", action: null }

  const cleanup: Gate = view.completedAt
    ? { state: "advisory", gate: "Optional: replaced or prepared files", action: "Clean up View" }
    : { state: "waiting", gate: "After Complete", action: null }

  const gates: Record<StageId, Gate> = { sessions, frames, calibration, prepare, results, cleanup }
  const stages: Stage[] = (Object.keys(STAGE_LABEL) as StageId[]).map((id) => ({ id, label: STAGE_LABEL[id], ...gates[id] }))
  const pick =
    stages.find((s) => (s.state === "ready" || s.state === "blocked") && s.action) ??
    stages.find((s) => s.state === "running") ??
    stages.find((s) => s.state === "advisory" && s.action) ??
    null
  const next = pick?.action ? { stage: pick.id, label: pick.action, reason: pick.gate, to: `/views/${view.id}/${pick.id}` } : null
  const current = pick?.id ?? [...stages].reverse().find((s) => s.state === "done")?.id ?? "sessions"
  return { stages, current, next, status }
}
