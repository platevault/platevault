/**
 * Issues and source-list counts as hooks (foundation-owned). The toolbar's
 * Issues hub, the status bar's severity counters and the source-list badges
 * read the same derivations (`src/domain/issues.ts`), so their numbers
 * always agree.
 */
import { blockedProjectCount, deriveIssues, type Issue, type IssueSeverity, sessionsNeedingAttention, worstSeverity } from "@/domain/issues"
import { type PrototypeState, useStore } from "./core"

/** Derived once per state version: the hub and the status bar both read it. */
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

const selectNavCounts = (s: PrototypeState) => ({ sessions: sessionsNeedingAttention(s), projects: blockedProjectCount(s) })

/** Source-list badges: Sessions that need attention, open Projects with a blocked run. */
export function useNavCounts(): { sessions: number; projects: number } {
  return useStore(selectNavCounts)
}
