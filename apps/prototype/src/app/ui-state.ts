/**
 * Shell-level UI state: which global panel is open (command palette,
 * keyboard shortcuts, simulation controls), the sidebar collapse preference,
 * the source-list width and whether the inspector pane shows. Module-level
 * store so the toolbar, shortcuts and tracks can open panels without prop
 * drilling. Widths and visibility persist like AppKit split-view autosave.
 */
import { useSyncExternalStore } from "react"

export type GlobalPanel = "palette" | "shortcuts" | "simulation" | null

const SIDEBAR_KEY = "platevault.sidebar"
const SIDEBAR_WIDTH_KEY = "platevault.sidebarWidth"
const INSPECTOR_KEY = "platevault.inspector"
const INSPECTOR_WIDTH_KEY = "platevault.inspectorWidth"

export const SIDEBAR_WIDTH = { min: 176, max: 320, initial: 212 }
export const INSPECTOR_WIDTH = { min: 240, max: 420, initial: 288 }

interface ShellUiState {
  panel: GlobalPanel
  sidebarCollapsed: boolean
  sidebarWidth: number
  inspectorOpen: boolean
  inspectorWidth: number
}

function readKey(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeKey(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Preference applies for this session only.
  }
}

function readWidth(key: string, bounds: { min: number; max: number; initial: number }): number {
  const value = Number(readKey(key))
  return Number.isFinite(value) && value >= bounds.min && value <= bounds.max ? value : bounds.initial
}

let current: ShellUiState = {
  panel: null,
  sidebarCollapsed: readKey(SIDEBAR_KEY) === "collapsed",
  sidebarWidth: readWidth(SIDEBAR_WIDTH_KEY, SIDEBAR_WIDTH),
  inspectorOpen: readKey(INSPECTOR_KEY) !== "hidden",
  inspectorWidth: readWidth(INSPECTOR_WIDTH_KEY, INSPECTOR_WIDTH),
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

export function toggleSidebar() {
  const sidebarCollapsed = !current.sidebarCollapsed
  writeKey(SIDEBAR_KEY, sidebarCollapsed ? "collapsed" : "expanded")
  set({ sidebarCollapsed })
}

export function setSidebarWidth(width: number) {
  const sidebarWidth = Math.round(Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, width)))
  writeKey(SIDEBAR_WIDTH_KEY, String(sidebarWidth))
  set({ sidebarWidth })
}

export function toggleInspector() {
  const inspectorOpen = !current.inspectorOpen
  writeKey(INSPECTOR_KEY, inspectorOpen ? "shown" : "hidden")
  set({ inspectorOpen })
}

export function setInspectorWidth(width: number) {
  const inspectorWidth = Math.round(Math.min(INSPECTOR_WIDTH.max, Math.max(INSPECTOR_WIDTH.min, width)))
  writeKey(INSPECTOR_WIDTH_KEY, String(inspectorWidth))
  set({ inspectorWidth })
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
