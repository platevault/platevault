/**
 * Slice B shell contribution (see `src/app/shell-contract.ts`): the New
 * Project dialog host and the palette actions. The Project actions follow
 * the Project the route has open: Apply… while it is open, Wrap up once it
 * can be worked on or the Project is closed. Wrap up and the Project's tabs
 * are Project pages, not dialogs.
 */
import { useNavigate } from "@tanstack/react-router"
import { useActiveRoute } from "@/app/active-route"
import { useMessages } from "@/app/preferences"
import type { PaletteCommand, ShellContribution } from "@/app/shell-contract"
import { openSheet } from "@/app/ui-state"
import { isLocked } from "@/domain/derive"
import { wrapUpSummary } from "@/domain/project-view"
import { useStore } from "@/store/core"
import { NewProjectDialog } from "./new-project"
import { openApplySheet } from "./view-step"

function Dialogs() {
  return <NewProjectDialog />
}

function useCommands(): PaletteCommand[] {
  const active = useActiveRoute()
  const navigate = useNavigate()
  const m = useMessages()
  const project = useStore((s) => (active.projectId ? s.catalog.projects[active.projectId] : undefined))
  const wrapUp = useStore((s) => (project ? isLocked(project) || wrapUpSummary(s, project).available : false))
  const commands: PaletteCommand[] = [
    { id: "b:new-project", label: m.newproject_open_ellipsis(), group: "Actions", keywords: "create project campaign subjects rigs goals", run: () => openSheet({ kind: "new-project" }) },
  ]
  if (project && !isLocked(project))
    commands.push({
      id: "b:apply",
      label: m.project_apply_in_project_ellipsis({ name: project.name }),
      group: "Actions",
      keywords: "apply view build folder changes symlinks copies",
      run: () => {
        openApplySheet(project.id)
        void navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: { stage: "view" } })
      },
    })
  if (project && wrapUp)
    commands.push({
      id: "b:wrap-up",
      label: m.wrapup_project({ name: project.name }),
      group: "Actions",
      keywords: "clean up trash rejects processing duplicates archive close",
      run: () => void navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: { stage: "wrap-up" } }),
    })
  return commands
}

export const bShell: ShellContribution = { Overlay: Dialogs, useCommands }
