/**
 * Review's shell contribution (app/shell-contract.ts): while a review is
 * open, its frame commands appear in the palette under Review, each with its
 * key and, when it cannot run now, why. The source is in memory, so a closed
 * palette reads nothing.
 */
import { useMessages } from "@/app/preferences"
import type { PaletteState, ShellContribution } from "@/app/shell-contract"
import type { PaletteCommand } from "@/components/app/contracts"
import { useReviewCommands } from "./commands"

function useCommands({ open }: PaletteState): PaletteCommand[] {
  const m = useMessages()
  const commands = useReviewCommands()
  if (!open || !commands) return []
  return commands(m.step_review())
}

export const reviewShell: ShellContribution = { useCommands }
