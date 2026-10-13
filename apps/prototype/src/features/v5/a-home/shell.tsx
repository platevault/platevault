/**
 * Slice A shell contribution (see `src/app/shell-contract.ts`): the Import
 * palette action, which opens the Import StepPage. Slice A owns this file.
 */
import { useMessages } from "@/app/preferences"
import type { PaletteCommand, ShellContribution } from "@/app/shell-contract"

function useCommands(): PaletteCommand[] {
  const m = useMessages()
  return [{ id: "a:import", label: m.import_open(), group: "Actions", keywords: "import copy move removable device usb sd source folder captures calibration", to: "/import" }]
}

export const aShell: ShellContribution = { useCommands }
