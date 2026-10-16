/**
 * CalibrationChoices (L2-domain; F4 decision record §6, LIB-FR-23 to
 * LIB-FR-25, CAL-FR-05): one row per light session and calibration kind,
 * with the kind's state (pinned, suggested, waiting or No), its source and
 * the evidence it was matched on. Import review, a session's details, the
 * Needs calibration queue and late-import review host it.
 *
 * It is controlled and writes nothing: Confirm, Choose ▸, No and the
 * provisional Add darks/flats/bias… call the host's callbacks, which call the
 * session actions (`confirmCalibration`, `pickCalibration`,
 * `setNoCalibration`); the host owns the selection. It never matches: the
 * sources Choose ▸ offers come with the rows (`calibrationChoiceRows`).
 *
 * - Confirm turns a suggestion into the user's pin with the evidence it was
 *   suggested on, unknown checks included; No needs no reason.
 * - A pinned file that changed, went missing or can't be read now keeps its
 *   pin and reads Changed, Not found or Offline.
 * - Each row expands to its evidence: capture time, nights or days apart,
 *   the rotation difference and every check, lights against calibration.
 * - A DataTable: one Tab stop on the current row, its menu on Shift+F10, and
 *   focus back on the row after a menu or dialog (P-KBD1).
 */
import { Check, CircleSlash } from "lucide-react"
import type { ReactNode } from "react"
import { useMessages } from "@/app/preferences"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { UnknownValue } from "@/components/app/feedback"
import { Pill } from "@/components/app/pill"
import { PlaceLink } from "@/components/app/previews"
import { StatusBadge } from "@/components/app/status"
import {
  CHOICE_STATE_NAME,
  CRITERION_NAME,
  calibrationSources,
  candidatesFor,
  KIND_NAME,
  NO_KIND_NAME,
  PIN_KINDS,
  type PinHealth,
  pinHealth,
  sourceKey,
  sourceRef,
  summaryRef,
} from "@/domain/calibration"
import type { StepLink, World } from "@/domain/derive"
import { sessionLongRef } from "@/domain/membership"
import type { CalibrationChoice, CalibrationSource, MatchCriterion, MatchEvidence, PinKind, SessionId } from "@/domain/types"
import { formatDateTime, formatDegrees } from "@/lib/format"
import { type MessageRef, type Messages, joinRefs, msg, say } from "@/lib/i18n"
import type { SessionKind } from "@/store/actions/calibration"
import type { CommitResult } from "@/store/core"

/** A source the session may take for the kind instead, best first (`candidatesFor`). */
export interface CalibrationOffer {
  /** `sourceKey(source)`. */
  key: string
  source: CalibrationSource
  /** "MasterFlat_Ha.xisf · 18 Sep", "18 Sep · Ha (raw)". */
  label: MessageRef
  /** "pin": every check passes; "suggest": a warning or an unknown check. Choosing either pins it, by the user. */
  verdict: "pin" | "suggest"
  evidence: MatchEvidence
}

/** One kind of one light session, as the table shows it. */
export interface CalibrationChoiceRow {
  sessionId: SessionId
  /** The session revision the row was read at; Choose ▸ passes it so a stale pick is refused. */
  revision: number
  /** "18 Sep · Ha · 300 s". */
  session: MessageRef
  /** The session's page; null for a session not in the library yet (import review), which reads as plain text. */
  sessionLink: StepLink | null
  kind: PinKind
  choice: CalibrationChoice
  /** The pinned or suggested source as a list names it; null while waiting or No. */
  source: MessageRef | null
  /** The source's place: the master in the Calibration library, or the raw calibration session; null for one not in the library yet, which reads as plain text. */
  sourceLink: StepLink | null
  /** A pinned file now: "ok", or changed, missing or unreadable (the pin stays). */
  health: PinHealth
  /** Other sources Choose ▸ offers; the pinned one is left out. */
  offers: CalibrationOffer[]
}

/** A row's id in the table and in the host's selection: `<sessionId>:<kind>`. */
export function choiceRowId(pick: SessionKind): string {
  return `${pick.sessionId}:${pick.kind}`
}

/** Where a calibration source lives: a master in the Calibration library, or a raw calibration session. */
export function calibrationSourceLink(source: CalibrationSource): StepLink {
  return source.type === "master" ? { to: "/calibration", search: { master: source.masterId } } : { to: "/sessions/$sessionId", params: { sessionId: source.sessionId } }
}

/**
 * The rows for these light sessions, each kind in order: what each kind holds
 * now, its pin's health, and what Choose ▸ may offer. Reads the catalogue only.
 */
export function calibrationChoiceRows(world: Pick<World, "catalog" | "disk" | "settings">, sessionIds: readonly SessionId[], kinds: readonly PinKind[] = PIN_KINDS): CalibrationChoiceRow[] {
  const { catalog, disk, settings } = world
  const sources = calibrationSources(catalog, disk)
  return sessionIds.flatMap((sessionId) => {
    const session = catalog.sessions[sessionId]
    const calibration = session?.calibration
    if (!session || !calibration) return []
    return kinds.map((kind): CalibrationChoiceRow => {
      const choice = calibration[kind]
      const held = choice.state === "pinned" || choice.state === "suggested" ? choice.source : null
      const pinned = choice.state === "pinned" ? sourceKey(choice.source) : null
      return {
        sessionId,
        revision: session.revision,
        session: sessionLongRef(session),
        sessionLink: { to: "/sessions/$sessionId", params: { sessionId } },
        kind,
        choice,
        source: held ? sourceRef(catalog, disk, held) : null,
        sourceLink: held ? calibrationSourceLink(held) : null,
        health: pinHealth(disk, choice).state,
        offers: candidatesFor(catalog, settings, session, kind, sources)
          .filter((c) => c.source.key !== pinned)
          .map((c) => ({ key: c.source.key, source: c.source.source, label: sourceRef(catalog, disk, c.source.source), verdict: c.verdict, evidence: c.evidence })),
      }
    })
  })
}

export interface CalibrationChoiceBadgeProps {
  kind: PinKind
  choice: Pick<CalibrationChoice, "state"> & { by?: "matching" | "user" | "camera-default" }
  /** A pinned file that changed, went missing or can't be read now reads so, over Pinned. */
  health?: PinHealth
}

/** One kind's state as a word: Pinned automatically, Pinned, Suggested, Waiting, No flats (or the camera's default), or the pin's problem. */
export function CalibrationChoiceBadge({ kind, choice, health = "ok" }: CalibrationChoiceBadgeProps) {
  const m = useMessages()
  if (health === "changed") return <StatusBadge kind="content" value="drifted" />
  if (health === "missing") return <StatusBadge kind="availability" value="absent" />
  if (health === "unreadable") return <StatusBadge kind="availability" value="offline" />
  if (choice.state === "pinned") return <StatusBadge kind="assignment" value="accepted" label={choice.by === "matching" ? m.calibration_choice_pinned_auto() : say(m, CHOICE_STATE_NAME.pinned)} />
  if (choice.state === "suggested") return <StatusBadge kind="assignment" value="suggested" label={say(m, CHOICE_STATE_NAME.suggested)} />
  if (choice.state === "waiting") return <StatusBadge kind="assignment" value="unresolved" label={say(m, CHOICE_STATE_NAME.waiting)} />
  const no = say(m, NO_KIND_NAME[kind])
  return <Pill tone="muted">{choice.by === "camera-default" ? m.calibration_choice_none_camera({ choice: no }) : no}</Pill>
}

/** "Same night", "2 nights apart" for flats; "10 days apart" for darks and bias. */
function apartRef(kind: PinKind, apart: number): MessageRef {
  if (kind !== "flat") return msg("calibration_days_apart", { count: apart })
  return apart === 0 ? msg("calibration_same_night") : msg("calibration_nights_apart", { count: apart })
}

/** "10 days apart · Rotation unknown": the evidence in one line beside the source, which already names its night; only the checks that don't pass are named. */
export function evidenceRef(kind: PinKind, evidence: MatchEvidence): MessageRef {
  const open = evidence.criteria.filter((c) => c.result !== "compatible")
  return joinRefs([apartRef(kind, evidence.apart), ...(open.length > 0 ? [summaryRef(open)] : [])], " · ")
}

function CriterionResult({ result }: { result: MatchCriterion["result"] }) {
  if (result === "warning") return <StatusBadge kind="check" value="warning" />
  return <StatusBadge kind="match" value={result} />
}

/** A row's evidence, one level deep: the facts, then every check lights against calibration. */
function EvidenceDetail({ row, evidence, label }: { row: CalibrationChoiceRow; evidence: MatchEvidence; label: string }) {
  const m = useMessages()
  const columns: Column<MatchCriterion>[] = [
    { id: "check", header: m.calibration_choices_col_check(), rowHeader: true, cell: (c) => say(m, CRITERION_NAME[c.name]), sortValue: (c) => say(m, CRITERION_NAME[c.name]) },
    { id: "lights", header: m.calibration_choices_col_lights(), cell: (c) => say(m, c.lightValue), sortValue: (c) => say(m, c.lightValue) },
    { id: "calibration", header: m.calibration_choices_col_calibration(), cell: (c) => say(m, c.calibrationValue), sortValue: (c) => say(m, c.calibrationValue) },
    { id: "result", header: m.evidence_column_result(), cell: (c) => <CriterionResult result={c.result} />, sortValue: (c) => c.result },
  ]
  const facts = [
    { label: m.calibration_choices_captured(), value: formatDateTime(evidence.capturedAt) },
    { label: m.calibration_choices_apart(), value: say(m, apartRef(row.kind, evidence.apart)) },
    ...(row.kind === "flat"
      ? [{ label: m.calibration_choices_rotation_delta(), value: evidence.rotationDeltaDeg === null ? <UnknownValue /> : formatDegrees(evidence.rotationDeltaDeg) }]
      : []),
  ]
  return (
    <div className="space-y-2 py-1">
      <KeyValueList items={facts} />
      <DataTable label={label} rows={evidence.criteria} columns={columns} getRowId={(c) => c.name} scroll="none" />
    </div>
  )
}

export interface CalibrationChoicesProps {
  /** Names the table: "Calibration", "Needs calibration". */
  label: string
  rows: CalibrationChoiceRow[]
  /** Rows of several sessions sit in one group per session, its header a link to the session. Default: on when the rows hold more than one session. */
  groupBySession?: boolean
  /** False where the choices can't change (a trashed session): no actions, the evidence still opens. */
  changeable?: boolean
  /** Confirm: the suggestions become the user's pins (`confirmCalibration`). */
  onConfirm: (picks: SessionKind[]) => CommitResult
  /** Choose ▸: the session pins this source (`pickCalibration(sessionId, kind, source, expectRevision)`). */
  onPick: (pick: SessionKind & { source: CalibrationSource; expectRevision: number }) => CommitResult
  /** No darks, No flats or No bias, no reason asked (`setNoCalibration`). */
  onNo: (picks: SessionKind[]) => CommitResult
  /** Provisional "Add flats…": opens Import for the files the user picks. Omitted, the action is not offered. */
  onAddFiles?: (pick: SessionKind) => void
  /** Rows the host has selected (`choiceRowId`): the batch bar offers Confirm and Set to No on them. */
  selection?: { selected: string[]; onChange: (ids: string[]) => void }
  loading?: boolean
  error?: { message: string; onRetry: () => void }
  /** Shown when there are no rows; default "No sessions to calibrate". */
  empty?: ReactNode
}

const ADD_FILES: Record<PinKind, (m: Messages) => string> = {
  dark: (m) => m.calibration_add_darks(),
  flat: (m) => m.calibration_add_flats(),
  bias: (m) => m.calibration_add_bias(),
}

export function CalibrationChoices({ label, rows, groupBySession, changeable = true, onConfirm, onPick, onNo, onAddFiles, selection, loading, error, empty }: CalibrationChoicesProps) {
  const m = useMessages()
  const order = [...new Set(rows.map((r) => r.sessionId))]
  const grouped = groupBySession ?? order.length > 1
  const pick = (r: CalibrationChoiceRow): SessionKind => ({ sessionId: r.sessionId, kind: r.kind })
  const name = (r: CalibrationChoiceRow) => (grouped ? `${say(m, r.session)} · ${say(m, KIND_NAME[r.kind])}` : say(m, KIND_NAME[r.kind]))
  const evidenceOf = (r: CalibrationChoiceRow) => (r.choice.state === "pinned" || r.choice.state === "suggested" ? r.choice.evidence : null)
  const evidenceText = (r: CalibrationChoiceRow) => {
    const evidence = evidenceOf(r)
    if (evidence) return say(m, evidenceRef(r.kind, evidence))
    return r.choice.state === "waiting" ? m.calibration_choices_no_match() : "–"
  }
  const columns: Column<CalibrationChoiceRow>[] = [
    { id: "kind", header: m.run_col_kind(), rowHeader: true, cell: (r) => say(m, KIND_NAME[r.kind]), sortValue: (r) => PIN_KINDS.indexOf(r.kind) },
    { id: "state", header: m.calibration_choices_col_state(), cell: (r) => <CalibrationChoiceBadge kind={r.kind} choice={r.choice} health={r.health} />, sortValue: (r) => r.choice.state },
    {
      id: "source",
      header: m.evidence_column_source(),
      truncate: true,
      cell: (r) => (r.source ? (r.sourceLink ? <PlaceLink link={r.sourceLink}>{say(m, r.source)}</PlaceLink> : say(m, r.source)) : "–"),
      sortValue: (r) => (r.source ? say(m, r.source) : null),
    },
    { id: "evidence", header: m.evidence_column_evidence(), truncate: true, cell: evidenceText, sortValue: evidenceText },
  ]
  const confirm = (picks: SessionKind[]): Action => ({ id: "confirm", label: m.verb_confirm(), icon: Check, kind: "primary", run: () => onConfirm(picks) })
  const no = (r: CalibrationChoiceRow): Action => ({ id: `no-${choiceRowId(r)}`, label: say(m, NO_KIND_NAME[r.kind]), icon: CircleSlash, run: () => onNo([pick(r)]) })
  const rowActions = (r: CalibrationChoiceRow): MenuItem[] => {
    if (!changeable) return []
    return [
      ...(r.offers.length > 0
        ? [
            {
              submenu: m.verb_choose(),
              items: r.offers.map((offer) => ({
                id: `choose-${choiceRowId(r)}-${offer.key}`,
                label: offer.verdict === "pin" ? say(m, offer.label) : m.calibration_choices_offer_suggested({ source: say(m, offer.label) }),
                run: () => onPick({ ...pick(r), source: offer.source, expectRevision: r.revision }),
              })),
            },
          ]
        : []),
      ...(onAddFiles ? [{ id: `add-${choiceRowId(r)}`, label: ADD_FILES[r.kind](m), opensDialog: true, run: () => onAddFiles(pick(r)) }] : []),
      ...(r.choice.state === "none" ? [] : [no(r)]),
    ]
  }
  const byId = new Map(rows.map((r) => [choiceRowId(r), r]))
  const batchActions = (ids: string[]): Action[] => {
    const chosen = ids.flatMap((id) => byId.get(id) ?? [])
    const suggested = chosen.filter((r) => r.choice.state === "suggested")
    const confirmAll = confirm(suggested.map(pick))
    return [
      suggested.length > 0 ? confirmAll : { ...confirmAll, unavailable: { action: m.actions_blocked({ action: m.verb_confirm() }), reason: m.calibration_choices_none_suggested(), blockers: [] } },
      { id: "set-no", label: m.calibration_choices_set_no_action(), icon: CircleSlash, run: () => onNo(chosen.map(pick)) },
    ]
  }
  return (
    <DataTable
      label={label}
      rows={rows}
      columns={columns}
      getRowId={choiceRowId}
      rowLabel={name}
      groups={
        grouped
          ? {
              key: (r) => r.sessionId,
              label: (_, group) => (group[0]!.sessionLink ? <PlaceLink link={group[0]!.sessionLink}>{say(m, group[0]!.session)}</PlaceLink> : say(m, group[0]!.session)),
              compare: (a, b) => order.indexOf(a) - order.indexOf(b),
            }
          : undefined
      }
      rowActions={rowActions}
      primaryRowAction={(r) => (changeable && r.choice.state === "suggested" ? { ...confirm([pick(r)]), id: `confirm-${choiceRowId(r)}`, kind: "standard" } : null)}
      expand={{ isExpandable: (r) => evidenceOf(r) !== null, render: (r) => <EvidenceDetail row={r} evidence={evidenceOf(r)!} label={m.calibration_choices_evidence_of({ name: name(r) })} /> }}
      selection={changeable && selection ? { ...selection, rowLabel: name } : undefined}
      batchActions={changeable && selection ? batchActions : undefined}
      scroll="none"
      loading={loading}
      error={error}
      empty={empty ?? m.calibration_choices_empty()}
    />
  )
}
