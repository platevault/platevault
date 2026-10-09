/**
 * Slice A shared pieces: Add to Project with its preview (D-W59: it also adds
 * the session's rig), the same choice as context-menu entries, Create Project
 * prefilled from a session, Confirm Target / Confirm rig, and the terse
 * refusal for a failed write. Used by Home, Sessions and the session detail.
 */
import { ChevronDown, FolderInput, FolderPlus } from "lucide-react"
import { useId, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { announce } from "@/components/app/feedback"
import { Refusal, type RefusalProps, refusalFrom } from "@/components/app/refusal"
import type { MenuEntry } from "@/components/app/row-menu"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { openSheet } from "@/app/ui-state"
import { projectCandidates, rigName, sessionRigId, sessionTargetId } from "@/domain/derive"
import { sessionLabel } from "@/domain/membership"
import type { Catalog, OpticalTrainId, Project, ProjectId, SessionId, TargetId } from "@/domain/types"
import { addSessionToProject } from "@/store/actions/projects"
import { confirmRig, confirmTarget } from "@/store/actions/library"
import { type CommitResult, useStore } from "@/store/core"

/** "Added 2 Oct Ha to Heart and Soul", with the added rig when there is one. */
export type AddedNotice = { title: string; note: string | null }

/** A session waiting for the Add to Project preview. */
export type PendingAdd = { sessionId: SessionId; projectId: ProjectId }

/** A failed write as a terse refusal: its reasons as chips, else its message. Null when it succeeded. */
export function refusalOf(result: CommitResult, action: string): RefusalProps | null {
  if (result.ok) return null
  return refusalFrom(result, action) ?? { action, reason: result.message, blockers: [] }
}

/** Open Projects a session can join: not those that already consider it a candidate. */
function openProjects(catalog: Catalog, sessionId: SessionId): Project[] {
  return Object.values(catalog.projects)
    .filter((p) => p.state === "open" && !projectCandidates(catalog, p).some((c) => c.session.id === sessionId))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Add to Project as context-menu entries: one per open Project, then Create Project. */
export function addToProjectEntries(catalog: Catalog, sessionId: SessionId, onPick: (pending: PendingAdd) => void): MenuEntry[] {
  return [
    { heading: "Add to Project" },
    ...openProjects(catalog, sessionId).map((p) => ({ label: p.name, icon: FolderInput, onSelect: () => onPick({ sessionId, projectId: p.id }) })),
    { label: "Create Project…", icon: FolderPlus, onSelect: () => openSheet({ kind: "new-project", fromSessionId: sessionId }) },
  ]
}

/** The Add to Project preview; `pending` null keeps it closed. */
export function AddToProjectDialog({ pending, onClose, onAdded }: { pending: PendingAdd | null; onClose: () => void; onAdded?: (notice: AddedNotice) => void }) {
  const catalog = useStore((s) => s.catalog)
  const session = pending ? catalog.sessions[pending.sessionId] : undefined
  const project = pending ? catalog.projects[pending.projectId] : undefined
  const targetId = session ? sessionTargetId(session) : null
  const rigId = session ? sessionRigId(session) : null
  const targetName = targetId ? (catalog.targets[targetId]?.name ?? targetId) : null
  const label = session ? sessionLabel(session) : "Session"
  const changes =
    project && session
      ? [
          ...(targetName && !project.subjects.some((s) => s.targetId === targetId) ? [`Adds subject ${targetName}, with the Project's goals`] : []),
          ...(rigId && !project.rigIds.includes(rigId) ? [`Adds rig ${rigName(catalog, rigId)}`] : []),
          `${label} becomes a candidate`,
        ]
      : []
  return (
    <ConfirmDialog
      open={pending !== null && project !== undefined}
      onOpenChange={(open) => !open && onClose()}
      title={project ? `Add ${label} to ${project.name}?` : "Add to Project"}
      description={targetName ? `${targetName} · ${rigId ? rigName(catalog, rigId) : "no rig"}` : "No Target"}
      changes={changes}
      confirmLabel="Add session"
      onConfirm={(): CommitResult => {
        if (!pending || !project) return { ok: false, reason: "stale", message: "Choose a Project." }
        const { result, note } = addSessionToProject(pending.sessionId, pending.projectId)
        if (result.ok) {
          const title = `Added ${label} to ${project.name}`
          announce(note ? `${title}. ${note}` : title)
          onAdded?.({ title, note })
        }
        return result
      }}
    />
  )
}

export function AddToProjectMenu({
  sessionId,
  onAdded,
  size = "sm",
  variant = "outline",
}: {
  sessionId: SessionId
  onAdded?: (notice: AddedNotice) => void
  size?: "xs" | "sm"
  variant?: "outline" | "ghost" | "default"
}) {
  const catalog = useStore((s) => s.catalog)
  const [pending, setPending] = useState<PendingAdd | null>(null)
  const session = catalog.sessions[sessionId]
  if (!session) return null
  const projects = openProjects(catalog, sessionId)
  const rigId = sessionRigId(session)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size={size} variant={variant} />}>
          Add to Project
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Add {sessionLabel(session)} to</DropdownMenuLabel>
            {projects.map((p) => (
              <DropdownMenuItem key={p.id} onClick={() => setPending({ sessionId, projectId: p.id })} className="flex-col items-start gap-0">
                {p.name}
                {rigId && !p.rigIds.includes(rigId) ? <span className="text-xs text-muted-foreground">+ rig {rigName(catalog, rigId)}</span> : null}
              </DropdownMenuItem>
            ))}
            {projects.length === 0 ? <DropdownMenuItem disabled>No open Project</DropdownMenuItem> : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openSheet({ kind: "new-project", fromSessionId: sessionId })}>
            <FolderPlus aria-hidden="true" />
            Create Project…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddToProjectDialog pending={pending} onClose={() => setPending(null)} onAdded={onAdded} />
    </>
  )
}

export function CreateProjectButton({ sessionId, size = "sm" }: { sessionId: SessionId; size?: "xs" | "sm" }) {
  const hasTarget = useStore((s) => Boolean(s.catalog.sessions[sessionId] && sessionTargetId(s.catalog.sessions[sessionId]!)))
  return (
    <Button size={size} variant="outline" onClick={() => openSheet({ kind: "new-project", fromSessionId: sessionId })} title={hasTarget ? "Prefilled with this Target and rig" : "Confirm a Target to prefill it"}>
      Create Project
    </Button>
  )
}

/**
 * Confirm Target (LIB-FR-05): pick a Target and confirm it. The suggestion
 * from evidence is preselected; confirming moves the session out of
 * "Needs a Target".
 */
export function ConfirmTargetControl({ sessionId, compact = false, onDone }: { sessionId: SessionId; compact?: boolean; onDone?: (message: string) => void }) {
  const session = useStore((s) => s.catalog.sessions[sessionId])
  const targets = useStore((s) => s.catalog.targets)
  const [choice, setChoice] = useState<string | null>(session?.target.value ?? null)
  const [refusal, setRefusal] = useState<RefusalProps | null>(null)
  const id = useId()
  if (!session) return null
  const items = Object.values(targets)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ value: t.id, label: t.name }))
  const confirm = () => {
    if (!choice) return setRefusal({ action: "Can't confirm", reason: "no Target chosen", blockers: [] })
    const result = confirmTarget(sessionId, choice as TargetId, session.revision)
    setRefusal(refusalOf(result, "Can't confirm"))
    if (!result.ok) return
    onDone?.(`Target: ${targets[choice]?.name}`)
    announce(`Target confirmed: ${targets[choice]?.name}`)
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span id={id} className="sr-only">
          Target for {sessionLabel(session)}
        </span>
        <Select items={items} value={choice} onValueChange={(next) => setChoice(next as string)}>
          <SelectTrigger size="sm" aria-labelledby={id} className={compact ? "w-36" : "w-48"}>
            <SelectValue placeholder="Choose a Target" />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={confirm}>
          Confirm Target
        </Button>
      </div>
      {refusal ? <Refusal {...refusal} /> : null}
    </div>
  )
}

export function ConfirmRigControl({ sessionId }: { sessionId: SessionId }) {
  const session = useStore((s) => s.catalog.sessions[sessionId])
  const rigs = useStore((s) => s.catalog.opticalTrains)
  const [choice, setChoice] = useState<string | null>(session?.equipment.value ?? null)
  const [refusal, setRefusal] = useState<RefusalProps | null>(null)
  const id = useId()
  if (!session) return null
  const items = Object.values(rigs)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => ({ value: r.id, label: r.name }))
  const confirm = () => {
    if (!choice) return setRefusal({ action: "Can't confirm", reason: "no rig chosen", blockers: [] })
    const result = confirmRig(sessionId, choice as OpticalTrainId, session.revision)
    setRefusal(refusalOf(result, "Can't confirm"))
    if (result.ok) announce(`Rig confirmed: ${rigs[choice]?.name}`)
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span id={id} className="sr-only">
          Rig for {sessionLabel(session)}
        </span>
        <Select items={items} value={choice} onValueChange={(next) => setChoice(next as string)}>
          <SelectTrigger size="sm" aria-labelledby={id} className="w-56">
            <SelectValue placeholder="Choose a rig" />
          </SelectTrigger>
          <SelectContent>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={confirm}>
          Confirm rig
        </Button>
      </div>
      {refusal ? <Refusal {...refusal} /> : null}
    </div>
  )
}
