/**
 * AppKit split-view divider (HARNESS V1): a 1 px hairline with a wider drag
 * zone, resizable by pointer and by keyboard (WCAG 2.1.1, 2.5.7 single-pointer
 * alternative: arrow keys step 8 px, Shift+arrow 32 px, Home/End jump to the
 * bounds, double-click or Enter restores the default width).
 */
import { type KeyboardEvent, type PointerEvent, useRef } from "react"
import { cn } from "@/lib/utils"

export interface SplitHandleProps {
  /** Accessible name, e.g. "Resize sidebar". */
  label: string
  value: number
  min: number
  max: number
  initial: number
  onChange: (width: number) => void
  /** Which side of the handle the resized pane sits on. */
  pane: "before" | "after"
  className?: string
}

export function SplitHandle({ label, value, min, max, initial, onChange, pane, className }: SplitHandleProps) {
  const drag = useRef<{ x: number; width: number } | null>(null)
  const sign = pane === "before" ? 1 : -1
  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { x: event.clientX, width: value }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    onChange(drag.current.width + sign * (event.clientX - drag.current.x))
  }
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const step = event.shiftKey ? 32 : 8
    const keys: Record<string, number> = { ArrowLeft: value - sign * step, ArrowRight: value + sign * step, Home: min, End: max, Enter: initial }
    const next = keys[event.key]
    if (next === undefined) return
    event.preventDefault()
    onChange(next)
  }
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={value}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      data-chrome=""
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={() => onChange(initial)}
      onKeyDown={onKeyDown}
      className={cn(
        "group/split relative z-10 -mx-[3px] w-[7px] shrink-0 cursor-col-resize touch-none outline-none",
        "before:absolute before:inset-y-0 before:left-[3px] before:w-px before:bg-border",
        "focus-visible:before:w-[3px] focus-visible:before:left-[2px] focus-visible:before:bg-ring",
        className,
      )}
    />
  )
}
