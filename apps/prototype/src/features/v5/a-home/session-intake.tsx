/**
 * Session intake as a StepPage (§5.3, P-REV2, C10, C14, C15): Target → Rig
 * → Review on `/sessions/$sessionId?step=`, driven by the store's
 * `sessionIntake` flow. A session joins a Project only once Ready (and
 * settled). Review is always allowed, also once the session is Ready
 * (reopening review): an open Project holding the session gets its marks
 * as pending changes, labelled as the Library's, until its next Apply; a
 * Closed one keeps its Close snapshot. The Review step's notice names both.
 *
 * - Target: the Target the picker holds, preselected from the session's own
 *   association or its pointing (P-IMP2). The Target box shows only its
 *   sources, the pointing and the user's choice, and marks the one that
 *   wins as Used (SD4), with a mismatch warning when the chosen Target does
 *   not hold the pointing; OBJECT is a label, never a source. Proceed
 *   confirms it, or files an Unclassified session's frames under it (File
 *   into Target, with its moves in the confirm). A Target associated by
 *   agreeing pointing already counts as settled (`sessionTargetId`).
 * - Rig: the rig select with its header evidence. A FILTER value the
 *   session's confirmed rig does not list shows as unknown, with Settings ›
 *   Equipment's offers (injected by the route, D-W127, PLAN-EQ-FR-04): "Add
 *   {filter}" for a matching record of another rig, which it reuses, and "Add
 *   {value} to {rig}", the filter dialog prefilled with the likely bands.
 * - Both list the corrections intake recorded, recorded beside corrected (C15).
 * - Review: the review workspace, hosted as the step body (`review`, injected
 *   by the route so features stay apart). Finish review needs 0 Unreviewed,
 *   then opens the next session in the review queue (C14), or this session's
 *   detail when the queue is empty.
 * The flow has no order, so a settled step stays editable: its toolbar then
 * offers Confirm Target or Confirm rig, since Proceed belongs to the current
 * step only.
 */
import { useParams, useSearch } from "@tanstack/react-router"
import { Check, Eye, Settings2 } from "lucide-react"
import { type ComponentType, useState } from "react"
import { MissingRecord } from "@/app/missing-record"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/components/app/links"
import { ActionBar, useAction } from "@/components/app/actions"
import type { Action, AddFilterToRigProps, Column, SessionReviewProps, StepFlow } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { EvidenceList } from "@/components/app/evidence-list"
import { SelectField } from "@/components/app/fields"
import { Section } from "@/components/app/page"
import { type TargetOption, TargetPicker } from "@/components/app/pickers"
import type { PageNotice } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import { useFlowActions } from "@/components/app/step-flow"
import { StepPage } from "@/components/templates/step-page"
import type { CorrectedValue, SessionIntakeStepId } from "@/domain/derive"
import { isLocked, isTrashedSession, rigFilterFor, SESSION_INTAKE_STEPS, sessionIntakeState, sessionReadiness, sessionRigId, sessionTargetId, sessionUnreviewedFrames } from "@/domain/derive"
import { pointingAgainst, targetAtPointing } from "@/domain/indexing"
import { sessionLongLabel } from "@/domain/membership"
import { matchesQuery } from "@/domain/sky"
import type { CorrectionField, OpticalTrainId, Session, Target, TargetId } from "@/domain/types"
import { formatBytes } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { sessionIntake } from "@/store/actions/flows"
import { confirmRig, confirmTarget, filedUnclassified, fileIntoTarget, filingMoves } from "@/store/actions/library"
import { type PrototypeState, useStore } from "@/store/core"
import { addToProjectItems } from "./parts"
import { ReadinessBadge, SessionPage } from "./session"
import { projectsHolding } from "./session-model"

/** The intake Review step's body: the review workspace for one session (`SessionReview`, injected by the route). */
export type SessionReviewBody = ComponentType<SessionReviewProps>

/** The Rig step's offers for an unknown FILTER value (`AddFilterToRig` of Settings › Equipment, injected by the route; D-W127). */
export type AddFilterToRigBody = ComponentType<AddFilterToRigProps>

const TARGET_FIELDS: CorrectionField[] = ["target"]
const RIG_FIELDS: CorrectionField[] = ["equipment", "filter", "exposure", "focal-length"]

function stepOf(value: unknown): SessionIntakeStepId | null {
  return SESSION_INTAKE_STEPS.find((id) => id === value) ?? null
}

export function SessionIntakePage({ review, addFilter }: { review: SessionReviewBody; addFilter: AddFilterToRigBody }) {
  const { sessionId = "" } = useParams({ strict: false }) as { sessionId?: string }
  const session = useStore((s) => s.catalog.sessions[sessionId])
  const m = useMessages()
  if (!session) return <MissingRecord title={m.session_missing_title()} backTo="/sessions" backLabel={m.nav_sessions()} />
  // Raw calibration frames have no intake: they are input to a calibration process (P-CAL3).
  if (session.imageType !== "light") return <SessionPage />
  // Keyed by session: the pickers start from this session's own values, never the previous session's.
  return <SessionIntake key={session.id} session={session} review={review} addFilter={addFilter} />
}

/** The picker's first Target: the session's own association, else the Target its pointing falls in (P-IMP2). */
function initialTarget(state: PrototypeState, session: Session): TargetId | null {
  if (session.target.value) return session.target.value
  return session.pointing ? (targetAtPointing(state.catalog, session.pointing.ra, session.pointing.dec)?.id ?? null) : null
}

function SessionIntake({ session, review: Review, addFilter }: { session: Session; review: SessionReviewBody; addFilter: AddFilterToRigBody }) {
  const m = useMessages()
  const follow = useFollowLink()
  const search = useSearch({ strict: false }) as { step?: string }
  const state = useStore((s) => s)
  const [targetId, setTargetId] = useState<TargetId | null>(() => initialTarget(state, session))
  const [rigId, setRigId] = useState<OpticalTrainId | null>(session.equipment.value)
  const runner = useAction()

  const built = sessionIntake(state, session, m, { targetId, rigId })
  const viewing = stepOf(search.step) ?? built.current
  const flow = withHostWork(m, state, session, built, targetId)
  const { proceed } = useFlowActions(flow)

  const body =
    viewing === "target" ? (
      <TargetStep state={state} session={session} targetId={targetId} onTarget={setTargetId} current={flow.current === "target"} />
    ) : viewing === "rig" ? (
      <RigStep state={state} session={session} rigId={rigId} onRig={setRigId} current={flow.current === "rig"} addFilter={addFilter} />
    ) : (
      <>
        <Review sessionId={session.id} onFinished={() => proceed && runner.run(proceed)} />
        {runner.dialog}
      </>
    )

  return (
    <StepPage
      path={[{ label: m.nav_sessions(), link: { to: "/sessions" } }]}
      title={sessionLongLabel(m, session)}
      status={<ReadinessBadge readiness={sessionReadiness(state.catalog, session)} unreviewed={sessionUnreviewedFrames(state.catalog, session)} trashed={isTrashedSession(state.catalog, session)} />}
      menu={{
        label: m.session_label(),
        items: [{ id: "details", label: m.session_details(), icon: Eye, run: () => follow({ to: "/sessions/$sessionId", params: { sessionId: session.id } }) }, { separator: true }, ...addToProjectItems(m, state.catalog, [session.id])],
      }}
      notice={viewing === "review" ? holdersNotice(m, state, session) : null}
      flow={flow}
      viewing={viewing}
      stepsLabel={m.session_intake_steps()}
      fill={viewing === "review"}
      step={body}
    />
  )
}

/**
 * Review's notice when Projects hold the session (VSEL-FR-12, LIB-AC-30):
 * marks are never refused; open Projects get them as pending changes until
 * their next Apply, and Closed ones keep their Close snapshot. The notice
 * names each group as a label and its Projects: "Pending changes: M 42 ·
 * Close snapshot kept: Rosette".
 */
function holdersNotice(m: Messages, state: PrototypeState, session: Session): PageNotice | null {
  const holders = projectsHolding(state.catalog, session.id)
  if (holders.length === 0) return null
  const open = holders.filter((p) => !isLocked(p)).map((p) => p.name)
  const closed = holders.filter((p) => isLocked(p)).map((p) => p.name)
  return {
    tone: "info",
    title: m.intake_review_held_title({ count: holders.length }),
    detail: [...(open.length > 0 ? [m.intake_review_held_open({ names: open.join(", ") })] : []), ...(closed.length > 0 ? [m.intake_review_held_closed({ names: closed.join(", ") })] : [])].join(" · "),
  }
}

/**
 * The page's part of the flow: File into Target's moves in Proceed's confirm
 * (the builder files without one), and the session's own detail as where
 * Finish review goes once the review queue is empty (C14).
 */
function withHostWork(m: Messages, state: PrototypeState, session: Session, flow: StepFlow, targetId: TargetId | null): StepFlow {
  const detail = { to: "/sessions/$sessionId", params: { sessionId: session.id } }
  const next = flow.current === "review" && flow.next === null ? detail : flow.next
  const target = targetId ? state.catalog.targets[targetId] : undefined
  if (flow.current !== "target" || !flow.proceed || !target || !filedUnclassified(state, session)) return { ...flow, next }
  return { ...flow, next, proceed: { ...flow.proceed, confirm: fileIntoConfirm(m, state, session, target.name) } }
}

function fileIntoConfirm(m: Messages, state: PrototypeState, session: Session, targetName: string): NonNullable<Action["confirm"]> {
  const moves = filingMoves(state, session, targetName)
  const size = moves.reduce((n, mv) => n + mv.sizeBytes, 0)
  const folder = (path: string) => path.slice(0, path.lastIndexOf("/"))
  return {
    title: m.session_file_into_title({ count: moves.length, n: moves.length, name: targetName }),
    summary: formatBytes(size),
    groups: [{ label: m.session_confirms_target({ name: targetName }), rows: moves.map((mv) => ({ file: mv.to.slice(mv.to.lastIndexOf("/") + 1), from: folder(mv.from.path), to: folder(mv.to), action: "move", size: mv.sizeBytes })) }],
    confirm: { label: m.session_file_into({ name: targetName }) },
  }
}

// ---------------------------------------------------------------------------
// Target
// ---------------------------------------------------------------------------

/** Library Targets whose names answer the query: the picker's one source here, since intake files under a library Target. */
function libraryResults(state: PrototypeState, query: string): TargetOption[] {
  if (!query.trim()) return []
  return Object.values(state.catalog.targets)
    .filter((t) => matchesQuery([t.name, ...t.aliases], query))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 12)
    .map((t) => ({ id: t.id, name: t.name, detail: t.aliases[0] }))
}

/** One source of the session's Target and what it names (SD4): the one that wins is marked Used. */
interface TargetSource {
  id: "pointing" | "user"
  source: string
  value: string
  used: boolean
  /** The chosen Target's footprint does not hold the pointing (P-IMP2: allowed, with a warning). */
  mismatch: boolean
}

/**
 * The Target's sources: the pointing (what it falls in, or why nothing) and
 * the user's choice once there is one, confirmed or picked here other than
 * the pointing's Target. The choice wins; without one, the pointing wins
 * when it names the Target the step holds. OBJECT is a label, never a source.
 */
function targetSources(m: Messages, state: PrototypeState, session: Session, target: Target | undefined): TargetSource[] {
  const pointed = session.pointing ? targetAtPointing(state.catalog, session.pointing.ra, session.pointing.dec) : null
  const pointing = session.target.evidence.find((e) => e.source === "pointing")
  const chosen = target && (session.target.status === "confirmed" || target.id !== pointed?.id) ? target : undefined
  const against = chosen ? pointingAgainst(chosen, session.pointing) : null
  return [
    { id: "pointing", source: m.evidence_source_pointing(), value: pointing ? say(m, pointing.value) : m.session_none(), used: !chosen && pointed !== null && target?.id === pointed.id, mismatch: false },
    ...(chosen ? [{ id: "user" as const, source: m.evidence_source_user(), value: chosen.name, used: true, mismatch: against !== null && !against.inside }] : []),
  ]
}

function TargetStep({ state, session, targetId, onTarget, current }: { state: PrototypeState; session: Session; targetId: TargetId | null; onTarget: (id: TargetId) => void; current: boolean }) {
  const m = useMessages()
  const [query, setQuery] = useState("")
  const target = targetId ? state.catalog.targets[targetId] : undefined
  const settled = sessionTargetId(session)
  const filing = filedUnclassified(state, session)
  // Off the current step Proceed is gone, so the change is the step's own operation (F8).
  const changed = target !== undefined && (settled !== target.id || session.target.status !== "confirmed")
  const confirm: Action | null =
    !current && changed && target
      ? filing
        ? { id: "file-into", label: m.session_file_into({ name: target.name }), icon: Check, confirm: fileIntoConfirm(m, state, session, target.name), run: () => fileIntoTarget(session.id, target.id, session.revision) }
        : { id: "confirm-target", label: m.session_confirm_target(), icon: Check, run: () => confirmTarget(session.id, target.id, session.revision) }
      : null
  const columns: Column<TargetSource>[] = [
    { id: "source", header: m.evidence_column_source(), rowHeader: true, sortValue: (s) => s.source, cell: (s) => s.source },
    {
      id: "value",
      header: m.evidence_column_value(),
      sortValue: (s) => s.value,
      cell: (s) => {
        const mismatch = s.mismatch ? <StatusBadge kind="association" value="needs-review" label={m.session_pointing_mismatch()} /> : null
        const used = s.used ? <StatusBadge kind="assignment" value="accepted" label={m.session_source_used()} /> : null
        return (
          <>
            {s.value} {mismatch} {used}
          </>
        )
      },
    },
  ]
  return (
    <>
      <Section title={m.sessions_column_target()} actions={confirm ? <ActionBar actions={[confirm]} /> : undefined}>
        <DataTable label={m.session_target_sources({ name: sessionLongLabel(m, session) })} rows={targetSources(m, state, session, target)} columns={columns} getRowId={(s) => s.id} scroll="none" />
        <TargetPicker
          label={m.session_choose_a_target()}
          query={query}
          onQueryChange={setQuery}
          groups={[{ source: "mine", items: libraryResults(state, query) }]}
          onPick={(option) => onTarget(option.id)}
        />
      </Section>
      <Corrections session={session} fields={TARGET_FIELDS} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Rig
// ---------------------------------------------------------------------------

const NO_RIG = "none"
const RIG_SECTION = "session-rig"

function RigStep({ state, session, rigId, onRig, current, addFilter: AddFilter }: { state: PrototypeState; session: Session; rigId: OpticalTrainId | null; onRig: (id: OpticalTrainId) => void; current: boolean; addFilter: AddFilterToRigBody }) {
  const m = useMessages()
  const follow = useFollowLink()
  const rigs = Object.values(state.catalog.opticalTrains).sort((a, b) => a.name.localeCompare(b.name))
  const rig = rigId ? state.catalog.opticalTrains[rigId] : undefined
  const channel = session.channel
  // Unknown only against the session's confirmed rig: no prompt names a rig before then (LIB-FR-05, J15 S4b).
  const confirmedRig = rig !== undefined && session.equipment.status === "confirmed" && session.equipment.value === rig.id ? rig : undefined
  const unknownFilter = confirmedRig !== undefined && channel !== null && rigFilterFor(state.catalog, confirmedRig, channel) === null ? channel : null
  const changed = rig !== undefined && (sessionRigId(session) !== rig.id || session.equipment.status !== "confirmed")
  const confirm: Action | null = !current && changed && rig ? { id: "confirm-rig", label: m.session_confirm_rig(), icon: Check, run: () => confirmRig(session.id, rig.id, session.revision) } : null
  const equipment: Action = { id: "equipment", label: m.session_open_equipment(), icon: Settings2, run: () => follow({ to: "/settings/equipment" }) }
  // D-W127: Settings › Equipment's offers for the unknown value, an existing matching filter or a new one; the value stays unknown until one is added.
  // Adding removes the prompt, so focus lands on the Rig heading, above the filter it now names.
  const actions = (
    <AddFilter unknown={unknownFilter !== null && confirmedRig ? { value: unknownFilter, rigId: confirmedRig.id } : null} focusAfterAdd={() => document.getElementById(`${RIG_SECTION}-title`)}>
      {(add) => <ActionBar actions={[...(confirm ? [confirm] : []), ...add, equipment]} />}
    </AddFilter>
  )
  return (
    <>
      <Section id={RIG_SECTION} title={m.sessions_column_rig()} actions={actions}>
        <SelectField
          label={m.sessions_column_rig()}
          value={rigId ?? NO_RIG}
          options={[{ value: NO_RIG, label: m.session_choose_a_rig(), disabled: true }, ...rigs.map((r) => ({ value: r.id, label: r.name }))]}
          onChange={(value) => value !== NO_RIG && onRig(value as OpticalTrainId)}
        />
        <KeyValueList
          columns={2}
          items={[
            { label: m.session_rig_status(), value: <StatusBadge kind="association" value={session.equipment.status} /> },
            { label: m.session_camera(), value: session.cameraName ?? m.status_unknown() },
            { label: m.session_telescope(), value: session.telescopeName ?? m.status_unknown() },
            {
              label: m.session_filter(),
              value: unknownFilter !== null ? <StatusBadge kind="association" value="unresolved" label={m.session_unknown_filter({ value: unknownFilter })} /> : (channel ?? m.session_none()),
            },
          ]}
        />
      </Section>
      <Section title={m.session_evidence()}>
        <EvidenceList evidence={session.equipment.evidence} caption={m.session_rig_evidence({ name: sessionLongLabel(m, session) })} />
      </Section>
      <Corrections session={session} fields={RIG_FIELDS} />
    </>
  )
}

// ---------------------------------------------------------------------------
// Corrections (C15)
// ---------------------------------------------------------------------------

function fieldName(m: Messages, field: CorrectionField): string {
  const name: Record<CorrectionField, () => string> = {
    target: m.run_field_target,
    equipment: m.run_field_equipment,
    filter: m.run_field_filter,
    exposure: m.run_field_exposure,
    "focal-length": m.run_field_focal_length,
  }
  return name[field]()
}

/** The values intake corrected, recorded beside corrected; Prepare applies them (C15). Nothing shows while there are none. */
function Corrections({ session, fields }: { session: Session; fields: CorrectionField[] }) {
  const m = useMessages()
  const values = useStore((s) => sessionIntakeState(s, session).corrections.filter((c) => fields.includes(c.field)))
  if (values.length === 0) return null
  const columns: Column<CorrectedValue>[] = [
    { id: "field", header: m.session_correction_field(), rowHeader: true, sortValue: (c) => fieldName(m, c.field), cell: (c) => fieldName(m, c.field) },
    { id: "recorded", header: m.session_correction_recorded(), truncate: true, sortValue: (c) => c.recorded, cell: (c) => c.recorded ?? "–" },
    { id: "corrected", header: m.session_correction_corrected(), truncate: true, sortValue: (c) => c.corrected, cell: (c) => c.corrected },
  ]
  return (
    <Section title={m.session_corrections()}>
      <DataTable label={m.session_corrections()} rows={values} columns={columns} getRowId={(c) => c.field} scroll="none" />
    </Section>
  )
}
