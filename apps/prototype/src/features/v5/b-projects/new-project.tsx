/**
 * New Project (S4; FormDialog lg): name and notes, subjects found with the
 * TargetPicker across My targets, the catalogues and SIMBAD (D-W17), the
 * rigs (D-W37), and goals per channel, typed or prefilled from a goal
 * template through "Add goal ▾ › From template ▸" (D-W30, D-W47). The
 * template's conditions reach every subject (C7, `templateId`). A mosaic
 * subject is added on the Project page, in the mosaic editor, where the
 * rig's field of view lays out its panels.
 *
 * Opened with `openSheet({ kind: "new-project", fromSessionId?, targetId? })`:
 * a session prefills its Target and rig, a Target prefills itself as a
 * subject. Creating writes catalog records only: the Project and, for a
 * subject new to the library, its Target record (PRJ-FR-05). No run starts,
 * no file moves.
 */
import { useNavigate } from "@tanstack/react-router"
import { X } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { closeSheet, useShellUi } from "@/app/ui-state"
import { Box, BoxTable } from "@/components/app/box"
import type { Action, Blocker, Column } from "@/components/app/contracts"
import { Notice } from "@/components/app/feedback"
import { TextAreaField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { TargetPicker } from "@/components/app/pickers"
import { rigCameraKind } from "@/domain/derive"
import { BUILT_IN_GOAL_TEMPLATES } from "@/domain/templates"
import type { Catalog, GoalTemplate, GoalTemplateValue, OpticalTrain, OpticalTrainId } from "@/domain/types"
import type { Messages } from "@/lib/i18n"
import { createProject, prefillFromSession } from "@/store/actions/projects"
import { type CommitResult, store, useStore } from "@/store/core"
import { GoalValuesEditor } from "./goals"
import { projectChannels } from "./model"
import { pickFromTarget, type SubjectPick, useTargetSearch } from "./parts"
import { resolvePick } from "./subject-actions"

/** The dialog host the shell mounts: open while the shell's sheet is New Project; each opening starts fresh. */
export function NewProjectDialog() {
  const { sheet } = useShellUi()
  const open = sheet?.kind === "new-project"
  const [opening, setOpening] = useState({ open, count: 0 })
  if (opening.open !== open) setOpening({ open, count: open ? opening.count + 1 : opening.count })
  const prefill = sheet?.kind === "new-project" ? sheet : null
  return <NewProjectForm key={opening.count} open={open} fromSessionId={prefill?.fromSessionId} targetId={prefill?.targetId} />
}

function templates(catalog: Catalog): GoalTemplate[] {
  return [...BUILT_IN_GOAL_TEMPLATES, ...Object.values(catalog.goalTemplates)]
}

function templateLabel(m: Messages, template: GoalTemplate): string {
  return template.source === "user" ? m.newproject_template_yours({ name: template.name }) : template.name
}

function cameraWord(m: Messages, catalog: Catalog, rig: OpticalTrain): string {
  const kind = rigCameraKind(catalog, rig)
  return kind === "osc" ? m.project_camera_osc() : kind === "mono" ? m.project_camera_mono() : m.newproject_camera_unknown()
}

/** The subjects and rigs a session or a Target prefills; `unprefilled` when a session gave nothing. */
function initialDraft(fromSessionId: string | undefined, targetId: string | undefined) {
  const { catalog } = store.getState()
  const prefill = fromSessionId ? prefillFromSession(fromSessionId) : null
  const picks: SubjectPick[] = []
  for (const id of [...(prefill?.subjects.map((s) => s.targetId) ?? []), ...(targetId ? [targetId] : [])]) {
    const target = catalog.targets[id]
    if (target && !picks.some((p) => p.name === target.name)) picks.push(pickFromTarget(target))
  }
  return { name: prefill?.name ?? picks[0]?.name ?? "", picks, rigIds: prefill?.rigIds ?? [], unprefilled: Boolean(fromSessionId && !prefill) }
}

function NewProjectForm({ open, fromSessionId, targetId }: { open: boolean; fromSessionId?: string; targetId?: string }) {
  const m = useMessages()
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const [initial] = useState(() => initialDraft(fromSessionId, targetId))
  const [name, setName] = useState(initial.name)
  const [notes, setNotes] = useState("")
  const [picks, setPicks] = useState<SubjectPick[]>(initial.picks)
  const [rigIds, setRigIds] = useState<OpticalTrainId[]>(initial.rigIds)
  const [values, setValues] = useState<GoalTemplateValue[]>([])
  const [templateId, setTemplateId] = useState<string | null>(null)
  const search = useTargetSearch(picks.map((p) => p.name))
  const all = templates(catalog)
  const rigs = Object.values(catalog.opticalTrains).sort((a, b) => a.name.localeCompare(b.name))

  const missing: Blocker[] = [
    ...(name.trim() ? [] : [{ label: m.newproject_field_name() }]),
    ...(picks.length > 0 ? [] : [{ label: m.project_col_subject() }]),
    ...(rigIds.length > 0 ? [] : [{ label: m.project_col_rig() }]),
  ]

  /** A template prefills the goal values, which stay editable; its conditions go to every subject on create. */
  function applyTemplate(id: string) {
    const template = all.find((t) => t.id === id)
    if (!template) return
    setTemplateId(template.id)
    setValues(template.values.map((v) => ({ ...v })))
  }

  function create(): CommitResult {
    const subjects = []
    for (const pick of picks) {
      const resolved = resolvePick(pick)
      if (!resolved.ok) return { ok: false, reason: "write-failed", message: resolved.message }
      subjects.push({ targetId: resolved.targetId, mosaic: null })
    }
    const { result, projectId } = createProject({ name, notes, subjects, rigIds, goals: values, templateId })
    if (result.ok) void navigate({ to: "/projects/$projectId", params: { projectId } })
    return result
  }

  const label = m.newproject_create()
  const confirm: Action = {
    id: "new-project-create",
    label,
    kind: "primary",
    run: create,
    unavailable: missing.length > 0 ? { action: m.actions_blocked({ action: label }), reason: m.newproject_fields_missing({ count: missing.length }), blockers: missing } : undefined,
  }

  const subjectColumns: Column<SubjectPick>[] = [
    { id: "name", header: m.project_col_subject(), cell: (p) => p.name, sortValue: (p) => p.name, rowHeader: true },
    { id: "kind", header: m.project_col_kind(), cell: (p) => (p.kind === "new" ? m.newproject_new_target() : m.project_target_label()), sortValue: (p) => p.kind },
  ]
  const rigColumns: Column<OpticalTrain>[] = [
    { id: "name", header: m.project_col_rig(), cell: (r) => r.name, sortValue: (r) => r.name, rowHeader: true },
    { id: "camera", header: m.project_col_camera(), cell: (r) => cameraWord(m, catalog, r), sortValue: (r) => cameraWord(m, catalog, r) },
  ]

  return (
    <FormDialog open={open} onOpenChange={(next) => !next && closeSheet()} title={m.newproject_title()} size="lg" confirm={confirm}>
      {initial.unprefilled ? <Notice tone="info" title={m.newproject_nothing_prefilled()} /> : null}
      <TextField label={m.newproject_field_name()} value={name} onChange={setName} placeholder={m.newproject_name_placeholder()} required autoFocus />
      <TextAreaField label={m.newproject_notes()} value={notes} onChange={setNotes} rows={2} />
      <TargetPicker
        label={m.store_label_add_subject()}
        query={search.query}
        onQueryChange={search.setQuery}
        groups={search.groups}
        onPick={(option) => {
          const pick = search.pickOf(option)
          if (pick) setPicks((list) => (list.some((p) => p.name === pick.name) ? list : [...list, pick]))
        }}
      />
      <Box title={m.project_subjects()} count={picks.length} flush>
        <BoxTable
          label={m.project_subjects()}
          rows={picks}
          columns={subjectColumns}
          getRowId={(p) => p.name}
          rowLabel={(p) => p.name}
          rowActions={(p) => [{ id: "remove", label: m.project_remove(), icon: X, run: () => setPicks((list) => list.filter((x) => x.name !== p.name)) }]}
          empty={m.projects_no_subjects()}
        />
      </Box>
      <Box title={m.project_rigs()} count={rigIds.length} flush>
        <BoxTable
          label={m.project_rigs()}
          rows={rigs}
          columns={rigColumns}
          getRowId={(r) => r.id}
          selection={{ selected: rigIds, onChange: (ids) => setRigIds(ids as OpticalTrainId[]), rowLabel: (r) => r.name, countLabel: (count) => m.project_rigs_count({ count }) }}
          empty={m.equipment_no_rigs()}
        />
      </Box>
      <GoalValuesEditor values={values} channels={projectChannels(catalog, rigIds)} onChange={setValues} templates={{ items: all.map((t) => ({ id: t.id, label: templateLabel(m, t) })), apply: applyTemplate }} />
    </FormDialog>
  )
}
