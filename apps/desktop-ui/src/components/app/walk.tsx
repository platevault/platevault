/**
 * CoachWalk (L2; plan §4b "Onboarding walk", spec 056 FR-001..005, C OB6):
 * a modal orientation walk. Each step dims the window except a cut-out
 * around its anchor and shows a card with the step's title, its words and
 * Back · Next · Skip. Only those three are active while the walk runs.
 *
 * - Modal: the scrim takes every pointer event, focus stays in the card
 *   (Tab and Shift+Tab cycle its buttons) and the card is an `aria-modal`
 *   dialog named by the step's title. Escape is Skip; ← and → step.
 * - Each step's title is read out as it appears (a polite live region), and
 *   focus lands on Next.
 * - Anchors are CSS selectors, tried in order; the first on screen wins. A
 *   step whose anchor does not appear within a few frames (a collapsed
 *   source list, a narrow window) is skipped in the direction of travel.
 * - The card sits in the half of the window away from the anchor, so it
 *   never covers it.
 * - At the end (Done, Skip, or no anchor left) focus returns to the element
 *   that had it when the walk started, else to `main`.
 */
import { type KeyboardEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export interface CoachStep {
  id: string
  title: string
  body: string
  /** CSS selectors, in order of preference; the first visible match is the cut-out. */
  anchors: string[]
  /** Runs when the step opens, before its anchor is looked for: the host goes to the anchor's route. */
  onEnter?: () => void
}

export type CoachWalkEnd = "done" | "skipped"

export interface CoachWalkProps {
  steps: CoachStep[]
  /** The walk ended: Done on the last step, Skip or Escape, or no step had an anchor. */
  onEnd: (how: CoachWalkEnd) => void
  /** Frames to wait for a step's anchor after it opens (a route change renders it a frame or two later). */
  waitFrames?: number
}

interface Box {
  x: number
  y: number
  width: number
  height: number
}

/** Space between the anchor and the cut-out's edge. */
const PAD = 4

function visible(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function findAnchor(step: CoachStep): HTMLElement | null {
  for (const selector of step.anchors) {
    const element = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(visible)
    if (element) return element
  }
  return null
}

function boxOf(element: HTMLElement): Box {
  const rect = element.getBoundingClientRect()
  return { x: rect.left - PAD, y: rect.top - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }
}
/**
 * The anchor box of the step at `index`, tracked as the window moves; null
 * while looking, "missing" once the wait is over. The step is read when the
 * index changes, so a host that rebuilds its steps each render (for the
 * words of the chosen language) does not restart the look.
 */
function useAnchorBox(steps: CoachStep[], index: number, waitFrames: number): Box | null | "missing" {
  // The box belongs to the step it was looked up for, so a step change never reads the last step's result.
  const [found, setFound] = useState<{ at: number; box: Box | null | "missing" }>({ at: index, box: null })
  const latest = useRef(steps)
  useLayoutEffect(() => {
    latest.current = steps
  })
  useLayoutEffect(() => {
    const step = latest.current[index]
    if (!step) return undefined
    let frame = 0
    let tries = 0
    let element: HTMLElement | null = null
    const measure = () => element && setFound({ at: index, box: boxOf(element) })
    const observer = new ResizeObserver(measure)
    step.onEnter?.()
    const look = () => {
      element = findAnchor(step)
      if (element) {
        measure()
        observer.observe(element)
        return
      }
      if (tries >= waitFrames) {
        setFound({ at: index, box: "missing" })
        return
      }
      tries += 1
      frame = requestAnimationFrame(look)
    }
    look()
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [index, waitFrames])
  return found.at === index ? found.box : null
}

export function CoachWalk({ steps, onEnd, waitFrames = 30 }: CoachWalkProps) {
  const m = useMessages()
  const uid = useId()
  const [index, setIndex] = useState(0)
  // Which way the walk moves, so a step without an anchor is passed over the same way.
  const direction = useRef<1 | -1>(1)
  const card = useRef<HTMLDivElement>(null)
  const nextButton = useRef<HTMLButtonElement>(null)
  const returnTo = useRef<Element | null>(null)
  const step = steps[index]
  const box = useAnchorBox(steps, index, waitFrames)
  const last = index === steps.length - 1

  useLayoutEffect(() => {
    returnTo.current = document.activeElement
  }, [])

  function end(how: CoachWalkEnd) {
    const target = returnTo.current instanceof HTMLElement && returnTo.current.isConnected && returnTo.current !== document.body ? returnTo.current : document.getElementById("main")
    onEnd(how)
    requestAnimationFrame(() => target?.focus())
  }

  function go(to: number) {
    direction.current = to < index ? -1 : 1
    if (to < 0) return
    if (to >= steps.length) end("done")
    else setIndex(to)
  }

  // A step whose anchor never appeared is passed over in the direction of travel. Past the last step the walk is done;
  // going back past a missing first step returns to the step the user came from.
  const passOver = useRef<(missing: number) => void>(() => undefined)
  useLayoutEffect(() => {
    passOver.current = (missing) => {
      const to = missing + direction.current
      if (to >= steps.length) end("done")
      else if (to < 0) {
        direction.current = 1
        if (missing + 1 < steps.length) setIndex(missing + 1)
        else end("done")
      } else setIndex(to)
    }
  })
  useEffect(() => {
    if (box === "missing") passOver.current(index)
  }, [box, index])

  useEffect(() => {
    if (box && box !== "missing") nextButton.current?.focus()
  }, [box])

  if (!step || box === "missing") return null
  const shown = box !== null
  // The card takes the half of the window the anchor is not in.
  const below = shown && box.y + box.height / 2 < window.innerHeight / 2

  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      end("skipped")
    } else if (event.key === "ArrowRight") go(index + 1)
    else if (event.key === "ArrowLeft") go(index - 1)
    else if (event.key === "Tab") {
      // The focus trap: Tab and Shift+Tab cycle the card's buttons.
      const stops = [...(card.current?.querySelectorAll<HTMLElement>("button:not([disabled])") ?? [])]
      const at = stops.indexOf(document.activeElement as HTMLElement)
      const nextStop = stops[(at + (event.shiftKey ? -1 : 1) + stops.length) % stops.length]
      event.preventDefault()
      nextStop?.focus()
    }
  }

  const titleId = `${uid}-title`
  const bodyId = `${uid}-body`
  return (
    <div className="fixed inset-0 z-overlay" data-coach-walk={step.id} onKeyDown={onKeyDown}>
      <svg aria-hidden="true" className="absolute inset-0 size-full" data-coach-scrim="">
        <defs>
          <mask id={`${uid}-mask`}>
            <rect width="100%" height="100%" fill="white" />
            {shown ? <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={6} fill="black" /> : null}
          </mask>
        </defs>
        <rect width="100%" height="100%" className="fill-black/50" mask={`url(#${uid}-mask)`} />
        {shown ? <rect x={box.x} y={box.y} width={box.width} height={box.height} rx={6} fill="none" strokeWidth={2} className="stroke-primary" data-coach-highlight="" /> : null}
      </svg>
      <p className="sr-only" aria-live="polite" data-coach-announcer="">
        {shown ? `${step.title}. ${m.walk_step({ step: index + 1, total: steps.length })}` : ""}
      </p>
      {shown ? (
        <div
          ref={card}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          aria-describedby={bodyId}
          className={cn("absolute left-1/2 flex w-80 max-w-dialog-sm -translate-x-1/2 flex-col gap-2 rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10", below ? "bottom-12" : "top-14")}
          data-coach-mark={step.id}
        >
          <div className="flex items-baseline justify-between gap-2">
            <h2 id={titleId} className="font-semibold">
              {step.title}
            </h2>
            <span className="text-xs text-muted-foreground">{m.walk_step({ step: index + 1, total: steps.length })}</span>
          </div>
          <p id={bodyId} className="text-muted-foreground">
            {step.body}
          </p>
          <div className="mt-1 flex items-center gap-1.5">
            <Button size="sm" variant="ghost" className="mr-auto" onClick={() => end("skipped")} data-coach-skip="">
              {m.walk_skip()}
            </Button>
            <Button size="sm" variant="outline" disabled={index === 0} onClick={() => go(index - 1)} data-coach-back="">
              {m.walk_back()}
            </Button>
            <Button ref={nextButton} size="sm" onClick={() => (last ? end("done") : go(index + 1))} data-coach-next="">
              {last ? m.walk_done() : m.walk_next()}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}
