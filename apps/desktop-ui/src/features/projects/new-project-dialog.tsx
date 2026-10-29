/**
 * New Project… (065 PRJ-FR-01/02): a name, notes and the subjects it
 * collects for, each a saved Target. A search result that is not saved yet
 * is added to the library first (`targets_add`), so the Project names a
 * Target the library holds. Goals apply to every subject. Rigs can't be
 * chosen here yet: the library has no list of saved rigs (astro-plan-mts3e),
 * so Add rig stays visibly unavailable and a session that joins adds its rig.
 * Create Project opens the new Project.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { X } from "lucide-react"
import { useState } from "react"
import { type GoalInput, library, type TargetsSearchResult } from "@/api/ipc"
import { libraryQuery } from "@/api/query"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { BoxTable } from "@/components/app/box"
import { type GoalTemplateValue, GoalValuesEditor, fwhmBar } from "@/components/domain/goal-fields"
import type { Action } from "@/components/app/contracts"
import { TextAreaField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { TargetPicker, type TargetResultGroup, type TargetSource } from "@/components/app/pickers"
import { failureMessage } from "@/components/app/run-result"
import { projectWrite } from "./queries"

interface Subject {
  targetId: string
  name: string
}

/** One subject's goals from the editor's values: time or frames per channel, then the subject's quality bar once. */
export function goalInputs(targetId: string, values: readonly GoalTemplateValue[]): GoalInput[] {
  const amounts = values.flatMap((v): GoalInput[] =>
    v.integrationS !== null
      ? [{ targetId, kind: "integration", channel: v.channel, goalSeconds: v.integrationS }]
      : v.frameCount !== null
        ? [{ targetId, kind: "frame_count", channel: v.channel, goalFrames: v.frameCount }]
        : [],
  )
  const limits = values.map((v) => fwhmBar(v.qualityBar)).filter((x): x is number => x !== null)
  // Every goal counts Usable frames only (C7); a FWHM limit is the subject's one quality bar, the strictest one set.
  if (amounts.length === 0 || limits.length === 0) return amounts
  return [...amounts, { targetId, kind: "quality_bar", criterion: { criterion: "max_fwhm_median", maxArcsec: Math.min(...limits) } }]
}

function pickerSource(result: TargetsSearchResult): TargetSource {
  return result.source === "simbad" ? "simbad" : result.source === "catalogue" ? "catalogue" : "mine"
}

export function NewProjectDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  return open ? <NewProjectForm onClose={() => onOpenChange(false)} /> : null
}

function NewProjectForm({ onClose }: { onClose: () => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState("")
  const [notes, setNotes] = useState("")
  const [query, setQuery] = useState("")
  const [subjects, setSubjects] = useState<Subject[]>([])
  const [pickError, setPickError] = useState<string | null>(null)
  const [goals, setGoals] = useState<GoalTemplateValue[]>([])
  const text = query.trim()
  const search = useQuery({ ...libraryQuery("targetsSearch", text), enabled: text.length > 0 })
  const results = search.data?.results ?? []
  const groups: TargetResultGroup[] = (["mine", "catalogue", "simbad"] as const).map((source) => ({
    source,
    items: results
      .filter((r) => pickerSource(r) === source)
      .map((r) => ({ id: `${r.source}:${r.target.id}`, name: r.target.designation, detail: r.target.commonName ?? undefined, added: subjects.some((s) => s.targetId === r.target.id) })),
    status: source === "simbad" && search.isFetching ? "loading" : source === "simbad" && search.data?.simbad.state === "not_searched" ? "off" : undefined,
  }))
  const pick = async (optionId: string) => {
    const result = results.find((r) => `${r.source}:${r.target.id}` === optionId)
    if (!result) return
    setPickError(null)
    // A Project's subject is a saved Target: save a catalogue or SIMBAD result first.
    if (result.source === "my_targets" || result.source === "library") {
      setSubjects((was) => [...was, { targetId: result.target.id, name: result.target.designation }])
      return
    }
    const saved = await library.targetsAdd(result.source === "simbad" ? { source: "simbad", query: text } : { source: "seed", id: result.target.id })
    if (!saved.ok) {
      setPickError(failureMessage(m, saved.failure))
      return
    }
    setSubjects((was) => (was.some((s) => s.targetId === saved.data.candidate.id) ? was : [...was, { targetId: saved.data.candidate.id, name: saved.data.candidate.designation }]))
  }
  const label = m.newproject_create()
  const create: Action = {
    id: "create-project",
    label,
    kind: "primary",
    unavailable: name.trim() === "" ? { action: m.actions_blocked({ action: label }), reason: m.project_name_required(), blockers: [] } : undefined,
    run: async () => {
      const result = await projectWrite(client, () =>
        library.projectCreate(
          name.trim(),
          notes.trim() === "" ? null : notes.trim(),
          subjects.map((s) => ({ targetId: s.targetId })),
          [],
          subjects.flatMap((s) => goalInputs(s.targetId, goals)),
        ),
      )
      if (result.ok) void navigate({ to: "/projects/$projectId", params: { projectId: result.data.id } })
      return result
    },
  }
  return (
    <FormDialog open onOpenChange={(next) => !next && onClose()} title={m.newproject_title()} size="md" confirm={create}>
      <TextField label={m.newproject_field_name()} value={name} onChange={setName} placeholder={m.newproject_name_placeholder()} autoFocus required />
      <TargetPicker
        label={m.project_subjects()}
        query={query}
        onQueryChange={setQuery}
        groups={groups}
        onPick={(option) => void pick(option.id)}
        error={pickError ?? undefined}
        description={m.newproject_subjects_hint()}
      />
      {subjects.length > 0 ? (
        <BoxTable
          label={m.project_subjects()}
          rows={subjects}
          columns={[{ id: "subject", header: m.project_col_subject(), cell: (s) => s.name, sortValue: (s) => s.name, rowHeader: true, truncate: true }]}
          getRowId={(s) => s.targetId}
          rowLabel={(s) => s.name}
          rowActions={(s) => [{ id: "remove", label: m.project_remove_named({ name: s.name }), icon: X, run: () => setSubjects((was) => was.filter((x) => x.targetId !== s.targetId)) }]}
        />
      ) : null}
      <ActionButton action={{ id: "add-rig", label: m.project_add_rig(), unavailable: { action: m.actions_blocked({ action: m.project_add_rig() }), reason: m.newproject_rigs_unavailable(), blockers: [] }, run: () => undefined }} />
      <GoalValuesEditor values={goals} channels={[]} onChange={setGoals} />
      <TextAreaField label={m.newproject_notes()} value={notes} onChange={setNotes} />
    </FormDialog>
  )
}
