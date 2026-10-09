/**
 * S8 Project Trash (slice B): trashed runs with Restore, and Empty Trash per
 * run or for all, showing what goes and what stays (D-W72).
 * Foundation placeholder; slice B replaces this file.
 */
import { Link, useParams } from "@tanstack/react-router"
import { MissingRecord } from "@/app/missing-record"
import { PlaceholderPage } from "@/components/app/page"
import { SCREENS } from "@/app/screens"
import { projectTrash } from "@/domain/derive"
import { useStore } from "@/store/core"

export function ProjectTrashPage() {
  const { projectId } = useParams({ strict: false }) as { projectId?: string }
  const catalog = useStore((s) => s.catalog)
  const project = projectId ? catalog.projects[projectId] : undefined
  if (!project) return <MissingRecord noun="Project" backTo="/projects" backLabel="Open Projects" />
  const trashed = projectTrash(catalog, project.id)
  return (
    <PlaceholderPage
      screen={SCREENS.S8}
      title={`Trash of ${project.name}`}
      eyebrow={<Link to="/projects/$projectId" params={{ projectId: project.id }}>{project.name}</Link>}
      facts={[{ label: "Trashed runs", value: trashed.map((r) => r.name).join(", ") || "The Trash is empty" }]}
    />
  )
}
