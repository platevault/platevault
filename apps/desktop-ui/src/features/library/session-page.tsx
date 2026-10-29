/**
 * S12 Session (`/sessions/$sessionId`; LIB-FR-04, LIB-FR-16, LIB-FR-23,
 * LIB-FR-24): one library light session's facts as a DetailPage, or its
 * intake as a StepPage with `?step=` (session-intake.tsx).
 *
 * The detail shows where intake stands (Target, rig, review) as the
 * library's admission reads it, the session's darks, flats and bias pins,
 * its frames and their effective values. The Session ▾ menu offers Correct
 * metadata… (correct-metadata.tsx) and Add to Project…. A session a
 * regroup replaced reads so, with links to its successors: it takes no
 * write, since every write names the revision it read.
 */
import { useParams, useSearch } from "@tanstack/react-router"
import { useQuery } from "@tanstack/react-query"
import { Layers, ListChecks, PencilLine } from "lucide-react"
import { type ReactNode, useState } from "react"
import { type Asset_Serialize, failureOf, type LibrarySession_Serialize, type SessionAdmission_Serialize } from "@/api/ipc"
import type { SessionIntakeProps } from "@/app/shell-contract"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { BoxTable } from "@/components/app/box"
import type { Action, Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { ActionError, DetailSkeleton, EmptyState, Notice, type PageNotice } from "@/components/app/feedback"
import { useFollowLink } from "@/components/app/links"
import { StatusBadge } from "@/components/app/status"
import { ReadinessBadge } from "@/components/domain/readiness-badge"
import { DetailPage } from "@/components/templates/detail-page"
import { fileName, formatCount, formatExposure } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { AddToProjectDialog } from "./add-to-project"
import { CorrectMetadataDialog } from "./correct-metadata"
import { readError } from "./parts"
import { admissionQuery, rigQuery, sessionQuery } from "./queries"
import { INTAKE_STEPS, type IntakeStep, SessionIntake, confirmedTarget, expectedSession } from "./session-intake"
import { admissionReadiness, pinText } from "./words"
import { sessionLabel } from "@/components/domain/session-label"

function stepOf(value: string | undefined): IntakeStep | null {
  return INTAKE_STEPS.find((step) => step === value) ?? null
}

/** The session page: its detail, or its intake on `?step=`. The router hands it the review body (`SessionIntakeProps`). */
export function SessionPage({ review }: SessionIntakeProps) {
  const m = useMessages()
  const { sessionId = "" } = useParams({ strict: false }) as { sessionId?: string }
  const search = useSearch({ strict: false }) as { step?: string }
  const session = useQuery(sessionQuery(sessionId))
  const admission = useQuery(admissionQuery(sessionId))
  const failure = failureOf(session.error)
  const retry = () => void Promise.all([session.refetch(), admission.refetch()])
  // The whole page gives way only while either read has nothing to show; a failed re-read keeps the page and its draft.
  if (!session.data || !admission.data) {
    if (failure?.source === "library" && failure.error.code === "not_found") return <EmptyState icon={Layers} title={m.session_missing_title()} titleAs="h1" action={null} />
    const error = session.error ?? admission.error
    if (error) return <EmptyState icon={Layers} title={readError(m, error)} titleAs="h1" action={<ActionButton action={{ id: "retry", label: m.verb_retry(), run: retry }} />} />
    return <DetailSkeleton label={m.common_loading()} />
  }
  const error = session.error ?? admission.error
  const refreshError = error ? <ActionError message={readError(m, error)} onRetry={retry} /> : null
  const step = stepOf(search.step)
  // Keyed by session, so the pickers start from this session's own values.
  if (step) return <SessionIntake key={sessionId} session={session.data} admission={admission.data} viewing={step} review={review} refreshError={refreshError} />
  return <SessionDetail session={session.data} admission={admission.data} refreshError={refreshError} />
}

/** The successors of a session a regroup replaced: it reads as history, and each write names a current one. */
export function supersededNotice(m: Messages, session: LibrarySession_Serialize, admission: SessionAdmission_Serialize, follow: (link: { to: string; params?: Record<string, string> }) => void): PageNotice | null {
  const successors = session.detail.summary.successors
  if (!admission.intake.superseded && successors.length === 0) return null
  return {
    tone: "warning",
    title: m.session_replaced_title(),
    detail: m.session_replaced_detail({ count: successors.length }),
    actions: successors.length > 0 ? (
      <>
        {successors.map((id, i) => (
          <ActionButton key={id} action={{ id: `successor-${id}`, label: m.session_open_successor({ n: i + 1 }), run: () => follow({ to: "/sessions/$sessionId", params: { sessionId: id } }) }} />
        ))}
      </>
    ) : null,
  }
}

function SessionDetail({ session, admission, refreshError }: { session: LibrarySession_Serialize; admission: SessionAdmission_Serialize; refreshError: ReactNode }) {
  const m = useMessages()
  const follow = useFollowLink()
  const [correcting, setCorrecting] = useState(false)
  const [adding, setAdding] = useState(false)
  const { summary, assets } = session.detail
  const label = sessionLabel(m, summary.session)
  const { intake } = admission
  const rig = useQuery({ ...rigQuery(intake.rigId ?? ""), enabled: intake.rigId !== null })
  const target = confirmedTarget(session)
  const trashed = summary.availability === "trashed"
  const superseded = admission.intake.superseded || summary.successors.length > 0
  const readiness = admissionReadiness(admission)
  const intakeLink = (step: IntakeStep) => ({ to: "/sessions/$sessionId", params: { sessionId: summary.session.id }, search: { step } })
  const review: Action = { id: "review", label: m.session_review_frames(), icon: ListChecks, kind: readiness === "needs_review" ? "primary" : "standard", run: () => follow(intakeLink("review")) }
  const menu: MenuItem[] = superseded || trashed ? [] : [
    { id: "correct", label: m.session_correct_metadata(), icon: PencilLine, opensDialog: true, run: () => setCorrecting(true) },
    { id: "add-to-project", label: m.session_add_to_project(), opensDialog: true, run: () => setAdding(true) },
  ]
  const intakeItems = [
    { label: m.sessions_column_target(), value: target ? target.designation : m.session_no_target() },
    { label: m.sessions_column_rig(), value: intake.rigId ? (rig.data?.equipment.name ?? "–") : m.session_no_rig() },
    {
      label: m.sessions_column_review(),
      value: intake.reviewFinished && intake.unreviewedFrames === 0 ? m.status_done() : m.session_frames_unreviewed({ count: intake.unreviewedFrames, frames: formatCount(intake.unreviewedFrames) }),
    },
    ...(intake.changedFrames > 0 ? [{ label: m.status_changed_content(), value: formatCount(intake.changedFrames) }] : []),
  ]
  const intakeActions: Action[] = superseded || trashed ? [] : [
    { id: "target", label: target ? m.session_change_target() : m.session_choose_target(), run: () => follow(intakeLink("target")) },
    { id: "rig", label: intake.rigId ? m.session_change_rig() : m.session_choose_a_rig(), run: () => follow(intakeLink("rig")) },
  ]
  const { calibration, health } = admission
  const calibrationItems = (["dark", "flat", "bias"] as const).map((kind) => {
    const name = kind === "dark" ? m.import_type_dark() : kind === "flat" ? m.import_type_flat() : m.import_type_bias()
    const problem = health[kind] === "intact" ? "" : ` · ${health[kind] === "changed" ? m.project_pin_changed({ kind: name }) : m.project_pin_missing({ kind: name })}`
    return { label: name, value: `${pinText(m, name, calibration[kind])}${problem}` }
  })
  return (
    <>
      <DetailPage
        path={[{ label: m.nav_sessions(), link: { to: "/sessions" } }]}
        title={label}
        status={<ReadinessBadge readiness={readiness} unreviewed={intake.unreviewedFrames} trashed={trashed} />}
        statusFeedback={refreshError}
        actions={superseded || trashed ? [] : [review]}
        menu={menu.length > 0 ? { label: m.session_label(), items: menu } : undefined}
        notice={supersededNotice(m, session, admission, follow) ?? (trashed ? { tone: "warning", title: m.session_in_os_trash() } : null)}
        sections={[
          { id: "intake", title: m.session_intake(), actions: intakeActions, content: <KeyValueList items={intakeItems} columns={2} /> },
          {
            id: "calibration",
            title: m.nav_calibration(),
            content: (
              <>
                <KeyValueList items={calibrationItems} columns={2} />
                {calibration.matchingPending ? <Notice tone="info" title={m.session_matching_pending()} /> : null}
              </>
            ),
          },
          { id: "frames", title: m.sessions_column_frames(), count: assets.length, flush: true, content: <FramesTable assets={assets} /> },
        ]}
      />
      <CorrectMetadataDialog session={session} open={correcting} onOpenChange={setCorrecting} />
      {adding ? <AddToProjectDialog session={expectedSession(session)} sessionName={label} open onOpenChange={setAdding} /> : null}
    </>
  )
}

const QUALITY: Record<Asset_Serialize["quality"], "unreviewed" | "usable" | "unusable"> = { unreviewed: "unreviewed", usable: "usable", unusable: "unusable" }

function FramesTable({ assets }: { assets: Asset_Serialize[] }) {
  const m = useMessages()
  const columns: Column<Asset_Serialize>[] = [
    { id: "file", header: m.session_column_file(), rowHeader: true, truncate: true, sortValue: (a) => a.relativePath.display, cell: (a) => fileName(a.relativePath.display) },
    { id: "filter", header: m.run_field_filter(), sortValue: (a) => a.effective.filter, cell: (a) => a.effective.filter ?? "–" },
    { id: "exposure", header: m.session_column_exposure(), align: "right", sortValue: (a) => a.effective.exposureSeconds, cell: (a) => (a.effective.exposureSeconds !== null ? formatExposure(a.effective.exposureSeconds) : "–") },
    { id: "quality", header: m.session_column_quality(), sortValue: (a) => a.quality, cell: (a) => <StatusBadge kind="quality" value={QUALITY[a.quality]} /> },
    {
      id: "availability",
      header: m.session_column_availability(),
      sortValue: (a) => a.availability,
      cell: (a) => <StatusBadge kind="availability" value={a.availability === "available" ? "online" : a.availability === "missing" ? "absent" : a.availability === "offline" ? "offline" : a.availability === "retired" ? "retired" : "unreadable"} />,
    },
  ]
  return <BoxTable label={m.sessions_column_frames()} rows={assets} columns={columns} getRowId={(a) => a.id} empty={m.session_none()} />
}
