/**
 * Slice A shell contribution (see `src/app/shell-contract.ts`): the Import
 * sheet host and its palette action. Slice A owns this file.
 */
import type { PaletteCommand, ShellContribution } from "@/app/shell-contract"
import { openSheet } from "@/app/ui-state"
import { ImportSheet } from "./import"

function useCommands(): PaletteCommand[] {
  return [{ id: "a:import", label: "Import…", group: "Actions", keywords: "import copy move removable device usb sd source folder captures calibration", run: () => openSheet({ kind: "import" }) }]
}

export const aShell: ShellContribution = { Overlay: ImportSheet, useCommands }
