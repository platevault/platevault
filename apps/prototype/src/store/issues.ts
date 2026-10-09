/**
 * Issues and source-list counts as hooks (foundation-owned). The toolbar's
 * Issues hub, Home's issue pills, the status bar's chips and the source-list
 * badges read the same derivations (`src/domain/issues.ts`), so their
 * numbers always agree.
 */
import { blockedProjectCount, deriveIssues, type Issue, type IssueSeverity, sessionsNeedingAttention, type StatusChip, statusChips, worstSeverity } from "@/domain/issues"
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

const selectChips = (s: PrototypeState) => statusChips(selectIssues(s))

/** The status bar's issue chips: offline, blocked runs, need a Target, calibration waiting. */
export function useStatusChips(): StatusChip[] {
  return useStore(selectChips)
}

const selectNavCounts = (s: PrototypeState) => ({ sessions: sessionsNeedingAttention(s), projects: blockedProjectCount(s) })

/** Source-list badges: Sessions that need attention, open Projects with a blocked run. */
export function useNavCounts(): { sessions: number; projects: number } {
  return useStore(selectNavCounts)
}
