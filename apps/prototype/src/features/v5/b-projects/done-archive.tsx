/**
 * S9 Done / Archive sheet on a Done Project (D-W26, D-W43, D-W46, D-W69,
 * D-W70, D-W72, D-W74; PRJ-FR-14, PRJ-FR-15). Each offer is approved on its
 * own and runs as its own operation:
 *
 * - Archive: member sessions transfer to the archive location along the
 *   naming template; sessions a run in another Project not marked Done uses
 *   are kept and named.
 * - Move N rejected frames / processing intermediates / duplicate copies to
 *   the OS Trash, each with its size and its refusals with reasons.
 * - Empty Trash for runs still in the Project's Trash.
 *
 * Nothing moves until the user approves an offer; every item is re-verified
 * immediately before it moves.
 */
import { Link, useNavigate } from "@tanstack/react-router"
import { type ReactNode, useId, useState } from "react"
import { PathText } from "@/components/app/data"
import { Notice } from "@/components/app/feedback"
import { OperationPanel } from "@/components/app/operation-panel"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { closeSheet, useShellUi } from "@/app/ui-state"
import { projectTrash, projectStatus } from "@/domain/derive"
import type { Project, RunId } from "@/domain/types"
import { formatBytes, plural } from "@/lib/format"
import { moveToOsTrash } from "@/store/actions/trash"
import { useStore } from "@/store/core"
import type { DoneApproval } from "@/store/slices/b"
import { startArchiveTransfer } from "./actions"
import { type ArchivePlan, archivePlan, doneOffers, type OfferKind, sessionLabel, type TrashOffer } from "./model"
import { SheetSection } from "./parts"
import { EmptyTrashButton, rememberApproval } from "./trash"

export function DoneArchiveSheet() {
  const { sheet } = useShellUi()
  const open = sheet?.kind === "done-archive"
  const project = useStore((s) => (sheet?.kind === "done-archive" ? s.catalog.projects[sheet.projectId] : undefined))
  return (
    <Sheet open={open} onOpenChange={(next) => !next && closeSheet()}>
      <SheetContent
        side="right"
        className="w-[52rem] gap-0"
        data-sheet="done-archive"
        // Opened by a link or a menu, the invoker is gone: focus returns to the Project's Done / Archive button, else its h1.
        finalFocus={() => document.querySelector<HTMLElement>("[data-done-archive-trigger]") ?? document.querySelector<HTMLElement>("#main h1") ?? true}
      >
        {open && project ? (
          <DoneArchive project={project} />
        ) : open ? (
          <SheetHeader>
            <SheetTitle>Done / Archive</SheetTitle>
            <SheetDescription>This Project no longer exists in the catalog.</SheetDescription>
          </SheetHeader>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

/**
 * An offer's approval, inline in the offer rather than a second dialog over the sheet: the trigger opens the
 * preview (what this will do, what stays) right under it, with Cancel and the confirming action.
 */
function OfferConfirm({ trigger, title, changes, unchanged, confirmLabel, destructive = false, onConfirm }: { trigger: string; title: string; changes: string[]; unchanged: string[]; confirmLabel: string; destructive?: boolean; onConfirm: () => void }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  if (!open) {
    return (
      <Button size="sm" variant={destructive ? "destructive" : "default"} aria-expanded={false} aria-controls={id} onClick={() => setOpen(true)}>
        {trigger}
      </Button>
    )
  }
  return (
    <div id={id} role="group" aria-label={title} className="w-full basis-full space-y-2 rounded-[0.3125rem] border border-separator bg-muted/40 p-3 text-sm">
      <p className="font-medium">{title}</p>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <p className="text-xs font-medium text-muted-foreground">This will</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs">
            {changes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
        <div>
          <p className="text-xs font-medium text-muted-foreground">Unchanged</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
            {unchanged.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
        </div>
      </div>
      <div className="flex justify-end gap-1.5">
        <Button size="sm" variant="outline" onClick={() => setOpen(false)}>
          Cancel
        </Button>
        <Button
          size="sm"
          variant={destructive ? "destructive" : "default"}
          onClick={() => {
            onConfirm()
            setOpen(false)
          }}
        >
          {confirmLabel}
        </Button>
      </div>
    </div>
  )
}

const OFFER_COPY: Record<OfferKind, { description: string; unchanged: string[] }> = {
  "rejected-frames": {
    description: "The Project's candidate frames whose library quality is Unusable. Frames rejected for this Project only never enter. Every copy of a frame moves, or none.",
    unchanged: ["Frames rejected for this Project only", "Usable and Unreviewed frames", "The Trashed records, kept for traceability; Put back plus a rescan restores them as Unusable"],
  },
  intermediates: {
    description: "Recognized processing intermediates in the Results of the Project's runs, plus an adopted master's generated source. Accepted Results and library masters stay.",
    unchanged: ["Accepted Results and final images", "Adopted and candidate masters in the library"],
  },
  "duplicate-copies": {
    description: "Byte-identical extra copies of the Project's frames. Each frame keeps its Captures copy, otherwise the earliest-registered one.",
    unchanged: ["One copy of every frame, named per item", "Each frame's record, quality and memberships"],
  },
}

function DoneArchive({ project }: { project: Project }) {
  const navigate = useNavigate()
  const status = projectStatus(project)
  return (
    <>
      <SheetHeader className="border-b border-separator">
        <SheetTitle className="flex flex-wrap items-center gap-2">
          Done / Archive: {project.name}
          <StatusBadge kind="project" value={status} />
        </SheetTitle>
        <SheetDescription>Each offer is approved on its own and runs as its own operation. Nothing moves until you approve it, and nothing is deleted permanently.</SheetDescription>
      </SheetHeader>
      <div className="min-h-0 flex-1 overflow-y-auto text-sm">
        {project.state === "open" ? (
          <div className="p-4">
            <Notice
              tone="refusal"
              title="This Project is open"
              actions={
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    closeSheet()
                    void navigate({ to: "/projects/$projectId", params: { projectId: project.id } })
                  }}
                >
                  Open {project.name}
                </Button>
              }
            >
              Archive and the trash offers follow Done. Mark the Project Done first: it names any run that is not Complete.
            </Notice>
            {project.archive ? <ArchivedNote project={project} /> : null}
          </div>
        ) : (
          <DoneOffers project={project} />
        )}
      </div>
      <SheetFooter className="border-t border-separator">
        <div className="flex justify-end">
          <Button variant="outline" onClick={closeSheet}>
            Close
          </Button>
        </div>
      </SheetFooter>
    </>
  )
}

function ArchivedNote({ project }: { project: Project }) {
  return (
    <p className="mt-3 text-xs text-muted-foreground">
      {plural(project.archive?.sessionIds.length ?? 0, "session")} of this Project show as Archived until restored from the Project page.
    </p>
  )
}

function DoneOffers({ project }: { project: Project }) {
  const offers = useStore((s) => doneOffers(s, project))
  const plan = useStore((s) => archivePlan(s, project))
  const approvals = useStore((s) => s.slices.b.approvals[project.id] ?? {})
  const trash = useStore((s) => projectTrash(s.catalog, project.id))
  return (
    <>
      <ArchiveOffer project={project} plan={plan} operationId={approvals.archive ?? null} />
      {(["rejected-frames", "intermediates", "duplicate-copies"] as const).map((kind) => (
        <TrashOfferSection key={kind} project={project} offer={offers[kind]} operationId={approvals[kind] ?? null} />
      ))}
      <EmptyTrashOffer project={project} runIds={trash.map((r) => r.id)} names={trash.map((r) => r.name)} operationId={approvals["empty-trash"] ?? null} />
    </>
  )
}

function ApprovalProgress({ operationId }: { operationId: string | null }) {
  return operationId ? <OperationPanel operationId={operationId} headingLevel={4} itemLimit={6} /> : null
}

/** A capped list with "Show all", so long offers stay scannable. */
function ItemList<T>({ items, render, label, limit = 6 }: { items: T[]; render: (item: T) => ReactNode; label: string; limit?: number }) {
  const [all, setAll] = useState(false)
  if (items.length === 0) return null
  const shown = all ? items : items.slice(0, limit)
  return (
    <div>
      <ul aria-label={label} className="divide-y divide-separator rounded-[0.3125rem] border border-separator">
        {shown.map(render)}
      </ul>
      {items.length > limit ? (
        <Button size="sm" variant="ghost" onClick={() => setAll((v) => !v)}>
          {all ? "Show fewer" : `Show all ${items.length}`}
        </Button>
      ) : null}
    </div>
  )
}

function ArchiveOffer({ project, plan, operationId }: { project: Project; plan: ArchivePlan; operationId: string | null }) {
  const catalog = useStore((s) => s.catalog)
  const nothing = plan.rows.length === 0
  const title = nothing ? "Archive" : `Archive ${plural(plan.rows.length, "session")} (${formatBytes(plan.sizeBytes)})`
  return (
    <SheetSection
      title={title}
      description="Member sessions transfer to the archive location along the naming templates; a session another open Project's run uses stays at its path."
      actions={
        !nothing && !plan.blocked ? (
          <OfferConfirm
            trigger="Archive…"
            title={`Archive ${plural(plan.rows.length, "session")} of ${project.name} to ${plan.destination?.displayName ?? "the archive"} on ${plan.volume?.name ?? "its volume"}?`}
            changes={[
              `Transfers ${plural(plan.rows.length, "session")} (${plural(plan.rows.reduce((n, r) => n + r.moves.length, 0), "frame")}, ${formatBytes(plan.sizeBytes)}) to ${plan.destination?.path ?? "the archive"} along the naming template`,
              "Verifies every frame's SHA-256 before it moves; a session moves whole or stays",
              "Rebuilds prepared links that point at a moved frame",
            ]}
            unchanged={[
              ...plan.kept.map((k) => `${sessionLabel(catalog, k.session)}: kept, ${k.projects.join(", ")} uses it`),
              "Run membership and totals in every Project",
            ]}
            confirmLabel="Archive"
            onConfirm={() => rememberApproval(project.id, "archive", startArchiveTransfer(project.id, plan.rows, "archive"))}
          />
        ) : null
      }
    >
      {plan.destination && plan.volume ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          Destination {plan.destination.displayName} · <span className="font-mono">{plan.destination.path}</span> on {plan.volume.name} (volume {plan.volume.volumeUuid}) ·{" "}
          {plan.volume.mounted ? (plan.volume.writable ? "writable" : "read-only") : "not mounted"} · {formatBytes(plan.freeBytes)} free
        </p>
      ) : null}
      {plan.blocked && !nothing ? <Notice tone="refusal" title="Archive refused">{plan.blocked}</Notice> : null}
      {nothing && plan.kept.length === 0 && plan.refused.length === 0 ? (
        <p className="text-muted-foreground">{project.archive ? "Every member session is archived." : "No member session to archive."}</p>
      ) : null}
      <ItemList
        label="Sessions to archive"
        items={plan.rows}
        render={(row) => (
          <li key={row.session.id} className="px-2 py-1">
            <div className="flex flex-wrap justify-between gap-x-3">
              <span className="font-medium">{sessionLabel(catalog, row.session)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">
                {plural(row.moves.length, "frame")} · {formatBytes(row.sizeBytes)}
              </span>
            </div>
            <PathText path={`→ ${row.folder}/`} className="text-muted-foreground" />
          </li>
        )}
      />
      <Refusals
        title="Kept"
        items={plan.kept.map((k) => ({ key: k.session.id, label: sessionLabel(catalog, k.session), reason: `${k.projects.join(", ")} uses it in a run and is not Done` }))}
      />
      <Refusals title="Refused" items={plan.refused.map((r) => ({ key: r.session.id, label: sessionLabel(catalog, r.session), reason: r.reason }))} />
      <ApprovalProgress operationId={operationId} />
    </SheetSection>
  )
}

function Refusals({ title, items }: { title: string; items: Array<{ key: string; label: string; reason: string; path?: string | null }> }) {
  if (items.length === 0) return null
  return (
    <div className="space-y-1">
      <h4 className="text-xs font-medium text-muted-foreground">
        {title} ({items.length})
      </h4>
      <ItemList
        label={title}
        items={items}
        render={(item) => (
          <li key={item.key} className="px-2 py-1">
            <span className="font-medium">{item.label}</span>
            <span className="block text-xs text-warning">{item.reason}</span>
          </li>
        )}
      />
    </div>
  )
}

function TrashOfferSection({ project, offer, operationId }: { project: Project; offer: TrashOffer; operationId: string | null }) {
  const copy = OFFER_COPY[offer.kind]
  return (
    <SheetSection
      title={offer.title}
      description={copy.description}
      actions={
        offer.count > 0 ? (
          <OfferConfirm
            trigger="Move to Trash…"
            destructive
            title={`${offer.title} from ${project.name}? Files go to the OS Trash only.`}
            changes={[
              `Moves ${offer.count === 1 ? "1 item" : `${offer.count} items`} (${plural(offer.items.length, "file")}, ${formatBytes(offer.sizeBytes)} reclaimed) to the OS Trash`,
              "Re-verifies each item immediately before it moves; a refused item stays in place with its reason",
              ...(offer.refusals.length > 0 ? [`Leaves the ${plural(offer.refusals.length, "refused item")} listed below in place`] : []),
            ]}
            unchanged={[...copy.unchanged, "Nothing is deleted permanently"]}
            confirmLabel="Move to Trash"
            onConfirm={() => {
              const approval: DoneApproval = offer.kind
              rememberApproval(project.id, approval, moveToOsTrash({ kind: offer.kind, title: offer.title, projectId: project.id, runIds: [], items: offer.items, href: `/projects/${project.id}` }))
            }}
          />
        ) : null
      }
    >
      {offer.count === 0 && offer.refusals.length === 0 ? <p className="text-muted-foreground">Nothing to move.</p> : null}
      {offer.kind !== "intermediates" && offer.count > 0 ? <p className="text-xs text-muted-foreground">Size is the expected reclaim and leaves out bytes another hard link still holds.</p> : null}
      <ItemList
        label={`Items in: ${offer.title}`}
        items={offer.entries}
        render={(entry) => (
          <li key={entry.key} className="px-2 py-1">
            <div className="flex flex-wrap justify-between gap-x-3">
              <span className="font-medium">{entry.label}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{formatBytes(entry.sizeBytes)}</span>
            </div>
            {entry.detail ? <span className="block text-xs text-muted-foreground">{entry.detail}</span> : null}
            <PathText path={entry.path} className="text-muted-foreground" />
          </li>
        )}
      />
      <Refusals title="Refused" items={offer.refusals} />
      <ApprovalProgress operationId={operationId} />
    </SheetSection>
  )
}

function EmptyTrashOffer({ project, runIds, names, operationId }: { project: Project; runIds: RunId[]; names: string[]; operationId: string | null }) {
  const [ticked, setTicked] = useState<RunId[]>([])
  if (runIds.length === 0 && !operationId) return null
  return (
    <SheetSection
      title={runIds.length > 0 ? `Empty Trash (${plural(runIds.length, "run")})` : "Empty Trash"}
      description="Runs in the Project's Trash: their records go, and their prepared folders and, when ticked, their Results folders go to the OS Trash."
      actions={runIds.length > 0 ? <EmptyTrashButton projectId={project.id} runIds={runIds} ticked={ticked} label="Empty Trash…" /> : null}
    >
      {runIds.length === 0 ? <p className="text-muted-foreground">The Trash is empty.</p> : null}
      <ul className="space-y-1">
        {runIds.map((id, index) => (
          <li key={id} className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">{names[index]}</span>
            <label className="inline-flex items-center gap-2 text-xs">
              <Checkbox checked={ticked.includes(id)} onCheckedChange={(checked) => setTicked((list) => (checked ? [...list, id] : list.filter((r) => r !== id)))} />
              Also trash its Results folder
            </label>
          </li>
        ))}
      </ul>
      {runIds.length > 0 ? (
        <p className="text-xs text-muted-foreground">
          Restore a run instead from the{" "}
          <Link to="/projects/$projectId/trash" params={{ projectId: project.id }} onClick={closeSheet} className="text-link underline-offset-2 hover:underline">
            Project&apos;s Trash
          </Link>
          .
        </p>
      ) : null}
      <ApprovalProgress operationId={operationId} />
    </SheetSection>
  )
}
