/**
 * Pipeline model (harness v4, read-only): the seven numbered stages of a
 * View, each with a readiness gate, and the one Next action. Ported from
 * Direction C's guided pipeline and mapped onto the integrated workspace
 * areas. Everything here is derived from the store; nothing is written.
 *
 *   1 Library → 2 Select → 3 Review → 4 Calibrate → 5 Prepare → 6 Results → 7 Store
 *
 * A gate item is met, not met (blocking) or advisory. The Next action is the
 * first stage whose gate blocks; when nothing blocks, the first stage that is
 * still not done. Advisory items never capture Next on their own.
 */
import { viewStatus } from "@/domain/derive"
import type { View, ViewId } from "@/domain/types"
import { formatDuration, plural } from "@/lib/format"
import type { PrototypeState } from "@/store/core"
import { emptyContent, latestRevision, viewSummary } from "@/features/t3/model"
import { calibrationPlan } from "@/features/t4/domain"

export type StageId = "library" | "select" | "review" | "calibrate" | "prepare" | "results" | "store"

/** C's state vocabulary: icon shape and word always accompany the colour. */
export type GateState = "done" | "ready" | "review" | "blocked" | "running" | "partial" | "idle"

export const GATE_LABEL: Record<GateState, string> = {
  done: "Done",
  ready: "Ready",
  review: "Review",
  blocked: "Blocked",
  running: "Running",
  partial: "Partial",
  idle: "Not started",
}

export interface GateItem {
  label: string
  /** true met, false blocks, "advisory" informs without blocking. */
  met: boolean | "advisory"
  detail: string
}

export interface StageLink {
  to: string
  params?: Record<string, string>
  search?: Record<string, string>
  /** Element focused after the navigation, e.g. the Save View button. */
  focusId?: string
}

export interface Stage {
  id: StageId
  n: number
  label: string
  state: GateState
  /** Short status beside the stage name, e.g. "Saved r2" or "94 of 208". */
  status: string
  items: GateItem[]
  link: StageLink
  /** Verb phrase used when this stage holds the Next action. */
  nextLabel: string
}

export interface NextAction {
  stage: Stage
  label: string
  reason: string
  link: StageLink
}

export interface ViewPipeline {
  viewId: ViewId
  stages: Stage[]
  current: Stage
  next: NextAction | null
}

export const STAGES: Array<{ id: StageId; n: number; label: string }> = [
  { id: "library", n: 1, label: "Library" },
  { id: "select", n: 2, label: "Select" },
  { id: "review", n: 3, label: "Review" },
  { id: "calibrate", n: 4, label: "Calibrate" },
  { id: "prepare", n: 5, label: "Prepare" },
  { id: "results", n: 6, label: "Results" },
  { id: "store", n: 7, label: "Store" },
]

/** The workspace area each stage opens. Library opens the View's Target. */
export const STAGE_AREA: Record<Exclude<StageId, "library">, string> = {
  select: "/views/$viewId/sessions",
  review: "/views/$viewId/frames",
  calibrate: "/views/$viewId/calibration",
  prepare: "/views/$viewId/prepare",
  results: "/views/$viewId/results",
  store: "/views/$viewId/cleanup",
}

export function stageForPath(pathname: string): StageId | null {
  const area = pathname.match(/^\/views\/[^/]+\/([^/]+)/)?.[1]
  switch (area) {
    case "sessions":
    case "refresh":
      return "select"
    case "frames":
      return "review"
    case "calibration":
      return "calibrate"
    case "prepare":
      return "prepare"
    case "results":
      return "results"
    case "cleanup":
      return "store"
    default:
      return null
  }
}

function blocks(items: GateItem[]) {
  return items.some((i) => i.met === false)
}

export function viewPipeline(state: PrototypeState, view: View): ViewPipeline {
  const { catalog, disk, operations } = state
  const ops = Object.values(operations)
  const content = view.draft ?? latestRevision(view) ?? emptyContent()
  const summary = viewSummary(disk, catalog, content)
  const latest = latestRevision(view)
  const status = viewStatus(catalog, view)
  const area = (path: string, focusId?: string): StageLink => ({ to: path, params: { viewId: view.id }, focusId })

  // 1 Library: the shared catalog the View draws from.
  const indexing = ops.find((op) => op.kind === "index" && (op.status === "running" || op.status === "paused"))
  const hasCaptures = Object.values(catalog.locations).some((l) => l.role === "captures")
  const members = content.sessions.map((s) => catalog.sessions[s.sessionId]).filter((s) => s !== undefined)
  const needsReview = members.filter((s) => s.target.status === "needs-review" || s.target.status === "unresolved" || s.equipment.status === "needs-review" || s.equipment.status === "unresolved").length
  const libraryItems: GateItem[] = [
    { label: "Captures location registered", met: hasCaptures, detail: hasCaptures ? "Read in place; nothing is moved." : "Add a capture location in Settings." },
    { label: "Index finished", met: indexing ? false : true, detail: indexing ? `${indexing.title}: ${indexing.progress.done} of ${indexing.progress.total} ${indexing.progress.unit}` : "No indexing is running." },
    { label: "Associations reviewed", met: needsReview === 0 ? true : "advisory", detail: needsReview === 0 ? "Every member session has its Target and equipment." : `${plural(needsReview, "member session")} with an association that needs review.` },
  ]
  const library: Stage = {
    ...STAGES[0]!,
    state: indexing ? "running" : !hasCaptures ? "blocked" : needsReview > 0 ? "review" : "done",
    status: indexing ? "Indexing" : needsReview > 0 ? `${needsReview} to review` : "Indexed",
    items: libraryItems,
    link: view.targetId ? { to: "/targets/$targetId", params: { targetId: view.targetId } } : { to: "/sessions" },
    nextLabel: needsReview > 0 ? "Review associations" : "Open library",
  }

  // 2 Select: membership, saved as a revision.
  const selected = content.sessions.length
  const saved = view.draft === null && latest !== null
  const selectItems: GateItem[] = [
    { label: "Sessions selected", met: selected > 0, detail: selected > 0 ? `${plural(selected, "session")} · ${plural(summary.included.frames, "frame")}` : "No sessions yet." },
    { label: "No unresolved members", met: summary.unresolved === 0, detail: summary.unresolved === 0 ? "Every selected source is readable now." : `${plural(summary.unresolved, "member")} cannot be read.` },
    { label: "Membership saved", met: saved, detail: saved ? `Revision ${latest!.revision} saved.` : latest ? `Unsaved changes on revision ${latest.revision}.` : "Not saved yet." },
  ]
  const select: Stage = {
    ...STAGES[1]!,
    state: selected === 0 ? (view.completedAt ? "done" : "ready") : blocks(selectItems) ? "review" : "done",
    status: selected === 0 ? "No sessions" : saved ? `Saved r${latest!.revision}` : summary.unresolved > 0 ? `${summary.unresolved} unresolved` : "Unsaved",
    items: selectItems,
    link: selected > 0 && !saved && !view.completedAt ? area(STAGE_AREA.select, `${view.id}-save`) : area(STAGE_AREA.select),
    nextLabel: selected === 0 ? "Select sessions" : !saved ? "Save View" : "Edit selection",
  }

  // 3 Review: frame quality is advisory; measurements inform, never decide.
  const reviewed = summary.included.frames - summary.unreviewed
  const reviewItems: GateItem[] = [
    {
      label: "Frames reviewed",
      met: summary.included.frames > 0 && summary.unreviewed === 0 ? true : "advisory",
      detail: summary.included.frames === 0 ? "No included frames yet." : `${reviewed} of ${summary.included.frames} have a quality decision. Measurements inform; they never exclude.`,
    },
  ]
  const review: Stage = {
    ...STAGES[2]!,
    state: summary.included.frames === 0 ? "idle" : summary.unreviewed === 0 ? "done" : "review",
    status: summary.included.frames === 0 ? "—" : `${reviewed} of ${summary.included.frames}`,
    items: reviewItems,
    link: area(STAGE_AREA.review),
    nextLabel: "Review frames",
  }

  // 4 Calibrate: every requirement accepted or a scoped exception.
  const cal = calibrationPlan(catalog, disk, view, content, state.slices.t4.decisions)
  const calOpen = cal.counts.suggested + cal.counts.unresolved + cal.counts.deferred
  const calibrateItems: GateItem[] = [
    {
      label: "Calibration resolved",
      met: cal.rows.length > 0 && cal.blocking.length === 0,
      detail:
        cal.rows.length === 0
          ? "Select sessions first."
          : `${cal.counts.accepted} accepted · ${cal.counts.exception} exception${cal.counts.exception === 1 ? "" : "s"} · ${cal.counts.suggested} suggested · ${cal.counts.unresolved} unresolved${cal.drifted > 0 ? ` · ${cal.drifted} drifted` : ""}`,
    },
  ]
  const calibrate: Stage = {
    ...STAGES[3]!,
    state: cal.rows.length === 0 ? "idle" : cal.blocking.length === 0 ? "done" : cal.counts.unresolved > 0 || cal.drifted > 0 ? "blocked" : "review",
    status: cal.rows.length === 0 ? "—" : cal.blocking.length === 0 ? "Accepted" : `${calOpen + cal.drifted} open`,
    items: calibrateItems,
    link: area(STAGE_AREA.calibrate),
    nextLabel: cal.counts.unresolved > 0 || cal.drifted > 0 ? "Resolve calibration" : "Accept calibration",
  }

  // 5 Prepare: the latest preparation of the latest revision.
  const preparations = Object.values(catalog.preparations)
    .filter((p) => p.viewId === view.id)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  const prep = preparations.at(-1) ?? null
  const prepCurrent = prep && latest && prep.membershipRevision === latest.revision ? prep : null
  const profile = view.profileId ? catalog.profiles[view.profileId] : undefined
  const prepareItems: GateItem[] = [
    { label: "Membership saved", met: saved, detail: saved ? `Revision ${latest!.revision}.` : "Save View first." },
    { label: "Calibration resolved", met: cal.rows.length > 0 && cal.blocking.length === 0, detail: cal.blocking.length === 0 ? "Handoff calibration accepted." : `${plural(cal.blocking.length, "requirement")} open.` },
    { label: "Application profile chosen", met: Boolean(profile), detail: profile ? profile.name : "Choose a profile in Prepare." },
  ]
  let prepState: GateState
  let prepStatus: string
  if (prepCurrent?.state === "running" || prepCurrent?.state === "paused") {
    prepState = "running"
    prepStatus = `${prepCurrent.preparedAssetIds.length} of ${prepCurrent.entryCount}`
  } else if (prepCurrent?.state === "prepared") {
    prepState = prepCurrent.unverified ? "review" : "done"
    prepStatus = prepCurrent.unverified ? "Unverified" : "Prepared"
  } else if (prepCurrent?.state === "partial") {
    prepState = "partial"
    prepStatus = `Partial ${prepCurrent.preparedAssetIds.length}/${prepCurrent.entryCount}`
  } else if (prepCurrent?.state === "failed") {
    prepState = "blocked"
    prepStatus = "Failed"
  } else if (prep && !prepCurrent) {
    prepState = "review"
    prepStatus = `r${prep.membershipRevision} only`
  } else {
    prepState = blocks(prepareItems) ? "idle" : "ready"
    prepStatus = blocks(prepareItems) ? `${prepareItems.filter((i) => i.met === false).length} blocker${prepareItems.filter((i) => i.met === false).length === 1 ? "" : "s"}` : "Ready"
  }
  if (view.completedAt && prepState !== "done") prepState = prep ? "done" : prepState
  const prepare: Stage = {
    ...STAGES[4]!,
    state: prepState,
    status: prepStatus,
    items: prepState === "done" ? [{ label: "View prepared", met: true, detail: `${plural(prepCurrent?.entryCount ?? prep?.entryCount ?? 0, "entry", "entries")} match revision ${prepCurrent?.membershipRevision ?? prep?.membershipRevision}.` }] : prepareItems,
    link: area(STAGE_AREA.prepare),
    nextLabel: prepState === "done" ? "Open in application" : prepState === "partial" || prepState === "blocked" ? "Resolve preparation" : prepState === "running" ? "Watch preparation" : "Review preparation",
  }

  // 6 Results: discovered outputs and Mark processing complete.
  const results = Object.values(catalog.results).filter((r) => r.viewId === view.id)
  const accepted = results.filter((r) => r.acceptance === "accepted").length
  const candidates = results.length - accepted
  const resultsItems: GateItem[] = [
    { label: "View prepared", met: status === "prepared" || status === "complete" || prepState === "done", detail: prepState === "done" ? "Outputs are looked for in the output location." : "Prepare the View first." },
    { label: "Results accepted", met: accepted > 0 ? true : "advisory", detail: results.length === 0 ? "No outputs found yet." : `${accepted} accepted · ${candidates} candidate${candidates === 1 ? "" : "s"}` },
    { label: "Processing marked complete", met: Boolean(view.completedAt), detail: view.completedAt ? "Complete; cleanup can be reviewed." : "Mark complete when processing is done. Partial is not a handoff." },
  ]
  const resultsStage: Stage = {
    ...STAGES[5]!,
    state: view.completedAt ? "done" : prepState !== "done" ? "idle" : candidates > 0 ? "review" : "ready",
    status: view.completedAt ? "Complete" : prepState !== "done" ? "Needs Prepare" : results.length === 0 ? "Awaiting outputs" : `${accepted}/${results.length} accepted`,
    items: resultsItems,
    link: area(STAGE_AREA.results),
    nextLabel: candidates > 0 ? "Accept results" : "Mark processing complete",
  }

  // 7 Store: cleanup and custody after Complete.
  const cleanupRuns = ops.filter((op) => op.kind === "cleanup" && op.scope.viewIds?.includes(view.id)).sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  const archived = ops.some((op) => (op.kind === "archive" || op.kind === "filing") && op.scope.viewIds?.includes(view.id) && op.status === "succeeded")
  const lastCleanup = cleanupRuns[0]
  const cleanupRunning = lastCleanup?.status === "running" || lastCleanup?.status === "paused"
  const cleanedUp = lastCleanup?.status === "succeeded"
  const storeItems: GateItem[] = [
    { label: "Processing complete", met: Boolean(view.completedAt), detail: view.completedAt ? "Cleanup and archive can be reviewed." : "After Complete." },
    { label: "Cleanup reviewed", met: cleanedUp ? true : "advisory", detail: cleanedUp ? `${lastCleanup!.title}: ${lastCleanup!.summary ?? "finished"}` : lastCleanup ? `Last run: ${lastCleanup.status}.` : "Nothing removed yet. Cleanup never deletes originals." },
    { label: "Archived", met: archived ? true : "advisory", detail: archived ? "A verified archive covers this View." : "Optional: archive from Storage." },
  ]
  const store: Stage = {
    ...STAGES[6]!,
    state: !view.completedAt ? "idle" : cleanupRunning ? "running" : cleanedUp || archived ? "done" : "ready",
    status: !view.completedAt ? "After Complete" : cleanupRunning ? "Cleaning up" : cleanedUp ? "Cleaned up" : archived ? "Archived" : "Cleanup available",
    items: storeItems,
    link: area(STAGE_AREA.store),
    nextLabel: "Clean up View",
  }

  const stages = [library, select, review, calibrate, prepare, resultsStage, store]
  const blocking = stages.find((s) => s.state !== "done" && blocks(s.items))
  const open = blocking ?? stages.find((s) => s.state !== "done" && s.state !== "idle") ?? stages.find((s) => s.state !== "done")
  const current = open ?? store
  const next: NextAction | null = open
    ? {
        stage: open,
        label: open.nextLabel,
        reason: open.items.find((i) => i.met === false)?.detail ?? open.items.find((i) => i.met === "advisory")?.detail ?? open.status,
        link: open.link,
      }
    : null
  return { viewId: view.id, stages, current, next }
}

/** One-line membership totals for headers and the board. */
export function pipelineTotals(state: PrototypeState, view: View): string {
  const content = view.draft ?? latestRevision(view) ?? emptyContent()
  const summary = viewSummary(state.disk, state.catalog, content)
  if (summary.included.frames === 0) return "No frames yet"
  return `${plural(summary.included.frames, "light")} · ${formatDuration(summary.included.seconds)}`
}
