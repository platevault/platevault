/**
 * Review navigation (PIX-FR-10, PIX-FR-11, PIX-FR-13, D-W22, D-W40, D-W53):
 * the one frame order, current frame and selection that the table, the
 * filmstrip and the grid share, and the list's three heights. Pure
 * functions over frame ids, so every view and every hotkey moves through the
 * same rules.
 */
import type { Quality, QualityLabel, ReviewFilter } from "@/api/ipc"
import type { WorkspaceListHeight } from "@/components/templates/workspace"

export type ListView = "table" | "filmstrip" | "grid"
export type TableHeight = WorkspaceListHeight

/** T from about 8 rows: the one-line strip, then full height, then the rows again (PIX-AC-15). */
export const HEIGHT_NEXT: Record<TableHeight, TableHeight> = { rows: "strip", strip: "full", full: "rows" }

/** ⌥1 to ⌥4, in order (D-W14). */
export const FILTER_ORDER: readonly ReviewFilter[] = ["all", "picked", "rejected", "unreviewed"]

/** How the selection was made: a mark on an "all" selection (⌘A) asks first, whatever its count (PIX-FR-14). */
export type SelectionOrigin = "hand" | "all"

export interface Selection {
  ids: ReadonlySet<string>
  origin: SelectionOrigin
}

export const NO_SELECTION: Selection = { ids: new Set(), origin: "hand" }

/** The label a frame reads after a mark. */
export function labelAfterMark(quality: Quality): QualityLabel {
  return quality === "usable" ? "picked" : quality === "unusable" ? "rejected" : "unreviewed"
}

/** The frames the filter admits, in list order. */
export function admitted<F extends { label: QualityLabel }>(frames: readonly F[], filter: ReviewFilter): F[] {
  return filter === "all" ? [...frames] : frames.filter((f) => f.label === filter)
}

/** The current frame: the stored one while the list shows it, else the first. */
export function currentIn(ordered: readonly string[], stored: string | null): string | null {
  return stored !== null && ordered.includes(stored) ? stored : (ordered[0] ?? null)
}

/** The frame `delta` places from the current one, held at the ends; null when it does not move. */
export function stepFrom(ordered: readonly string[], current: string | null, delta: number): string | null {
  if (ordered.length === 0) return null
  const at = current === null ? -1 : ordered.indexOf(current)
  const next = ordered[Math.min(ordered.length - 1, Math.max(0, at + delta))]!
  return next === current ? null : next
}

export type Activation = "set" | "toggle" | "range"

/**
 * The selection after a click, ⌘-click, Shift-click or Space on `id`. A
 * plain click clears it; ⌘-click on another frame with nothing selected starts
 * from the current frame; Shift-click selects the range from the current frame.
 */
export function selectionAfter(selection: Selection, ordered: readonly string[], current: string | null, id: string, mode: Activation): Selection {
  if (mode === "set") return NO_SELECTION
  if (mode === "toggle") {
    const next = new Set(selection.ids.size === 0 && current !== null && current !== id ? [current] : selection.ids)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return { ids: next, origin: "hand" }
  }
  const from = Math.max(0, current === null ? 0 : ordered.indexOf(current))
  const to = ordered.indexOf(id)
  if (to < 0) return selection
  return { ids: new Set(ordered.slice(Math.min(from, to), Math.max(from, to) + 1)), origin: "hand" }
}

export interface MarkAdvance {
  ordered: readonly string[]
  current: string | null
  /** The frames the mark applies to. */
  marked: readonly string[]
  quality: Quality
  filter: ReviewFilter
  autoAdvance: boolean
  /** Shift+P and Shift+X: advance even when auto-advance is off. */
  always: boolean
}

/**
 * The current frame after a mark succeeds; null keeps it. A mark on the
 * current frame alone advances to the next frame in list order when
 * auto-advance is on or with Shift, and also when the mark takes it out of the
 * filtered list; at the end of the list it goes back one. A mark on a
 * selection keeps the current frame unless the filter now hides it.
 */
export function currentAfterMark({ ordered, current, marked, quality, filter, autoAdvance, always }: MarkAdvance): string | null {
  if (current === null || !marked.includes(current)) return null
  const leaves = filter !== "all" && labelAfterMark(quality) !== filter
  const at = ordered.indexOf(current)
  if (marked.length === 1) {
    if (!(autoAdvance || always || leaves)) return null
    return ordered[at + 1] ?? (leaves ? (ordered[at - 1] ?? null) : null)
  }
  if (!leaves) return null
  const rest = (id: string) => !marked.includes(id)
  return ordered.slice(at + 1).find(rest) ?? ordered.slice(0, at).reverse().find(rest) ?? null
}

/** T: in the table it cycles the height; from the filmstrip or the grid it goes back to the table. */
export function afterHeightKey(view: ListView, height: TableHeight): { view: ListView; height: TableHeight } {
  return view === "table" ? { view, height: HEIGHT_NEXT[height] } : { view: "table", height }
}

/** The list's Workspace height in each view: the grid fills, the filmstrip is one line. */
export function listHeightOf(view: ListView, height: TableHeight): TableHeight {
  return view === "grid" ? "full" : view === "filmstrip" ? "strip" : height
}
