/**
 * Frame commands registry (v4 frame review, kept for slice D): while frame
 * review is mounted it registers its visible J, K and X controls here, and
 * slice D's shell contribution lists them in the command palette.
 */
import { useSyncExternalStore } from "react"

export interface FrameCommands {
  next: () => void
  previous: () => void
  exclude: () => void
  excludeLabel: string
}

let frameCommands: FrameCommands | null = null
const listeners = new Set<() => void>()

/** Frame review registers its commands while mounted; null on unmount. */
export function registerFrameCommands(commands: FrameCommands | null) {
  frameCommands = commands
  for (const listener of listeners) listener()
}

export function useFrameCommands(): FrameCommands | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => frameCommands,
  )
}
