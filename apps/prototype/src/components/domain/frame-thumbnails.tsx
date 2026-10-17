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
 */
import { ImageOff, Loader } from "lucide-react"
import { type MouseEvent, type ReactNode, useEffect, useLayoutEffect, useRef } from "react"
import { useMessages } from "@/app/preferences"
import type { ActionRunner } from "@/components/app/actions"
import type { MenuItem } from "@/components/app/contracts"
import { RowContextMenu } from "@/components/app/row-actions"
import type { AssetId, DiskFile } from "@/domain/types"
import { useSize } from "@/lib/use-size"
import { cn } from "@/lib/utils"
import { type Thumb as Thumbnail, useThumbnail } from "./thumbnails"

export type ThumbnailActivation = "set" | "toggle" | "range"

export interface FrameThumbnail {
  id: AssetId
  /** The display name; the frame number at its end stays visible when it is cut. */
  name: string
  /** The decodable copy, or undefined when none can be read. */
  file: DiskFile | undefined
  /** Why no pixels can be shown ("Offline"); null when `file` decodes. */
  unreadable: string | null
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
  activeId: AssetId | null
  selected: ReadonlySet<AssetId>
  onActivate: (id: AssetId, mode: ThumbnailActivation) => void
  /** Shown instead of the list when it has no frames. */
  empty: ReactNode
  /** The frame's context menu: the same items as its table row. */
  menu?: { items: (id: AssetId) => MenuItem[]; runner: ActionRunner }
  /** The grid's column count, reported when it changes. */
  onColumns?: (columns: number) => void
}

const GRID_MIN = 152
const GRID_GAP = 4

function modeOf(event: MouseEvent): ThumbnailActivation {
  return event.shiftKey ? "range" : event.metaKey || event.ctrlKey ? "toggle" : "set"
}

/** Focus follows the current frame while it is in the list; the current frame scrolls into view. */
function useFollowFocus(activeId: AssetId | null) {
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

function ThumbItem({ item, props, tabbable }: { item: FrameThumbnail; props: FrameThumbnailsProps; tabbable: boolean }) {
  const thumb = useThumbnail(item.id, item.file, item.unreadable)
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
    <li className={props.layout === "strip" ? "w-32 shrink-0" : "min-w-0"}>
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
  const { layout, label, items, activeId, empty, onColumns } = props
  const box = useFollowFocus(activeId)
  const [sizeRef, size] = useSize<HTMLDivElement>()
  const columns = Math.max(1, Math.floor((size.width - 8 + GRID_GAP) / (GRID_MIN + GRID_GAP)))
  const reported = useRef(0)
  useLayoutEffect(() => {
    if (layout !== "grid" || reported.current === columns) return
    reported.current = columns
    onColumns?.(columns)
  }, [layout, columns, onColumns])
  const tabbable = items.some((item) => item.id === activeId) ? activeId : (items[0]?.id ?? null)
  return (
    <div ref={sizeRef} className={layout === "grid" ? "min-h-0 flex-1 overflow-y-auto bg-background" : "shrink-0 overflow-x-auto overflow-y-hidden bg-background"} data-frame-thumbnails={layout}>
      {items.length === 0 ? (
        <div className="p-3">{empty}</div>
      ) : (
        <ul ref={box} aria-label={label} className={layout === "grid" ? "grid gap-1 p-1" : "flex gap-1 p-1"} style={layout === "grid" ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
          {items.map((item) => (
            <ThumbItem key={item.id} item={item} props={props} tabbable={item.id === tabbable} />
          ))}
        </ul>
      )}
    </div>
  )
}
