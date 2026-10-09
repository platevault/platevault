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
import { RESULT_KIND_LABEL } from "@/domain/labels"
import type { Project, ResultKind, ResultRecord } from "@/domain/types"
import { SelectField } from "@/features/t3/fields"
import { fileName, formatBytes, plural } from "@/lib/format"
import { useStore } from "@/store/core"
import { acceptResult, attachResult, discoverResults, finishWriting, inspectResult, setResultKind, simulateApplicationOutput, startRunWithResult } from "./actions"
import { MasterOffers } from "./calibrate-step"
import { type ResultRow, type RunContext, resultRow, resultsFolders, runLayout } from "./model"
import { OutcomeNotice, PrototypeMenu, RowActions, Sha, useOutcome } from "./parts"

type Act = ReturnType<typeof useOutcome>["act"]

const KIND_OPTIONS = (["linear-integration", "channel-product", "final-image", "mosaic-panel"] as ResultKind[]).map((k) => ({ value: k, label: RESULT_KIND_LABEL[k] }))

/** Wrap up on the Project page (P-WRAP1): where intermediates and prepared folders leave, once every run is Complete. */
export function WrapUpLink({ project }: { project: Project }) {
  const available = useStore((s) => projectWrapUp(s.catalog, project).available)
  if (!available) return null
  return (
    <Pill tone="info" icon={PackageCheck} link={{ to: "/projects/$projectId", params: { projectId: project.id }, search: { stage: "wrap-up" } }}>
      Wrap up
    </Pill>
  )
}

export function ResultsStep({ ctx }: { ctx: RunContext }) {
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
    outcome.act(r, { title: r.found > 0 ? `${plural(r.found, "new file")} found` : "Nothing new", tone: "info" })
  }
  return (
    <div className="space-y-4">
      <OutcomeNotice outcome={outcome.outcome} onDismiss={outcome.clear} />
      <Box
        id="results-folder"
        level={2}
        title="Results folder"
        actions={
          <>
            <PrototypeMenu actions={[{ label: "The application writes outputs", detail: "A stack per channel, a file still being written, two intermediates and a master dark.", run: () => outcome.act(simulateApplicationOutput({ runId: run.id })) }]} />
            <Button size="xs" variant="outline" disabled={folders.length === 0 || run.trashedAt !== null} onClick={lookAgain}>
              <FolderSearch aria-hidden="true" data-icon="inline-start" />
              Look again
            </Button>
            <Button size="xs" variant="outline" disabled={run.trashedAt !== null} onClick={() => setAttaching(true)}>
              <Paperclip aria-hidden="true" data-icon="inline-start" />
              Attach…
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
            <Pill tone="muted">Not prepared</Pill>
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
            Products <CountBadge count={products.length} label={plural(products.length, "product")} />
            <HelpTip label="Products">Never accepted by itself; Accept binds the current bytes.</HelpTip>
          </span>
        }
      >
        <ResultsTable rows={products} rigId={run.rigId} onOutcome={outcome.act} onUse={setUsing} kindOptions={KIND_OPTIONS} />
      </Box>

      <Box
        id="results-intermediates"
        level={2}
        title={
          <span className="flex items-center gap-1.5">
            Intermediates <CountBadge count={intermediates.length} label={plural(intermediates.length, "intermediate")} />
          </span>
        }
        actions={intermediates.length > 0 ? <WrapUpLink project={project} /> : null}
      >
        {intermediates.length === 0 ? (
          <p className="text-sm text-muted-foreground">None</p>
        ) : (
          <details className="text-[0.75rem]">
            <summary className="cursor-default">
              {plural(intermediates.length, "file")} · {formatBytes(intermediates.reduce((n, r) => n + (r.file?.sizeBytes ?? 0), 0))}
            </summary>
            <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto font-mono">
              {intermediates.map((r) => (
                <li key={r.record.id}>{r.record.path.slice((folders[0] ?? "").length + 1)}</li>
              ))}
            </ul>
          </details>
        )}
      </Box>

      <AttachDialog open={attaching} onOpenChange={setAttaching} defaultFolder={folders[0] ?? null} kindOptions={KIND_OPTIONS} onAttach={(path, kind, channel) => outcome.act(attachResult({ runId: run.id }, path, kind, channel))} />
      <UseAsInputDialog record={using} onClose={() => setUsing(null)} onOutcome={outcome.act} />
    </div>
  )
}

const BASIS_NOTE = { tool: "Tool evidence", window: "Inferred from the time window", unknown: "No evidence" } as const

export function attributionCell(r: ResultRow) {
  return (
    <span className="inline-flex items-center gap-1">
      <span>{r.attribution.label}</span>
      <NoteMarker label={`${fileName(r.record.path)} attribution`}>{r.record.discovered === "attached" && r.attribution.basis === "unknown" ? "Attached · no evidence" : BASIS_NOTE[r.attribution.basis]}</NoteMarker>
    </span>
  )
}

/** Copy a path to the clipboard (the row menu's Copy path). */
function copyPath(path: string) {
  void navigator.clipboard?.writeText(path).catch(() => {})
}

export function ResultsTable({ rows, onOutcome, onUse, kindOptions }: { rows: ResultRow[]; rigId: string; onOutcome: Act; onUse?: (r: ResultRecord) => void; kindOptions: Array<{ value: string; label: string }> }) {
  const entries = (r: ResultRow): MenuEntry[] => {
    const name = fileName(r.record.path)
    const candidate = r.record.acceptance === "candidate"
    return [
      { heading: name },
      ...(candidate ? [{ label: "Accept", icon: Check, onSelect: () => onOutcome(acceptResult(r.record.id)) }] : []),
      ...(!candidate && onUse ? [{ label: "Use as input…", icon: Play, onSelect: () => onUse(r.record) }] : []),
      ...(r.changed && !r.pending ? [{ label: "Inspect again", icon: ScanSearch, onSelect: () => onOutcome(inspectResult(r.record.id)) }] : []),
      ...(candidate && !r.record.kind ? [{ separator: true } as const, ...kindOptions.map((k) => ({ label: `Kind: ${k.label}`, onSelect: () => onOutcome(setResultKind(r.record.id, k.value as ResultKind)) }))] : []),
      { separator: true },
      { label: "Copy path", icon: Copy, onSelect: () => copyPath(r.record.path) },
      ...(r.pending ? [{ label: "Prototype: finish writing", icon: FlaskConical, onSelect: () => onOutcome(finishWriting(r.record.id)) }] : []),
    ]
  }
  const columns: Column<ResultRow>[] = [
    {
      id: "file",
      header: "File",
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
      header: "Kind",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          {r.record.kind ? <span>{RESULT_KIND_LABEL[r.record.kind]}</span> : <Pill tone="warning">{r.record.acceptance === "candidate" ? "Kind?" : "Unknown kind"}</Pill>}
          {r.record.channel ? <Pill tone="neutral">{r.record.channel}</Pill> : null}
        </span>
      ),
    },
    {
      id: "state",
      header: "State",
      cell: (r) => (
        <span className="flex flex-wrap items-center gap-1">
          {r.pending ? <StatusBadge kind="processing" value="pending" label="Pending" /> : !r.readable ? <StatusBadge kind="availability" value="absent" label="Unreadable" /> : <StatusBadge kind="acceptance" value={r.record.acceptance} />}
          {r.changed && !r.pending ? <StatusBadge kind="content" value="drifted" label={r.record.acceptance === "accepted" ? "Drifted" : "Changed"} /> : null}
        </span>
      ),
    },
    {
      id: "rev",
      header: "Revision",
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
            <Button size="xs" onClick={() => onOutcome(acceptResult(r.record.id))} aria-label={`Accept ${fileName(r.record.path)}`}>
              Accept
            </Button>
          ) : null}
          <RowActions entries={entries(r)} label={`Actions for ${fileName(r.record.path)}`} />
        </span>
      ),
    },
  ]
  return (
    <DataTable
      label="Results"
      rows={rows}
      columns={columns}
      getRowId={(r) => r.record.id}
      scroll="none"
      initialSort={{ columnId: "file", direction: "asc" }}
      contextMenu={entries}
      empty={<p className="px-3 py-4 text-sm text-muted-foreground">No products yet</p>}
    />
  )
}

export function AttachDialog({ open, onOpenChange, defaultFolder, kindOptions, onAttach }: { open: boolean; onOpenChange: (o: boolean) => void; defaultFolder: string | null; kindOptions: Array<{ value: string; label: string }>; onAttach: (path: string, kind: ResultKind, channel: string | null) => boolean }) {
  const [path, setPath] = useState("")
  const [kind, setKind] = useState(kindOptions[0]!.value)
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
            <DialogTitle>Attach a Result</DialogTitle>
            <DialogDescription className="flex flex-wrap gap-1">
              <Pill tone="muted">Attached</Pill>
              <Pill tone="muted">User-linked</Pill>
              <Pill tone="muted">Lineage unknown</Pill>
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-1.5">
            <Label htmlFor={pathId}>File path</Label>
            <Input id={pathId} className="font-mono text-xs" value={path} onChange={(e) => setPath(e.target.value)} placeholder={defaultFolder ? `${defaultFolder}/…` : "/Volumes/…"} autoFocus />
          </div>
          <SelectField label="Kind" value={kind} options={kindOptions} onChange={setKind} />
          <div className="grid gap-1.5">
            <Label htmlFor={channelId}>Channel (optional)</Label>
            <Input id={channelId} value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="Ha" />
          </div>
          <DialogFooter>
            <DialogClose render={<Button type="button" variant="outline" />}>Cancel</DialogClose>
            <Button type="submit" disabled={path.trim() === ""}>
              Attach
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** "Use as input to a new run": any open Project's subject and rig; the product's rig is shown (D-W56). */
function UseAsInputDialog({ record, onClose, onOutcome }: { record: ResultRecord | null; onClose: () => void; onOutcome: Act }) {
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
          <DialogTitle>Use {fileName(record.path)}</DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-1">
            <Pill tone="muted" icon={Layers}>
              {owner?.name ?? "Run group"}
            </Pill>
            <Pill tone="muted">{rigName(state.catalog, owner?.rigId ?? null)}</Pill>
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <SelectField
            label="Project"
            value={project.id}
            options={projects.map((p) => ({ value: p.id, label: p.name }))}
            onChange={(v) => {
              setProjectId(v)
              setSubjectId(null)
              setRigId(null)
            }}
          />
          {subjects.length > 0 ? (
            <SelectField label="Subject" value={subject!.id} options={subjects.map((s) => ({ value: s.id, label: subjectName(state.catalog, s) }))} onChange={setSubjectId} />
          ) : (
            <Refusal action="Start blocked" reason="mosaic subjects only" blockers={[]} />
          )}
          {rig ? <SelectField label="Rig" value={rig} options={project.rigIds.map((id) => ({ value: id, label: rigName(state.catalog, id) }))} onChange={setRigId} /> : null}
          {rig && owner && rig !== owner.rigId ? (
            <span className="flex items-center gap-1">
              <Pill tone="info">Another rig</Pill>
              <HelpTip label="Another rig">The one-rig rule covers raw frames only.</HelpTip>
            </span>
          ) : null}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button
            disabled={!subject || !rig}
            onClick={() => {
              const r = startRunWithResult(record.id, project.id, subject!.id, rig!)
              if (onOutcome(r) && r.runId) {
                onClose()
                void navigate({ to: "/projects/$projectId/runs/$runId/$step", params: { projectId: project.id, runId: r.runId, step: "select" } })
              }
            }}
          >
            Start run
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
