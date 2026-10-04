/**
 * Projects (`/projects`): optional goals with checklist progress, linked
 * sessions, Views and accepted products (PRJ-FR-07).
 */
import { Link } from "@tanstack/react-router"
import { Goal } from "lucide-react"
import { Fragment } from "react"
import { type Column, DataTable } from "@/components/app/data-table"
import { EmptyState } from "@/components/app/feedback"
import { PageBody, PageHeader } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { projectProgress } from "@/domain/derive"
import type { Project } from "@/domain/types"
import { formatCount, formatDateTime, formatNight } from "@/lib/format"
import { useStore } from "@/store/core"
import { acceptedResultsForViews } from "../model"

interface ProjectRow {
  project: Project
  targets: string[]
  met: number
  items: number
  views: number
  products: number
}

export function ProjectsPage() {
  const rows = useStore((s) =>
    Object.values(s.catalog.projects).map((project): ProjectRow => {
      const progress = projectProgress(s.catalog, project)
      const views = Object.values(s.catalog.views).filter((v) => v.projectId === project.id)
      return {
        project,
        targets: [...project.targetIds.map((id) => s.catalog.targets[id]?.name ?? "Removed Target"), ...project.panels.map((p) => p.name)],
        met: progress.filter((p) => p.state === "met").length,
        items: progress.length,
        views: views.length,
        products: acceptedResultsForViews(s.catalog, views).length,
      }
    }),
  )

  const columns: Column<ProjectRow>[] = [
    {
      id: "name",
      header: "Project",
      rowHeader: true,
      className: "min-w-36 whitespace-normal",
      sortValue: (r) => r.project.name,
      cell: (r) => (
        <Link to="/projects/$projectId" params={{ projectId: r.project.id }} className="font-medium underline-offset-2 hover:underline">
          {r.project.name}
        </Link>
      ),
    },
    {
      id: "targets",
      header: "Targets",
      className: "whitespace-normal",
      cell: (r) =>
        r.targets.length > 0 ? (
          // Each name stays whole; the list wraps after a comma.
          r.targets.map((name, i) => (
            <Fragment key={`${name}-${i}`}>
              {i > 0 ? ", " : null}
              <span className="whitespace-nowrap">{name}</span>
            </Fragment>
          ))
        ) : (
          <span className="text-muted-foreground">None</span>
        ),
    },
    { id: "checklist", header: "Checklist", sortValue: (r) => r.met, cell: (r) => (r.items > 0 ? `${r.met} of ${r.items} met` : <span className="text-muted-foreground">No checklist</span>) },
    { id: "linked", header: "Sessions", align: "right", sortValue: (r) => r.project.linkedSessionIds.length, cell: (r) => r.project.linkedSessionIds.length },
    { id: "views", header: "Views", align: "right", sortValue: (r) => r.views, cell: (r) => r.views },
    { id: "products", header: "Products", align: "right", sortValue: (r) => r.products, cell: (r) => `${formatCount(r.products)} accepted` },
    {
      id: "created",
      header: "Created",
      sortValue: (r) => r.project.createdAt,
      cell: (r) => <time dateTime={r.project.createdAt} title={formatDateTime(r.project.createdAt)}>{formatNight(r.project.createdAt.slice(0, 10), true)}</time>,
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Projects"
        description="Optional goals and capture checklists. A Project is never required to inspect the library or create a View."
        actions={<Button render={<Link to="/projects/new" />}>New Project</Button>}
      />
      <PageBody>
        {rows.length === 0 ? (
          <EmptyState
            icon={Goal}
            titleAs="h2"
            title="No Projects yet"
            description="A Project records a goal such as Ha 10h for NGC 7000. It changes no files and creates no Views."
            action={
              <Button size="sm" render={<Link to="/projects/new" />}>
                New Project
              </Button>
            }
          />
        ) : (
          <DataTable label="Projects" rows={rows} columns={columns} getRowId={(r) => r.project.id} initialSort={{ columnId: "created", direction: "desc" }} />
        )}
      </PageBody>
    </div>
  )
}
