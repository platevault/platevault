/**
 * The orientation walk (LIB-FR-27): one stop per main navigation entry in
 * navigation order (Projects, Targets, Sessions, Calibration from the
 * source list, Import from the toolbar, then Activity and Settings), and
 * Home last. Each stop opens its page and cuts out its source-list row or
 * toolbar button; a stop whose page is not registered, or whose anchor is
 * not on screen (a collapsed source list), is passed over. The walk creates
 * and changes no record.
 *
 * Leaving setup by any exit opens it (setup-pages.tsx), and Settings › Help
 * replays it from its first stop. "Opens once and never by itself again"
 * needs the durable first-run state of astro-plan-ocyuc.9; until that lands
 * the walk opens on each setup exit, never at launch.
 */
import { useRouter } from "@tanstack/react-router"
import { useSyncExternalStore } from "react"
import { ALL_NAV_ITEMS, useRoutable } from "@/app/navigation"
import { useMessages } from "@/app/preferences"
import { type CoachStep, CoachWalk } from "@/components/app/walk"
import type { Messages } from "@/lib/i18n"

let open = false
const listeners = new Set<() => void>()

function setOpen(next: boolean): void {
  open = next
  for (const listener of listeners) listener()
}

/** Start the walk from its first stop. */
export function openWalk(): void {
  setOpen(true)
}

/** End the walk: Done, Skip or Escape, or no stop left on screen. */
export function endWalk(): void {
  setOpen(false)
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/** Each stop's words, by its route. */
function stopBody(m: Messages): Record<string, string> {
  return {
    "/projects": m.walk_stop_projects(),
    "/targets": m.walk_stop_targets(),
    "/sessions": m.walk_stop_sessions(),
    "/calibration": m.walk_stop_calibration(),
    "/import": m.walk_stop_import(),
    "/activity": m.walk_stop_activity(),
    "/settings": m.walk_stop_settings(),
    "/": m.walk_stop_home(),
  }
}

/** The stops of the registered pages, in walk order. */
export function walkStops(m: Messages, routable: (to: string) => boolean, go: (to: string) => void): CoachStep[] {
  const body = stopBody(m)
  const rows = ALL_NAV_ITEMS.filter((item) => item.to !== "/")
  const home = ALL_NAV_ITEMS.find((item) => item.to === "/")
  const library = rows.filter((item) => item.to !== "/activity" && item.to !== "/settings")
  const utilities = rows.filter((item) => item.to === "/activity" || item.to === "/settings")
  const row = (to: string, title: string): CoachStep => ({ id: to, title, body: body[to] ?? "", anchors: [`[data-frame-nav] [data-nav-item="${to}"]`, `[data-frame-utilities] [data-nav-item="${to}"]`], onEnter: () => go(to) })
  const steps: CoachStep[] = [
    ...library.map((item) => row(item.to, item.label)),
    { id: "/import", title: m.shell_import(), body: body["/import"] ?? "", anchors: ['[data-frame="app"] [data-action="import"]'], onEnter: () => go("/") },
    ...utilities.map((item) => row(item.to, item.label)),
    ...(home ? [row(home.to, home.label)] : []),
  ]
  return steps.filter((step) => routable(step.id))
}

/** The walk while it is open; mounted once at the app root (settings shell contribution). */
export function OrientationWalk() {
  const m = useMessages()
  const router = useRouter()
  const routable = useRoutable()
  const isOpen = useSyncExternalStore(subscribe, () => open)
  if (!isOpen) return null
  return <CoachWalk steps={walkStops(m, routable, (to) => router.history.push(to))} waitFrames={30} onEnd={endWalk} />
}
