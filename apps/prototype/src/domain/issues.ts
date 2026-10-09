/**
 * The Issues hub (foundation-owned): every issue across the app, grouped and
 * each with one action. The toolbar's Issues button counts them and takes the
 * worst severity's tint; Home renders the same list as pills, and the status
 * bar groups them into chips by kind (`statusChips`). Read it through
 * `useIssues()` and `useStatusChips()` (src/store/issues.ts). Nothing here
 * writes state.
 *
 * Labels are terse en-GB status phrases ("2 need a Target", "1 offline")
 * with `{n}` and `{name}` placeholders. The hub does not render them: it
 * words each issue by its `kind` from the message catalogue (`issueCopy`,
 * src/app/issues-hub.tsx).
 */
import { inputDrift } from "./calibration"
import { calibrationProcesses } from "./calibration-process"
import { runPipeline, runStepLink, type StepLink, sessionsNeedingWork, type World } from "./derive"
import { locationAvailability, qualityApplicability } from "./library"
import { formatNight } from "@/lib/format"

export type IssueSeverity = "info" | "warning" | "danger"
export type IssueGroup = "sessions" | "storage" | "work" | "runs" | "calibration" | "drift"

/** What an issue is about; the status bar's chips group by it. */
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

export const ISSUE_GROUP_LABEL: Record<IssueGroup, string> = {
  sessions: "Sessions",
  storage: "Locations",
  work: "Work",
  runs: "Runs",
  calibration: "Calibration",
  drift: "Drift",
}

export interface Issue {
  /** Stable while the issue lasts. */
  id: string
  group: IssueGroup
  kind: IssueKind
  severity: IssueSeverity
  /** How many things the issue covers (sessions, frames, runs). */
  count: number
  /** en-GB source string with `{n}` (count) and `{name}` placeholders, e.g. "{n} need a Target". */
  label: string
  /** Value for `{name}`: the location, run or session the issue is about. */
  name: string | null
  /** Id of the one record the issue is about (location, run, session, master, process); null for a count. */
  about: string | null
  /** The one action, e.g. "Assign", with where it leads. */
  action: { label: string; link: StepLink }
}

export const SEVERITY_ORDER: IssueSeverity[] = ["danger", "warning", "info"]

export function worstSeverity(issues: Issue[]): IssueSeverity | null {
  return SEVERITY_ORDER.find((s) => issues.some((i) => i.severity === s)) ?? null
}

/** Every issue, in group order and worst first within a group. */
export function deriveIssues(world: World): Issue[] {
  const { catalog, disk, operations } = world
  const out: Issue[] = []

  // Sessions that need a Target, and sessions in no Project.
  const work = sessionsNeedingWork(catalog)
  if (work.needsTarget.length > 0) {
    out.push({ id: "sessions:needs-target", group: "sessions", kind: "needs-target", severity: "warning", count: work.needsTarget.length, label: "{n} need a Target", name: null, about: null, action: { label: "Assign", link: { to: "/sessions", search: { filter: "needs-target" } } } })
  }
  if (work.notInProject.length > 0) {
    out.push({ id: "sessions:not-in-project", group: "sessions", kind: "not-in-project", severity: "info", count: work.notInProject.length, label: "{n} not in a Project", name: null, about: null, action: { label: "Add", link: { to: "/sessions", search: { filter: "not-in-project" } } } })
  }

  // Offline or unreadable locations.
  for (const location of Object.values(catalog.locations)) {
    if (location.access === "denied") {
      out.push({ id: `location:denied:${location.id}`, group: "storage", kind: "location-denied", severity: "danger", count: 1, label: "{name} unreadable", name: location.displayName, about: location.id, action: { label: "Fix", link: { to: "/settings/locations" } } })
    } else if (locationAvailability(disk, location) === "offline") {
      out.push({ id: `location:offline:${location.id}`, group: "storage", kind: "location-offline", severity: "warning", count: 1, label: "{name} offline", name: location.displayName, about: location.id, action: { label: "Locations", link: { to: "/settings/locations" } } })
    }
  }

  // Interrupted or failed work; a calibration process lists its own failures below.
  for (const op of Object.values(operations)) {
    if ((op.status !== "interrupted" && op.status !== "failed") || op.kind === "stack-master") continue
    const failed = op.status === "failed"
    out.push({
      id: `operation:${op.id}`,
      group: "work",
      kind: failed ? "work-failed" : "work-interrupted",
      severity: failed ? "danger" : "warning",
      count: 1,
      label: failed ? "{name} failed" : "{name} interrupted",
      name: op.title,
      about: op.id,
      action: { label: "Activity", link: { to: "/activity" } },
    })
  }

  // Blocked runs; a run held at Calibrate is listed under Calibration.
  for (const run of Object.values(catalog.runs)) {
    if (run.trashedAt || run.completion === "complete" || catalog.projects[run.projectId]?.state !== "open") continue
    const pipeline = runPipeline(world, run)
    if (pipeline.calibration.needsReview.length > 0) {
      out.push({ id: `calibration:${run.id}`, group: "calibration", kind: "calibration-review", severity: "warning", count: pipeline.calibration.needsReview.length, label: "{name}: {n} to review", name: run.name, about: run.id, action: { label: "Review", link: runStepLink(run, "calibrate") } })
    }
    if (pipeline.blocker && pipeline.blocker.step !== "calibrate") {
      out.push({ id: `run:${run.id}`, group: "runs", kind: "run-blocked", severity: pipeline.blocker.kind === "preparation-failed" ? "danger" : "warning", count: 1, label: "{name} blocked", name: run.name, about: run.id, action: { label: "Open", link: runStepLink(run, pipeline.blocker.step) } })
    }
    const offers = run.masterOffers.filter((o) => o.state === "pending").length
    if (offers > 0) {
      out.push({ id: `offers:${run.id}`, group: "calibration", kind: "master-offer", severity: "info", count: offers, label: "{n} master offered", name: run.name, about: run.id, action: { label: "Review", link: runStepLink(run, "calibrate") } })
    }
  }

  // Calibration processes (P-CAL3): raw sessions awaiting Stack, and failed steps.
  const processes = calibrationProcesses(catalog)
  const awaiting = processes.filter((p) => p.status === "awaiting-stack" && p.frames > 0)
  if (awaiting.length > 0) {
    out.push({ id: "calibration:awaiting-stack", group: "calibration", kind: "calibration-waiting", severity: "info", count: awaiting.length, label: "{n} to stack", name: null, about: null, action: { label: "Stack", link: { to: "/calibration" } } })
  }
  for (const view of processes) {
    if (view.status !== "failed") continue
    out.push({ id: `calibration:failed:${view.process.id}`, group: "calibration", kind: "calibration-failed", severity: "danger", count: 1, label: "{name} failed", name: view.name, about: view.process.id, action: { label: "Open", link: { to: "/calibration" } } })
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
    out.push({
      id: `drift:session:${sessionId}`,
      group: "drift",
      kind: "drift",
      severity: "warning",
      count: frames,
      label: "{n} changed · {name}",
      name: `${formatNight(session.night)} ${session.channel ?? ""}`.trim(),
      about: sessionId,
      action: { label: "Review", link: { to: "/sessions/$sessionId", params: { sessionId } } },
    })
  }
  for (const master of Object.values(catalog.masters)) {
    if (master.state !== "adopted" || !inputDrift(catalog, disk, { type: "master", masterId: master.id })) continue
    out.push({ id: `drift:master:${master.id}`, group: "drift", kind: "drift", severity: "warning", count: 1, label: "Master changed · {name}", name: master.path.split("/").pop() ?? master.id, about: master.id, action: { label: "Calibration", link: { to: "/calibration" } } })
  }

  const rank = (i: Issue) => ISSUE_GROUPS.indexOf(i.group) * 10 + SEVERITY_ORDER.indexOf(i.severity)
  return out.sort((a, b) => rank(a) - rank(b))
}

/** The status bar's issue chips, in bar order (Status bar, round 1b). */
export type StatusChipId = "offline" | "blocked" | "needs-target" | "calibration"

export const STATUS_CHIP_KINDS: Record<StatusChipId, IssueKind[]> = {
  offline: ["location-offline", "location-denied"],
  blocked: ["run-blocked", "calibration-review"],
  "needs-target": ["needs-target"],
  calibration: ["calibration-waiting", "calibration-failed"],
}

export interface StatusChip {
  id: StatusChipId
  /** What the chip counts: offline locations, blocked runs, sessions, calibration processes. */
  count: number
  severity: IssueSeverity
  /** en-GB source string with `{n}` and `{name}`: "{n} blocked", "{name} offline". */
  label: string
  /** Value for `{name}` when the chip covers one named record. */
  name: string | null
  issues: Issue[]
}

/**
 * Issues grouped into the status bar's chips, from the same derivation as the
 * hub, so their numbers agree. A chip with no issue is left out. A blocked
 * run counts once even when it is held at Calibrate and blocked elsewhere.
 */
export function statusChips(issues: Issue[]): StatusChip[] {
  const out: StatusChip[] = []
  for (const id of Object.keys(STATUS_CHIP_KINDS) as StatusChipId[]) {
    const mine = issues.filter((i) => STATUS_CHIP_KINDS[id].includes(i.kind))
    if (mine.length === 0) continue
    const count = id === "blocked" ? new Set(mine.map((i) => i.about)).size : mine.reduce((n, i) => n + i.count, 0)
    const single = mine.length === 1 && mine[0]!.name !== null && id === "offline"
    const label = { offline: single ? mine[0]!.label : "{n} offline", blocked: "{n} blocked", "needs-target": "{n} need a Target", calibration: "{n} calibration waiting" }[id]
    out.push({ id, count, severity: worstSeverity(mine)!, label, name: single ? mine[0]!.name : null, issues: mine })
  }
  return out
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
