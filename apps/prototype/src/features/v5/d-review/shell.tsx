/**
 * Slice D shell contribution (see `src/app/shell-contract.ts`): while S6
 * Review is open, its frame commands appear in the command palette with
 * their hotkeys. Slice D owns this file.
 */
import type { PaletteCommand, ShellContribution } from "@/app/shell-contract"
import { useReviewCommands } from "./commands"

function useCommands(): PaletteCommand[] {
  const commands = useReviewCommands()
  if (!commands) return []
  return commands.map((c) => ({ id: `d:${c.id}`, label: `${c.label} (${c.keys})`, group: "Review", keywords: `frame review ${c.keys.toLowerCase()}`, run: c.run }))
}

export const dShell: ShellContribution = { useCommands }
