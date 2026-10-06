/**
 * Shell-level UI state: which global panel is open (command palette,
 * keyboard shortcuts, simulation controls), the sidebar collapse and the
 * pane layout (source list and inspector widths, inspector shown). Module-level
 * store so the toolbar, shortcuts and tracks can drive it without prop drilling.
 */
import { useSyncExternalStore } from "react"

export type GlobalPanel = "palette" | "shortcuts" | "simulation" | null

const SIDEBAR_KEY = "platevault.sidebar"
const PANES_KEY = "platevault.v3.panes"

export const SIDEBAR_WIDTH = { min: 168, max: 300, initial: 196 }
export const INSPECTOR_WIDTH = { min: 240, max: 440, initial: 288 }

interface ShellUiState {
  panel: GlobalPanel
  sidebarCollapsed: boolean
  /** The user's choice; the shell also hides it when the page offers nothing to inspect. */
  inspectorOpen: boolean
  sidebarWidth: number
  inspectorWidth: number
}

function readSidebar(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "collapsed"
  } catch {
    return false
  }
}

function readPanes(): Pick<ShellUiState, "inspectorOpen" | "sidebarWidth" | "inspectorWidth"> {
  const fallback = { inspectorOpen: true, sidebarWidth: SIDEBAR_WIDTH.initial, inspectorWidth: INSPECTOR_WIDTH.initial }
  try {
    const raw = localStorage.getItem(PANES_KEY)
    if (!raw) return fallback
    const saved = JSON.parse(raw) as Partial<typeof fallback>
    return {
      inspectorOpen: typeof saved.inspectorOpen === "boolean" ? saved.inspectorOpen : fallback.inspectorOpen,
      sidebarWidth: clamp(Number(saved.sidebarWidth) || fallback.sidebarWidth, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max),
      inspectorWidth: clamp(Number(saved.inspectorWidth) || fallback.inspectorWidth, INSPECTOR_WIDTH.min, INSPECTOR_WIDTH.max),
    }
  } catch {
    return fallback
  }
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(value)))
}

let current: ShellUiState = { panel: null, sidebarCollapsed: readSidebar(), ...readPanes() }
const listeners = new Set<() => void>()

function set(next: Partial<ShellUiState>) {
  current = { ...current, ...next }
  for (const listener of listeners) listener()
}

function savePanes() {
  try {
    localStorage.setItem(
      PANES_KEY,
      JSON.stringify({ inspectorOpen: current.inspectorOpen, sidebarWidth: current.sidebarWidth, inspectorWidth: current.inspectorWidth }),
    )
  } catch {
    // Layout applies for this session only.
  }
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

export function toggleInspector(open = !current.inspectorOpen) {
  set({ inspectorOpen: open })
  savePanes()
}

export function setSidebarWidth(width: number) {
  set({ sidebarWidth: clamp(width, SIDEBAR_WIDTH.min, SIDEBAR_WIDTH.max) })
  savePanes()
}

export function setInspectorWidth(width: number) {
  set({ inspectorWidth: clamp(width, INSPECTOR_WIDTH.min, INSPECTOR_WIDTH.max) })
  savePanes()
}

export function getShellUi(): ShellUiState {
  return current
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
