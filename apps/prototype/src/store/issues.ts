/**
 * Issues and source-list counts as hooks (foundation-owned). The toolbar's
 * Issues hub, Home's issue pills, the status bar's pills and chips and the
 * source-list badges read the same derivations (`src/domain/issues.ts`), so
 * their numbers always agree.
 */
import { blockedProjectCount, deriveIssues, type Issue, type IssueSeverity, sessionsNeedingAttention, type StatusIssues, statusIssues, worstSeverity } from "@/domain/issues"
import { type PrototypeState, useStore } from "./core"

/** Derived once per state version: the hub, Home and the status bar all read it. */
let cached: { state: PrototypeState; issues: Issue[] } | null = null

function selectIssues(s: PrototypeState): Issue[] {
  if (cached?.state !== s) cached = { state: s, issues: deriveIssues(s) }
  return cached.issues
}

/** Every issue across the app, grouped and worst first, with the worst severity. */
export function useIssues(): { issues: Issue[]; worst: IssueSeverity | null } {
  const issues = useStore(selectIssues)
  return { issues, worst: worstSeverity(issues) }
}

const selectStatusIssues = (s: PrototypeState) => statusIssues(selectIssues(s))

/** The status bar's issues: each as a named pill, and the chips left after naming the first `k` (`StatusIssues.chipsAfter`). */
export function useStatusIssues(): StatusIssues {
  return useStore(selectStatusIssues)
}

const selectNavCounts = (s: PrototypeState) => ({ sessions: sessionsNeedingAttention(s), projects: blockedProjectCount(s) })

/** Source-list badges: Sessions that need attention, open Projects with a blocked run. */
export function useNavCounts(): { sessions: number; projects: number } {
  return useStore(selectNavCounts)
}
