/**
 * Shell-level UI state: which global panel is open (command palette,
 * keyboard shortcuts, simulation controls), which workflow sheet is open
 * (Import, New Project, Done / Archive, Start a run) and the sidebar collapse
 * preference. Module-level store so the header, shortcuts and screens can
 * open panels and sheets without prop drilling.
 */
import { useSyncExternalStore } from "react"
import type { ProjectId, SessionId, TargetId } from "@/domain/types"

export type GlobalPanel = "palette" | "shortcuts" | "simulation" | null

/**
 * Workflow sheets (IA S4, S9, S13). Each slice renders its own sheet host,
 * mounted once at the app root; any screen opens one with `openSheet`.
 */
export type WorkflowSheet =
  /** S13 Import (slice A): the Lightroom-style entry (D-W11). */
  | { kind: "import" }
  /** S4 New Project (slice B); `fromSessionId` prefills its Target and rig (LIB-FR-17). */
  | { kind: "new-project"; fromSessionId?: SessionId; targetId?: TargetId }
  /** S9 Done / Archive sheet on a Project (slice B). */
  | { kind: "done-archive"; projectId: ProjectId }
  /** "Start a processing run": one subject and one rig of the Project (slice B, PRJ-FR-10). */
  | { kind: "start-run"; projectId: ProjectId }
  | null

const SIDEBAR_KEY = "platevault.sidebar"

interface ShellUiState {
  panel: GlobalPanel
  sheet: WorkflowSheet
  sidebarCollapsed: boolean
}

function readSidebar(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "collapsed"
  } catch {
    return false
  }
}

let current: ShellUiState = { panel: null, sheet: null, sidebarCollapsed: readSidebar() }
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
