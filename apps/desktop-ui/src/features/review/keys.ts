/**
 * Review hotkeys (PIX-FR-13; D-W14, D-W22, D-W40, D-W53): one key map for the
 * table, the filmstrip and the grid. `reviewKey` reads a keydown and names the
 * command, or null when the key is not Review's here; the workspace runs the
 * command the same way in every view.
 *
 * - ← → and J K step; in the grid ↑ ↓ step a row. A control that owns the
 *   arrows (a slider, a menu, the list's resize handle) and a zoomed plate
 *   (which pans) keep them.
 * - P X U mark; Shift+P and Shift+X mark and advance even with auto-advance
 *   off. Z zoom, F fullscreen, C compare, G grid, T table height, Space
 *   toggles the current frame in the selection.
 * - ⌘A selects every frame shown, ⌘I toggles the corner inspector, ⌘↩
 *   finishes the review, ⌥1 to ⌥4 filter (by key position, so a layout's
 *   Option characters do not matter). Escape leaves fullscreen, then clears
 *   the selection.
 * - Single keys follow the app's single-key setting (WCAG 2.1.4); chords,
 *   arrows and Escape stay on.
 */
import type { ReviewFilter } from "@/api/ipc"
import { FILTER_ORDER } from "./model"

export type ReviewKey =
  | { id: "step"; delta: 1 | -1 }
  | { id: "row"; delta: 1 | -1 }
  | { id: "mark"; quality: "usable" | "unusable" | "unreviewed"; always: boolean }
  | { id: "zoom" | "fullscreen" | "compare" | "grid" | "height" | "select-all" | "corners" | "finish" | "toggle-selected" | "escape" }
  | { id: "filter"; filter: ReviewFilter }

/** The key-cap legends the toolbar, the menus and the palette print (shared by every locale). */
export const REVIEW_KEYS = {
  previous: "K",
  next: "J",
  pick: "P",
  reject: "X",
  unreviewed: "U",
  zoom: "Z",
  fullscreen: "F",
  compare: "C",
  grid: "G",
  height: "T",
} as const

/** Controls that own the arrow keys while they have focus. */
const ARROW_OWNERS = "[role=tablist],[role=separator],[role=slider],[role=radiogroup],[role=menu],[role=listbox],[data-workspace-handle]"
/** Where Space toggles the current frame instead of acting on the focused control. */
const SPACE_TARGETS = "[data-frame-item],[data-workspace-list] tbody tr,[data-plate]"

export interface KeyContext {
  /** The app's single-key setting. */
  singleKeys: boolean
  /** The focused element, or null. */
  target: Element | null
  /** Whether the focused plate is zoomed, so the arrows pan it. */
  zoomedPlate: boolean
}

type KeyEventLike = Pick<KeyboardEvent, "key" | "code" | "metaKey" | "ctrlKey" | "altKey" | "shiftKey">

const SINGLE: Record<string, ReviewKey> = {
  j: { id: "step", delta: 1 },
  k: { id: "step", delta: -1 },
  z: { id: "zoom" },
  f: { id: "fullscreen" },
  c: { id: "compare" },
  g: { id: "grid" },
  t: { id: "height" },
  u: { id: "mark", quality: "unreviewed", always: false },
}

export function reviewKey(event: KeyEventLike, { singleKeys, target, zoomedPlate }: KeyContext): ReviewKey | null {
  const { key } = event
  if ((event.metaKey || event.ctrlKey) && !event.altKey) {
    const lower = key.toLowerCase()
    if (lower === "a" && !event.shiftKey) return { id: "select-all" }
    if (lower === "i" && !event.shiftKey) return { id: "corners" }
    if (key === "Enter") return { id: "finish" }
    return null
  }
  if (event.altKey) {
    if (event.metaKey || event.ctrlKey || event.shiftKey) return null
    const n = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(event.code)
    return n >= 0 ? { id: "filter", filter: FILTER_ORDER[n]! } : null
  }
  if (key === "Escape") return { id: "escape" }
  if (key.startsWith("Arrow")) {
    if (event.shiftKey || target?.closest(ARROW_OWNERS) || (zoomedPlate && target?.closest("[data-plate]"))) return null
    if (key === "ArrowRight") return { id: "step", delta: 1 }
    if (key === "ArrowLeft") return { id: "step", delta: -1 }
    return { id: "row", delta: key === "ArrowDown" ? 1 : -1 }
  }
  if (!singleKeys) return null
  if (key === " ") {
    // A row's checkbox keeps Space for itself (FR-037): it ticks that row, not the current frame.
    if (event.shiftKey || target?.closest("[role=checkbox]")) return null
    return target === null || target === target.ownerDocument.body || target.closest(SPACE_TARGETS) ? { id: "toggle-selected" } : null
  }
  const lower = key.toLowerCase()
  if (lower === "p") return { id: "mark", quality: "usable", always: event.shiftKey }
  if (lower === "x") return { id: "mark", quality: "unusable", always: event.shiftKey }
  if (event.shiftKey) return null
  return SINGLE[lower] ?? null
}
