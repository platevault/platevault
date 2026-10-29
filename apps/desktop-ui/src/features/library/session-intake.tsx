/**
 * Session intake as a StepPage (`/sessions/$sessionId?step=`; LIB-FR-05,
 * C10, C14): Target → Rig → Review, in that order. The library's
 * admission (`pix_session_intake`) says which steps are done, so the
 * current step is the first it does not count as done; later steps stay
 * read-only until then.
 *
 * - Target: the session's own Target assessments (each with its state and
 *   evidence) and a search over saved and catalogue Targets. Proceed
 *   confirms the chosen one (`library_associate_target`), saving a
 *   catalogue Target first when the library has no record of it.
 * - Rig: every saved rig (`library_list_equipment`), the ones the session's
 *   equipment evidence names first as suggested. Proceed confirms the
 *   chosen one (`library_confirm_equipment`); with no rig saved, the step
 *   says where rigs are added.
 * - Review: the review workspace the router injects (`SessionIntakeProps`).
 *   It runs its own Finish review and then calls `onFinished` (409cm.6), so
 *   the footer offers no Proceed of its own there; intake then opens the
 *   session's detail. While Target or rig is still to confirm, the
 *   workspace is read-only (`readOnly`): no mark and no Finish review.
 *
 * Each confirmation names the session's grouping and decision revisions as
 * read. A stale one is refused as `conflict`: the refusal shows beside the
 * footer, the reads refresh, and the user's choice stays picked. A settled
 * step stays editable through its own Change action while it is shown.
 */
import { useNavigate } from "@tanstack/react-router"
import { type UseQueryResult, useQuery, useQueryClient } from "@tanstack/react-query"
import { type ReactNode, useState } from "react"
import { equipmentQuery } from "@/api/equipment"
import { type Equipment, type EvidenceItem, type ExpectedSession, type LibrarySession_Serialize, library, type SessionAdmission_Serialize, type TargetCandidate } from "@/api/ipc"
import { libraryQuery } from "@/api/query"
import type { SessionIntakeProps } from "@/app/shell-contract"
import { useMessages } from "@/app/preferences"
import { ActionBar } from "@/components/app/actions"
import { BoxTable } from "@/components/app/box"
import type { Action, Column, FlowStep, StepFlow } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { ActionError } from "@/components/app/feedback"
import { ComboboxField } from "@/components/app/fields"
import { Section } from "@/components/app/page"
import { type TargetOption, TargetPicker } from "@/components/app/pickers"
import { StatusBadge } from "@/components/app/status"
import { ReadinessBadge } from "@/components/domain/readiness-badge"
import { NoSavedRigs } from "@/components/domain/saved-rigs"
import { StepPage } from "@/components/templates/step-page"
import type { Messages } from "@/lib/i18n"
import { readError } from "./parts"
import { homeWrite, invalidateLibraryReads } from "./queries"
import { admissionReadiness } from "./words"
import { sessionLabel } from "@/components/domain/session-label"

export const INTAKE_STEPS = ["target", "rig", "review"] as const
export type IntakeStep = (typeof INTAKE_STEPS)[number]

/** The session as its next write must name it: a regroup or a decision since this read makes the write a `conflict`. */
export function expectedSession(session: LibrarySession_Serialize): ExpectedSession {
  const s = session.detail.summary.session
  return { sessionId: s.id, groupingRevision: s.groupingRevision, decisionRevision: s.decisionRevision }
}

/** The session's confirmed Target with its designation, as its assessments name it; null without one. */
export function confirmedTarget(session: LibrarySession_Serialize): { id: string; designation: string } | null {
  const association = session.detail.associations.find((a) => a.kind === "target" && a.state === "confirmed" && a.subjectId !== null)
  if (!association?.subjectId) return null
  const candidate = session.targetAssessments.find((t) => t.candidate.id === association.subjectId)?.candidate
  return { id: association.subjectId, designation: candidate?.designation ?? "–" }
}

/** The step the library's readiness says the session still needs (C10); null once it is Ready. The rule stays the library's. */
export function currentStep(admission: SessionAdmission_Serialize): IntakeStep | null {
  const readiness = admissionReadiness(admission)
  return readiness === "needs_target" ? "target" : readiness === "needs_rig" ? "rig" : readiness === "needs_review" ? "review" : null
}

function stepLabel(m: Messages, step: IntakeStep): string {
  return step === "target" ? m.sessions_column_target() : step === "rig" ? m.sessions_column_rig() : m.sessions_column_review()
}

/** A chosen Target: catalogue ones (`seed`) are saved before they can be confirmed. */
interface ChosenTarget {
  id: string
  designation: string
  seed: boolean
}

function chosenFrom(candidate: TargetCandidate): ChosenTarget {
  return { id: candidate.id, designation: candidate.designation, seed: candidate.provenance.source === "seed" }
}

/** The Target the picker starts from: the confirmed one, else the first assessment that is not unresolved. */
function initialTarget(session: LibrarySession_Serialize): ChosenTarget | null {
  const confirmed = confirmedTarget(session)
  if (confirmed) return { ...confirmed, seed: false }
  const suggested = session.targetAssessments.find((t) => t.state !== "unresolved")
  return suggested ? chosenFrom(suggested.candidate) : null
}

/** The rigs the session's equipment evidence names: the confirmed one first. */
function evidenceRigs(session: LibrarySession_Serialize): string[] {
  const rigs = session.detail.associations.filter((a) => a.kind === "equipment" && a.subjectId !== null)
  rigs.sort((a, b) => (a.state === "confirmed" ? -1 : 0) - (b.state === "confirmed" ? -1 : 0))
  return [...new Set(rigs.map((a) => a.subjectId!))]
}

export function SessionIntake({ session, admission, viewing, review: Review, refreshError }: { session: LibrarySession_Serialize; admission: SessionAdmission_Serialize; viewing: IntakeStep; refreshError: ReactNode } & SessionIntakeProps) {
  const m = useMessages()
  const client = useQueryClient()
  const navigate = useNavigate()
  const sessionId = session.detail.summary.session.id
  const [target, setTarget] = useState<ChosenTarget | null>(() => initialTarget(session))
  const rigIds = evidenceRigs(session)
  const [rigId, setRigId] = useState<string | null>(() => admission.intake.rigId ?? rigIds[0] ?? null)
  const equipment = useQuery(equipmentQuery())
  // Only a rig the list holds can be confirmed: the user sees what Proceed names.
  const chosenRig = equipment.data?.find((rig) => rig.id === rigId) ?? null
  const current = currentStep(admission)
  const detail = { to: "/sessions/$sessionId", params: { sessionId } }
  const linkFor = (step: string) => ({ ...detail, search: { step } })

  const confirmTarget: Action = {
    id: "confirm-target",
    label: m.session_confirm_target(),
    unavailable: target ? undefined : { action: m.actions_blocked({ action: m.session_confirm_target() }), reason: m.session_choose_a_target(), blockers: [] },
    run: async () => {
      if (!target) return
      const expected = [expectedSession(session)]
      const associate = () => homeWrite(client, () => library.libraryAssociateTarget(expected, target.id))
      if (!target.seed) return associate()
      // A catalogue Target is confirmed once it is saved; one saved before keeps its record.
      const first = await associate()
      if (first.ok || first.failure.source !== "library" || first.failure.error.code !== "not_found") return first
      const saved = await homeWrite(client, () => library.librarySaveTarget({ source: "seed", id: target.id }, null))
      if (!saved.ok) return saved
      return homeWrite(client, () => library.libraryAssociateTarget(expected, saved.data.candidate.id))
    },
  }
  const confirmRig: Action = {
    id: "confirm-rig",
    label: m.session_confirm_rig(),
    unavailable: chosenRig
      ? undefined
      : { action: m.actions_blocked({ action: m.session_confirm_rig() }), reason: equipment.error ? readError(m, equipment.error) : equipment.isPending ? m.home_reading() : m.session_choose_a_rig(), blockers: [] },
    run: () => (chosenRig ? homeWrite(client, () => library.libraryConfirmEquipment([expectedSession(session)], chosenRig.id)) : undefined),
  }
  const stepState = (step: IntakeStep): FlowStep["state"] => {
    if (current === null) return "finished"
    const at = INTAKE_STEPS.indexOf(step)
    const now = INTAKE_STEPS.indexOf(current)
    return at < now ? "finished" : at === now ? "current" : "todo"
  }
  const nextStep = current === "target" ? "rig" : current === "rig" ? "review" : null
  const flow: StepFlow = {
    steps: INTAKE_STEPS.map((step) => ({ id: step, label: stepLabel(m, step), state: stepState(step) })),
    current: current ?? "review",
    ordered: true,
    // Review's Finish is the workspace's own (409cm.6): no footer Proceed there.
    proceed: current === "target" ? confirmTarget : current === "rig" ? confirmRig : null,
    next: nextStep ? linkFor(nextStep) : null,
    linkFor,
  }
  const onFinished = () => {
    void invalidateLibraryReads(client).then(() => navigate(detail))
  }
  const body =
    viewing === "target" ? (
      <TargetStep session={session} target={target} onTarget={setTarget} change={current !== "target" ? confirmTarget : null} />
    ) : viewing === "rig" ? (
      <RigStep equipment={equipment} suggested={rigIds} rigId={chosenRig?.id ?? null} onRig={setRigId} locked={current === "target"} change={current !== "rig" && current !== "target" ? confirmRig : null} />
    ) : (
      // A later step stays read-only until the current one is confirmed (C3); the footer and the workspace name it.
      <Review sessionId={sessionId} onFinished={onFinished} readOnly={current === "target" || current === "rig" ? { reason: m.stepflow_finish_first({ step: stepLabel(m, current) }) } : null} />
    )
  return (
    <StepPage
      path={[{ label: m.nav_sessions(), link: { to: "/sessions" } }]}
      title={sessionLabel(m, session.detail.summary.session)}
      status={<ReadinessBadge readiness={admissionReadiness(admission)} unreviewed={admission.intake.unreviewedFrames} trashed={session.detail.summary.availability === "trashed"} />}
      flow={flow}
      viewing={viewing}
      stepsLabel={m.session_intake_steps()}
      fill={viewing === "review"}
      step={
        <>
          {refreshError}
          {body}
        </>
      }
    />
  )
}

// Target -----------------------------------------------------------------------

function TargetStep({ session, target, onTarget, change }: { session: LibrarySession_Serialize; target: ChosenTarget | null; onTarget: (target: ChosenTarget) => void; change: Action | null }) {
  const m = useMessages()
  const [query, setQuery] = useState("")
  const needle = query.trim()
  const results = useQuery({ ...searchTargetsQuery(needle), enabled: needle !== "" })
  const hits = results.data ?? []
  const option = (c: TargetCandidate): TargetOption => ({ id: c.id, name: c.designation, detail: c.commonName ?? undefined })
  const groups = [
    { source: "mine" as const, items: hits.filter((h) => h.candidate.provenance.source !== "seed").map((h) => option(h.candidate)) },
    { source: "catalogue" as const, items: hits.filter((h) => h.candidate.provenance.source === "seed").map((h) => option(h.candidate)) },
  ]
  type Row = (typeof session.targetAssessments)[number]
  const columns: Column<Row>[] = [
    { id: "target", header: m.sessions_column_target(), rowHeader: true, truncate: true, sortValue: (r) => r.candidate.designation, cell: (r) => r.candidate.designation },
    {
      id: "state",
      header: m.home_column_status(),
      sortValue: (r) => r.state,
      cell: (r) => <StatusBadge kind="association" value={r.state === "confirmed" ? "confirmed" : r.state === "suggested" ? "associated" : r.state === "needs_review" ? "needs-review" : "unresolved"} />,
    },
    { id: "evidence", header: m.session_evidence(), truncate: true, static: true, cell: (r) => evidenceText(m, r.evidence) },
  ]
  return (
    <>
      <Section title={m.session_chosen_target()} actions={change ? <ActionBar actions={[change]} /> : undefined}>
        <KeyValueList items={[{ label: m.sessions_column_target(), value: target ? target.designation : m.session_no_target_chosen() }]} />
      </Section>
      <TargetPicker
        label={m.session_choose_a_target()}
        query={query}
        onQueryChange={setQuery}
        groups={groups}
        onPick={(picked) => {
          const hit = hits.find((h) => h.candidate.id === picked.id)
          if (hit) onTarget(chosenFrom(hit.candidate))
        }}
      />
      <Section title={m.session_target_sources({ name: sessionLabel(m, session.detail.summary.session) })}>
        <BoxTable
          label={m.session_target_sources({ name: sessionLabel(m, session.detail.summary.session) })}
          rows={session.targetAssessments}
          columns={columns}
          getRowId={(r) => r.candidate.id}
          rowLabel={(r) => r.candidate.designation}
          primaryRowAction={(r) => (target?.id === r.candidate.id ? null : { id: "use", label: m.import_use_this_target(), run: () => onTarget(chosenFrom(r.candidate)) })}
          empty={m.session_no_object()}
        />
      </Section>
    </>
  )
}

const searchTargetsQuery = (text: string) => libraryQuery("librarySearchTargets", text, null, 20)

/** The evidence of an assessment as one line: what agrees and what is unknown, never the library's verdict text. */
function evidenceText(m: Messages, evidence: EvidenceItem[]): string {
  const parts = evidence.map((e) => {
    switch (e.kind) {
      case "alias":
        return e.agrees ? m.session_evidence_alias_agrees({ alias: e.normalized }) : m.session_evidence_alias({ alias: e.normalized })
      case "coordinates":
      case "footprint":
        return e.qualified ? m.session_evidence_pointing() : m.session_evidence_pointing_unqualified()
      case "header":
        return `${e.field}: ${e.value}`
      case "unknown":
        return m.session_evidence_unknown({ field: e.field })
      case "conflict":
        return m.session_evidence_conflict({ field: e.field })
    }
  })
  return parts.length > 0 ? parts.join(" · ") : "–"
}

// Rig --------------------------------------------------------------------------

/** Every saved rig to choose from: the ones the session's evidence names under Suggested, the rest after them. */
function RigStep({ equipment, suggested, rigId, onRig, locked, change }: { equipment: UseQueryResult<Equipment[]>; suggested: string[]; rigId: string | null; onRig: (id: string | null) => void; locked: boolean; change: Action | null }) {
  const m = useMessages()
  const saved = equipment.data ?? []
  const option = (rig: Equipment) => ({ value: rig.id, label: rig.name })
  const named = saved.filter((rig) => suggested.includes(rig.id)).map(option)
  const others = saved.filter((rig) => !suggested.includes(rig.id)).map(option)
  const groups = [
    { label: m.status_suggested(), items: named },
    { label: m.session_other_saved_rigs(), items: others },
  ].filter((group) => group.items.length > 0)
  const field = (disabled: boolean, placeholder?: string) => (
    <ComboboxField
      label={m.session_choose_a_rig()}
      value={rigId}
      onChange={onRig}
      groups={groups}
      placeholder={placeholder}
      disabled={disabled}
      description={equipment.isPending || named.length > 0 ? undefined : m.session_no_rig_evidence()}
    />
  )
  return (
    <Section title={m.session_rig_status()} actions={change ? <ActionBar actions={[change]} /> : undefined}>
      {equipment.error ? (
        <ActionError message={readError(m, equipment.error)} onRetry={() => void equipment.refetch()} />
      ) : equipment.isPending ? (
        field(true, m.common_loading())
      ) : saved.length === 0 ? (
        <NoSavedRigs />
      ) : (
        field(locked)
      )}
    </Section>
  )
}
