/**
 * Shell UI state: which global panel is open (the command palette, the
 * keyboard help) and whether the sidebar is the icon rail. A module store,
 * so the toolbar, the shortcuts and the palette open panels without prop
 * drilling. The rail choice is this webview's own, kept in local storage;
 * appearance and language live in the settings store (preferences.ts).
 */
import { useSyncExternalStore } from "react"

export type GlobalPanel = "palette" | "shortcuts" | null

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
    // Storage refused: the choice applies until the window reloads.
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
