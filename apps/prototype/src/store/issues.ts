/**
 * Issues and source-list counts as hooks (foundation-owned). The toolbar's
 * Issues hub, the status bar's severity counters and the source-list badges
 * read the same derivations (`src/domain/issues.ts`), so their numbers
 * always agree.
 *
 * Dismissals (P-ISS1): `PrototypeState.issuesDismissed` holds the
 * fingerprints of dismissed issues. A dismissed issue is hidden from every
 * count until its fingerprint changes; a fingerprint whose issue is gone is
 * dropped (`pruneDismissedIssues`), so an issue that ends and returns comes
 * back. Dismissing hides the issue only: the state behind it is unchanged.
 */
import { blockedProjectCount, deriveIssues, type Issue, issueFingerprint, type IssueSeverity, isDismissable, worstSeverity } from "@/domain/issues"
import { type PrototypeState, store, useStore } from "./core"

/** Derived once per state version: the hub and the status bar both read it. */
let cached: { state: PrototypeState; issues: Issue[] } | null = null

function selectIssues(s: PrototypeState): Issue[] {
  if (cached?.state !== s) cached = { state: s, issues: deriveIssues(s) }
  return cached.issues
}

export interface IssueView {
  /** Issues not dismissed, in hub order: every count, badge and tint reads these. */
  issues: Issue[]
  /** Dismissed issues, in hub order. */
  dismissed: Issue[]
  /** Worst severity among `issues`. */
  worst: IssueSeverity | null
}

let cachedView: { all: Issue[]; fingerprints: string[] | undefined; view: IssueView } | null = null

function selectIssueView(s: PrototypeState): IssueView {
  const all = selectIssues(s)
  if (cachedView?.all === all && cachedView.fingerprints === s.issuesDismissed) return cachedView.view
  const hidden = new Set(s.issuesDismissed)
  const issues: Issue[] = []
  const dismissed: Issue[] = []
  for (const issue of all) (isDismissable(issue) && hidden.has(issueFingerprint(issue)) ? dismissed : issues).push(issue)
  const view = { issues, dismissed, worst: worstSeverity(issues) }
  cachedView = { all, fingerprints: s.issuesDismissed, view }
  return view
}

/** Every issue across the app not dismissed, grouped and worst first, with the worst severity; and the dismissed ones. */
export function useIssues(): IssueView {
  return useStore(selectIssueView)
}

function setDismissed(update: (fingerprints: string[]) => string[]) {
  store.setState((s) => {
    const current = s.issuesDismissed ?? []
    const next = update(current)
    return next.length === current.length && next.every((f, i) => f === current[i]) ? s : { ...s, issuesDismissed: next }
  })
}

/** Hide `issue` until it changes. A run's next step cannot be dismissed. */
export function dismissIssue(issue: Issue) {
  if (!isDismissable(issue)) return
  const fingerprint = issueFingerprint(issue)
  setDismissed((f) => (f.includes(fingerprint) ? f : [...f, fingerprint]))
}

/** Bring a dismissed issue back. */
export function restoreIssue(issue: Issue) {
  const fingerprint = issueFingerprint(issue)
  setDismissed((f) => f.filter((x) => x !== fingerprint))
}

/** Bring every dismissed issue back. */
export function restoreAllIssues() {
  setDismissed(() => [])
}

/** Drop fingerprints whose issue is gone or changed; the store calls it after every change. */
export function pruneDismissedIssues() {
  const s = store.getState()
  if (!s.issuesDismissed?.length) return
  const live = new Set(selectIssues(s).map(issueFingerprint))
  setDismissed((f) => f.filter((x) => live.has(x)))
}

function selectNavCounts(s: PrototypeState) {
  const sessions = selectIssueView(s)
    .issues.filter((i) => i.group === "sessions")
    .reduce((n, i) => n + i.count, 0)
  return { sessions, projects: blockedProjectCount(s) }
}

/** Source-list badges: Sessions that need attention (as their issues not dismissed), open Projects with a blocked run. */
export function useNavCounts(): { sessions: number; projects: number } {
  return useStore(selectNavCounts)
}
