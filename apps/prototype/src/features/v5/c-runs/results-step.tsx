/**
 * S5 Results: candidates discovered only in the recorded Results folder,
 * Pending while a file is still being written, intermediates listed apart;
 * attribution to a prepared revision (tool evidence, the time window as an
 * inference, or Unknown); Attach (User-linked); Accept, bound to the current
 * bytes; and "Use as input to a new run" with the product's rig (D-W4, D-W55,
 * D-W56, D-W67, RES-FR-01 to RES-FR-05).
 */
import { useNavigate } from "@tanstack/react-router"
import { ChevronDown, FolderSearch, Paperclip } from "lucide-react"
import { useEffect, useId, useState } from "react"
import { Notice } from "@/components/app/feedback"
import { type Column, DataTable } from "@/components/app/data-table"
import { Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { rigName, runPreparations, subjectName } from "@/domain/derive"
import { RESULT_KIND_LABEL } from "@/domain/labels"
import type { ResultKind, ResultRecord } from "@/domain/types"
import { fileName, formatBytes, plural } from "@/lib/format"
import { SelectField } from "@/features/t3/fields"
import { useStore } from "@/store/core"
import { acceptResult, attachResult, discoverResults, finishWriting, inspectResult, setResultKind, simulateApplicationOutput, startRunWithResult } from "./actions"
import { MasterOffers } from "./calibrate-step"
import { type ResultRow, type RunContext, resultRow, resultsFolders, runLayout } from "./model"
import { OutcomeNotice, PrototypeMenu, Sha, useOutcome } from "./parts"

type Act = ReturnType<typeof useOutcome>["act"]

const KIND_OPTIONS = (["linear-integration", "channel-product", "final-image", "mosaic-panel"] as ResultKind[]).map((k) => ({ value: k, label: RESULT_KIND_LABEL[k] }))

export function ResultsStep({ ctx }: { ctx: RunContext }) {
  const state = useStore((s) => s)
  const { run } = ctx
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
  return (
    <div className="space-y-6">
      <OutcomeNotice outcome={outcome.outcome} onDismiss={outcome.clear} />
      <section aria-labelledby="results-folder" className="flex flex-wrap items-start justify-between gap-3 border-b border-separator pb-3">
        <div className="min-w-0 space-y-0.5">
          <h2 id="results-folder" className="text-[0.75rem] font-medium text-muted-foreground">
            Results folder
          </h2>
          {folders.length > 0 ? (
            folders.map((f) => (
              <p key={f} className="font-mono text-xs [overflow-wrap:anywhere]">
                {f}/
              </p>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">Recorded at the first preparation{proposed ? `: ${proposed}/` : ""}. Nothing is looked for elsewhere.</p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <PrototypeMenu actions={[{ label: "The application writes outputs", detail: "A stack per channel, a file still being written, two intermediates and a master dark.", run: () => outcome.act(simulateApplicationOutput({ runId: run.id })) }]} />
          <Button size="sm" variant="outline" disabled={folders.length === 0 || run.trashedAt !== null} onClick={() => {
            const r = discoverResults({ runId: run.id })
            outcome.act(r, { title: r.found > 0 ? `${plural(r.found, "new file")} found` : "Nothing new in the Results folder", reasons: [r.found > 0 ? "Listed as candidates or intermediates; none is accepted." : "Every file there is already listed."], tone: "info" })
          }}>
            <FolderSearch aria-hidden="true" data-icon="inline-start" />
            Look again
          </Button>
          <Button size="sm" variant="outline" disabled={run.trashedAt !== null} onClick={() => setAttaching(true)}>
            <Paperclip aria-hidden="true" data-icon="inline-start" />
            Attach Result…
          </Button>
        </div>
      </section>

      <MasterOffers run={run} onOutcome={outcome.act} />

      <Section title="Candidates and accepted products" id="results-products" description="A file in the folder is never accepted by itself, and never proof that it came from the full selection.">
        <ResultsTable rows={products} rigId={run.rigId} onOutcome={outcome.act} onUse={setUsing} kindOptions={KIND_OPTIONS} />
      </Section>

      <Section title="Intermediates" id="results-intermediates" description="Calibrated and registered frames the application left behind. They are never candidates and reach the OS Trash only through the Project's Done / Archive sheet.">
        {intermediates.length === 0 ? (
          <p className="text-sm text-muted-foreground">No intermediates found.</p>
        ) : (
          <details className="rounded-md border px-3 py-1.5 text-[0.75rem]">
            <summary className="cursor-default">
              {plural(intermediates.length, "intermediate")} · {formatBytes(intermediates.reduce((n, r) => n + (r.file?.sizeBytes ?? 0), 0))}
            </summary>
            <ul className="mt-1 max-h-48 space-y-0.5 overflow-y-auto font-mono">
              {intermediates.map((r) => (
                <li key={r.record.id}>{r.record.path.slice((folders[0] ?? "").length + 1)}</li>
              ))}
            </ul>
          </details>
        )}
      </Section>

      <AttachDialog open={attaching} onOpenChange={setAttaching} defaultFolder={folders[0] ?? null} kindOptions={KIND_OPTIONS} onAttach={(path, kind, channel) => outcome.act(attachResult({ runId: run.id }, path, kind, channel))} />
      <UseAsInputDialog record={using} onClose={() => setUsing(null)} onOutcome={outcome.act} />
    </div>
  )
}

export function attributionCell(r: ResultRow) {
  return (
    <span className="flex flex-col">
      <span>{r.attribution.label}</span>
      <span className="text-[0.6875rem] text-muted-foreground">{r.attribution.basis === "tool" ? "Tool evidence" : r.attribution.basis === "window" ? "Inferred from the time window" : r.record.discovered === "attached" ? "Attached; no evidence" : "No evidence"}</span>
    </span>
  )
}

export function ResultsTable({ rows, rigId, onOutcome, onUse, kindOptions }: { rows: ResultRow[]; rigId: string; onOutcome: Act; onUse?: (r: ResultRecord) => void; kindOptions: Array<{ value: string; label: string }> }) {
  const catalog = useStore((s) => s.catalog)
  const columns: Column<ResultRow>[] = [
    {
      id: "file",
      header: "File · inspected bytes",
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
      header: "Kind · channel",
      cell: (r) => (
        <span className="flex flex-col">
          {r.record.kind ? (
            <span>{RESULT_KIND_LABEL[r.record.kind]}</span>
          ) : r.record.acceptance === "candidate" ? (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button size="xs" variant="outline" className="w-fit" aria-label={`Choose the kind of ${fileName(r.record.path)}`} />}>
                Choose kind
                <ChevronDown aria-hidden="true" data-icon="inline-end" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {kindOptions.map((k) => (
                  <DropdownMenuItem key={k.value} onClick={() => onOutcome(setResultKind(r.record.id, k.value as ResultKind))}>
                    {k.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <span>Unknown kind</span>
          )}
          <span className="text-[0.6875rem] text-muted-foreground">{r.record.channel ?? "No channel"}</span>
        </span>
      ),
    },
    {
      id: "state",
      header: "State",
      cell: (r) => (
        <span className="flex flex-col gap-0.5">
          {r.pending ? <StatusBadge kind="processing" value="pending" label="Pending: still being written" /> : !r.readable ? <StatusBadge kind="availability" value="absent" label="Cannot be read now" /> : <StatusBadge kind="acceptance" value={r.record.acceptance} />}
          {r.changed && !r.pending ? <StatusBadge kind="content" value="drifted" label={r.record.acceptance === "accepted" ? "Drifted since acceptance" : "Changed since inspection"} /> : null}
        </span>
      ),
    },
    {
      id: "rev",
      header: "Revision · association",
      cell: (r) => (
        <span className="flex flex-col gap-0.5">
          {attributionCell(r)}
          <StatusBadge kind="lineage" value={r.record.association} />
        </span>
      ),
    },
    {
      id: "actions",
      header: "",
      cell: (r) => (
        <span className="flex flex-col items-end gap-1">
          {r.pending ? (
            <Button size="xs" variant="ghost" onClick={() => onOutcome(finishWriting(r.record.id))} title="Prototype: the application finishes writing this file">
              Prototype: finish writing
            </Button>
          ) : null}
          {r.changed && !r.pending ? (
            <Button size="xs" variant="outline" onClick={() => onOutcome(inspectResult(r.record.id))}>
              Inspect again
            </Button>
          ) : null}
          {r.record.acceptance === "candidate" ? (
            <Button size="xs" onClick={() => onOutcome(acceptResult(r.record.id))} aria-label={`Accept ${fileName(r.record.path)}`}>
              Accept
            </Button>
          ) : onUse ? (
            <Button size="xs" variant="outline" onClick={() => onUse(r.record)}>
              Use as input…
            </Button>
          ) : null}
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
      empty={<p className="px-3 py-6 text-sm text-muted-foreground">No products yet. Process in {Object.values(catalog.profiles)[0]?.name.split(" /")[0] ?? "the application"} into the Results folder, then Look again; or attach a file saved elsewhere. Rig: {rigName(catalog, rigId)}.</p>}
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
            <DialogDescription>For a product saved outside the Results folder. It is labelled Attached, User-linked, with lineage Unknown; it never claims every planned frame was used.</DialogDescription>
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
          <DialogTitle>Use {fileName(record.path)} as an input</DialogTitle>
          <DialogDescription>
            Starts a run with this product as an input. The product comes from {owner?.name ?? "a run group"} on <span className="text-foreground">{rigName(state.catalog, owner?.rigId ?? null)}</span>.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3">
          <SelectField label="Project" value={project.id} options={projects.map((p) => ({ value: p.id, label: p.name }))} onChange={(v) => { setProjectId(v); setSubjectId(null); setRigId(null) }} />
          {subjects.length > 0 ? (
            <SelectField label="Subject" value={subject!.id} options={subjects.map((s) => ({ value: s.id, label: subjectName(state.catalog, s) }))} onChange={setSubjectId} description={project.subjects.some((s) => s.mosaic) ? "A mosaic subject starts a run group; add the product in a panel run's Select step instead." : undefined} />
          ) : (
            <Notice tone="info" title="No Target subject">This Project has only mosaic subjects; add the product in a panel run's Select step.</Notice>
          )}
          {rig ? <SelectField label="Rig of the new run" value={rig} options={project.rigIds.map((id) => ({ value: id, label: rigName(state.catalog, id) }))} onChange={setRigId} /> : null}
          {rig && owner && rig !== owner.rigId ? (
            <p className="text-[0.75rem] text-muted-foreground">The new run is on another rig than the product. Results from another rig may be inputs; the one-rig rule applies to raw frames only.</p>
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
            Start run with this input
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
