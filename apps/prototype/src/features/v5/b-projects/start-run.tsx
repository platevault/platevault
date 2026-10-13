/**
 * Start run (part of S3; FormDialog md; PRJ-FR-10, D-W38, D-W49, D-W50):
 * one subject and one rig of the Project, both fixed once the run exists,
 * and an optional profile, which the run or the group's shared setup keeps.
 * The run's Select step starts with every Ready candidate selected (D-W49,
 * P-REV2). A mosaic subject goes on to the mosaic editor, which places its
 * sessions on panels before the group starts. Profiles list the
 * applications by name, then the generic launcher (`orderedProfiles`).
 */
import { useNavigate } from "@tanstack/react-router"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { closeSheet, useShellUi } from "@/app/ui-state"
import type { Action, Blocker } from "@/components/app/contracts"
import { SelectField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { projectCandidates, rigName, subjectName } from "@/domain/derive"
import { orderedProfiles, profileRef } from "@/domain/labels"
import type { Project } from "@/domain/types"
import { say } from "@/lib/i18n"
import { setRunSetup, startRun } from "@/store/actions/runs"
import { type CommitResult, useStore } from "@/store/core"

const NO_PROFILE = "none"

/** The dialog host the shell mounts: open while the shell's sheet is Start run. */
export function StartRunHost() {
  const { sheet } = useShellUi()
  const projectId = sheet?.kind === "start-run" ? sheet.projectId : null
  const project = useStore((s) => (projectId ? s.catalog.projects[projectId] : undefined))
  const [opening, setOpening] = useState({ projectId, count: 0 })
  if (opening.projectId !== projectId) setOpening({ projectId, count: projectId ? opening.count + 1 : opening.count })
  if (!project) return null
  return <StartRunDialog key={opening.count} project={project} open={projectId !== null} onOpenChange={(open) => !open && closeSheet()} />
}

export interface StartRunDialogProps {
  project: Project
  open: boolean
  onOpenChange: (open: boolean) => void
  /** A candidate row's subject and rig, chosen already. */
  initial?: { subjectId: string; rigId: string }
}

export function StartRunDialog({ project, open, onOpenChange, initial }: StartRunDialogProps) {
  const m = useMessages()
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const [subjectId, setSubjectId] = useState(initial?.subjectId ?? project.subjects[0]?.id ?? "")
  const [rigId, setRigId] = useState(initial?.rigId ?? project.rigIds[0] ?? "")
  const [profileId, setProfileId] = useState(NO_PROFILE)
  const subject = project.subjects.find((s) => s.id === subjectId)
  const candidates = projectCandidates(catalog, project)
  const ready = (rig: string) => candidates.filter((c) => c.subject.id === subjectId && c.rigId === rig).length

  const blockers: Blocker[] = [
    ...(project.state !== "open" ? [{ label: m.startrun_blocker_done({ name: project.name }) }] : []),
    ...(project.subjects.length === 0 ? [{ label: m.startrun_no_subject() }] : []),
    ...(project.rigIds.length === 0 ? [{ label: m.session_no_rig() }] : []),
  ]

  function start(): CommitResult | void {
    if (!subject || !rigId) return
    const profile = profileId === NO_PROFILE ? null : profileId
    if (subject.mosaic) {
      void navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: { mosaic: subject.id, rig: rigId, ...(profile ? { profile } : {}) } })
      return
    }
    const outcome = startRun(project.id, subject.id, rigId)
    if (!outcome.result.ok) return outcome.result
    if (!outcome.runId) return { ok: false, reason: "write-failed", message: m.startrun_not_created() }
    if (profile) {
      const setup = setRunSetup(outcome.runId, { profileId: profile })
      if (!setup.ok) return { ok: false, reason: "write-failed", message: m.startrun_profile_not_saved({ message: setup.message }) }
    }
    void navigate({ to: "/projects/$projectId/runs/$runId/$step", params: { projectId: project.id, runId: outcome.runId, step: "select" } })
  }

  const label = subject?.mosaic ? m.startrun_place_panels() : m.startrun_title()
  const confirm: Action = {
    id: "start-run",
    label,
    kind: "primary",
    run: start,
    unavailable: blockers.length > 0 ? { action: m.actions_blocked({ action: label }), reason: m.refusal_blockers({ count: blockers.length }), blockers } : undefined,
  }

  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title={m.startrun_title()} confirm={confirm}>
      <SelectField
        label={m.project_col_subject()}
        value={subjectId}
        onChange={setSubjectId}
        options={project.subjects.map((s) => ({
          value: s.id,
          label: s.mosaic ? m.startrun_mosaic_subject({ name: subjectName(m, catalog, s), count: s.mosaic.panels.length }) : subjectName(m, catalog, s),
        }))}
      />
      <SelectField
        label={m.project_col_rig()}
        value={rigId}
        onChange={setRigId}
        options={project.rigIds.map((id) => ({ value: id, label: m.startrun_rig_ready({ name: rigName(m, catalog, id), count: ready(id) }) }))}
      />
      <SelectField
        label={m.startrun_profile_optional()}
        value={profileId}
        onChange={setProfileId}
        options={[{ value: NO_PROFILE, label: m.startrun_profile_none() }, ...orderedProfiles(catalog).map((p) => ({ value: p.id, label: say(m, profileRef(p)) }))]}
      />
    </FormDialog>
  )
}
