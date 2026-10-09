/**
 * S4 New Project (sheet): name and notes, subjects searched across My
 * targets, the catalogues and SIMBAD (D-W17), each optionally a mosaic with
 * explicit panels (D-W9, D-W38), rigs (D-W37) and a goal template whose
 * values are copied in and stay editable (D-W30, D-W47). Opened with
 * `openSheet({ kind: "new-project", fromSessionId?, targetId? })`; a session
 * prefills its Target and rig, a Target prefills itself as a subject.
 * Creating writes catalog records only: the Project and, for a subject new to
 * the library, its Target record (PRJ-FR-05). No run starts, no file moves.
 */
import { useNavigate } from "@tanstack/react-router"
import { X } from "lucide-react"
import { useId, useState } from "react"
import { Notice } from "@/components/app/feedback"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { closeSheet, useShellUi } from "@/app/ui-state"
import { rigCameraKind, rigFieldOfView } from "@/domain/derive"
import { BUILT_IN_GOAL_TEMPLATES } from "@/domain/templates"
import type { Catalog, GoalTemplate, GoalTemplateValue, OpticalTrainId, Subject } from "@/domain/types"
import { formatDegrees, plural } from "@/lib/format"
import { createProject, goalsFromTemplate, prefillFromSession, setGoals } from "@/store/actions/projects"
import { store, useStore } from "@/store/core"
import { SelectField } from "@/features/t3/fields"
import { addTarget } from "@/store/actions/library"
import { projectChannels } from "./model"
import { InlineError, layoutPanels, type MosaicDraft, PanelsEditor, type SubjectPick, SubjectSearch } from "./parts"

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
// Subject drafts (shared with Add subject on the Project page)
// ---------------------------------------------------------------------------

export interface SubjectDraft {
  key: string
  pick: SubjectPick
  mosaic: MosaicDraft | null
}

export function draftFromPick(pick: SubjectPick): SubjectDraft {
  return { key: `${pick.kind}:${pick.name}`, pick, mosaic: null }
}

export function draftFromTarget(catalog: Catalog, targetId: string): SubjectDraft | null {
  const target = catalog.targets[targetId]
  if (!target) return null
  return draftFromPick({ kind: "target", targetId: target.id, name: target.name, ra: target.ra, dec: target.dec, size: target.sizeDeg })
}

/** Why a subject draft cannot be saved yet, or null. */
export function draftProblem(draft: SubjectDraft): string | null {
  if (!draft.mosaic) return null
  if (!draft.mosaic.name.trim()) return `${draft.pick.name}: name the mosaic.`
  if (draft.mosaic.panels.length < 2) return `${draft.mosaic.name}: a mosaic needs two or more panels.`
  return null
}

/** Resolves a draft to a subject input, creating the Target record of a new object first. */
export function resolveDraft(draft: SubjectDraft): { ok: true; targetId: string; mosaic: Subject["mosaic"] } | { ok: false; message: string } {
  let targetId: string | null = draft.pick.kind === "target" ? draft.pick.targetId : null
  if (draft.pick.kind === "new") {
    const added = addTarget(draft.pick.entry, { resolver: draft.pick.resolver, favourite: false })
    if (!added.result.ok) return { ok: false, message: added.result.message }
    targetId = added.targetId
  }
  if (!targetId) return { ok: false, message: `${draft.pick.name} could not be added as a Target.` }
  const mosaic = draft.mosaic
    ? { name: draft.mosaic.name.trim(), centre: draft.mosaic.centre, panels: draft.mosaic.panels.map((p, i) => ({ id: p.id, n: i + 1, ra: p.ra, dec: p.dec, rotationDeg: p.rotationDeg })) }
    : null
  return { ok: true, targetId, mosaic }
}

/** One chosen subject: Target or mosaic, with the panel editor when it is a mosaic. */
export function SubjectDraftRow({ draft, rigIds, onChange, onRemove }: { draft: SubjectDraft; rigIds: OpticalTrainId[]; onChange: (next: SubjectDraft) => void; onRemove?: () => void }) {
  const catalog = useStore((s) => s.catalog)
  const switchId = useId()
  const rig = rigIds.map((id) => catalog.opticalTrains[id]).find((r) => r !== undefined)
  const fov = rig ? rigFieldOfView(catalog, rig) : null
  const canMosaic = draft.pick.ra !== null && draft.pick.dec !== null
  return (
    <li className="space-y-2 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 flex-1 font-medium">
          {draft.mosaic ? draft.mosaic.name || `${draft.pick.name} mosaic` : draft.pick.name}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {draft.mosaic ? `Mosaic of ${draft.pick.name} · ${plural(draft.mosaic.panels.length, "panel")}` : "Target"}
            {draft.pick.kind === "new" ? (draft.pick.resolver ? ` · new Target from ${draft.pick.resolver}` : " · new Target from the catalogue") : ""}
          </span>
        </span>
        <div className="flex items-center gap-2">
          <Switch
            id={switchId}
            checked={draft.mosaic !== null}
            disabled={!canMosaic}
            onCheckedChange={(checked) =>
              onChange({
                ...draft,
                mosaic:
                  checked && draft.pick.ra !== null && draft.pick.dec !== null
                    ? { name: `${draft.pick.name} mosaic`, centre: { ra: draft.pick.ra, dec: draft.pick.dec }, panels: layoutPanels({ ra: draft.pick.ra, dec: draft.pick.dec }, 2, 1, fov, draft.pick.size) }
                    : null,
              })
            }
          />
          <Label htmlFor={switchId}>Mosaic</Label>
        </div>
        {onRemove ? (
          <Button size="sm" variant="ghost" onClick={onRemove}>
            <X aria-hidden="true" data-icon="inline-start" />
            Remove<span className="sr-only"> {draft.pick.name}</span>
          </Button>
        ) : null}
      </div>
      {!canMosaic ? <p className="text-xs text-muted-foreground">Position unknown, so it cannot be a mosaic: panels are set by centre.</p> : null}
      {draft.mosaic ? (
        <PanelsEditor
          mosaic={draft.mosaic}
          onChange={(mosaic) => onChange({ ...draft, mosaic })}
          fov={fov}
          size={draft.pick.size}
          fovLabel={fov && rig ? `the ${rig.name} field (${formatDegrees(fov.widthDeg, 2)} × ${formatDegrees(fov.heightDeg, 2)})` : "the Target's size (no rig with a known field chosen)"}
        />
      ) : null}
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
    return { name: prefill?.name ?? (drafts[0] ? drafts[0].pick.name : ""), drafts, rigIds: prefill?.rigIds ?? [], note: fromSessionId && !prefill ? "That session has no confirmed Target, so nothing was prefilled." : null }
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
    const found = [
      ...(name.trim() ? [] : ["Name the Project."]),
      ...(drafts.length > 0 ? [] : ["Add at least one subject."]),
      ...(rigIds.length > 0 ? [] : ["Choose at least one rig: each run uses one of them."]),
      ...drafts.map(draftProblem).filter((p): p is string => p !== null),
    ]
    setProblems(found)
    if (found.length > 0) return
    const subjects = []
    for (const draft of drafts) {
      const resolved = resolveDraft(draft)
      if (!resolved.ok) {
        setError(resolved.message)
        return
      }
      subjects.push({ targetId: resolved.targetId, mosaic: resolved.mosaic })
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
      if (!goals.ok) setError(`The Project was created, but the edited goal values were not saved: ${goals.message}`)
    }
    closeSheet()
    void navigate({ to: "/projects/$projectId", params: { projectId } })
  }

  return (
    <>
      <SheetHeader className="border-b border-separator">
        <SheetTitle>New Project</SheetTitle>
        <SheetDescription>A campaign: subjects, the rigs taking part and goals. Creating it writes only catalog records; no run starts and no file moves.</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
        {initial.note ? <Notice tone="info" title="Nothing prefilled">{initial.note}</Notice> : null}
        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor={ids.name}>Name</Label>
            <Input id={ids.name} value={name} onChange={(event) => setName(event.target.value)} placeholder="Cygnus HOO 2026" />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor={ids.notes}>
              Notes <span className="font-normal text-muted-foreground">(optional)</span>
            </Label>
            <Textarea id={ids.notes} rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
        </div>

        <section aria-labelledby="np-subjects" className="space-y-2">
          <h3 id="np-subjects" className="text-sm font-semibold">
            Subjects
          </h3>
          <p className="text-xs text-muted-foreground">A Target or a mosaic, with no limit on how far apart. Each run takes exactly one subject.</p>
          {drafts.length > 0 ? (
            <ul className="divide-y divide-separator rounded-md border px-3">
              {drafts.map((draft) => (
                <SubjectDraftRow
                  key={draft.key}
                  draft={draft}
                  rigIds={rigIds}
                  onChange={(next) => setDrafts((list) => list.map((d) => (d.key === draft.key ? next : d)))}
                  onRemove={() => setDrafts((list) => list.filter((d) => d.key !== draft.key))}
                />
              ))}
            </ul>
          ) : null}
          <SubjectSearch taken={drafts.map((d) => d.pick.name)} onPick={(pick) => setDrafts((list) => (list.some((d) => d.pick.name === pick.name) ? list : [...list, draftFromPick(pick)]))} />
        </section>

        <fieldset className="space-y-2">
          <legend className="text-sm font-semibold">Rigs</legend>
          <p className="text-xs text-muted-foreground">Every rig taking part. Candidates are sessions of a subject on one of these rigs; each run uses exactly one (D-W37).</p>
          <ul className="divide-y divide-separator rounded-md border">
            {rigs.map((rig) => {
              const id = `${ids.rigs}-${rig.id}`
              const kind = rigCameraKind(catalog, rig)
              return (
                <li key={rig.id} className="flex items-center gap-2 px-3 py-1.5">
                  <Checkbox id={id} checked={rigIds.includes(rig.id)} onCheckedChange={(checked) => setRigIds((list) => (checked ? [...list, rig.id] : list.filter((r) => r !== rig.id)))} />
                  <Label htmlFor={id} className="min-w-0 flex-1 font-normal">
                    <span className="font-medium">{rig.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {kind === "osc" ? "OSC" : kind === "mono" ? "Mono" : "Camera unknown"} · {rig.filters.map((f) => f.name).join(", ") || "no filters"}
                    </span>
                  </Label>
                </li>
              )
            })}
          </ul>
        </fieldset>

        <section aria-labelledby="np-goals" className="space-y-2">
          <h3 id="np-goals" className="text-sm font-semibold">
            Goal template
          </h3>
          <SelectField
            label="Template"
            value={templateId}
            onChange={chooseTemplate}
            options={[{ value: "none", label: "No template: set goals later" }, ...all.map((t) => ({ value: t.id, label: `${t.name}${t.source === "user" ? " (yours)" : ""}` }))]}
            description="Its values are copied into the Project for every subject and mosaic panel. The copy stands alone: editing the template later changes no Project."
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
          {template && drafts.length > 0 ? (
            <p className="text-xs text-muted-foreground">
              Creates {plural(drafts.reduce((n, d) => n + (d.mosaic ? d.mosaic.panels.length : 1), 0) * values.length, "goal")}: {values.map((v) => v.channel).join(", ") || "none"} per subject
              {drafts.some((d) => d.mosaic) ? " and per mosaic panel" : ""}.
            </p>
          ) : null}
        </section>
      </div>
      <SheetFooter className="border-t border-separator">
        {problems.length > 0 ? (
          <Notice tone="refusal" title="Not created yet">
            <ul className="list-disc pl-4">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </Notice>
        ) : null}
        <InlineError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={closeSheet}>
            Cancel
          </Button>
          <Button onClick={create}>Create Project</Button>
        </div>
      </SheetFooter>
    </>
  )
}

/** Copied template values: hours and frame count per channel, editable; channels can be removed or added. */
export function GoalValuesEditor({ values, channels, onChange }: { values: GoalTemplateValue[]; channels: string[]; onChange: (next: GoalTemplateValue[]) => void }) {
  const [adding, setAdding] = useState("")
  const free = channels.filter((c) => !values.some((v) => v.channel === c))
  const update = (index: number, patch: Partial<GoalTemplateValue>) => onChange(values.map((v, i) => (i === index ? { ...v, ...patch } : v)))
  return (
    <div className="space-y-2">
      <table className="w-full text-sm">
        <caption className="sr-only">Goal values copied in</caption>
        <thead className="text-[0.6875rem] text-muted-foreground" data-chrome>
          <tr className="border-b">
            <th scope="col" className="py-1 pr-2 text-left font-medium">
              Channel
            </th>
            <th scope="col" className="py-1 pr-2 text-left font-medium">
              Integration (h)
            </th>
            <th scope="col" className="py-1 pr-2 text-left font-medium">
              Frames
            </th>
            <th scope="col" className="py-1 text-right font-medium">
              <span className="sr-only">Remove</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {values.map((value, index) => (
            <tr key={value.channel} className="border-b last:border-0">
              <th scope="row" className="py-1 pr-2 text-left font-medium">
                {value.channel}
              </th>
              <td className="py-1 pr-2">
                <Input
                  aria-label={`${value.channel} integration in hours`}
                  type="number"
                  min={0}
                  step={0.5}
                  className="h-6 w-24 tabular-nums"
                  value={value.integrationS === null ? "" : String(value.integrationS / 3600)}
                  onChange={(event) => update(index, { integrationS: event.target.value === "" ? null : Math.round(Number(event.target.value) * 3600) })}
                />
              </td>
              <td className="py-1 pr-2">
                <Input
                  aria-label={`${value.channel} frame count`}
                  type="number"
                  min={0}
                  step={1}
                  className="h-6 w-24 tabular-nums"
                  value={value.frameCount === null ? "" : String(value.frameCount)}
                  onChange={(event) => update(index, { frameCount: event.target.value === "" ? null : Math.round(Number(event.target.value)) })}
                />
              </td>
              <td className="py-1 text-right">
                <Button size="sm" variant="ghost" onClick={() => onChange(values.filter((_, i) => i !== index))}>
                  Remove<span className="sr-only"> {value.channel}</span>
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {values.length === 0 ? <p className="text-xs text-muted-foreground">No channels: the Project starts without goals.</p> : null}
      {free.length > 0 ? (
        <div className="flex items-end gap-2">
          <SelectField className="w-48" label="Add channel" value={adding || free[0]!} onChange={setAdding} options={free.map((c) => ({ value: c, label: c }))} />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              const channel = adding && free.includes(adding) ? adding : free[0]!
              onChange([...values, { channel, integrationS: 10 * 3600, frameCount: null }])
              setAdding("")
            }}
          >
            Add
          </Button>
        </div>
      ) : null}
    </div>
  )
}
