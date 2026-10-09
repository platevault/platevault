/**
 * Slice B shell contribution (see `src/app/shell-contract.ts`): the New
 * Project and Start run sheet hosts, and their palette actions. The Project
 * actions follow the Project the route has open; Wrap up and the mosaic
 * editor are Project pages, not sheets.
 */
import { useNavigate } from "@tanstack/react-router"
import { useActiveRoute } from "@/app/active-route"
import type { PaletteCommand, ShellContribution } from "@/app/shell-contract"
import { openSheet } from "@/app/ui-state"
import { projectWrapUp } from "@/domain/derive"
import { useStore } from "@/store/core"
import { NewProjectSheet } from "./new-project"
import { StartRunSheet } from "./start-run"

function Sheets() {
  return (
    <>
      <NewProjectSheet />
      <StartRunSheet />
    </>
  )
}

function useCommands(): PaletteCommand[] {
  const active = useActiveRoute()
  const navigate = useNavigate()
  const project = useStore((s) => (active.projectId ? s.catalog.projects[active.projectId] : undefined))
  const wrapUp = useStore((s) => (project ? projectWrapUp(s.catalog, project).available || project.state === "done" : false))
  const commands: PaletteCommand[] = [
    { id: "b:new-project", label: "New Project…", group: "Actions", keywords: "create project campaign subjects rigs goals", run: () => openSheet({ kind: "new-project" }) },
  ]
  if (project?.state === "open") {
    commands.push({ id: "b:start-run", label: `Start run in ${project.name}…`, group: "Actions", keywords: "new processing run subject rig profile", run: () => openSheet({ kind: "start-run", projectId: project.id }) })
    commands.push({
      id: "b:new-mosaic",
      label: `New mosaic in ${project.name}…`,
      group: "Actions",
      keywords: "mosaic panels field run group",
      run: () => void navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: { mosaic: "new" } }),
    })
  }
  if (project && wrapUp)
    commands.push({
      id: "b:wrap-up",
      label: `Wrap up ${project.name}`,
      group: "Actions",
      keywords: "clean up trash rejects intermediates duplicates archive done",
      run: () => void navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: { stage: "wrap-up" } }),
    })
  return commands
}

export const bShell: ShellContribution = { Overlay: Sheets, useCommands }
