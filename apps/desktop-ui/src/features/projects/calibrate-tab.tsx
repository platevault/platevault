/**
 * The Project's Calibrate tab (068 CAL-FR-02, LIB-FR-23): a read-only check.
 * Calibration is matched at ingestion and pinned on each session, so
 * nothing is assigned here and every row links where it is fixed.
 *
 * An open Project reads what the next Apply places (`project_apply_preview`):
 * first the held sessions that stop Apply, a kind not settled or a pinned
 * file that changed or went missing, then the calibration files the View
 * gets, per kind and source. A Closing, Closed or Archived Project reads the
 * calibration each session used, frozen at Close (`project_closed_snapshot`).
 */
import { useQuery } from "@tanstack/react-query"
import { failureOf, type InputRef, type SettledPin_Serialize, type ViewPlanEntry } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { BoxTable } from "@/components/app/box"
import type { Blocker, Column } from "@/components/app/contracts"
import { useFollowLink } from "@/components/app/links"
import { ActionError, TableSkeleton } from "@/components/app/feedback"
import { failureMessage } from "@/components/app/run-result"
import { DetailPage, type DetailSection } from "@/components/templates/detail-page"
import { formatCount } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { applyBlocker } from "./apply-words"
import type { ProjectTabProps } from "./project-page"
import { applyPreviewQuery, closedSnapshotQuery, isLocked } from "./queries"
import { labelOf, useSessionSummaries } from "./sessions"
import { kindText } from "./words"

interface SourceRow {
  id: string
  kind: string
  source: string
  sessionId: string | null
  files: number
}

/** The View's calibration entries, one row per kind and source. */
function calibrationSources(m: Messages, entries: readonly ViewPlanEntry[], sessionName: (id: string) => string): SourceRow[] {
  const rows = new Map<string, SourceRow>()
  for (const entry of entries) {
    const source = entry.source
    if (source.source === "light") continue
    const id = source.source === "master" ? `${source.kind}|master|${source.masterId}|${source.revision}` : `${source.kind}|frames|${source.sessionId}`
    const row = rows.get(id) ?? {
      id,
      kind: kindText(m, source.kind),
      source: source.source === "master" ? m.calibrate_master_revision({ revision: source.revision }) : sessionName(source.sessionId),
      sessionId: source.source === "master" ? null : source.sessionId,
      files: 0,
    }
    row.files += 1
    rows.set(id, row)
  }
  return [...rows.values()]
}

function pinText(m: Messages, pin: SettledPin_Serialize, sessionName: (id: string) => string): string {
  if (pin.state === "declined") return m.calibrate_declined()
  return inputText(m, pin.target.input, sessionName)
}

function inputText(m: Messages, input: InputRef, sessionName: (id: string) => string): string {
  return input.form === "master" ? m.calibrate_master_revision({ revision: input.revision }) : sessionName(input.sessionId)
}

export function CalibrateTab({ header, chrome }: ProjectTabProps) {
  const locked = isLocked(header.lifecycle)
  return locked ? <FrozenCalibration header={header} chrome={chrome} /> : <PlannedCalibration header={header} chrome={chrome} />
}

function PlannedCalibration({ header, chrome }: Pick<ProjectTabProps, "header" | "chrome">) {
  const m = useMessages()
  const follow = useFollowLink()
  const preview = useQuery(applyPreviewQuery(header.id))
  const ids = [
    ...(preview.data?.blockers ?? []).flatMap((b) => ("sessionId" in b && typeof b.sessionId === "string" ? [b.sessionId] : [])),
    ...(preview.data?.entries ?? []).flatMap((e) => (e.source.source === "calibration_frame" ? [e.source.sessionId] : [])),
  ]
  const sessions = useSessionSummaries(ids)
  const sessionName = (id: string) => labelOf(sessions, id)
  if (!preview.data) return <DetailPage {...chrome} title={header.name} sections={[{ id: "calibration", title: m.calibrate_check_title(), content: <ReadState read={preview} /> }]} />
  const viewLink = { to: "/projects/$projectId", params: { projectId: header.id }, search: { stage: "view" } }
  const problems: (Blocker & { id: string })[] = preview.data.blockers
    .filter((b) => b.blocker === "calibration_unsettled" || b.blocker === "pin_drift")
    .map((b, i) => ({ ...applyBlocker(m, b, sessionName, viewLink), id: String(i) }))
  const problemColumns: Column<Blocker & { id: string }>[] = [
    { id: "problem", header: m.dialog_col_status(), cell: (b) => b.label, sortValue: (b) => b.label, rowHeader: true, truncate: true },
    { id: "session", header: m.project_col_session(), cell: (b) => b.where ?? "–", sortValue: (b) => b.where ?? "", truncate: true },
  ]
  const sources = calibrationSources(m, preview.data.entries, sessionName)
  const sourceColumns: Column<SourceRow>[] = [
    { id: "kind", header: m.project_col_kind(), cell: (r) => r.kind, sortValue: (r) => r.kind, rowHeader: true },
    { id: "source", header: m.calibrate_source(), cell: (r) => r.source, sortValue: (r) => r.source, truncate: true },
    { id: "files", header: m.view_entries(), cell: (r) => formatCount(r.files), sortValue: (r) => r.files, align: "right" },
  ]
  const sections: DetailSection[] = []
  if (problems.length > 0)
    sections.push({
      id: "calibration-problems",
      title: m.calibrate_problems_title(),
      count: problems.length,
      flush: true,
      content: (
        <BoxTable
          label={m.calibrate_problems_of({ name: header.name })}
          rows={problems}
          columns={problemColumns}
          getRowId={(b) => b.id}
          rowLabel={(b) => b.label}
          onRowClick={(b) => (b.link ? follow(b.link) : undefined)}
          rowActions={(b) => (b.link ? [{ id: "open-session", label: m.project_open_session(), run: () => follow(b.link!) }] : [])}
        />
      ),
    })
  sections.push({
    id: "calibration",
    title: m.calibrate_check_title(),
    count: sources.length,
    flush: true,
    content: (
      <BoxTable
        label={m.calibrate_check_title()}
        rows={sources}
        columns={sourceColumns}
        getRowId={(r) => r.id}
        rowLabel={(r) => `${r.kind} · ${r.source}`}
        rowActions={(r) => (r.sessionId ? [{ id: "open-session", label: m.project_open_session(), run: () => follow({ to: "/sessions/$sessionId", params: { sessionId: r.sessionId! } }) }] : [])}
        empty={m.calibrate_none_placed()}
      />
    ),
  })
  return <DetailPage {...chrome} title={header.name} sections={sections} />
}

interface FrozenRow {
  id: string
  session: string
  dark: string
  flat: string
  bias: string
}

function FrozenCalibration({ header, chrome }: Pick<ProjectTabProps, "header" | "chrome">) {
  const m = useMessages()
  const snapshot = useQuery(closedSnapshotQuery(header.id))
  const held = snapshot.data?.basis.groups.flatMap((g) => g.sessions) ?? []
  const pinned = held.flatMap((s) => [s.calibration.dark, s.calibration.flat, s.calibration.bias]).flatMap((p) => (p.state === "pinned" && p.target.input.form === "raw_set" ? [p.target.input.sessionId] : []))
  const sessions = useSessionSummaries([...held.map((s) => s.sessionId), ...pinned])
  const sessionName = (id: string) => labelOf(sessions, id)
  if (snapshot.data === undefined) return <DetailPage {...chrome} title={header.name} sections={[{ id: "calibration", title: m.calibrate_check_title(), content: <ReadState read={snapshot} /> }]} />
  const rows: FrozenRow[] = held.map((s) => ({
    id: s.sessionId,
    session: sessionName(s.sessionId),
    dark: pinText(m, s.calibration.dark, sessionName),
    flat: pinText(m, s.calibration.flat, sessionName),
    bias: pinText(m, s.calibration.bias, sessionName),
  }))
  const columns: Column<FrozenRow>[] = [
    { id: "session", header: m.project_col_session(), cell: (r) => r.session, sortValue: (r) => r.session, rowHeader: true, truncate: true },
    { id: "dark", header: m.calibration_kind_dark(), cell: (r) => r.dark, sortValue: (r) => r.dark, truncate: true },
    { id: "flat", header: m.calibration_kind_flat(), cell: (r) => r.flat, sortValue: (r) => r.flat, truncate: true },
    { id: "bias", header: m.calibration_kind_bias(), cell: (r) => r.bias, sortValue: (r) => r.bias, truncate: true },
  ]
  return (
    <DetailPage
      {...chrome}
      title={header.name}
      sections={[{ id: "calibration", title: m.calibrate_frozen_title(), count: rows.length, flush: true, content: <BoxTable label={m.calibrate_frozen_title()} rows={rows} columns={columns} getRowId={(r) => r.id} empty={m.project_sessions_none()} /> }]}
    />
  )
}

function ReadState({ read }: { read: { error: unknown; refetch: () => unknown } }) {
  const m = useMessages()
  const failure = read.error ? failureOf(read.error) : null
  if (read.error) return <ActionError message={failure ? failureMessage(m, failure) : m.action_failure_unreachable()} onRetry={() => void read.refetch()} />
  return <TableSkeleton rows={4} columns={3} label={m.common_loading()} />
}
