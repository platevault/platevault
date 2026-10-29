/**
 * Review preferences, kept in this webview's local storage like the sidebar
 * choice: auto-advance (on by default, D-W53), the list's height in `rows`
 * after the last resize (remembered, D-W22, PIX-FR-10), and the corner
 * inspector's overlays. Per-review state (filter, sort, selection, current
 * frame, view) lives in the workspace, so a selection never survives a
 * restart.
 */
import { useSyncExternalStore } from "react"

export interface ReviewPrefs {
  autoAdvance: boolean
  /** Height of the list in `rows`, in px, after the last resize. */
  rowsHeightPx: number
  cornerFwhm: boolean
  cornerEccentricity: boolean
}

/** About 8 rows of the 26 px row token, plus the header row. */
export const ROWS_DEFAULT_PX = 9 * 26

const KEY = "platevault.review"
const DEFAULTS: ReviewPrefs = { autoAdvance: true, rowsHeightPx: ROWS_DEFAULT_PX, cornerFwhm: true, cornerEccentricity: true }

function read(): ReviewPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const stored = JSON.parse(raw) as Partial<Record<keyof ReviewPrefs, unknown>>
    const flag = (k: "autoAdvance" | "cornerFwhm" | "cornerEccentricity") => (typeof stored[k] === "boolean" ? stored[k] : DEFAULTS[k])
    const px = stored.rowsHeightPx
    return {
      autoAdvance: flag("autoAdvance"),
      rowsHeightPx: typeof px === "number" && Number.isFinite(px) && px > 0 ? px : DEFAULTS.rowsHeightPx,
      cornerFwhm: flag("cornerFwhm"),
      cornerEccentricity: flag("cornerEccentricity"),
    }
  } catch {
    return DEFAULTS
  }
}

let current: ReviewPrefs = read()
const listeners = new Set<() => void>()

export function setReviewPrefs(patch: Partial<ReviewPrefs>): void {
  current = { ...current, ...patch }
  try {
    localStorage.setItem(KEY, JSON.stringify(current))
  } catch {
    // Storage refused: the choice applies until the window reloads.
  }
  for (const listener of listeners) listener()
}

/** Re-reads local storage; tests call it after changing storage. */
export function reloadReviewPrefs(): void {
  current = read()
  for (const listener of listeners) listener()
}

export function useReviewPrefs(): ReviewPrefs {
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
