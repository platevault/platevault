/**
 * S2 Projects list (slice B): one row per Project with subjects, rigs, goal
 * progress, open runs, stage and Next; Show done; New Project (D-W1, D-W48).
 * Foundation placeholder; slice B replaces this file.
 */
import { PlaceholderPage } from "@/components/app/page"
import { SCREENS } from "@/app/screens"
import { projectRuns, projectStage, projectStatus } from "@/domain/derive"
import { useStore } from "@/store/core"

export function ProjectsPage() {
  const state = useStore((s) => s)
  const projects = Object.values(state.catalog.projects).sort((a, b) => a.name.localeCompare(b.name))
  return (
    <PlaceholderPage
      screen={SCREENS.S2}
      facts={projects.map((p) => ({
        label: p.name,
        value: `${projectStatus(p)} · ${p.subjects.length} subjects · ${p.rigIds.length} rigs · ${projectRuns(state.catalog, p.id).length} runs · ${projectStage(state, p).label}`,
      }))}
    />
  )
}
