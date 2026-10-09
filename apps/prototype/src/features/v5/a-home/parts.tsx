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
import { useMessages } from "@/app/preferences"
import { openSheet } from "@/app/ui-state"
import { projectCandidates, rigName, sessionRigId, sessionTargetId } from "@/domain/derive"
import { sessionLabel } from "@/domain/membership"
import type { Catalog, OpticalTrainId, Project, ProjectId, SessionId, TargetId } from "@/domain/types"
import type { Messages } from "@/lib/i18n"
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
export function addToProjectEntries(m: Messages, catalog: Catalog, sessionId: SessionId, onPick: (pending: PendingAdd) => void): MenuEntry[] {
  return [
    { heading: m.session_add_to_project() },
    ...openProjects(catalog, sessionId).map((p) => ({ label: p.name, icon: FolderInput, onSelect: () => onPick({ sessionId, projectId: p.id }) })),
    { label: m.session_create_project_menu(), icon: FolderPlus, onSelect: () => openSheet({ kind: "new-project", fromSessionId: sessionId }) },
  ]
}

/** The Add to Project preview; `pending` null keeps it closed. */
export function AddToProjectDialog({ pending, onClose, onAdded }: { pending: PendingAdd | null; onClose: () => void; onAdded?: (notice: AddedNotice) => void }) {
  const catalog = useStore((s) => s.catalog)
  const m = useMessages()
  const session = pending ? catalog.sessions[pending.sessionId] : undefined
  const project = pending ? catalog.projects[pending.projectId] : undefined
  const targetId = session ? sessionTargetId(session) : null
  const rigId = session ? sessionRigId(session) : null
  const targetName = targetId ? (catalog.targets[targetId]?.name ?? targetId) : null
  const label = session ? sessionLabel(m, session) : m.session_label()
  const changes =
    project && session
      ? [
          ...(targetName && !project.subjects.some((s) => s.targetId === targetId) ? [m.session_adds_subject({ name: targetName })] : []),
          ...(rigId && !project.rigIds.includes(rigId) ? [m.session_adds_rig({ name: rigName(m, catalog, rigId) })] : []),
          m.session_becomes_candidate({ name: label }),
        ]
      : []
  return (
    <ConfirmDialog
      open={pending !== null && project !== undefined}
      onOpenChange={(open) => !open && onClose()}
      title={project ? m.session_add_to_project_title({ session: label, project: project.name }) : m.session_add_to_project()}
      description={targetName ? `${targetName} · ${rigId ? rigName(m, catalog, rigId) : m.session_no_rig()}` : m.session_no_target()}
      changes={changes}
      confirmLabel={m.session_add_session()}
      onConfirm={(): CommitResult => {
        if (!pending || !project) return { ok: false, reason: "stale", message: m.session_choose_project() }
        const { result, note } = addSessionToProject(pending.sessionId, pending.projectId)
        if (result.ok) {
          const title = m.session_added_to_project({ session: label, project: project.name })
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
  const m = useMessages()
  const [pending, setPending] = useState<PendingAdd | null>(null)
  const session = catalog.sessions[sessionId]
  if (!session) return null
  const projects = openProjects(catalog, sessionId)
  const rigId = sessionRigId(session)
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size={size} variant={variant} />}>
          {m.session_add_to_project()}
          <ChevronDown data-icon="inline-end" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-auto min-w-60">
          <DropdownMenuGroup>
            <DropdownMenuLabel>{m.session_add_to({ name: sessionLabel(m, session) })}</DropdownMenuLabel>
            {projects.map((p) => (
              <DropdownMenuItem key={p.id} onClick={() => setPending({ sessionId, projectId: p.id })} className="flex-col items-start gap-0">
                {p.name}
                {rigId && !p.rigIds.includes(rigId) ? <span className="text-xs text-muted-foreground">{m.session_plus_rig({ name: rigName(m, catalog, rigId) })}</span> : null}
              </DropdownMenuItem>
            ))}
            {projects.length === 0 ? <DropdownMenuItem disabled>{m.session_no_open_project()}</DropdownMenuItem> : null}
          </DropdownMenuGroup>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={() => openSheet({ kind: "new-project", fromSessionId: sessionId })}>
            <FolderPlus aria-hidden="true" />
            {m.session_create_project_menu()}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <AddToProjectDialog pending={pending} onClose={() => setPending(null)} onAdded={onAdded} />
    </>
  )
}

export function CreateProjectButton({ sessionId, size = "sm" }: { sessionId: SessionId; size?: "xs" | "sm" }) {
  const hasTarget = useStore((s) => Boolean(s.catalog.sessions[sessionId] && sessionTargetId(s.catalog.sessions[sessionId]!)))
  const m = useMessages()
  return (
    <Button size={size} variant="outline" onClick={() => openSheet({ kind: "new-project", fromSessionId: sessionId })} title={hasTarget ? m.session_prefilled() : m.session_confirm_to_prefill()}>
      {m.newproject_create()}
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
  const m = useMessages()
  const [choice, setChoice] = useState<string | null>(session?.target.value ?? null)
  const [refusal, setRefusal] = useState<RefusalProps | null>(null)
  const id = useId()
  if (!session) return null
  const items = Object.values(targets)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((t) => ({ value: t.id, label: t.name }))
  const confirm = () => {
    if (!choice) return setRefusal({ action: m.session_cant_confirm(), reason: m.session_no_target_chosen(), blockers: [] })
    const result = confirmTarget(sessionId, choice as TargetId, session.revision)
    setRefusal(refusalOf(result, m.session_cant_confirm()))
    if (!result.ok) return
    onDone?.(m.session_target_value({ name: targets[choice]?.name ?? choice }))
    announce(m.session_target_confirmed({ name: targets[choice]?.name ?? choice }))
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span id={id} className="sr-only">
          {m.session_target_for({ name: sessionLabel(m, session) })}
        </span>
        <Select items={items} value={choice} onValueChange={(next) => setChoice(next as string)}>
          <SelectTrigger size="sm" aria-labelledby={id} className={compact ? "w-36" : "w-48"}>
            <SelectValue placeholder={m.session_choose_a_target()} />
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
          {m.session_confirm_target()}
        </Button>
      </div>
      {refusal ? <Refusal {...refusal} /> : null}
    </div>
  )
}

export function ConfirmRigControl({ sessionId }: { sessionId: SessionId }) {
  const session = useStore((s) => s.catalog.sessions[sessionId])
  const rigs = useStore((s) => s.catalog.opticalTrains)
  const m = useMessages()
  const [choice, setChoice] = useState<string | null>(session?.equipment.value ?? null)
  const [refusal, setRefusal] = useState<RefusalProps | null>(null)
  const id = useId()
  if (!session) return null
  const items = Object.values(rigs)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((r) => ({ value: r.id, label: r.name }))
  const confirm = () => {
    if (!choice) return setRefusal({ action: m.session_cant_confirm(), reason: m.session_no_rig_chosen(), blockers: [] })
    const result = confirmRig(sessionId, choice as OpticalTrainId, session.revision)
    setRefusal(refusalOf(result, m.session_cant_confirm()))
    if (result.ok) announce(m.session_rig_confirmed({ name: rigs[choice]?.name ?? choice }))
  }
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        <span id={id} className="sr-only">
          {m.session_rig_for({ name: sessionLabel(m, session) })}
        </span>
        <Select items={items} value={choice} onValueChange={(next) => setChoice(next as string)}>
          <SelectTrigger size="sm" aria-labelledby={id} className="w-56">
            <SelectValue placeholder={m.session_choose_a_rig()} />
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
          {m.session_confirm_rig()}
        </Button>
      </div>
      {refusal ? <Refusal {...refusal} /> : null}
    </div>
  )
}
