/**
 * Slice B shell contribution (see `src/app/shell-contract.ts`): the New
 * Project, Start a run and Done / Archive sheet hosts and the New Project
 * palette action. Slice B owns this file.
 */
import type { PaletteCommand, ShellContribution } from "@/app/shell-contract"
import { openSheet } from "@/app/ui-state"
import { DoneArchiveSheet } from "./done-archive"
import { NewProjectSheet } from "./new-project"
import { StartRunSheet } from "./start-run"

function Sheets() {
  return (
    <>
      <NewProjectSheet />
      <StartRunSheet />
      <DoneArchiveSheet />
    </>
  )
}

function useCommands(): PaletteCommand[] {
  return [{ id: "b:new-project", label: "New Project…", group: "Actions", keywords: "create project campaign subjects rigs goals", run: () => openSheet({ kind: "new-project" }) }]
}

export const bShell: ShellContribution = { Overlay: Sheets, useCommands }
