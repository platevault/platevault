/**
 * "Start a processing run" (slice B, part of S3): one subject and one rig
 * of the Project, fixed for good; a mosaic subject creates a run group
 * (PRJ-FR-10, D-W38, D-W49, D-W50). The action is `startRun` in
 * store/actions/runs.ts. Foundation placeholder; slice B replaces this file.
 */
import { PlaceholderSheet } from "@/app/placeholder-sheet"
import { SCREENS } from "@/app/screens"
import { useShellUi } from "@/app/ui-state"
import { rigName, subjectName } from "@/domain/derive"
import { useStore } from "@/store/core"

export function StartRunSheet() {
  const { sheet } = useShellUi()
  const catalog = useStore((s) => s.catalog)
  const project = sheet?.kind === "start-run" ? catalog.projects[sheet.projectId] : undefined
  return (
    <PlaceholderSheet
      open={sheet?.kind === "start-run"}
      screen={{ ...SCREENS.S3, mustShow: "Start a processing run asks for one subject and one rig of the Project and creates the run inside it; a mosaic subject creates a run group with one panel run per panel (PRJ-FR-10, VSEL-FR-18)." }}
      title="Start a processing run"
      facts={
        project
          ? [
              { label: "Subjects", value: project.subjects.map((s) => subjectName(catalog, s)).join(", ") },
              { label: "Rigs", value: project.rigIds.map((id) => rigName(catalog, id)).join(", ") },
            ]
          : []
      }
    />
  )
}
