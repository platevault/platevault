/**
 * The open review's palette commands: while a review is mounted it registers
 * a source of them here, and `shell.tsx` lists them in the command palette.
 * Each is built with `actionCommand` from the same Action the review runs
 * (shell-contract.ts), so it carries the action's key and, when it cannot
 * run now, its unavailable reason. Null while no review is open.
 */
import { useSyncExternalStore } from "react"
import type { PaletteCommand } from "@/components/app/contracts"

/** The review's commands under `group`, as they stand when the palette renders. */
export type ReviewCommands = (group: string) => PaletteCommand[]

let source: ReviewCommands | null = null
const listeners = new Set<() => void>()

export function registerReviewCommands(next: ReviewCommands | null): void {
  source = next
  for (const listener of listeners) listener()
}

export function useReviewCommands(): ReviewCommands | null {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    () => source,
  )
}
