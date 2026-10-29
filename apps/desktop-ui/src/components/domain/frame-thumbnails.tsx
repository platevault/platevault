/**
 * FrameThumbnails (L2-domain; D-W40, PIX-FR-11, PIX-FR-12): the frames of a
 * list as thumbnails, either one horizontal strip (the filmstrip) or a grid
 * that fills its space (Lightroom-style culling). The host owns the order,
 * the current frame and the selection, so switching between the table, the
 * strip and the grid keeps all three.
 *
 * - A click makes a frame current, ⌘/Ctrl-click toggles it in the selection
 *   and Shift-click selects the range from the current frame (`onActivate`).
 * - One Tab stop: only the current frame (else the first) is tabbable. The
 *   current frame scrolls into view and, while focus is in the list, focus
 *   follows it on every step, so focus and the current frame stay together.
 * - Right click, Shift+F10 or the Menu key open the frame's menu, the same
 *   items as its table row (`menu`).
 * - The grid reports how many columns fit (`onColumns`), so ↑/↓ can step by
 *   a row.
 * - Windowing: only the tiles in and near view mount (`@tanstack/react-virtual`,
 *   lib/virtual.ts): the strip by tile, the grid by row. The current frame
 *   (else the first, the Tab stop) stays mounted wherever the view is, so it
 *   scrolls into view and takes focus; each tile carries its place in the
 *   list (`aria-posinset` of `aria-setsize`).
 */
import { useVirtualizer } from "@tanstack/react-virtual"
import { ImageOff, Loader } from "lucide-react"
import { type CSSProperties, type MouseEvent, type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useRef } from "react"
import { useMessages } from "@/app/preferences"
import type { ActionRunner } from "@/components/app/actions"
import type { MenuItem } from "@/components/app/contracts"
import { RowContextMenu } from "@/components/app/row-actions"
import { useSize } from "@/lib/use-size"
import { cn } from "@/lib/utils"
import { initialRect, keepMounted, measureOrEstimate, observeRect, spacing } from "@/lib/virtual"

export type ThumbnailActivation = "set" | "toggle" | "range"

/** A frame's thumbnail: pending while it decodes, an image URL, or why it has no pixels ("Offline"). */
export type Thumbnail = { state: "pending" } | { state: "ready"; url: string } | { state: "unreadable"; reason: string }

/** The thumbnail side, in CSS pixels at 1×: hosts decode to it. */
export const THUMB_W = 160

export interface FrameThumbnail {
  /** The frame's id; the host's selection and current frame name frames by it. */
  id: string
  /** The display name; the frame number at its end stays visible when it is cut. */
  name: string
  thumb: Thumbnail
  /** The quality badge under the name. */
  status: ReactNode
  /** The quality in words, for the frame's accessible name. */
  statusText: string
  /** Rejected frames read dimmed. */
  dimmed: boolean
}

export interface FrameThumbnailsProps {
  layout: "strip" | "grid"
  /** Names the list: "Filmstrip", "Frame grid". */
  label: string
  items: readonly FrameThumbnail[]
  activeId: string | null
  selected: ReadonlySet<string>
  onActivate: (id: string, mode: ThumbnailActivation) => void
  /** Shown instead of the list when it has no frames. */
  empty: ReactNode
  /** The frame's context menu: the same items as its table row. */
  menu?: { items: (id: string) => MenuItem[]; runner: ActionRunner }
  /** The grid's column count, reported when it changes. */
  onColumns?: (columns: number) => void
}

const GRID_MIN = 152
const GRID_GAP = 4
/** A strip tile's width (`w-32`), and the room around the tiles (`p-1`). */
const STRIP_W = 128
const PAD = 4
/** Under a grid tile's 3:2 image: its padding, the name line and the badge line. */
const TILE_TEXT_H = 48

function modeOf(event: MouseEvent): ThumbnailActivation {
  return event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "set"
}

/** Focus follows the current frame while it is in the list; the current frame scrolls into view. */
function useFollowFocus(activeId: string | null) {
  const box = useRef<HTMLUListElement>(null)
  const owns = useRef(false)
  useEffect(() => {
    const onFocusIn = (event: FocusEvent) => {
      owns.current = box.current?.contains(event.target as Node) ?? false
    }
    document.addEventListener("focusin", onFocusIn)
    return () => document.removeEventListener("focusin", onFocusIn)
  }, [])
  useLayoutEffect(() => {
    if (!activeId) return
    const el = box.current?.querySelector<HTMLElement>(`[data-frame-id="${CSS.escape(activeId)}"]`)
    el?.scrollIntoView({ block: "nearest", inline: "nearest" })
    const focus = document.activeElement
    const inside = (focus !== null && box.current?.contains(focus)) || (owns.current && (focus === null || focus === document.body))
    if (inside && el && el !== focus) el.focus({ preventScroll: true })
  }, [activeId])
  return box
}

/** The frame's pixels, else what stands in for them: Pending while it decodes, the reason it has none ("Offline", "No pixel data"). */
function Thumb({ thumb }: { thumb: Thumbnail }) {
  const m = useMessages()
  if (thumb.state === "ready") return <img src={thumb.url} alt="" className="block size-full rounded-sm bg-plate object-contain" draggable={false} />
  return (
    <span className="flex size-full flex-col items-center justify-center gap-1 rounded-sm bg-plate px-1 text-center text-xs text-white/70">
      {thumb.state === "pending" ? <Loader aria-hidden="true" className="size-3.5 animate-spin" /> : <ImageOff aria-hidden="true" className="size-3.5" />}
      <span>{thumb.state === "pending" ? m.status_pending() : thumb.reason}</span>
    </span>
  )
}

/** Where a tile sits: its place in the list, the room its unmounted predecessors take, and the virtualizer's measure for the one tile per strip slot or grid row it measures by. */
interface TilePlace {
  index: number
  style: CSSProperties
  measure?: { ref: (node: HTMLLIElement | null) => void; index: number }
}

function ThumbItem({ item, props, tabbable, place }: { item: FrameThumbnail; props: FrameThumbnailsProps; tabbable: boolean; place: TilePlace }) {
  const { thumb } = item
  const active = props.activeId === item.id
  const selected = props.selected.has(item.id)
  // The name says what the tile shows: the frame, its quality and, without pixels, why.
  const label = [item.name, item.statusText, thumb.state === "unreadable" ? thumb.reason : null].filter(Boolean).join(", ")
  const button = (
    <button
      type="button"
      data-frame-id={item.id}
      data-frame-item=""
      tabIndex={tabbable ? 0 : -1}
      aria-current={active ? "true" : undefined}
      aria-pressed={selected}
      aria-label={label}
      onClick={(event) => props.onActivate(item.id, modeOf(event))}
      className={cn(
        "block w-full rounded-md p-1 text-left outline-none hover:bg-foreground/5 focus-visible:ring-2 focus-visible:ring-ring",
        selected && "bg-primary/15 hover:bg-primary/20",
        active && "bg-accent ring-2 ring-primary ring-inset",
      )}
    >
      <span className={cn("relative block aspect-[3/2] w-full", item.dimmed && "opacity-45")}>
        <Thumb thumb={thumb} />
      </span>
      <span aria-hidden="true" className="mt-1 flex min-w-0 text-xs">
        {/* Middle truncation: the frame number at the end stays visible. */}
        <span className="truncate">{item.name.slice(0, -8)}</span>
        <span className="shrink-0">{item.name.slice(-8)}</span>
      </span>
      <span aria-hidden="true" className="block overflow-hidden whitespace-nowrap">
        {item.status}
      </span>
    </button>
  )
  return (
    <li
      ref={place.measure?.ref}
      data-index={place.measure?.index}
      aria-setsize={props.items.length}
      aria-posinset={place.index + 1}
      style={place.style}
      className={props.layout === "strip" ? "w-32 shrink-0" : "min-w-0"}
    >
      {props.menu ? (
        <RowContextMenu name={item.name} items={props.menu.items(item.id)} runner={props.menu.runner}>
          {button}
        </RowContextMenu>
      ) : (
        button
      )}
    </li>
  )
}

/** The filmstrip (`layout="strip"`) or the frame grid (`layout="grid"`). */
export function FrameThumbnails(props: FrameThumbnailsProps) {
  const { layout, items, empty, onColumns } = props
  const [sizeRef, size] = useSize<HTMLDivElement>()
  const columns = Math.max(1, Math.floor((size.width - 8 + GRID_GAP) / (GRID_MIN + GRID_GAP)))
  const reported = useRef(0)
  useLayoutEffect(() => {
    if (layout !== "grid" || reported.current === columns) return
    reported.current = columns
    onColumns?.(columns)
  }, [layout, columns, onColumns])
  return (
    <div ref={sizeRef} className={layout === "grid" ? "min-h-0 flex-1 overflow-y-auto bg-background" : "shrink-0 overflow-x-auto overflow-y-hidden bg-background"} data-frame-thumbnails={layout}>
      {items.length === 0 ? (
        <div className="p-3">{empty}</div>
      ) : (
        // One virtualizer per layout: the strip windows by tile, the grid by row.
        <ThumbList key={layout} props={props} scroller={sizeRef} columns={layout === "grid" ? columns : 1} width={size.width} />
      )}
    </div>
  )
}

/** The mounted tiles of the strip (by tile) or the grid (by row of `columns` tiles), in a list as long as all of them. */
function ThumbList({ props, scroller, columns, width }: { props: FrameThumbnailsProps; scroller: RefObject<HTMLDivElement | null>; columns: number; width: number }) {
  const { layout, label, items, activeId } = props
  const strip = layout === "strip"
  const tabIndex = Math.max(0, items.findIndex((item) => item.id === activeId))
  const tabbable = items[tabIndex]?.id ?? null
  // A grid row before it is measured: the tile's 3:2 image at the column width, and the text under it.
  const tileW = (Math.max(width, GRID_MIN) - 2 * PAD - (columns - 1) * GRID_GAP) / columns
  const rowEstimate = Math.round(((tileW - 2 * PAD) * 2) / 3) + TILE_TEXT_H
  const getItemKey = useCallback((index: number) => (strip ? (items[index]?.id ?? index) : `${columns}:${index}`), [strip, items, columns])
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLLIElement>({
    count: strip ? items.length : Math.ceil(items.length / columns),
    horizontal: strip,
    getScrollElement: () => scroller.current,
    initialOffset: () => (strip ? scroller.current?.scrollLeft : scroller.current?.scrollTop) ?? 0,
    estimateSize: () => (strip ? STRIP_W : rowEstimate),
    getItemKey,
    gap: GRID_GAP,
    paddingStart: PAD,
    paddingEnd: PAD,
    overscan: strip ? 6 : 2,
    initialRect: initialRect(),
    observeElementRect: observeRect,
    measureElement: measureOrEstimate,
    rangeExtractor: keepMounted([strip ? tabIndex : Math.floor(tabIndex / columns)]),
  })
  // After the virtualizer attaches to the scroller, so its first read keeps the scroll the current frame set.
  const box = useFollowFocus(activeId)
  const mounted = virtualizer.getVirtualItems()
  const total = virtualizer.getTotalSize()
  const { before } = spacing(mounted, 0, total, GRID_GAP)
  const tile = (index: number, place: Omit<TilePlace, "index">) => {
    const item = items[index]
    return item === undefined ? null : <ThumbItem key={item.id} item={item} props={props} tabbable={item.id === tabbable} place={{ index, ...place }} />
  }
  if (strip) {
    return (
      <ul ref={box} aria-label={label} className="flex gap-1 py-1" style={{ width: total }}>
        {mounted.map((slot, k) => tile(slot.index, { style: { marginLeft: before[k] }, measure: { ref: virtualizer.measureElement, index: slot.index } }))}
      </ul>
    )
  }
  return (
    <ul ref={box} aria-label={label} className="grid content-start gap-1 px-1" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, height: total }}>
      {mounted.flatMap((row, k) =>
        Array.from({ length: columns }, (_, column) =>
          tile(row.index * columns + column, { style: { marginTop: before[k] }, measure: column === 0 ? { ref: virtualizer.measureElement, index: row.index } : undefined }),
        ),
      )}
    </ul>
  )
}
