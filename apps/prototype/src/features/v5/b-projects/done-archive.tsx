/**
 * S9 Done / Archive sheet on a Project (slice B): Archive and the three
 * trash offers, each approved separately with its size and refusals
 * (D-W26, D-W43, D-W46, D-W69, D-W70, D-W74). Approved moves go through
 * `moveToOsTrash` (store/actions/trash.ts). Foundation placeholder; slice B
 * replaces this file.
 */
import { PlaceholderSheet } from "@/app/placeholder-sheet"
import { SCREENS } from "@/app/screens"
import { useShellUi } from "@/app/ui-state"
import { projectStatus } from "@/domain/derive"
import { useStore } from "@/store/core"

export function DoneArchiveSheet() {
  const { sheet } = useShellUi()
  const project = useStore((s) => (sheet?.kind === "done-archive" ? s.catalog.projects[sheet.projectId] : undefined))
  return (
    <PlaceholderSheet
      open={sheet?.kind === "done-archive"}
      screen={SCREENS.S9}
      title={project ? `Done / Archive: ${project.name}` : undefined}
      facts={project ? [{ label: "State", value: projectStatus(project) }] : []}
    />
  )
}
