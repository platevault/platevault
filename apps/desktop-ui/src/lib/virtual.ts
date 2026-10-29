/**
 * Windowing (`@tanstack/react-virtual`) as the app's long lists use it:
 * DataTable rows and the FrameThumbnails strip and grid mount only the items
 * in and near their viewport.
 *
 * - A viewport or item with no layout (`display: none`, a DOM without
 *   layout) counts as the window's size and its item as its estimate, so a
 *   hidden list still mounts a bounded window instead of every item.
 * - `keepMounted` keeps the items focus lives on (the current row, the open
 *   row, the current frame) mounted wherever the window is, so the list's one
 *   Tab stop always exists and the host can scroll it into view.
 * - `spacing` turns the mounted items into the room their unmounted
 *   neighbours take, for a spacer row or a margin.
 */
import { defaultRangeExtractor, measureElement, observeElementRect, type Range, type Rect, type VirtualItem, type Virtualizer } from "@tanstack/react-virtual"

/** The viewport before it is measured: the window, so the first render already mounts a bounded window. */
export function initialRect(): Rect {
  return typeof window === "undefined" ? { width: 0, height: 0 } : { width: window.innerWidth, height: window.innerHeight }
}

/** `observeElementRect`, reading a side with no layout as the window's. */
export function observeRect<S extends Element, T extends Element>(instance: Virtualizer<S, T>, cb: (rect: Rect) => void) {
  return observeElementRect(instance, (rect) => {
    const view = instance.targetWindow
    cb(view === null ? rect : { width: rect.width || view.innerWidth, height: rect.height || view.innerHeight })
  })
}

/** `measureElement`, reading an item with no layout as its estimate. */
export function measureOrEstimate<S extends Element, T extends Element>(element: T, entry: ResizeObserverEntry | undefined, instance: Virtualizer<S, T>): number {
  return measureElement(element, entry, instance) || instance.options.estimateSize(instance.indexFromElement(element))
}

/** A range extractor: the window and overscan, plus the `pinned` indexes (-1 for none). */
export function keepMounted(pinned: readonly number[]) {
  return (range: Range): number[] => {
    const indexes = defaultRangeExtractor(range)
    const first = indexes[0] ?? 0
    const last = indexes.at(-1) ?? -1
    const extra = [...new Set(pinned)].filter((index) => index >= 0 && index < range.count && (index < first || index > last))
    return extra.length === 0 ? indexes : [...indexes, ...extra].sort((a, b) => a - b)
  }
}

/**
 * The room the unmounted items take: `before[k]` ahead of mounted item `k` (from `origin` for the first, else
 * from the previous one's end, less the `gap` the layout already puts between neighbours) and `after` the last,
 * up to `total` (`getTotalSize()`).
 */
export function spacing(items: readonly VirtualItem[], origin: number, total: number, gap = 0): { before: number[]; after: number } {
  const before = items.map((item, k) => (k === 0 ? item.start - origin : item.start - items[k - 1]!.end - gap))
  const last = items.at(-1)
  return { before, after: last === undefined ? total : total - (last.end - origin) }
}
