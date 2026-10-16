/**
 * The Project's Calibrate tab (CAL-FR-02, LIB-FR-23): a read-only check of
 * the calibration each held session brings, by group. Calibration is matched
 * at ingestion and pinned on the session, so nothing is assigned here: a
 * session's row opens the session, where its darks, flats and bias are
 * confirmed, chosen or reassigned. A Closed Project reads its frozen
 * snapshot (`heldCalibration`). A pinned file that changed or went missing
 * shows here and makes Apply refuse.
 */
import { useNavigate } from "@tanstack/react-router"
import { Eye } from "lucide-react"
import { useMessages } from "@/app/preferences"
import { BoxTable } from "@/components/app/box"
import type { Column } from "@/components/app/contracts"
import type { DetailSection } from "@/components/templates/detail-page"
import { CHOICE_STATE_NAME, KIND_NAME, NO_KIND_NAME, type PinProblem, sessionPinProblems, sourceRef } from "@/domain/calibration"
import { findGroup, heldCalibration } from "@/domain/derive"
import { sessionLongRef } from "@/domain/membership"
import type { CalibrationChoice, Catalog, Disk, PinKind, Project, ProjectGroup, Session, SessionCalibration } from "@/domain/types"
import { joinRefs, type Messages, say } from "@/lib/i18n"
import { type PrototypeState, useStore } from "@/store/core"

/** "Flat file changed": a pinned file that no longer holds its bytes (D-W113). */
function problemText(m: Messages, problem: PinProblem): string {
  const kind = say(m, KIND_NAME[problem.kind])
  return problem.state === "changed" ? m.project_pin_changed({ kind }) : problem.state === "missing" ? m.project_pin_missing({ kind }) : m.project_pin_unreadable({ kind })
}

interface CalibrationRow {
  session: Session
  group: ProjectGroup | undefined
  calibration: SessionCalibration | null
  /** "Flat file changed": the pinned files that no longer hold their bytes. */
  problems: string
}

/** One kind's choice in words: the pinned or suggested source, "No flats", or "Waiting". */
function choiceText(m: Messages, catalog: Catalog, disk: Disk, kind: PinKind, choice: CalibrationChoice | undefined): string {
  if (!choice) return "–"
  if (choice.state === "none") return say(m, NO_KIND_NAME[kind])
  if (choice.state === "waiting") return say(m, CHOICE_STATE_NAME.waiting)
  const source = say(m, sourceRef(catalog, disk, choice.source))
  return choice.state === "pinned" ? source : say(m, joinRefs([CHOICE_STATE_NAME.suggested, sourceRef(catalog, disk, choice.source)], ": "))
}

function rowsOf(m: Messages, state: PrototypeState, project: Project): CalibrationRow[] {
  return project.inputs.flatMap((input) => {
    const session = state.catalog.sessions[input.sessionId]
    if (!session) return []
    const calibration = heldCalibration(state.catalog, project, session.id)
    const problems = sessionPinProblems(state.disk, calibration)
      .map((p) => problemText(m, p))
      .join(" · ")
    return [{ session, group: findGroup(project, input.groupId), calibration, problems }]
  })
}

export function useCalibrateSections(project: Project): DetailSection[] {
  const m = useMessages()
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const rows = useStore((s) => rowsOf(m, s, project))
  const label = (r: CalibrationRow) => say(m, sessionLongRef(r.session))
  const kindColumn = (kind: PinKind, header: string): Column<CalibrationRow> => {
    const text = (r: CalibrationRow) => choiceText(m, catalog, disk, kind, r.calibration?.[kind])
    return { id: kind, header, cell: text, sortValue: text, truncate: true }
  }
  const columns: Column<CalibrationRow>[] = [
    { id: "session", header: m.project_col_session(), cell: label, sortValue: (r) => r.session.night, rowHeader: true, truncate: true },
    { id: "group", header: m.project_col_group(), cell: (r) => r.group?.name ?? "–", sortValue: (r) => r.group?.name ?? null, truncate: true },
    kindColumn("dark", m.calibration_heading_darks()),
    kindColumn("flat", m.calibration_heading_flats()),
    kindColumn("bias", m.calibration_heading_bias()),
    { id: "problems", header: m.dialog_col_status(), cell: (r) => r.problems || "–", sortValue: (r) => r.problems, truncate: true },
  ]
  return [
    {
      id: "calibration",
      title: m.project_calibration_title(),
      count: rows.length,
      flush: true,
      content: (
        <BoxTable
          label={m.project_calibration_of({ name: project.name })}
          rows={rows}
          columns={columns}
          getRowId={(r) => r.session.id}
          rowLabel={label}
          onRowClick={(r) => void navigate({ to: "/sessions/$sessionId", params: { sessionId: r.session.id } })}
          rowActions={(r) => [{ id: "open-session", label: m.project_open_session(), icon: Eye, run: () => void navigate({ to: "/sessions/$sessionId", params: { sessionId: r.session.id } }) }]}
          empty={m.project_no_sessions()}
        />
      ),
    },
  ]
}
