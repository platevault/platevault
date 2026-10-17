/**
 * The Project's Calibrate tab (CAL-FR-02, LIB-FR-23; decision record §6):
 * a read-only check, drawn as the WBPP-style CalibrationDiagram. Each group,
 * then each night folder the next Apply builds, then each light set with the
 * flats, darks and bias it gets, their version and evidence, No flats/No
 * darks/No bias, and the dark and bias versions a night folder carries
 * because the Project mixes them. Calibration is matched at ingestion and
 * pinned on the session, so nothing is assigned here: every name links
 * where it is fixed. The sessions that stop Apply (a kind not settled, or a
 * pinned file that changed or went missing, D-W113) are listed first with a
 * link to the session. When the Project mixes gain or offset, its folder
 * names carry GAIN_/OFFSET_ parts (D-W108, provisional order). A Closed
 * Project reads its frozen calibration (`heldCalibration`).
 */
import { useNavigate } from "@tanstack/react-router"
import { Eye } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { BoxTable } from "@/components/app/box"
import type { Column } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { CalibrationDiagram, calibrationDiagram } from "@/components/domain/calibration-diagram"
import type { DetailSection } from "@/components/templates/detail-page"
import { CHOICE_STATE_NAME, KIND_NAME, PIN_KINDS, type PinProblem, sessionPinProblems } from "@/domain/calibration"
import { heldCalibration, isLocked } from "@/domain/derive"
import { sessionLongRef } from "@/domain/membership"
import { viewPlan } from "@/domain/project-view"
import type { Project, Session } from "@/domain/types"
import { type Messages, say } from "@/lib/i18n"
import { nowIso, type PrototypeState, useStore } from "@/store/core"

/** "Flat file changed": a pinned file that no longer holds its bytes (D-W113). */
function problemText(m: Messages, problem: PinProblem): string {
  const kind = say(m, KIND_NAME[problem.kind])
  return problem.state === "changed" ? m.project_pin_changed({ kind }) : problem.state === "missing" ? m.project_pin_missing({ kind }) : m.project_pin_unreadable({ kind })
}

/** One held session Apply refuses until it is fixed on the session. */
export interface CalibrationProblemRow {
  session: Session
  problems: string[]
}

/** The held sessions with a kind not yet settled or a pinned file that changed, went missing or can't be read now. A Closed Project reads its frozen pins. */
export function calibrationProblems(m: Messages, state: Pick<PrototypeState, "catalog" | "disk">, project: Project): CalibrationProblemRow[] {
  return project.inputs.flatMap((input) => {
    const session = state.catalog.sessions[input.sessionId]
    if (!session) return []
    const calibration = heldCalibration(state.catalog, project, session.id)
    const waiting = PIN_KINDS.filter((kind) => {
      const choice = calibration?.[kind]
      return !choice || choice.state === "waiting" || choice.state === "suggested"
    }).map((kind) => `${say(m, KIND_NAME[kind])}: ${say(m, CHOICE_STATE_NAME[calibration?.[kind]?.state ?? "waiting"])}`)
    const problems = [...waiting, ...sessionPinProblems(state.disk, calibration).map((p) => problemText(m, p))]
    return problems.length > 0 ? [{ session, problems }] : []
  })
}

export function useCalibrateSections(project: Project): DetailSection[] {
  const m = useMessages()
  const navigate = useNavigate()
  const groups = useStore((s) => calibrationDiagram(s, project, Date.parse(nowIso())))
  const layout = useStore((s) => viewPlan(s, project).layout)
  const problems = useStore((s) => calibrationProblems(m, s, project))
  const label = (r: CalibrationProblemRow) => say(m, sessionLongRef(r.session))
  const open = (r: CalibrationProblemRow) => void navigate({ to: "/sessions/$sessionId", params: { sessionId: r.session.id } })
  const columns: Column<CalibrationProblemRow>[] = [
    { id: "session", header: m.project_col_session(), cell: label, sortValue: (r) => r.session.night, rowHeader: true, truncate: true },
    { id: "problems", header: m.dialog_col_status(), cell: (r) => r.problems.join(" · "), sortValue: (r) => r.problems.join(" "), truncate: true },
  ]
  const mixed = [layout.gain ? "GAIN_" : null, layout.offset ? "OFFSET_" : null].filter((part): part is string => part !== null)

  const sections: DetailSection[] = []
  if (problems.length > 0 && !isLocked(project))
    sections.push({
      id: "calibration-problems",
      title: m.calibrate_problems_title(),
      count: problems.length,
      flush: true,
      content: (
        <BoxTable
          label={m.calibrate_problems_of({ name: project.name })}
          rows={problems}
          columns={columns}
          getRowId={(r) => r.session.id}
          rowLabel={label}
          onRowClick={open}
          rowActions={(r) => [{ id: "open-session", label: m.project_open_session(), icon: Eye, run: () => open(r) }]}
        />
      ),
    })
  if (mixed.length > 0)
    sections.push({
      id: "calibration-layout",
      title: m.calibrate_layout_title(),
      content: (
        <KeyValueList items={[{ label: m.calibrate_mixed_parts(), value: mixed.join(" · "), mono: true }]} />
      ),
    })
  sections.push({ id: "calibration", title: m.calibrate_check_title(), content: <CalibrationDiagram groups={groups} level={3} /> })
  return sections
}