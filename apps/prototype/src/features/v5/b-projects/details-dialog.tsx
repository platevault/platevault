/**
 * Edit… (B §2, Q2): a Project's name and notes in one FormDialog, from the
 * Project menu and the Projects row menu. The write is
 * `updateProjectDetails`, guarded by the Project's revision; a refused or
 * stale write keeps the dialog open with its message.
 */
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { TextAreaField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import type { Project } from "@/domain/types"
import { updateProjectDetails } from "@/store/actions/projects"

export function ProjectDetailsDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const [draft, setDraft] = useState({ name: project.name, notes: project.notes })
  // Each opening starts from the Project as it is now.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setDraft({ name: project.name, notes: project.notes })
  }
  const nameError = draft.name.trim() ? undefined : m.settings_name_required()
  const label = m.settings_save()
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.settings_edit_title({ name: project.name })}
      size="sm"
      confirm={{
        id: "project-edit-save",
        label,
        kind: "primary",
        run: () => updateProjectDetails(project.id, draft, project.revision),
        unavailable: nameError ? { action: m.actions_blocked({ action: label }), reason: nameError, blockers: [] } : undefined,
      }}
    >
      <TextField label={m.newproject_field_name()} value={draft.name} onChange={(name) => setDraft({ ...draft, name })} error={nameError} required autoFocus />
      <TextAreaField label={m.newproject_notes()} value={draft.notes} onChange={(notes) => setDraft({ ...draft, notes })} />
    </FormDialog>
  )
}
