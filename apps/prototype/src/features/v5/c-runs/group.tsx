/**
 * S7 Run group (slice C): the panels with per-panel status, the shared setup
 * (profile, input mode, calibration policy; a Complete panel refuses a setup
 * change), Review all (slice D's `GroupReviewStep`), calibration readiness
 * per panel, Prepare all into `<Mosaic>/Panel N/` with `<Mosaic> Results/
 * Panel N/` and `Assembled/`, the group outcome (Partial when one panel is
 * Partial), Open only when every panel is verified, and the group Result.
 * A trashed panel is listed as Trashed, its frames leave the counts and
 * every group action skips it (D-W38, D-W41, D-W73, D-W75).
 */
import { Link, useParams } from "@tanstack/react-router"
import { FolderOpen, Play, ShieldCheck } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { MissingRecord } from "@/app/missing-record"
import { GateLabel } from "@/app/run-ui"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { Notice } from "@/components/app/feedback"
import { type Column, DataTable } from "@/components/app/data-table"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { calibrationPlan, readinessLine } from "@/domain/calibration"
import { type GroupPanelState, groupCandidates, groupPipeline, groupStepLink, panelLabel, rigName, runPreparations, runResults, subjectName, workingContent } from "@/domain/derive"
import { MODE_LABEL, RESULT_KIND_LABEL, RUN_STEPS, STEP_LABEL } from "@/domain/labels"
import type { InputMode, Preparation, ResultKind, RunGroup, RunStep } from "@/domain/types"
import { fileName, formatNight, plural } from "@/lib/format"
import { addRunSessions, saveRun } from "@/store/actions/runs"
import { type PrototypeState, useStore } from "@/store/core"
import { GroupReviewStep } from "../d-review/review"
import { attachResult, changeGroupSetup, chooseMode, chooseProfile, completeAllPanels, discoverResults, groupSetupRefusals, openGroupFolder, prepareAll, prepareChoices, setOutputParent, simulateApplicationOutput, updatePrepareChoices } from "./actions"
import { currentPreparation, groupAssembledPath, livePanelRuns, type ModeOption, nextGroupRevision, preparePlan, readinessText, resultRow } from "./model"
import { LayoutLine, OutcomeNotice, PrototypeMenu, StepBar, useOutcome } from "./parts"
import { ChecksList, LayoutSection, MetadataSection, ModeSection, PreparationOutcome, PrepStateBadge, ProfileSection } from "./prepare-step"
import { AttachDialog, ResultsTable } from "./results-step"

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
        meta={status.value ? <StatusBadge kind="preparation" value={status.value} label={`Group ${status.label}`} /> : <span className="text-[0.75rem] text-muted-foreground">Group not prepared</span>}
        description={
          <>
            Mosaic <span className="text-foreground">{subject ? subjectName(state.catalog, subject) : "Unknown"}</span> on <span className="text-foreground">{rigName(state.catalog, group.rigId)}</span> (fixed) · {plural(pipeline.panels.length - trashed, "panel run")}
            {trashed > 0 ? `, ${trashed} in the Trash` : ""}; one shared setup.
          </>
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
          {step === "prepare" ? <GroupPrepare group={group} onOutcome={outcome.act} allVerified={pipeline.allVerified} /> : null}
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

function PanelStrip({ panels }: { panels: GroupPanelState[] }) {
  return (
    <ul className="flex flex-wrap gap-x-5 gap-y-1 border-b border-separator px-5 py-1.5 text-[0.75rem]" aria-label="Panels">
      {panels.map((p) => (
        <li key={p.run.id} className="flex items-center gap-1.5">
          <span className="font-medium">{panelLabel(p.panel)}</span>
          {p.trashed ? <span className="text-muted-foreground">Trashed · frames out of the counts</span> : <GateLabel state={p.pipeline.steps[1]!.state} label={`Review ${p.pipeline.steps[1]!.status}`} />}
        </li>
      ))}
    </ul>
  )
}

function PanelsTable({ group, panels, step }: { group: RunGroup; panels: GroupPanelState[]; step: RunStep }) {
  const state = useStore((s) => s)
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
    { id: "step", header: STEP_LABEL[step], cell: (p) => (p.trashed ? <span className="text-[0.75rem] text-muted-foreground">Skipped by group actions</span> : <GateLabel state={p.pipeline.steps[index]!.state} label={p.pipeline.steps[index]!.status} />) },
    { id: "frames", header: "Frames", align: "right", cell: (p) => (p.trashed ? <span className="text-muted-foreground" title="A trashed panel's frames leave the counts">–</span> : panelFrames(p)), sortValue: (p) => (p.trashed ? -1 : panelFrames(p)) },
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
    <Section title="Panels" id="group-panels" description={`${plural(total, "frame")} in the panels outside the Trash. Each panel run has its own status.`}>
      <DataTable label={`Panels of ${group.name}`} rows={panels} columns={columns} getRowId={(p) => p.run.id} scroll="none" rowClassName={(p) => (p.trashed ? "text-muted-foreground" : undefined)} />
    </Section>
  )
}

function GroupSelect({ group, onOutcome }: { group: RunGroup; onOutcome: Act }) {
  const state = useStore((s) => s)
  const { byPanel, flagged } = groupCandidates(state.catalog, group)
  const live = livePanelRuns(state, group)
  const memberIds = new Set(live.flatMap((r) => (workingContent(r)?.sessions ?? []).map((s) => s.sessionId)))
  const toPlace = flagged.filter((f) => !memberIds.has(f.candidate.session.id))
  const drafts = live.filter((r) => r.draft && r.completion !== "complete")
  return (
    <>
      <Section
        title="Sessions to place"
        id="group-flagged"
        description="Each session is placed on a panel by its pointing. Ambiguous and off-panel sessions wait for you."
      >
        {toPlace.length === 0 ? (
          <p className="text-sm text-muted-foreground">Every candidate is placed on a panel.</p>
        ) : (
          <ul className="divide-y divide-separator rounded-md border">
            {toPlace.map((f) => (
              <li key={f.candidate.session.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm">
                <span>
                  {formatNight(f.candidate.session.night)} · {f.candidate.session.channel ?? "No filter"} <span className="text-[0.75rem] text-warning">{f.detail}</span>
                </span>
                <span className="flex flex-wrap gap-1">
                  {live.map((r) => {
                    const panel = state.catalog.projects[group.projectId]?.subjects.find((s) => s.id === group.subjectId)?.mosaic?.panels.find((p) => p.id === r.panelId)
                    return (
                      <Button key={r.id} size="xs" variant="outline" onClick={() => onOutcome(addRunSessions(r.id, [f.candidate.session.id], { kind: "panel-assigned", detail: `Placed on ${panel ? panelLabel(panel) : r.name} by you (${f.detail})` }))}>
                        Place on {panel ? panelLabel(panel) : r.name}
                      </Button>
                    )
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section
        title="Panel selections"
        id="group-selections"
        actions={
          <Button size="sm" disabled={drafts.length === 0} onClick={() => drafts.every((r) => onOutcome(saveRun(r.id)))}>
            Save {plural(drafts.length, "panel")}
          </Button>
        }
      >
        <ul className="grid gap-1 text-sm">
          {live.map((r) => (
            <li key={r.id} className="flex min-h-6 flex-wrap items-center gap-x-3">
              <Link className="inline-flex min-h-6 w-56 items-center text-link underline-offset-4 hover:underline" to="/projects/$projectId/runs/$runId/$step" params={{ projectId: r.projectId, runId: r.id, step: "select" }}>
                {r.name}
              </Link>
              <span className="text-[0.75rem] text-muted-foreground">
                {plural(workingContent(r)?.sessions.length ?? 0, "session")} · {plural((byPanel[r.panelId ?? ""] ?? []).length, "candidate")} by pointing · {r.draft ? "unsaved changes" : `revision ${r.revisions.at(-1)?.revision ?? 0} saved`}
              </span>
            </li>
          ))}
        </ul>
      </Section>
    </>
  )
}

function GroupCalibrate({ group, panels, onOutcome }: { group: RunGroup; panels: GroupPanelState[]; onOutcome: Act }) {
  const state = useStore((s) => s)
  const id = useId()
  return (
    <>
      <Section title="Calibration policy" id="group-policy" description="Shared by every panel run. Calibration is matched per panel run.">
        <div className="flex items-start gap-2.5">
          <Switch id={id} className="mt-0.5" checked={group.setup.calibrationPolicy === "automatic"} onCheckedChange={(checked) => onOutcome(changeGroupSetup(group.id, { calibrationPolicy: checked ? "automatic" : "off" }))} />
          <Label htmlFor={id}>Assign compatible calibration automatically</Label>
        </div>
      </Section>
      <Section title="Readiness per panel" id="group-readiness">
        <ul className="divide-y divide-separator rounded-md border">
          {panels.map((p) => {
            const plan = calibrationPlan(state.catalog, state.disk, p.run, group.setup.calibrationPolicy, workingContent(p.run))
            return (
              <li key={p.run.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 text-sm">
                <span className="w-24 font-medium">{panelLabel(p.panel)}</span>
                {p.trashed ? (
                  <span className="flex-1 text-[0.75rem] text-muted-foreground">Trashed: skipped</span>
                ) : (
                  <>
                    <span className="flex-1 font-mono text-[0.8125rem] tabular-nums">{readinessText(plan)}</span>
                    <span className="text-[0.75rem] text-muted-foreground">{readinessLine(plan)}</span>
                    <Button size="xs" variant="outline" render={<Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: p.run.projectId, runId: p.run.id, step: "calibrate" }} />}>
                      Review matches
                    </Button>
                  </>
                )}
              </li>
            )
          })}
        </ul>
      </Section>
    </>
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

function GroupPrepare({ group, onOutcome, allVerified }: { group: RunGroup; onOutcome: Act; allVerified: boolean }) {
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
      <Section
        title="Group outcome"
        id="group-outcome"
        description={status.detail}
        actions={
          <Button size="sm" variant={allVerified ? "default" : "outline"} onClick={() => onOutcome(openGroupFolder(group.id), { title: `Opened ${group.name}`, reasons: ["Every panel's entries were re-verified first."], tone: "info" })}>
            <FolderOpen aria-hidden="true" data-icon="inline-start" />
            Open group folder
          </Button>
        }
      >
        {!allVerified ? <p className="text-[0.75rem] text-muted-foreground">Open on the group folder waits until every panel outside the Trash is prepared and verified. A verified panel opens on its own from its run.</p> : null}
        <div className="space-y-4">
          {allLive.map((run) => (
            <PreparationOutcome key={run.id} run={run} onOutcome={onOutcome} compact />
          ))}
        </div>
      </Section>
      {setupRefusals.length > 0 ? (
        <Notice tone="refusal" title="Shared setup is locked">
          <ul className="list-disc pl-4">
            {setupRefusals.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
        </Notice>
      ) : null}
      <ProfileSection profileId={group.setup.profileId} locked={false} onPick={(id) => onOutcome(chooseProfile(target, id))} />
      <ModeSection modes={aggregateModes(plans.map((p) => p.plan.modes))} mode={group.setup.inputMode} linkType={choices.linkType} locked={false} profileName={first?.profile?.name ?? null} onMode={(m: InputMode) => onOutcome(chooseMode(target, m))} onLinkType={(t) => updatePrepareChoices(group.id, { linkType: t })} />
      {first ? (
        <LayoutSection
          layout={first.layout}
          locked={false}
          onParent={(path) => onOutcome(setOutputParent(target, path))}
          lines={(l) => (
            <>
              <LayoutLine path={`${l.parent.path ?? "<output>"}/`} note={l.parent.origin === "none" ? "Not chosen yet" : "Output folder"} />
              <LayoutLine path={`${project.name}/`} note="Project" depth={1} />
              <LayoutLine path={`${mosaic}${revision > 1 ? ` (rev ${revision})` : ""}/`} note={`Group folder${revision > 1 ? `, revision ${revision}` : ""}: load this folder in the application`} depth={2} emphasis />
              {plans.map(({ run, plan }) => (
                <LayoutLine key={run.id} path={`${fileName(plan.layout.folderPath ?? "Panel")}/`} note={`${run.name} · ${plural(plan.entries.length, "input")}`} depth={3} />
              ))}
              <LayoutLine path={`${mosaic} Results/`} note="Outside the group folder" depth={2} />
              {plans.map(({ run, plan }) => (
                <LayoutLine key={run.id} path={`${fileName(plan.layout.resultsPath ?? "Panel")}/`} note={`${run.name} Results, shared by every revision`} depth={3} />
              ))}
              <LayoutLine path="Assembled/" note="The group Result: the assembled mosaic" depth={3} />
            </>
          )}
        />
      ) : null}
      {plans.map(({ run, plan }) => (plan.diffs.length > 0 ? <MetadataSection key={run.id} plan={plan} locked={false} onChoice={(key, choice) => updatePrepareChoices(group.id, { metadata: { ...choices.metadata, [key]: choice } })} /> : null))}
      <Section
        title="Review all panels"
        id="group-review-prep"
        description={live.length === 0 ? "Every panel outside the Trash is Complete." : `${plural(live.length, "panel run")} into group revision ${revision}; Complete and trashed panels are skipped.`}
        actions={
          <Button size="sm" onClick={() => (plans.length > 0 && plans.every((p) => p.plan.ready) ? setConfirm(true) : onOutcome(prepareAll(group.id)))}>
            <Play aria-hidden="true" data-icon="inline-start" />
            Prepare all…
          </Button>
        }
      >
        <div className="grid gap-3 xl:grid-cols-2">
          {plans.map(({ run, plan }) => (
            <div key={run.id} className="space-y-1">
              <h3 className="text-[0.75rem] font-medium">{run.name}</h3>
              <ChecksList checks={plan.checks} />
            </div>
          ))}
        </div>
      </Section>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Prepare all ${plural(live.length, "panel")} of ${group.name}?`}
        description={`${first?.profile?.name ?? ""} · ${group.setup.inputMode ? MODE_LABEL[group.setup.inputMode] : ""}. Each panel prepares as its own operation; the group outcome is Partial when one panel is Partial.`}
        changes={[
          `Creates ${first?.layout.groupFolder ?? mosaic}/ with ${plans.map((p) => fileName(p.plan.layout.folderPath ?? "")).join(", ")}`,
          ...plans.map((p) => `${p.run.name}: ${plural(p.plan.entries.length, "input")}${p.plan.entries.some((e) => e.unavailable) ? `, ${plural(p.plan.entries.filter((e) => e.unavailable).length, "blocked")}` : ""}`),
          `Creates the ${mosaic} Results/ panel folders if they do not exist`,
        ]}
        unchanged={["Original frames are never written, moved or patched", "Earlier group folders stay as they are", "Trashed and Complete panels are skipped"]}
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
      <Section
        title="Group Result"
        id="group-result"
        description={`The assembled mosaic, found only in ${assembled ?? "<Mosaic> Results/Assembled"}/. PlateVault does not assemble panels; the application does.`}
        actions={
          <div className="flex flex-wrap gap-1.5">
            <PrototypeMenu actions={[{ label: "The application writes the assembled mosaic", detail: "One file in Assembled/.", run: () => onOutcome(simulateApplicationOutput({ groupId: group.id })) }]} />
            <Button size="sm" variant="outline" onClick={() => onOutcome(discoverResults({ groupId: group.id }))}>
              Look again
            </Button>
            <Button size="sm" variant="outline" onClick={() => setAttaching(true)}>
              Attach Result…
            </Button>
          </div>
        }
      >
        <ResultsTable rows={rows} rigId={group.rigId} onOutcome={onOutcome} kindOptions={GROUP_KINDS} />
      </Section>
      <Section title="Panel Results" id="group-panel-results" description="Each panel run discovers and accepts its own Results in <Mosaic> Results/Panel N/.">
        <ul className="divide-y divide-separator rounded-md border text-sm">
          {panels.map((p) => {
            const { products, intermediates } = runResults(state.catalog, p.run.id)
            const accepted = products.filter((r) => r.acceptance === "accepted").length
            return (
              <li key={p.run.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
                <span className="w-24 font-medium">{panelLabel(p.panel)}</span>
                <span className="flex-1 text-[0.75rem] text-muted-foreground">{p.trashed ? "Trashed: skipped" : `${accepted} accepted · ${products.length - accepted} candidates · ${plural(intermediates.length, "intermediate")}`}</span>
                {!p.trashed ? (
                  <Button size="xs" variant="outline" render={<Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: p.run.projectId, runId: p.run.id, step: "results" }} />}>
                    Open {panelLabel(p.panel)} Results
                  </Button>
                ) : null}
              </li>
            )
          })}
        </ul>
      </Section>
      <AttachDialog open={attaching} onOpenChange={setAttaching} defaultFolder={assembled} kindOptions={GROUP_KINDS} onAttach={(path, kind, channel) => onOutcome(attachResult({ groupId: group.id }, path, kind as ResultKind, channel))} />
    </>
  )
}

function GroupDone({ group, panels, onOutcome }: { group: RunGroup; panels: GroupPanelState[]; onOutcome: Act }) {
  return (
    <Section
      title="Completion"
      id="group-done"
      description="Complete all marks every panel outside the Trash Complete; each panel then offers its own Clean up."
      actions={
        <Button size="sm" onClick={() => onOutcome(completeAllPanels(group.id), { title: "Every panel is Complete", reasons: ["Nothing was removed. Clean up each panel from its Done step."], tone: "info" })}>
          <ShieldCheck aria-hidden="true" data-icon="inline-start" />
          Complete all panels
        </Button>
      }
    >
      <ul className="divide-y divide-separator rounded-md border text-sm">
        {panels.map((p) => (
          <li key={p.run.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5">
            <span className="w-24 font-medium">{panelLabel(p.panel)}</span>
            <span className="flex-1 text-[0.75rem]">{p.trashed ? <span className="text-muted-foreground">Trashed: skipped</span> : <GateLabel state={p.pipeline.steps[5]!.state} label={p.pipeline.steps[5]!.status} />}</span>
            {!p.trashed ? (
              <Button size="xs" variant="outline" render={<Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: p.run.projectId, runId: p.run.id, step: "done" }} hash="cleanup" />}>
                {p.run.completion === "complete" ? "Clean up" : "Open Done"}
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  )
}
