/**
 * Edit… on a session (D-W76; owner's answer, 2026-10-20): its name and
 * notes in one FormDialog, from the Session ▾ menu and the Sessions row
 * menu. An empty name keeps the derived one, which the field shows as its
 * placeholder (LIB-FR-04). The write is `editSessionDetails`, guarded by the
 * session's revision; a refused or stale write keeps the dialog open with
 * its message.
 */
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { TextAreaField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { sessionDefaultRef, sessionLongLabel } from "@/domain/membership"
import type { Session } from "@/domain/types"
import { say } from "@/lib/i18n"
import { editSessionDetails } from "@/store/actions/library"

export function SessionDetailsDialog({ session, open, onOpenChange }: { session: Session; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const [draft, setDraft] = useState({ name: session.name ?? "", notes: session.notes })
  // Each opening starts from the session as it is now.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setDraft({ name: session.name ?? "", notes: session.notes })
  }
  const derived = say(m, sessionDefaultRef(session))
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.settings_edit_title({ name: sessionLongLabel(m, session) })}
      size="sm"
      confirm={{ id: "session-edit-save", label: m.settings_save(), kind: "primary", run: () => editSessionDetails(session.id, draft, session.revision) }}
    >
      <TextField label={m.session_edit_name()} value={draft.name} onChange={(name) => setDraft({ ...draft, name })} placeholder={derived} description={m.session_edit_name_help({ name: derived })} autoFocus />
      <TextAreaField label={m.session_notes()} value={draft.notes} onChange={(notes) => setDraft({ ...draft, notes })} />
    </FormDialog>
  )
}
