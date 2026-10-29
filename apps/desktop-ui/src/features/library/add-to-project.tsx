/**
 * Add to Project for one session (PRJ-FR-19, LIB-FR-17): the user picks an
 * open Project, the library says what the addition adds (the session's
 * Target as a subject, its rig when the Project lacks it), and Add commits
 * exactly that addition at the revisions it was computed on. A stale
 * Project or session is refused as `conflict`; the dialog stays open with
 * the choice, and the preview reads again.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { type ExpectedSession, library } from "@/api/ipc"
import { libraryQuery } from "@/api/query"
import { useMessages } from "@/app/preferences"
import { KeyValueList } from "@/components/app/data"
import { SelectField } from "@/components/app/fields"
import { FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { toast } from "@/components/app/feedback"
import { homeWrite } from "./queries"
import { readError } from "./parts"

/** Open Projects by name: what Add to Project offers. */
export const openProjectsQuery = () => libraryQuery("projectList", null, false, 0, 1000)

export function AddToProjectDialog({ session, sessionName, open, onOpenChange }: { session: ExpectedSession; sessionName: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const projects = useQuery({ ...openProjectsQuery(), enabled: open })
  const openProjects = (projects.data ?? []).filter((p) => p.lifecycle === "open")
  const { values, set } = useDialogForm(open, () => ({ projectId: "" }))
  const projectId = values.projectId || openProjects[0]?.id || ""
  const preview = useQuery({ ...libraryQuery("projectPreviewSessionAddition", session.sessionId, projectId), enabled: open && projectId !== "" })
  const addition = preview.data
  const project = openProjects.find((p) => p.id === projectId)
  const label = m.session_add_session()
  const unavailable = !addition
    ? { action: m.actions_blocked({ action: label }), reason: preview.error ? readError(m, preview.error) : m.home_reading(), blockers: [] }
    : undefined
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.session_add_to_project()}
      confirm={{
        id: "add-session",
        label,
        kind: "primary",
        unavailable,
        run: async () => {
          if (!addition || !project) return
          const result = await homeWrite(client, () => library.projectAddSession(addition.session, addition.projectId, addition.projectRevision))
          if (result.ok) toast({ message: m.session_added_to_project({ session: sessionName, project: project.name }) })
          return result
        },
      }}
    >
      <SelectField label={m.nav_projects()} value={projectId} options={openProjects.map((p) => ({ value: p.id, label: p.name }))} onChange={(next) => set({ projectId: next })} />
      {addition ? (
        <KeyValueList
          items={[
            ...(addition.addsSubject ? [{ label: m.home_adds(), value: m.home_adds_target_subject() }] : []),
            ...(addition.addedRig ? [{ label: m.home_adds(), value: m.session_adds_rig({ name: addition.addedRig.name }) }] : []),
          ]}
        />
      ) : null}
    </FormDialog>
  )
}
