/**
 * Workspace (L3 template; plan §3.4, §5.3): a full-height work surface for
 * reviewing one list item by item, as the session intake Review step body.
 * It fills whatever container it is placed in (StepPage `fill`) and scrolls
 * only inside its panes.
 *
 * - Toolbar: one row of chrome, `start` items leading and `end` items
 *   trailing (filters, view controls, the Display menu).
 * - List: the item list (a DataTable with `scroll="fill"`, or thumbnails) at
 *   one of three heights: `strip` (as tall as its content), `rows` (a height
 *   the user sets) or `full` (the stage gives way). In `rows` a separator
 *   under the list resizes it: drag it, or focus it and use ↑/↓ (a row at a
 *   time), Page Up/Page Down (five rows), Home and End. A click without a
 *   drag steps through the preset heights, so a single pointer can resize it
 *   too (WCAG 2.5.7).
 * - Stage: one or more panes side by side (a plate, Compare's two), each a
 *   caption row over its content; `strip` sits under them (plots).
 * - Aside: the inspector. From 1000 px of workspace width it docks beside
 *   the stage; below, it opens over the stage as a dialog that holds focus
 *   and closes on Escape, handing focus back to where it came from. The host
 *   gets the mode, so it can keep separate open states for the two.
 * - Status: one line of items at the bottom (counts, progress, notes).
 * - Fullscreen: the stage alone over the whole window, under a bar of its
 *   own; Escape leaves it.
 */
import { X } from "lucide-react"
import { type CSSProperties, type KeyboardEvent, type PointerEvent, type ReactNode, type RefObject, useEffect, useLayoutEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { IconButton } from "@/components/app/actions"
import { useSize } from "@/lib/use-size"
import { cn } from "@/lib/utils"

export type WorkspaceListHeight = "strip" | "rows" | "full"

/** One stage pane: a caption row (the item's name, its position, a readout) over its content (a plate). */
export interface WorkspacePane {
  id: string
  caption: ReactNode
  content: ReactNode
}

/** The inspector: a complementary region named by `label`, with a title row and a body that scrolls. */
export interface WorkspaceAside {
  label: string
  /** The item's name; it truncates, and shows in full on hover while it is cut (§6.2 T2). */
  title: string
  /** Controls in the title row, before Close. */
  actions?: ReactNode
  onClose: () => void
  /** Close's accessible name: "Close the inspector (I)". */
  closeLabel: string
  children: ReactNode
}

export interface WorkspaceProps {
  /** Names the workspace region: "Frame review". */
  label: string
  toolbar: { start?: ReactNode; end?: ReactNode }
  list: ReactNode
  listHeight: WorkspaceListHeight
  /** The list's height in `rows`, in px. */
  rowsPx: number
  /** A new `rows` height, from the separator. */
  onRowsPx: (px: number) => void
  /** Hidden while `listHeight` is "full". */
  stage: readonly WorkspacePane[]
  /** Shown in the stage when it has no pane. */
  stageEmpty?: ReactNode
  /** Under the stage panes: plots or a filmstrip. */
  strip?: ReactNode
  /** The inspector for the current mode, or null while it is closed. `overlay` is true under 1000 px of workspace width. */
  aside?: (overlay: boolean) => WorkspaceAside | null
  /** Forces the aside's mode; by default the workspace width decides. */
  asideOverlay?: boolean
  status: readonly ReactNode[]
  /** Names the status line: "Review status". */
  statusLabel: string
  /** The stage alone over the window, under `bar`; null when not fullscreen. */
  fullscreen?: { label: string; bar: ReactNode; onExit: () => void } | null
}

/** From this workspace width the aside docks beside the stage. */
export const WORKSPACE_ASIDE_DOCK_PX = 1000
/** The stage keeps at least this much height in `rows`: its caption, a plate and the strip. */
export const WORKSPACE_STAGE_MIN_PX = 416
/** The row counts a click on the separator steps through. */
export const WORKSPACE_ROW_PRESETS = [5, 8, 12, 20] as const
/** The fewest rows `rows` shows. */
const MIN_ROWS = 3
/** Pointer travel (px) below which a press on the separator counts as a click. */
const CLICK_SLOP = 4
const FALLBACK_ROW_PX = 26

const FOCUSABLE = "a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])"

/** The table row height token in px; the list resizes a row at a time. */
function tableRowPx(element: HTMLElement | null): number {
  if (!element) return FALLBACK_ROW_PX
  const raw = getComputedStyle(element).getPropertyValue("--table-row-h").trim()
  const rem = raw.endsWith("rem") ? Number.parseFloat(raw) : Number.NaN
  if (Number.isNaN(rem)) return FALLBACK_ROW_PX
  return rem * Number.parseFloat(getComputedStyle(document.documentElement).fontSize || "16")
}

/** The list's px for `rows` shown plus its header row. */
const pxOfRows = (rows: number, rowPx: number) => Math.round((rows + 1) * rowPx)
const rowsOfPx = (px: number, rowPx: number) => Math.max(0, Math.round(px / rowPx) - 1)

/**
 * Holds Tab inside `ref` while `active`, focuses its first control on open, runs `onEscape` on Escape, and hands
 * focus back to the element that had it before. Menus and dialogs opened inside keep their own Escape.
 */
function useHeldFocus(ref: RefObject<HTMLElement | null>, active: boolean, onEscape: () => void) {
  const escape = useRef(onEscape)
  escape.current = onEscape
  useEffect(() => {
    const box = ref.current
    if (!active || !box) return
    const before = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const first = box.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? box).focus({ preventScroll: true })
    function onKeyDown(event: globalThis.KeyboardEvent) {
      if (!box) return
      if (event.key === "Escape") {
        if (event.defaultPrevented) return
        event.preventDefault()
        event.stopPropagation()
        escape.current()
        return
      }
      if (event.key !== "Tab") return
      const items = Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE)).filter((el) => el.getClientRects().length > 0 || el === document.activeElement)
      const list = items.length > 0 ? items : Array.from(box.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (list.length === 0) {
        event.preventDefault()
        return
      }
      const firstItem = list[0]!
      const lastItem = list.at(-1)!
      if (event.shiftKey && (document.activeElement === firstItem || !box.contains(document.activeElement))) {
        event.preventDefault()
        lastItem.focus()
      } else if (!event.shiftKey && (document.activeElement === lastItem || !box.contains(document.activeElement))) {
        event.preventDefault()
        firstItem.focus()
      }
    }
    box.addEventListener("keydown", onKeyDown)
    return () => {
      box.removeEventListener("keydown", onKeyDown)
      if (before?.isConnected) before.focus({ preventScroll: true })
    }
  }, [ref, active])
}

/** The separator under the list in `rows`. */
function RowsHandle({ px, minPx, maxPx, rowPx, onPx }: { px: number; minPx: number; maxPx: number; rowPx: number; onPx: (px: number) => void }) {
  const m = useMessages()
  const press = useRef<{ y: number; px: number; moved: boolean } | null>(null)
  const clamp = (value: number) => Math.round(Math.min(maxPx, Math.max(minPx, value)))
  const rows = rowsOfPx(px, rowPx)

  function nextPreset(): number {
    const fits = WORKSPACE_ROW_PRESETS.map((n) => pxOfRows(n, rowPx)).filter((value) => value <= maxPx)
    const presets = fits.length > 0 ? fits : [minPx]
    return presets.find((value) => value > px + rowPx / 2) ?? presets[0]!
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const steps: Record<string, number> = { ArrowDown: px + rowPx, ArrowUp: px - rowPx, PageDown: px + rowPx * 5, PageUp: px - rowPx * 5, Home: minPx, End: maxPx }
    const next = steps[event.key]
    if (next === undefined) return
    event.preventDefault()
    event.stopPropagation()
    onPx(clamp(next))
  }

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label={m.workspace_list_height()}
      aria-valuenow={rows}
      aria-valuemin={rowsOfPx(minPx, rowPx)}
      aria-valuemax={rowsOfPx(maxPx, rowPx)}
      aria-valuetext={m.workspace_list_rows({ count: rows })}
      tabIndex={0}
      data-workspace-handle=""
      className="group relative z-sticky h-2 shrink-0 cursor-row-resize touch-none outline-none before:absolute before:inset-x-0 before:-inset-y-2 before:content-['']"
      onPointerDown={(event) => {
        press.current = { y: event.clientY, px, moved: false }
        event.currentTarget.setPointerCapture?.(event.pointerId)
      }}
      onPointerMove={(event) => {
        const start = press.current
        if (!start) return
        if (Math.abs(event.clientY - start.y) > CLICK_SLOP) start.moved = true
        if (start.moved) onPx(clamp(start.px + event.clientY - start.y))
      }}
      onPointerUp={() => {
        const start = press.current
        press.current = null
        if (start && !start.moved) onPx(clamp(nextPreset()))
      }}
      onPointerCancel={() => {
        press.current = null
      }}
      onKeyDown={onKeyDown}
    >
      <span aria-hidden="true" className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-separator group-hover:bg-primary group-focus-visible:h-0.5 group-focus-visible:bg-ring" />
      <span aria-hidden="true" className="absolute top-1/2 left-1/2 h-1 w-8 -translate-x-1/2 -translate-y-1/2 rounded-full bg-muted-foreground/40 group-hover:bg-primary" />
    </div>
  )
}

function Stage({ panes, empty, strip }: { panes: readonly WorkspacePane[]; empty?: ReactNode; strip?: ReactNode }) {
  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col" data-workspace-stage="">
      <div className="flex min-h-0 flex-1 gap-2 p-2">
        {panes.length === 0 ? (
          <div className="flex min-h-0 flex-1 items-center justify-center">{empty}</div>
        ) : (
          panes.map((pane) => (
            <div key={pane.id} className="flex min-h-0 min-w-0 flex-1 flex-col gap-1" data-workspace-pane={pane.id}>
              {/* Wraps instead of scrolling sideways on a narrow window (WCAG 1.4.10). */}
              <div className="flex min-h-6 min-w-0 flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs">{pane.caption}</div>
              <div className="flex min-h-0 min-w-0 flex-1">{pane.content}</div>
            </div>
          ))
        )}
      </div>
      {strip ? <div className="h-28 shrink-0 border-t border-separator px-2 py-1.5">{strip}</div> : null}
    </div>
  )
}

/** T2 (plan §6.2): a cut-off title shows its full text on hover, and only while it is cut. */
function titleWhenCut(event: PointerEvent<HTMLElement>) {
  const element = event.currentTarget
  if (element.scrollWidth > element.clientWidth) element.title = element.textContent ?? ""
  else element.removeAttribute("title")
}

function AsideHeader({ aside }: { aside: WorkspaceAside }) {
  return (
    <div className="flex min-w-0 shrink-0 items-center gap-2 border-b border-separator px-3 py-1.5">
      <h2 className="min-w-0 flex-1 truncate text-sm font-semibold" onPointerEnter={titleWhenCut}>
        {aside.title}
      </h2>
      {aside.actions}
      <IconButton label={aside.closeLabel} icon={X} onClick={aside.onClose} />
    </div>
  )
}

function OverlayAside({ aside }: { aside: WorkspaceAside }) {
  const ref = useRef<HTMLDivElement>(null)
  useHeldFocus(ref, true, aside.onClose)
  return (
    <div
      ref={ref}
      role="dialog"
      aria-label={aside.label}
      tabIndex={-1}
      data-workspace-aside="overlay"
      className="absolute inset-y-0 right-0 z-flyout flex w-76 max-w-full min-h-0 flex-col border-l border-separator bg-background shadow-elevation-2 outline-none"
    >
      <AsideHeader aside={aside} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2">{aside.children}</div>
    </div>
  )
}

function Fullscreen({ fullscreen, panes, empty }: { fullscreen: NonNullable<WorkspaceProps["fullscreen"]>; panes: readonly WorkspacePane[]; empty?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useHeldFocus(ref, true, fullscreen.onExit)
  return (
    <div ref={ref} role="dialog" aria-modal="true" aria-label={fullscreen.label} tabIndex={-1} data-workspace-fullscreen="" className="fixed inset-0 z-overlay flex min-h-0 flex-col bg-background outline-none">
      <div data-chrome className="flex min-h-(--toolbar-h) shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-separator bg-chrome px-3 py-1 text-xs">
        {fullscreen.bar}
      </div>
      <Stage panes={panes} empty={empty} />
    </div>
  )
}

export function Workspace({ label, toolbar, list, listHeight, rowsPx, onRowsPx, stage, stageEmpty, strip, aside, asideOverlay, status, statusLabel, fullscreen = null }: WorkspaceProps) {
  const [rootRef, rootSize] = useSize<HTMLDivElement>()
  const [bodyRef, bodySize] = useSize<HTMLDivElement>()
  const [rowPx, setRowPx] = useState(FALLBACK_ROW_PX)
  useLayoutEffect(() => setRowPx(tableRowPx(rootRef.current)), [rootRef])
  const overlay = asideOverlay ?? (rootSize.width > 0 && rootSize.width < WORKSPACE_ASIDE_DOCK_PX)
  const shownAside = aside?.(overlay) ?? null
  const minPx = pxOfRows(MIN_ROWS, rowPx)
  // Until the body is measured (first paint, tests) the list may take up to 40 rows.
  const maxPx = Math.max(minPx, bodySize.height > 0 ? bodySize.height - WORKSPACE_STAGE_MIN_PX : pxOfRows(40, rowPx))
  const listPx = Math.round(Math.min(maxPx, Math.max(minPx, rowsPx)))
  const showStage = listHeight !== "full"
  return (
    <section ref={rootRef} aria-label={label} data-template="workspace" className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div data-chrome data-workspace-toolbar="" className="flex min-h-(--toolbar-h) shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-separator bg-chrome px-3 py-1">
        <div className="flex min-w-0 flex-wrap items-center gap-2">{toolbar.start}</div>
        <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">{toolbar.end}</div>
      </div>
      <div ref={bodyRef} className="relative flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div
            data-workspace-list={listHeight}
            style={listHeight === "rows" ? ({ "--workspace-list-h": `${listPx}px` } as CSSProperties) : undefined}
            className={cn("flex min-w-0 flex-col", listHeight === "full" ? "min-h-0 flex-1" : listHeight === "rows" ? "h-(--workspace-list-h) shrink-0" : "shrink-0", showStage && listHeight !== "rows" && "border-b border-separator")}
          >
            {list}
          </div>
          {listHeight === "rows" ? <RowsHandle px={listPx} minPx={minPx} maxPx={maxPx} rowPx={rowPx} onPx={onRowsPx} /> : null}
          {showStage && !fullscreen ? <Stage panes={stage} empty={stageEmpty} strip={strip} /> : null}
        </div>
        {shownAside && !overlay ? (
          <aside aria-label={shownAside.label} data-workspace-aside="side" className="flex min-h-0 w-76 shrink-0 flex-col border-l border-separator bg-background">
            <AsideHeader aside={shownAside} />
            <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-2">{shownAside.children}</div>
          </aside>
        ) : null}
        {shownAside && overlay ? <OverlayAside aside={shownAside} /> : null}
      </div>
      <footer aria-label={statusLabel} data-chrome data-workspace-status="" className="flex min-h-7 shrink-0 flex-wrap items-center gap-x-3 gap-y-0.5 border-t border-separator px-3 py-0.5 text-xs text-muted-foreground tabular-nums">
        {status.map((item, index) =>
          item === null || item === undefined || item === false ? null : (
            // Items are the host's, in a fixed order: the slot index is their identity.
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed slots
            <span key={index} className="flex min-w-0 items-center gap-1.5">
              {item}
            </span>
          ),
        )}
      </footer>
      {fullscreen ? <Fullscreen fullscreen={fullscreen} panes={stage} empty={stageEmpty} /> : null}
    </section>
  )
}
