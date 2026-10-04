/**
 * Views list (`/views`) and New View (`/views/new`). A View is created from a
 * Project (geometry preselection, VSEL-AC-01), a Target (no preselection,
 * VSEL-AC-14), selected Sessions (VSEL-AC-07) or accepted Results; with
 * `viewId` + `resultIds` it adds Results to an existing View's draft.
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { Layers } from "lucide-react"
import { useId, useState } from "react"
import { type Column, DataTable, TableToolbar } from "@/components/app/data-table"
import { ActionError, EmptyState, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { membershipSummary, viewStatus } from "@/domain/derive"
import type { MembershipContent, Session, ViewOrigin, ViewStatus } from "@/domain/types"
import { formatDateTime, formatDuration, plural } from "@/lib/format"
import { useStore } from "@/store/core"
import { createView, updateDraft } from "./actions"
import { SelectField } from "./fields"
import { addSessions, emptyContent, latestRevision, preselectedSessions, sessionLabel, viewContext } from "./model"

interface ViewRow {
  id: string
  name: string
  status: ViewStatus
  scope: string
  frames: number
  seconds: number
  revision: number | null
  updated: string
}

export function ViewsPage() {
  const catalog = useStore((s) => s.catalog)
  const [query, setQuery] = useState("")
  const rows: ViewRow[] = Object.values(catalog.views).map((view) => {
    const latest = latestRevision(view)
    const totals = membershipSummary(catalog, view.draft ?? latest ?? emptyContent()).included
    const project = view.projectId ? catalog.projects[view.projectId] : undefined
    return {
      id: view.id,
      name: view.name,
      status: viewStatus(catalog, view),
      scope: project ? `Project ${project.name}` : "Standalone",
      frames: totals.frames,
      seconds: totals.seconds,
      revision: latest?.revision ?? null,
      updated: view.draft?.updatedAt ?? latest?.savedAt ?? view.createdAt,
    }
  })
  const shown = rows.filter((row) => `${row.name} ${row.scope}`.toLowerCase().includes(query.toLowerCase()))
  const columns: Column<ViewRow>[] = [
    {
      id: "name",
      header: "Name",
      rowHeader: true,
      sortValue: (r) => r.name,
      cell: (r) => (
        <Link to="/views/$viewId/sessions" params={{ viewId: r.id }} className="font-medium hover:underline">
          {r.name}
        </Link>
      ),
    },
    { id: "status", header: "Status", sortValue: (r) => r.status, cell: (r) => <StatusBadge kind="view" value={r.status} /> },
    { id: "scope", header: "Project", sortValue: (r) => r.scope, cell: (r) => <span className={r.scope === "Standalone" ? "text-muted-foreground" : ""}>{r.scope}</span> },
    { id: "frames", header: "Lights", align: "right", sortValue: (r) => r.frames, cell: (r) => r.frames },
    { id: "integration", header: "Integration", align: "right", sortValue: (r) => r.seconds, cell: (r) => formatDuration(r.seconds) },
    { id: "revision", header: "Revision", align: "right", sortValue: (r) => r.revision, cell: (r) => (r.revision === null ? <span className="text-muted-foreground">Not saved</span> : r.revision) },
    { id: "updated", header: "Updated", sortValue: (r) => r.updated, cell: (r) => formatDateTime(r.updated) },
  ]
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Views"
        description="Every View, with or without a Project. A View holds the exact frames you reviewed for one processing attempt."
        actions={
          <Button size="sm" render={<Link to="/views/new" />}>
            New View
          </Button>
        }
      />
      <PageBody>
        {rows.length === 0 ? (
          <EmptyState
            icon={Layers}
            titleAs="h2"
            title="No Views yet"
            description="A View holds the exact frames you review for one processing attempt. Create one from a Project, a Target or selected Sessions."
            action={
              <Button size="sm" render={<Link to="/sessions" />}>
                Go to Sessions
              </Button>
            }
          />
        ) : (
          <div className="space-y-2">
            <TableToolbar search={{ label: "Filter Views", placeholder: "Filter by name or Project", value: query, onChange: setQuery }} />
            <DataTable
              label="Views"
              rows={shown}
              columns={columns}
              getRowId={(r) => r.id}
              initialSort={{ columnId: "updated", direction: "desc" }}
              empty={
                <EmptyState
                  icon={Layers}
                  title="No Views match this filter"
                  description="The filter only changes this list."
                  action={
                    <Button size="sm" variant="outline" onClick={() => setQuery("")}>
                      Clear filter
                    </Button>
                  }
                  className="border-0"
                />
              }
            />
          </div>
        )}
      </PageBody>
    </div>
  )
}


export function NewViewPage() {
  const search = useSearch({ strict: false }) as Record<string, string | undefined>
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const nameId = useId()
  const nameErrorId = useId()
  const resultIds = search.resultIds?.split(",").filter(Boolean) ?? []
  const sessionIds = search.sessionIds?.split(",").filter(Boolean) ?? []
  const existing = search.viewId ? catalog.views[search.viewId] : undefined
  const from = (["project", "target", "sessions", "results"] as const).find((f) => f === search.from) ?? (search.projectId ? "project" : search.targetId ? "target" : null)
  const initialProject = search.projectId ?? null
  const [name, setName] = useState("")
  const [projectId, setProjectId] = useState(initialProject ?? "none")
  const [nameError, setNameError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const projects = Object.values(catalog.projects)
  const project = projectId !== "none" ? catalog.projects[projectId] : undefined
  const targetId = search.targetId ?? project?.targetIds[0] ?? null
  const target = targetId ? catalog.targets[targetId] : undefined
  const sessions = sessionIds.map((id) => catalog.sessions[id]).filter((s): s is Session => s !== undefined)
  const results = resultIds.map((id) => catalog.results[id]).filter((r) => r !== undefined)
  const missingProject = initialProject && !catalog.projects[initialProject]
  const missingTarget = search.targetId && !catalog.targets[search.targetId]

  // Adding accepted Results to an existing View (H3a alternative).
  if (search.viewId) {
    if (!existing) {
      return (
        <RefusalPage title="Add Results to a View" message={`No View with id ${search.viewId} exists. Nothing was added.`} />
      )
    }
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="Add Results to a View" description={`Adds ${plural(results.length, "accepted Result")} to the unsaved draft of ${existing.name}.`} />
        <PageBody className="max-w-2xl">
          <ul className="list-disc space-y-0.5 pl-5 text-sm">
            {results.map((r) => (
              <li key={r.id} className="font-mono text-xs">
                {r.path}
              </li>
            ))}
          </ul>
          {error ? <ActionError message={error} /> : null}
          <div className="flex gap-2">
            <Button variant="outline" render={<Link to="/views/$viewId/results" params={{ viewId: existing.id }} />}>
              Cancel
            </Button>
            <Button
              disabled={results.length === 0}
              onClick={() => {
                const result = updateDraft(existing.id, "Add Results to View", (content) => ({
                  ...content,
                  productInputs: [...new Set([...content.productInputs, ...results.map((r) => r.id)])],
                }))
                if (!result.ok) return setError(result.message)
                void navigate({ to: "/views/$viewId/sessions", params: { viewId: existing.id } })
              }}
            >
              Add to draft
            </Button>
          </div>
        </PageBody>
      </div>
    )
  }

  if (missingProject || missingTarget) {
    return <RefusalPage title="New View" message={`${missingProject ? `Project ${initialProject}` : `Target ${search.targetId}`} was not found, so no View was created.`} />
  }

  const ctx = viewContext(catalog, { projectId: project?.id ?? null, targetId })
  let origin: ViewOrigin = from ?? (project ? "project" : target ? "target" : "sessions")
  if (from === "project" && !project) origin = target ? "target" : "sessions"
  // Geometry preselection follows the chosen Project, however the page was reached (generic New View included).
  const preselected = origin === "project" && project ? preselectedSessions(catalog, ctx) : []
  let content: MembershipContent = emptyContent()
  let startingPoint: string
  if (origin === "project" && project) {
    content = addSessions(content, disk, catalog, preselected)
    startingPoint =
      preselected.length > 0
        ? `Starts with ${plural(preselected.length, "geometry suggestion")} from the Project framing and ${ctx.equipmentName ?? "its equipment"}: ${preselected.map((p) => sessionLabel(p.session)).join(", ")}. Nothing else is selected.`
        : `No session qualifies as a geometry suggestion yet${ctx.equipmentId ? "" : ": the Project has no chosen equipment"}. Suggestions are listed in the workspace for you to check.`
  } else if (origin === "sessions") {
    content = addSessions(content, disk, catalog, sessions.map((session) => ({ session, reason: { kind: "manual", detail: "Chosen in Sessions" } })))
    startingPoint = sessions.length > 0 ? `Starts with the ${plural(sessions.length, "session")} you chose in Sessions: ${sessions.map(sessionLabel).join(", ")}.` : "Starts empty. Add sessions in the workspace."
  } else if (origin === "results") {
    content = { ...content, productInputs: results.map((r) => r.id) }
    startingPoint = `Starts with ${plural(results.length, "accepted Result")} as inputs, listed apart from raw sessions.`
  } else {
    startingPoint = target ? `No sessions are selected. Suggestions for ${target.name} are listed so you can check them yourself.` : "Starts empty. Add sessions in the workspace."
  }

  function submit() {
    if (name.trim() === "") {
      setNameError("Enter a View name.")
      document.getElementById(nameId)?.focus()
      return
    }
    const { result, viewId } = createView({ name: name.trim(), projectId: project?.id ?? null, targetId, origin, content })
    if (!result.ok) {
      setError(result.message.replace("Create View was not saved", "View not created"))
      return
    }
    void navigate({ to: "/views/$viewId/sessions", params: { viewId } })
  }

  const originLabel: Record<ViewOrigin, string> = {
    project: project ? `From Project ${project.name}` : "From a Project",
    target: target ? `From Target ${target.name}` : "From a Target",
    sessions: "From Sessions",
    results: "From accepted Results",
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="New View" description="Name the View. Create View adds it as a draft; its membership is committed only when you choose Save View in the workspace." />
      <PageBody className="max-w-2xl">
        {origin === "sessions" && sessions.length === 0 && sessionIds.length > 0 ? (
          <Notice tone="warning" title="The chosen sessions were not found">
            {sessionIds.length} session ids from the link are not in the library. The View starts empty.
          </Notice>
        ) : null}
        <Section title="Starting point" level={2} description={originLabel[origin]}>
          <p className="text-sm text-pretty">{startingPoint}</p>
          {target ? <p className="text-xs text-muted-foreground">Target {target.name}</p> : null}
        </Section>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <div className="grid max-w-md gap-1.5">
            <Label htmlFor={nameId}>View name</Label>
            <Input
              id={nameId}
              value={name}
              required
              placeholder="e.g. NGC7000 HOO - Siril"
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? nameErrorId : undefined}
              onChange={(event) => {
                setName(event.target.value)
                setNameError(null)
              }}
            />
            {nameError ? (
              <p id={nameErrorId} className="text-xs text-destructive">
                {nameError}
              </p>
            ) : null}
          </div>
          <SelectField
            className="max-w-md"
            label="Project"
            value={projectId}
            onChange={setProjectId}
            description={origin === "project" ? "Changing the Project here changes the suggestions above." : "Optional. A View without a Project is standalone."}
            options={[{ value: "none", label: "No Project (standalone View)" }, ...projects.map((p) => ({ value: p.id, label: p.name }))]}
          />
          <p className="text-sm text-muted-foreground">Creating a View changes no session, frame or quality decision.</p>
          {error ? <ActionError message={error} onRetry={submit} /> : null}
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => window.history.back()}>
              Cancel
            </Button>
            <Button type="submit">Create View</Button>
          </div>
        </form>
      </PageBody>
    </div>
  )
}

function RefusalPage({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title={title} />
      <PageBody className="max-w-2xl">
        <Notice
          tone="refusal"
          title="Not created"
          actions={
            <Button size="sm" variant="outline" render={<Link to="/views" />}>
              Go to Views
            </Button>
          }
        >
          {message}
        </Notice>
      </PageBody>
    </div>
  )
}
