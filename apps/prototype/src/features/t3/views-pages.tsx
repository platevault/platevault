/**
 * Pipeline board (`/views`, the start page) and New View (`/views/new`).
 *
 * Harness v4: the board is Direction C's pipeline across every View. One
 * lane per View with the seven numbered stages as columns; the cell of the
 * stage that holds the View's Next action is lit, and lanes are grouped by
 * that stage. Targets that have light sessions but no View yet follow at the
 * end with Create View, so the board also says where a View could start.
 *
 * A View is created from a Project (geometry preselection, VSEL-AC-01), a
 * Target (no preselection, VSEL-AC-14), selected Sessions (VSEL-AC-07) or
 * accepted Results; with `viewId` + `resultIds` it adds Results to an
 * existing View's draft.
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { ChevronRight, Layers, Play } from "lucide-react"
import { useId, useMemo, useState } from "react"
import { GATE_LABEL, pipelineTotals, STAGE_AREA, STAGES, type Stage, type ViewPipeline, viewPipeline } from "@/app/pipeline"
import { StageGlyph, useFollowLink } from "@/app/pipeline-ui"
import { type Column, DataTable, TableToolbar } from "@/components/app/data-table"
import { ActionError, EmptyState, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuShortcut } from "@/components/ui/context-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { MembershipContent, Session, ViewOrigin } from "@/domain/types"
import { plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { type PrototypeState, useStore } from "@/store/core"
import { createView, updateDraft } from "./actions"
import { SelectField } from "./fields"
import { addSessions, emptyContent, preselectedSessions, sessionLabel, viewContext } from "./model"

type BoardRow =
  | {
      kind: "view"
      id: string
      name: string
      targetId: string | null
      targetName: string | null
      projectName: string | null
      totals: string
      pipeline: ViewPipeline
      group: string
    }
  | { kind: "target"; id: string; name: string; aliases: string; sessions: number; needsReview: number; group: string }

const GROUP_ORDER: string[] = [...STAGES.map((s) => s.id), "done", "unviewed"]

function boardRows(state: PrototypeState): BoardRow[] {
  const { catalog } = state
  const views: BoardRow[] = Object.values(catalog.views).map((view) => {
    const pipeline = viewPipeline(state, view)
    const target = view.targetId ? catalog.targets[view.targetId] : undefined
    const project = view.projectId ? catalog.projects[view.projectId] : undefined
    return {
      kind: "view",
      id: view.id,
      name: view.name,
      targetId: target?.id ?? null,
      targetName: target?.name ?? null,
      projectName: project?.name ?? null,
      totals: pipelineTotals(state, view),
      pipeline,
      group: pipeline.next?.stage.id ?? "done",
    }
  })
  const withView = new Set(Object.values(catalog.views).map((view) => view.targetId))
  const lights = new Map<string, Session[]>()
  for (const session of Object.values(catalog.sessions)) {
    const targetId = session.target.value
    if (session.supersededBy || session.imageType !== "light" || !targetId || withView.has(targetId)) continue
    lights.set(targetId, [...(lights.get(targetId) ?? []), session])
  }
  const targets: BoardRow[] = [...lights].flatMap(([targetId, sessions]) => {
    const target = catalog.targets[targetId]
    if (!target) return []
    return [
      {
        kind: "target",
        id: `target:${targetId}`,
        name: target.name,
        aliases: target.aliases.join(" "),
        sessions: sessions.length,
        needsReview: sessions.filter((s) => s.target.status === "needs-review" || s.equipment.status === "needs-review" || s.equipment.status === "unresolved").length,
        group: "unviewed",
      },
    ]
  })
  return [...views, ...targets]
}

function groupLabel(key: string, rows: BoardRow[]) {
  const stage = STAGES.find((s) => s.id === key)
  const count = key === "unviewed" ? plural(rows.length, "Target") : plural(rows.length, "View")
  const title = stage ? `${stage.n} ${stage.label}` : key === "done" ? "Every stage done" : "No View yet"
  return (
    <span className="flex items-center gap-2">
      <span>{title}</span>
      <span className="font-normal text-muted-foreground">{count}</span>
    </span>
  )
}

/**
 * One stage cell: glyph, then the short status. Below a 58rem board the
 * status folds into screen-reader text and the tooltip, so the lane still
 * reads as glyph shapes at 1024 px.
 */
function StageCell({ stage, lit }: { stage: Pick<Stage, "n" | "label" | "state" | "status">; lit: boolean }) {
  return (
    <span
      title={`${stage.n} ${stage.label}: ${GATE_LABEL[stage.state]} · ${stage.status}`}
      className={cn(
        "inline-flex h-5 items-center gap-1 rounded-[0.25rem] px-1 text-[0.6875rem] text-muted-foreground",
        lit && "bg-primary/14 font-medium text-foreground shadow-[inset_0_0_0_1px_color-mix(in_oklch,var(--primary)_55%,transparent)]",
      )}
    >
      <StageGlyph state={stage.state} />
      <span className="sr-only">{GATE_LABEL[stage.state]}: </span>
      <span className="sr-only @min-[58rem]:not-sr-only @min-[58rem]:whitespace-nowrap">{stage.status}</span>
      {lit ? <span className="sr-only"> (holds Next)</span> : null}
    </span>
  )
}

export function ViewsPage() {
  const state = useStore((s) => s)
  const follow = useFollowLink()
  const navigate = useNavigate()
  const [query, setQuery] = useState("")
  const rows = useMemo(() => boardRows(state), [state])
  const needle = query.trim().toLowerCase()
  const shown = rows.filter((row) =>
    (row.kind === "view" ? `${row.name} ${row.targetName ?? ""} ${row.projectName ?? ""}` : `${row.name} ${row.aliases}`).toLowerCase().includes(needle),
  )
  const viewCount = rows.filter((row) => row.kind === "view").length
  const stageColumns: Column<BoardRow>[] = STAGES.map((meta, index) => ({
    id: meta.id,
    header: `${meta.n} ${meta.label}`,
    className: "px-1",
    cell: (row) => {
      if (row.kind === "view") return <StageCell stage={row.pipeline.stages[index]!} lit={row.pipeline.next?.stage.id === meta.id} />
      if (meta.id === "library")
        return <StageCell stage={{ ...meta, state: row.needsReview > 0 ? "review" : "done", status: row.needsReview > 0 ? `${row.needsReview} to review` : plural(row.sessions, "session") }} lit={false} />
      if (meta.id === "select") return <StageCell stage={{ ...meta, state: "ready", status: "No View" }} lit />
      return null
    },
  }))
  const columns: Column<BoardRow>[] = [
    {
      id: "name",
      header: "View",
      rowHeader: true,
      sortValue: (r) => r.name,
      // Takes the free width and truncates, so the lane never pushes the pane sideways.
      className: "w-full max-w-0",
      cell: (r) =>
        r.kind === "view" ? (
          <span className="flex min-w-0 items-center gap-1" title={`${r.targetName ? `${r.targetName} › ` : ""}${r.name} · ${r.totals}`}>
            {r.targetName ? (
              <>
                <span className="shrink-0 text-muted-foreground">{r.targetName}</span>
                <ChevronRight aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
              </>
            ) : null}
            <Link to={(r.pipeline.next?.link.to ?? STAGE_AREA.select) as never} params={{ viewId: r.id } as never} className="truncate font-medium hover:underline">
              {r.name}
            </Link>
          </span>
        ) : (
          <Link to="/targets/$targetId" params={{ targetId: r.id.slice("target:".length) }} className="block truncate font-medium hover:underline">
            {r.name}
          </Link>
        ),
    },
    ...stageColumns,
    {
      id: "next",
      header: "Next",
      className: "pl-2",
      cell: (r) => {
        if (r.kind === "target") {
          const targetId = r.id.slice("target:".length)
          return (
            <Button size="xs" variant="outline" aria-label={`Create View: ${r.name}`} render={<Link to="/views/new" search={{ from: "target", targetId }} />}>
              Create View
            </Button>
          )
        }
        const next = r.pipeline.next
        if (!next) return <span className="text-[0.75rem] text-muted-foreground">Nothing left</span>
        return (
          <Button size="xs" variant="outline" title={next.reason} aria-label={`${next.label}: ${r.name}`} onClick={() => follow(next.link)}>
            <Play aria-hidden="true" data-icon="inline-start" className="fill-current" />
            {next.label}
          </Button>
        )
      },
    },
  ]
  const contextMenu = (r: BoardRow) => {
    if (r.kind === "target") {
      const targetId = r.id.slice("target:".length)
      return (
        <ContextMenuGroup>
          <ContextMenuLabel>{r.name}</ContextMenuLabel>
          <ContextMenuItem onClick={() => void navigate({ to: "/views/new", search: { from: "target", targetId } })}>Create View</ContextMenuItem>
          <ContextMenuSeparator />
          <ContextMenuItem onClick={() => void navigate({ to: "/targets/$targetId", params: { targetId } })}>Open Target</ContextMenuItem>
          <ContextMenuItem onClick={() => void navigate({ to: "/targets/$targetId/plan", params: { targetId } })}>Plan Target</ContextMenuItem>
        </ContextMenuGroup>
      )
    }
    const next = r.pipeline.next
    return (
      <ContextMenuGroup>
        <ContextMenuLabel>{r.name}</ContextMenuLabel>
        {next ? (
          <ContextMenuItem onClick={() => follow(next.link)}>
            <Play aria-hidden="true" className="fill-current" />
            Next: {next.label}
          </ContextMenuItem>
        ) : null}
        <ContextMenuSeparator />
        {r.pipeline.stages.map((stage) => (
          <ContextMenuItem key={stage.id} onClick={() => follow(stage.link)}>
            <StageGlyph state={stage.state} />
            <span className="min-w-0 flex-1 truncate">
              {stage.n} {stage.label}
            </span>
            <ContextMenuShortcut>{stage.status}</ContextMenuShortcut>
          </ContextMenuItem>
        ))}
        {r.targetId ? (
          <>
            <ContextMenuSeparator />
            <ContextMenuItem onClick={() => void navigate({ to: "/targets/$targetId", params: { targetId: r.targetId! } })}>Open Target {r.targetName}</ContextMenuItem>
            <ContextMenuItem onClick={() => void navigate({ to: "/targets/$targetId/plan", params: { targetId: r.targetId! } })}>Plan {r.targetName}</ContextMenuItem>
          </>
        ) : null}
      </ContextMenuGroup>
    )
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Pipeline"
        description={`${plural(viewCount, "View")} by the stage that holds its Next action. Targets with sessions but no View wait at the end.`}
        actions={
          <Button size="sm" render={<Link to="/views/new" />}>
            New View
          </Button>
        }
      />
      <PageBody className="@container">
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
            <TableToolbar search={{ label: "Filter the pipeline", placeholder: "Filter by View, Target or Project", value: query, onChange: setQuery }} />
            <DataTable
              label="Pipeline: Views by stage"
              rows={shown}
              columns={columns}
              getRowId={(r) => r.id}
              groups={{ key: (r) => r.group, label: groupLabel, compare: (a, b) => GROUP_ORDER.indexOf(a) - GROUP_ORDER.indexOf(b) }}
              contextMenu={contextMenu}
              empty={
                <EmptyState
                  icon={Layers}
                  title="Nothing on the board matches this filter"
                  description="The filter only changes this board."
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
    sessions: sessions.length > 0 ? "From Sessions" : "Standalone View",
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
