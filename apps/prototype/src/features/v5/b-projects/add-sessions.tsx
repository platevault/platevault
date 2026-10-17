/**
 * Add sessions… (VSEL-FR-03, VSEL-FR-06; FormDialog lg): a picker over the
 * Ready sessions the Project doesn't hold. The Project's suggestions come
 * first, each with why it matches; a session of another Target or rig can
 * be added explicitly, and adding it adds that subject or rig to the
 * Project, which the dialog says before anything is saved (PRJ-FR-02,
 * VSEL-AC-18). A session whose calibration isn't settled shows its blocker
 * ("Choose its flats first") and cannot be ticked. Sessions with no
 * confirmed Target or rig, sessions that still need review and Trashed ones
 * stay out; the dialog links to Sessions filtered to Needs review or Needs
 * calibration. Pointing evidence orders each part by the distance to the
 * nearest subject; a session without one reads Position unknown and sorts
 * after those with evidence (VSEL-AC-02). Filters change the list, never
 * the ticks (VSEL-AC-03). Each session joins as a whole, into the group its
 * row names.
 */
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Column, Facet } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { DataTable } from "@/components/app/data-table"
import { Notice } from "@/components/app/feedback"
import { FormDialog } from "@/components/app/form-dialog"
import { useFollowLink } from "@/components/app/links"
import {
  candidateSubject,
  joinBlocker,
  liveAssetIds,
  liveLightSessions,
  projectSessionIds,
  projectSessionsNeedingReview,
  rigName,
  sessionReadiness,
  sessionRigId,
  sessionTargetId,
  subjectCentre,
  subjectName,
} from "@/domain/derive"
import { type GroupPlacement, groupPlacement } from "@/domain/project-view"
import { angularSeparationDeg, matchesQuery } from "@/domain/sky"
import type { OpticalTrainId, Project, Session, TargetId } from "@/domain/types"
import { formatCount, formatDegrees } from "@/lib/format"
import { type MessageRef, type Messages, say } from "@/lib/i18n"
import { addSessionToProject, addSessions } from "@/store/actions/projects"
import { type CommitResult, type PrototypeState, useStore } from "@/store/core"
import { framingLine, sessionLine, unavailableFor } from "./parts"

/** One session the picker offers. */
interface AddRow {
  session: Session
  target: string
  rig: string
  targetId: TargetId
  rigId: OpticalTrainId
  /** It matches a subject on one of the Project's rigs (PRJ-FR-09); otherwise adding it adds its subject or rig. */
  suggested: boolean
  addsSubject: boolean
  addsRig: boolean
  /** Live frames: every one joins with the session. */
  frames: number
  /** Why it cannot be ticked yet: its calibration isn't settled. */
  blocked: MessageRef | null
  /** Degrees to the nearest subject; null without a pointing or a subject position, never 0 for unknown. */
  distanceDeg: number | null
  /** The group it would join, or the new group adding it creates. */
  joins: GroupPlacement
}

function addRows(m: Messages, state: PrototypeState, project: Project): AddRow[] {
  const { catalog } = state
  const held = projectSessionIds(project)
  const centres = project.subjects.flatMap((s) => subjectCentre(catalog, s) ?? [])
  const rows = liveLightSessions(catalog).flatMap((session): AddRow[] => {
    const targetId = sessionTargetId(session)
    const rigId = sessionRigId(session)
    if (held.has(session.id) || sessionReadiness(catalog, session) !== "ready" || !targetId || !rigId) return []
    const pointing = session.pointing
    return [
      {
        session,
        target: subjectName(m, catalog, { id: "", targetId }),
        rig: rigName(m, catalog, rigId),
        targetId,
        rigId,
        suggested: candidateSubject(catalog, project, session) !== null,
        addsSubject: !project.subjects.some((s) => s.targetId === targetId),
        addsRig: !project.rigIds.includes(rigId),
        frames: liveAssetIds(catalog, session).length,
        blocked: joinBlocker(catalog, session),
        distanceDeg: pointing && centres.length > 0 ? Math.min(...centres.map((c) => angularSeparationDeg(pointing.ra, pointing.dec, c.ra, c.dec))) : null,
        joins: groupPlacement(m, state, project, session),
      },
    ]
  })
  const unknown = (r: AddRow) => Number(r.distanceDeg === null)
  return rows.sort((a, b) => Number(b.suggested) - Number(a.suggested) || unknown(a) - unknown(b) || (a.distanceDeg ?? 0) - (b.distanceDeg ?? 0) || b.session.night.localeCompare(a.session.night))
}

type Filters = { match: string; channel: string; rig: string }
const NO_FILTERS: Filters = { match: "", channel: "", rig: "" }

export function AddSessionsDialog({ project, open, onOpenChange }: { project: Project; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const follow = useFollowLink()
  const catalog = useStore((s) => s.catalog)
  const rows = useStore((s) => (open ? addRows(m, s, project) : []))
  const waiting = useStore((s) => (open ? projectSessionsNeedingReview(s.catalog, project).length : 0))
  const [query, setQuery] = useState("")
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [selected, setSelected] = useState<string[]>([])
  // Each opening starts with no ticks and no filters.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setQuery("")
      setFilters(NO_FILTERS)
      setSelected([])
    }
  }

  const label = (r: AddRow) => `${r.target} · ${sessionLine(m, r.session)}`
  const shown = rows.filter(
    (r) =>
      (filters.match === "" || (filters.match === "suggested") === r.suggested) &&
      (filters.channel === "" || r.session.channel === filters.channel) &&
      (filters.rig === "" || r.rigId === filters.rig) &&
      (query.trim() === "" || matchesQuery([r.target, r.rig, sessionLine(m, r.session), r.session.objectLabel ?? ""], query)),
  )
  const offered = new Set<string>(rows.filter((r) => r.blocked === null).map((r) => r.session.id))
  // A tick on a session that left the offer (added elsewhere, calibration reopened) drops out.
  const chosen = rows.filter((r) => selected.includes(r.session.id) && offered.has(r.session.id))
  const unsettled = rows.filter((r) => r.blocked !== null).length

  /** Why a suggestion matches ("Target NGC 7000 on RedCat 51"), or what adding another session also adds ("Adds rig Esprit 100"). */
  const match = (r: AddRow) => {
    if (r.suggested) return m.domain_candidate_reason({ target: r.target, rig: r.rig })
    const parts: string[] = []
    if (r.addsSubject) parts.push(m.session_adds_subject({ name: r.target }))
    if (r.addsRig) parts.push(m.session_adds_rig({ name: r.rig }))
    return parts.join(" · ")
  }
  const distance = (r: AddRow) => (r.distanceDeg === null ? m.project_search_position_unknown() : formatDegrees(r.distanceDeg))
  const joins = (r: AddRow) => (r.joins.groupId ? r.joins.name : m.project_joins_new_group({ name: r.joins.name }))
  const status = (r: AddRow) => (r.blocked ? say(m, r.blocked) : m.status_ready())
  // A large dialog holds four columns; the rest of what VSEL-FR-03 names opens under the row.
  const columns: Column<AddRow>[] = [
    { id: "session", header: m.project_col_session(), cell: (r) => sessionLine(m, r.session), sortValue: (r) => r.session.night, rowHeader: true },
    { id: "match", header: m.project_col_match(), cell: match, sortValue: match, truncate: true },
    { id: "distance", header: m.run_col_distance(), cell: distance, sortValue: (r) => r.distanceDeg, align: "right" },
    { id: "status", header: m.dialog_col_status(), cell: status, sortValue: status, truncate: true },
  ]
  const detail = (r: AddRow) => (
    <KeyValueList
      columns={2}
      items={[
        { label: m.project_col_match(), value: match(r) },
        { label: m.project_col_joins(), value: joins(r) },
        { label: m.goal_frames(), value: formatCount(r.frames) },
        { label: m.project_col_framing(), value: framingLine(m, catalog, r.session) },
      ]}
    />
  )

  const count = (pick: (r: AddRow) => boolean) => rows.filter(pick).length
  const distinct = <K extends string>(values: K[]) => [...new Set(values)].sort((a, b) => a.localeCompare(b))
  const facets: Facet[] = [
    {
      id: "match",
      label: m.project_col_kind(),
      kind: "single",
      value: filters.match,
      options: [
        { value: "suggested", label: m.status_suggested(), count: count((r) => r.suggested) },
        { value: "other", label: m.project_add_other(), count: count((r) => !r.suggested) },
      ],
    },
    {
      id: "channel",
      label: m.target_channel(),
      kind: "single",
      value: filters.channel,
      options: distinct(rows.flatMap((r) => (r.session.channel ? [r.session.channel] : []))).map((c) => ({ value: c, label: c, count: count((r) => r.session.channel === c) })),
    },
    {
      id: "rig",
      label: m.project_col_rig(),
      kind: "single",
      value: filters.rig,
      options: distinct(rows.map((r) => r.rigId)).map((id) => ({ value: id, label: rows.find((r) => r.rigId === id)?.rig ?? id, count: count((r) => r.rigId === id) })),
    },
  ]
  const clearFilters = () => {
    setQuery("")
    setFilters(NO_FILTERS)
  }

  function add(): CommitResult {
    const suggested = chosen.filter((r) => r.suggested).map((r) => r.session.id)
    if (suggested.length > 0) {
      const result = addSessions(project.id, suggested)
      if (!result.ok) return result
    }
    for (const r of chosen.filter((x) => !x.suggested)) {
      const { result } = addSessionToProject(r.session.id, project.id)
      if (!result.ok) return result
    }
    return { ok: true }
  }
  const addLabel = chosen.length > 0 ? m.project_add_suggested({ count: chosen.length }) : m.project_add_sessions()

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.project_add_sessions_title({ name: project.name })}
      size="lg"
      confirm={{ id: "add-sessions-save", label: addLabel, kind: "primary", run: add, unavailable: chosen.length === 0 ? unavailableFor(m, addLabel, m.project_select_sessions_first()) : undefined }}
    >
      {waiting > 0 ? (
        <Notice
          tone="info"
          title={m.project_add_waiting_review({ count: waiting })}
          actions={<ActionButton action={{ id: "needs-review", label: m.status_needs_review(), run: () => follow({ to: "/sessions", search: { filter: "needs-review" } }) }} />}
        />
      ) : null}
      {unsettled > 0 ? (
        <Notice
          tone="info"
          title={m.project_sessions_need_calibration({ count: unsettled, n: formatCount(unsettled) })}
          actions={<ActionButton action={{ id: "needs-calibration", label: m.sessions_filter_needs_calibration(), run: () => follow({ to: "/sessions", search: { filter: "needs-calibration" } }) }} />}
        />
      ) : null}
      <DataTable
        label={m.project_add_sessions_title({ name: project.name })}
        rows={shown}
        columns={columns}
        getRowId={(r) => r.session.id}
        rowLabel={label}
        expand={{ render: detail }}
        selection={{
          selected: chosen.map((r) => r.session.id),
          onChange: setSelected,
          rowLabel: label,
          isSelectable: (r) => r.blocked === null,
          membership: true,
          countLabel: (n) => m.table_selected_count({ count: n, n: formatCount(n) }),
          onShowHidden: clearFilters,
        }}
        toolbar={{
          search: { label: m.sessions_search(), value: query, onChange: setQuery },
          facets: {
            items: facets,
            onChange: (patch) =>
              setFilters((f) => ({
                match: typeof patch.match === "string" ? patch.match : f.match,
                channel: typeof patch.channel === "string" ? patch.channel : f.channel,
                rig: typeof patch.rig === "string" ? patch.rig : f.rig,
              })),
          },
          matchCount: shown.length,
          actions: chosen.length > 0 ? [{ id: "clear-selection", label: m.selection_clear(), run: () => setSelected([]) }] : [],
        }}
        empty={rows.length === 0 ? m.project_add_none() : m.project_add_no_match()}
      />
    </FormDialog>
  )
}
