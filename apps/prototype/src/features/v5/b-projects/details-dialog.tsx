/**
 * Edit details (round 6): a Project's name and notes, from the Project
 * header and the Projects row menu. The write is `updateProjectDetails`,
 * guarded by the Project's revision; a refused or stale write keeps the
 * dialog open with its message beside the fields.
 */
import { type FormEvent, useEffect, useId, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionError } from "@/components/app/feedback"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import type { Project } from "@/domain/types"
import { updateProjectDetails } from "@/store/actions/projects"

export function ProjectDetailsDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const [name, setName] = useState(project.name)
  const [notes, setNotes] = useState(project.notes)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  useEffect(() => {
    if (!open) return
    setName(project.name)
    setNotes(project.notes)
    setError(null)
  }, [open, project.name, project.notes])

  function submit(event: FormEvent) {
    event.preventDefault()
    const result = updateProjectDetails(project.id, { name, notes }, project.revision)
    if (result.ok) onOpenChange(false)
    else setError(result.reason === "refused" ? result.reasons.join(" · ") : result.message)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="space-y-3">
          <DialogHeader>
            <DialogTitle>{m.project_edit_details_title({ name: project.name })}</DialogTitle>
            <DialogDescription className="sr-only">{m.project_edit_details_title({ name: project.name })}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-name`}>{m.newproject_field_name()}</Label>
            <Input id={`${id}-name`} value={name} autoFocus aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => setName(event.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor={`${id}-notes`}>{m.newproject_notes()}</Label>
            <Textarea id={`${id}-notes`} rows={3} value={notes} onChange={(event) => setNotes(event.target.value)} />
          </div>
          {error ? <ActionError id={`${id}-error`} message={error} /> : null}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {m.verb_cancel()}
            </Button>
            <Button type="submit">{m.settings_save()}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
