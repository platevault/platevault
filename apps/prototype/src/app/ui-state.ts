/**
 * Shell-level UI state: which global panel is open (command palette,
 * keyboard shortcuts, simulation controls), which workflow sheet is open
 * (Import, New Project, Start a run), the sidebar collapse preference and the
 * recent Projects, sessions and Targets of the source list's Recent menus.
 * Module-level store so the header, shortcuts and screens can open panels and
 * sheets without prop drilling.
 */
import { useSyncExternalStore } from "react"
import type { ProjectId, SessionId, TargetId } from "@/domain/types"

export type GlobalPanel = "palette" | "shortcuts" | "simulation" | null

/**
 * Workflow sheets (IA S4, S13). Each slice renders its own sheet host,
 * mounted once at the app root; any screen opens one with `openSheet`.
 */
export type WorkflowSheet =
  /** S13 Import (slice A): the Lightroom-style entry (D-W11). */
  | { kind: "import" }
  /** S4 New Project (slice B); `fromSessionId` prefills its Target and rig (LIB-FR-17); `targetId` prefills a subject (S10 Target detail). */
  | { kind: "new-project"; fromSessionId?: SessionId; targetId?: TargetId }
  /** "Start a processing run": one subject and one rig of the Project (slice B, PRJ-FR-10). */
  | { kind: "start-run"; projectId: ProjectId }
  | null

const SIDEBAR_KEY = "platevault.sidebar"
/** Each Recent menu lists at most this many records. */
export const RECENT_LIMIT = 5

export type RecentKind = "projects" | "sessions" | "targets"

const RECENT_KEY: Record<RecentKind, string> = { projects: "platevault.recentProjects", sessions: "platevault.recentSessions", targets: "platevault.recentTargets" }

interface ShellUiState {
  panel: GlobalPanel
  sheet: WorkflowSheet
  sidebarCollapsed: boolean
  /** The records opened most recently, newest first, per kind. */
  recent: Record<RecentKind, string[]>
}

function readSidebar(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "collapsed"
  } catch {
    return false
  }
}

function readRecent(kind: RecentKind): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(RECENT_KEY[kind]) ?? "[]")
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string").slice(0, RECENT_LIMIT) : []
  } catch {
    return []
  }
}

let current: ShellUiState = {
  panel: null,
  sheet: null,
  sidebarCollapsed: readSidebar(),
  recent: { projects: readRecent("projects"), sessions: readRecent("sessions"), targets: readRecent("targets") },
}
const listeners = new Set<() => void>()

function set(next: Partial<ShellUiState>) {
  current = { ...current, ...next }
  for (const listener of listeners) listener()
}

export function openPanel(panel: Exclude<GlobalPanel, null>) {
  set({ panel })
}

export function closePanel() {
  set({ panel: null })
}

export function openSheet(sheet: Exclude<WorkflowSheet, null>) {
  set({ sheet, panel: null })
}

export function closeSheet() {
  set({ sheet: null })
}

export function toggleSidebar() {
  const sidebarCollapsed = !current.sidebarCollapsed
  try {
    localStorage.setItem(SIDEBAR_KEY, sidebarCollapsed ? "collapsed" : "expanded")
  } catch {
    // Preference applies for this session only.
  }
  set({ sidebarCollapsed })
}

/** A Project, session or Target was opened: it leads its Recent menu. */
export function rememberRecent(kind: RecentKind, id: string) {
  const ids = current.recent[kind]
  if (ids[0] === id) return
  const next = [id, ...ids.filter((other) => other !== id)].slice(0, RECENT_LIMIT)
  try {
    localStorage.setItem(RECENT_KEY[kind], JSON.stringify(next))
  } catch {
    // Recent applies for this session only.
  }
  set({ recent: { ...current.recent, [kind]: next } })
}

export function useShellUi(): ShellUiState {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => current,
  )
}
