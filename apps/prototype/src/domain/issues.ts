/**
 * Issues (foundation-owned, F7, D-W92): every issue across the app, each
 * with its owner (the row it belongs to) and one action. There is no Issues
 * hub: a page that lists a row shows that row's issues (`issuesFor`), and
 * the status bar counts them by severity, each counter leading to the owning
 * pages (P-SB3). Read it through `useIssues()` (src/store/issues.ts).
 * Nothing here writes state. An issue can be dismissed (P-ISS1) until its
 * `issueFingerprint` changes, except a Project's own waiting work.
 *
 * The domain carries no copy: rows and the status bar word each issue by its
 * `kind`, `count`, `name` and `bytes` from the message catalogue
 * (`issueCopy`, src/components/app/issue-row.tsx). The Old badge of a dark or
 * bias master is a library badge only, never an issue (CAL-FR-15).
 */
import { sessionPinProblems, versionDrift } from "./calibration"
import { calibrationProcesses } from "./calibration-process"
import { projectLink, type StepLink, sessionsNeedingWork, type World } from "./derive"
import { locationAvailability, qualityApplicability } from "./library"
import { sessionRef } from "./membership"
import { applyPlan, pendingChanges, processingMasters, projectTabLink, unreviewedLeftovers } from "./project-view"
import { duplicateFindings } from "./storage"
import type { MessageRef } from "@/lib/i18n"

export type IssueSeverity = "info" | "warning" | "danger"
export type IssueGroup = "sessions" | "storage" | "work" | "projects" | "calibration" | "drift"

/** What an issue is about; `issueCopy` words it by kind. */
export type IssueKind =
  | "needs-target"
  | "not-in-project"
  | "needs-calibration"
  | "pin-drift"
  | "location-denied"
  | "location-offline"
  | "work-failed"
  | "work-interrupted"
  | "apply-refused"
  | "previous-review"
  | "master-offer"
  | "calibration-waiting"
  | "calibration-failed"
  | "drift"
  | "duplicates"

export const ISSUE_GROUPS: IssueGroup[] = ["sessions", "storage", "work", "projects", "calibration", "drift"]

/** The row an issue belongs to (F7): a session, Project, location, master, calibration process or operation, or a Library queue (no row). */
export type IssueOwner =
  | { kind: "library" }
  | { kind: "session"; id: string }
  | { kind: "project"; id: string }
  | { kind: "location"; id: string }
  | { kind: "master"; id: string }
  | { kind: "process"; id: string }
  | { kind: "operation"; id: string }

export interface Issue {
  /** Stable while the issue lasts. */
  id: string
  group: IssueGroup
  kind: IssueKind
  severity: IssueSeverity
  /** How many things the issue covers (sessions, frames, files, extra duplicate copies). */
  count: number
  /** Bytes the issue covers: the extra copies of duplicates; absent for other kinds. */
  bytes?: number
  /** Value for the copy's `{name}`: the location, Project or session the issue is about; an operation's title is a ref, worded by `issueCopy`. */
  name: string | MessageRef | null
  /** Id of the one record the issue is about (its owner's id); null for a Library count. */
  about: string | null
  owner: IssueOwner
  /** Where the issue's one action leads; `issueCopy` words the action ("Assign"). */
  link: StepLink
}

export const SEVERITY_ORDER: IssueSeverity[] = ["danger", "warning", "info"]

export function worstSeverity(issues: Issue[]): IssueSeverity | null {
  return SEVERITY_ORDER.find((s) => issues.some((i) => i.severity === s)) ?? null
}

/** A Project's own waiting work: the Project waits on the user, and the issue is how they find it (P-ISS1). */
const UNDISMISSABLE: ReadonlySet<IssueKind> = new Set<IssueKind>(["apply-refused", "previous-review"])

export function isDismissable(issue: Issue): boolean {
  return !UNDISMISSABLE.has(issue.kind)
}

/** What a dismissal hides: the same kind, subject, count and bytes. Any change brings the issue back (P-ISS1). */
export function issueFingerprint(issue: Issue): string {
  return [issue.kind, issue.about ?? issue.id, issue.count, issue.bytes ?? ""].join("|")
}

/** The issues one row shows (F7): every issue its owner is. */
export function issuesFor(issues: Issue[], owner: IssueOwner): Issue[] {
  return issues.filter((i) => i.owner.kind === owner.kind && ("id" in owner ? "id" in i.owner && i.owner.id === owner.id : true))
}

/**
 * Every issue, in group order and worst first within a group. `nowMs` is
 * kept for callers that pass the clock the user sees; no issue depends on
 * a master's age (CAL-FR-15).
 */
export function deriveIssues(world: World, _nowMs: number = Date.now() + world.faults.clockOffsetMs): Issue[] {
  const { catalog, disk, operations } = world
  const out: Issue[] = []
  const library: IssueOwner = { kind: "library" }

  // Library queues: a Target, a Project, settled calibration with its pinned files intact (LIB-FR-17, LIB-FR-23, D-W113).
  const work = sessionsNeedingWork(catalog, disk)
  if (work.needsTarget.length > 0) {
    out.push({ id: "sessions:needs-target", group: "sessions", kind: "needs-target", severity: "warning", count: work.needsTarget.length, name: null, about: null, owner: library, link: { to: "/sessions", search: { filter: "needs-target" } } })
  }
  if (work.notInProject.length > 0) {
    out.push({ id: "sessions:not-in-project", group: "sessions", kind: "not-in-project", severity: "info", count: work.notInProject.length, name: null, about: null, owner: library, link: { to: "/sessions", search: { filter: "not-in-project" } } })
  }
  if (work.needsCalibration.length > 0) {
    out.push({ id: "sessions:needs-calibration", group: "sessions", kind: "needs-calibration", severity: "info", count: work.needsCalibration.length, name: null, about: null, owner: library, link: { to: "/sessions", search: { filter: "needs-calibration" } } })
  }

  // A pinned calibration file that changed or went missing (D-W113): on the session, which keeps the pin.
  for (const session of Object.values(catalog.sessions)) {
    if (session.supersededBy || !session.calibration) continue
    const problems = sessionPinProblems(disk, session.calibration).filter((p) => p.state !== "unreadable")
    if (problems.length === 0) continue
    out.push({ id: `session:pin-drift:${session.id}`, group: "sessions", kind: "pin-drift", severity: "danger", count: problems.length, name: sessionRef(session), about: session.id, owner: { kind: "session", id: session.id }, link: { to: "/sessions/$sessionId", params: { sessionId: session.id } } })
  }

  // Offline or unreadable locations.
  for (const location of Object.values(catalog.locations)) {
    const owner: IssueOwner = { kind: "location", id: location.id }
    if (location.access === "denied") {
      out.push({ id: `location:denied:${location.id}`, group: "storage", kind: "location-denied", severity: "danger", count: 1, name: location.displayName, about: location.id, owner, link: { to: "/settings/locations" } })
    } else if (locationAvailability(disk, location) === "offline") {
      out.push({ id: `location:offline:${location.id}`, group: "storage", kind: "location-offline", severity: "warning", count: 1, name: location.displayName, about: location.id, owner, link: { to: "/settings/locations" } })
    }
  }

  // Duplicates the latest scan found that are still live: the extra copies (every copy beyond the one each frame keeps) and their bytes.
  const duplicates = duplicateFindings(world)
  if (duplicates && duplicates.copies > 0) {
    out.push({ id: "storage:duplicates", group: "storage", kind: "duplicates", severity: "warning", count: duplicates.copies, bytes: duplicates.bytes, name: null, about: null, owner: library, link: { to: "/settings/locations", search: { duplicates: "review" } } })
  }

  // Interrupted or failed work: on its Project's row when it worked on one; a calibration process lists its own failures below.
  for (const op of Object.values(operations)) {
    if ((op.status !== "interrupted" && op.status !== "failed") || op.kind === "stack-master") continue
    const failed = op.status === "failed"
    const projectId = op.scope.projectId
    const owner: IssueOwner = projectId ? { kind: "project", id: projectId } : { kind: "operation", id: op.id }
    out.push({ id: `operation:${op.id}`, group: "work", kind: failed ? "work-failed" : "work-interrupted", severity: failed ? "danger" : "warning", count: 1, name: op.title, about: projectId ?? op.id, owner, link: projectId ? projectLink(projectId) : { to: "/activity" } })
  }

  // Open Projects waiting on the user: Apply refused while changes wait, View (previous) to review, generated masters to offer.
  for (const project of Object.values(catalog.projects)) {
    if (project.state !== "open") continue
    const owner: IssueOwner = { kind: "project", id: project.id }
    const leftovers = unreviewedLeftovers(project)
    if (leftovers.length > 0) {
      out.push({ id: `project:previous:${project.id}`, group: "projects", kind: "previous-review", severity: "warning", count: leftovers.length, name: project.name, about: project.id, owner, link: projectTabLink(project.id, "view") })
    }
    const waiting = project.view ? pendingChanges(world, project).length > 0 : project.inputs.length > 0
    if (waiting) {
      const refused = applyPlan(world, project).refusals.filter((r) => r.kind === "pin-drift" || r.kind === "offline" || r.kind === "unsettled" || r.kind === "space" || r.kind === "developer-mode")
      if (refused.length > 0) {
        out.push({ id: `project:apply:${project.id}`, group: "projects", kind: "apply-refused", severity: refused.some((r) => r.kind === "pin-drift") ? "danger" : "warning", count: refused.length, name: project.name, about: project.id, owner, link: projectTabLink(project.id, "view") })
      }
    }
    const masters = processingMasters(world, project).length
    if (masters > 0) {
      out.push({ id: `project:masters:${project.id}`, group: "calibration", kind: "master-offer", severity: "info", count: masters, name: project.name, about: project.id, owner, link: projectTabLink(project.id, "output") })
    }
  }

  // Calibration processes (P-CAL3): raw sessions awaiting Stack, and failed steps.
  const processes = calibrationProcesses(catalog)
  const awaiting = processes.filter((p) => p.status === "awaiting-stack" && p.frames > 0)
  if (awaiting.length > 0) {
    out.push({ id: "calibration:awaiting-stack", group: "calibration", kind: "calibration-waiting", severity: "info", count: awaiting.length, name: null, about: null, owner: library, link: { to: "/calibration" } })
  }
  for (const view of processes) {
    if (view.status !== "failed") continue
    out.push({ id: `calibration:failed:${view.process.id}`, group: "calibration", kind: "calibration-failed", severity: "danger", count: 1, name: view.name, about: view.process.id, owner: { kind: "process", id: view.process.id }, link: { to: "/calibration" } })
  }

  // Drift: frames whose bytes changed after review, and adopted master versions that changed since adoption.
  const drifted = new Map<string, number>()
  for (const asset of Object.values(catalog.assets)) {
    if (asset.trashed || !asset.sessionId || qualityApplicability(asset) !== "changed-content") continue
    drifted.set(asset.sessionId, (drifted.get(asset.sessionId) ?? 0) + 1)
  }
  for (const [sessionId, frames] of drifted) {
    const session = catalog.sessions[sessionId]
    if (!session) continue
    out.push({ id: `drift:session:${sessionId}`, group: "drift", kind: "drift", severity: "warning", count: frames, name: sessionRef(session), about: sessionId, owner: { kind: "session", id: sessionId }, link: { to: "/sessions/$sessionId", params: { sessionId } } })
  }
  for (const master of Object.values(catalog.masters)) {
    if (master.state !== "adopted" || master.hiddenAt) continue
    const changed = master.versions.filter((v) => v.adoption && versionDrift(disk, v) !== null)
    if (changed.length === 0) continue
    out.push({ id: `drift:master:${master.id}`, group: "drift", kind: "drift", severity: "warning", count: changed.length, name: changed[0]!.path.split("/").pop() ?? master.id, about: master.id, owner: { kind: "master", id: master.id }, link: { to: "/calibration" } })
  }

  const rank = (i: Issue) => ISSUE_GROUPS.indexOf(i.group) * 10 + SEVERITY_ORDER.indexOf(i.severity)
  return out.sort((a, b) => rank(a) - rank(b))
}

/** Open Projects waiting on the user (Apply refused, View (previous) to review): the Projects source-list badge. */
export function blockedProjectCount(world: World): number {
  const issues = deriveIssues(world)
  return new Set(issues.filter((i) => i.owner.kind === "project" && UNDISMISSABLE.has(i.kind)).map((i) => i.about)).size
}
