/**
 * Studio primitives (harness v2, HARNESS-V2.md §Primitives). The pieces a pro
 * imaging app is built from: resizable splits, an inspector with collapsible
 * panel sections, a pane toolbar, a filmstrip, a plate on its mount (B), and a
 * value shown with its source (B). Tracks compose these instead of web cards.
 */
import { ChevronDown, ChevronRight } from "lucide-react"
import { type KeyboardEvent, type ReactNode, useCallback, useId, useRef, useState, useSyncExternalStore } from "react"
import { cn } from "@/lib/utils"

/* ---------------------------------------------------------------- persistence */

const listeners = new Set<() => void>()
function readStored<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(`platevault.ui.${key}`)
    return raw === null ? fallback : (JSON.parse(raw) as T)
  } catch {
    return fallback
  }
}
function writeStored(key: string, value: unknown) {
  try {
    localStorage.setItem(`platevault.ui.${key}`, JSON.stringify(value))
  } catch {
    // Preference applies for this session only.
  }
  for (const listener of listeners) listener()
}

/** A UI preference persisted per key (pane widths, open panels). */
export function useStoredState<T>(key: string, fallback: T): [T, (next: T) => void] {
  const value = useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => localStorage.getItem(`platevault.ui.${key}`),
  )
  const parsed = value === null ? fallback : readStored(key, fallback)
  const set = useCallback((next: T) => writeStored(key, next), [key])
  return [parsed, set]
}

/* ---------------------------------------------------------------- splits */

export interface SplitHandleProps {
  /** Accessible name, e.g. "Resize inspector". */
  label: string
  /** Current size in px of the pane the handle resizes. */
  value: number
  min: number
  max: number
  onChange: (next: number) => void
  /** +1 when dragging right grows the pane (pane on the left), −1 when the pane is on the right. */
  direction: 1 | -1
  /** id of the resized pane. */
  controls?: string
  /** Double-click and Enter restore this size. */
  reset: number
  className?: string
}

/**
 * Vertical splitter between two panes (WAI-ARIA window splitter): drag with
 * the pointer, or focus it and use ←/→ (Shift for 64 px), Home/End and Enter
 * to reset. The visible seam is 1 px; the hit area is 8 px.
 */
export function SplitHandle({ label, value, min, max, onChange, direction, controls, reset, className }: SplitHandleProps) {
  const start = useRef<{ x: number; value: number } | null>(null)
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 64 : 16
    const keys: Record<string, number> = {
      ArrowLeft: value - step * direction,
      ArrowRight: value + step * direction,
      Home: min,
      End: max,
      Enter: reset,
    }
    const next = keys[event.key]
    if (next === undefined) return
    event.preventDefault()
    onChange(Math.round(Math.min(max, Math.max(min, next))))
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable window splitter has no native element.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-inset-focus=""
      onKeyDown={onKeyDown}
      onDoubleClick={() => onChange(reset)}
      onPointerDown={(event) => {
        start.current = { x: event.clientX, value }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        if (!start.current) return
        onChange(Math.round(Math.min(max, Math.max(min, start.current.value + (event.clientX - start.current.x) * direction))))
      }}
      onPointerUp={() => {
        start.current = null
      }}
      className={cn(
        "chrome group/split relative z-10 -mx-1 w-2 shrink-0 cursor-col-resize touch-none outline-none max-md:hidden",
        "before:absolute before:inset-y-0 before:left-1/2 before:w-px before:-translate-x-1/2 before:bg-seam hover:before:w-0.5 hover:before:bg-primary/70 focus-visible:before:w-0.5 focus-visible:before:bg-primary",
        className,
      )}
    />
  )
}

/* ---------------------------------------------------------------- inspector */

export interface InspectorProps {
  /** Landmark name, e.g. "Session inspector". */
  label: string
  children: ReactNode
  /** Persist key for the width. */
  widthKey: string
  initialWidth?: number
  className?: string
}

/**
 * Right-hand inspector: a resizable column of collapsible panel sections
 * (Lightroom's right panel stack). It scrolls on its own; the window never does.
 */
export function Inspector({ label, children, widthKey, initialWidth = 288, className }: InspectorProps) {
  const id = useId()
  const [width, setWidth] = useStoredState<number>(`width.${widthKey}`, initialWidth)
  return (
    <>
      <SplitHandle label={`Resize ${label.toLowerCase()}`} value={width} min={240} max={480} reset={initialWidth} direction={-1} onChange={setWidth} controls={id} />
      <aside
        id={id}
        aria-label={label}
        style={{ width }}
        className={cn("flex min-h-0 shrink-0 flex-col overflow-y-auto bg-panel max-lg:w-64! max-md:w-full! max-md:border-t max-md:border-seam", className)}
      >
        {children}
      </aside>
    </>
  )
}

export interface PanelSectionProps {
  title: string
  /** Persist key; sections without one start open and do not remember. */
  id?: string
  defaultOpen?: boolean
  /** Small controls at the right of the header (stay outside the toggle). */
  actions?: ReactNode
  /** One-line summary shown in the header while collapsed or open. */
  summary?: ReactNode
  children: ReactNode
  className?: string
  /** Heading level for the section title; the inspector sits under the page h1/h2. */
  level?: 2 | 3
}

/** A collapsible panel in a stack: header strip with a disclosure triangle, body below. */
export function PanelSection({ title, id, defaultOpen = true, actions, summary, children, className, level = 2 }: PanelSectionProps) {
  const bodyId = useId()
  const [stored, setStored] = useStoredState<boolean>(`panel.${id ?? "anon"}`, defaultOpen)
  const [local, setLocal] = useState(defaultOpen)
  const open = id ? stored : local
  const setOpen = id ? setStored : setLocal
  const Heading = level === 2 ? "h2" : "h3"
  const Icon = open ? ChevronDown : ChevronRight
  return (
    <section className={cn("border-b border-seam", className)}>
      <div className="chrome flex min-h-[var(--pane-header-h)] items-center gap-1 bg-panel-header pr-2">
        <Heading className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={bodyId}
            onClick={() => setOpen(!open)}
            data-inset-focus=""
            className="flex min-h-[var(--pane-header-h)] w-full items-center gap-1.5 pl-2 text-left outline-none"
          >
            <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="panel-title truncate text-foreground/85">{title}</span>
            {summary ? <span className="ml-auto truncate pl-2 text-xs font-normal text-muted-foreground normal-case">{summary}</span> : null}
          </button>
        </Heading>
        {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
      </div>
      <div id={bodyId} hidden={!open} className="px-3 py-2.5">
        {children}
      </div>
    </section>
  )
}

/* ---------------------------------------------------------------- pane toolbar */

/** The strip under a pane header: filters, view switches, counts. Chrome, never scrolls away. */
export function PaneToolbar({ children, className, label }: { children: ReactNode; className?: string; label?: string }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: role=toolbar only when the strip holds controls named as a group.
    <div
      role={label ? "toolbar" : undefined}
      aria-label={label}
      className={cn("chrome flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-seam bg-panel px-3 py-1", className)}
    >
      {children}
    </div>
  )
}

/* ---------------------------------------------------------------- values with source (B) */

export interface ValueItem {
  label: ReactNode
  value: ReactNode
  /** Where the value came from: "FITS OBJECT", "Corrected 12 Sep", "Derived", "Not recorded". */
  source?: ReactNode
  mono?: boolean
}

/**
 * Label · value · source rows (B's footnoted provenance, inspector density).
 * The source sits right beside the value, in small muted type, so no value is
 * shown without saying where it came from.
 */
export function ValueList({ items, className, label }: { items: ValueItem[]; className?: string; label?: string }) {
  return (
    <dl aria-label={label} className={cn("grid grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs", className)}>
      {items.map((item, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are positional and static per render.
        <div key={index} className="contents">
          <dt className="chrome pt-px text-muted-foreground">{item.label}</dt>
          <dd className="min-w-0">
            <span className={cn("text-foreground", item.mono && "font-mono text-[0.6875rem]")}>{item.value}</span>
            {item.source ? <span className="ml-1.5 text-2xs whitespace-nowrap text-muted-foreground">{item.source}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** One stat: a small label over a tabular value. Status bar, pipeline and plate captions. */
export function Readout({ label, value, tone, className }: { label: ReactNode; value: ReactNode; tone?: "warning" | "danger" | "success"; className?: string }) {
  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <span className="chrome text-2xs text-muted-foreground">{label}</span>
      <span className={cn("num truncate text-sm text-foreground", tone === "warning" && "text-warning", tone === "danger" && "text-destructive", tone === "success" && "text-success")}>{value}</span>
    </div>
  )
}

/* ---------------------------------------------------------------- plates (B) */

export interface PlateProps {
  /** The image well's content: a canvas, an <img>, or a placeholder. */
  image: ReactNode
  /** Caption title line (e.g. "30 Sep · OIII · 300 s"). */
  title: ReactNode
  /** Secondary caption line. */
  subtitle?: ReactNode
  /** Right side of the caption (counts, a status tag). */
  meta?: ReactNode
  selected?: boolean
  /** Offline or unavailable: the print fades and the caption says why. */
  faded?: boolean
  /** Aspect ratio of the well, default 3:2. */
  ratio?: string
  className?: string
}

/**
 * A plate on its mount (B's "plates on mounts"), in studio dress: the image
 * sits in a dark well on a matte one step lighter than the canvas, with the
 * catalogue caption printed on the matte. Selection draws the accent edge.
 */
export function Plate({ image, title, subtitle, meta, selected, faded, ratio = "3 / 2", className }: PlateProps) {
  return (
    <div
      data-selected={selected ? "" : undefined}
      className={cn(
        "group/plate flex min-w-0 flex-col rounded-md bg-mount p-1.5 pb-1 shadow-[inset_0_0_0_1px_var(--mount-edge)] transition-colors",
        "hover:bg-[color-mix(in_oklch,var(--mount),var(--foreground)_5%)] data-selected:bg-selected data-selected:shadow-[inset_0_0_0_2px_var(--primary)]",
        className,
      )}
    >
      <div className={cn("relative overflow-hidden rounded-sm bg-canvas", faded && "opacity-45 grayscale")} style={{ aspectRatio: ratio }}>
        {image}
      </div>
      <div className="flex min-w-0 items-start gap-2 px-0.5 pt-1.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-medium text-foreground">{title}</div>
          {subtitle ? <div className="truncate text-2xs text-muted-foreground group-data-selected/plate:text-selected-foreground/85">{subtitle}</div> : null}
        </div>
        {meta ? <div className="num shrink-0 text-right text-2xs text-muted-foreground group-data-selected/plate:text-selected-foreground/85">{meta}</div> : null}
      </div>
    </div>
  )
}

/* ---------------------------------------------------------------- filmstrip */

/**
 * Bottom filmstrip: one tab stop, ←/→ move between frames (Home/End jump),
 * the strip scrolls the focused frame into view. Items carry
 * `data-filmstrip-item`; the caller owns selection and activation.
 */
export function Filmstrip({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const items = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[data-filmstrip-item]"))
    const index = items.indexOf(document.activeElement as HTMLElement)
    if (index < 0) return
    const next = { ArrowLeft: index - 1, ArrowRight: index + 1, Home: 0, End: items.length - 1 }[event.key]
    if (next === undefined) return
    event.preventDefault()
    const target = items[Math.min(items.length - 1, Math.max(0, next))]
    target?.focus()
    target?.scrollIntoView({ block: "nearest", inline: "nearest" })
  }
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: arrow keys move focus between the strip's own buttons.
    <div
      role="group"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn("chrome flex shrink-0 gap-1.5 overflow-x-auto border-t border-seam bg-canvas px-2 py-1.5", className)}
    >
      {children}
    </div>
  )
}
