/**
 * The adaptive detail dock (spec 054, plan §3.4): where a page's
 * DetailPanel docks and how wide it is.
 *
 * - Placement follows the window: the side from 1400 px wide, the bottom
 *   below (FR-001). The user's pin (Bottom or Right) overrides it (FR-003);
 *   a Right pin docks at the bottom while the window is narrower than two
 *   minimum panels.
 * - The side panel is dragged, keyed or set by a width preset (Narrow,
 *   Medium, Wide in its Display menu: the single-pointer way, WCAG 2.5.7)
 *   between 320 px and half the room beside it (FR-005), so the page body
 *   keeps at least half.
 * - Pin and width are kept per page (`dockId`) in localStorage. One store
 *   serves every panel of a page, so they always agree and a reload restores
 *   the choice.
 */
import { useSyncExternalStore } from "react"
import { useMediaQuery } from "@/lib/use-media-query"

export type DockPlacement = "side" | "bottom"

/** The user's choice: "auto" follows the window width. */
export type DockPin = "auto" | DockPlacement

/** The window width from which the panel docks to the side. */
export const DOCK_SIDE_FROM_PX = 1400
export const DOCK_MIN_WIDTH_PX = 320
const DOCK_DEFAULT_WIDTH_PX = 384
const KEY_PREFIX = "platevault.dock."

interface DockPrefs {
  pin: DockPin
  /** The side panel's width in px, as last set. */
  width: number
}

const DEFAULTS: DockPrefs = { pin: "auto", width: DOCK_DEFAULT_WIDTH_PX }
const cache = new Map<string, DockPrefs>()
const listeners = new Set<() => void>()

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function prefsOf(dockId: string | null): DockPrefs {
  if (dockId === null) return DEFAULTS
  const cached = cache.get(dockId)
  if (cached) return cached
  let prefs = DEFAULTS
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY_PREFIX + dockId) ?? "null")
    if (raw !== null && typeof raw === "object") {
      const { pin, width } = raw as Partial<Record<keyof DockPrefs, unknown>>
      prefs = {
        pin: pin === "side" || pin === "bottom" ? pin : "auto",
        width: typeof width === "number" && Number.isFinite(width) ? width : DEFAULTS.width,
      }
    }
  } catch {
    // Unreadable storage: the defaults.
  }
  cache.set(dockId, prefs)
  return prefs
}

function savePrefs(dockId: string, change: Partial<DockPrefs>) {
  const prefs = { ...prefsOf(dockId), ...change }
  cache.set(dockId, prefs)
  try {
    localStorage.setItem(KEY_PREFIX + dockId, JSON.stringify(prefs))
  } catch {
    // The choice applies for this session only.
  }
  for (const listener of listeners) listener()
}

/** A side panel width within its bounds: at least 320 px, at most `max` (half the room beside it). */
export function clampDockWidth(px: number, max: number): number {
  return Math.round(Math.min(Math.max(px, DOCK_MIN_WIDTH_PX), Math.max(DOCK_MIN_WIDTH_PX, max)))
}

/** The side panel's width presets, offered in its Display menu. */
export const DOCK_WIDTH_PRESETS = ["narrow", "medium", "wide"] as const
export type DockWidthPreset = (typeof DOCK_WIDTH_PRESETS)[number]

/** A preset's width for a room whose widest panel is `max`: the narrowest, halfway, or the widest. */
export function presetDockWidth(preset: DockWidthPreset, max: number): number {
  const widest = clampDockWidth(max, max)
  if (preset === "narrow") return DOCK_MIN_WIDTH_PX
  if (preset === "wide") return widest
  return clampDockWidth((DOCK_MIN_WIDTH_PX + widest) / 2, max)
}

export interface AdaptiveDock {
  placement: DockPlacement
  pin: DockPin
  setPin: (pin: DockPin) => void
  /** The side panel's width in px as the user set it; the panel bounds it to its room (`clampDockWidth`). */
  width: number
  setWidth: (px: number) => void
}

/** The dock of one page; `null` while the page shows no detail (nothing is read or kept). */
export function useAdaptiveDock(dockId: string | null): AdaptiveDock {
  const wide = useMediaQuery(`(min-width: ${DOCK_SIDE_FROM_PX}px)`)
  const roomy = useMediaQuery(`(min-width: ${DOCK_MIN_WIDTH_PX * 2}px)`)
  const prefs = useSyncExternalStore(subscribe, () => prefsOf(dockId))
  const side = prefs.pin === "side" ? roomy : prefs.pin === "auto" && wide
  return {
    placement: side ? "side" : "bottom",
    pin: prefs.pin,
    setPin: (pin) => {
      if (dockId !== null) savePrefs(dockId, { pin })
    },
    width: prefs.width,
    setWidth: (px) => {
      if (dockId !== null) savePrefs(dockId, { width: Math.round(Math.max(px, DOCK_MIN_WIDTH_PX)) })
    },
  }
}
