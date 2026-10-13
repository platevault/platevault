/**
 * S7 Run group (slice C) as a StepPage (§5.2): the run flow's four steps
 * over the group's panels (`groupFlow`), each step one DataTable with a
 * Panel column. Select places the sessions the pointing could not assign on
 * a panel (D-W38); Calibrate shows each panel's readiness under the shared
 * policy; Prepare holds the shared setup and Prepare all, into
 * `<Mosaic>/Panel N/` (PREP-FR-12, D-W73); Results holds the group's
 * assembled mosaic and each panel's Results. Finish all panels is the
 * terminal Proceed. A trashed panel is listed as Trashed and left out of
 * every group action (D-W75).
 */
import { useNavigate, useParams } from "@tanstack/react-router"
import { Eye, FolderOpen, MapPin, Paperclip, FolderSearch, Save } from "lucide-react"
import { useEffect, useState } from "react"
import { MissingRecord } from "@/app/missing-record"
import { useMessages } from "@/app/preferences"
import type { Action, Column, ConfirmSpec, MenuItem } from "@/components/app/contracts"
import { DataTable } from "@/components/app/data-table"
import { SwitchField } from "@/components/app/fields"
import type { PathItem } from "@/components/app/page"
import { Refusal } from "@/components/app/refusal"
import { StatusBadge } from "@/components/app/status"
import { stepEditable } from "@/components/app/step-flow"
import { StepPage } from "@/components/templates/step-page"
import { calibrationPlan, KIND_NAME, KINDS } from "@/domain/calibration"
import { type FlowStepState, groupCandidates, groupFlowState, groupPipeline, nearestPanel, panelLabel, panelRef, projectLink, type RunFlowState, runFlowState, runPreparations, runResults, runStepLink, workingContent } from "@/domain/derive"
import { MODE_NAME, profileRef } from "@/domain/labels"
import type { MosaicPanel, Run, RunFlowStepId, RunGroup } from "@/domain/types"
import { fileName, formatNight } from "@/lib/format"
import { joinRefs, type Messages, msg, say, verbatim } from "@/lib/i18n"
import { groupFlow } from "@/store/actions/flows"
import { addRunSessions, saveRun } from "@/store/actions/runs"
import { type PrototypeState, useStore } from "@/store/core"
import { changeGroupSetup, discoverResults, groupSetupRefusals, openGroupFolder, prepareAll } from "./actions"
import { currentPreparation, groupAssembledPath, livePanelRuns, type ModeOption, nextGroupRevision, type PreparePlan, preparePlan, readinessByKind, resultRow } from "./model"
import { PrepareFields, prepareRows } from "./prepare-step"
import { AttachDialog, ResultsTable } from "./results-step"
import { isRunFlowStep } from "./run"

/** The kind a group's own Result is: the mosaic the application assembles (D-W73). */
const GROUP_KINDS = ["assembled-mosaic"] as const

/** One panel of the group: its run, whether it is in the Trash, and its run flow while it is not. */
interface PanelRow {
  panel: MosaicPanel
  run: Run
  trashed: boolean
  flow: RunFlowState | null
}

export function RunGroupPage() {
  const m = useMessages()
  const { projectId, groupId, step } = useParams({ strict: false }) as { projectId?: string; groupId?: string; step?: string }
  const state = useStore((s) => s)
  const group = groupId ? state.catalog.runGroups[groupId] : undefined
  const project = group ? state.catalog.projects[group.projectId] : undefined
  if (!group || !project || group.projectId !== projectId) return <MissingRecord title={m.rungroup_missing_title()} backTo={projectId ? `/projects/${projectId}` : "/projects"} backLabel={m.run_open_project()} />
  if (!isRunFlowStep(step)) return <MissingRecord title={m.run_step_missing_title()} backTo={`/projects/${project.id}/groups/${group.id}/${groupFlowState(state, group).current}`} backLabel={m.run_open_current_step()} />
  return <GroupScreen group={group} step={step} />
}

/** The step's state on a panel: its gate word, with the panel's own summary ("Saved r2", "Partial 24/54"). */
function PanelStepState({ row, step }: { row: PanelRow; step: RunFlowStepId }) {
  const m = useMessages()
  if (row.trashed || !row.flow) return <StatusBadge kind="run" value="trashed" />
  const s = row.flow.steps.find((x) => x.id === step)!
  const value: Record<FlowStepState, "done" | "blocked" | "ready" | "review" | "idle"> = { finished: "done", skipped: "done", blocked: "blocked", current: "ready", redo: "review", todo: "idle" }
  return <StatusBadge kind="gate" value={value[s.state]} label={s.summary ? say(m, s.summary) : undefined} />
}

function panelColumns(m: Messages, step: RunFlowStepId, extra: Column<PanelRow>[]): Column<PanelRow>[] {
  return [
    { id: "panel", header: m.rungroup_col_panel(), rowHeader: true, cell: (r) => panelLabel(m, r.panel), sortValue: (r) => r.panel.n },
    { id: "run", header: m.rungroup_col_panel_run(), truncate: true, cell: (r) => r.run.name, sortValue: (r) => r.run.name },
    ...extra,
    { id: "state", header: m.rungroup_col_status(), cell: (r) => <PanelStepState row={r} step={step} />, sortValue: (r) => (r.trashed ? 9 : (r.flow?.steps.findIndex((s) => s.id === r.flow?.current) ?? 0)) },
  ]
}

/** Prepare all…'s confirm (F2): one group folder revision, each panel's inputs in its own group. */
function prepareAllConfirm(m: Messages, group: RunGroup, plans: Array<{ run: Run; panel: MosaicPanel; plan: PreparePlan }>): ConfirmSpec {
  const first = plans[0]?.plan
  const profile = first?.profile
  return {
    title: m.rungroup_prepare_all_title({ count: plans.length, name: group.name }),
    summary: say(m, joinRefs([...(first?.layout.groupFolder ? [msg("run_prepare_creates", { folder: fileName(first.layout.groupFolder) })] : []), ...(profile ? [profileRef(profile)] : []), ...(first ? [MODE_NAME[first.mode]] : [])], " · ")),
    groups: plans.map(({ panel, plan }) => ({ label: panelLabel(m, panel), rows: prepareRows(m, plan) })),
    confirm: { label: m.rungroup_prepare_panels({ count: plans.length }) },
  }
}

function GroupScreen({ group, step }: { group: RunGroup; step: RunFlowStepId }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const navigate = useNavigate()
  const project = state.catalog.projects[group.projectId]!
  const pipeline = groupPipeline(state, group)
  const flowState = groupFlowState(state, group)
  const rows: PanelRow[] = pipeline.panels.map((p) => ({ panel: p.panel, run: p.run, trashed: p.trashed, flow: p.trashed ? null : runFlowState(state, p.run) }))
  const revision = nextGroupRevision(state, group)
  const plans = flowState.panels.filter((p) => p.flow.finishedAt === null).map((p) => ({ run: p.run, panel: p.panel, plan: preparePlan(state, p.run, { groupRevision: revision }) }))
  const flow = groupFlow(state, group, m, { prepare: { confirm: prepareAllConfirm(m, group, plans), start: () => prepareAll(group.id).result } })
  const editable = stepEditable(flow, step)
  const openPanel = (r: PanelRow, at: RunFlowStepId) => void navigate(r.trashed ? { to: "/projects/$projectId/trash", params: { projectId: group.projectId } } : (runStepLink(r.run, at) as never))
  const openFolder: Action = { id: "open-folder", label: m.rungroup_open_folder(), icon: FolderOpen, run: () => openGroupFolder(group.id) }
  const path: PathItem[] = [
    { label: m.nav_projects(), link: { to: "/projects" } },
    { label: project.name, link: projectLink(project.id) },
  ]
  const body = (() => {
    switch (step) {
      case "select":
        return <GroupSelect group={group} rows={rows} editable={editable} onOpen={(r) => openPanel(r, "select")} />
      case "calibrate":
        return <GroupCalibrate group={group} rows={rows} editable={editable} onOpen={(r) => openPanel(r, "calibrate")} />
      case "prepare":
        return <GroupPrepare group={group} rows={rows} plans={plans} editable={editable} openFolder={pipeline.allVerified ? openFolder : null} onOpen={(r) => openPanel(r, "prepare")} />
      case "results":
        return <GroupResults group={group} rows={rows} editable={editable} onOpen={(r) => openPanel(r, "results")} />
    }
  })()
  return (
    <StepPage
      path={path}
      title={group.name}
      status={flowState.finishedAt ? <StatusBadge kind="run" value="complete" label={m.status_finished()} /> : <StatusBadge kind="run" value="open" />}
      menu={{ label: m.run_results_run_group(), items: pipeline.allVerified ? [openFolder] : [] }}
      flow={flow}
      viewing={step}
      stepsLabel={m.calibration_steps_of({ name: group.name })}
      step={body}
    />
  )
}

interface GroupStepProps {
  group: RunGroup
  rows: PanelRow[]
  editable: boolean
  onOpen: (row: PanelRow) => void
}

function openItem(m: Messages, label: string, row: PanelRow, onOpen: (row: PanelRow) => void): Action {
  return { id: "open", label: row.trashed ? m.run_open_trash() : label, icon: Eye, run: () => onOpen(row) }
}

/** Select: each panel's membership, then the sessions the pointing could not place, to place by hand (D-W38). */
function GroupSelect({ group, rows, editable, onOpen }: GroupStepProps) {
  const m = useMessages()
  const state = useStore((s) => s)
  const navigate = useNavigate()
  const { byPanel, flagged } = groupCandidates(state.catalog, group)
  const live = livePanelRuns(state, group)
  const memberIds = new Set(live.flatMap((r) => (workingContent(r)?.sessions ?? []).map((s) => s.sessionId)))
  const toPlace = flagged.filter((f) => !memberIds.has(f.candidate.session.id))
  const panelOf = (run: Run) => rows.find((r) => r.run.id === run.id)?.panel
  const sessionName = (f: (typeof toPlace)[number]) => `${formatNight(f.candidate.session.night)} · ${f.candidate.session.channel ?? m.palette_session_no_filter()}`
  const place = (run: Run, f: (typeof toPlace)[number]) => {
    const panel = panelOf(run)
    return addRunSessions(run.id, [f.candidate.session.id], { kind: "panel-assigned", detail: msg("rungroup_placed_by_you", { panel: panel ? panelRef(panel) : verbatim(run.name), detail: f.detail }) })
  }
  // Clicking a flagged session places it on the live panel nearest its pointing; the row's menu offers every panel.
  const nearest = (f: (typeof toPlace)[number]) => {
    const panel = nearestPanel(
      f.candidate.session.pointing,
      rows.filter((r) => !r.trashed).map((r) => r.panel),
    )
    return panel ? live.find((r) => r.panelId === panel.id) : undefined
  }
  const placeOn = (run: Run, f: (typeof toPlace)[number]): Action => {
    const panel = panelOf(run)
    return { id: `place-${run.id}`, label: m.rungroup_place_on({ panel: panel ? panelLabel(m, panel) : run.name }), icon: MapPin, run: () => place(run, f) }
  }
  const panelActions = (r: PanelRow): MenuItem[] => [
    openItem(m, m.review_open_select(), r, onOpen),
    ...(editable && r.run.draft && !r.trashed ? [{ id: "save", label: m.rungroup_save(), icon: Save, run: () => saveRun(r.run.id) }] : []),
  ]
  const columns = panelColumns(m, "select", [
    { id: "sessions", header: m.nav_sessions(), align: "right", cell: (r) => String(workingContent(r.run)?.sessions.length ?? 0), sortValue: (r) => workingContent(r.run)?.sessions.length ?? 0 },
    { id: "candidates", header: m.rungroup_col_candidates(), align: "right", cell: (r) => String(byPanel[r.panel.id]?.length ?? 0), sortValue: (r) => byPanel[r.panel.id]?.length ?? 0 },
  ])
  const placeColumns: Column<(typeof toPlace)[number]>[] = [
    { id: "session", header: m.run_cal_col_light_session(), rowHeader: true, cell: sessionName, sortValue: (f) => f.candidate.session.night },
    { id: "flag", header: m.run_col_reason(), cell: (f) => <StatusBadge kind="association" value="needs-review" label={say(m, f.detail)} />, sortValue: (f) => f.flag },
    {
      id: "nearest",
      header: m.rungroup_col_nearest(),
      cell: (f) => {
        const run = nearest(f)
        const panel = run ? panelOf(run) : undefined
        return panel ? panelLabel(m, panel) : "–"
      },
      sortValue: (f) => panelOf(nearest(f) ?? live[0]!)?.n ?? null,
    },
  ]
  return (
    <>
      <DataTable label={m.rungroup_panels_label({ name: group.name })} rows={rows} columns={columns} getRowId={(r) => r.run.id} scroll="none" rowLabel={(r) => panelLabel(m, r.panel)} rowActions={panelActions} onRowClick={onOpen} />
      {toPlace.length > 0 ? (
        <DataTable
          label={m.rungroup_to_place()}
          rows={toPlace}
          columns={placeColumns}
          getRowId={(f) => f.candidate.session.id}
          scroll="none"
          rowLabel={sessionName}
          primaryRowAction={(f) => {
            const run = nearest(f)
            return editable && run ? placeOn(run, f) : null
          }}
          rowActions={(f) => [
            ...(editable ? live.map((run) => placeOn(run, f)) : []),
            { id: "open-session", label: m.project_open_session(), icon: Eye, run: () => void navigate({ to: "/sessions/$sessionId", params: { sessionId: f.candidate.session.id } }) },
          ]}
        />
      ) : null}
    </>
  )
}

/** Calibrate: the shared policy, then each panel's matched masters per kind (D-W5, D-W55). */
function GroupCalibrate({ group, rows, editable, onOpen }: GroupStepProps) {
  const m = useMessages()
  const state = useStore((s) => s)
  const [failure, setFailure] = useState<string | null>(null)
  const refusals = groupSetupRefusals(state, group)
  const readiness = (r: PanelRow) => readinessByKind(calibrationPlan(state.catalog, state.disk, r.run, group.setup.calibrationPolicy, workingContent(r.run)))
  const toReview = (r: PanelRow) => calibrationPlan(state.catalog, state.disk, r.run, group.setup.calibrationPolicy, workingContent(r.run)).needsReview.length
  const columns = panelColumns(m, "calibrate", [
    ...KINDS.map(
      (kind): Column<PanelRow> => ({
        id: kind,
        header: say(m, KIND_NAME[kind]),
        align: "right",
        cell: (r) => {
          const k = readiness(r).find((x) => x.kind === kind)!
          return k.total === 0 ? "–" : `${k.matched}/${k.total}`
        },
        sortValue: (r) => readiness(r).find((x) => x.kind === kind)!.matched,
      }),
    ),
    { id: "review", header: m.run_cal_to_review_col(), align: "right", cell: (r) => String(toReview(r)), sortValue: toReview },
  ])
  return (
    <>
      <SwitchField
        label={m.run_cal_auto_assign()}
        description={m.run_cal_policy_shared()}
        checked={group.setup.calibrationPolicy === "automatic"}
        disabled={!editable || refusals.length > 0}
        onChange={(checked) => {
          const result = changeGroupSetup(group.id, { calibrationPolicy: checked ? "automatic" : "off" })
          setFailure(result.ok ? null : result.reason === "refused" ? result.reasons.join(" · ") : result.message)
        }}
      />
      {failure ? <Refusal action={m.run_cal_policy_blocked()} reason={failure} blockers={[]} /> : null}
      <DataTable
        label={m.rungroup_panels_label({ name: group.name })}
        rows={rows}
        columns={columns}
        getRowId={(r) => r.run.id}
        scroll="none"
        rowLabel={(r) => panelLabel(m, r.panel)}
        rowActions={(r) => [openItem(m, m.run_open_calibrate(), r, onOpen)]}
        onRowClick={onOpen}
      />
    </>
  )
}

/** The view modes over every panel: a mode is allowed only when every panel allows it, with every panel's reasons (D-W38). */
function aggregateModes(lists: ModeOption[][]): ModeOption[] {
  const first = lists[0] ?? []
  return first.map((option) => {
    const all = lists.map((l) => l.find((x) => x.mode === option.mode)!)
    const reasons = [...new Map(all.flatMap((x) => x.reasons).map((r) => [JSON.stringify(r), r])).values()]
    return {
      ...option,
      allowed: reasons.length === 0,
      reasons,
      entries: all.reduce((n, x) => n + x.entries, 0),
      footprintBytes: all.reduce((n, x) => n + x.footprintBytes, 0),
      developerModeOff: all.some((x) => x.developerModeOff),
    }
  })
}

/** Prepare: the shared setup as Field rows, then each panel's inputs and preparation (PREP-FR-12, PREP-FR-13). */
function GroupPrepare({ group, rows, plans, editable, openFolder, onOpen }: GroupStepProps & { plans: Array<{ run: Run; plan: PreparePlan }>; openFolder: Action | null }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const refusals = groupSetupRefusals(state, group)
  const first = plans[0]?.plan
  const planOf = (r: PanelRow) => plans.find((p) => p.run.id === r.run.id)?.plan
  const prepOf = (r: PanelRow) => currentPreparation(r.run, runPreparations(state.catalog, r.run.id))
  const columns = panelColumns(m, "prepare", [
    { id: "inputs", header: m.run_prepare_inputs(), align: "right", cell: (r) => String(planOf(r)?.entries.length ?? 0), sortValue: (r) => planOf(r)?.entries.length ?? 0 },
    { id: "folder", header: m.rungroup_col_folder(), truncate: true, cell: (r) => fileName(prepOf(r)?.folderPath ?? planOf(r)?.layout.folderPath ?? "–"), sortValue: (r) => prepOf(r)?.folderPath ?? "" },
  ])
  return (
    <>
      {refusals.length > 0 ? <Refusal standing action={m.rungroup_setup_locked()} reason={m.rungroup_complete_panels({ count: refusals.length })} blockers={refusals.map((r) => ({ label: say(m, r) }))} /> : null}
      {first ? (
        <PrepareFields
          setup={{
            target: { groupId: group.id },
            profileId: group.setup.profileId,
            mode: group.setup.inputMode ?? state.settings.defaultRunView,
            modes: aggregateModes(plans.map((p) => p.plan.modes)),
            outputParent: first.layout.parent.path,
            folderPath: first.layout.groupFolder,
            shared: true,
          }}
          editable={editable && refusals.length === 0}
        />
      ) : null}
      <DataTable
        label={m.rungroup_panels_label({ name: group.name })}
        rows={rows}
        columns={columns}
        getRowId={(r) => r.run.id}
        scroll="none"
        toolbar={openFolder ? { actions: [openFolder] } : undefined}
        rowLabel={(r) => panelLabel(m, r.panel)}
        rowActions={(r) => [openItem(m, m.run_open_prepare(), r, onOpen)]}
        onRowClick={onOpen}
      />
    </>
  )
}

/** Results: the group's assembled mosaic (D-W73), then each panel's Results. */
function GroupResults({ group, rows, editable, onOpen }: GroupStepProps) {
  const m = useMessages()
  const state = useStore((s) => s)
  const [attaching, setAttaching] = useState(false)
  const assembled = groupAssembledPath(state, group)
  useEffect(() => {
    discoverResults({ groupId: group.id })
  }, [group.id])
  const preps = Object.values(state.catalog.preparations).filter((p) => p.groupId === group.id)
  const results = Object.values(state.catalog.results)
    .filter((r) => r.groupId === group.id && r.runId === null && !r.trashed)
    .map((r) => resultRow(state, r, preps))
  const rescan: Action = { id: "rescan", label: m.run_results_rescan(), icon: FolderSearch, run: () => discoverResults({ groupId: group.id }).result }
  const attach: Action = { id: "attach", label: m.run_results_attach(), icon: Paperclip, opensDialog: true, run: () => setAttaching(true) }
  const counts = (r: PanelRow) => runResults(state.catalog, r.run.id)
  const columns = panelColumns(m, "results", [
    { id: "accepted", header: m.rungroup_col_accepted(), align: "right", cell: (r) => String(counts(r).products.filter((x) => x.acceptance === "accepted").length), sortValue: (r) => counts(r).products.filter((x) => x.acceptance === "accepted").length },
    { id: "products", header: m.run_results_products(), align: "right", cell: (r) => String(counts(r).products.length), sortValue: (r) => counts(r).products.length },
    { id: "intermediates", header: m.run_results_intermediates(), align: "right", cell: (r) => String(counts(r).intermediates.length), sortValue: (r) => counts(r).intermediates.length },
  ])
  return (
    <>
      <ResultsTable label={m.rungroup_result()} rows={results} kinds={[...GROUP_KINDS]} editable={editable} actions={editable ? [attach, rescan] : []} empty={rescan} />
      <DataTable
        label={m.rungroup_panel_results()}
        rows={rows}
        columns={columns}
        getRowId={(r) => r.run.id}
        scroll="none"
        rowLabel={(r) => panelLabel(m, r.panel)}
        rowActions={(r) => [openItem(m, m.rungroup_open_panel_results({ panel: panelLabel(m, r.panel) }), r, onOpen)]}
        onRowClick={onOpen}
      />
      <AttachDialog open={attaching} onOpenChange={setAttaching} target={{ groupId: group.id }} kinds={[...GROUP_KINDS]} initialPath={assembled} />
    </>
  )
}

export type { PrototypeState }
