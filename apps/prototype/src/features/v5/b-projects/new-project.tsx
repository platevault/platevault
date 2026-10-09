/**
 * S4 New Project (sheet): name and notes, subjects searched across My
 * targets, the catalogues and SIMBAD (D-W17), rigs (D-W37) and a goal
 * template whose values are copied in and stay editable (D-W30, D-W47). A
 * mosaic subject is added on the Project page, in the mosaic editor, where
 * the rig's field of view lays out its panels. Opened with
 * `openSheet({ kind: "new-project", fromSessionId?, targetId? })`; a session
 * prefills its Target and rig, a Target prefills itself as a subject.
 * Creating writes catalog records only: the Project and, for a subject new to
 * the library, its Target record (PRJ-FR-05). No run starts, no file moves.
 */
import { useNavigate } from "@tanstack/react-router"
import { X } from "lucide-react"
import { useId, useState } from "react"
import { Notice } from "@/components/app/feedback"
import { Pill } from "@/components/app/pill"
import { Refusal } from "@/components/app/refusal"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Textarea } from "@/components/ui/textarea"
import { useMessages } from "@/app/preferences"
import { closeSheet, useShellUi } from "@/app/ui-state"
import { rigCameraKind } from "@/domain/derive"
import { BUILT_IN_GOAL_TEMPLATES } from "@/domain/templates"
import type { Catalog, GoalTemplate, GoalTemplateValue, OpticalTrainId } from "@/domain/types"
import { createProject, goalsFromTemplate, prefillFromSession, setGoals } from "@/store/actions/projects"
import { store, useStore } from "@/store/core"
import { SelectField } from "@/features/t3/fields"
import { GoalValuesEditor } from "./goals"
import { projectChannels } from "./model"
import { InlineError, type SubjectPick, SubjectSearch } from "./parts"
import { resolvePick } from "./subject-actions"

export function NewProjectSheet() {
  const { sheet } = useShellUi()
  const open = sheet?.kind === "new-project"
  // The form unmounts when the sheet closes, so each opening starts fresh; the key follows what it was opened with.
  const key = open ? `${sheet.fromSessionId ?? ""}|${sheet.targetId ?? ""}` : "closed"
  return (
    <Sheet open={open} onOpenChange={(next) => !next && closeSheet()}>
      <SheetContent side="right" className="w-[38rem] max-w-[92vw] gap-0" data-sheet="new-project">
        {open ? <NewProjectForm key={key} fromSessionId={sheet.fromSessionId} targetId={sheet.targetId} /> : null}
      </SheetContent>
    </Sheet>
  )
}

// ---------------------------------------------------------------------------
// Subject drafts (shared with Add subject and the mosaic editor)
// ---------------------------------------------------------------------------

export interface SubjectDraft {
  key: string
  pick: SubjectPick
}

export function draftFromPick(pick: SubjectPick): SubjectDraft {
  return { key: `${pick.kind}:${pick.name}`, pick }
}

export function draftFromTarget(catalog: Catalog, targetId: string): SubjectDraft | null {
  const target = catalog.targets[targetId]
  if (!target) return null
  return draftFromPick({ kind: "target", targetId: target.id, name: target.name, ra: target.ra, dec: target.dec, size: target.sizeDeg })
}

/** One chosen subject, with its remove button. */
export function SubjectDraftRow({ draft, onRemove }: { draft: SubjectDraft; onRemove: () => void }) {
  const m = useMessages()
  return (
    <li className="flex items-center gap-2 py-1.5">
      <span className="min-w-0 flex-1 truncate font-medium">{draft.pick.name}</span>
      {draft.pick.kind === "new" ? <Pill tone="info">{m.newproject_new_target()}</Pill> : null}
      <Button size="icon-sm" variant="ghost" aria-label={m.project_remove_named({ name: draft.pick.name })} onClick={onRemove}>
        <X aria-hidden="true" />
      </Button>
    </li>
  )
}

// ---------------------------------------------------------------------------
// The form
// ---------------------------------------------------------------------------

function templates(catalog: Catalog): GoalTemplate[] {
  return [...BUILT_IN_GOAL_TEMPLATES, ...Object.values(catalog.goalTemplates)]
}

function NewProjectForm({ fromSessionId, targetId }: { fromSessionId?: string; targetId?: string }) {
  const m = useMessages()
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const [initial] = useState(() => {
    const state = store.getState()
    const prefill = fromSessionId ? prefillFromSession(fromSessionId) : null
    const drafts: SubjectDraft[] = []
    for (const id of [...(prefill?.subjects.map((s) => s.targetId) ?? []), ...(targetId ? [targetId] : [])]) {
      const draft = draftFromTarget(state.catalog, id)
      if (draft && !drafts.some((d) => d.key === draft.key)) drafts.push(draft)
    }
    return { name: prefill?.name ?? (drafts[0] ? drafts[0].pick.name : ""), drafts, rigIds: prefill?.rigIds ?? [], unprefilled: Boolean(fromSessionId && !prefill) }
  })
  const [name, setName] = useState(initial.name)
  const [notes, setNotes] = useState("")
  const [drafts, setDrafts] = useState<SubjectDraft[]>(initial.drafts)
  const [rigIds, setRigIds] = useState<OpticalTrainId[]>(initial.rigIds)
  const [templateId, setTemplateId] = useState<string>("none")
  const [values, setValues] = useState<GoalTemplateValue[]>([])
  const [edited, setEdited] = useState(false)
  const [problems, setProblems] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const ids = { name: useId(), notes: useId(), rigs: useId() }
  const all = templates(catalog)
  const template = all.find((t) => t.id === templateId)
  const rigs = Object.values(catalog.opticalTrains).sort((a, b) => a.name.localeCompare(b.name))
  const channels = projectChannels(catalog, rigIds)

  function chooseTemplate(id: string) {
    setTemplateId(id)
    setValues(all.find((t) => t.id === id)?.values.map((v) => ({ ...v })) ?? [])
    setEdited(false)
  }

  function create() {
    const found = [...(name.trim() ? [] : [m.newproject_field_name()]), ...(drafts.length > 0 ? [] : [m.project_col_subject()]), ...(rigIds.length > 0 ? [] : [m.project_col_rig()])]
    setProblems(found)
    if (found.length > 0) return
    const subjects = []
    for (const draft of drafts) {
      const resolved = resolvePick(draft.pick)
      if (!resolved.ok) {
        setError(resolved.message)
        return
      }
      subjects.push({ targetId: resolved.targetId, mosaic: null })
    }
    const { result, projectId } = createProject({ name, notes, subjects, rigIds, goalTemplateId: template?.id ?? null })
    if (!result.ok) {
      setError(result.message)
      return
    }
    if (template && edited) {
      const project = store.getState().catalog.projects[projectId]!
      const copy = { ...template, values }
      const goals = setGoals(projectId, project.subjects.flatMap((s) => goalsFromTemplate(copy, s)), project.revision)
      if (!goals.ok) setError(m.newproject_goals_not_saved({ message: goals.message }))
    }
    closeSheet()
    void navigate({ to: "/projects/$projectId", params: { projectId } })
  }

  return (
    <>
      <SheetHeader className="border-b border-separator">
        <SheetTitle>{m.newproject_title()}</SheetTitle>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
        {initial.unprefilled ? <Notice tone="info" title={m.newproject_nothing_prefilled()} /> : null}
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={ids.name}>{m.newproject_field_name()}</Label>
            <Input id={ids.name} value={name} onChange={(event) => setName(event.target.value)} placeholder={m.newproject_name_placeholder()} />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.notes}>
              {m.newproject_notes()} <span className="font-normal text-muted-foreground">{m.newproject_optional()}</span>
            </Label>
            <Textarea id={ids.notes} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
        </div>

        <section aria-labelledby="np-subjects" className="space-y-2">
          <h3 id="np-subjects" className="text-sm font-semibold">
            {m.project_subjects()}
          </h3>
          {drafts.length > 0 ? (
            <ul className="divide-y divide-separator rounded-md border border-border px-3">
              {drafts.map((draft) => (
                <SubjectDraftRow key={draft.key} draft={draft} onRemove={() => setDrafts((list) => list.filter((d) => d.key !== draft.key))} />
              ))}
            </ul>
          ) : null}
          <SubjectSearch taken={drafts.map((d) => d.pick.name)} onPick={(pick) => setDrafts((list) => (list.some((d) => d.pick.name === pick.name) ? list : [...list, draftFromPick(pick)]))} />
        </section>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">{m.project_rigs()}</legend>
          <ul className="divide-y divide-separator rounded-md border border-border">
            {rigs.map((rig) => {
              const id = `${ids.rigs}-${rig.id}`
              const kind = rigCameraKind(catalog, rig)
              return (
                <li key={rig.id} className="flex items-center gap-2 px-3 py-1.5">
                  <Checkbox id={id} checked={rigIds.includes(rig.id)} onCheckedChange={(checked) => setRigIds((list) => (checked ? [...list, rig.id] : list.filter((r) => r !== rig.id)))} />
                  <Label htmlFor={id} className="min-w-0 flex-1 font-normal">
                    <span className="font-medium">{rig.name}</span>
                  </Label>
                  <Pill tone="muted">{kind === "osc" ? m.project_camera_osc() : kind === "mono" ? m.project_camera_mono() : m.newproject_camera_unknown()}</Pill>
                </li>
              )
            })}
          </ul>
        </fieldset>

        <section aria-labelledby="np-goals" className="space-y-2">
          <h3 id="np-goals" className="text-sm font-semibold">
            {m.projects_col_goals()}
          </h3>
          <SelectField
            label={m.newproject_template()}
            value={templateId}
            onChange={chooseTemplate}
            options={[{ value: "none", label: m.newproject_template_none() }, ...all.map((t) => ({ value: t.id, label: t.source === "user" ? m.newproject_template_yours({ name: t.name }) : t.name }))]}
          />
          {template ? (
            <GoalValuesEditor
              values={values}
              channels={channels}
              onChange={(next) => {
                setValues(next)
                setEdited(true)
              }}
            />
          ) : null}
          {template && drafts.length > 0 ? <p className="text-xs text-muted-foreground tabular-nums">{m.project_goals_count({ count: drafts.length * values.length })}</p> : null}
        </section>
      </div>
      <SheetFooter className="border-t border-separator">
        {problems.length > 0 ? <Refusal action={m.newproject_refusal()} reason={m.newproject_fields_missing({ count: problems.length })} blockers={problems.map((label) => ({ label }))} /> : null}
        <InlineError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={closeSheet}>
            {m.verb_cancel()}
          </Button>
          <Button onClick={create}>{m.newproject_create()}</Button>
        </div>
      </SheetFooter>
    </>
  )
}
