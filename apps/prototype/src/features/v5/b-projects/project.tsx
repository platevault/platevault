/**
 * S3 Project (slice B): header state and actions, subjects (Target or mosaic
 * with panels), rigs, goals per subject and channel with warnings,
 * candidates, runs on a stage rail with run groups, planning, Trash
 * (D-W9, D-W29, D-W33, D-W36, D-W37, D-W38, D-W16, D-W59).
 * Foundation placeholder; slice B replaces this file.
 */
import { Link, useParams } from "@tanstack/react-router"
import { MissingRecord } from "@/app/missing-record"
import { PlaceholderPage } from "@/components/app/page"
import { SCREENS } from "@/app/screens"
import { goalProgress, projectCandidates, projectNext, projectRuns, projectStatus, projectTrash, projectWarnings, subjectName } from "@/domain/derive"
import { nowIso, useStore } from "@/store/core"

export function ProjectPage() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string }
  const state = useStore((s) => s)
  const project = projectId ? state.catalog.projects[projectId] : undefined
  if (!project) return <MissingRecord noun="Project" backTo="/projects" backLabel="Open Projects" />
  const { catalog, disk } = state
  return (
    <PlaceholderPage
      screen={SCREENS.S3}
      title={project.name}
      eyebrow={<Link to="/projects">Projects</Link>}
      facts={[
        { label: "State", value: projectStatus(project) },
        { label: "Subjects", value: project.subjects.map((s) => subjectName(catalog, s) + (s.mosaic ? ` (${s.mosaic.panels.length} panels)` : "")).join(", ") },
        { label: "Goals", value: goalProgress(catalog, project).map((g) => g.line).join(" · ") || "No goals" },
        { label: "Warnings", value: projectWarnings(disk, catalog, project).map((w) => w.message).join(" · ") || "None" },
        { label: "Candidates", value: `${projectCandidates(catalog, project).length} sessions` },
        { label: "Runs", value: `${projectRuns(catalog, project.id).length} · Trash ${projectTrash(catalog, project.id).length}` },
        { label: "Next", value: projectNext(state, project, Date.parse(nowIso()))?.label ?? "None" },
      ]}
    />
  )
}
