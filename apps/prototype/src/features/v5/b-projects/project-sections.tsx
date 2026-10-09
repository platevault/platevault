/**
 * S3 Project sections (slice B): subjects, rigs, goals, candidates, runs and
 * run groups, planning, archived sessions and Trash. Each edit goes through
 * a foundation store action and keeps its refusal beside the control; no
 * section edits a run's membership (PRJ-FR-05, PRJ-FR-08).
 */
import { Link } from "@tanstack/react-router"
import { ChevronDown, ChevronRight, CircleCheck, FolderKanban, MapPinOff, Play, Trash2, TriangleAlert } from "lucide-react"
import { useId, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { PathText } from "@/components/app/data"
import { EmptyState, Notice } from "@/components/app/feedback"
import { OperationPanel } from "@/components/app/operation-panel"
import { Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { GateLabel, StepRail, useFollowLink } from "@/app/run-ui"
import { openSheet } from "@/app/ui-state"
import {
  formatHours,
  GATE_LABEL,
  findPanel,
  goalProgress,
  groupPipeline,
  latestRevision,
  liveAssetIds,
  panelForSession,
  panelLabel,
  planningSite,
  projectCandidates,
  projectGroups,
  projectRuns,
  projectTrash,
  projectWarnings,
  rigCameraKind,
  rigFieldOfView,
  rigName,
  runPipeline,
  runRefresh,
  subjectCentre,
  subjectName,
  subjectTarget,
} from "@/domain/derive"
import { qualityApplicability } from "@/domain/library"
import { bestWindowTonight, defaultCriteria, tonightAt } from "@/domain/planning"
import { BUILT_IN_GOAL_TEMPLATES } from "@/domain/templates"
import { formatDec, formatDegrees, formatNight, formatRa, formatTime, plural } from "@/lib/format"
import type { Catalog, Goal, MosaicPanel, Project, QualityBar, Session, Subject } from "@/domain/types"
import { addRig, addSubject, applyGoalTemplate, removeRig, removeSubject, setGoals } from "@/store/actions/projects"
import { freshId } from "@/store/actions/shared"
import { nowIso, type PrototypeState, useStore } from "@/store/core"
import { SelectField } from "@/features/t3/fields"
import { startArchiveTransfer } from "./actions"
import { restorePlan, sessionLabel, subjectGaps } from "./model"
import { draftFromPick, draftProblem, resolveDraft, type SubjectDraft, SubjectDraftRow } from "./new-project"
import { InlineError, SubjectSearch, useCommitError } from "./parts"
import { rememberApproval } from "./trash"

const TH = "py-1 pr-3 text-left text-[0.6875rem] font-medium text-muted-foreground"
const TD = "py-1.5 pr-3 align-top"

function SimpleTable({ caption, headers, children }: { caption: string; headers: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-[0.3125rem] border border-separator">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-chrome" data-chrome>
          <tr className="border-b border-separator">
            {headers.map((h, i) => (
              <th key={h || i} scope="col" className={`${TH} ${i === 0 ? "pl-3" : ""}`}>
                {h || <span className="sr-only">Actions</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-separator [&>tr:last-child]:border-0 [&>tr:nth-child(even)]:bg-foreground/[0.02] [&>tr>*:first-child]:pl-3">{children}</tbody>
      </table>
    </div>
  )
}

function runsUsing(catalog: Catalog, project: Project, test: (run: { subjectId: string; rigId: string }) => boolean): string[] {
  return Object.values(catalog.runs)
    .filter((r) => r.projectId === project.id && test(r))
    .map((r) => `${r.name}${r.trashedAt ? " (in the Trash)" : ""}`)
}

// ---------------------------------------------------------------------------
// Subjects
// ---------------------------------------------------------------------------

export function SubjectsSection({ project }: { project: Project }) {
  const catalog = useStore((s) => s.catalog)
  const remove = useCommitError()
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState<SubjectDraft | null>(null)
  const [addError, setAddError] = useState<string | null>(null)
  const editable = project.state === "open"

  function add() {
    if (!draft) return
    const problem = draftProblem(draft)
    if (problem) {
      setAddError(problem)
      return
    }
    const resolved = resolveDraft(draft)
    if (!resolved.ok) {
      setAddError(resolved.message)
      return
    }
    const result = addSubject(project.id, { targetId: resolved.targetId, mosaic: resolved.mosaic }, project.revision)
    if (!result.ok) {
      setAddError(result.message)
      return
    }
    setDraft(null)
    setAdding(false)
    setAddError(null)
  }

  return (
    <Section
      id="subjects"
      title={`Subjects (${project.subjects.length})`}
      description="Targets or mosaics; each mosaic panel gets its own goals and panel run."
      actions={
        editable && !adding ? (
          <Button size="sm" variant="outline" onClick={() => setAdding(true)}>
            Add subject…
          </Button>
        ) : null
      }
    >
      <SimpleTable caption={`Subjects of ${project.name}`} headers={["Subject", "Kind", "Centre", "Panels (centre · rotation)", "Runs", ""]}>
        {project.subjects.map((subject) => {
          const target = subjectTarget(catalog, subject)
          const centre = subjectCentre(catalog, subject)
          const users = runsUsing(catalog, project, (r) => r.subjectId === subject.id)
          return (
            <tr key={subject.id}>
              <th scope="row" className={`${TD} text-left font-medium`}>
                {target ? (
                  <Link to="/targets/$targetId" params={{ targetId: target.id }} className="underline-offset-2 hover:underline">
                    {subjectName(catalog, subject)}
                  </Link>
                ) : (
                  subjectName(catalog, subject)
                )}
              </th>
              <td className={TD}>{subject.mosaic ? `Mosaic of ${target?.name ?? "its Target"}` : "Target"}</td>
              <td className={`${TD} whitespace-nowrap tabular-nums`}>{centre ? `${formatRa(centre.ra)} ${formatDec(centre.dec)}` : <span className="text-muted-foreground">Position unknown</span>}</td>
              <td className={TD}>
                {subject.mosaic ? (
                  <ul className="space-y-0.5 text-xs tabular-nums">
                    {subject.mosaic.panels.map((p) => (
                      <li key={p.id} className="whitespace-nowrap">
                        <span className="font-medium">{panelLabel(p)}</span> {formatRa(p.ra)} {formatDec(p.dec)} · {formatDegrees(p.rotationDeg, 0)}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </td>
              <td className={`${TD} text-xs`}>{users.length > 0 ? users.join(", ") : <span className="text-muted-foreground">None</span>}</td>
              <td className={`${TD} text-right`}>
                {editable ? (
                  <Button size="sm" variant="ghost" onClick={() => remove.run(() => removeSubject(project.id, subject.id, project.revision))}>
                    Remove<span className="sr-only"> {subjectName(catalog, subject)}</span>
                  </Button>
                ) : null}
              </td>
            </tr>
          )
        })}
      </SimpleTable>
      <InlineError message={remove.error} />
      {adding ? (
        <div className="space-y-3 rounded-[0.3125rem] border border-separator p-3">
          {draft ? (
            <ul>
              <SubjectDraftRow draft={draft} rigIds={project.rigIds} onChange={setDraft} onRemove={() => setDraft(null)} />
            </ul>
          ) : (
            <SubjectSearch autoFocus taken={project.subjects.map((s) => subjectTarget(catalog, s)?.name ?? "")} onPick={(pick) => setDraft(draftFromPick(pick))} />
          )}
          <p className="text-xs text-muted-foreground">
            Adding a subject changes candidates only, never a run.{project.goalTemplateId ? " Its goals are copied from the Project's template." : ""}
          </p>
          <InlineError message={addError} />
          <div className="flex gap-2">
            <Button size="sm" onClick={add} disabled={!draft} focusableWhenDisabled>
              Add to Project
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setAdding(false)
                setDraft(null)
                setAddError(null)
              }}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : null}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Rigs
// ---------------------------------------------------------------------------

export function RigsSection({ project }: { project: Project }) {
  const catalog = useStore((s) => s.catalog)
  const candidates = useStore((s) => projectCandidates(s.catalog, project))
  const remove = useCommitError()
  const add = useCommitError()
  const others = Object.values(catalog.opticalTrains).filter((r) => !project.rigIds.includes(r.id))
  const [choice, setChoice] = useState("")
  const editable = project.state === "open"
  const chosen = others.find((r) => r.id === choice) ?? others[0]
  return (
    <Section id="rigs" title={`Rigs (${project.rigIds.length})`} description="Each run uses exactly one rig; adding or removing one changes candidates only.">
      <SimpleTable caption={`Rigs of ${project.name}`} headers={["Rig", "Camera", "Filters", "Field of view", "Candidates", "Runs", ""]}>
        {project.rigIds.map((id) => {
          const rig = catalog.opticalTrains[id]
          const fov = rig ? rigFieldOfView(catalog, rig) : null
          const kind = rig ? rigCameraKind(catalog, rig) : null
          const users = runsUsing(catalog, project, (r) => r.rigId === id)
          return (
            <tr key={id}>
              <th scope="row" className={`${TD} text-left font-medium`}>
                {rigName(catalog, id)}
              </th>
              <td className={TD}>{kind === "osc" ? "OSC" : kind === "mono" ? "Mono" : "Unknown"}</td>
              <td className={TD}>{rig?.filters.map((f) => f.name).join(", ") || <span className="text-muted-foreground">None</span>}</td>
              <td className={`${TD} whitespace-nowrap tabular-nums`}>{fov ? `${formatDegrees(fov.widthDeg, 2)} × ${formatDegrees(fov.heightDeg, 2)}` : <span className="text-muted-foreground">Unknown</span>}</td>
              <td className={`${TD} tabular-nums`}>{candidates.filter((c) => c.rigId === id).length}</td>
              <td className={`${TD} text-xs`}>{users.length > 0 ? users.join(", ") : <span className="text-muted-foreground">None</span>}</td>
              <td className={`${TD} text-right`}>
                {editable ? (
                  <Button size="sm" variant="ghost" onClick={() => remove.run(() => removeRig(project.id, id, project.revision))}>
                    Remove<span className="sr-only"> {rigName(catalog, id)}</span>
                  </Button>
                ) : null}
              </td>
            </tr>
          )
        })}
      </SimpleTable>
      <InlineError message={remove.error} />
      {editable && chosen ? (
        <div className="flex flex-wrap items-end gap-2">
          <SelectField className="w-72" label="Add a rig" value={chosen.id} onChange={setChoice} options={others.map((r) => ({ value: r.id, label: r.name }))} />
          <Button size="sm" variant="outline" onClick={() => add.run(() => addRig(project.id, chosen.id, project.revision))}>
            Add rig
          </Button>
        </div>
      ) : null}
      <InlineError message={add.error} />
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Goals
// ---------------------------------------------------------------------------

function barLabel(bar: QualityBar | null): string {
  if (!bar) return "No quality bar"
  return bar.kind === "usable-only" ? "Usable frames only" : `Median FWHM ≤ ${bar.maxArcsec}″`
}

type BarChoice = "none" | "usable-only" | "max-fwhm"

export function GoalsSection({ project, channels }: { project: Project; channels: string[] }) {
  const catalog = useStore((s) => s.catalog)
  const progress = useStore((s) => goalProgress(s.catalog, project))
  const warnings = useStore((s) => projectWarnings(s.disk, s.catalog, project))
  const [editing, setEditing] = useState<Goal[] | null>(null)
  const [templateId, setTemplateId] = useState(BUILT_IN_GOAL_TEMPLATES[0]!.id)
  const save = useCommitError()
  const templates = [...BUILT_IN_GOAL_TEMPLATES, ...Object.values(catalog.goalTemplates)]
  const template = templates.find((t) => t.id === templateId)
  const editable = project.state === "open"
  const groups = project.subjects.flatMap<{ subject: Subject; panel: MosaicPanel | null }>((subject) =>
    subject.mosaic ? subject.mosaic.panels.map((p) => ({ subject, panel: p })) : [{ subject, panel: null }],
  )

  function edit(id: string, patch: Partial<Goal>) {
    setEditing((list) => list?.map((g) => (g.id === id ? { ...g, ...patch } : g)) ?? null)
  }

  return (
    <Section
      id="goals"
      title="Goals"
      description="Per subject, panel and channel. “In project” counts the Project's runs, “captured” adds every candidate; goals never block a run."
      actions={
        editable && !editing ? (
          <Button size="sm" variant="outline" onClick={() => setEditing(project.goals.map((g) => ({ ...g })))}>
            Edit goals
          </Button>
        ) : null
      }
    >
      {groups.map(({ subject, panel }) => {
        const key = `${subject.id}|${panel?.id ?? ""}`
        const rows = (editing ?? project.goals).filter((g) => g.subjectId === subject.id && (g.panelId ?? null) === (panel?.id ?? null))
        const subjectWarnings = panel ? [] : warnings.filter((w) => w.subjectId === subject.id && !rows.some((g) => g.channel === w.channel))
        return (
          <div key={key} className="space-y-1">
            <h3 className="text-sm font-medium">
              {subjectName(catalog, subject)}
              {panel ? ` · ${panelLabel(panel)}` : ""}
            </h3>
            {rows.length === 0 && !editing ? <p className="text-sm text-muted-foreground">No goals for this {panel ? "panel" : "subject"}.</p> : null}
            <ul className="divide-y divide-separator rounded-[0.3125rem] border border-separator">
              {rows.map((goal) => {
                const p = progress.find((x) => x.goal.id === goal.id)
                const rowWarnings = warnings.filter((w) => w.subjectId === subject.id && w.channel === goal.channel)
                return (
                  <li key={goal.id} className="space-y-1 px-3 py-1.5 text-sm">
                    {editing ? (
                      <GoalEditor goal={goal} channels={channels} onChange={(patch) => edit(goal.id, patch)} onRemove={() => setEditing((list) => list?.filter((g) => g.id !== goal.id) ?? null)} />
                    ) : (
                      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
                        <span className="font-medium tabular-nums">{p?.line ?? goal.channel}</span>
                        <span className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                          {p?.met ? (
                            <span className="inline-flex items-center gap-1 font-medium text-success">
                              <CircleCheck aria-hidden="true" className="size-3.5" />
                              Goal met
                            </span>
                          ) : p && p.remainingS !== null ? (
                            <span className="tabular-nums">{formatHours(p.remainingS)} to go in project</span>
                          ) : null}
                          <span>{barLabel(goal.qualityBar)}</span>
                        </span>
                      </div>
                    )}
                    {p && p.unknownQuality > 0 && !editing ? <p className="text-xs text-muted-foreground">{plural(p.unknownQuality, "member")} not measured for the quality bar: they read unknown and do not count.</p> : null}
                    {!editing
                      ? rowWarnings.map((w) => (
                          <p key={w.message} className="flex items-start gap-1.5 text-xs text-warning">
                            <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                            {w.kind === "exposure-mismatch" ? "Exposure mismatch" : "Missing calibration"}: {w.message}
                          </p>
                        ))
                      : null}
                  </li>
                )
              })}
              {editing ? (
                <li className="px-3 py-1.5">
                  <AddGoal
                    channels={channels.filter((c) => !rows.some((g) => g.channel === c))}
                    onAdd={(channel) =>
                      setEditing((list) => [...(list ?? []), { id: freshId("goal", `${subject.id}|${panel?.id ?? ""}|${channel}`), subjectId: subject.id, panelId: panel?.id ?? null, channel, integrationS: 10 * 3600, frameCount: null, qualityBar: null }])
                    }
                  />
                </li>
              ) : null}
            </ul>
            {subjectWarnings.map((w) => (
              <p key={w.message} className="flex items-start gap-1.5 text-xs text-warning">
                <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                {w.kind === "exposure-mismatch" ? "Exposure mismatch" : "Missing calibration"}: {w.message}
              </p>
            ))}
          </div>
        )
      })}
      {editing ? (
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            onClick={() => {
              if (save.run(() => setGoals(project.id, editing, project.revision))) setEditing(null)
            }}
          >
            Save goals
          </Button>
          <Button size="sm" variant="outline" onClick={() => setEditing(null)}>
            Cancel
          </Button>
        </div>
      ) : null}
      <InlineError message={save.error} />
      {editable && !editing ? (
        <div className="flex flex-wrap items-end gap-2">
          <SelectField className="w-56" label="Goal template" value={templateId} onChange={setTemplateId} options={templates.map((t) => ({ value: t.id, label: t.name }))} />
          <ConfirmDialog
            trigger={
              <Button size="sm" variant="outline">
                Apply template…
              </Button>
            }
            title={`Apply ${template?.name ?? "template"} to ${project.name}?`}
            description="Its values are copied in. The copy stands alone and stays editable; editing the template later changes no Project."
            changes={[
              `Replaces the ${plural(project.goals.length, "current goal")} with ${template?.values.map((v) => `${v.channel} ${v.integrationS !== null ? formatHours(v.integrationS) : plural(v.frameCount ?? 0, "frame")}`).join(", ") || "no goals"}`,
              `For each of ${plural(groups.length, "subject and panel", "subjects and panels")}`,
            ]}
            unchanged={["Every run and its membership", "Library quality and captured frames"]}
            confirmLabel="Apply template"
            onConfirm={() => applyGoalTemplate(project.id, templateId, project.revision)}
          />
        </div>
      ) : null}
    </Section>
  )
}

function GoalEditor({ goal, channels, onChange, onRemove }: { goal: Goal; channels: string[]; onChange: (patch: Partial<Goal>) => void; onRemove: () => void }) {
  const bar: BarChoice = goal.qualityBar?.kind ?? "none"
  const id = useId()
  return (
    <div className="flex flex-wrap items-end gap-2">
      <SelectField className="w-32" label="Channel" value={goal.channel} onChange={(channel) => onChange({ channel })} options={[...new Set([goal.channel, ...channels])].map((c) => ({ value: c, label: c }))} />
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-h`} className="text-sm font-medium">
          Integration (h)
        </label>
        <Input
          id={`${id}-h`}
          type="number"
          min={0}
          step={0.5}
          className="w-24 tabular-nums"
          value={goal.integrationS === null ? "" : String(goal.integrationS / 3600)}
          onChange={(e) => onChange({ integrationS: e.target.value === "" ? null : Math.round(Number(e.target.value) * 3600) })}
        />
      </div>
      <div className="grid gap-1.5">
        <label htmlFor={`${id}-f`} className="text-sm font-medium">
          Frames
        </label>
        <Input id={`${id}-f`} type="number" min={0} className="w-20 tabular-nums" value={goal.frameCount === null ? "" : String(goal.frameCount)} onChange={(e) => onChange({ frameCount: e.target.value === "" ? null : Math.round(Number(e.target.value)) })} />
      </div>
      <SelectField
        className="w-44"
        label="Quality bar"
        value={bar}
        onChange={(value) => onChange({ qualityBar: value === "none" ? null : value === "usable-only" ? { kind: "usable-only" } : { kind: "max-fwhm", maxArcsec: goal.qualityBar?.kind === "max-fwhm" ? goal.qualityBar.maxArcsec : 3 } })}
        options={[
          { value: "none", label: "None" },
          { value: "usable-only", label: "Usable frames only" },
          { value: "max-fwhm", label: "Median FWHM limit" },
        ]}
      />
      {goal.qualityBar?.kind === "max-fwhm" ? (
        <div className="grid gap-1.5">
          <label htmlFor={`${id}-fwhm`} className="text-sm font-medium">
            FWHM ≤ (″)
          </label>
          <Input id={`${id}-fwhm`} type="number" min={0.5} step={0.1} className="w-20 tabular-nums" value={String(goal.qualityBar.maxArcsec)} onChange={(e) => onChange({ qualityBar: { kind: "max-fwhm", maxArcsec: Number(e.target.value) || 0 } })} />
        </div>
      ) : null}
      <Button size="sm" variant="ghost" onClick={onRemove}>
        Remove<span className="sr-only"> {goal.channel} goal</span>
      </Button>
    </div>
  )
}

function AddGoal({ channels, onAdd }: { channels: string[]; onAdd: (channel: string) => void }) {
  const [channel, setChannel] = useState("")
  if (channels.length === 0) return <p className="text-xs text-muted-foreground">Every channel the Project's rigs capture has a goal here.</p>
  const value = channels.includes(channel) ? channel : channels[0]!
  return (
    <div className="flex flex-wrap items-end gap-2">
      <SelectField className="w-40" label="Add a goal for" value={value} onChange={setChannel} options={channels.map((c) => ({ value: c, label: c }))} />
      <Button size="sm" variant="outline" onClick={() => onAdd(value)}>
        Add goal
      </Button>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

function unreviewed(catalog: Catalog, session: Session): number {
  return liveAssetIds(catalog, session).filter((id) => {
    const asset = catalog.assets[id]
    return asset ? asset.quality.value === "unreviewed" || qualityApplicability(asset) !== "applicable" : false
  }).length
}

export type CandidateFilter = "all" | "unreviewed" | "ready"

interface CandidateRow {
  session: Session
  subject: string
  placement: string | null
  rig: string
  frames: number
  unreviewed: number
  reason: string
  runs: string[]
}

function candidateRows(state: PrototypeState, project: Project): CandidateRow[] {
  const { catalog } = state
  const runs = projectRuns(catalog, project.id)
  return projectCandidates(catalog, project).map((c) => {
    const placed = c.subject.mosaic ? panelForSession(catalog, c.subject, c.session, c.rigId) : null
    const panel = placed?.panelId ? findPanel(c.subject, placed.panelId) : undefined
    return {
      session: c.session,
      subject: subjectName(catalog, c.subject),
      placement: placed ? (panel ? panelLabel(panel) : placed.detail) : null,
      rig: rigName(catalog, c.rigId),
      frames: liveAssetIds(catalog, c.session).length,
      unreviewed: unreviewed(catalog, c.session),
      reason: c.reason,
      runs: runs.filter((r) => latestRevision(r)?.sessions.some((m) => m.sessionId === c.session.id)).map((r) => r.name),
    }
  })
}

export function CandidatesTable({ project, filter }: { project: Project; filter: CandidateFilter }) {
  const rows = useStore((s) => candidateRows(s, project))
  const shown = rows.filter((r) => (filter === "unreviewed" ? r.unreviewed > 0 : filter === "ready" ? r.runs.length === 0 : true))
  if (shown.length === 0)
    return (
      <p className="text-sm text-muted-foreground">
        {filter === "unreviewed" ? "No candidate has Unreviewed frames." : filter === "ready" ? "Every candidate is in one of the Project's runs." : "No candidates: a session becomes one when its confirmed Target is a subject and its rig is one of the Project's rigs."}
      </p>
    )
  return (
    <SimpleTable caption={`Candidate sessions of ${project.name}`} headers={["Session", "Subject", "Rig", "Frames", "Unreviewed", "Why", "In runs"]}>
      {shown.map((r) => (
        <tr key={r.session.id}>
          <th scope="row" className={`${TD} text-left font-medium whitespace-nowrap`}>
            <Link to="/sessions/$sessionId" params={{ sessionId: r.session.id }} className="underline-offset-2 hover:underline">
              {formatNight(r.session.night)} · {r.session.channel ?? "No filter"}
            </Link>
          </th>
          <td className={TD}>
            {r.subject}
            {r.placement ? <span className="block text-[0.6875rem] text-muted-foreground">{r.placement}</span> : null}
          </td>
          <td className={TD}>{r.rig}</td>
          <td className={`${TD} tabular-nums`}>{r.frames}</td>
          <td className={`${TD} tabular-nums`}>{r.unreviewed > 0 ? <span className="text-warning">{r.unreviewed}</span> : 0}</td>
          <td className={`${TD} text-xs text-muted-foreground`}>{r.reason}</td>
          <td className={`${TD} text-xs`}>{r.runs.length > 0 ? r.runs.join(", ") : <span className="text-muted-foreground">Ready to add to a run</span>}</td>
        </tr>
      ))}
    </SimpleTable>
  )
}

/**
 * Candidates, summarised: counts, a link to the candidate review and a disclosure for the table, so the
 * Project's runs and goals stay first on the page.
 */
export function CandidatesSection({ project }: { project: Project }) {
  const [filter, setFilter] = useState<CandidateFilter>("all")
  const [open, setOpen] = useState(false)
  const tableId = useId()
  const rows = useStore((s) => candidateRows(s, project))
  const flagged = useStore((s) =>
    projectRuns(s.catalog, project.id).flatMap((run) => runRefresh(s.catalog, run).noLongerMatching.map((sessionId) => ({ run, session: s.catalog.sessions[sessionId] }))),
  )
  const catalog = useStore((s) => s.catalog)
  const unreviewedFrames = rows.reduce((n, r) => n + r.unreviewed, 0)
  const ready = rows.filter((r) => r.runs.length === 0).length
  return (
    <Section
      id="candidates"
      title={`Candidates (${rows.length})`}
      description="Sessions of a subject on one of the Project's rigs; they join the Project only through a run."
      actions={
        rows.length > 0 ? (
          <Button size="sm" variant="ghost" aria-expanded={open} aria-controls={tableId} onClick={() => setOpen((o) => !o)}>
            {open ? <ChevronDown aria-hidden="true" data-icon="inline-start" /> : <ChevronRight aria-hidden="true" data-icon="inline-start" />}
            {open ? "Hide candidates" : "Show candidates"}
          </Button>
        ) : null
      }
    >
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
        <span className="tabular-nums">
          {rows.length === 0 ? "No candidate sessions yet." : `${plural(rows.length, "session")} · ${plural(ready, "session")} in no run yet`}
        </span>
        {unreviewedFrames > 0 ? (
          <Link to="/projects/$projectId" params={{ projectId: project.id }} search={{ candidates: "unreviewed" } as never} className="text-link underline-offset-2 hover:underline">
            Review {plural(unreviewedFrames, "new frame")}
          </Link>
        ) : rows.length > 0 ? (
          <span className="text-muted-foreground">Every candidate frame has a quality decision.</span>
        ) : null}
      </p>
      {open ? (
        <div id={tableId} className="space-y-2">
          <div className="flex gap-1" role="group" aria-label="Candidates filter">
            {(
              [
                ["all", "All"],
                ["unreviewed", "Unreviewed"],
                ["ready", "In no run yet"],
              ] as const
            ).map(([value, label]) => (
              <Button key={value} size="sm" variant={filter === value ? "secondary" : "ghost"} aria-pressed={filter === value} onClick={() => setFilter(value)}>
                {label}
              </Button>
            ))}
          </div>
          <CandidatesTable project={project} filter={filter} />
        </div>
      ) : null}
      {flagged.length > 0 ? (
        <Notice tone="warning" title={`${plural(flagged.length, "member")} no longer ${flagged.length === 1 ? "matches its" : "match their"} subject`}>
          <ul className="space-y-1">
            {flagged.map(({ run, session }) => (
              <li key={`${run.id}|${session?.id}`}>
                {session ? sessionLabel(catalog, session) : "A session"} in {run.name} stays in the run and still counts.{" "}
                <Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: project.id, runId: run.id, step: "select" }} className="text-link underline-offset-2 hover:underline">
                  Review it in Select
                </Link>
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Runs and run groups
// ---------------------------------------------------------------------------

export function RunsSection({ project }: { project: Project }) {
  const state = useStore((s) => s)
  const follow = useFollowLink()
  const runs = projectRuns(state.catalog, project.id).filter((r) => !r.groupId)
  const groups = projectGroups(state.catalog, project.id)
  return (
    <Section
      id="runs"
      title="Runs"
      description="Each run with its steps and its Next; a mosaic's run group lists its panel runs together."
      actions={
        project.state === "open" ? (
          <Button size="sm" variant="outline" onClick={() => openSheet({ kind: "start-run", projectId: project.id })}>
            <Play aria-hidden="true" data-icon="inline-start" />
            Start a processing run
          </Button>
        ) : null
      }
    >
      {runs.length === 0 && groups.length === 0 ? (
        <EmptyState
          icon={FolderKanban}
          title="No runs yet"
          description="A run takes one subject and one rig; its candidates start selected."
          action={
            project.state === "open" ? (
              <Button size="sm" variant="outline" onClick={() => openSheet({ kind: "start-run", projectId: project.id })}>
                Start a processing run
              </Button>
            ) : (
              <span className="text-sm text-muted-foreground">Reopen the Project to start a run.</span>
            )
          }
        />
      ) : (
        <ul className="divide-y divide-separator rounded-[0.3125rem] border border-separator">
          {runs.map((run) => {
            const pipeline = runPipeline(state, run)
            const held = pipeline.blocker ? pipeline.steps.find((s) => s.id === pipeline.blocker!.step) : undefined
            const subject = project.subjects.find((s) => s.id === run.subjectId)
            return (
              <li key={run.id} className="grid gap-x-4 gap-y-1 px-3 py-2 lg:grid-cols-[minmax(12rem,1fr)_auto_auto] lg:items-center">
                <div className="min-w-0">
                  <Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: project.id, runId: run.id, step: pipeline.current.id }} className="font-medium underline-offset-2 hover:underline">
                    {run.name}
                  </Link>
                  <span className="block text-[0.6875rem] text-muted-foreground">
                    {subject ? subjectName(state.catalog, subject) : "Unknown subject"} · {rigName(state.catalog, run.rigId)}
                  </span>
                  <span className="flex flex-wrap items-center gap-x-1.5 text-[0.6875rem]">
                    <StatusBadge kind="run" value={pipeline.status} />
                    {held ? <GateLabel state={held.state} label={`${GATE_LABEL[held.state]} at ${held.label}: ${pipeline.blocker!.message}`} /> : null}
                  </span>
                </div>
                <StepRail steps={pipeline.steps} current={pipeline.current.id} label={`Steps of ${run.name}`} />
                <NextButton next={pipeline.next} onFollow={follow} runName={run.name} />
              </li>
            )
          })}
          {groups.map((group) => {
            const pipeline = groupPipeline(state, group)
            const current = pipeline.next?.step ?? pipeline.steps.at(-1)!
            return (
              <li key={group.id} className="space-y-1.5 px-3 py-2">
                <div className="grid gap-x-4 gap-y-1 lg:grid-cols-[minmax(12rem,1fr)_auto_auto] lg:items-center">
                  <div className="min-w-0">
                    <Link to="/projects/$projectId/groups/$groupId/$step" params={{ projectId: project.id, groupId: group.id, step: current.id }} className="font-medium underline-offset-2 hover:underline">
                      {group.name}
                    </Link>
                    <span className="block text-[0.6875rem] text-muted-foreground">
                      Run group · {plural(pipeline.panels.length, "panel run")} · {rigName(state.catalog, group.rigId)}
                    </span>
                  </div>
                  <StepRail steps={pipeline.steps} current={current.id} label={`Steps of ${group.name}`} />
                  <NextButton next={pipeline.next} onFollow={follow} runName={group.name} />
                </div>
                <ul className="ml-3 space-y-1 border-l border-separator pl-3">
                  {pipeline.panels.map((p) => (
                    <li key={p.run.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                      {p.trashed ? (
                        <>
                          <span className="w-16 font-medium">{panelLabel(p.panel)}</span>
                          <StatusBadge kind="run" value="trashed" />
                          <span className="text-xs text-muted-foreground">Its frames leave the group counts.</span>
                          <Link to="/projects/$projectId/trash" params={{ projectId: project.id }} className="text-xs text-link underline-offset-2 hover:underline">
                            Open Trash
                          </Link>
                        </>
                      ) : (
                        <>
                          <Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: project.id, runId: p.run.id, step: p.pipeline.current.id }} className="w-16 font-medium underline-offset-2 hover:underline">
                            {panelLabel(p.panel)}
                          </Link>
                          <StepRail compact steps={p.pipeline.steps} current={p.pipeline.current.id} label={`Steps of ${p.run.name}`} />
                          <GateLabel state={p.pipeline.current.state} label={`${p.pipeline.current.label}: ${p.pipeline.current.status}`} className="text-muted-foreground" />
                        </>
                      )}
                    </li>
                  ))}
                </ul>
              </li>
            )
          })}
        </ul>
      )}
    </Section>
  )
}

function NextButton({ next, onFollow, runName }: { next: ReturnType<typeof runPipeline>["next"]; onFollow: (link: NonNullable<ReturnType<typeof runPipeline>["next"]>["link"]) => void; runName: string }) {
  if (!next) return <span className="text-xs text-muted-foreground">Nothing waiting</span>
  return (
    <Button size="sm" variant="outline" title={next.reason} onClick={() => onFollow(next.link)}>
      Next: {next.label}
      <span className="sr-only"> for {runName}</span>
    </Button>
  )
}

// ---------------------------------------------------------------------------
// Planning for its subjects (D-W16, D-W63)
// ---------------------------------------------------------------------------

export function PlanningSection({ project }: { project: Project }) {
  const state = useStore((s) => s)
  const site = planningSite(state)
  const now = Date.parse(nowIso())
  const tonight = site ? tonightAt(site, now) : null
  const open = (
    <Button size="sm" variant="outline" render={<Link to="/plan" search={{ project: project.id }} />}>
      Open in Planner
    </Button>
  )
  return (
    <Section id="planning" title="Planning" description="Tonight for this Project's subjects and what each goal still needs." actions={open}>
      {!site || !tonight ? (
        <Notice
          tone="info"
          title="Add an observing site in Settings"
          actions={
            <Button size="sm" variant="outline" render={<Link to="/settings/sites" />}>
              <MapPinOff aria-hidden="true" data-icon="inline-start" />
              Observing sites
            </Button>
          }
        >
          Tonight&apos;s windows need a site. Goals and gaps below still read as usual.
        </Notice>
      ) : (
        <p className="text-xs text-muted-foreground tabular-nums">
          {site.name} ({site.timeZone}) · night of {formatNight(tonight.night)} · Moon {tonight.moon.phase.toLowerCase()}, {Math.round(tonight.moon.illuminationPct)}% ·{" "}
          {tonight.darkness ? `dark ${formatTime(tonight.darkness.start, site.timeZone)}–${formatTime(tonight.darkness.end, site.timeZone)}` : "no full darkness tonight"}
        </p>
      )}
      <SimpleTable caption={`Planning for the subjects of ${project.name}`} headers={["Subject", "Best window tonight", "Gaps (in project · captured)"]}>
        {project.subjects.map((subject) => {
          const target = subjectTarget(state.catalog, subject)
          const centre = subjectCentre(state.catalog, subject)
          const window = site && target && centre ? bestWindowTonight({ ...target, ra: centre.ra, dec: centre.dec }, site, defaultCriteria(site), now) : null
          const gaps = subjectGaps(state.catalog, project, subject)
          return (
            <tr key={subject.id}>
              <th scope="row" className={`${TD} text-left font-medium`}>
                {subjectName(state.catalog, subject)}
                {subject.mosaic ? <span className="block text-[0.6875rem] font-normal text-muted-foreground">Centre of {plural(subject.mosaic.panels.length, "panel")}</span> : null}
              </th>
              <td className={`${TD} tabular-nums`}>
                {!site ? (
                  <span className="text-muted-foreground">No site</span>
                ) : !centre ? (
                  <span className="text-muted-foreground">Position unknown</span>
                ) : window ? (
                  `${formatTime(window.start, site.timeZone)}–${formatTime(window.end, site.timeZone)} · max ${Math.round(window.maxAltitudeDeg)}° · Moon ${Math.round(window.moonSeparationDeg)}° away`
                ) : (
                  <span className="text-muted-foreground">No window tonight</span>
                )}
              </td>
              <td className={TD}>
                {gaps.length === 0 ? (
                  <span className="text-muted-foreground">No integration goals</span>
                ) : (
                  <ul className="space-y-0.5 text-xs tabular-nums">
                    {gaps.map((gap) => {
                      const panel = gap.panelId ? findPanel(subject, gap.panelId) : undefined
                      return (
                        <li key={`${gap.panelId}|${gap.channel}`} className={gap.met ? "text-success" : undefined}>
                          {panel ? `${panelLabel(panel)}: ` : ""}
                          {gap.line}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </td>
            </tr>
          )
        })}
      </SimpleTable>
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Archived sessions (D-W69) and Trash
// ---------------------------------------------------------------------------

export function ArchivedSection({ project }: { project: Project }) {
  const catalog = useStore((s) => s.catalog)
  const origins = useStore((s) => s.slices.b.archiveOrigins)
  const operationId = useStore((s) => s.slices.b.approvals[project.id]?.restore ?? null)
  const ids = project.archive?.sessionIds ?? []
  const [chosen, setChosen] = useState<string[]>([])
  const live = chosen.filter((id) => ids.includes(id))
  const plan = useStore((s) => restorePlan(s, project, origins, live))
  if (ids.length === 0 && !operationId) return null
  const open = project.state === "open"
  return (
    <Section
      id="archived"
      title={`Archived sessions (${ids.length})`}
      description={open ? "This Project was reopened after Archive. Its archived sessions stay Archived until you restore them; reopening moved no file." : "Archived when the Project was Done. Reopen the Project to restore them."}
      actions={
        open && live.length > 0 ? (
          <ConfirmDialog
            trigger={<Button size="sm">Restore {plural(live.length, "session")}…</Button>}
            title={`Restore ${plural(live.length, "session")}?`}
            description="A reviewed transfer back to where Archive found each frame."
            changes={[
              ...plan.rows.map((r) => `${sessionLabel(catalog, r.session)}: ${plural(r.moves.length, "frame")} back to ${r.folder}`),
              ...plan.refused.map((r) => `${sessionLabel(catalog, r.session)} stays archived: ${r.reason}`),
              "Verifies each frame's SHA-256 before it moves and rebuilds prepared links",
            ]}
            unchanged={["Run membership and totals", "Sessions you did not choose"]}
            confirmLabel="Restore"
            onConfirm={() => {
              if (plan.rows.length === 0) return { ok: false, reason: "refused", message: plan.blocked ?? "Nothing chosen can be restored now.", reasons: [] }
              rememberApproval(project.id, "restore", startArchiveTransfer(project.id, plan.rows, "restore"))
              setChosen([])
              return { ok: true }
            }}
          />
        ) : null
      }
    >
      {ids.length > 0 ? (
        <SimpleTable caption={`Archived sessions of ${project.name}`} headers={[open ? "Restore" : "", "Session", "State", "Archive path"]}>
          {ids.map((id) => {
            const session = catalog.sessions[id]
            if (!session) return null
            const first = liveAssetIds(catalog, session).map((a) => catalog.assets[a]).find((a) => a !== undefined)
            const path = first?.copies.find((c) => catalog.locations[c.locationId]?.role === "archive")?.path ?? first?.copies[0]?.path ?? ""
            return (
              <tr key={id}>
                <td className={TD}>
                  {open ? <Checkbox aria-label={`Restore ${sessionLabel(catalog, session)}`} checked={live.includes(id)} onCheckedChange={(checked) => setChosen((list) => (checked ? [...list, id] : list.filter((x) => x !== id)))} /> : null}
                </td>
                <th scope="row" className={`${TD} text-left font-medium`}>
                  <Link to="/sessions/$sessionId" params={{ sessionId: id }} className="underline-offset-2 hover:underline">
                    {sessionLabel(catalog, session)}
                  </Link>
                </th>
                <td className={TD}>Archived</td>
                <td className={TD}>
                  <PathText path={path.split("/").slice(0, -1).join("/")} />
                </td>
              </tr>
            )
          })}
        </SimpleTable>
      ) : null}
      {operationId ? <OperationPanel operationId={operationId} headingLevel={3} /> : null}
    </Section>
  )
}

export function TrashSection({ project }: { project: Project }) {
  const trashed = useStore((s) => projectTrash(s.catalog, project.id))
  return (
    <Section
      id="trash"
      title={`Trash (${trashed.length})`}
      description="Hidden everywhere else and out of the totals; nothing moved on disk."
      actions={
        <Button size="sm" variant="outline" render={<Link to="/projects/$projectId/trash" params={{ projectId: project.id }} />}>
          <Trash2 aria-hidden="true" data-icon="inline-start" />
          Open Trash
        </Button>
      }
    >
      {trashed.length === 0 ? (
        <p className="text-sm text-muted-foreground">The Trash is empty.</p>
      ) : (
        <p className="text-sm">{trashed.map((r) => r.name).join(", ")}</p>
      )}
    </Section>
  )
}
