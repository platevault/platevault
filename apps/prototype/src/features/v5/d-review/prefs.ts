/**
 * Review preferences (slice D), kept across sessions in localStorage: auto-
 * advance (on by default, D-W53), the display-name preset (D-W15), the
 * visible columns (PIX-FR-16) and the table's last dragged height (D-W22,
 * PIX-FR-10). Per-review state (filter, sort, selection, view) is component
 * state, so a selection never survives a restart.
 */
import { useSyncExternalStore } from "react"

export type TableHeight = "full" | "rows" | "strip"

export interface ReviewPrefs {
  autoAdvance: boolean
  namePreset: string
  columns: string[]
  /** Height of the "about 8 rows" state, in px, after the last drag. */
  rowsHeightPx: number
  inspectorOpen: boolean
}

export const DEFAULT_COLUMNS = ["frame", "panel", "subject", "session", "quality", "member", "fwhm", "hfr", "eccentricity", "star-count", "background"]
/** About 8 rows of 26 px plus the header row. */
export const ROWS_DEFAULT_PX = 9 * 26 + 2

const KEY = "platevault.review.v1"
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
