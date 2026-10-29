/**
 * Duplicate… (065 PRJ-FR-25/30, PRJ-AC-34): a new open Project from this one,
 * Closed or not, with what the user keeps ticked: its sessions on their
 * current calibration pins (never the Close snapshot's), its goals, notes
 * and View settings. No file is copied and the copy keeps no link to the
 * original. The library copies each group that holds a ticked session or
 * carries a goal the copy keeps, so a mosaic's panel goals keep their panel
 * even with no session ticked (astro-plan-409cm.5); there is no separate
 * Groups choice. A session the admission rule refuses now is named in the
 * refusal. Duplicate opens the copy, a fresh page with nothing selected
 * (astro-plan-409cm.9).
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { library } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import type { Action } from "@/components/app/contracts"
import { ChoiceListField, SwitchField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { toast } from "@/components/app/feedback"
import { inputsQuery, type ProjectHeader, projectWrite } from "./queries"
import { labelOf, useSessionSummaries } from "./sessions"

export function DuplicateProjectDialog({ header, open, onOpenChange }: { header: ProjectHeader; open: boolean; onOpenChange: (open: boolean) => void }) {
  return open ? <DuplicateForm header={header} onClose={() => onOpenChange(false)} /> : null
}

function DuplicateForm({ header, onClose }: { header: ProjectHeader; onClose: () => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const navigate = useNavigate()
  const inputs = useQuery(inputsQuery(header.id))
  const held = inputs.data?.desired.sessions.map((s) => s.sessionId) ?? []
  const sessions = useSessionSummaries(held)
  const [name, setName] = useState<string>(m.project_duplicate_name({ name: header.name }))
  const [ticked, setTicked] = useState<string[] | null>(null)
  const [goals, setGoals] = useState(true)
  const [notes, setNotes] = useState(true)
  const [settings, setSettings] = useState(true)
  const chosen = ticked ?? held
  const label = m.project_duplicate()
  const confirm: Action = {
    id: "duplicate-confirm",
    label,
    kind: "primary",
    unavailable: name.trim() === "" ? { action: m.actions_blocked({ action: label }), reason: m.project_name_required(), blockers: [] } : !inputs.data ? { action: m.actions_blocked({ action: label }), reason: m.common_loading(), blockers: [] } : undefined,
    run: async () => {
      const result = await projectWrite(client, () => library.projectDuplicate({ projectId: header.id, name: name.trim(), sessions: chosen, goals, notes, settings }))
      if (result.ok) {
        toast({ message: m.project_saved_duplicated({ name: header.name, copy: result.data.name }) })
        void navigate({ to: "/projects/$projectId", params: { projectId: result.data.id } })
      }
      return result
    },
  }
  return (
    <FormDialog open onOpenChange={(next) => !next && onClose()} title={m.common_duplicate_title({ name: header.name })} size="md" confirm={confirm}>
      <TextField label={m.newproject_field_name()} value={name} onChange={setName} autoFocus required />
      <ChoiceListField
        label={m.project_duplicate_part_count({ part: m.project_duplicate_part_sessions(), count: chosen.length })}
        description={m.project_duplicate_current_pins()}
        value={chosen}
        options={held.map((id) => ({ value: id, label: labelOf(sessions, id) }))}
        onChange={setTicked}
        empty={m.project_sessions_none()}
      />
      <SwitchField label={m.project_duplicate_part_goals()} checked={goals} onChange={setGoals} />
      <SwitchField label={m.project_duplicate_part_notes()} checked={notes} onChange={setNotes} />
      <SwitchField label={m.project_view_settings()} checked={settings} onChange={setSettings} description={m.project_duplicate_no_files()} />
    </FormDialog>
  )
}
