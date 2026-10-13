/**
 * Review preferences (slice D), kept across sessions in localStorage: auto-
 * advance (on by default, D-W53), the display-name preset (D-W15), the
 * visible columns (PIX-FR-16), the list's last set height in rows (D-W22,
 * PIX-FR-10) and whether the docked inspector shows. Per-review state
 * (filter, sort, selection, view) is component state, so a selection never
 * survives a restart.
 */
import { useSyncExternalStore } from "react"
import type { WorkspaceListHeight } from "@/components/templates/workspace"

export type TableHeight = WorkspaceListHeight

export interface ReviewPrefs {
  autoAdvance: boolean
  namePreset: string
  columns: string[]
  /** Height of the list in `rows`, in px, after the last resize. */
  rowsHeightPx: number
  inspectorOpen: boolean
}

export const DEFAULT_COLUMNS = ["frame", "time", "quality", "fwhm", "hfr", "eccentricity", "star-count", "background"]
/** About 8 rows of 26 px plus the header row. */
export const ROWS_DEFAULT_PX = 9 * 26

const KEY = "platevault.review.v2"
const DEFAULTS: ReviewPrefs = { autoAdvance: true, namePreset: "file", columns: DEFAULT_COLUMNS, rowsHeightPx: ROWS_DEFAULT_PX, inspectorOpen: true }

function read(): ReviewPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    return raw ? { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ReviewPrefs>) } : DEFAULTS
  } catch {
    return DEFAULTS
  }
}

let current: ReviewPrefs = read()
const listeners = new Set<() => void>()

export function setReviewPrefs(patch: Partial<ReviewPrefs>) {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // Storage full or blocked: the preference still applies for this session.
  }
  for (const listener of listeners) listener()
}

export function useReviewPrefs(): ReviewPrefs {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => current,
  )
}
