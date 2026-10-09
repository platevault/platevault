/**
 * S5 Results: candidates discovered only in the recorded Results folder,
 * Pending while a file is still being written, intermediates listed apart
 * (they reach the OS Trash in the Project's Wrap up); attribution to a
 * prepared revision (tool evidence, the time window as an inference, or
 * Unknown); Attach (User-linked); Accept, bound to the current bytes; and
 * "Use as input to a new run" with the product's rig (D-W4, D-W55, D-W56,
 * D-W67, RES-FR-01 to RES-FR-05). Rows have a right-click menu.
 */
import { useNavigate } from "@tanstack/react-router"
import { Check, Copy, FlaskConical, FolderSearch, Layers, PackageCheck, Paperclip, Play, ScanSearch } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { useMessages } from "@/app/preferences"
import { Box } from "@/components/app/box"
import { type Column, DataTable } from "@/components/app/data-table"
import { CountBadge, Pill } from "@/components/app/pill"
import { Refusal } from "@/components/app/refusal"
import type { MenuEntry } from "@/components/app/row-menu"
import { StatusBadge } from "@/components/app/status"
import { HelpTip, NoteMarker } from "@/components/app/tips"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { projectWrapUp, rigName, runPreparations, subjectName } from "@/domain/derive"
import { RESULT_KIND_NAME } from "@/domain/labels"
import type { Project, ResultKind, ResultRecord } from "@/domain/types"
import { SelectField } from "@/features/t3/fields"
import { fileName, formatBytes } from "@/lib/format"
import { type Messages, m, say } from "@/lib/i18n"
import { useStore } from "@/store/core"
import { acceptResult, attachResult, discoverResults, finishWriting, inspectResult, setResultKind, simulateApplicationOutput, startRunWithResult } from "./actions"
import { MasterOffers } from "./calibrate-step"
import { type ResultRow, type RunContext, resultRow, resultsFolders, runLayout } from "./model"
import { OutcomeNotice, PrototypeMenu, RowActions, Sha, useOutcome } from "./parts"

type Act = ReturnType<typeof useOutcome>["act"]

const KINDS: ResultKind[] = ["linear-integration", "channel-product", "final-image", "mosaic-panel"]

/** Wrap up on the Project page (P-WRAP1): where intermediates and prepared folders leave, once every run is Complete. */
export function WrapUpLink({ project }: { project: Project }) {
  const m = useMessages()
  const available = useStore((s) => projectWrapUp(s.catalog, project).available)
  if (!available) return null
  return (
    <Pill tone="info" icon={PackageCheck} link={{ to: "/projects/$projectId", params: { projectId: project.id }, search: { stage: "wrap-up" } }}>
      {m.run_wrap_up()}
    </Pill>
  )
}

export function ResultsStep({ ctx }: { ctx: RunContext }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const { run, project } = ctx
  const outcome = useOutcome()
  const folders = resultsFolders(state, run)
  const preps = runPreparations(state.catalog, run.id)
  // Opening Results looks in the recorded folder; new files are listed, never accepted.
  useEffect(() => {
    if (!run.trashedAt) discoverResults({ runId: run.id })
  }, [run.id, run.trashedAt])
  const records = Object.values(state.catalog.results).filter((r) => r.runId === run.id && !r.trashed)
  const rows = records.map((r) => resultRow(state, r, preps))
  const products = rows.filter((r) => !r.record.intermediate)
  const intermediates = rows.filter((r) => r.record.intermediate)
  const [attaching, setAttaching] = useState(false)
  const [using, setUsing] = useState<ResultRecord | null>(null)
  const proposed = runLayout(state, run).resultsPath
  const lookAgain = () => {
    const r = discoverResults({ runId: run.id })
    outcome.act(r, { blocked: m.run_results_look_again_blocked(), success: { title: r.found > 0 ? m.run_results_new_files_found({ count: r.found }) : m.import_nothing_new(), tone: "info" } })
  }
  return (
    <div className="space-y-4">
      <OutcomeNotice outcome={outcome.outcome} onDismiss={outcome.clear} />
      <Box
        id="results-folder"
        level={2}
        title={m.run_results_folder()}
        actions={
          <>
            <PrototypeMenu actions={[{ label: m.run_proto_app_writes_outputs(), detail: m.run_proto_app_writes_outputs_detail(), run: () => outcome.act(simulateApplicationOutput({ runId: run.id }), { blocked: m.run_proto_blocked() }) }]} />
            <Button size="xs" variant="outline" disabled={folders.length === 0 || run.trashedAt !== null} onClick={lookAgain}>
              <FolderSearch aria-hidden="true" data-icon="inline-start" />
              {m.run_results_look_again()}
            </Button>
            <Button size="xs" variant="outline" disabled={run.trashedAt !== null} onClick={() => setAttaching(true)}>
              <Paperclip aria-hidden="true" data-icon="inline-start" />
              {m.run_results_attach_ellipsis()}
            </Button>
          </>
        }
      >
        {folders.length > 0 ? (
          folders.map((f) => (
            <p key={f} className="font-mono text-xs [overflow-wrap:anywhere]">
              {f}/
            </p>
          ))
        ) : (
          <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
            <Pill tone="muted">{m.run_not_prepared()}</Pill>
            {proposed ? <span className="font-mono text-xs [overflow-wrap:anywhere]">{proposed}/</span> : null}
          </p>
        )}
      </Box>

      <MasterOffers run={run} onOutcome={outcome.act} />

      <Box
        id="results-products"
        level={2}
        flush
        title={
          <span className="flex items-center gap-1.5">
            {m.run_results_products()} <CountBadge count={products.length} label={m.run_results_products_count({ count: products.length })} />
            <HelpTip label={m.run_results_products()}>{m.run_results_products_help()}</HelpTip>
          </span>
        }
      >
        <ResultsTable rows={products} rigId={run.rigId} onOutcome={outcome.act} onUse={setUsing} kinds={KINDS} />
      </Box>

      <Box
        id="results-intermediates"
        level={2}
        title={
          <span className="flex items-center gap-1.5">
            {m.run_results_intermediates()} <CountBadge count={intermediates.length} label={m.run_results_intermediates_count({ count: intermediates.length })} />
          </span>
        }
        actions={intermediates.length > 0 ? <WrapUpLink project={project} /> : null}
      >
        {intermediates.length === 0 ? (
          <p className="text-sm text-muted-foreground">{m.run_none()}</p>
        ) : (
          <details className="text-[0.75rem]">
            <summary className="cursor-default">
              {m.run_files_count({ count: intermediates.length })} · {formatBytes(intermediates.reduce((n, r) => n + (r.file?.sizeBytes ?? 0), 0))}
            </summary>
            <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto font-mono">
              {intermediates.map((r) => (
                <li key={r.record.id}>{r.record.path.slice((folders[0] ?? "").length + 1)}</li>
              ))}
            </ul>
          </details>
        )}
      </Box>

      <AttachDialog open={attaching} onOpenChange={setAttaching} defaultFolder={folders[0] ?? null} kinds={KINDS} onAttach={(path, kind, channel) => outcome.act(attachResult({ runId: run.id }, path, kind, channel), { blocked: m.run_results_attach_blocked() })} />
      <UseAsInputDialog record={using} onClose={() => setUsing(null)} onOutcome={outcome.act} />
    </div>
  )
}

function basisNote(m: Messages, basis: ResultRow["attribution"]["basis"]): string {
  if (basis === "tool") return m.run_results_basis_tool()
  if (basis === "window") return m.run_results_basis_window()
  return m.session_no_evidence()
}

export function attributionCell(r: ResultRow) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{say(m, r.attribution.label)}</span>
      <NoteMarker label={m.run_results_attribution_for({ name: fileName(r.record.path) })}>{r.record.discovered === "attached" && r.attribution.basis === "unknown" ? m.run_results_attached_no_evidence() : basisNote(m, r.attribution.basis)}</NoteMarker>
    </span>
  )
}

/** Copy a path to the clipboard (the row menu's Copy path). */
function copyPath(path: string) {
  void navigator.clipboard?.writeText(path).catch(() => {})
}

export function ResultsTable({ rows, onOutcome, onUse, kinds }: { rows: ResultRow[]; rigId: string; onOutcome: Act; onUse?: (r: ResultRecord) => void; kinds: ResultKind[] }) {
  const m = useMessages()
  const accept = (r: ResultRow) => onOutcome(acceptResult(r.record.id), { blocked: m.run_results_accept_blocked() })
  const entries = (r: ResultRow): MenuEntry[] => {
    const name = fileName(r.record.path)
    const candidate = r.record.acceptance === "candidate"
    return [
      { heading: name },
      ...(candidate ? [{ label: m.run_accept(), icon: Check, onSelect: () => accept(r) }] : []),
      ...(!candidate && onUse ? [{ label: m.run_results_use_as_input(), icon: Play, onSelect: () => onUse(r.record) }] : []),
      ...(r.changed && !r.pending ? [{ label: m.run_results_inspect_again(), icon: ScanSearch, onSelect: () => onOutcome(inspectResult(r.record.id), { blocked: m.run_results_inspect_blocked() }) }] : []),
      ...(candidate && !r.record.kind ? [{ separator: true } as const, ...kinds.map((k) => ({ label: m.run_results_kind_option({ kind: say(m, RESULT_KIND_NAME[k]) }), onSelect: () => onOutcome(setResultKind(r.record.id, k), { blocked: m.run_results_kind_blocked() }) }))] : []),
      { separator: true },
      { label: m.session_copy_path(), icon: Copy, onSelect: () => copyPath(r.record.path) },
      ...(r.pending ? [{ label: m.run_proto_finish_writing(), icon: FlaskConical, onSelect: () => onOutcome(finishWriting(r.record.id), { blocked: m.run_proto_blocked() }) }] : []),
    ]
  }
  const columns: Column<ResultRow>[] = [
    {
      id: "file",
      header: m.run_col_file(),
      rowHeader: true,
      cell: (r) => (
        <span className="flex max-w-[18rem] flex-col">
          <span className="truncate" title={r.record.path}>
            {fileName(r.record.path)}
          </span>
          <Sha value={r.record.sha256} />
        </span>
      ),
      sortValue: (r) => r.record.path,
    },
    {
      id: "kind",
      header: m.run_col_kind(),
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          {r.record.kind ? <span>{say(m, RESULT_KIND_NAME[r.record.kind])}</span> : <Pill tone="warning">{r.record.acceptance === "candidate" ? m.run_results_kind_missing() : m.run_unknown_kind()}</Pill>}
          {r.record.channel ? <Pill tone="neutral">{r.record.channel}</Pill> : null}
        </span>
      ),
    },
    {
      id: "state",
      header: m.run_col_state(),
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          {r.pending ? <StatusBadge kind="processing" value="pending" label={m.status_pending()} /> : !r.readable ? <StatusBadge kind="availability" value="absent" label={m.status_unreadable()} /> : <StatusBadge kind="acceptance" value={r.record.acceptance} />}
          {r.changed && !r.pending ? <StatusBadge kind="content" value="drifted" label={r.record.acceptance === "accepted" ? m.status_drifted() : m.run_results_changed()} /> : null}
        </span>
      ),
    },
    {
      id: "rev",
      header: m.run_col_revision(),
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          {attributionCell(r)}
          <StatusBadge kind="lineage" value={r.record.association} />
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: (r) => (
        <span className="flex items-center justify-end gap-1">
          {r.record.acceptance === "candidate" ? (
            <Button size="xs" onClick={() => accept(r)} aria-label={m.run_results_accept_named({ name: fileName(r.record.path) })}>
              {m.run_accept()}
            </Button>
          ) : null}
          <RowActions entries={entries(r)} label={m.run_actions_for({ name: fileName(r.record.path) })} />
        </span>
      ),
    },
  ]
  return (
    <DataTable
      label={m.step_results()}
      rows={rows}
      columns={columns}
      getRowId={(r) => r.record.id}
      scroll="none"
      initialSort={{ columnId: "file", direction: "asc" }}
      contextMenu={entries}
      empty={<p className="px-3 py-4 text-sm text-muted-foreground">{m.run_results_no_products()}</p>}
    />
  )
}

export function AttachDialog({ open, onOpenChange, defaultFolder, kinds, onAttach }: { open: boolean; onOpenChange: (o: boolean) => void; defaultFolder: string | null; kinds: ResultKind[]; onAttach: (path: string, kind: ResultKind, channel: string | null) => boolean }) {
  const m = useMessages()
  const [path, setPath] = useState("")
  const [kind, setKind] = useState<string>(kinds[0]!)
  const [channel, setChannel] = useState("")
  const pathId = useId()
  const channelId = useId()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (onAttach(path, kind as ResultKind, channel || null)) {
              setPath("")
              setChannel("")
              onOpenChange(false)
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{m.run_results_attach_title()}</DialogTitle>
            <DialogDescription className="flex flex-wrap gap-1">
              <Pill tone="muted">{m.run_results_attached()}</Pill>
              <Pill tone="muted">{m.status_user_linked()}</Pill>
              <Pill tone="muted">{m.run_results_lineage_unknown()}</Pill>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={pathId}>{m.run_results_file_path()}</Label>
            <Input id={pathId} className="font-mono text-xs" value={path} onChange={(e) => setPath(e.target.value)} placeholder={defaultFolder ? `${defaultFolder}/…` : m.run_results_path_placeholder()} autoFocus />
          </div>
          <SelectField label={m.run_col_kind()} value={kind} options={kinds.map((k) => ({ value: k, label: say(m, RESULT_KIND_NAME[k]) }))} onChange={setKind} />
          <div className="grid gap-1.5">
            <Label htmlFor={channelId}>{m.run_results_channel_optional()}</Label>
            <Input id={channelId} value={channel} onChange={(e) => setChannel(e.target.value)} placeholder={m.run_results_channel_placeholder()} />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>{m.verb_cancel()}</DialogClose>
            <Button type="submit" disabled={path.trim() === ""}>
              {m.run_results_attach()}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** "Use as input to a new run": any open Project's subject and rig; the product's rig is shown (D-W56). */
function UseAsInputDialog({ record, onClose, onOutcome }: { record: ResultRecord | null; onClose: () => void; onOutcome: Act }) {
  const m = useMessages()
  const state = useStore((s) => s)
  const navigate = useNavigate()
  const owner = record?.runId ? state.catalog.runs[record.runId] : undefined
  const projects = Object.values(state.catalog.projects).filter((p) => p.state === "open")
  const [projectId, setProjectId] = useState<string | null>(null)
  const [subjectId, setSubjectId] = useState<string | null>(null)
  const [rigId, setRigId] = useState<string | null>(null)
  const project = state.catalog.projects[projectId ?? owner?.projectId ?? projects[0]?.id ?? ""]
  const subjects = project?.subjects.filter((s) => !s.mosaic) ?? []
  const subject = subjects.find((s) => s.id === subjectId) ?? subjects[0]
  const rig = project?.rigIds.includes(rigId ?? "") ? rigId : (project?.rigIds[0] ?? null)
  if (!record || !project) return null
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{m.run_use_named({ name: fileName(record.path) })}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1">
            <Pill tone="muted" icon={Layers}>
              {owner?.name ?? m.run_results_run_group()}
            </Pill>
            <Pill tone="muted">{rigName(m, state.catalog, owner?.rigId ?? null)}</Pill>
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <SelectField
            label={m.run_col_project()}
            value={project.id}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(v) => {
              setProjectId(v)
              setSubjectId(null)
              setRigId(null)
            }}
          />
          {subjects.length > 0 ? (
            <SelectField label={m.run_col_subject()} value={subject!.id} options={subjects.map((s) => ({ value: s.id, label: subjectName(m, state.catalog, s) }))} onChange={setSubjectId} />
          ) : (
            <Refusal action={m.run_results_start_blocked()} reason={m.run_results_mosaic_subjects_only()} blockers={[]} />
          )}
          {rig ? <SelectField label={m.run_col_rig()} value={rig} options={project.rigIds.map((id) => ({ value: id, label: rigName(m, state.catalog, id) }))} onChange={setRigId} /> : null}
          {rig && owner && rig !== owner.rigId ? (
            <span className="flex items-center gap-1">
              <Pill tone="info">{m.run_another_rig()}</Pill>
              <HelpTip label={m.run_another_rig()}>{m.run_one_rig_rule_help()}</HelpTip>
            </span>
          ) : null}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>{m.verb_cancel()}</DialogClose>
          <Button
            disabled={!subject || !rig}
            onClick={() => {
              const r = startRunWithResult(record.id, project.id, subject!.id, rig!)
              if (onOutcome(r, { blocked: m.run_results_start_blocked() }) && r.runId) {
                onClose()
                void navigate({ to: "/projects/$projectId/runs/$runId/$step", params: { projectId: project.id, runId: r.runId, step: "select" } })
              }
            }}
          >
            {m.startrun_title()}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
