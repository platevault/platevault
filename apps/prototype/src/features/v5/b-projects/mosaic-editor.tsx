/**
 * Mosaic editor (S3, D-W38, D-W73; DetailPage): "New mosaic" and "Start
 * mosaic run" open it at `/projects/$projectId?mosaic=new|<subjectId>`
 * (`&rig=`, `&profile=`, `&sessions=` from Start run).
 * - Details: the Target (a new mosaic picks one), the name, the rig and the
 *   profile, edited in one dialog.
 * - Field: each panel drawn from the rig's field of view at its centre,
 *   north up and east left (MosaicField). Clicking a panel includes or
 *   excludes it; with Add panels on, a dashed slot beside a panel adds one.
 * - Panels and Sessions: the panels with their placed sessions, and the
 *   sessions placed by their pointing or by the user (each row's menu). A
 *   session on several panels, or on none, is flagged and stays out until
 *   placed.
 * - Start group saves the subject's panels and starts one run group with a
 *   panel run for each included panel (`confirmMosaic`).
 */
import { useNavigate } from "@tanstack/react-router"
import { Ban, Crosshair, Grid2x2Plus, LayoutGrid, Pencil, Plus, X } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { BoxTable } from "@/components/app/box"
import type { Action, Blocker, Column, MenuItem } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { EmptyState } from "@/components/app/feedback"
import { SelectField, TextField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { TargetPicker } from "@/components/app/pickers"
import { DetailPage, type DetailSection } from "@/components/templates/detail-page"
import { type FieldSize, MosaicField, type MosaicPointing, mosaicFreeSlots } from "@/components/domain/mosaic-field"
import { liveAssetIds, nearestPanel, PANEL_FLAG_NAME, type PanelFlag, panelForSession, projectCandidates, rigFieldOfView, rigName } from "@/domain/derive"
import { orderedProfiles, profileRef } from "@/domain/labels"
import type { MosaicPanel, Project, Session, SessionId, Subject } from "@/domain/types"
import { formatCount, formatDec, formatNight, formatRa } from "@/lib/format"
import { type MessageRef, type Messages, msg, say } from "@/lib/i18n"
import { type CommitResult, useStore } from "@/store/core"
import { type SubjectPick, useTargetSearch } from "./parts"
import { confirmMosaic } from "./subject-actions"

/** Panels overlap by 10% of the field. */
const STEP = 0.9
/** Panels are drawn at 1° while the rig's field of view is unknown. */
const UNKNOWN_FOV: FieldSize = { widthDeg: 1, heightDeg: 1 }
/** Columns × rows a layout lays out around the centre. */
const LAYOUTS: Array<[number, number]> = [
  [2, 1],
  [1, 2],
  [2, 2],
  [3, 1],
  [3, 2],
]
const NO_PROFILE = "none"

interface PanelState extends MosaicPanel {
  include: boolean
}

let panelCounter = 0
function newPanelId(): string {
  panelCounter += 1
  return `pnl_${Date.now().toString(36)}_${panelCounter}`
}

const cosDec = (dec: number) => Math.max(0.1, Math.cos((dec * Math.PI) / 180))

/** Panels in `cols` × `rows` around `centre`, each overlapping its neighbours by 10%. */
function layout(centre: { ra: number; dec: number }, cols: number, rows: number, fov: FieldSize): PanelState[] {
  const out: PanelState[] = []
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const ra = (centre.ra - ((c - (cols - 1) / 2) * fov.widthDeg * STEP) / cosDec(centre.dec) + 360) % 360
      const dec = centre.dec + ((rows - 1) / 2 - r) * fov.heightDeg * STEP
      out.push({ id: newPanelId(), n: out.length + 1, ra: Number(ra.toFixed(3)), dec: Number(dec.toFixed(3)), rotationDeg: 0, include: true })
    }
  }
  return out
}

interface Placement {
  panelId: string | null
  byUser: boolean
  flag: PanelFlag | null
  detail: MessageRef
}

interface SessionRow {
  session: Session
  frames: number
  placement: Placement
}

function placementWord(m: Messages, row: SessionRow, included: PanelState[]): string {
  const { placement } = row
  if (placement.flag) return placement.flag === "ambiguous" ? m.project_placement_ambiguous() : placement.flag === "off-panel" ? m.project_placement_off_panel() : say(m, PANEL_FLAG_NAME[placement.flag])
  const panel = included.find((p) => p.id === placement.panelId)
  if (panel) return `${m.review_panel_n({ n: panel.n })} · ${placement.byUser ? m.mosaic_placed_by_you() : m.mosaic_by_pointing()}`
  return placement.panelId ? m.mosaic_excluded_panel() : m.mosaic_left_out()
}

function sessionLine(m: Messages, session: Session): string {
  return `${formatNight(session.night)} · ${session.channel ?? m.palette_session_no_filter()}`
}

export function MosaicEditor({ project, subjectId, rigId: initialRig, profileId: initialProfile, sessionIds }: { project: Project; subjectId: string | null; rigId?: string; profileId?: string; sessionIds?: string[] }) {
  const m = useMessages()
  const navigate = useNavigate()
  const catalog = useStore((s) => s.catalog)
  const subject = subjectId ? project.subjects.find((s) => s.id === subjectId) : undefined
  const [pick, setPick] = useState<SubjectPick | null>(null)
  const [name, setName] = useState(subject?.mosaic?.name ?? "")
  const [rigId, setRigId] = useState(initialRig && project.rigIds.includes(initialRig) ? initialRig : (project.rigIds[0] ?? ""))
  const [profileId, setProfileId] = useState(initialProfile ?? NO_PROFILE)
  const [panels, setPanels] = useState<PanelState[]>(() => subject?.mosaic?.panels.map((p) => ({ ...p, include: true })) ?? [])
  const [placements, setPlacements] = useState<Record<SessionId, string | null>>({})
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(!subject)
  const [laying, setLaying] = useState(false)

  const rig = catalog.opticalTrains[rigId]
  const fov = rig ? rigFieldOfView(catalog, rig) : null
  const field = fov ?? UNKNOWN_FOV
  const targetId = subject?.targetId ?? (pick?.kind === "target" ? pick.targetId : null)
  const centre = subject?.mosaic?.centre ?? { ra: pick?.ra ?? 0, dec: pick?.dec ?? 0 }
  const draft: Subject = { id: subject?.id ?? "__draft", targetId: targetId ?? "", mosaic: { name, centre, panels } }
  const panelRuns = (panelId: string) => Object.values(catalog.runs).filter((r) => r.projectId === project.id && r.subjectId === subject?.id && r.panelId === panelId)

  const rows: SessionRow[] = (() => {
    if (!targetId) return []
    const hypothetical = subject ? project : { ...project, subjects: [...project.subjects, draft] }
    const chosen = sessionIds ? new Set(sessionIds) : null
    return projectCandidates(catalog, hypothetical)
      .filter((c) => c.subject.targetId === targetId && c.rigId === rigId)
      .map((c) => {
        const own = c.session.id in placements ? placements[c.session.id] : chosen && !chosen.has(c.session.id) ? null : undefined
        const auto = panelForSession(catalog, draft, c.session, rigId)
        const placement: Placement =
          own !== undefined ? { panelId: own, byUser: true, flag: null, detail: own ? msg("mosaic_placed_by_you") : msg("mosaic_left_out") } : { panelId: auto.panelId, byUser: false, flag: auto.flag, detail: auto.detail }
        return { session: c.session, frames: liveAssetIds(catalog, c.session).length, placement }
      })
  })()
  const included = panels.filter((p) => p.include)
  const countOn = (panelId: string) => rows.filter((r) => r.placement.panelId === panelId).length
  const placed = rows.filter((r) => r.placement.panelId && included.some((p) => p.id === r.placement.panelId))
  const back = () => void navigate({ to: "/projects/$projectId", params: { projectId: project.id } })

  function assign(sessionId: SessionId, panelId: string | null | "auto") {
    setPlacements((current) => {
      const next = { ...current }
      if (panelId === "auto") delete next[sessionId]
      else next[sessionId] = panelId
      return next
    })
  }

  function addPanel(ra: number, dec: number) {
    const n = Math.max(0, ...panels.map((p) => p.n)) + 1
    setPanels((list) => [...list, { id: newPanelId(), n, ra, dec, rotationDeg: list[0]?.rotationDeg ?? 0, include: true }])
  }

  function choosePick(next: SubjectPick | null) {
    setPick(next)
    if (!next) return
    if (!name.trim()) setName(m.mosaic_default_name({ name: next.name }))
    if (next.ra !== null && next.dec !== null && panels.length === 0) setPanels(layout({ ra: next.ra, dec: next.dec }, 2, 1, field))
  }

  const missing: Blocker[] = [
    ...(targetId || pick ? [] : [{ label: m.project_target_label() }]),
    ...(name.trim() ? [] : [{ label: m.newproject_field_name() }]),
    ...(panels.length >= 2 ? [] : [{ label: m.mosaic_two_panels() }]),
    ...(included.length > 0 ? [] : [{ label: m.mosaic_included_panel() }]),
    ...(rigId ? [] : [{ label: m.project_col_rig() }]),
  ]

  function start(): CommitResult {
    const own = Object.fromEntries(rows.filter((r) => r.placement.byUser).map((r) => [r.session.id, r.placement.panelId]))
    const outcome = confirmMosaic({
      projectId: project.id,
      subjectId: subject?.id ?? null,
      pick,
      name,
      rigId,
      panels: panels.map(({ include: _include, ...p }) => p),
      includedIds: included.map((p) => p.id),
      placements: own,
      profileId: profileId === NO_PROFILE ? null : profileId,
    })
    if (outcome.groupId) void navigate({ to: "/projects/$projectId/groups/$groupId/$step", params: { projectId: project.id, groupId: outcome.groupId, step: "select" } })
    return outcome.result
  }

  const startLabel = m.mosaic_start_group()
  const actions: Action[] = [
    { id: "cancel", label: m.verb_cancel(), run: back },
    { id: "details", label: m.project_edit(), icon: Pencil, opensDialog: true, run: () => setEditing(true) },
    {
      id: "start-group",
      label: startLabel,
      icon: Grid2x2Plus,
      kind: "primary",
      run: start,
      unavailable: missing.length > 0 ? { action: m.actions_blocked({ action: startLabel }), reason: m.mosaic_items_missing({ count: missing.length }), blockers: missing } : undefined,
    },
  ]

  const profileName = profileId === NO_PROFILE ? m.startrun_profile_none() : catalog.profiles[profileId] ? say(m, profileRef(catalog.profiles[profileId]!)) : m.startrun_profile_none()
  const details: DetailSection = {
    id: "mosaic-details",
    title: m.settings_details(),
    content: (
      <KeyValueList
        columns={2}
        items={[
          { label: m.project_target_label(), value: subject ? (catalog.targets[subject.targetId]?.name ?? "–") : (pick?.name ?? "–") },
          { label: m.newproject_field_name(), value: name || "–" },
          { label: m.project_col_rig(), value: rigId ? rigName(m, catalog, rigId) : "–" },
          { label: m.startrun_profile_optional(), value: profileName },
        ]}
      />
    ),
  }

  const pointings: MosaicPointing[] = rows.flatMap((r) =>
    r.session.pointing ? [{ id: r.session.id, ra: r.session.pointing.ra, dec: r.session.pointing.dec, state: r.placement.flag ? "flagged" : placed.includes(r) ? "placed" : "unplaced" }] : [],
  )
  const slots = mosaicFreeSlots(panels, field)
  const fieldSection: DetailSection = {
    id: "mosaic-field",
    title: m.project_col_field(),
    actions:
      panels.length > 0
        ? [
            { id: "adding", label: adding ? m.mosaic_done_adding() : m.mosaic_add_panels(), icon: Plus, unavailable: !adding && slots.length === 0 ? { action: m.actions_blocked({ action: m.mosaic_add_panels() }), reason: m.mosaic_no_free_slot(), blockers: [] } : undefined, run: () => setAdding((on) => !on) },
            { id: "layout", label: m.mosaic_layout(), icon: LayoutGrid, opensDialog: true, run: () => setLaying(true) },
          ]
        : [],
    content:
      panels.length > 0 ? (
        <MosaicField panels={panels} slots={adding ? slots : []} field={field} pointings={pointings} onToggle={(id) => setPanels((list) => list.map((p) => (p.id === id ? { ...p, include: !p.include } : p)))} onAdd={addPanel} />
      ) : (
        <EmptyState icon={Grid2x2Plus} title={m.mosaic_pick_target()} action={<ActionButton action={{ id: "choose", label: m.session_choose_target(), opensDialog: true, run: () => setEditing(true) }} />} />
      ),
  }

  const panelColumns: Column<PanelState>[] = [
    { id: "panel", header: m.rungroup_col_panel(), cell: (p) => m.review_panel_n({ n: p.n }), sortValue: (p) => p.n, rowHeader: true },
    { id: "centre", header: m.project_col_centre(), cell: (p) => `${formatRa(p.ra)} ${formatDec(p.dec)}`, sortValue: (p) => p.ra },
    { id: "state", header: m.rungroup_col_status(), cell: (p) => (p.include ? m.mosaic_included_panel() : m.mosaic_excluded_panel()), sortValue: (p) => Number(p.include) },
    { id: "run", header: m.mosaic_in_a_run(), cell: (p) => (panelRuns(p.id).some((r) => !r.trashedAt) ? m.mosaic_in_a_run() : "–"), sortValue: (p) => Number(panelRuns(p.id).some((r) => !r.trashedAt)) },
    { id: "sessions", header: m.nav_sessions(), cell: (p) => formatCount(countOn(p.id)), sortValue: (p) => countOn(p.id), align: "right" },
  ]
  const panelActions = (p: PanelState): MenuItem[] => {
    const users = panelRuns(p.id)
    return [
      { id: "include", label: p.include ? m.mosaic_exclude() : m.mosaic_include(), run: () => setPanels((list) => list.map((x) => (x.id === p.id ? { ...x, include: !x.include } : x))) },
      { separator: true },
      {
        id: "remove",
        label: m.project_remove_named({ name: m.review_panel_n({ n: p.n }) }),
        icon: X,
        kind: "destructive",
        unavailable: users.length > 0 ? { action: m.mosaic_refusal_remove_panel({ n: p.n }), reason: m.project_used_by_runs({ count: users.length }), blockers: users.map((r) => ({ label: r.name })) } : undefined,
        run: () => {
          setPanels((list) => list.filter((x) => x.id !== p.id))
          setPlacements((current) => Object.fromEntries(Object.entries(current).filter(([, v]) => v !== p.id)))
        },
      },
    ]
  }

  const sessionColumns: Column<SessionRow>[] = [
    { id: "session", header: m.project_col_session(), cell: (r) => sessionLine(m, r.session), sortValue: (r) => r.session.night, rowHeader: true },
    { id: "frames", header: m.goal_frames(), cell: (r) => formatCount(r.frames), sortValue: (r) => r.frames, align: "right" },
    { id: "placement", header: m.mosaic_col_placement(), cell: (r) => placementWord(m, r, included), sortValue: (r) => placementWord(m, r, included), truncate: true },
  ]
  const sessionActions = (r: SessionRow): MenuItem[] => {
    const nearest = r.session.pointing ? nearestPanel(r.session.pointing, included) : null
    return [
      { heading: m.mosaic_place_on() },
      ...included.map((p) => ({ id: `place-${p.id}`, label: m.review_panel_n({ n: p.n }), run: () => assign(r.session.id, p.id) })),
      { separator: true },
      { id: "auto", label: m.mosaic_by_pointing(), icon: Crosshair, unavailable: nearest ? undefined : { action: m.actions_blocked({ action: m.mosaic_by_pointing() }), reason: m.project_placement_no_pointing(), blockers: [] }, run: () => assign(r.session.id, "auto") },
      { id: "out", label: m.mosaic_leave_out(), icon: Ban, run: () => assign(r.session.id, null) },
    ]
  }

  const sections: DetailSection[] = [
    details,
    fieldSection,
    ...(panels.length > 0
      ? [
          {
            id: "mosaic-panels",
            title: m.mosaic_panels_title(),
            count: panels.length,
            flush: true,
            content: <BoxTable label={m.mosaic_panels_title()} rows={panels} columns={panelColumns} getRowId={(p) => p.id} rowLabel={(p) => m.review_panel_n({ n: p.n })} rowActions={panelActions} />,
          },
        ]
      : []),
    {
      id: "mosaic-sessions",
      title: m.nav_sessions(),
      count: rows.length,
      flush: true,
      content: (
        <BoxTable
          label={m.mosaic_sessions_to_place()}
          rows={rows}
          columns={sessionColumns}
          getRowId={(r) => r.session.id}
          rowLabel={(r) => sessionLine(m, r.session)}
          rowActions={sessionActions}
          empty={targetId || pick ? m.mosaic_no_sessions_on({ rig: rig ? rigName(m, catalog, rigId) : m.mosaic_this_rig() }) : m.mosaic_pick_target()}
        />
      ),
    },
  ]

  return (
    <>
      <DetailPage
        path={[
          { label: m.nav_projects(), link: { to: "/projects" } },
          { label: project.name, link: { to: "/projects/$projectId", params: { projectId: project.id } } },
        ]}
        title={subject ? (subject.mosaic ? subject.mosaic.name : m.mosaic_run()) : m.mosaic_new_button()}
        actions={actions}
        notice={rigId && !fov ? { tone: "warning", title: m.mosaic_fov_unknown() } : null}
        sections={sections}
      />
      <MosaicDetailsDialog
        open={editing}
        onOpenChange={setEditing}
        project={project}
        isNew={!subject}
        value={{ pick, name, rigId, profileId }}
        onSave={(next) => {
          choosePick(next.pick)
          setName(next.name)
          setRigId(next.rigId)
          setProfileId(next.profileId)
        }}
      />
      <LayoutDialog
        open={laying}
        onOpenChange={setLaying}
        onPick={(cols, rowsN) => {
          setPanels(layout(centre, cols, rowsN, field))
          setPlacements({})
        }}
      />
    </>
  )
}

interface MosaicDetails {
  pick: SubjectPick | null
  name: string
  rigId: string
  profileId: string
}

/** The mosaic's Target (a new one only), name, rig and profile, in one dialog. */
function MosaicDetailsDialog({ open, onOpenChange, project, isNew, value, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; project: Project; isNew: boolean; value: MosaicDetails; onSave: (next: MosaicDetails) => void }) {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const [draft, setDraft] = useState(value)
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setDraft(value)
  }
  const search = useTargetSearch(project.subjects.map((s) => catalog.targets[s.targetId]?.name ?? ""))
  const label = m.settings_save()
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={isNew ? m.mosaic_new_button() : m.settings_details()}
      confirm={{
        id: "mosaic-details-save",
        label,
        kind: "primary",
        run: () => onSave(draft),
        unavailable: isNew && !draft.pick ? { action: m.actions_blocked({ action: label }), reason: m.mosaic_choose_target_first(), blockers: [] } : undefined,
      }}
    >
      {isNew ? (
        <TargetPicker
          label={m.project_target_label()}
          description={draft.pick ? m.project_target_chosen({ name: draft.pick.name }) : undefined}
          query={search.query}
          onQueryChange={search.setQuery}
          groups={search.groups}
          onPick={(option) => {
            const pick = search.pickOf(option)
            if (pick) setDraft((d) => ({ ...d, pick, name: d.name.trim() ? d.name : m.mosaic_default_name({ name: pick.name }) }))
          }}
        />
      ) : null}
      <TextField label={m.newproject_field_name()} value={draft.name} onChange={(name) => setDraft((d) => ({ ...d, name }))} placeholder={m.mosaic_name_placeholder()} />
      <SelectField label={m.project_col_rig()} value={draft.rigId} options={project.rigIds.map((id) => ({ value: id, label: rigName(m, catalog, id) }))} onChange={(rigId) => setDraft((d) => ({ ...d, rigId }))} />
      <SelectField
        label={m.startrun_profile_optional()}
        value={draft.profileId}
        options={[{ value: NO_PROFILE, label: m.startrun_profile_none() }, ...orderedProfiles(catalog).map((p) => ({ value: p.id, label: say(m, profileRef(p)) }))]}
        onChange={(profileId) => setDraft((d) => ({ ...d, profileId }))}
      />
    </FormDialog>
  )
}

/** Lay the panels out again: columns × rows around the mosaic's centre; placements by the user are cleared. */
function LayoutDialog({ open, onOpenChange, onPick }: { open: boolean; onOpenChange: (open: boolean) => void; onPick: (cols: number, rows: number) => void }) {
  const m = useMessages()
  const [choice, setChoice] = useState("2x1")
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.mosaic_layout()}
      size="sm"
      confirm={{
        id: "mosaic-layout",
        label: m.mosaic_apply_layout(),
        kind: "primary",
        run: () => {
          const [cols = 2, rows = 1] = choice.split("x").map(Number)
          onPick(cols, rows)
        },
      }}
    >
      <SelectField label={m.mosaic_layout()} value={choice} options={LAYOUTS.map(([c, r]) => ({ value: `${c}x${r}`, label: m.mosaic_layout_grid({ cols: c, rows: r }) }))} onChange={setChoice} />
    </FormDialog>
  )
}
