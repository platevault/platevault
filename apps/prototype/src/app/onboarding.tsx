/**
 * Onboarding after setup (Round 6): an orientation walk and Home's Getting
 * started checklist.
 *
 * - The walk: five coach marks anchored to the source list, the toolbar's
 *   Issues, Home's Next, the status bar's counters and Targets, with Back,
 *   Next and Skip. Setup's end makes it due once
 *   (`settings.onboarding.walk`); finishing or skipping marks it done, and
 *   Settings › About restarts it. Each mark is a non-modal dialog that takes
 *   focus on its Next button; ←/→ step, Escape skips. A mark whose anchor is
 *   not on screen (a collapsed source list, a narrow window) sits in the
 *   middle of the window.
 * - The checklist: set up locations, first import, confirm Targets, first
 *   Project, first run, each ticked from the library's state, until all are
 *   done or the user dismisses it.
 */
import { Popover as PopoverPrimitive } from "@base-ui/react/popover"
import { Link, useNavigate, useRouterState } from "@tanstack/react-router"
import { Circle, CircleCheck, X } from "lucide-react"
import { type ReactNode, useEffect, useRef, useState } from "react"
import { Box } from "@/components/app/box"
import { Button } from "@/components/ui/button"
import { setOnboarding } from "@/features/t1/lib/writes"
import { cn } from "@/lib/utils"
import { nowIso, type PrototypeState, useStore } from "@/store/core"
import { useMessages } from "./preferences"
import { openSheet } from "./ui-state"

// ---------------------------------------------------------------------------
// Orientation walk
// ---------------------------------------------------------------------------

type Side = "top" | "bottom" | "left" | "right"

interface WalkStep {
  id: "sources" | "issues" | "next" | "status" | "targets"
  /** Anchors in order of preference; the first one on screen wins. */
  anchors: string[]
  side: Side
  /** The route the anchor lives on; the walk goes there first. */
  route?: string
}

const STEPS: WalkStep[] = [
  { id: "sources", anchors: ['[data-coach="sources"]'], side: "right" },
  { id: "issues", anchors: ["[data-issues]"], side: "bottom" },
  { id: "next", anchors: ["[data-next]", "#home-projects"], side: "bottom", route: "/" },
  { id: "status", anchors: ["[data-status-issues]"], side: "top" },
  { id: "targets", anchors: ['[data-coach="sources"] a[href$="/targets"]'], side: "right" },
]

/** Restart the walk (Settings › About); it shows on the next app screen. */
export function restartWalk() {
  setOnboarding({ walk: "due" })
}

function endWalk() {
  setOnboarding({ walk: "done" })
}

function visible(element: Element): boolean {
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

function findAnchor(step: WalkStep): HTMLElement | null {
  for (const selector of step.anchors) {
    const element = Array.from(document.querySelectorAll<HTMLElement>(selector)).find(visible)
    if (element) return element
  }
  return null
}

/** The step's anchor once it is on screen (a route change renders it a frame or two later), and its box as the window moves. */
function useAnchor(step: WalkStep): { element: HTMLElement | null; rect: DOMRect | null } {
  const [element, setElement] = useState<HTMLElement | null>(null)
  const [rect, setRect] = useState<DOMRect | null>(null)
  useEffect(() => {
    let frame = 0
    let tries = 0
    const look = () => {
      const found = findAnchor(step)
      if (found || tries > 30) {
        setElement(found)
        setRect(found?.getBoundingClientRect() ?? null)
        return
      }
      tries += 1
      frame = requestAnimationFrame(look)
    }
    setElement(null)
    look()
    return () => cancelAnimationFrame(frame)
  }, [step])
  useEffect(() => {
    if (!element) return
    const measure = () => setRect(element.getBoundingClientRect())
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    window.addEventListener("resize", measure)
    window.addEventListener("scroll", measure, true)
    return () => {
      observer.disconnect()
      window.removeEventListener("resize", measure)
      window.removeEventListener("scroll", measure, true)
    }
  }, [element])
  return { element, rect }
}

/** The middle of the window, for a mark whose anchor is not on screen. */
const CENTRE = { getBoundingClientRect: () => new DOMRect(window.innerWidth / 2, window.innerHeight / 3, 0, 0) }

/** Mounted in the app frame: the walk while it is due. */
export function OrientationWalk() {
  const due = useStore((s) => s.settings.onboarding.walk === "due")
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (due) setIndex(0)
  }, [due])
  if (!due) return null
  return <CoachMark key={index} index={index} onIndex={setIndex} />
}

function CoachMark({ index, onIndex }: { index: number; onIndex: (index: number) => void }) {
  const m = useMessages()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const step = STEPS[index]!
  const last = index === STEPS.length - 1
  const nextButton = useRef<HTMLButtonElement>(null)
  const { element, rect } = useAnchor(step)

  useEffect(() => {
    if (step.route && pathname !== step.route) void navigate({ to: step.route })
  }, [step, pathname, navigate])

  const copy: Record<WalkStep["id"], { title: string; body: string }> = {
    sources: { title: m.onboarding_walk_sources_title(), body: m.onboarding_walk_sources() },
    issues: { title: m.issues_title(), body: m.onboarding_walk_issues() },
    next: { title: m.home_column_next(), body: m.onboarding_walk_next() },
    status: { title: m.onboarding_walk_status_title(), body: m.onboarding_walk_status() },
    targets: { title: m.nav_targets(), body: m.onboarding_walk_targets() },
  }

  function finish() {
    endWalk()
    requestAnimationFrame(() => document.getElementById("main")?.focus())
  }
  const back = () => index > 0 && onIndex(index - 1)
  const next = () => (last ? finish() : onIndex(index + 1))

  return (
    <>
      {rect ? (
        <div
          aria-hidden="true"
          className="pointer-events-none fixed z-50 rounded-md ring-2 ring-primary ring-offset-2 ring-offset-background motion-safe:transition-all"
          style={{ top: rect.top - 2, left: rect.left - 2, width: rect.width + 4, height: rect.height + 4 }}
          data-coach-highlight
        />
      ) : null}
      <PopoverPrimitive.Root
        open
        modal={false}
        onOpenChange={(open, details) => {
          // Only Escape (Skip) ends the walk; a click elsewhere or a focus move keeps it.
          if (!open && details.reason === "escape-key") finish()
        }}
      >
        <PopoverPrimitive.Portal>
          <PopoverPrimitive.Positioner anchor={element ?? CENTRE} side={element ? step.side : "bottom"} sideOffset={10} collisionPadding={12} className="isolate z-50">
            <PopoverPrimitive.Popup
              initialFocus={nextButton}
              finalFocus={false}
              className="flex w-72 flex-col gap-2 rounded-lg bg-popover p-3 text-sm text-popover-foreground shadow-lg ring-1 ring-foreground/10 outline-hidden"
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") next()
                else if (event.key === "ArrowLeft") back()
              }}
              data-coach-mark={step.id}
            >
              <div className="flex items-baseline justify-between gap-2">
                <PopoverPrimitive.Title className="font-semibold">{copy[step.id].title}</PopoverPrimitive.Title>
                <span className="text-xs text-muted-foreground tabular-nums">{m.onboarding_walk_step({ step: index + 1, total: STEPS.length })}</span>
              </div>
              <PopoverPrimitive.Description className="text-muted-foreground">{copy[step.id].body}</PopoverPrimitive.Description>
              <div className="mt-1 flex items-center gap-1.5">
                <Button size="sm" variant="ghost" className="mr-auto" onClick={finish} data-coach-skip>
                  {m.onboarding_walk_skip()}
                </Button>
                <Button size="sm" variant="outline" disabled={index === 0} onClick={back} data-coach-back>
                  {m.history_back()}
                </Button>
                <Button ref={nextButton} size="sm" onClick={next} data-coach-next>
                  {last ? m.onboarding_walk_done() : m.run_step_next()}
                </Button>
              </div>
            </PopoverPrimitive.Popup>
          </PopoverPrimitive.Positioner>
        </PopoverPrimitive.Portal>
      </PopoverPrimitive.Root>
    </>
  )
}

// ---------------------------------------------------------------------------
// Getting started checklist (Home)
// ---------------------------------------------------------------------------

interface ChecklistItem {
  id: "locations" | "import" | "targets" | "project" | "run"
  done: boolean
}

/** Each step, ticked from what the library holds now. */
function checklist(s: PrototypeState): ChecklistItem[] {
  const { catalog, operations } = s
  return [
    { id: "locations", done: Object.values(catalog.locations).some((l) => !l.retiredAt) },
    { id: "import", done: Object.values(operations).some((op) => op.kind === "import" && (op.status === "succeeded" || op.status === "partial")) },
    { id: "targets", done: Object.values(catalog.sessions).some((x) => x.imageType === "light" && !x.supersededBy && x.target.status === "confirmed") },
    { id: "project", done: Object.keys(catalog.projects).length > 0 },
    { id: "run", done: Object.keys(catalog.runs).length > 0 },
  ]
}

/** Home's Getting started box, until every step is done or it is dismissed. */
export function GettingStarted() {
  const m = useMessages()
  const items = useStore(checklist)
  const dismissed = useStore((s) => Boolean(s.settings.onboarding.checklistDismissedAt))
  const firstProjectId = useStore((s) => Object.values(s.catalog.projects).find((p) => p.state === "open")?.id ?? null)
  const done = items.filter((i) => i.done).length
  if (dismissed || done === items.length) return null

  const row: Record<ChecklistItem["id"], { label: string; action: ReactNode }> = {
    locations: { label: m.setup_set_up_locations(), action: <Button size="xs" variant="outline" render={<Link to="/settings/locations" />}>{m.verb_open()}</Button> },
    import: { label: m.onboarding_check_import(), action: <Button size="xs" variant="outline" onClick={() => openSheet({ kind: "import" })}>{m.import_open()}</Button> },
    targets: { label: m.onboarding_check_targets(), action: <Button size="xs" variant="outline" render={<Link to="/sessions" search={{ filter: "needs-target" } as never} />}>{m.verb_review()}</Button> },
    project: { label: m.onboarding_check_project(), action: <Button size="xs" variant="outline" onClick={() => openSheet({ kind: "new-project" })}>{m.newproject_open()}</Button> },
    run: {
      label: m.onboarding_check_run(),
      action: (
        <Button size="xs" variant="outline" disabled={!firstProjectId} title={firstProjectId ? undefined : m.onboarding_check_project()} onClick={() => firstProjectId && openSheet({ kind: "start-run", projectId: firstProjectId })}>
          {m.startrun_open()}
        </Button>
      ),
    },
  }

  return (
    <Box
      id="home-getting-started"
      level={2}
      title={
        <span className="inline-flex items-center gap-2">
          {m.onboarding_getting_started()}
          <span className="font-normal tabular-nums">{m.onboarding_check_progress({ done, total: items.length })}</span>
        </span>
      }
      actions={
        <Button size="icon-xs" variant="ghost" aria-label={m.onboarding_dismiss_checklist()} title={m.onboarding_dismiss_checklist()} onClick={() => setOnboarding({ checklistDismissedAt: nowIso() })} data-dismiss-checklist>
          <X aria-hidden="true" />
        </Button>
      }
      flush
    >
      <ol className="divide-y divide-border/60 text-sm" data-getting-started>
        {items.map((item) => (
          <li key={item.id} className="flex min-h-(--row-h) items-center gap-2 px-3 py-1" data-check={item.id} data-done={item.done || undefined}>
            {item.done ? <CircleCheck aria-hidden="true" className="size-4 shrink-0 text-success" /> : <Circle aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />}
            <span className={cn("min-w-0 flex-1 truncate", item.done && "text-muted-foreground")}>
              {row[item.id].label}
              {item.done ? <span className="sr-only"> · {m.status_done()}</span> : null}
            </span>
            {item.done ? null : row[item.id].action}
          </li>
        ))}
      </ol>
    </Box>
  )
}
