/**
 * Slice A shared pieces: Add to Project with its preview (D-W59: it also adds
 * the session's rig, with a visible note), Create Project prefilled from a
 * session, and Confirm Target / Confirm rig controls used by Home and the
 * session detail.
 */
import { ChevronDown, FolderPlus } from "lucide-react"
import { useId, useState } from "react"
import { ConfirmDialog } from "@/components/app/confirm-dialog"
import { announce } from "@/components/app/feedback"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuGroup, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { openSheet } from "@/app/ui-state"
import { rigName, sessionRigId, sessionTargetId } from "@/domain/derive"
import { sessionLabel } from "@/domain/membership"
import type { OpticalTrainId, ProjectId, SessionId, TargetId } from "@/domain/types"
import { addSessionToProject } from "@/store/actions/projects"
import { confirmRig, confirmTarget } from "@/store/actions/library"
import { type CommitResult, useStore } from "@/store/core"

/** "Added 2 Oct Ha to Heart and Soul. Also adds the rig …" — shown by the owner after a successful add. */
export type AddedNotice = { title: string; note: string | null }

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
  const [pending, setPending] = useState<ProjectId | null>(null)
  const session = catalog.sessions[sessionId]
  if (!session) return null
  const projects = Object.values(catalog.projects)
    .filter((p) => p.state === "open")
    .sort((a, b) => a.name.localeCompare(b.name))
  const targetId = sessionTargetId(session)
  const rigId = sessionRigId(session)
  const targetName = targetId ? (catalog.targets[targetId]?.name ?? targetId) : null
  const project = pending ? catalog.projects[pending] : undefined
  const addsSubject = project && targetId ? !project.subjects.some((s) => s.targetId === targetId) : false
  const addsRig = project && rigId ? !project.rigIds.includes(rigId) : false
  const label = sessionLabel(session)

  const changes = project
    ? [
        addsSubject ? `Adds ${targetName} as a subject of ${project.name}, with goals from its template` : `${targetName} is already a subject of ${project.name}`,
        ...(addsRig ? [`Also adds the rig ${rigName(catalog, rigId)} to ${project.name}`] : []),
        `${label} becomes a candidate of ${project.name}`,
      ]
    : []

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size={size} variant={variant} />}>
          Add to Project
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Add {label} to</DropdownMenuLabel>
            {projects.map((p) => {
              const rigNote = rigId && !p.rigIds.includes(rigId)
              return (
                <DropdownMenuItem key={p.id} onClick={() => setPending(p.id)} className="flex-col items-start gap-0">
                  {p.name}
                  {rigNote ? <span className="text-xs text-muted-foreground">Also adds the rig {rigName(catalog, rigId)}</span> : null}
                </DropdownMenuItem>
              )
            })}
            {projects.length === 0 ? <DropdownMenuItem disabled>No open Project: create one</DropdownMenuItem> : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openSheet({ kind: "new-project", fromSessionId: sessionId })}>
            <FolderPlus aria-hidden="true" />
            Create Project from this session…
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title={project ? `Add ${label} to ${project.name}?` : "Add to Project"}
        description={targetName ? `Target ${targetName} on ${rigId ? rigName(catalog, rigId) : "no confirmed rig"}.` : "This session has no confirmed Target."}
        changes={changes}
        unchanged={["No run changes: a session joins a run only in that run's Select step", "Files, headers and library quality"]}
        confirmLabel={project ? `Add to ${project.name}` : "Add to Project"}
        onConfirm={(): CommitResult => {
          if (!pending || !project) return { ok: false, reason: "stale", message: "Choose a Project." }
          const { result, note } = addSessionToProject(sessionId, pending)
          if (result.ok) {
            const title = `Added ${label} to ${project.name}.`
            announce(note ? `${title} ${note}` : title)
            onAdded?.({ title, note })
          }
          return result
        }}
      />
    </>
  )
}

export function CreateProjectButton({ sessionId, size = "sm" }: { sessionId: SessionId; size?: "xs" | "sm" }) {
  const hasTarget = useStore((s) => Boolean(s.catalog.sessions[sessionId] && sessionTargetId(s.catalog.sessions[sessionId]!)))
  return (
    <Button
      size={size}
      variant="outline"
      onClick={() => openSheet({ kind: "new-project", fromSessionId: sessionId })}
      title={hasTarget ? "New Project prefilled with this session's Target and rig" : "New Project; confirm a Target first to prefill it"}
    >
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
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  if (!session) return null
  const items = Object.values(targets)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ value: t.id, label: t.name }))
  const confirm = () => {
    if (!choice) return setError("Choose a Target first.")
    const result = confirmTarget(sessionId, choice as TargetId, session.revision)
    if (!result.ok) return setError(result.message)
    setError(null)
    onDone?.(`Target confirmed for ${sessionLabel(session)}: ${targets[choice]?.name}.`)
    announce(`Target confirmed: ${targets[choice]?.name}`)
  }
  return (
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
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  )
}

export function ConfirmRigControl({ sessionId }: { sessionId: SessionId }) {
  const session = useStore((s) => s.catalog.sessions[sessionId])
  const rigs = useStore((s) => s.catalog.opticalTrains)
  const [choice, setChoice] = useState<string | null>(session?.equipment.value ?? null)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  if (!session) return null
  const items = Object.values(rigs)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => ({ value: r.id, label: r.name }))
  const confirm = () => {
    if (!choice) return setError("Choose a rig first.")
    const result = confirmRig(sessionId, choice as OpticalTrainId, session.revision)
    if (!result.ok) return setError(result.message)
    setError(null)
    announce(`Rig confirmed: ${rigs[choice]?.name}`)
  }
  return (
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
      {error ? (
        <span role="alert" className="text-xs text-destructive">
          {error}
        </span>
      ) : null}
    </div>
  )
}
