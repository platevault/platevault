/**
 * The Issues hub (foundation-owned): every issue across the app, grouped and
 * each with one action. The toolbar's Issues button counts them and takes the
 * worst severity's tint; Home renders them as pills in bar order
 * (`inBarOrder`), and the status bar shows them as named pills or as chips
 * by kind (`statusIssues`). Read it through `useIssues()` and
 * `useStatusIssues()` (src/store/issues.ts). Nothing here writes state.
 *
 * The domain carries no copy: the hub, Home and the status bar word each
 * issue by its `kind`, `count` and `name` from the message catalogue
 * (`issueCopy`, src/app/issues-hub.tsx).
 */
import { inputDrift } from "./calibration"
import { calibrationProcesses } from "./calibration-process"
import { runPipeline, runStepLink, type StepLink, sessionsNeedingWork, type World } from "./derive"
import { locationAvailability, qualityApplicability } from "./library"
import { formatNight } from "@/lib/format"
import type { MessageRef } from "@/lib/i18n"

export type IssueSeverity = "info" | "warning" | "danger"
export type IssueGroup = "sessions" | "storage" | "work" | "runs" | "calibration" | "drift"

/** What an issue is about; the status bar's chips group by it (`STATUS_CHIP_OF`). */
export type IssueKind =
  | "needs-target"
  | "not-in-project"
  | "location-denied"
  | "location-offline"
  | "work-failed"
  | "work-interrupted"
  | "calibration-review"
  | "run-blocked"
  | "master-offer"
  | "calibration-waiting"
  | "calibration-failed"
  | "drift"

export const ISSUE_GROUPS: IssueGroup[] = ["sessions", "storage", "work", "runs", "calibration", "drift"]

export interface Issue {
  /** Stable while the issue lasts. */
  id: string
  group: IssueGroup
  kind: IssueKind
  severity: IssueSeverity
  /** How many things the issue covers (sessions, frames, runs). */
  count: number
  /** Value for the copy's `{name}`: the location, run or session the issue is about; an operation's title is a ref, worded by `issueCopy`. */
  name: string | MessageRef | null
  /** Id of the one record the issue is about (location, run, session, master, process); null for a count. */
  about: string | null
  /** Where the issue's one action leads; `issueCopy` words the action ("Assign"). */
  link: StepLink
}

export const SEVERITY_ORDER: IssueSeverity[] = ["danger", "warning", "info"]

export function worstSeverity(issues: Issue[]): IssueSeverity | null {
  return SEVERITY_ORDER.find((s) => issues.some((i) => i.severity === s)) ?? null
}

/** Worst first; stable, so equal severities keep their order (the hub's group order). */
export function bySeverity(a: { severity: IssueSeverity }, b: { severity: IssueSeverity }): number {
  return SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity)
}

/** Bar order, shared by the status bar and Home: worst first, then hub group order. `issues` is in hub order, as `deriveIssues` returns it. */
export function inBarOrder(issues: Issue[]): Issue[] {
  return [...issues].sort(bySeverity)
}

/** Every issue, in group order and worst first within a group. */
export function deriveIssues(world: World): Issue[] {
  const { catalog, disk, operations } = world
  const out: Issue[] = []

  // Sessions that need a Target, and sessions in no Project.
  const work = sessionsNeedingWork(catalog)
  if (work.needsTarget.length > 0) {
    out.push({ id: "sessions:needs-target", group: "sessions", kind: "needs-target", severity: "warning", count: work.needsTarget.length, name: null, about: null, link: { to: "/sessions", search: { filter: "needs-target" } } })
  }
  if (work.notInProject.length > 0) {
    out.push({ id: "sessions:not-in-project", group: "sessions", kind: "not-in-project", severity: "info", count: work.notInProject.length, name: null, about: null, link: { to: "/sessions", search: { filter: "not-in-project" } } })
  }

  // Offline or unreadable locations.
  for (const location of Object.values(catalog.locations)) {
    if (location.access === "denied") {
      out.push({ id: `location:denied:${location.id}`, group: "storage", kind: "location-denied", severity: "danger", count: 1, name: location.displayName, about: location.id, link: { to: "/settings/locations" } })
    } else if (locationAvailability(disk, location) === "offline") {
      out.push({ id: `location:offline:${location.id}`, group: "storage", kind: "location-offline", severity: "warning", count: 1, name: location.displayName, about: location.id, link: { to: "/settings/locations" } })
    }
  }

  // Interrupted or failed work; a calibration process lists its own failures below.
  for (const op of Object.values(operations)) {
    if ((op.status !== "interrupted" && op.status !== "failed") || op.kind === "stack-master") continue
    const failed = op.status === "failed"
    out.push({ id: `operation:${op.id}`, group: "work", kind: failed ? "work-failed" : "work-interrupted", severity: failed ? "danger" : "warning", count: 1, name: op.title, about: op.id, link: { to: "/activity" } })
  }

  // Blocked runs; a run held at Calibrate is listed under Calibration.
  for (const run of Object.values(catalog.runs)) {
    if (run.trashedAt || run.completion === "complete" || catalog.projects[run.projectId]?.state !== "open") continue
    const pipeline = runPipeline(world, run)
    if (pipeline.calibration.needsReview.length > 0) {
      out.push({ id: `calibration:${run.id}`, group: "calibration", kind: "calibration-review", severity: "warning", count: pipeline.calibration.needsReview.length, name: run.name, about: run.id, link: runStepLink(run, "calibrate") })
    }
    if (pipeline.blocker && pipeline.blocker.step !== "calibrate") {
      out.push({ id: `run:${run.id}`, group: "runs", kind: "run-blocked", severity: pipeline.blocker.kind === "preparation-failed" ? "danger" : "warning", count: 1, name: run.name, about: run.id, link: runStepLink(run, pipeline.blocker.step) })
    }
    const offers = run.masterOffers.filter((o) => o.state === "pending").length
    if (offers > 0) {
      out.push({ id: `offers:${run.id}`, group: "calibration", kind: "master-offer", severity: "info", count: offers, name: run.name, about: run.id, link: runStepLink(run, "calibrate") })
    }
  }

  // Calibration processes (P-CAL3): raw sessions awaiting Stack, and failed steps.
  const processes = calibrationProcesses(catalog)
  const awaiting = processes.filter((p) => p.status === "awaiting-stack" && p.frames > 0)
  if (awaiting.length > 0) {
    out.push({ id: "calibration:awaiting-stack", group: "calibration", kind: "calibration-waiting", severity: "info", count: awaiting.length, name: null, about: null, link: { to: "/calibration" } })
  }
  for (const view of processes) {
    if (view.status !== "failed") continue
    out.push({ id: `calibration:failed:${view.process.id}`, group: "calibration", kind: "calibration-failed", severity: "danger", count: 1, name: view.name, about: view.process.id, link: { to: "/calibration" } })
  }

  // Drift: frames whose bytes changed after review, and adopted masters that changed since adoption.
  const drifted = new Map<string, number>()
  for (const asset of Object.values(catalog.assets)) {
    if (asset.trashed || !asset.sessionId || qualityApplicability(asset) !== "changed-content") continue
    drifted.set(asset.sessionId, (drifted.get(asset.sessionId) ?? 0) + 1)
  }
  for (const [sessionId, frames] of drifted) {
    const session = catalog.sessions[sessionId]
    if (!session) continue
    out.push({ id: `drift:session:${sessionId}`, group: "drift", kind: "drift", severity: "warning", count: frames, name: `${formatNight(session.night)} ${session.channel ?? ""}`.trim(), about: sessionId, link: { to: "/sessions/$sessionId", params: { sessionId } } })
  }
  for (const master of Object.values(catalog.masters)) {
    if (master.state !== "adopted" || !inputDrift(catalog, disk, { type: "master", masterId: master.id })) continue
    out.push({ id: `drift:master:${master.id}`, group: "drift", kind: "drift", severity: "warning", count: 1, name: master.path.split("/").pop() ?? master.id, about: master.id, link: { to: "/calibration" } })
  }

  const rank = (i: Issue) => ISSUE_GROUPS.indexOf(i.group) * 10 + SEVERITY_ORDER.indexOf(i.severity)
  return out.sort((a, b) => rank(a) - rank(b))
}

/** The status bar's chips (P-SB2): each groups one or more issue kinds. */
export type StatusChipId = "offline" | "failed" | "blocked" | "needs-target" | "not-in-project" | "calibration" | "master-offer" | "drift"

/**
 * The chip each issue kind shows under. Keyed by every `IssueKind`, so a new
 * kind fails to compile until it has a chip. Invariant: every issue lands in
 * exactly one chip, so the issues the chips cover are exactly `useIssues()`
 * and the bar's total agrees with the Issues button.
 */
export const STATUS_CHIP_OF: Record<IssueKind, StatusChipId> = {
  "needs-target": "needs-target",
  "not-in-project": "not-in-project",
  "location-denied": "offline",
  "location-offline": "offline",
  "work-failed": "failed",
  "work-interrupted": "failed",
  "calibration-failed": "failed",
  "calibration-review": "blocked",
  "run-blocked": "blocked",
  "master-offer": "master-offer",
  "calibration-waiting": "calibration",
  drift: "drift",
}

export interface StatusChip {
  id: StatusChipId
  /** What the chip counts: locations, failed work and calibrations, blocked runs, sessions, processes, offers, changed frames and masters. */
  count: number
  severity: IssueSeverity
  /** In hub order. */
  issues: Issue[]
}

/** The status bar's issues at every density, each in bar order: worst first, then hub group order. */
export interface StatusIssues {
  /** Each issue as its own named pill. */
  pills: Issue[]
  /**
   * The chips left when the first `k` pills are named: `chipsAfter[k]` groups
   * the other issues by `STATUS_CHIP_OF`, a chip with no issue left out.
   * `chipsAfter[0]` groups every issue; `chipsAfter[pills.length]` is empty.
   */
  chipsAfter: StatusChip[][]
}

/** `issues` (in hub order) grouped by `STATUS_CHIP_OF`. A blocked run counts once even when it is held at Calibrate and blocked elsewhere. */
function groupByChip(issues: Issue[]): StatusChip[] {
  const grouped = new Map<StatusChipId, Issue[]>()
  for (const issue of issues) {
    const id = STATUS_CHIP_OF[issue.kind]
    grouped.set(id, [...(grouped.get(id) ?? []), issue])
  }
  // A chip's first issue fixes its place in hub order; the stable sort keeps that order within a severity.
  const chips = [...grouped].map(([id, mine]): StatusChip => ({
    id,
    count: id === "blocked" ? new Set(mine.map((i) => i.about)).size : mine.reduce((n, i) => n + i.count, 0),
    severity: worstSeverity(mine)!,
    issues: mine,
  }))
  return chips.sort(bySeverity)
}

/** The status bar's issues, from the same derivation as the hub, so their numbers agree. */
export function statusIssues(issues: Issue[]): StatusIssues {
  const pills = inBarOrder(issues)
  const chipsAfter = pills.map((_, k) => {
    const named = new Set(pills.slice(0, k))
    return groupByChip(issues.filter((issue) => !named.has(issue)))
  })
  return { pills, chipsAfter: [...chipsAfter, []] }
}

/** Open Projects with a blocked run: the Projects source-list badge. */
export function blockedProjectCount(world: World): number {
  let n = 0
  for (const project of Object.values(world.catalog.projects)) {
    if (project.state !== "open") continue
    const runs = Object.values(world.catalog.runs).filter((r) => r.projectId === project.id && !r.trashedAt && r.completion !== "complete")
    if (runs.some((run) => runPipeline(world, run).blocker)) n += 1
  }
  return n
}

/** Sessions that need attention (a Target, or a Project): the Sessions source-list badge. */
export function sessionsNeedingAttention(world: World): number {
  const work = sessionsNeedingWork(world.catalog)
  return work.needsTarget.length + work.notInProject.length
}
