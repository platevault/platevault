/**
 * DetailDock and DetailPanel (L3; plan §3.4, spec 054). The detail of a
 * ListPage row or a DetailPage item opens in a panel docked beside the page
 * body, never in a side sheet (C-8).
 *
 * - DetailDock lays out the body and the panel. The panel docks to the side
 *   from 1400 px wide and to the bottom below, unless the user pinned it
 *   (dock.ts). The body keeps its place while the open item changes, and the
 *   panel keeps its size: switching rows moves nothing.
 * - DetailPanel is a complementary region named by its heading. One header
 *   row holds the title, a status, the Display menu with the dock choice
 *   (Automatic, Bottom, Right) and, on the side, the width presets (Narrow,
 *   Medium, Wide), and Close (Esc); the actions row under it holds
 *   standard actions and the object menu. Only its body scrolls (FR-009).
 *   The side panel's leading edge resizes it by pointer or arrow keys; the
 *   presets do it with one click (WCAG 2.5.7).
 * - Escape closes the panel from anywhere in the dock except a text field;
 *   menus and dialogs keep their own Escape. Focus that was in the panel
 *   returns to the open row (`aria-current`), so the list keeps its place.
 */
import { X } from "lucide-react"
import { type CSSProperties, type PointerEvent, type ReactNode, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionBar, IconButton } from "@/components/app/actions"
import type { Action } from "@/components/app/contracts"
import { type DisplayGroup, DisplayMenu } from "@/components/app/display-menu"
import { cn } from "@/lib/utils"
import { type AdaptiveDock, clampDockWidth, DOCK_MIN_WIDTH_PX, DOCK_WIDTH_PRESETS, type DockPin, presetDockWidth, useAdaptiveDock } from "./dock"
import { asStandard, type ObjectMenu } from "./parts"

/** The open detail of a page: what its DetailPanel shows. Null or absent while nothing is open. */
export interface PageDetail {
  /** The page's dock: its pin and width are kept under this id ("sessions", "calibration-masters"). */
  dockId: string
  /** The open item's name; it names the panel. */
  title: string
  /** A StatusBadge beside the title. */
  status?: ReactNode
  /** Standard actions on the open item; a primary one renders as standard (the page header holds the view's one primary). */
  actions?: Action[]
  /** The item's object menu: "Master ▾" with Replace…, Hide. */
  menu?: ObjectMenu
  /** The panel body: a KeyValueList, a BoxTable, previews. */
  content: ReactNode
  onClose: () => void
}

export interface DetailDockProps {
  detail?: PageDetail | null
  /** The page title's heading level; the panel title sits one below it. */
  level?: 1 | 2
  /** The page body beside the panel. It fills the room the panel leaves. */
  children: ReactNode
}

export function DetailDock({ detail, level = 1, children }: DetailDockProps) {
  const root = useRef<HTMLDivElement>(null)
  const main = useRef<HTMLDivElement>(null)
  const dock = useAdaptiveDock(detail ? detail.dockId : null)
  const side = detail != null && dock.placement === "side"
  // The room the dock lays out in: a side panel takes at most half of it.
  const [room, setRoom] = useState<number | null>(null)
  useLayoutEffect(() => {
    const element = root.current
    if (!element) return
    const update = () => setRoom(element.clientWidth)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])
  const maxWidth = Math.max(DOCK_MIN_WIDTH_PX, Math.floor((room ?? 0) / 2))

  function close() {
    if (!detail) return
    const element = root.current
    const inPanel = element?.querySelector("[data-detail-panel]")?.contains(document.activeElement) ?? false
    const row = element?.querySelector<HTMLElement>("tr[aria-current='true']")
    detail.onClose()
    // The panel goes away with the focus in it: the open row takes it, else the body.
    if (inPanel && !focusRow(row)) main.current?.focus()
  }

  // A native listener on the dock: Escape in a portalled menu or dialog never reaches it.
  useEffect(() => {
    const element = root.current
    if (!element || !detail) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable='true']")) return
      event.preventDefault()
      close()
    }
    element.addEventListener("keydown", onKeyDown)
    return () => element.removeEventListener("keydown", onKeyDown)
  })

  return (
    <div ref={root} data-detail-dock={detail ? dock.placement : undefined} className={cn("flex min-h-0 min-w-0 flex-1", side ? "flex-row" : "flex-col")}>
      <div ref={main} tabIndex={-1} className="flex min-h-0 min-w-0 flex-1 flex-col outline-none">
        {children}
      </div>
      {detail ? <DetailPanel detail={detail} dock={dock} maxWidth={maxWidth} level={level === 1 ? 2 : 3} onClose={close} /> : null}
    </div>
  )
}

/** Focuses the open row, or its first control when the row itself takes no focus. */
function focusRow(row: HTMLElement | null | undefined): boolean {
  if (!row) return false
  const target = row.hasAttribute("tabindex") ? row : row.querySelector<HTMLElement>("a[href], button:not([disabled])")
  target?.focus()
  return target != null
}

/** T2 (plan §6.2): a cut-off title shows its full text on hover, and only while it is cut. */
function titleWhenCut(event: PointerEvent<HTMLElement>) {
  const element = event.currentTarget
  if (element.scrollWidth > element.clientWidth) element.title = element.textContent ?? ""
  else element.removeAttribute("title")
}

export interface DetailPanelProps {
  detail: PageDetail
  dock: AdaptiveDock
  /** The widest the side panel may be: half the room beside it. */
  maxWidth: number
  /** The panel title's heading level: one below the page title. */
  level: 2 | 3
  onClose: () => void
}

/** The docked panel itself; DetailDock places it. */
export function DetailPanel({ detail, dock, maxWidth, level, onClose }: DetailPanelProps) {
  const m = useMessages()
  const headingId = useId()
  // The width while a drag is under way; it is kept when the drag ends.
  const [dragged, setDragged] = useState<number | null>(null)
  const side = dock.placement === "side"
  const width = clampDockWidth(dragged ?? dock.width, maxWidth)
  const Heading = `h${level}` as const
  const actions = asStandard(detail.actions)
  const hasActions = actions.length > 0 || (detail.menu?.items.length ?? 0) > 0
  const pinOptions: { value: DockPin; label: string }[] = [
    { value: "auto", label: m.dock_auto() },
    { value: "bottom", label: m.dock_bottom() },
    { value: "side", label: m.dock_right() },
  ]
  const presetLabels = { narrow: m.dock_width_narrow(), medium: m.dock_width_medium(), wide: m.dock_width_wide() }
  // The preset the current width matches, else none (a dragged width).
  const preset = DOCK_WIDTH_PRESETS.find((item) => presetDockWidth(item, maxWidth) === width) ?? ""
  const widthGroup: DisplayGroup = {
    kind: "radio",
    id: "dock-width",
    label: m.dock_width(),
    value: preset,
    options: DOCK_WIDTH_PRESETS.map((item) => ({ value: item, label: presetLabels[item] })),
    onChange: (value) => {
      const item = DOCK_WIDTH_PRESETS.find((option) => option === value)
      if (item) dock.setWidth(presetDockWidth(item, maxWidth))
    },
  }
  return (
    <aside
      aria-labelledby={headingId}
      data-detail-panel={dock.placement}
      style={side ? ({ "--dock-w": `${width}px` } as CSSProperties) : undefined}
      className={cn(
        "relative flex min-h-0 min-w-0 shrink-0 flex-col bg-background",
        side ? "w-(--dock-w) border-l border-separator" : "h-2/5 border-t border-separator",
      )}
    >
      {side ? (
        <ResizeHandle
          width={width}
          maxWidth={maxWidth}
          onDrag={setDragged}
          onCommit={(px) => {
            setDragged(null)
            dock.setWidth(px)
          }}
        />
      ) : null}
      <div data-chrome className="flex h-10 shrink-0 items-center gap-2 border-b border-separator px-3">
        <Heading id={headingId} className="min-w-0 flex-1 truncate text-sm font-semibold" onPointerEnter={titleWhenCut}>
          {detail.title}
        </Heading>
        {detail.status ? <span className="flex shrink-0 items-center">{detail.status}</span> : null}
        <DisplayMenu
          groups={[
            {
              kind: "radio",
              id: "dock",
              label: m.dock_placement(),
              value: dock.pin,
              options: pinOptions,
              onChange: (value) => dock.setPin(pinOptions.find((option) => option.value === value)?.value ?? "auto"),
            },
            ...(side ? [widthGroup] : []),
          ]}
        />
        <IconButton label={m.dock_close()} icon={X} shortcut={m.key_escape()} onClick={onClose} />
      </div>
      {hasActions ? (
        <div data-chrome className="flex shrink-0 justify-end border-b border-separator px-3 py-1.5">
          <ActionBar actions={actions} overflow={detail.menu?.items} menuLabel={detail.menu?.label} />
        </div>
      ) : null}
      <div data-detail-body="" className="min-h-0 flex-1 overflow-y-auto p-3">
        {detail.content}
      </div>
    </aside>
  )
}

/** One arrow-key step of the side panel's width. */
const WIDTH_STEP_PX = 16

/**
 * The side panel's leading edge. Drag it, or focus it and use ← (wider),
 * → (narrower), Home (narrowest) and End (widest).
 */
function ResizeHandle({ width, maxWidth, onDrag, onCommit }: { width: number; maxWidth: number; onDrag: (px: number) => void; onCommit: (px: number) => void }) {
  const m = useMessages()
  const start = useRef<{ x: number; width: number } | null>(null)
  const latest = useRef(width)
  latest.current = width
  const end = () => {
    if (start.current) onCommit(latest.current)
    start.current = null
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={m.dock_width()}
      aria-valuenow={width}
      aria-valuemin={DOCK_MIN_WIDTH_PX}
      aria-valuemax={maxWidth}
      tabIndex={0}
      data-dock-handle=""
      className="group absolute inset-y-0 -left-1.5 z-10 w-3 cursor-col-resize touch-none outline-none"
      onPointerDown={(event) => {
        start.current = { x: event.clientX, width }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (start.current) onDrag(clampDockWidth(start.current.width + start.current.x - event.clientX, maxWidth))
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onKeyDown={(event) => {
        const steps: Record<string, number> = { ArrowLeft: width + WIDTH_STEP_PX, ArrowRight: width - WIDTH_STEP_PX, Home: DOCK_MIN_WIDTH_PX, End: maxWidth }
        const next = steps[event.key]
        if (next === undefined) return
        event.preventDefault()
        onCommit(clampDockWidth(next, maxWidth))
      }}
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-1/2 w-0.5 -translate-x-1/2 group-hover:bg-primary group-focus-visible:bg-ring" />
    </div>
  )
}
