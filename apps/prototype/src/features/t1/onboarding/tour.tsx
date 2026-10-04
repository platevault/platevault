/**
 * One-time orientation tour (J18 S1-S5, adapted to the current IA, HLD §14).
 * Modal: the backdrop blocks the page, and only Next, Back, Skip tour and
 * Escape act. Each stop opens its page and sits beside the sidebar item it
 * explains. Built on Base UI Dialog with `role=dialog`, a labelled title and
 * initial focus inside (modern-web-guidance `persistent-app-tours`); it is
 * positioned with `getBoundingClientRect`, the guide's fallback, because CSS
 * anchor positioning is not yet widely available.
 */
import { Dialog as DialogPrimitive } from "@base-ui/react/dialog"
import { useNavigate, useRouterState } from "@tanstack/react-router"
import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { useStore } from "@/store/core"
import { endTour, setTourStop } from "../lib/writes"

interface Stop {
  title: string
  body: string
  route: string
  anchor: string
}

const STOPS: Stop[] = [
  // Hash-history links render as "/#/targets" (or "./#/targets"), so match the end of the href.
  { title: "Targets", route: "/targets", anchor: 'nav[aria-label="Main"] [href$="#/targets"]', body: "Your library starts here. Each Target shows captured, usable and Unreviewed integration by channel, with its Projects, Views and plans." },
  { title: "Sessions", route: "/sessions", anchor: 'nav[aria-label="Main"] [href$="#/sessions"]', body: "Every indexed session, one per filter, exposure and equipment. Inspect the evidence, confirm Targets and equipment, and select sessions to create a View." },
  { title: "Calibration", route: "/calibration", anchor: 'nav[aria-label="Main"] [href$="#/calibration"]', body: "Masters and raw calibration sets, grouped by camera, settings and channel. PlateVault shows compatibility; it never builds masters." },
  { title: "Projects", route: "/projects", anchor: 'nav[aria-label="Main"] [href$="#/projects"]', body: "Optional goals with a capture checklist. A Project never moves files and never blocks creating a View." },
  { title: "Views", route: "/views", anchor: 'nav[aria-label="Main"] [href$="#/views"]', body: "A View is a named, reviewed set of frames. Review frames, accept calibration and prepare inputs for PixInsight, Siril or another app." },
  { title: "Getting started", route: "/targets", anchor: "[data-getting-started-trigger]", body: "This checklist ticks itself from what you do. Open it any time, or remove it from its menu." },
]

const REMOVED_LAST_STOP: Stop = {
  title: "Settings",
  route: "/targets",
  anchor: 'aside [href$="#/settings"]',
  body: "Settings holds locations, equipment, sites and appearance. You removed Getting started; restore it in Settings › About this prototype.",
}

const GAP = 12

export function OrientationTour() {
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const completedAt = useStore((s) => s.settings.onboarding.completedAt)
  const tourCompletedAt = useStore((s) => s.settings.onboarding.tourCompletedAt)
  const checklistHidden = useStore((s) => s.settings.onboarding.checklistHidden)
  const tour = useStore((s) => s.slices.t1.tour)
  const inSetup = pathname.startsWith("/welcome") || pathname.startsWith("/setup")
  const open = !inSetup && ((completedAt !== null && tourCompletedAt === null) || tour.replaying)
  const index = Math.min(tour.stop, STOPS.length - 1)
  const stop = index === STOPS.length - 1 && checklistHidden ? REMOVED_LAST_STOP : STOPS[index]!
  const last = index === STOPS.length - 1
  const [rect, setRect] = useState<DOMRect | null>(null)
  const popup = useRef<HTMLDivElement>(null)
  const next = useRef<HTMLButtonElement>(null)

  // Next brings the stop's page into view (J18 S2).
  useEffect(() => {
    if (open && pathname !== stop.route) void navigate({ to: stop.route })
  }, [open, stop.route])

  useLayoutEffect(() => {
    if (!open) return
    const measure = () => setRect(document.querySelector(stop.anchor)?.getBoundingClientRect() ?? null)
    measure()
    const frame = requestAnimationFrame(measure)
    window.addEventListener("resize", measure)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", measure)
    }
  }, [open, stop.anchor, pathname])

  useEffect(() => {
    if (open) next.current?.focus()
  }, [open, index])

  const height = popup.current?.offsetHeight ?? 180
  const position = rect
    ? { left: rect.right + GAP, top: Math.max(GAP, Math.min(rect.top + rect.height / 2 - height / 2, window.innerHeight - height - GAP)) }
    : { left: window.innerWidth / 2 - 160, top: window.innerHeight / 2 - height / 2 }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={(value) => !value && endTour()} disablePointerDismissal>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-black/45 duration-100 data-open:animate-in data-open:fade-in-0" />
        {rect ? (
          <div
            aria-hidden="true"
            className="pointer-events-none fixed z-50 rounded-md ring-2 ring-primary"
            style={{ left: rect.left - 3, top: rect.top - 3, width: rect.width + 6, height: rect.height + 6 }}
          />
        ) : null}
        <DialogPrimitive.Popup
          ref={popup}
          initialFocus={next}
          // No trigger opened the tour, so return focus to the page content when it ends.
          finalFocus={() => document.getElementById("main")}
          className="fixed z-50 w-80 space-y-3 rounded-lg bg-popover p-4 text-sm text-popover-foreground shadow-md ring-1 ring-foreground/10 outline-none duration-100 data-open:animate-in data-open:fade-in-0"
          style={position}
        >
          <p className="text-xs text-muted-foreground tabular-nums">
            Stop {index + 1} of {STOPS.length}
          </p>
          <DialogPrimitive.Title className="text-base font-semibold">{stop.title}</DialogPrimitive.Title>
          <DialogPrimitive.Description className="text-pretty text-muted-foreground">{stop.body}</DialogPrimitive.Description>
          <div className="flex items-center justify-between gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={() => endTour()}>
              Skip tour
            </Button>
            <div className="flex gap-2">
              {index > 0 ? (
                <Button variant="outline" size="sm" onClick={() => setTourStop(index - 1)}>
                  Back
                </Button>
              ) : null}
              <Button ref={next} size="sm" onClick={() => (last ? endTour() : setTourStop(index + 1))}>
                {last ? "Finish" : "Next"}
              </Button>
            </div>
          </div>
        </DialogPrimitive.Popup>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
