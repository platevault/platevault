/**
 * The Projects shell contribution (src/app/shell-contract.ts): the palette's
 * New Project… and one Open entry per Project, and the Apply waiting
 * listener. Reads nothing while the
 * palette is closed: the Project list query runs only with `open`.
 */
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useLibraryEvent } from "@/api/events"
import { APPLY_WAITING_EVENT } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import type { PaletteState, ShellContribution } from "@/app/shell-contract"
import type { PaletteCommand } from "@/components/app/contracts"
import { applyWaiting } from "./apply-run"
import { projectsQuery } from "./queries"

function useCommands({ open }: PaletteState): PaletteCommand[] {
  const m = useMessages()
  const navigate = useNavigate()
  const list = useQuery({ ...projectsQuery(), enabled: open })
  if (!open) return []
  return [
    { id: "projects:new", label: m.newproject_open_ellipsis(), group: "Actions", keywords: "create project campaign subjects", run: () => void navigate({ to: "/projects", search: { new: "open" } }) },
    ...(list.data ?? []).map(
      (project): PaletteCommand => ({ id: `projects:open:${project.id}`, label: project.name, group: m.nav_projects(), keywords: project.subjects.join(" "), to: `/projects/${project.id}` }),
    ),
  ]
}

/**
 * Always mounted, so a running Apply hears its waiting events whichever page
 * is open. The run's state after a restart is not read here: that durable
 * read belongs to astro-plan-wre19.6.
 */
function ApplyWaitingListener() {
  useLibraryEvent(APPLY_WAITING_EVENT, applyWaiting)
  return null
}

export const projectsShell: ShellContribution = { Overlay: ApplyWaitingListener, useCommands }
