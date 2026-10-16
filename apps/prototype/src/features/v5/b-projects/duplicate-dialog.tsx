/**
 * Duplicate… (PRJ-FR-30, D-W112, PRJ-AC-43): a new open Project with the
 * parts the user ticks (each with how much it copies) and no files. The
 * copy is fully independent (no link back), reads each session's current
 * calibration pins rather than a Closed Project's frozen snapshot, which the
 * dialog says, and builds its own View on its first Apply. It is also how a
 * Closed Project's work goes on. The write is `duplicateProject`; on
 * success the new Project opens.
 */
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ChoiceListField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { isLocked } from "@/domain/derive"
import type { Project } from "@/domain/types"
import { type DuplicateChoice, duplicateProject } from "@/store/actions/projects"

type Part = Exclude<keyof DuplicateChoice, "name">

const PARTS: Part[] = ["sessions", "groups", "goals", "notes", "settings"]

export function DuplicateProjectDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const navigate = useNavigate()
  const fresh = (): { name: string; parts: Part[] } => ({ name: m.project_duplicate_name({ name: project.name }), parts: [...PARTS] })
  const [draft, setDraft] = useState(fresh)
  // Each opening starts from the Project as it is now, with every part ticked.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setDraft(fresh())
  }
  const partName: Record<Part, string> = {
    sessions: m.project_duplicate_part_count({ part: m.project_duplicate_part_sessions(), count: project.inputs.length }),
    groups: m.project_duplicate_part_count({ part: m.project_duplicate_part_groups(), count: project.groups.length }),
    goals: m.project_duplicate_part_count({ part: m.project_duplicate_part_goals(), count: project.goals.length }),
    notes: m.project_duplicate_part_notes(),
    settings: m.project_view_settings(),
  }
  const description = isLocked(project) ? `${m.project_duplicate_no_files()} ${m.project_duplicate_current_pins()}` : m.project_duplicate_no_files()
  const nameError = draft.name.trim() ? undefined : m.settings_name_required()
  const label = m.project_duplicate()
  const run = () => {
    const ticked = new Set(draft.parts)
    const { result, projectId } = duplicateProject(project.id, { name: draft.name, sessions: ticked.has("sessions"), groups: ticked.has("groups"), goals: ticked.has("goals"), notes: ticked.has("notes"), settings: ticked.has("settings") })
    if (result.ok && projectId) void navigate({ to: "/projects/$projectId", params: { projectId } })
    return result
  }
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.common_duplicate_title({ name: project.name })}
      size="sm"
      confirm={{ id: "project-duplicate", label, kind: "primary", run, unavailable: nameError ? { action: m.actions_blocked({ action: label }), reason: nameError, blockers: [] } : undefined }}
    >
      <TextField label={m.newproject_field_name()} value={draft.name} onChange={(name) => setDraft({ ...draft, name })} error={nameError} required autoFocus />
      <ChoiceListField
        label={m.project_duplicate_parts()}
        description={description}
        value={draft.parts}
        options={PARTS.map((part) => ({ value: part, label: partName[part] }))}
        onChange={(parts) => setDraft({ ...draft, parts: [...parts] })}
      />
    </FormDialog>
  )
}
