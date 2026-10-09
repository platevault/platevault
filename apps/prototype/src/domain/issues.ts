/**
 * The Issues hub (foundation-owned): every issue across the app, grouped and
 * each with one action. The toolbar's Issues button counts them and takes the
 * worst severity's tint; Home renders the same list as pills. Read it through
 * `useIssues()` (src/store/issues.ts). Nothing here writes state.
 *
 * Labels are terse status phrases ("2 need a Target", "1 offline"); the
 * hub translates them with `t()` (src/lib/i18n.ts), so every label below is
 * an en-GB source string with `{n}` and `{name}` placeholders.
 */
import { inputDrift } from "./calibration"
import { runPipeline, runStepLink, type StepLink, sessionsNeedingWork, type World } from "./derive"
import { locationAvailability, qualityApplicability } from "./library"
import { formatNight } from "@/lib/format"

export type IssueSeverity = "info" | "warning" | "danger"
export type IssueGroup = "sessions" | "storage" | "work" | "runs" | "calibration" | "drift"

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
  severity: IssueSeverity
  /** How many things the issue covers (sessions, frames, runs). */
  count: number
  /** en-GB source string with `{n}` (count) and `{name}` placeholders, e.g. "{n} need a Target". */
  label: string
  /** Value for `{name}`: the location, run or session the issue is about. */
  name: string | null
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
    out.push({ id: "sessions:needs-target", group: "sessions", severity: "warning", count: work.needsTarget.length, label: "{n} need a Target", name: null, action: { label: "Assign", link: { to: "/sessions", search: { filter: "needs-target" } } } })
  }
  if (work.notInProject.length > 0) {
    out.push({ id: "sessions:not-in-project", group: "sessions", severity: "info", count: work.notInProject.length, label: "{n} not in a Project", name: null, action: { label: "Add", link: { to: "/sessions", search: { filter: "not-in-project" } } } })
  }

  // Offline or unreadable locations.
  for (const location of Object.values(catalog.locations)) {
    if (location.access === "denied") {
      out.push({ id: `location:denied:${location.id}`, group: "storage", severity: "danger", count: 1, label: "{name} unreadable", name: location.displayName, action: { label: "Fix", link: { to: "/settings/locations" } } })
    } else if (locationAvailability(disk, location) === "offline") {
      out.push({ id: `location:offline:${location.id}`, group: "storage", severity: "warning", count: 1, label: "{name} offline", name: location.displayName, action: { label: "Locations", link: { to: "/settings/locations" } } })
    }
  }

  // Interrupted or failed work.
  for (const op of Object.values(operations)) {
    if (op.status !== "interrupted" && op.status !== "failed") continue
    out.push({
      id: `operation:${op.id}`,
      group: "work",
      severity: op.status === "failed" ? "danger" : "warning",
      count: 1,
      label: op.status === "failed" ? "{name} failed" : "{name} interrupted",
      name: op.title,
      action: { label: "Activity", link: { to: "/activity" } },
    })
  }

  // Blocked runs; a run held at Calibrate is listed under Calibration.
  for (const run of Object.values(catalog.runs)) {
    if (run.trashedAt || run.completion === "complete" || catalog.projects[run.projectId]?.state !== "open") continue
    const pipeline = runPipeline(world, run)
    if (pipeline.calibration.needsReview.length > 0) {
      out.push({ id: `calibration:${run.id}`, group: "calibration", severity: "warning", count: pipeline.calibration.needsReview.length, label: "{name}: {n} to review", name: run.name, action: { label: "Review", link: runStepLink(run, "calibrate") } })
    }
    if (pipeline.blocker && pipeline.blocker.step !== "calibrate") {
      out.push({ id: `run:${run.id}`, group: "runs", severity: pipeline.blocker.kind === "preparation-failed" ? "danger" : "warning", count: 1, label: "{name} blocked", name: run.name, action: { label: "Open", link: runStepLink(run, pipeline.blocker.step) } })
    }
    const offers = run.masterOffers.filter((o) => o.state === "pending").length
    if (offers > 0) {
      out.push({ id: `offers:${run.id}`, group: "calibration", severity: "info", count: offers, label: "{n} master offered", name: run.name, action: { label: "Review", link: runStepLink(run, "calibrate") } })
    }
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
      severity: "warning",
      count: frames,
      label: "{n} changed · {name}",
      name: `${formatNight(session.night)} ${session.channel ?? ""}`.trim(),
      action: { label: "Review", link: { to: "/sessions/$sessionId", params: { sessionId } } },
    })
  }
  for (const master of Object.values(catalog.masters)) {
    if (master.state !== "adopted" || !inputDrift(catalog, disk, { type: "master", masterId: master.id })) continue
    out.push({ id: `drift:master:${master.id}`, group: "drift", severity: "warning", count: 1, label: "Master changed · {name}", name: master.path.split("/").pop() ?? master.id, action: { label: "Calibration", link: { to: "/calibration" } } })
  }

  const rank = (i: Issue) => ISSUE_GROUPS.indexOf(i.group) * 10 + SEVERITY_ORDER.indexOf(i.severity)
  return out.sort((a, b) => rank(a) - rank(b))
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
