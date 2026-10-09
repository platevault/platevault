/**
 * Slice D shell contribution (see `src/app/shell-contract.ts`): while S6
 * Review is open, its frame commands appear in the command palette with
 * their hotkeys. Slice D owns this file.
 */
import { useMessages } from "@/app/preferences"
import type { PaletteCommand, ShellContribution } from "@/app/shell-contract"
import { useReviewCommands } from "./commands"

function useCommands(): PaletteCommand[] {
  const m = useMessages()
  const commands = useReviewCommands()
  if (!commands) return []
  const group = m.step_review()
  return commands.map((c) => ({ id: `d:${c.id}`, label: m.shell_with_shortcut({ label: c.label, shortcut: c.keys }), group, keywords: `frame review ${c.keys.toLowerCase()}`, run: c.run }))
}

export const dShell: ShellContribution = { useCommands }
