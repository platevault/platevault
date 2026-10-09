/**
 * Review commands registry (slice D): while a review is mounted it registers
 * its frame actions here, and `shell.tsx` lists them in the command palette,
 * each naming its hotkey. Null when no review is open.
 */
import { useSyncExternalStore } from "react"

export interface ReviewCommand {
  id: string
  label: string
  keys: string
  run: () => void
}

let commands: ReviewCommand[] | null = null
const listeners = new Set<() => void>()

export function registerReviewCommands(next: ReviewCommand[] | null) {
  commands = next
  for (const listener of listeners) listener()
}

export function useReviewCommands(): ReviewCommand[] | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => commands,
  )
}
