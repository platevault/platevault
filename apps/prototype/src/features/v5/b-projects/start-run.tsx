/**
 * "Start a processing run" (sheet, part of S3; PRJ-FR-10, D-W38, D-W49,
 * D-W50). The user chooses one subject and one rig of the Project; both are
 * fixed once the run exists. A mosaic subject creates a run group with one
 * panel run per panel, listed by centre and rotation for the user to confirm
 * (VSEL-FR-18). Then a profile, which the run or the group's shared setup
 * keeps. Every candidate starts selected (D-W49).
 */
import { useNavigate } from "@tanstack/react-router"
import { useId, useState } from "react"
import { Notice } from "@/components/app/feedback"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { closeSheet, useShellUi } from "@/app/ui-state"
import { panelForSession, panelLabel, projectCandidates, rigCameraKind, rigName, subjectName, subjectTarget } from "@/domain/derive"
import type { Project } from "@/domain/types"
import { formatDec, formatDegrees, formatRa, plural } from "@/lib/format"
import { setGroupSetup, setRunSetup, startRun } from "@/store/actions/runs"
import { useStore } from "@/store/core"
import { SelectField } from "@/features/t3/fields"
import { InlineError } from "./parts"

export function StartRunSheet() {
  const { sheet } = useShellUi()
  const open = sheet?.kind === "start-run"
  const project = useStore((s) => (sheet?.kind === "start-run" ? s.catalog.projects[sheet.projectId] : undefined))
  return (
    <Sheet open={open} onOpenChange={(next) => !next && closeSheet()}>
      <SheetContent side="right" className="w-[34rem] max-w-[92vw] gap-0" data-sheet="start-run">
        {open && project ? (
          <StartRunForm key={project.id} project={project} />
        ) : open ? (
          <SheetHeader>
            <SheetTitle>Start a processing run</SheetTitle>
            <SheetDescription>This Project no longer exists in the catalog.</SheetDescription>
          </SheetHeader>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

const LATER = "later"

function StartRunForm({ project }: { project: Project }) {
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const [subjectId, setSubjectId] = useState(project.subjects[0]?.id ?? "")
  const [rigId, setRigId] = useState(project.rigIds[0] ?? "")
  const [profileId, setProfileId] = useState(LATER)
  const [panelsConfirmed, setPanelsConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ids = { subject: useId(), rig: useId(), confirm: useId() }
  const subject = project.subjects.find((s) => s.id === subjectId)
  const candidates = projectCandidates(catalog, project).filter((c) => c.subject.id === subjectId && c.rigId === rigId)
  const profiles = Object.values(catalog.profiles).sort((a, b) => a.name.localeCompare(b.name))
  const placement = subject?.mosaic
    ? subject.mosaic.panels.map((panel) => ({ panel, sessions: candidates.filter((c) => panelForSession(catalog, subject, c.session, rigId).panelId === panel.id).length }))
    : []
  const flagged = subject?.mosaic ? candidates.filter((c) => panelForSession(catalog, subject, c.session, rigId).panelId === null) : []
  const refusal = project.state !== "open" ? `${project.name} is Done: Reopen it first to start a run.` : project.subjects.length === 0 ? "The Project has no subject yet: add one first." : project.rigIds.length === 0 ? "The Project has no rig yet: add one first." : null

  function start() {
    if (!subject || !rigId) return
    if (subject.mosaic && !panelsConfirmed) {
      setError("Confirm the panels first: each panel run is tied to one panel for good.")
      return
    }
    const outcome = startRun(project.id, subject.id, rigId)
    if (!outcome.result.ok) {
      setError(outcome.result.message)
      return
    }
    const profile = profileId === LATER ? null : profileId
    if (profile) {
      const setup = outcome.groupId ? setGroupSetup(outcome.groupId, { profileId: profile }) : outcome.runId ? setRunSetup(outcome.runId, { profileId: profile }) : null
      if (setup && !setup.ok) {
        setError(`The run was created, but its profile was not saved: ${setup.message}`)
        return
      }
    }
    closeSheet()
    if (outcome.groupId) void navigate({ to: "/projects/$projectId/groups/$groupId/$step", params: { projectId: project.id, groupId: outcome.groupId, step: "select" } })
    else if (outcome.runId) void navigate({ to: "/projects/$projectId/runs/$runId/$step", params: { projectId: project.id, runId: outcome.runId, step: "select" } })
  }

  return (
    <>
      <SheetHeader className="border-b border-separator">
        <SheetTitle>Start a processing run</SheetTitle>
        <SheetDescription>
          In {project.name}. One subject and one rig, both fixed once the run exists: another subject or rig needs another run (D-W50).
        </SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4 text-sm">
        {refusal ? <Notice tone="refusal" title="Start run refused">{refusal}</Notice> : null}
        <fieldset className="space-y-2">
          <legend id={ids.subject} className="text-sm font-semibold">
            Subject
          </legend>
          <RadioGroup aria-labelledby={ids.subject} value={subjectId} onValueChange={(value) => {
            setSubjectId(String(value))
            setPanelsConfirmed(false)
          }}>
            {project.subjects.map((s) => {
              const target = subjectTarget(catalog, s)
              return (
                <div key={s.id} className="flex items-center gap-2">
                  <RadioGroupItem id={`${ids.subject}-${s.id}`} value={s.id} />
                  <Label htmlFor={`${ids.subject}-${s.id}`} className="font-normal">
                    <span className="font-medium">{subjectName(catalog, s)}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{s.mosaic ? `Mosaic of ${target?.name ?? "its Target"} · ${plural(s.mosaic.panels.length, "panel")} → a run group` : "Target"}</span>
                  </Label>
                </div>
              )
            })}
          </RadioGroup>
        </fieldset>

        <fieldset className="space-y-2">
          <legend id={ids.rig} className="text-sm font-semibold">
            Rig
          </legend>
          <RadioGroup aria-labelledby={ids.rig} value={rigId} onValueChange={(value) => setRigId(String(value))}>
            {project.rigIds.map((id) => {
              const rig = catalog.opticalTrains[id]
              const count = projectCandidates(catalog, project).filter((c) => c.subject.id === subjectId && c.rigId === id).length
              const kind = rig ? rigCameraKind(catalog, rig) : null
              return (
                <div key={id} className="flex items-center gap-2">
                  <RadioGroupItem id={`${ids.rig}-${id}`} value={id} />
                  <Label htmlFor={`${ids.rig}-${id}`} className="font-normal">
                    <span className="font-medium">{rigName(catalog, id)}</span>
                    <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                      {kind === "osc" ? "OSC" : kind === "mono" ? "Mono" : "Camera unknown"} · {plural(count, "candidate session")}
                    </span>
                  </Label>
                </div>
              )
            })}
          </RadioGroup>
        </fieldset>

        {subject?.mosaic ? (
          <section aria-labelledby="sr-panels" className="space-y-2">
            <h3 id="sr-panels" className="text-sm font-semibold">
              Panels of {subject.mosaic.name}
            </h3>
            <p className="text-xs text-muted-foreground">One panel run per panel, sharing one setup. Sessions are placed by pointing; ambiguous or off-panel ones are flagged for you to place.</p>
            <table className="w-full text-sm">
              <caption className="sr-only">Panels by centre and rotation</caption>
              <thead className="text-[0.6875rem] text-muted-foreground" data-chrome>
                <tr className="border-b">
                  <th scope="col" className="py-1 pr-2 text-left font-medium">
                    Panel
                  </th>
                  <th scope="col" className="py-1 pr-2 text-left font-medium">
                    Centre
                  </th>
                  <th scope="col" className="py-1 pr-2 text-left font-medium">
                    Rotation
                  </th>
                  <th scope="col" className="py-1 text-right font-medium">
                    Placed sessions
                  </th>
                </tr>
              </thead>
              <tbody>
                {placement.map(({ panel, sessions }) => (
                  <tr key={panel.id} className="border-b last:border-0">
                    <th scope="row" className="py-1 pr-2 text-left font-medium">
                      {panelLabel(panel)}
                    </th>
                    <td className="py-1 pr-2 tabular-nums">
                      {formatRa(panel.ra)} {formatDec(panel.dec)}
                    </td>
                    <td className="py-1 pr-2 tabular-nums">{formatDegrees(panel.rotationDeg, 0)}</td>
                    <td className="py-1 text-right tabular-nums">{sessions}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {flagged.length > 0 ? <p className="text-xs text-warning">{plural(flagged.length, "session")} flagged for you to place in the group&apos;s Select step.</p> : null}
            <div className="flex items-center gap-2">
              <Checkbox id={ids.confirm} checked={panelsConfirmed} onCheckedChange={(checked) => setPanelsConfirmed(checked === true)} />
              <Label htmlFor={ids.confirm} className="font-normal">
                These {subject.mosaic.panels.length} panels are right; tie one panel run to each.
              </Label>
            </div>
          </section>
        ) : null}

        <SelectField
          label="Profile"
          value={profileId}
          onChange={setProfileId}
          options={[{ value: LATER, label: "Choose in Prepare" }, ...profiles.map((p) => ({ value: p.id, label: p.name }))]}
          description={subject?.mosaic ? "The group's shared setup: every panel run uses it." : "The application profile Prepare lays the run out for. It can change until the run is prepared."}
        />

        <Notice tone="info" title="What starts">
          {subject && rigId
            ? `${subject.mosaic ? `A run group of ${plural(subject.mosaic.panels.length, "panel run")}` : "One run"} of ${subjectName(catalog, subject)} on ${rigName(catalog, rigId)}, with ${plural(candidates.length, "candidate session")} preselected. It opens at Select; nothing on disk changes.`
            : "Choose a subject and a rig."}
        </Notice>
      </div>
      <SheetFooter className="border-t border-separator">
        <InlineError message={error} />
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={closeSheet}>
            Cancel
          </Button>
          <Button onClick={start} disabled={refusal !== null || !subject || !rigId} focusableWhenDisabled>
            {subject?.mosaic ? "Start run group" : "Start run"}
          </Button>
        </div>
      </SheetFooter>
    </>
  )
}
