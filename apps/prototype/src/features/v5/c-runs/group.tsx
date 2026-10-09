/**
 * S7 Run group (slice C): the panels with per-panel status, the shared setup
 * (profile, input mode, calibration policy; a Complete panel refuses a setup
 * change), Review all (slice D's `GroupReviewStep`), calibration readiness
 * per panel, Prepare all into `<Mosaic>/Panel N/` with `<Mosaic> Results/
 * Panel N/` and `Assembled/`, the group outcome (Partial when one panel is
 * Partial), Open only when every panel is verified, and the group Result.
 * A trashed panel is listed as Trashed, its frames leave the counts and
 * every group action skips it (D-W38, D-W41, D-W73, D-W75). Panel rows have
 * a right-click menu.
 */
import { Link, useNavigate, useParams } from "@tanstack/react-router"
import { Eye, FolderOpen, Layers, Lock, MapPin, Play, Save, ShieldCheck, Trash2, Wand2 } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { MissingRecord } from "@/app/missing-record"
import { useMessages } from "@/app/preferences"
import { GateLabel, stepName } from "@/app/run-ui"
import { Box } from "@/components/app/box"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { type Column, DataTable } from "@/components/app/data-table"
import { PageBody, PageHeader } from "@/components/app/page"
import { CountBadge, Pill } from "@/components/app/pill"
import { Refusal } from "@/components/app/refusal"
import { type MenuEntry, RowContextMenu } from "@/components/app/row-menu"
import { StatusBadge } from "@/components/app/status"
import { HelpTip } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { calibrationPlan, KIND_NAME } from "@/domain/calibration"
import { type GroupPanelState, groupCandidates, groupPipeline, groupStepLink, panelLabel, panelRef, rigName, runPreparations, runResults, subjectName, workingContent } from "@/domain/derive"
import { MODE_NAME, RUN_STEPS } from "@/domain/labels"
import type { InputMode, Preparation, ResultKind, Run, RunGroup, RunStep } from "@/domain/types"
import { fileName, formatNight } from "@/lib/format"
import { m, type MessageRef, msg, say, verbatim } from "@/lib/i18n"
import { addRunSessions, saveRun } from "@/store/actions/runs"
import { type PrototypeState, useStore } from "@/store/core"
import { GroupReviewStep } from "../d-review/review"
import { attachResult, changeGroupSetup, chooseMode, chooseProfile, completeAllPanels, discoverResults, groupSetupRefusals, openGroupFolder, prepareAll, prepareChoices, setOutputParent, simulateApplicationOutput, updatePrepareChoices } from "./actions"
import { currentPreparation, groupAssembledPath, livePanelRuns, type ModeOption, nextGroupRevision, preparePlan, readinessByKind, resultRow } from "./model"
import { LayoutLine, OutcomeNotice, profileLabel, PrototypeMenu, StepBar, useOutcome } from "./parts"
import { ChecksList, FootprintPill, LayoutSection, MetadataSection, ModeSection, PreparationOutcome, PrepStateBadge, ProfileSection } from "./prepare-step"
import { AttachDialog, ResultsTable, WrapUpLink } from "./results-step"

type Act = ReturnType<typeof useOutcome>["act"]

export function RunGroupPage() {
  const m = useMessages()
  const { projectId, groupId, step } = useParams({ strict: false }) as { projectId?: string; groupId?: string; step?: string }
  const state = useStore((s) => s)
  const group = groupId ? state.catalog.runGroups[groupId] : undefined
  const project = group ? state.catalog.projects[group.projectId] : undefined
  if (!group || !project || group.projectId !== projectId) return <MissingRecord title={m.rungroup_missing_title()} backTo={projectId ? `/projects/${projectId}` : "/projects"} backLabel={m.run_open_project()} />
  if (!RUN_STEPS.includes(step as RunStep)) return <MissingRecord title={m.run_step_missing_title()} backTo={`/projects/${project.id}/groups/${group.id}/select`} backLabel={m.review_open_select()} />
  return <GroupScreen group={group} step={step as RunStep} />
}

/** The group outcome of its current preparations: Partial when one panel is Partial (PREP-FR-12). */
export function groupOutcome(state: PrototypeState, group: RunGroup): { label: string; tone: "preparation"; value: Preparation["state"] | null; detail: string } {
  const live = livePanelRuns(state, group)
  const preps = live.map((run) => ({ run, prep: currentPreparation(run, runPreparations(state.catalog, run.id)) }))
  const missing = preps.filter((p) => !p.prep).map((p) => p.run.name)
  const by = (s: Preparation["state"]) => preps.filter((p) => p.prep?.state === s)
  if (by("running").length > 0) return { label: m.status_running(), tone: "preparation", value: "running", detail: m.rungroup_panels_preparing({ count: by("running").length }) }
  if (by("failed").length > 0) return { label: m.status_failed(), tone: "preparation", value: "failed", detail: by("failed").map((p) => p.run.name).join(", ") }
  if (by("partial").length > 0) return { label: m.status_partial(), tone: "preparation", value: "partial", detail: m.rungroup_names_partial({ names: by("partial").map((p) => p.run.name).join(", ") }) }
  if (missing.length > 0) return { label: missing.length === live.length ? m.run_not_prepared() : m.rungroup_not_every_panel_prepared(), tone: "preparation", value: null, detail: missing.join(", ") }
  return { label: m.status_prepared(), tone: "preparation", value: "prepared", detail: m.rungroup_panels_prepared({ count: live.length }) }
}

function GroupScreen({ group, step }: { group: RunGroup; step: RunStep }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const project = state.catalog.projects[group.projectId]!
  const subject = project.subjects.find((s) => s.id === group.subjectId)
  const pipeline = groupPipeline(state, group)
  const outcome = useOutcome(`${group.id}:${step}`)
  const trashed = pipeline.panels.filter((p) => p.trashed).length
  const status = groupOutcome(state, group)
  return (
    <div className="flex min-h-0 flex-1 flex-col" data-screen="S7">
      <PageHeader
        title={group.name}
        eyebrow={
          <Link to="/projects/$projectId" params={{ projectId: project.id }}>
            {project.name}
          </Link>
        }
        meta={status.value ? <StatusBadge kind="preparation" value={status.value} label={m.rungroup_status({ status: status.label })} /> : <Pill tone="muted">{m.run_not_prepared()}</Pill>}
        description={
          <span className="flex flex-wrap items-center gap-1.5" data-run-facts>
            <Pill tone="muted" icon={Layers} title={m.rungroup_mosaic_fixed()}>
              {subject ? subjectName(m, state.catalog, subject) : m.status_unknown()}
            </Pill>
            <Pill tone="muted" icon={Lock} title={m.run_rig_fixed()}>
              {rigName(m, state.catalog, group.rigId)}
            </Pill>
            <Pill tone="info">{m.rungroup_panels_count({ count: pipeline.panels.length - trashed })}</Pill>
            {trashed > 0 ? (
              <Pill tone="muted" icon={Trash2}>
                {m.rungroup_in_trash({ count: trashed })}
              </Pill>
            ) : null}
          </span>
        }
      />
      <StepBar label={m.calibration_steps_of({ name: group.name })} steps={pipeline.steps} here={step} nextId={pipeline.next?.step?.id ?? null} linkFor={(id) => groupStepLink(group, id) as { to: string; params: Record<string, string> }} />
      {outcome.outcome ? (
        <div className="px-5 pt-3">
          <OutcomeNotice outcome={outcome.outcome} onDismiss={outcome.clear} />
        </div>
      ) : null}
      {step === "review" ? (
        <>
          <PanelStrip panels={pipeline.panels} />
          <GroupReviewStep groupId={group.id} />
        </>
      ) : (
        <PageBody>
          <PanelsTable group={group} panels={pipeline.panels} step={step} />
          {step === "select" ? <GroupSelect group={group} onOutcome={outcome.act} /> : null}
          {step === "calibrate" ? <GroupCalibrate group={group} panels={pipeline.panels} onOutcome={outcome.act} /> : null}
          {step === "prepare" ? <GroupPrepare group={group} onOutcome={outcome.act} /> : null}
          {step === "results" ? <GroupResults group={group} panels={pipeline.panels} onOutcome={outcome.act} /> : null}
          {step === "done" ? <GroupDone group={group} panels={pipeline.panels} onOutcome={outcome.act} /> : null}
        </PageBody>
      )}
    </div>
  )
}

function panelFrames(p: GroupPanelState): number {
  return workingContent(p.run)?.included.length ?? 0
}

/** A panel run's right-click entries: open it at a step, or its Project Trash when trashed. */
function usePanelMenu(group: RunGroup) {
  const m = useMessages()
  const navigate = useNavigate()
  const openRun = (run: Run, step: RunStep) => void navigate({ to: "/projects/$projectId/runs/$runId/$step", params: { projectId: run.projectId, runId: run.id, step } })
  return (p: GroupPanelState, step: RunStep, extra: MenuEntry[] = []): MenuEntry[] =>
    p.trashed
      ? [{ heading: p.run.name }, { label: m.run_open_trash(), icon: Trash2, onSelect: () => void navigate({ to: "/projects/$projectId/trash", params: { projectId: group.projectId } }) }]
      : [{ heading: p.run.name }, { label: m.activity_open_destination({ name: stepName(m, step) }), icon: Eye, onSelect: () => openRun(p.run, step) }, ...extra]
}

function PanelStrip({ panels }: { panels: GroupPanelState[] }) {
  const m = useMessages()
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 border-b border-separator px-5 py-1.5 text-[0.75rem]" aria-label={m.rungroup_panels()}>
      {panels.map((p) => (
        <li key={p.run.id} className="flex items-center gap-1.5">
          <span className="font-medium">{panelLabel(m, p.panel)}</span>
          {p.trashed ? <Pill tone="muted">{m.status_trashed()}</Pill> : <GateLabel state={p.pipeline.steps[1]!.state} label={m.rungroup_review_status({ status: say(m, p.pipeline.steps[1]!.status) })} />}
        </li>
      ))}
    </ul>
  )
}

function PanelsTable({ group, panels, step }: { group: RunGroup; panels: GroupPanelState[]; step: RunStep }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const menu = usePanelMenu(group)
  const index = RUN_STEPS.indexOf(step)
  const total = panels.filter((p) => !p.trashed).reduce((n, p) => n + panelFrames(p), 0)
  const allColumns: Column<GroupPanelState>[] = [
    { id: "panel", header: m.rungroup_col_panel(), rowHeader: true, cell: (p) => panelLabel(m, p.panel), sortValue: (p) => p.panel.n },
    {
      id: "run",
      header: m.rungroup_col_panel_run(),
      cell: (p) =>
        p.trashed ? (
          <Link className="text-link underline-offset-4 hover:underline" to="/projects/$projectId/trash" params={{ projectId: group.projectId }}>
            {p.run.name}
          </Link>
        ) : (
          <Link className="text-link underline-offset-4 hover:underline" to="/projects/$projectId/runs/$runId/$step" params={{ projectId: group.projectId, runId: p.run.id, step }}>
            {p.run.name}
          </Link>
        ),
    },
    { id: "status", header: m.rungroup_col_status(), cell: (p) => <StatusBadge kind="run" value={p.trashed ? "trashed" : p.run.completion === "complete" ? "complete" : "open"} /> },
    { id: "step", header: stepName(m, step), cell: (p) => (p.trashed ? <Pill tone="muted">{m.status_skipped()}</Pill> : <GateLabel state={p.pipeline.steps[index]!.state} label={say(m, p.pipeline.steps[index]!.status)} />) },
    { id: "frames", header: m.run_col_frames(), align: "right", cell: (p) => (p.trashed ? <span className="text-muted-foreground">–</span> : panelFrames(p)), sortValue: (p) => (p.trashed ? -1 : panelFrames(p)) },
    {
      id: "prep",
      header: m.run_preparation(),
      cell: (p) => {
        if (p.trashed) return <span className="text-muted-foreground">–</span>
        const prep = currentPreparation(p.run, runPreparations(state.catalog, p.run.id))
        return prep ? <PrepStateBadge prep={prep} /> : <span className="text-[0.75rem] text-muted-foreground">{m.run_not_prepared()}</span>
      },
    },
  ]
  const columns = allColumns.filter((c) => step !== "prepare" || c.id !== "prep")
  return (
    <Box
      id="group-panels"
      level={2}
      flush
      title={
        <span className="flex items-center gap-1.5">
          {m.rungroup_panels()} <CountBadge count={panels.length} label={m.rungroup_panels_count({ count: panels.length })} />
        </span>
      }
      actions={<Pill tone="muted">{m.run_frames_count({ count: total })}</Pill>}
    >
      <DataTable label={m.rungroup_panels_label({ name: group.name })} rows={panels} columns={columns} getRowId={(p) => p.run.id} scroll="none" rowClassName={(p) => (p.trashed ? "text-muted-foreground" : undefined)} contextMenu={(p) => menu(p, step)} />
    </Box>
  )
}

function GroupSelect({ group, onOutcome }: { group: RunGroup; onOutcome: Act }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const navigate = useNavigate()
  const { byPanel, flagged } = groupCandidates(state.catalog, group)
  const live = livePanelRuns(state, group)
  const memberIds = new Set(live.flatMap((r) => (workingContent(r)?.sessions ?? []).map((s) => s.sessionId)))
  const toPlace = flagged.filter((f) => !memberIds.has(f.candidate.session.id))
  const drafts = live.filter((r) => r.draft && r.completion !== "complete")
  const panels = state.catalog.projects[group.projectId]?.subjects.find((s) => s.id === group.subjectId)?.mosaic?.panels ?? []
  const panelNameRef = (r: Run): MessageRef => {
    const panel = panels.find((p) => p.id === r.panelId)
    return panel ? panelRef(panel) : verbatim(r.name)
  }
  const panelName = (r: Run) => say(m, panelNameRef(r))
  const place = (r: Run, f: (typeof toPlace)[number]) => onOutcome(addRunSessions(r.id, [f.candidate.session.id], { kind: "panel-assigned", detail: msg("rungroup_placed_by_you", { panel: panelNameRef(r), detail: f.detail }) }), { blocked: m.rungroup_place_blocked() })
  const sessionName = (f: (typeof toPlace)[number]) => `${formatNight(f.candidate.session.night)} · ${f.candidate.session.channel ?? m.palette_session_no_filter()}`
  return (
    <>
      <Box
        id="group-flagged"
        level={2}
        flush
        title={
          <span className="flex items-center gap-1.5">
            {m.rungroup_to_place()} <CountBadge count={toPlace.length} tone={toPlace.length > 0 ? "warning" : "neutral"} label={m.rungroup_sessions_count({ count: toPlace.length })} />
          </span>
        }
      >
        {toPlace.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">{m.rungroup_all_placed()}</p>
        ) : (
          <ul className="divide-y divide-separator">
            {toPlace.map((f) => (
              <RowContextMenu
                key={f.candidate.session.id}
                entries={[
                  { heading: sessionName(f) },
                  ...live.map((r) => ({ label: m.rungroup_place_on({ panel: panelName(r) }), icon: MapPin, onSelect: () => place(r, f) })),
                  { separator: true },
                  { label: m.project_open_session(), icon: Eye, onSelect: () => void navigate({ to: "/sessions/$sessionId", params: { sessionId: f.candidate.session.id } }) },
                ]}
              >
                <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {sessionName(f)}
                    <Pill tone="warning">{say(m, f.detail)}</Pill>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {live.map((r) => (
                      <Button key={r.id} size="xs" variant="outline" onClick={() => place(r, f)}>
                        {m.rungroup_place_on({ panel: panelName(r) })}
                      </Button>
                    ))}
                  </span>
                </li>
              </RowContextMenu>
            ))}
          </ul>
        )}
      </Box>
      <Box
        id="group-selections"
        level={2}
        flush
        title={m.rungroup_selections()}
        actions={
          <Button size="xs" disabled={drafts.length === 0} onClick={() => drafts.every((r) => onOutcome(saveRun(r.id), { blocked: m.run_save_blocked() }))}>
            {m.rungroup_save_panels({ count: drafts.length })}
          </Button>
        }
      >
        <ul className="divide-y divide-separator text-sm">
          {live.map((r) => (
            <RowContextMenu
              key={r.id}
              entries={[
                { heading: r.name },
                { label: m.review_open_select(), icon: Eye, onSelect: () => void navigate({ to: "/projects/$projectId/runs/$runId/$step", params: { projectId: r.projectId, runId: r.id, step: "select" } }) },
                ...(r.draft && r.completion !== "complete" ? [{ label: m.rungroup_save(), icon: Save, onSelect: () => onOutcome(saveRun(r.id), { blocked: m.run_save_blocked() }) }] : []),
              ]}
            >
              <li className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1">
                <Link className="inline-flex min-h-6 w-56 items-center text-link underline-offset-4 hover:underline" to="/projects/$projectId/runs/$runId/$step" params={{ projectId: r.projectId, runId: r.id, step: "select" }}>
                  {r.name}
                </Link>
                <span className="flex flex-wrap items-center gap-1">
                  <Pill tone="muted">{m.rungroup_sessions_count({ count: workingContent(r)?.sessions.length ?? 0 })}</Pill>
                  <Pill tone="muted">{m.rungroup_candidates_count({ count: (byPanel[r.panelId ?? ""] ?? []).length })}</Pill>
                  {r.draft ? <Pill tone="warning">{m.rungroup_unsaved()}</Pill> : <Pill tone="success">{m.run_revision_short({ revision: r.revisions.at(-1)?.revision ?? 0 })}</Pill>}
                </span>
              </li>
            </RowContextMenu>
          ))}
        </ul>
      </Box>
    </>
  )
}

function GroupCalibrate({ group, panels, onOutcome }: { group: RunGroup; panels: GroupPanelState[]; onOutcome: Act }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const id = useId()
  const menu = usePanelMenu(group)
  return (
    <Box
      id="group-readiness"
      level={2}
      flush
      title={
        <span className="flex items-center gap-1.5">
          {m.run_cal_readiness()}
          <HelpTip label={m.rungroup_cal_policy()}>{m.rungroup_cal_policy_help()}</HelpTip>
        </span>
      }
      actions={
        <span className="flex items-center gap-2">
          <Switch id={id} checked={group.setup.calibrationPolicy === "automatic"} onCheckedChange={(checked) => onOutcome(changeGroupSetup(group.id, { calibrationPolicy: checked ? "automatic" : "off" }), { blocked: m.run_cal_policy_blocked() })} />
          <Label htmlFor={id} className="text-xs">
            {m.run_cal_auto_assign()}
          </Label>
        </span>
      }
    >
      <ul className="divide-y divide-separator">
        {panels.map((p) => {
          const plan = calibrationPlan(state.catalog, state.disk, p.run, group.setup.calibrationPolicy, workingContent(p.run))
          const kinds = readinessByKind(plan).filter((k) => k.total > 0)
          return (
            <RowContextMenu key={p.run.id} entries={menu(p, "calibrate")}>
              <li className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-sm" data-panel-readiness={p.run.id}>
                <span className="w-24 font-medium">{panelLabel(m, p.panel)}</span>
                <span className="flex flex-1 flex-wrap items-center gap-1">
                  {p.trashed ? (
                    <Pill tone="muted">{m.status_skipped()}</Pill>
                  ) : plan.policy === "off" ? (
                    <Pill tone="muted">{m.run_cal_off()}</Pill>
                  ) : kinds.length === 0 ? (
                    <Pill tone="muted">{m.run_cal_no_sessions()}</Pill>
                  ) : (
                    kinds.map((k) => (
                      <Pill key={k.kind} tone={k.matched === k.total ? "success" : "warning"}>
                        {say(m, KIND_NAME[k.kind])} {k.automatic ? "✓" : `${k.matched}/${k.total}`}
                      </Pill>
                    ))
                  )}
                  {!p.trashed && plan.needsReview.length > 0 ? <Pill tone="warning">{m.run_cal_to_review({ count: plan.needsReview.length })}</Pill> : null}
                </span>
                {!p.trashed ? (
                  <Button size="xs" variant="outline" render={<Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: p.run.projectId, runId: p.run.id, step: "calibrate" }} />}>
                    {m.verb_review()}
                  </Button>
                ) : null}
              </li>
            </RowContextMenu>
          )
        })}
      </ul>
    </Box>
  )
}

function aggregateModes(lists: ModeOption[][]): ModeOption[] {
  const first = lists[0] ?? []
  return first.map((option) => {
    const all = lists.map((l) => l.find((x) => x.mode === option.mode)!)
    // Panels refuse a mode for the same reason in the same words; refs are compared by their content.
    const reasons = [...new Map(all.flatMap((x) => x.reasons).map((r) => [JSON.stringify(r), r])).values()]
    return { ...option, allowed: reasons.length === 0, reasons, footprintBytes: all.reduce((n, x) => n + x.footprintBytes, 0) }
  })
}

function GroupPrepare({ group, onOutcome }: { group: RunGroup; onOutcome: Act }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const project = state.catalog.projects[group.projectId]!
  const subject = project.subjects.find((s) => s.id === group.subjectId)
  const mosaic = subject?.mosaic?.name ?? group.name
  const choices = prepareChoices(state, group.id)
  const revision = nextGroupRevision(state, group)
  const live = livePanelRuns(state, group).filter((r) => r.completion !== "complete")
  const plans = live.map((run) => ({ run, plan: preparePlan(state, run, choices, { groupRevision: revision }) }))
  const first = plans[0]?.plan
  const setupRefusals = groupSetupRefusals(state, group)
  const [confirm, setConfirm] = useState(false)
  const status = groupOutcome(state, group)
  const allLive = livePanelRuns(state, group)
  const target = { groupId: group.id }
  return (
    <>
      <Box
        id="group-outcome"
        level={2}
        title={
          <span className="flex items-center gap-1.5">
            {m.rungroup_outcome()}
            {status.value ? <StatusBadge kind="preparation" value={status.value} label={status.label} /> : <Pill tone="muted">{status.label}</Pill>}
          </span>
        }
        actions={
          <Button size="xs" variant="outline" onClick={() => onOutcome(openGroupFolder(group.id), { blocked: m.run_open_blocked(), success: { title: m.run_opened({ name: group.name }), tone: "info" } })} title={m.rungroup_open_folder_title()}>
            <FolderOpen aria-hidden="true" data-icon="inline-start" />
            {m.rungroup_open_folder()}
          </Button>
        }
      >
        <div className="space-y-3">
          {allLive.map((run) => (
            <PreparationOutcome key={run.id} run={run} onOutcome={onOutcome} compact />
          ))}
          {allLive.every((run) => runPreparations(state.catalog, run.id).length === 0) ? <p className="text-sm text-muted-foreground">{m.run_not_prepared()}</p> : null}
        </div>
      </Box>
      {setupRefusals.length > 0 ? <Refusal action={m.rungroup_setup_locked()} reason={m.rungroup_complete_panels({ count: setupRefusals.length })} blockers={setupRefusals.map((label) => ({ label: say(m, label) }))} /> : null}
      <ProfileSection profileId={group.setup.profileId} locked={false} onPick={(id) => onOutcome(chooseProfile(target, id), { blocked: m.run_profile_blocked() })} />
      <ModeSection modes={aggregateModes(plans.map((p) => p.plan.modes))} mode={group.setup.inputMode} linkType={choices.linkType} locked={false} onMode={(mode: InputMode) => onOutcome(chooseMode(target, mode), { blocked: m.run_mode_blocked() })} onLinkType={(t) => updatePrepareChoices(group.id, { linkType: t })} />
      {first ? (
        <LayoutSection
          layout={first.layout}
          locked={false}
          onParent={(path) => onOutcome(setOutputParent(target, path), { blocked: m.run_folder_blocked() })}
          lines={(l) => (
            <>
              <LayoutLine path={`${l.parent.path ?? m.run_layout_output()}/`} note={l.parent.origin === "none" ? m.run_layout_not_chosen() : m.run_layout_output_note()} />
              <LayoutLine path={`${project.name}/`} note={m.run_col_project()} depth={1} />
              <LayoutLine path={`${mosaic}${revision > 1 ? ` (rev ${revision})` : ""}/`} note={revision > 1 ? m.rungroup_layout_folder_rev({ revision }) : m.rungroup_layout_folder()} depth={2} emphasis />
              {plans.map(({ run, plan }) => (
                <LayoutLine key={run.id} path={`${fileName(plan.layout.folderPath ?? "Panel")}/`} note={`${run.name} · ${m.rungroup_inputs_count({ count: plan.entries.length })}`} depth={3} />
              ))}
              <LayoutLine path={`${mosaic} Results/`} note={m.step_results()} depth={2} />
              {plans.map(({ run, plan }) => (
                <LayoutLine key={run.id} path={`${fileName(plan.layout.resultsPath ?? "Panel")}/`} note={run.name} depth={3} />
              ))}
              <LayoutLine path="Assembled/" note={m.rungroup_result()} depth={3} />
            </>
          )}
        />
      ) : null}
      {plans.map(({ run, plan }) => (plan.diffs.length > 0 ? <MetadataSection key={run.id} plan={plan} locked={false} onChoice={(key, choice) => updatePrepareChoices(group.id, { metadata: { ...choices.metadata, [key]: choice } })} /> : null))}
      <Box
        id="group-review-prep"
        level={2}
        title={
          <span className="flex items-center gap-1.5">
            {m.rungroup_review_all()} <CountBadge count={live.length} label={m.rungroup_panel_runs_count({ count: live.length })} />
            {live.length > 0 ? <Pill tone="muted">{m.run_rev({ revision })}</Pill> : null}
          </span>
        }
        actions={
          <Button size="xs" onClick={() => (plans.length > 0 && plans.every((p) => p.plan.ready) ? setConfirm(true) : onOutcome(prepareAll(group.id), { blocked: m.rungroup_prepare_all_blocked() }))}>
            <Play aria-hidden="true" data-icon="inline-start" />
            {m.rungroup_prepare_all()}
          </Button>
        }
      >
        {live.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.rungroup_every_panel_complete()}</p>
        ) : (
          <div className="grid gap-3 xl:grid-cols-2">
            {plans.map(({ run, plan }) => (
              <div key={run.id} className="space-y-1">
                <h3 className="text-[0.75rem] font-medium">{run.name}</h3>
                <div className="rounded-md border">
                  <ChecksList checks={plan.checks} />
                </div>
              </div>
            ))}
          </div>
        )}
      </Box>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={m.rungroup_prepare_all_title({ count: live.length, name: group.name })}
        description={`${profileLabel(state.catalog, group.setup.profileId)} · ${group.setup.inputMode ? say(m, MODE_NAME[group.setup.inputMode]) : ""}`}
        changes={[
          m.rungroup_prepare_all_creates({ folder: fileName(first?.layout.groupFolder ?? mosaic), panels: plans.map((p) => fileName(p.plan.layout.folderPath ?? "")).join(", ") }),
          ...plans.map((p) => {
            const blocked = p.plan.entries.filter((e) => e.unavailable).length
            return `${p.run.name}: ${m.rungroup_inputs_count({ count: p.plan.entries.length })}${blocked > 0 ? ` · ${m.rungroup_blocked_count({ count: blocked })}` : ""}`
          }),
        ]}
        confirmLabel={m.rungroup_prepare_panels({ count: live.length })}
        onConfirm={() => {
          const r = prepareAll(group.id)
          onOutcome(r, { blocked: m.rungroup_prepare_all_blocked() })
          return r.result
        }}
      />
    </>
  )
}

const GROUP_KINDS: ResultKind[] = ["assembled-mosaic"]

function GroupResults({ group, panels, onOutcome }: { group: RunGroup; panels: GroupPanelState[]; onOutcome: Act }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const menu = usePanelMenu(group)
  const assembled = groupAssembledPath(state, group)
  useEffect(() => {
    discoverResults({ groupId: group.id })
  }, [group.id])
  const records = Object.values(state.catalog.results).filter((r) => r.groupId === group.id && r.runId === null && !r.trashed)
  const preps = Object.values(state.catalog.preparations).filter((p) => p.groupId === group.id)
  const rows = records.map((r) => resultRow(state, r, preps))
  const [attaching, setAttaching] = useState(false)
  return (
    <>
      <Box
        id="group-result"
        level={2}
        flush
        title={
          <span className="flex items-center gap-1.5">
            {m.rungroup_result()}
            <HelpTip label={m.rungroup_result()}>{m.rungroup_result_help({ folder: assembled ?? m.rungroup_result_folder_placeholder() })}</HelpTip>
          </span>
        }
        actions={
          <>
            <PrototypeMenu actions={[{ label: m.rungroup_proto_writes_mosaic(), detail: m.rungroup_proto_writes_mosaic_detail(), run: () => onOutcome(simulateApplicationOutput({ groupId: group.id }), { blocked: m.run_proto_blocked() }) }]} />
            <Button size="xs" variant="outline" onClick={() => onOutcome(discoverResults({ groupId: group.id }), { blocked: m.run_results_look_again_blocked() })}>
              {m.run_results_look_again()}
            </Button>
            <Button size="xs" variant="outline" onClick={() => setAttaching(true)}>
              {m.run_results_attach_ellipsis()}
            </Button>
          </>
        }
      >
        <ResultsTable rows={rows} rigId={group.rigId} onOutcome={onOutcome} kinds={GROUP_KINDS} />
      </Box>
      <Box id="group-panel-results" level={2} flush title={m.rungroup_panel_results()}>
        <ul className="divide-y divide-separator text-sm">
          {panels.map((p) => {
            const { products, intermediates } = runResults(state.catalog, p.run.id)
            const accepted = products.filter((r) => r.acceptance === "accepted").length
            return (
              <RowContextMenu key={p.run.id} entries={menu(p, "results")}>
                <li className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                  <span className="w-24 font-medium">{panelLabel(m, p.panel)}</span>
                  <span className="flex flex-1 flex-wrap items-center gap-1">
                    {p.trashed ? (
                      <Pill tone="muted">{m.status_skipped()}</Pill>
                    ) : (
                      <>
                        <Pill tone={accepted > 0 ? "success" : "muted"}>{m.rungroup_accepted_count({ count: accepted })}</Pill>
                        <Pill tone="muted">{m.rungroup_candidates_count({ count: products.length - accepted })}</Pill>
                        <Pill tone="muted">{m.run_results_intermediates_count({ count: intermediates.length })}</Pill>
                      </>
                    )}
                  </span>
                  {!p.trashed ? (
                    <Button size="xs" variant="outline" render={<Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: p.run.projectId, runId: p.run.id, step: "results" }} />} aria-label={m.rungroup_open_panel_results({ panel: panelLabel(m, p.panel) })}>
                      {m.verb_open()}
                    </Button>
                  ) : null}
                </li>
              </RowContextMenu>
            )
          })}
        </ul>
      </Box>
      <AttachDialog open={attaching} onOpenChange={setAttaching} defaultFolder={assembled} kinds={GROUP_KINDS} onAttach={(path, kind, channel) => onOutcome(attachResult({ groupId: group.id }, path, kind as ResultKind, channel), { blocked: m.run_results_attach_blocked() })} />
    </>
  )
}

function GroupDone({ group, panels, onOutcome }: { group: RunGroup; panels: GroupPanelState[]; onOutcome: Act }) {
  const m = useMessages()
  const project = useStore((s) => s.catalog.projects[group.projectId])!
  const menu = usePanelMenu(group)
  const navigate = useNavigate()
  return (
    <Box
      id="group-done"
      level={2}
      flush
      title={m.run_completion()}
      actions={
        <>
          <WrapUpLink project={project} />
          <Button size="xs" onClick={() => onOutcome(completeAllPanels(group.id), { blocked: m.rungroup_complete_all_blocked(), success: { title: m.rungroup_every_panel_complete(), tone: "info" } })}>
            <ShieldCheck aria-hidden="true" data-icon="inline-start" />
            {m.rungroup_complete_all()}
          </Button>
        </>
      }
    >
      <ul className="divide-y divide-separator text-sm">
        {panels.map((p) => (
          <RowContextMenu
            key={p.run.id}
            entries={menu(p, "done", p.run.completion === "complete" ? [{ label: m.run_clean_up(), icon: Wand2, onSelect: () => void navigate({ to: "/projects/$projectId/runs/$runId/$step", params: { projectId: p.run.projectId, runId: p.run.id, step: "done" }, hash: "cleanup" }) }] : [])}
          >
            <li className="flex flex-wrap items-center gap-2 px-3 py-1.5">
              <span className="w-24 font-medium">{panelLabel(m, p.panel)}</span>
              <span className="flex flex-1 flex-wrap items-center gap-1.5 text-[0.75rem]">
                {p.trashed ? <Pill tone="muted">{m.status_skipped()}</Pill> : <GateLabel state={p.pipeline.steps[5]!.state} label={say(m, p.pipeline.steps[5]!.status)} />}
                {!p.trashed ? <FootprintPill run={p.run} /> : null}
              </span>
              {!p.trashed ? (
                <Button size="xs" variant="outline" render={<Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: p.run.projectId, runId: p.run.id, step: "done" }} hash="cleanup" />}>
                  {p.run.completion === "complete" ? m.run_clean_up() : m.rungroup_open_done()}
                </Button>
              ) : null}
            </li>
          </RowContextMenu>
        ))}
      </ul>
    </Box>
  )
}
