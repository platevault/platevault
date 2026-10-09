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
import { GateLabel } from "@/app/run-ui"
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
import { calibrationPlan, KIND_LABEL } from "@/domain/calibration"
import { type GroupPanelState, groupCandidates, groupPipeline, groupStepLink, panelLabel, rigName, runPreparations, runResults, subjectName, workingContent } from "@/domain/derive"
import { MODE_LABEL, RESULT_KIND_LABEL, RUN_STEPS, STEP_LABEL } from "@/domain/labels"
import type { InputMode, Preparation, ResultKind, Run, RunGroup, RunStep } from "@/domain/types"
import { fileName, formatNight, plural } from "@/lib/format"
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
  const { projectId, groupId, step } = useParams({ strict: false }) as { projectId?: string; groupId?: string; step?: string }
  const state = useStore((s) => s)
  const group = groupId ? state.catalog.runGroups[groupId] : undefined
  const project = group ? state.catalog.projects[group.projectId] : undefined
  if (!group || !project || group.projectId !== projectId) return <MissingRecord noun="run group" backTo={projectId ? `/projects/${projectId}` : "/projects"} backLabel="Open the Project" />
  if (!RUN_STEPS.includes(step as RunStep)) return <MissingRecord noun="run step" backTo={`/projects/${project.id}/groups/${group.id}/select`} backLabel="Open Select" />
  return <GroupScreen group={group} step={step as RunStep} />
}

/** The group outcome of its current preparations: Partial when one panel is Partial (PREP-FR-12). */
export function groupOutcome(state: PrototypeState, group: RunGroup): { label: string; tone: "preparation"; value: Preparation["state"] | null; detail: string } {
  const live = livePanelRuns(state, group)
  const preps = live.map((run) => ({ run, prep: currentPreparation(run, runPreparations(state.catalog, run.id)) }))
  const missing = preps.filter((p) => !p.prep).map((p) => p.run.name)
  const by = (s: Preparation["state"]) => preps.filter((p) => p.prep?.state === s)
  if (by("running").length > 0) return { label: "Running", tone: "preparation", value: "running", detail: `${plural(by("running").length, "panel")} preparing` }
  if (by("failed").length > 0) return { label: "Failed", tone: "preparation", value: "failed", detail: by("failed").map((p) => p.run.name).join(", ") }
  if (by("partial").length > 0) return { label: "Partial", tone: "preparation", value: "partial", detail: `${by("partial").map((p) => p.run.name).join(", ")} Partial` }
  if (missing.length > 0) return { label: missing.length === live.length ? "Not prepared" : "Not every panel prepared", tone: "preparation", value: null, detail: missing.join(", ") }
  return { label: "Prepared", tone: "preparation", value: "prepared", detail: `${plural(live.length, "panel")} prepared` }
}

function GroupScreen({ group, step }: { group: RunGroup; step: RunStep }) {
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
        meta={status.value ? <StatusBadge kind="preparation" value={status.value} label={`Group ${status.label}`} /> : <Pill tone="muted">Not prepared</Pill>}
        description={
          <span className="flex flex-wrap items-center gap-1.5" data-run-facts>
            <Pill tone="muted" icon={Layers} title="Mosaic (fixed)">
              {subject ? subjectName(state.catalog, subject) : "Unknown"}
            </Pill>
            <Pill tone="muted" icon={Lock} title="Rig (fixed)">
              {rigName(state.catalog, group.rigId)}
            </Pill>
            <Pill tone="info">{plural(pipeline.panels.length - trashed, "panel")}</Pill>
            {trashed > 0 ? (
              <Pill tone="muted" icon={Trash2}>
                {trashed} in Trash
              </Pill>
            ) : null}
          </span>
        }
      />
      <StepBar label={`${group.name} steps`} steps={pipeline.steps} here={step} nextId={pipeline.next?.step?.id ?? null} linkFor={(id) => groupStepLink(group, id) as { to: string; params: Record<string, string> }} />
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
  const navigate = useNavigate()
  const openRun = (run: Run, step: RunStep) => void navigate({ to: "/projects/$projectId/runs/$runId/$step", params: { projectId: run.projectId, runId: run.id, step } })
  return (p: GroupPanelState, step: RunStep, extra: MenuEntry[] = []): MenuEntry[] =>
    p.trashed
      ? [{ heading: p.run.name }, { label: "Open Trash", icon: Trash2, onSelect: () => void navigate({ to: "/projects/$projectId/trash", params: { projectId: group.projectId } }) }]
      : [{ heading: p.run.name }, { label: `Open ${STEP_LABEL[step]}`, icon: Eye, onSelect: () => openRun(p.run, step) }, ...extra]
}

function PanelStrip({ panels }: { panels: GroupPanelState[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 border-b border-separator px-5 py-1.5 text-[0.75rem]" aria-label="Panels">
      {panels.map((p) => (
        <li key={p.run.id} className="flex items-center gap-1.5">
          <span className="font-medium">{panelLabel(p.panel)}</span>
          {p.trashed ? <Pill tone="muted">Trashed</Pill> : <GateLabel state={p.pipeline.steps[1]!.state} label={`Review ${p.pipeline.steps[1]!.status}`} />}
        </li>
      ))}
    </ul>
  )
}

function PanelsTable({ group, panels, step }: { group: RunGroup; panels: GroupPanelState[]; step: RunStep }) {
  const state = useStore((s) => s)
  const menu = usePanelMenu(group)
  const index = RUN_STEPS.indexOf(step)
  const total = panels.filter((p) => !p.trashed).reduce((n, p) => n + panelFrames(p), 0)
  const allColumns: Column<GroupPanelState>[] = [
    { id: "panel", header: "Panel", rowHeader: true, cell: (p) => panelLabel(p.panel), sortValue: (p) => p.panel.n },
    {
      id: "run",
      header: "Panel run",
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
    { id: "status", header: "Status", cell: (p) => <StatusBadge kind="run" value={p.trashed ? "trashed" : p.run.completion === "complete" ? "complete" : "open"} /> },
    { id: "step", header: STEP_LABEL[step], cell: (p) => (p.trashed ? <Pill tone="muted">Skipped</Pill> : <GateLabel state={p.pipeline.steps[index]!.state} label={p.pipeline.steps[index]!.status} />) },
    { id: "frames", header: "Frames", align: "right", cell: (p) => (p.trashed ? <span className="text-muted-foreground">–</span> : panelFrames(p)), sortValue: (p) => (p.trashed ? -1 : panelFrames(p)) },
    {
      id: "prep",
      header: "Preparation",
      cell: (p) => {
        if (p.trashed) return <span className="text-muted-foreground">–</span>
        const prep = currentPreparation(p.run, runPreparations(state.catalog, p.run.id))
        return prep ? <PrepStateBadge prep={prep} /> : <span className="text-[0.75rem] text-muted-foreground">Not prepared</span>
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
          Panels <CountBadge count={panels.length} label={plural(panels.length, "panel")} />
        </span>
      }
      actions={<Pill tone="muted">{plural(total, "frame")}</Pill>}
    >
      <DataTable label={`Panels of ${group.name}`} rows={panels} columns={columns} getRowId={(p) => p.run.id} scroll="none" rowClassName={(p) => (p.trashed ? "text-muted-foreground" : undefined)} contextMenu={(p) => menu(p, step)} />
    </Box>
  )
}

function GroupSelect({ group, onOutcome }: { group: RunGroup; onOutcome: Act }) {
  const state = useStore((s) => s)
  const navigate = useNavigate()
  const { byPanel, flagged } = groupCandidates(state.catalog, group)
  const live = livePanelRuns(state, group)
  const memberIds = new Set(live.flatMap((r) => (workingContent(r)?.sessions ?? []).map((s) => s.sessionId)))
  const toPlace = flagged.filter((f) => !memberIds.has(f.candidate.session.id))
  const drafts = live.filter((r) => r.draft && r.completion !== "complete")
  const panels = state.catalog.projects[group.projectId]?.subjects.find((s) => s.id === group.subjectId)?.mosaic?.panels ?? []
  const panelName = (r: Run) => {
    const panel = panels.find((p) => p.id === r.panelId)
    return panel ? panelLabel(panel) : r.name
  }
  const place = (r: Run, f: (typeof toPlace)[number]) => onOutcome(addRunSessions(r.id, [f.candidate.session.id], { kind: "panel-assigned", detail: `Placed on ${panelName(r)} by you (${f.detail})` }))
  return (
    <>
      <Box
        id="group-flagged"
        level={2}
        flush
        title={
          <span className="flex items-center gap-1.5">
            To place <CountBadge count={toPlace.length} tone={toPlace.length > 0 ? "warning" : "neutral"} label={plural(toPlace.length, "session")} />
          </span>
        }
      >
        {toPlace.length === 0 ? (
          <p className="px-3 py-2 text-sm text-muted-foreground">All placed</p>
        ) : (
          <ul className="divide-y divide-separator">
            {toPlace.map((f) => (
              <RowContextMenu
                key={f.candidate.session.id}
                entries={[
                  { heading: `${formatNight(f.candidate.session.night)} · ${f.candidate.session.channel ?? "No filter"}` },
                  ...live.map((r) => ({ label: `Place on ${panelName(r)}`, icon: MapPin, onSelect: () => place(r, f) })),
                  { separator: true },
                  { label: "Open session", icon: Eye, onSelect: () => void navigate({ to: "/sessions/$sessionId", params: { sessionId: f.candidate.session.id } }) },
                ]}
              >
                <li className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm">
                  <span className="flex flex-wrap items-center gap-1.5">
                    {formatNight(f.candidate.session.night)} · {f.candidate.session.channel ?? "No filter"}
                    <Pill tone="warning">{f.detail}</Pill>
                  </span>
                  <span className="flex flex-wrap gap-1">
                    {live.map((r) => (
                      <Button key={r.id} size="xs" variant="outline" onClick={() => place(r, f)}>
                        Place on {panelName(r)}
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
        title="Selections"
        actions={
          <Button size="xs" disabled={drafts.length === 0} onClick={() => drafts.every((r) => onOutcome(saveRun(r.id)))}>
            Save {plural(drafts.length, "panel")}
          </Button>
        }
      >
        <ul className="divide-y divide-separator text-sm">
          {live.map((r) => (
            <RowContextMenu
              key={r.id}
              entries={[
                { heading: r.name },
                { label: "Open Select", icon: Eye, onSelect: () => void navigate({ to: "/projects/$projectId/runs/$runId/$step", params: { projectId: r.projectId, runId: r.id, step: "select" } }) },
                ...(r.draft && r.completion !== "complete" ? [{ label: "Save", icon: Save, onSelect: () => onOutcome(saveRun(r.id)) }] : []),
              ]}
            >
              <li className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1">
                <Link className="inline-flex min-h-6 w-56 items-center text-link underline-offset-4 hover:underline" to="/projects/$projectId/runs/$runId/$step" params={{ projectId: r.projectId, runId: r.id, step: "select" }}>
                  {r.name}
                </Link>
                <span className="flex flex-wrap items-center gap-1">
                  <Pill tone="muted">{plural(workingContent(r)?.sessions.length ?? 0, "session")}</Pill>
                  <Pill tone="muted">{plural((byPanel[r.panelId ?? ""] ?? []).length, "candidate")}</Pill>
                  {r.draft ? <Pill tone="warning">Unsaved</Pill> : <Pill tone="success">r{r.revisions.at(-1)?.revision ?? 0}</Pill>}
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
          Readiness
          <HelpTip label="Calibration policy">Shared by every panel; matched per panel run.</HelpTip>
        </span>
      }
      actions={
        <span className="flex items-center gap-2">
          <Switch id={id} checked={group.setup.calibrationPolicy === "automatic"} onCheckedChange={(checked) => onOutcome(changeGroupSetup(group.id, { calibrationPolicy: checked ? "automatic" : "off" }))} />
          <Label htmlFor={id} className="text-xs">
            Auto-assign
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
                <span className="w-24 font-medium">{panelLabel(p.panel)}</span>
                <span className="flex flex-1 flex-wrap items-center gap-1">
                  {p.trashed ? (
                    <Pill tone="muted">Skipped</Pill>
                  ) : plan.policy === "off" ? (
                    <Pill tone="muted">Off</Pill>
                  ) : kinds.length === 0 ? (
                    <Pill tone="muted">No sessions</Pill>
                  ) : (
                    kinds.map((k) => (
                      <Pill key={k.kind} tone={k.matched === k.total ? "success" : "warning"}>
                        {KIND_LABEL[k.kind]} {k.automatic ? "✓" : `${k.matched}/${k.total}`}
                      </Pill>
                    ))
                  )}
                  {!p.trashed && plan.needsReview.length > 0 ? <Pill tone="warning">{plan.needsReview.length} to review</Pill> : null}
                </span>
                {!p.trashed ? (
                  <Button size="xs" variant="outline" render={<Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: p.run.projectId, runId: p.run.id, step: "calibrate" }} />}>
                    Review
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
  return first.map((m) => {
    const all = lists.map((l) => l.find((x) => x.mode === m.mode)!)
    const reasons = [...new Set(all.flatMap((x) => x.reasons))]
    return { ...m, allowed: reasons.length === 0, reasons, footprintBytes: all.reduce((n, x) => n + x.footprintBytes, 0) }
  })
}

function GroupPrepare({ group, onOutcome }: { group: RunGroup; onOutcome: Act }) {
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
            Group outcome
            {status.value ? <StatusBadge kind="preparation" value={status.value} label={status.label} /> : <Pill tone="muted">{status.label}</Pill>}
          </span>
        }
        actions={
          <Button size="xs" variant="outline" onClick={() => onOutcome(openGroupFolder(group.id), { title: `Opened ${group.name}`, tone: "info" })} title="Every panel must be prepared and verified">
            <FolderOpen aria-hidden="true" data-icon="inline-start" />
            Open folder
          </Button>
        }
      >
        <div className="space-y-3">
          {allLive.map((run) => (
            <PreparationOutcome key={run.id} run={run} onOutcome={onOutcome} compact />
          ))}
          {allLive.every((run) => runPreparations(state.catalog, run.id).length === 0) ? <p className="text-sm text-muted-foreground">Not prepared</p> : null}
        </div>
      </Box>
      {setupRefusals.length > 0 ? <Refusal action="Setup locked" reason={plural(setupRefusals.length, "Complete panel")} blockers={setupRefusals.map((label) => ({ label }))} /> : null}
      <ProfileSection profileId={group.setup.profileId} locked={false} onPick={(id) => onOutcome(chooseProfile(target, id))} />
      <ModeSection modes={aggregateModes(plans.map((p) => p.plan.modes))} mode={group.setup.inputMode} linkType={choices.linkType} locked={false} onMode={(m: InputMode) => onOutcome(chooseMode(target, m))} onLinkType={(t) => updatePrepareChoices(group.id, { linkType: t })} />
      {first ? (
        <LayoutSection
          layout={first.layout}
          locked={false}
          onParent={(path) => onOutcome(setOutputParent(target, path))}
          lines={(l) => (
            <>
              <LayoutLine path={`${l.parent.path ?? "<output>"}/`} note={l.parent.origin === "none" ? "Not chosen" : "Output"} />
              <LayoutLine path={`${project.name}/`} note="Project" depth={1} />
              <LayoutLine path={`${mosaic}${revision > 1 ? ` (rev ${revision})` : ""}/`} note={`Group folder${revision > 1 ? ` · rev ${revision}` : ""}`} depth={2} emphasis />
              {plans.map(({ run, plan }) => (
                <LayoutLine key={run.id} path={`${fileName(plan.layout.folderPath ?? "Panel")}/`} note={`${run.name} · ${plural(plan.entries.length, "input")}`} depth={3} />
              ))}
              <LayoutLine path={`${mosaic} Results/`} note="Results" depth={2} />
              {plans.map(({ run, plan }) => (
                <LayoutLine key={run.id} path={`${fileName(plan.layout.resultsPath ?? "Panel")}/`} note={run.name} depth={3} />
              ))}
              <LayoutLine path="Assembled/" note="Group Result" depth={3} />
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
            Review all <CountBadge count={live.length} label={plural(live.length, "panel run")} />
            {live.length > 0 ? <Pill tone="muted">rev {revision}</Pill> : null}
          </span>
        }
        actions={
          <Button size="xs" onClick={() => (plans.length > 0 && plans.every((p) => p.plan.ready) ? setConfirm(true) : onOutcome(prepareAll(group.id)))}>
            <Play aria-hidden="true" data-icon="inline-start" />
            Prepare all…
          </Button>
        }
      >
        {live.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every panel Complete</p>
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
        title={`Prepare all ${plural(live.length, "panel")} of ${group.name}?`}
        description={`${profileLabel(state.catalog, group.setup.profileId)} · ${group.setup.inputMode ? MODE_LABEL[group.setup.inputMode] : ""}`}
        changes={[
          `Creates ${fileName(first?.layout.groupFolder ?? mosaic)}/ with ${plans.map((p) => fileName(p.plan.layout.folderPath ?? "")).join(", ")}`,
          ...plans.map((p) => `${p.run.name}: ${plural(p.plan.entries.length, "input")}${p.plan.entries.some((e) => e.unavailable) ? ` · ${plural(p.plan.entries.filter((e) => e.unavailable).length, "blocked")}` : ""}`),
        ]}
        confirmLabel={`Prepare ${plural(live.length, "panel")}`}
        onConfirm={() => {
          const r = prepareAll(group.id)
          onOutcome(r)
          return r.result
        }}
      />
    </>
  )
}

const GROUP_KINDS = [{ value: "assembled-mosaic", label: RESULT_KIND_LABEL["assembled-mosaic"] }]

function GroupResults({ group, panels, onOutcome }: { group: RunGroup; panels: GroupPanelState[]; onOutcome: Act }) {
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
            Group Result
            <HelpTip label="Group Result">Found only in {assembled ?? "<Mosaic> Results/Assembled"}/. The application assembles the panels.</HelpTip>
          </span>
        }
        actions={
          <>
            <PrototypeMenu actions={[{ label: "The application writes the assembled mosaic", detail: "One file in Assembled/.", run: () => onOutcome(simulateApplicationOutput({ groupId: group.id })) }]} />
            <Button size="xs" variant="outline" onClick={() => onOutcome(discoverResults({ groupId: group.id }))}>
              Look again
            </Button>
            <Button size="xs" variant="outline" onClick={() => setAttaching(true)}>
              Attach…
            </Button>
          </>
        }
      >
        <ResultsTable rows={rows} rigId={group.rigId} onOutcome={onOutcome} kindOptions={GROUP_KINDS} />
      </Box>
      <Box id="group-panel-results" level={2} flush title="Panel Results">
        <ul className="divide-y divide-separator text-sm">
          {panels.map((p) => {
            const { products, intermediates } = runResults(state.catalog, p.run.id)
            const accepted = products.filter((r) => r.acceptance === "accepted").length
            return (
              <RowContextMenu key={p.run.id} entries={menu(p, "results")}>
                <li className="flex flex-wrap items-center gap-2 px-3 py-1.5">
                  <span className="w-24 font-medium">{panelLabel(p.panel)}</span>
                  <span className="flex flex-1 flex-wrap items-center gap-1">
                    {p.trashed ? (
                      <Pill tone="muted">Skipped</Pill>
                    ) : (
                      <>
                        <Pill tone={accepted > 0 ? "success" : "muted"}>{accepted} accepted</Pill>
                        <Pill tone="muted">{plural(products.length - accepted, "candidate")}</Pill>
                        <Pill tone="muted">{plural(intermediates.length, "intermediate")}</Pill>
                      </>
                    )}
                  </span>
                  {!p.trashed ? (
                    <Button size="xs" variant="outline" render={<Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: p.run.projectId, runId: p.run.id, step: "results" }} />} aria-label={`Open ${panelLabel(p.panel)} Results`}>
                      Open
                    </Button>
                  ) : null}
                </li>
              </RowContextMenu>
            )
          })}
        </ul>
      </Box>
      <AttachDialog open={attaching} onOpenChange={setAttaching} defaultFolder={assembled} kindOptions={GROUP_KINDS} onAttach={(path, kind, channel) => onOutcome(attachResult({ groupId: group.id }, path, kind as ResultKind, channel))} />
    </>
  )
}

function GroupDone({ group, panels, onOutcome }: { group: RunGroup; panels: GroupPanelState[]; onOutcome: Act }) {
  const project = useStore((s) => s.catalog.projects[group.projectId])!
  const menu = usePanelMenu(group)
  const navigate = useNavigate()
  return (
    <Box
      id="group-done"
      level={2}
      flush
      title="Completion"
      actions={
        <>
          <WrapUpLink project={project} />
          <Button size="xs" onClick={() => onOutcome(completeAllPanels(group.id), { title: "Every panel Complete", tone: "info" })}>
            <ShieldCheck aria-hidden="true" data-icon="inline-start" />
            Complete all
          </Button>
        </>
      }
    >
      <ul className="divide-y divide-separator text-sm">
        {panels.map((p) => (
          <RowContextMenu
            key={p.run.id}
            entries={menu(p, "done", p.run.completion === "complete" ? [{ label: "Clean up", icon: Wand2, onSelect: () => void navigate({ to: "/projects/$projectId/runs/$runId/$step", params: { projectId: p.run.projectId, runId: p.run.id, step: "done" }, hash: "cleanup" }) }] : [])}
          >
            <li className="flex flex-wrap items-center gap-2 px-3 py-1.5">
              <span className="w-24 font-medium">{panelLabel(p.panel)}</span>
              <span className="flex flex-1 flex-wrap items-center gap-1.5 text-[0.75rem]">
                {p.trashed ? <Pill tone="muted">Skipped</Pill> : <GateLabel state={p.pipeline.steps[5]!.state} label={p.pipeline.steps[5]!.status} />}
                {!p.trashed ? <FootprintPill run={p.run} /> : null}
              </span>
              {!p.trashed ? (
                <Button size="xs" variant="outline" render={<Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: p.run.projectId, runId: p.run.id, step: "done" }} hash="cleanup" />}>
                  {p.run.completion === "complete" ? "Clean up" : "Open Done"}
                </Button>
              ) : null}
            </li>
          </RowContextMenu>
        ))}
      </ul>
    </Box>
  )
}
