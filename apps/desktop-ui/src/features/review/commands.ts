/**
 * The open review's palette commands: while a review is mounted it registers
 * its frame commands here, and `shell.tsx` lists them in the command palette
 * with their keys. Null while no review is open.
 */
import { useSyncExternalStore } from "react"

export interface ReviewCommand {
  id: string
  label: string
  shortcut: string
  run: () => void
}

let commands: readonly ReviewCommand[] | null = null
const listeners = new Set<() => void>()

export function registerReviewCommands(next: readonly ReviewCommand[] | null): void {
  commands = next
  for (const listener of listeners) listener()
}

export function useReviewCommands(): readonly ReviewCommand[] | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => commands,
  )
}
