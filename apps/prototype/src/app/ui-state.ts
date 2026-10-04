/**
 * Shell-level UI state: which global panel is open (command palette,
 * keyboard shortcuts, simulation controls) and the sidebar collapse
 * preference. Module-level store so the header, shortcuts and tracks can
 * open panels without prop drilling.
 */
import { useSyncExternalStore } from "react"

export type GlobalPanel = "palette" | "shortcuts" | "simulation" | null

const SIDEBAR_KEY = "platevault.sidebar"

interface ShellUiState {
  panel: GlobalPanel
  sidebarCollapsed: boolean
}

function readSidebar(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "collapsed"
  } catch {
    return false
  }
}

let current: ShellUiState = { panel: null, sidebarCollapsed: readSidebar() }
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
