/**
 * Slice B shell contribution (see `src/app/shell-contract.ts`): the New
 * Project, Start a run and Done / Archive sheet hosts, and their palette
 * actions. The Project actions follow the Project the route has open.
 */
import { useActiveRoute } from "@/app/outline"
import type { PaletteCommand, ShellContribution } from "@/app/shell-contract"
import { openSheet } from "@/app/ui-state"
import { useStore } from "@/store/core"
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
  const active = useActiveRoute()
  const project = useStore((s) => (active.projectId ? s.catalog.projects[active.projectId] : undefined))
  const commands: PaletteCommand[] = [
    { id: "b:new-project", label: "New Project…", group: "Actions", keywords: "create project campaign subjects rigs goals", run: () => openSheet({ kind: "new-project" }) },
  ]
  if (project?.state === "open")
    commands.push({ id: "b:start-run", label: `Start a processing run in ${project.name}…`, group: "Actions", keywords: "new run subject rig mosaic group", run: () => openSheet({ kind: "start-run", projectId: project.id }) })
  if (project?.state === "done")
    commands.push({ id: "b:done-archive", label: `Done / Archive: ${project.name}…`, group: "Actions", keywords: "archive trash rejected intermediates duplicates", run: () => openSheet({ kind: "done-archive", projectId: project.id }) })
  return commands
}

export const bShell: ShellContribution = { Overlay: Sheets, useCommands }
