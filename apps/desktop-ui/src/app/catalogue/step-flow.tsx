/**
 * Catalogue entry (R9-COMPOSITION-PLAN §8.3, P11, §5): StepStrip and
 * StepFooter.
 *
 * - "Step states" renders fixed flows on a session's intake steps: every
 *   step state, a later step (read-only), an earlier step (reopen), a
 *   reopened flow (redo), an optional step (Skip) and a finished flow. Their
 *   steps are plain text.
 * - Two working flows then run on local state. Each step pane keeps one
 *   height, so a step change moves nothing.
 *   - Wrap up: strict order, local step buttons.
 *   - Session review: router links. Finish review opens the next session
 *     that needs review (C14).
 * - FormDialog `steps`: a three-step import on local state. Proceed opens
 *   the next step in the dialog; only the last step's Import closes it.
 *
 * Captions are reviewer labels. Targets, filters, nights and folders are sample data.
 */
import { useNavigate, useSearch } from "@tanstack/react-router"
import { Lock } from "lucide-react"
import { type ReactNode, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton, actionLabel } from "@/components/app/actions"
import type { Action, FlowStep, StepFlow } from "@/components/app/contracts"
import { DataTable } from "@/components/app/data-table"
import { KeyValueList } from "@/components/app/data"
import { PathField, SegmentedField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import { Section } from "@/components/app/page"
import { StepFooter, StepStrip, stepEditable } from "@/components/app/step-flow"
import { Button } from "@/components/ui/button"
import type { StepLink } from "@/components/app/contracts"
import { formatBytes, formatNight } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { nowIso } from "@/store/core"
import { ComponentSection, Specimen } from "./specimen"

type StepState = FlowStep["state"]

// ---------------------------------------------------------------------------
// A local flow: the order rule as a builder applies it (finish, skip, reopen → redo)
// ---------------------------------------------------------------------------

interface Progress {
  states: Record<string, StepState>
  current: string
  /** The night the terminal action ran, once the flow is finished. */
  finishedOn: string | null
}

function start(ids: readonly string[]): Progress {
  return { states: Object.fromEntries(ids.map((id, index) => [id, index === 0 ? "current" : "todo"])), current: ids[0] ?? "", finishedOn: null }
}

/** Records the current step and opens the next one; the last step finishes the flow. */
function advance(progress: Progress, ids: readonly string[], outcome: "finished" | "skipped"): Progress {
  const at = ids.indexOf(progress.current)
  const next = ids[at + 1]
  const states = { ...progress.states, [progress.current]: outcome }
  if (!next) return { ...progress, states, finishedOn: nowIso().slice(0, 10) }
  return { states: { ...states, [next]: "current" }, current: next, finishedOn: null }
}

/** Reopens an earlier step: the finished or skipped steps after it turn Redo (F5). */
function reopen(progress: Progress, ids: readonly string[], id: string): Progress {
  const at = ids.indexOf(id)
  const states = Object.fromEntries(
    ids.map((step, index): [string, StepState] => {
      if (index < at) return [step, progress.states[step] ?? "todo"]
      if (index === at) return [step, "current"]
      const state = progress.states[step]
      return [step, state === "finished" || state === "skipped" || state === "redo" ? "redo" : "todo"]
    }),
  )
  return { states, current: id, finishedOn: null }
}

/** The steps of a local flow; the current step with an unmet gate reads Blocked. */
function flowSteps(progress: Progress, steps: { id: string; label: string; summary?: string; optional?: boolean }[], gate: FlowStep["gate"]): FlowStep[] {
  return steps.map((step) => {
    const isCurrent = step.id === progress.current && progress.finishedOn === null
    const state = progress.states[step.id] ?? "todo"
    return { ...step, state: isCurrent && gate ? "blocked" : state, gate: isCurrent ? gate : null }
  })
}

/** The router search of the catalogue page, as strings: it holds the step on screen in the linked demos. */
function useCatalogueSearch(): Record<string, string> {
  const search = useSearch({ strict: false }) as Record<string, unknown>
  return Object.fromEntries(Object.entries(search).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
}

function catalogueLink(search: Record<string, string>, changes: Record<string, string | null>): StepLink {
  const next = { ...search }
  for (const [key, value] of Object.entries(changes)) {
    if (value === null) delete next[key]
    else next[key] = value
  }
  return { to: "/design-system", search: next }
}

// ---------------------------------------------------------------------------
// The step pane: strip, one body region and footer, at a fixed height
// ---------------------------------------------------------------------------

function StepPane({ strip, footer, children }: { strip: ReactNode; footer: ReactNode; children: ReactNode }) {
  return (
    <div className="flex w-full flex-col overflow-hidden rounded-lg border" data-step-pane="">
      {strip}
      <div className="h-44 space-y-3 overflow-y-auto p-3">{children}</div>
      {footer}
    </div>
  )
}

/** The body's own read-only marker, so a reviewer sees which steps take input. */
function BodyState({ editable }: { editable: boolean }) {
  const m = useMessages()
  if (editable) return null
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Lock aria-hidden="true" className="size-3.5" />
      {m.stepflow_read_only()}
    </p>
  )
}

// ---------------------------------------------------------------------------
// Sample data
// ---------------------------------------------------------------------------

interface Row {
  id: string
  name: string
  size: number
}

/** A Project's View folders, which Clean up offers (F1). */
const SAMPLE_VIEWS = [
  { id: "v1", name: "M 42 · View", size: 1_040_000_000 },
  { id: "v2", name: "M 42 · View (previous)", size: 412_000_000 },
] as const

const SAMPLE_SESSIONS = [
  { id: "s1", target: "M 42", rig: "RedCat 51 · ASI2600MM", night: "2026-09-14", size: 18_400_000_000, frames: 48, unreviewed: 12, targetOk: true, rigOk: true },
  { id: "s2", target: "NGC 7000", rig: "Esprit 100 · ASI6200MM", night: "2026-09-02", size: 9_100_000_000, frames: 30, unreviewed: 30, targetOk: false, rigOk: false },
  { id: "s3", target: "IC 1396", rig: "RedCat 51 · ASI2600MM", night: "2026-08-28", size: 6_300_000_000, frames: 22, unreviewed: 0, targetOk: true, rigOk: false },
] as const

const PROJECT = "M 42"

function sessionName(session: (typeof SAMPLE_SESSIONS)[number]): string {
  return `${session.target} · ${formatNight(session.night, true)}`
}

function rowsColumns(m: Messages, header: string) {
  return [
    { id: "name", header, cell: (row: Row) => row.name, sortValue: (row: Row) => row.name, rowHeader: true },
    { id: "size", header: m.run_col_size(), cell: (row: Row) => formatBytes(row.size), sortValue: (row: Row) => row.size, align: "right" as const },
  ]
}

// ---------------------------------------------------------------------------
// Step states: fixed flows
// ---------------------------------------------------------------------------

function intakeSteps(m: Messages) {
  return [
    { id: "target", label: m.sessions_column_target(), summary: SAMPLE_SESSIONS[0].target },
    { id: "rig", label: m.sessions_column_rig(), summary: SAMPLE_SESSIONS[0].rig },
    { id: "review", label: m.step_review(), summary: m.review_frames_count({ count: SAMPLE_SESSIONS[0].frames }) },
  ]
}

const noop = () => undefined

function fixedFlow(m: Messages, states: StepState[], current: string, options: { finished?: boolean; gate?: FlowStep["gate"]; optional?: string } = {}): StepFlow {
  const steps = intakeSteps(m).map((step, index): FlowStep => {
    const state = states[index] ?? "todo"
    return { ...step, state, optional: step.id === options.optional, gate: state === "blocked" ? options.gate : null }
  })
  const last = current === "review"
  return {
    steps: options.finished ? steps.map((step) => (step.id === "review" ? { ...step, summary: m.stepflow_finished_on({ date: formatNight(nowIso().slice(0, 10), true) }) } : step)) : steps,
    current,
    ordered: true,
    proceed: options.finished ? null : { id: "proceed", label: last ? m.stepflow_finish_review() : m.stepflow_proceed(), run: noop },
    next: null,
    skip: { id: "skip", label: m.stepflow_skip(), run: noop },
    reopen: (stepId) => ({ id: `reopen-${stepId}`, label: m.stepflow_reopen_step(), run: noop }),
  }
}

function StateSpecimen({ caption, flow, viewing }: { caption: string; flow: StepFlow; viewing?: string }) {
  const m = useMessages()
  return (
    <Specimen caption={caption}>
      <div className="flex w-full flex-col overflow-hidden rounded-lg border">
        <StepStrip flow={flow} viewing={viewing} label={m.catalogue_stepflow_strip_label({ caption })} />
        <StepFooter flow={flow} viewing={viewing} />
      </div>
    </Specimen>
  )
}

function StepStates() {
  const m = useMessages()
  const gate = { reason: m.catalogue_stepflow_unresolved({ count: 2 }), blockers: SAMPLE_SESSIONS.slice(0, 2).map((session) => ({ label: sessionName(session) })) }
  const progress = fixedFlow(m, ["finished", "current", "todo"], "rig")
  return (
    <Section level={3} title={m.catalogue_stepflow_states_heading()} description={m.catalogue_stepflow_states_caption()}>
      <div className="space-y-3">
        <StateSpecimen caption={m.catalogue_stepflow_case_progress()} flow={progress} />
        <StateSpecimen caption={m.catalogue_stepflow_case_blocked()} flow={fixedFlow(m, ["finished", "blocked", "todo"], "rig", { gate })} />
        <StateSpecimen caption={m.catalogue_stepflow_case_locked()} flow={progress} viewing="review" />
        <StateSpecimen caption={m.catalogue_stepflow_case_earlier()} flow={progress} viewing="target" />
        <StateSpecimen caption={m.catalogue_stepflow_case_reopened()} flow={fixedFlow(m, ["current", "redo", "todo"], "target")} />
        <StateSpecimen caption={m.catalogue_stepflow_case_optional()} flow={fixedFlow(m, ["finished", "skipped", "current"], "review", { optional: "rig" })} />
        <StateSpecimen caption={m.catalogue_stepflow_case_last()} flow={fixedFlow(m, ["finished", "finished", "current"], "review")} />
        <StateSpecimen caption={m.catalogue_stepflow_case_finished()} flow={fixedFlow(m, ["finished", "finished", "finished"], "review", { finished: true })} />
      </div>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Wrap up: strict order, select then Proceed, local step buttons
// ---------------------------------------------------------------------------

const WRAP_UP_STEPS = ["cleanup", "trash", "archive"] as const
type WrapUpStep = (typeof WRAP_UP_STEPS)[number]

function wrapUpRows(m: Messages): Record<WrapUpStep, Row[]> {
  return {
    cleanup: SAMPLE_VIEWS.map((view) => ({ id: view.id, name: view.name, size: view.size })),
    trash: [
      { id: "unusable", name: m.wrapup_offer_rejects(), size: 2_300_000_000 },
      { id: "processing", name: m.wrapup_offer_processing_label(), size: 5_800_000_000 },
    ],
    archive: SAMPLE_SESSIONS.map((session) => ({ id: session.id, name: sessionName(session), size: session.size })),
  }
}

function WrapUpDemo() {
  const m = useMessages()
  const rows = wrapUpRows(m)
  const allSelected = () => Object.fromEntries(WRAP_UP_STEPS.map((step) => [step, rows[step].map((row) => row.id)])) as Record<WrapUpStep, string[]>
  const [progress, setProgress] = useState(() => start(WRAP_UP_STEPS))
  const [viewing, setViewing] = useState<string>(WRAP_UP_STEPS[0])
  // Recommended rows start selected (§5.5).
  const [selected, setSelected] = useState(allSelected)
  const current = progress.current as WrapUpStep
  const chosen = rows[current].filter((row) => selected[current].includes(row.id))
  const bytes = chosen.reduce((sum, row) => sum + row.size, 0)
  const labels: Record<WrapUpStep, string> = { cleanup: m.wrapup_cleanup_title(), trash: m.trash_title(), archive: m.wrapup_archive_title() }
  const headers: Record<WrapUpStep, string> = { cleanup: m.project_col_folder(), trash: m.dialog_col_file(), archive: m.review_col_session() }

  // Proceed with nothing selected records the step as Skipped (F4); otherwise it confirms the operation first.
  const record = () => {
    const outcome = chosen.length === 0 ? "skipped" : "finished"
    setProgress((p) => advance(p, WRAP_UP_STEPS, outcome))
    const next = WRAP_UP_STEPS[WRAP_UP_STEPS.indexOf(current) + 1]
    if (next) setViewing(next)
  }
  const confirms: Record<WrapUpStep, Action["confirm"]> = {
    cleanup: { title: m.wrapup_cleanup_confirm_items({ count: chosen.length }), summary: formatBytes(bytes), confirm: { label: m.wrapup_cleanup_title() } },
    trash: { title: m.catalogue_stepflow_trash_title({ count: chosen.length }), summary: m.wrapup_items_to_trash({ count: chosen.length, size: formatBytes(bytes) }), confirm: { label: m.common_move_to_trash(), kind: "destructive" } },
    archive: { title: m.stepflow_close_project_title({ name: PROJECT }), summary: m.wrapup_sessions_to_move({ count: chosen.length }), confirm: { label: m.stepflow_close_project() } },
  }
  const terminal = current === "archive"
  const proceed: Action | null =
    progress.finishedOn !== null
      ? null
      : {
          id: terminal ? "close-project" : "proceed",
          label: terminal ? m.stepflow_close_project() : m.stepflow_proceed(),
          run: record,
          // Close project always asks; an empty selection elsewhere skips without asking.
          confirm: terminal || chosen.length > 0 ? confirms[current] : undefined,
        }
  const summaryOf = (step: WrapUpStep): string => {
    if (step === "archive" && progress.finishedOn) return m.stepflow_closed_on({ date: formatNight(progress.finishedOn, true) })
    return m.status_bar_selected({ count: selected[step].length })
  }
  const flow: StepFlow = {
    steps: flowSteps(
      progress,
      WRAP_UP_STEPS.map((step) => ({ id: step, label: labels[step], summary: summaryOf(step) })),
      null,
    ),
    current: progress.current,
    ordered: true,
    proceed,
    next: null,
    reopen: (stepId) => ({ id: `reopen-${stepId}`, label: m.stepflow_reopen_step(), run: () => setProgress((p) => reopen(p, WRAP_UP_STEPS, stepId)) }),
  }
  const shown = (WRAP_UP_STEPS.find((step) => step === viewing) ?? current) as WrapUpStep
  const editable = stepEditable(flow, shown)
  const restart: Action = {
    id: "restart-wrap-up",
    label: m.catalogue_stepflow_restart(),
    run: () => {
      setProgress(start(WRAP_UP_STEPS))
      setViewing(WRAP_UP_STEPS[0])
      setSelected(allSelected())
    },
  }
  return (
    <Section level={3} title={m.catalogue_stepflow_wrapup_heading()} description={m.catalogue_stepflow_wrapup_caption()} actions={<ActionButton action={restart} />}>
      <StepPane strip={<StepStrip flow={flow} viewing={shown} onSelect={setViewing} label={m.catalogue_stepflow_wrapup_heading()} />} footer={<StepFooter flow={flow} viewing={shown} />}>
        <BodyState editable={editable} />
        <DataTable
          label={labels[shown]}
          rows={rows[shown]}
          columns={rowsColumns(m, headers[shown])}
          getRowId={(row) => row.id}
          scroll="none"
          selection={editable ? { selected: selected[shown], onChange: (ids) => setSelected((s) => ({ ...s, [shown]: ids })), rowLabel: (row) => row.name } : undefined}
        />
      </StepPane>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Session review: links; Finish review opens the next session that needs review (C14)
// ---------------------------------------------------------------------------

const INTAKE_STEPS = ["target", "rig", "review"] as const

interface Intake {
  progress: Progress
  target: boolean
  rig: boolean
  unreviewed: number
}

function startIntake(session: (typeof SAMPLE_SESSIONS)[number]): Intake {
  // A session starts at its first unconfirmed step.
  let progress = start(INTAKE_STEPS)
  if (session.targetOk) progress = advance(progress, INTAKE_STEPS, "finished")
  if (session.targetOk && session.rigOk) progress = advance(progress, INTAKE_STEPS, "finished")
  return { progress, target: session.targetOk, rig: session.rigOk, unreviewed: session.unreviewed }
}

function startQueue(): Record<string, Intake> {
  return Object.fromEntries(SAMPLE_SESSIONS.map((session) => [session.id, startIntake(session)]))
}

function ReviewDemo() {
  const m = useMessages()
  const navigate = useNavigate()
  const search = useCatalogueSearch()
  const [queue, setQueue] = useState(startQueue)
  const waiting = SAMPLE_SESSIONS.filter((session) => queue[session.id]?.progress.finishedOn === null)
  const session = SAMPLE_SESSIONS.find((s) => s.id === search.review) ?? waiting[0] ?? SAMPLE_SESSIONS[0]
  const intake = queue[session.id] ?? startIntake(session)
  const { progress } = intake
  const update = (change: (intake: Intake) => Intake) => setQueue((q) => ({ ...q, [session.id]: change(q[session.id] ?? intake) }))
  const linkFor = (stepId: string) => catalogueLink(search, { review: session.id, reviewStep: stepId })
  // The queue is the Sessions list's "Needs review" filter: the next unfinished session after this one.
  const after = [...SAMPLE_SESSIONS.slice(SAMPLE_SESSIONS.indexOf(session) + 1), ...SAMPLE_SESSIONS.slice(0, SAMPLE_SESSIONS.indexOf(session))]
  const nextSession = after.find((s) => queue[s.id]?.progress.finishedOn === null)
  const at = INTAKE_STEPS.indexOf(progress.current as (typeof INTAKE_STEPS)[number])
  const terminal = at === INTAKE_STEPS.length - 1
  const notConfirmed = { reason: m.catalogue_stepflow_not_confirmed(), blockers: [] }
  const gate =
    progress.current === "target" && !intake.target
      ? notConfirmed
      : progress.current === "rig" && !intake.rig
        ? notConfirmed
        : progress.current === "review" && intake.unreviewed > 0
          ? { reason: m.catalogue_stepflow_unreviewed({ count: intake.unreviewed }), blockers: [] }
          : null
  const labels = { target: m.sessions_column_target(), rig: m.sessions_column_rig(), review: m.step_review() }
  // The summary is what the step settled on; the gate's reason shows beside Proceed only.
  const summaries = {
    target: session.target,
    rig: session.rig,
    review: progress.finishedOn ? m.status_ready() : m.review_frames_count({ count: session.frames }),
  }
  const record = () => update((i) => ({ ...i, progress: advance(i.progress, INTAKE_STEPS, "finished") }))
  const flow: StepFlow = {
    steps: flowSteps(
      progress,
      INTAKE_STEPS.map((step) => ({ id: step, label: labels[step], summary: summaries[step] })),
      gate,
    ),
    current: progress.current,
    ordered: true,
    proceed: progress.finishedOn !== null ? null : { id: terminal ? "finish-review" : "proceed", label: terminal ? m.stepflow_finish_review() : m.stepflow_proceed(), run: record },
    // Finish review opens the next session that needs review; with none left the page turns read-only.
    next: terminal ? (nextSession ? catalogueLink(search, { review: nextSession.id, reviewStep: null }) : null) : linkFor(INTAKE_STEPS[at + 1] ?? progress.current),
    reopen: (stepId) => ({ id: `reopen-${stepId}`, label: m.stepflow_reopen_step(), run: () => update((i) => ({ ...i, progress: reopen(i.progress, INTAKE_STEPS, stepId) })) }),
    linkFor,
  }
  const viewing = flow.steps.some((step) => step.id === search.reviewStep && search.review === session.id) ? (search.reviewStep ?? progress.current) : progress.current
  const editable = stepEditable(flow, viewing)
  const others = waiting.filter((s) => s.id !== session.id).length
  const restart: Action = {
    id: "restart-review",
    label: m.catalogue_stepflow_restart(),
    run: () => {
      setQueue(startQueue())
      void navigate({ to: "/design-system", search: catalogueLink(search, { review: null, reviewStep: null }).search as never })
    },
  }
  // Each body keeps its action while the step takes input, so focus stays on it after use.
  const body: Record<(typeof INTAKE_STEPS)[number], Action> = {
    target: { id: "confirm-target", label: m.session_confirm_target(), run: () => update((i) => ({ ...i, target: true })) },
    rig: { id: "confirm-rig", label: m.session_confirm_rig(), run: () => update((i) => ({ ...i, rig: true })) },
    review: { id: "mark-usable", label: m.status_usable(), run: () => update((i) => ({ ...i, unreviewed: 0 })) },
  }
  const action = body[viewing as (typeof INTAKE_STEPS)[number]]
  return (
    <Section level={3} title={m.catalogue_stepflow_review_heading()} description={m.catalogue_stepflow_review_caption()} actions={<ActionButton action={restart} />}>
      <StepPane strip={<StepStrip flow={flow} viewing={viewing} label={m.catalogue_stepflow_review_strip({ session: sessionName(session) })} />} footer={<StepFooter flow={flow} viewing={viewing} />}>
        <p className="text-sm font-medium" data-review-session="">
          {sessionName(session)}
        </p>
        <p className="text-xs text-muted-foreground">{others > 0 ? m.catalogue_stepflow_queue({ count: others }) : m.catalogue_stepflow_queue_empty()}</p>
        <BodyState editable={editable} />
        {editable && action ? <ActionButton action={action} /> : null}
      </StepPane>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// FormDialog steps: a short flow on local state; only the last step's Proceed closes it
// ---------------------------------------------------------------------------

const IMPORT_STEPS = ["folder", "mode", "preview"] as const
type ImportMode = "copy" | "move"

function DialogDemo() {
  const m = useMessages()
  const [progress, setProgress] = useState(() => start(IMPORT_STEPS))
  const [folder, setFolder] = useState<string | null>(null)
  const [mode, setMode] = useState<ImportMode>("copy")
  const [imported, setImported] = useState<string | null>(null)
  const modes = [
    { value: "copy", label: m.import_copy() },
    { value: "move", label: m.import_move() },
  ] as const
  const modeLabel = modes.find((option) => option.value === mode)?.label
  const terminal = progress.current === IMPORT_STEPS.at(-1)
  const record = (outcome: "finished" | "skipped") => () => setProgress((p) => advance(p, IMPORT_STEPS, outcome))
  const gate = progress.current === "folder" && folder === null ? { reason: m.fields_path_none_folder(), blockers: [] } : null
  const restart = () => {
    setProgress(start(IMPORT_STEPS))
    setFolder(null)
    setMode("copy")
  }
  const flow: StepFlow = {
    steps: flowSteps(
      progress,
      [
        { id: "folder", label: m.import_column_folder(), summary: folder ?? undefined },
        { id: "mode", label: m.import_copy_or_move(), summary: modeLabel, optional: true },
        { id: "preview", label: m.import_preview() },
      ],
      gate,
    ),
    current: progress.current,
    ordered: true,
    proceed:
      progress.finishedOn !== null
        ? null
        : terminal
          ? {
              id: "import",
              label: m.stepflow_import(),
              run: () => {
                record("finished")()
                setImported(folder)
              },
            }
          : { id: "proceed", label: m.stepflow_proceed(), run: record("finished") },
    next: null,
    skip: { id: "skip", label: m.stepflow_skip(), run: record("skipped") },
    reopen: (stepId) => ({ id: `reopen-${stepId}`, label: m.stepflow_reopen_step(), run: () => setProgress((p) => reopen(p, IMPORT_STEPS, stepId)) }),
  }
  const title = m.calibration_import_masters()
  return (
    <ComponentSection components={["FormDialog"]} description={m.catalogue_stepflow_dialog_caption()} level={3}>
      <Specimen caption={m.catalogue_stepflow_dialog_case()}>
        <FormDialog
          title={title}
          steps={flow}
          onOpenChange={(open) => {
            if (open) restart()
          }}
          trigger={
            <Button variant="outline" size="sm">
              {actionLabel({ id: "import-masters", label: title, opensDialog: true, run: () => undefined })}
            </Button>
          }
        >
          {({ step, editable }) => (
            // One body height on every step, as StepPane gives a page: the centred dialog then never moves.
            <div className="h-28 space-y-3" data-dialog-step-body="">
              <BodyState editable={editable} />
              {step === "folder" ? <PathField label={m.import_column_folder()} mode="folder" value={folder} onChange={setFolder} disabled={!editable} /> : null}
              {step === "mode" ? <SegmentedField label={m.import_copy_or_move()} value={mode} options={modes} onChange={setMode} disabled={!editable} /> : null}
              {step === "preview" ? (
                <KeyValueList
                  items={[
                    { label: m.import_column_folder(), value: folder ?? m.fields_path_none_folder(), mono: true },
                    { label: m.import_copy_or_move(), value: modeLabel },
                  ]}
                />
              ) : null}
            </div>
          )}
        </FormDialog>
        {imported ? (
          <span className="flex items-center gap-1.5 text-xs" data-dialog-outcome="">
            <span className="text-muted-foreground">{m.import_imported()}</span>
            <span className="font-mono">{imported}</span>
          </span>
        ) : null}
      </Specimen>
    </ComponentSection>
  )
}

export function StepFlowCatalogue() {
  const m = useMessages()
  return (
    <ComponentSection components={["StepStrip", "StepFooter"]} description={m.catalogue_stepflow_desc()}>
      <div className="space-y-6">
        <StepStates />
        <WrapUpDemo />
        <ReviewDemo />
        <DialogDemo />
      </div>
    </ComponentSection>
  )
}
