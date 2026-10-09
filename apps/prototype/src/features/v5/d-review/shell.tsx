/**
 * Slice D shell contribution (see `src/app/shell-contract.ts`): while frame
 * review is open, its frame commands appear in the palette. Slice D owns
 * this file.
 */
import type { PaletteCommand, ShellContribution } from "@/app/shell-contract"
import { useFrameCommands } from "@/features/t3/shell"

function useCommands(): PaletteCommand[] {
  const frames = useFrameCommands()
  if (!frames) return []
  return [
    { id: "d:next-frame", label: "Next frame (J)", group: "Review", keywords: "frame next j", run: frames.next },
    { id: "d:previous-frame", label: "Previous frame (K)", group: "Review", keywords: "frame previous k", run: frames.previous },
    { id: "d:exclude-frame", label: `${frames.excludeLabel} (X)`, group: "Review", keywords: "exclude reject restore frame x", run: frames.exclude },
  ]
}

export const dShell: ShellContribution = { useCommands }
