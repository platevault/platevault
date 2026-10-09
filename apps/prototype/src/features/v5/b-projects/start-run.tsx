/**
 * "Start run" (sheet, part of S3; PRJ-FR-10, D-W38, D-W49, D-W50): one
 * subject, one rig of the Project (both fixed once the run exists) and an
 * optional profile, which the run or the group's shared setup keeps. Every
 * candidate starts selected (D-W49). A mosaic subject goes on to the mosaic
 * editor, which places its sessions on panels before the group starts.
 * Profiles list the applications first; the generic launcher comes last.
 */
import { useNavigate } from "@tanstack/react-router"
import { useId, useState } from "react"
import { CountBadge, Pill } from "@/components/app/pill"
import { Refusal } from "@/components/app/refusal"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Sheet, SheetContent, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { useMessages } from "@/app/preferences"
import { closeSheet, useShellUi } from "@/app/ui-state"
import { projectCandidates, rigCameraKind, rigName, subjectName } from "@/domain/derive"
import type { ApplicationProfile, Catalog, Project } from "@/domain/types"
import { m as messages } from "@/lib/i18n"
import { setRunSetup, startRun } from "@/store/actions/runs"
import { useStore } from "@/store/core"
import { SelectField } from "@/features/t3/fields"
import { InlineError } from "./parts"

export function StartRunSheet() {
  const m = useMessages()
  const { sheet } = useShellUi()
  const open = sheet?.kind === "start-run"
  const project = useStore((s) => (sheet?.kind === "start-run" ? s.catalog.projects[sheet.projectId] : undefined))
  return (
    <Sheet open={open} onOpenChange={(next) => !next && closeSheet()}>
      <SheetContent side="right" className="w-[30rem] max-w-[92vw] gap-0" data-sheet="start-run">
        {open && project ? (
          <StartRunForm key={project.id} project={project} />
        ) : open ? (
          <SheetHeader>
            <SheetTitle>{m.startrun_project_not_found()}</SheetTitle>
          </SheetHeader>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

export const NO_PROFILE = "none"

/** Profile choices: no profile yet, then the applications by name, then the generic launcher; worded in the current language. */
export function profileOptions(catalog: Catalog): Array<{ value: string; label: string }> {
  const profiles = Object.values(catalog.profiles)
  const apps = profiles.filter((p) => p.application !== "generic").sort((a, b) => a.name.localeCompare(b.name))
  const generic = profiles.filter((p) => p.application === "generic")
  return [{ value: NO_PROFILE, label: messages.startrun_profile_none() }, ...apps.map(option), ...generic.map((p) => ({ value: p.id, label: messages.startrun_profile_other() }))]
}

function option(profile: ApplicationProfile) {
  return { value: profile.id, label: profile.name }
}

function StartRunForm({ project }: { project: Project }) {
  const m = useMessages()
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const [subjectId, setSubjectId] = useState(project.subjects[0]?.id ?? "")
  const [rigId, setRigId] = useState(project.rigIds[0] ?? "")
  const [profileId, setProfileId] = useState(NO_PROFILE)
  const [error, setError] = useState<string | null>(null)
  const ids = { subject: useId(), rig: useId() }
  const subject = project.subjects.find((s) => s.id === subjectId)
  const candidates = projectCandidates(catalog, project)
  const count = (rig: string) => candidates.filter((c) => c.subject.id === subjectId && c.rigId === rig).length
  const blockers = [...(project.state !== "open" ? [{ label: m.startrun_blocker_done({ name: project.name }) }] : []), ...(project.subjects.length === 0 ? [{ label: m.startrun_no_subject() }] : []), ...(project.rigIds.length === 0 ? [{ label: m.session_no_rig() }] : [])]

  function start() {
    if (!subject || !rigId) return
    const profile = profileId === NO_PROFILE ? null : profileId
    if (subject.mosaic) {
      closeSheet()
      void navigate({ to: "/projects/$projectId", params: { projectId: project.id }, search: { mosaic: subject.id, rig: rigId, ...(profile ? { profile } : {}) } })
      return
    }
    const outcome = startRun(project.id, subject.id, rigId)
    if (!outcome.result.ok || !outcome.runId) {
      setError(outcome.result.ok ? m.startrun_not_created() : outcome.result.message)
      return
    }
    if (profile) {
      const setup = setRunSetup(outcome.runId, { profileId: profile })
      if (!setup.ok) {
        setError(m.startrun_profile_not_saved({ message: setup.message }))
        return
      }
    }
    closeSheet()
    void navigate({ to: "/projects/$projectId/runs/$runId/$step", params: { projectId: project.id, runId: outcome.runId, step: "select" } })
  }

  return (
    <>
      <SheetHeader className="border-b border-separator">
        <SheetTitle>{m.startrun_title()}</SheetTitle>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
        {blockers.length > 0 ? <Refusal action={m.startrun_refusal()} reason={m.refusal_blockers({ count: blockers.length })} blockers={blockers} /> : null}
        <fieldset className="space-y-2">
          <legend id={ids.subject} className="text-sm font-semibold">
            {m.project_col_subject()}
          </legend>
          <RadioGroup aria-labelledby={ids.subject} value={subjectId} onValueChange={(value) => setSubjectId(String(value))}>
            {project.subjects.map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <RadioGroupItem id={`${ids.subject}-${s.id}`} value={s.id} />
                <Label htmlFor={`${ids.subject}-${s.id}`} className="font-normal">
                  <span className="font-medium">{subjectName(catalog, s)}</span>
                </Label>
                {s.mosaic ? <Pill tone="info">{`${m.startrun_mosaic()} · ${m.project_panels({ count: s.mosaic.panels.length })}`}</Pill> : null}
              </div>
            ))}
          </RadioGroup>
        </fieldset>

        <fieldset className="space-y-2">
          <legend id={ids.rig} className="text-sm font-semibold">
            {m.project_col_rig()}
          </legend>
          <RadioGroup aria-labelledby={ids.rig} value={rigId} onValueChange={(value) => setRigId(String(value))}>
            {project.rigIds.map((id) => {
              const rig = catalog.opticalTrains[id]
              const kind = rig ? rigCameraKind(catalog, rig) : null
              const n = count(id)
              return (
                <div key={id} className="flex items-center gap-2">
                  <RadioGroupItem id={`${ids.rig}-${id}`} value={id} />
                  <Label htmlFor={`${ids.rig}-${id}`} className="font-normal">
                    <span className="font-medium">{rigName(catalog, id)}</span>
                  </Label>
                  <Pill tone="muted">{kind === "osc" ? m.project_camera_osc() : kind === "mono" ? m.project_camera_mono() : m.newproject_camera_unknown()}</Pill>
                  <CountBadge count={n} tone={n > 0 ? "info" : "muted"} label={m.startrun_candidate_sessions({ count: n })} />
                </div>
              )
            })}
          </RadioGroup>
        </fieldset>

        <SelectField label={m.startrun_profile_optional()} value={profileId} onChange={setProfileId} options={profileOptions(catalog)} />
      </div>
      <SheetFooter className="border-t border-separator">
        <InlineError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={closeSheet}>
            {m.verb_cancel()}
          </Button>
          <Button onClick={start} disabled={blockers.length > 0 || !subject || !rigId} focusableWhenDisabled>
            {subject?.mosaic ? m.startrun_place_panels() : m.startrun_title()}
          </Button>
        </div>
      </SheetFooter>
    </>
  )
}
