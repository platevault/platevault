/**
 * New Project (`/projects/new?targetId=`): name, notes, prefilled Target with
 * its framing source, mosaic panels, equipment for preselection, explicit
 * session linkage and an optional checklist. Creating it writes catalog goals
 * and associations only (J20 S2-S4; B2; PRJ-FR-01-05; PRJ-AC-01, -02).
 */
import { Link, useNavigate, useSearch } from "@tanstack/react-router"
import { useId, useRef, useState } from "react"
import { ActionError, Notice } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { formatDateTime } from "@/lib/format"
import type { SearchParams } from "@/routes"
import { nowIso, store, updateSlice, useStore } from "@/store/core"
import type { ProjectDraft } from "@/store/slices/t2"
import { createProject } from "../actions"
import { ChecklistEditor, LabeledSelect, PanelsEditor, SessionLinkPicker, TargetsEditor } from "../project-form"

const NONE = "none"

function freshDraft(targetId: string | undefined): ProjectDraft {
  const target = targetId ? store.getState().catalog.targets[targetId] : undefined
  return { name: "", notes: "", targetIds: target ? [target.id] : [], panels: [], equipmentId: null, linkedSessionIds: [], checklist: [], updatedAt: nowIso() }
}

export function ProjectNewPage() {
  const search = useSearch({ strict: false }) as SearchParams
  const navigate = useNavigate()
  const stored = useStore((s) => s.slices.t2.projectDraft)
  const trains = useStore((s) => s.catalog.opticalTrains)
  const hasTargets = useStore((s) => Object.keys(s.catalog.targets).length > 0)
  const [initial, setInitial] = useState(() => freshDraft(search.targetId))
  const [recovered, setRecovered] = useState(() => stored !== null)
  const draft = stored ?? initial
  const [submitted, setSubmitted] = useState(false)
  const [commitError, setCommitError] = useState<string | null>(null)
  const nameRef = useRef<HTMLInputElement>(null)
  const ids = { name: useId(), notes: useId(), targets: useId() }

  function update(patch: Partial<ProjectDraft>) {
    updateSlice("t2", (s) => ({ ...s, projectDraft: { ...(s.projectDraft ?? initial), ...patch, updatedAt: nowIso() } }))
  }

  function discard() {
    updateSlice("t2", (s) => ({ ...s, projectDraft: null }))
    setInitial(freshDraft(search.targetId))
    setRecovered(false)
    setSubmitted(false)
    setCommitError(null)
  }

  const errors = {
    name: draft.name.trim() ? null : "Enter a Project name.",
    targets: draft.targetIds.length + draft.panels.length > 0 ? null : "Add at least one Target or panel.",
  }

  function submit() {
    setSubmitted(true)
    if (errors.name || errors.targets) {
      if (errors.name) nameRef.current?.focus()
      else document.getElementById(ids.targets)?.focus()
      return
    }
    const result = createProject(draft)
    if (!result.ok) {
      setCommitError(result.message)
      return
    }
    updateSlice("t2", (s) => ({ ...s, projectDraft: null }))
    if (result.projectId) navigate({ to: "/projects/$projectId", params: { projectId: result.projectId } })
  }

  const trainItems = [{ value: NONE, label: "No equipment preference" }, ...Object.values(trains).map((t) => ({ value: t.id, label: t.name }))]
  const showName = submitted && errors.name
  const showTargets = submitted && errors.targets

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        eyebrow={
          <Link to="/projects" className="underline-offset-2 hover:underline">
            Projects
          </Link>
        }
        title="New Project"
        description="Creating a Project writes catalog goals and associations only. No file, View or quality decision changes."
      />
      <PageBody>
        {recovered && stored ? (
          <Notice
            tone="info"
            title="Recovered unsaved draft"
            actions={
              <Button size="sm" variant="outline" onClick={discard}>
                Discard draft
              </Button>
            }
          >
            This draft was last changed {formatDateTime(stored.updatedAt)}. It is kept in this browser until you create the Project or discard it.
          </Notice>
        ) : null}
        {!hasTargets ? (
          <Notice
            tone="info"
            title="No Target yet"
            actions={
              <Button size="sm" variant="outline" render={<Link to="/targets" />}>
                Go to Targets
              </Button>
            }
          >
            Add a Target on Targets, or define the framing with mosaic panels below.
          </Notice>
        ) : null}
        <form
          noValidate
          className="space-y-6"
          onSubmit={(event) => {
            event.preventDefault()
            submit()
          }}
        >
          <Section title="Details" id="details">
            <div className="grid max-w-2xl gap-4">
              <Field data-invalid={Boolean(showName) || undefined}>
                <FieldLabel htmlFor={ids.name}>Name</FieldLabel>
                <Input
                  ref={nameRef}
                  id={ids.name}
                  value={draft.name}
                  onChange={(e) => update({ name: e.target.value })}
                  aria-invalid={Boolean(showName) || undefined}
                  aria-describedby={showName ? `${ids.name}-error` : undefined}
                  autoComplete="off"
                  placeholder="e.g. NGC 7000 HOO"
                  className="max-w-sm"
                />
                <FieldError id={`${ids.name}-error`}>{showName ? errors.name : null}</FieldError>
              </Field>
              <Field>
                <FieldLabel htmlFor={ids.notes}>Notes</FieldLabel>
                <Textarea id={ids.notes} value={draft.notes} onChange={(e) => update({ notes: e.target.value })} rows={2} aria-describedby={`${ids.notes}-hint`} />
                <FieldDescription id={`${ids.notes}-hint`}>Optional.</FieldDescription>
              </Field>
            </div>
          </Section>

          <Section title="Targets and framing" id="targets" description="The framing comes from the first Target with coordinates, and names its source.">
            <div id={ids.targets} tabIndex={-1} className="outline-none">
              <TargetsEditor targetIds={draft.targetIds} onChange={(targetIds) => update({ targetIds })} error={showTargets ? (errors.targets ?? undefined) : undefined} errorId={`${ids.targets}-error`} />
            </div>
          </Section>

          <Section title="Mosaic panels" id="panels" description="Optional. User-defined panel footprints for a mosaic Project.">
            <PanelsEditor panels={draft.panels} onChange={(panels) => update({ panels })} checklist={draft.checklist} />
          </Section>

          <Section title="Equipment" id="equipment" description="Views created from this Project preselect sessions captured with this optical train.">
            <LabeledSelect
              label="Equipment for initial preselection"
              value={draft.equipmentId ?? NONE}
              items={trainItems}
              onChange={(value) => update({ equipmentId: value === NONE ? null : value })}
              className="w-80"
            />
          </Section>

          <Section
            title="Linked sessions"
            id="linked"
            description="Link sessions explicitly. Nothing is linked by proximity or a shared OBJECT label, and linking changes no file or quality decision."
          >
            <SessionLinkPicker selected={draft.linkedSessionIds} onChange={(linkedSessionIds) => update({ linkedSessionIds })} targetIds={draft.targetIds} />
          </Section>

          <Section title="Checklist" id="checklist" description="Optional goals. Progress shows captured, library-usable and Project-accepted totals separately.">
            <ChecklistEditor checklist={draft.checklist} onChange={(checklist) => update({ checklist })} panels={draft.panels} />
          </Section>

          {commitError ? <ActionError message={commitError} onRetry={submit} /> : null}
          <div className="flex flex-wrap justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                updateSlice("t2", (s) => ({ ...s, projectDraft: null }))
                navigate({ to: "/projects" })
              }}
            >
              Cancel
            </Button>
            <Button type="submit">Create Project</Button>
          </div>
        </form>
      </PageBody>
    </div>
  )
}
