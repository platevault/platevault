/**
 * Project (`/projects/$projectId`): checklist progress with captured,
 * library-usable and Project-accepted totals kept apart, explicit session
 * linkage with each session's own capture site, Targets, framing and panels,
 * Views and accepted products. Edits change catalog goals and associations
 * only, and Create View works with an unmet checklist (J20 S3-S8;
 * PRJ-FR-04, -06, -07, -08; PRJ-AC-03-08).
 */
import { Link, useParams } from "@tanstack/react-router"
import { Goal } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { PathText } from "@/components/app/data"
import { type Column, DataTable } from "@/components/app/data-table"
import { ActionError, EmptyState, UnknownValue } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Field, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { captureSite, type ChecklistProgress, MIN_FOOTPRINT_OVERLAP, projectProgress, viewStatus } from "@/domain/derive"
import type { Catalog, Project, SessionId } from "@/domain/types"
import { formatCount, formatDuration, formatExposure, plural } from "@/lib/format"
import { store, useStore } from "@/store/core"
import { type ProjectPatch, updateProject } from "../actions"
import { acceptedResultsForViews, checklistCriterion, sessionLabel, sessionRow, type SessionRow } from "../model"
import { AssociationBadge, FlowStatus, useCommitFlow } from "../parts"
import { AddChecklistItem, LabeledSelect, PanelsEditor, SessionLinkPicker, TargetsEditor } from "../project-form"

export function ProjectPage() {
  const { projectId = "" } = useParams({ strict: false }) as { projectId?: string }
  const exists = useStore((s) => Boolean(s.catalog.projects[projectId]))
  if (!exists) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="Project not found" />
        <PageBody>
          <EmptyState
            icon={Goal}
            titleAs="h2"
            title="This Project does not exist"
            description="It may come from an older prototype build or a reset. The library is unchanged."
            action={
              <Button size="sm" render={<Link to="/projects" />}>
                Go to Projects
              </Button>
            }
          />
        </PageBody>
      </div>
    )
  }
  return <ProjectDetail key={projectId} projectId={projectId} />
}

interface LinkedRow extends SessionRow {
  site: string | null
}

function ProjectDetail({ projectId }: { projectId: string }) {
  const project = useStore((s) => s.catalog.projects[projectId]!)
  const catalog = useStore((s) => s.catalog)
  const progress = useStore((s) => projectProgress(s.catalog, s.catalog.projects[projectId]!))
  const linked = useStore((s) =>
    s.catalog.projects[projectId]!.linkedSessionIds
      .map((id) => s.catalog.sessions[id])
      .filter((x) => x !== undefined)
      .map((session): LinkedRow => ({ ...sessionRow(s, session), site: captureSite(s.catalog, session)?.name ?? null })),
  )
  const flow = useCommitFlow()
  const [editOpen, setEditOpen] = useState(false)
  const [linkOpen, setLinkOpen] = useState(false)
  const views = Object.values(catalog.views).filter((v) => v.projectId === projectId)
  const products = acceptedResultsForViews(catalog, views)
  const train = project.equipmentId ? catalog.opticalTrains[project.equipmentId] : undefined
  const rejected = Object.keys(project.rejections).length

  const linkSessionsId = useId()
  const [linkageNote, setLinkageNote] = useState("")

  function edit(patch: ProjectPatch, what: string) {
    return flow.run(() => updateProject(projectId, patch, store.getState().catalog.projects[projectId]?.revision ?? project.revision, what))
  }

  /** Unlink, then keep focus in the table: the neighbouring Unlink, or Link sessions… after the last row (WCAG 2.4.3). */
  function unlink(button: HTMLElement, r: LinkedRow) {
    const row = button.closest("tr")
    const neighbour = (row?.nextElementSibling ?? row?.previousElementSibling)?.querySelector<HTMLElement>("[data-unlink]")
    const result = edit({ linkedSessionIds: project.linkedSessionIds.filter((id) => id !== r.session.id) }, "Session linkage")
    if (!result.ok) return
    ;(neighbour ?? document.getElementById(linkSessionsId))?.focus()
    setLinkageNote(`Unlinked ${r.label}.`)
  }

  const columns: Column<LinkedRow>[] = [
    {
      id: "session",
      header: "Session",
      rowHeader: true,
      sortValue: (r) => `${r.session.night}|${r.label}`,
      cell: (r) => (
        <Link to="/sessions/$sessionId" params={{ sessionId: r.session.id }} className="font-medium underline-offset-2 hover:underline">
          {r.label}
        </Link>
      ),
    },
    {
      id: "target",
      header: "Target",
      cell: (r) => (
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 whitespace-normal">
          {r.targetName}
          <AssociationBadge association={r.session.target} />
        </span>
      ),
    },
    {
      id: "frames",
      header: "Frames · integration",
      sortValue: (r) => r.breakdown.captured.seconds,
      cell: (r) => `${formatCount(r.session.assetIds.length)} · ${formatDuration(r.breakdown.captured.seconds)}`,
    },
    { id: "site", header: "Capture site", sortValue: (r) => r.site, cell: (r) => r.site ?? <UnknownValue reason="No saved site matches the header coordinates." /> },
    {
      id: "availability",
      header: "Availability",
      cell: (r) => (r.availability.offline > 0 ? <StatusBadge kind="availability" value="offline" /> : <span className="text-muted-foreground">Available</span>),
    },
    {
      id: "unlink",
      header: "Linkage",
      cell: (r) => (
        <Button size="sm" variant="ghost" data-unlink="" onClick={(event) => unlink(event.currentTarget, r)}>
          Unlink<span className="sr-only"> {r.label}</span>
        </Button>
      ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow={
          <Link to="/projects" className="underline-offset-2 hover:underline">
            Projects
          </Link>
        }
        title={project.name}
        description={project.notes || undefined}
        meta={<FlowStatus flow={flow} dirty={false} onReview={flow.reset} />}
        actions={
          <>
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              Edit details
            </Button>
            <Button render={<Link to="/views/new" search={{ from: "project", projectId }} />}>Create View</Button>
          </>
        }
      />
      <PageBody>
        <p className="text-sm text-muted-foreground">
          Edits change catalog goals and associations only. Files, quality decisions and existing View membership stay unchanged. An unmet checklist never
          blocks Create View, and a met one never closes the Project.
        </p>

        <Section
          id="checklist"
          title="Checklist progress"
          description={`Integration goals are met on Project-accepted time: library-Usable frames not rejected for this Project.${rejected > 0 ? ` ${plural(rejected, "frame")} rejected for this Project.` : ""}`}
        >
          {progress.length === 0 ? (
            <p className="text-sm text-muted-foreground">No checklist items. The Project works without them; add one below to track a goal.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {progress.map((p) => (
                <ChecklistRow
                  key={p.item.id}
                  progress={p}
                  catalog={catalog}
                  project={project}
                  onRemove={() => edit({ checklist: project.checklist.filter((i) => i.id !== p.item.id) }, "Checklist")}
                />
              ))}
            </ul>
          )}
          <div className="rounded-lg border p-3">
            <AddChecklistItem catalog={catalog} panels={project.panels} onAdd={(item) => edit({ checklist: [...project.checklist, item] }, "Checklist")} />
          </div>
        </Section>

        <Section
          id="linked"
          title={`Linked sessions (${linked.length})`}
          description="Linked explicitly. The Project has no capture site; each session keeps its own."
          actions={
            <Button id={linkSessionsId} size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
              Link sessions…
            </Button>
          }
        >
          <p role="status" className="sr-only">
            {linkageNote}
          </p>
          <DataTable
            label={`Sessions linked to ${project.name}`}
            rows={linked}
            columns={columns}
            getRowId={(r) => r.session.id}
            initialSort={{ columnId: "session", direction: "desc" }}
            scroll="none"
            empty={
              <EmptyState
                icon={Goal}
                title="No session is linked yet"
                description="Progress counts only sessions you link. Nothing is linked by proximity or a shared OBJECT label."
                action={
                  <Button size="sm" variant="outline" onClick={() => setLinkOpen(true)}>
                    Link sessions
                  </Button>
                }
              />
            }
          />
        </Section>

        <Section id="framing" title="Targets, framing and panels">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Targets</h3>
              <TargetsEditor targetIds={project.targetIds} onChange={(targetIds) => edit({ targetIds }, "Targets")} />
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Mosaic panels</h3>
              <PanelsEditor panels={project.panels} onChange={(panels) => edit({ panels }, "Panels")} checklist={project.checklist} />
            </div>
          </div>
          <p className="text-sm">
            <span className="text-muted-foreground">Equipment for preselection: </span>
            {train?.name ?? "None"}
          </p>
        </Section>

        <Section id="views" title="Views">
          {views.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No View yet.{" "}
              <Link to="/views/new" search={{ from: "project", projectId }} className="text-primary underline-offset-2 hover:underline">
                Create View
              </Link>{" "}
              starts one with this Project's context, even with an unmet checklist.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {views.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                  <Link to="/views/$viewId" params={{ viewId: v.id }} className="font-medium underline-offset-2 hover:underline">
                    {v.name}
                  </Link>
                  <StatusBadge kind="view" value={viewStatus(catalog, v)} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="products" title="Accepted products">
          {products.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accepted product yet. Results are accepted inside this Project's Views.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {products.map((r) => (
                <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-3 py-2 text-sm">
                  <div className="min-w-0">
                    <Link to="/views/$viewId/results" params={{ viewId: r.viewId }} className="font-medium underline-offset-2 hover:underline">
                      {r.path.slice(r.path.lastIndexOf("/") + 1)}
                    </Link>
                    <PathText path={r.path} className="text-muted-foreground" />
                  </div>
                  <span className="flex flex-wrap items-center gap-2">
                    <StatusBadge kind="lineage" value={r.lineage} />
                    {r.contentState === "drifted" ? <StatusBadge kind="content" value="drifted" /> : null}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      </PageBody>
      <EditDetailsDialog open={editOpen} onOpenChange={setEditOpen} project={project} />
      <LinkSessionsDialog open={linkOpen} onOpenChange={setLinkOpen} project={project} />
    </div>
  )
}

// ---------------------------------------------------------------------------
// Checklist progress (PRJ-FR-04, D10)
// ---------------------------------------------------------------------------

function ChecklistRow({ progress, catalog, project, onRemove }: { progress: ChecklistProgress; catalog: Catalog; project: Project; onRemove: () => void }) {
  const { item, totals } = progress
  const criterion = checklistCriterion(catalog, project, item)
  const evidence = progress.evidenceSessionIds.map((id) => catalog.sessions[id]).filter((s) => s !== undefined)
  const goal = item.kind === "integration" ? item.goalS : item.kind === "frame-count" ? item.goalFrames : 0
  const frames = item.kind === "frame-count"
  const value = (t: { frames: number; seconds: number }) => (frames ? plural(t.frames, "frame") : `${formatDuration(t.seconds)} (${plural(t.frames, "frame")})`)
  const measure = (t: { frames: number; seconds: number }) => (frames ? t.frames : t.seconds)
  const scale = totals ? Math.max(goal, measure(totals.captured), 1) : 1
  const pct = (n: number) => `${Math.min(100, (n / scale) * 100)}%`
  return (
    <li className="space-y-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{criterion}</h3>
        <div className="flex items-center gap-2">
          <StatusBadge kind="checklist" value={progress.state} />
          <Button size="sm" variant="ghost" onClick={onRemove}>
            Remove item<span className="sr-only"> {criterion}</span>
          </Button>
        </div>
      </div>
      {totals ? (
        <>
          <dl className="grid gap-x-6 gap-y-1 text-sm tabular-nums sm:grid-cols-3">
            <div>
              <dt className="text-xs text-muted-foreground">Captured</dt>
              <dd>{value(totals.captured)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Library-usable</dt>
              <dd>{value(totals.libraryUsable)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted-foreground">Project-accepted (goal basis)</dt>
              <dd>
                {value(totals.projectAccepted)} of {frames ? plural(goal, "frame") : formatDuration(goal)}
              </dd>
            </div>
          </dl>
          <div aria-hidden="true" className="relative flex h-2 overflow-hidden rounded-full bg-muted">
            <div className="h-full bg-primary" style={{ width: pct(measure(totals.projectAccepted)) }} />
            <div className="h-full bg-primary/35" style={{ width: pct(measure(totals.libraryUsable) - measure(totals.projectAccepted)) }} />
            <div className="h-full bg-foreground/20" style={{ width: pct(measure(totals.captured) - measure(totals.libraryUsable)) }} />
            <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `calc(${pct(goal)} - 1px)` }} />
          </div>
        </>
      ) : null}
      {item.kind === "panel-coverage" ? (
        <p className="text-sm">
          {progress.coverage === null ? (
            <UnknownValue label="Coverage unknown" reason={progress.reason ?? undefined} />
          ) : (
            `${Math.round(progress.coverage * 100)}% of the panel covered by linked footprints; met at ${Math.round(MIN_FOOTPRINT_OVERLAP * 100)}%. Prototype calculation.`
          )}
        </p>
      ) : null}
      {item.kind === "exposure" || item.kind === "equipment" || item.kind === "calibration" ? (
        <p className="text-sm text-pretty">
          <span className="text-muted-foreground">Evidence: </span>
          {evidence.length > 0
            ? `${item.kind === "exposure" ? `${formatExposure(item.exposureS)} in ` : ""}${plural(evidence.length, item.kind === "calibration" ? "raw calibration set" : "linked session")}: ${evidence.map((s) => sessionLabel(catalog, s)).join(", ")}`
            : progress.state === "met"
              ? "A matching adopted calibration master is in the library."
              : "None found"}
        </p>
      ) : null}
      {progress.reason && progress.state !== "met" ? (
        <p className="text-xs text-muted-foreground">
          {progress.state === "unknown" ? "Unknown: " : "Not met: "}
          {progress.reason}
        </p>
      ) : null}
    </li>
  )
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------

const NONE = "none"

function EditDetailsDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (open: boolean) => void; project: Project }) {
  const trains = useStore((s) => s.catalog.opticalTrains)
  const [name, setName] = useState(project.name)
  const [notes, setNotes] = useState(project.notes)
  const [equipmentId, setEquipmentId] = useState<string | null>(project.equipmentId)
  const [base, setBase] = useState(project.revision)
  const [nameError, setNameError] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = { name: useId(), notes: useId() }

  useEffect(() => {
    if (!open) return
    const current = store.getState().catalog.projects[project.id] ?? project
    setName(current.name)
    setNotes(current.notes)
    setEquipmentId(current.equipmentId)
    setBase(current.revision)
    setNameError(false)
    setError(null)
  }, [open])

  function save() {
    if (!name.trim()) {
      setNameError(true)
      return
    }
    const result = updateProject(project.id, { name: name.trim(), notes: notes.trim(), equipmentId }, base, "Project details")
    if (!result.ok) {
      setError(result.message)
      return
    }
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit {project.name}</DialogTitle>
          <DialogDescription>Changing the equipment affects only Views created later. Existing View membership stays as saved.</DialogDescription>
        </DialogHeader>
        <form
          noValidate
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault()
            save()
          }}
        >
          <Field data-invalid={nameError || undefined}>
            <FieldLabel htmlFor={ids.name}>Name</FieldLabel>
            <Input
              id={ids.name}
              value={name}
              onChange={(e) => {
                setName(e.target.value)
                setNameError(false)
              }}
              aria-invalid={nameError || undefined}
              aria-describedby={nameError ? `${ids.name}-error` : undefined}
              autoComplete="off"
            />
            <FieldError id={`${ids.name}-error`}>{nameError ? "Enter a Project name." : null}</FieldError>
          </Field>
          <Field>
            <FieldLabel htmlFor={ids.notes}>Notes</FieldLabel>
            <Textarea id={ids.notes} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
          </Field>
          <LabeledSelect
            label="Equipment for initial preselection"
            value={equipmentId ?? NONE}
            items={[{ value: NONE, label: "No equipment preference" }, ...Object.values(trains).map((t) => ({ value: t.id, label: t.name }))]}
            onChange={(value) => setEquipmentId(value === NONE ? null : value)}
            className="w-80"
          />
          {error ? <ActionError message={error} onRetry={save} /> : null}
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit">Save details</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

function LinkSessionsDialog({ open, onOpenChange, project }: { open: boolean; onOpenChange: (open: boolean) => void; project: Project }) {
  const [selected, setSelected] = useState<SessionId[]>(project.linkedSessionIds)
  const [base, setBase] = useState(project.revision)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    const current = store.getState().catalog.projects[project.id] ?? project
    setSelected(current.linkedSessionIds)
    setBase(current.revision)
    setError(null)
  }, [open])

  function save() {
    const result = updateProject(project.id, { linkedSessionIds: selected }, base, "Session linkage")
    if (!result.ok) {
      setError(result.message)
      return
    }
    onOpenChange(false)
  }

  const added = selected.filter((id) => !project.linkedSessionIds.includes(id)).length
  const removed = project.linkedSessionIds.filter((id) => !selected.includes(id)).length
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>Link sessions to {project.name}</DialogTitle>
          <DialogDescription>Only the sessions you check are linked. Linking changes no file, quality decision or View.</DialogDescription>
        </DialogHeader>
        <SessionLinkPicker selected={selected} onChange={setSelected} targetIds={project.targetIds} />
        {error ? <ActionError message={error} onRetry={save} /> : null}
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={save}>
            {added === 0 && removed === 0 ? "Save links" : `Save links (${[added ? `${added} added` : null, removed ? `${removed} removed` : null].filter(Boolean).join(", ")})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
