/**
 * Edit… (065 PRJ-FR-01): the Project's name and notes, written against the
 * record's revision. It needs the full record, which the Project page reads
 * through `useProjectRecord`; the page keeps Edit… unavailable until it can.
 */
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { library, type Project } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import type { Action } from "@/components/app/contracts"
import { TextAreaField, TextField } from "@/components/app/fields"
import { toast } from "@/components/app/feedback"
import { FormDialog } from "@/components/app/form-dialog"
import { failureMessage } from "@/components/app/run-result"
import { type ProjectHeader, projectWrite, useProjectRecord } from "./queries"

export function ProjectDetailsDialog({ header, open, onOpenChange }: { header: ProjectHeader; open: boolean; onOpenChange: (open: boolean) => void }) {
  const record = useProjectRecord(header.id)
  return open && record.state === "ready" ? <DetailsForm project={record.project} onClose={() => onOpenChange(false)} /> : null
}

function DetailsForm({ project, onClose }: { project: Project; onClose: () => void }) {
  const m = useMessages()
  const client = useQueryClient()
  // The edit is of the record the dialog opened on: a re-read underneath it never moves the revision it sends.
  const [{ id, revision }] = useState(project)
  const [name, setName] = useState(project.name)
  const [notes, setNotes] = useState(project.notes ?? "")
  const label = m.settings_save()
  const confirm: Action = {
    id: "save-project",
    label,
    kind: "primary",
    unavailable: name.trim() === "" ? { action: m.actions_blocked({ action: label }), reason: m.project_name_required(), blockers: [] } : undefined,
    run: async () => {
      const result = await projectWrite(client, () => library.projectUpdate(id, revision, name.trim(), notes.trim() === "" ? null : notes))
      // A stale edit is never sent again on the new revision: the dialog closes on the re-read and says why.
      if (!result.ok && result.failure.source === "library" && result.failure.error.code === "conflict") {
        toast({ message: failureMessage(m, result.failure) })
        onClose()
      }
      return result
    },
  }
  return (
    <FormDialog open onOpenChange={(next) => !next && onClose()} title={m.project_edit()} size="md" confirm={confirm}>
      <TextField label={m.newproject_field_name()} value={name} onChange={setName} autoFocus required />
      <TextAreaField label={m.newproject_notes()} value={notes} onChange={setNotes} />
    </FormDialog>
  )
}
