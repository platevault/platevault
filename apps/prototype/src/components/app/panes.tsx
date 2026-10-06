/**
 * Pane primitives (Harness V3, design/HARNESS-V3.md §4): the splitter that
 * resizes the source list, the inspector and in-page splits, the inspector
 * slot pages fill, and `SplitView` for a resizable two-pane surface.
 *
 * The splitter is a focusable `separator` with its value (WAI-ARIA window
 * splitter): drag it, or use ←/→ (16 px, Shift 64 px), Home/End, and Enter
 * to collapse or restore when the pane can collapse.
 */
import { type KeyboardEvent, type PointerEvent, type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { cn } from "@/lib/utils"
import { clamp } from "@/app/ui-state"

export interface SplitterProps {
  /** Accessible name, e.g. "Resize sidebar". */
  label: string
  value: number
  min: number
  max: number
  onChange: (value: number) => void
  /** Which edge of the separator the sized pane sits on. "start": the pane is before it (sidebar); "end": after it (inspector). */
  pane: "start" | "end"
  /** Id of the pane it sizes (aria-controls). */
  controls?: string
  /** Enter collapses or restores the pane, when it can collapse. */
  onToggle?: () => void
  className?: string
}

export function Splitter({ label, value, min, max, onChange, pane, controls, onToggle, className }: SplitterProps) {
  const drag = useRef<{ x: number; start: number } | null>(null)
  const sign = pane === "start" ? 1 : -1
  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (event.button !== 0) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, start: value }
  }
  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (!drag.current) return
    onChange(clamp(drag.current.start + sign * (event.clientX - drag.current.x), min, max))
  }
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.shiftKey ? 64 : 16
    const keys: Record<string, number> = { ArrowLeft: value - sign * step, ArrowRight: value + sign * step, Home: min, End: max }
    const target = keys[event.key]
    if (target !== undefined) {
      event.preventDefault()
      onChange(clamp(target, min, max))
    } else if (event.key === "Enter" && onToggle) {
      event.preventDefault()
      onToggle()
    }
  }
  return (
    // biome-ignore lint/a11y/useSemanticElements: a focusable window splitter is a separator with a value (WAI-ARIA APG); <hr> cannot take focus or a value.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-controls={controls}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-chrome
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => {
        drag.current = null
      }}
      onLostPointerCapture={() => {
        drag.current = null
      }}
      onKeyDown={onKeyDown}
      onDoubleClick={onToggle}
      className={cn(
        // A 1 px hairline with a 7 px grab area; the resize cursor is the affordance (macOS).
        "group/splitter relative z-10 w-px shrink-0 cursor-col-resize bg-border outline-none",
        "before:absolute before:inset-y-0 before:-left-[3px] before:w-[7px] before:content-['']",
        "hover:bg-primary/60 focus-visible:bg-primary focus-visible:outline-none data-[dragging]:bg-primary",
        className,
      )}
    />
  )
}

// ---------------------------------------------------------------------------
// Inspector slot
// ---------------------------------------------------------------------------

let host: HTMLElement | null = null
let mounted = 0
const inspectorListeners = new Set<() => void>()
function emit() {
  for (const listener of inspectorListeners) listener()
}
function subscribe(listener: () => void) {
  inspectorListeners.add(listener)
  return () => {
    inspectorListeners.delete(listener)
  }
}

/** The shell's inspector pane registers its body here. */
export function registerInspectorHost(element: HTMLElement | null) {
  host = element
  emit()
}

/** True while a page has put something in the inspector. */
export function useInspectorHasContent(): boolean {
  return useSyncExternalStore(subscribe, () => mounted > 0)
}

/**
 * Inspector content for the current page: what the cursor points at. It
 * renders in the shell's inspector pane (or nothing while that pane is
 * hidden), never inside the page, so the page layout never depends on it.
 */
export function Inspector({ title, children }: { title: string; children: ReactNode }) {
  const target = useSyncExternalStore(subscribe, () => host)
  useEffect(() => {
    mounted += 1
    emit()
    return () => {
      mounted -= 1
      emit()
    }
  }, [])
  if (!target) return null
  return createPortal(
    <section aria-label={`Inspector: ${title}`} className="flex min-h-0 flex-1 flex-col">
      <h2 className="sr-only">Inspector: {title}</h2>
      {children}
    </section>,
    target,
  )
}

/** A titled group inside the inspector: small caps label, then rows. */
export function InspectorSection({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cn("border-b px-3 py-2.5 last:border-b-0", className)}>
      <h3 className="pb-1.5 text-xs font-semibold text-muted-foreground" data-chrome>
        {title}
      </h3>
      {children}
    </div>
  )
}

/**
 * Label–value rows (B's "value with its source"): the value, and beside it
 * where it came from (FITS header, measured, user-confirmed…).
 */
export function PropertyList({ rows, className }: { rows: Array<{ label: string; value: ReactNode; source?: ReactNode }>; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[minmax(5.5rem,auto)_minmax(0,1fr)] gap-x-3 gap-y-1 text-sm", className)}>
      {rows.map((row) => (
        <div key={row.label} className="contents">
          <dt className="text-muted-foreground">{row.label}</dt>
          <dd className="min-w-0">
            <span className="tabular-nums">{row.value}</span>
            {row.source ? <span className="ml-1.5 inline-block text-xs text-muted-foreground">{row.source}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  )
}

// ---------------------------------------------------------------------------
// SplitView: two resizable panes inside a page
// ---------------------------------------------------------------------------

function readSize(key: string, fallback: number): number {
  try {
    const saved = Number(localStorage.getItem(`platevault.v3.split.${key}`))
    return Number.isFinite(saved) && saved > 0 ? saved : fallback
  } catch {
    return fallback
  }
}

export interface SplitViewProps {
  /** Persists the size per surface, e.g. "targets". */
  storageKey: string
  start: ReactNode
  end: ReactNode
  /** Accessible names of the two panes. */
  startLabel: string
  endLabel: string
  /** Which pane has the fixed, resizable size; the other takes the rest. */
  sized?: "start" | "end"
  defaultSize: number
  min: number
  max: number
  /** Below this container width the panes stack and scroll together (reflow). */
  stackBelow?: number
  className?: string
}

export function SplitView({ storageKey, start, end, startLabel, endLabel, sized = "start", defaultSize, min, max, stackBelow = 720, className }: SplitViewProps) {
  const [size, setSize] = useState(() => clamp(readSize(storageKey, defaultSize), min, max))
  const frame = useRef<HTMLDivElement>(null)
  const [stacked, setStacked] = useState(false)
  useEffect(() => {
    const element = frame.current
    if (!element) return
    const observer = new ResizeObserver(([entry]) => entry && setStacked(entry.contentRect.width < stackBelow))
    observer.observe(element)
    return () => observer.disconnect()
  }, [stackBelow])
  function change(next: number) {
    setSize(next)
    try {
      localStorage.setItem(`platevault.v3.split.${storageKey}`, String(next))
    } catch {
      // Size applies for this session only.
    }
  }
  const sizedId = `split-${storageKey}-${sized}`
  const paneClass = "min-h-0 min-w-0 overflow-auto"
  if (stacked) {
    return (
      <div ref={frame} className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto", className)}>
        <section aria-label={startLabel} className="border-b">
          {start}
        </section>
        <section aria-label={endLabel}>{end}</section>
      </div>
    )
  }
  return (
    <div
      ref={frame}
      className={cn("grid min-h-0 flex-1", className)}
      style={{ gridTemplateColumns: sized === "start" ? `${size}px 1px minmax(0,1fr)` : `minmax(0,1fr) 1px ${size}px` }}
    >
      <section id={sized === "start" ? sizedId : undefined} aria-label={startLabel} className={paneClass}>
        {start}
      </section>
      <Splitter label={`Resize ${sized === "start" ? startLabel : endLabel}`} value={size} min={min} max={max} onChange={change} pane={sized} controls={sizedId} />
      <section id={sized === "end" ? sizedId : undefined} aria-label={endLabel} className={paneClass}>
        {end}
      </section>
    </div>
  )
}
