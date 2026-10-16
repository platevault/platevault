/**
 * Slice A shared pieces: Add to Project as menu items (D-W59: it also adds
 * the sessions' Targets as subjects and their rigs, then the sessions
 * themselves) with its confirm, for one session or a selection; New
 * Project… prefilled from a session, the label Targets uses; and the terse
 * refusal for a failed write. Used by Home, Sessions and the session detail.
 * Only a session that is Ready and calibration-settled can join a Project
 * (`canJoinProject`, PRJ-FR-08): otherwise each Project item is unavailable
 * with its `joinBlocker` ("Choose its flats first") and a link to where it is
 * resolved; the store refuses the same on every path.
 */
import type { Action, MenuItem } from "@/components/app/contracts"
import { toast } from "@/components/app/feedback"
import { type RefusalProps, refusalFrom } from "@/components/app/refusal"
import { openSheet } from "@/app/ui-state"
import { canJoinProject, findInput, joinBlocker, rigName, sessionIntakeEntry, sessionReadiness, sessionRigId, sessionTargetId, type StepLink } from "@/domain/derive"
import { sessionLabel } from "@/domain/membership"
import type { Catalog, OpticalTrainId, Project, Session, SessionId, TargetId } from "@/domain/types"
import { type Messages, say } from "@/lib/i18n"
import { addSessionToProject } from "@/store/actions/projects"
import type { CommitResult } from "@/store/core"

/** A failed write as a terse refusal: its reasons as chips, else its message. Null when it succeeded. */
export function refusalOf(result: CommitResult, action: string): RefusalProps | null {
  if (result.ok) return null
  return refusalFrom(result, action) ?? { action, reason: result.message, blockers: [] }
}

/** Open Projects that lack at least one of the sessions. */
function openProjects(catalog: Catalog, sessions: Session[]): Project[] {
  return Object.values(catalog.projects)
    .filter((p) => p.state === "open" && sessions.some((s) => !findInput(p, s.id)))
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** New Project…, prefilled with the session's Target and rig (LIB-FR-17); the same item as on Targets. */
export function newProjectAction(m: Messages, sessionId: SessionId): Action {
  return { id: `new-project-${sessionId}`, label: m.newproject_open_ellipsis(), opensDialog: true, run: () => openSheet({ kind: "new-project", fromSessionId: sessionId }) }
}

/** Where a session that cannot join yet is resolved: its intake while it is not Ready, else its calibration on its details. */
export function joinBlockerLink(catalog: Catalog, session: Session): StepLink {
  return sessionReadiness(catalog, session) === "ready" ? { to: "/sessions/$sessionId", params: { sessionId: session.id } } : sessionIntakeEntry(catalog, session)
}

/** Add to Project's unavailable state while any of the sessions is not Ready and settled: the reason and, per session, where to resolve it. */
export function joinUnavailable(m: Messages, catalog: Catalog, sessions: Session[]): Action["unavailable"] {
  const blocked = sessions.filter((s) => !canJoinProject(catalog, s))
  if (blocked.length === 0) return undefined
  const reasonOf = (session: Session) => {
    const blocker = joinBlocker(catalog, session)
    return blocker ? say(m, blocker) : m.store_record_missing()
  }
  const action = m.session_add_to_project()
  if (sessions.length === 1) return { action, reason: reasonOf(blocked[0]!), blockers: [{ label: sessionLabel(m, blocked[0]!), link: joinBlockerLink(catalog, blocked[0]!) }] }
  return { action, reason: m.sessions_cant_join_count({ count: blocked.length }), blockers: blocked.map((s) => ({ label: `${sessionLabel(m, s)} · ${reasonOf(s)}`, link: joinBlockerLink(catalog, s) })) }
}

function distinct<T>(values: Array<T | null>): T[] {
  return [...new Set(values.filter((v): v is T => v !== null))]
}

/** Adding the sessions to one Project: the confirm names what the Project gains, the outcome is a toast. */
function addAction(m: Messages, catalog: Catalog, sessions: Session[], project: Project): Action {
  const adding = sessions.filter((s) => !findInput(project, s.id))
  const one = adding.length === 1 ? adding[0]! : null
  const name = one ? sessionLabel(m, one) : m.session_count({ count: adding.length })
  const targetIds = distinct<TargetId>(adding.map(sessionTargetId)).filter((id) => !project.subjects.some((s) => s.targetId === id))
  const rigIds = distinct<OpticalTrainId>(adding.map(sessionRigId)).filter((id) => !project.rigIds.includes(id))
  const changes = [
    ...targetIds.map((id) => m.session_adds_subject({ name: catalog.targets[id]?.name ?? id })),
    ...rigIds.map((id) => m.session_adds_rig({ name: rigName(m, catalog, id) })),
    one ? m.session_joins_project({ name }) : m.sessions_join_project({ count: adding.length }),
  ]
  return {
    id: `add-to-${project.id}`,
    label: project.name,
    unavailable: joinUnavailable(m, catalog, adding),
    confirm: {
      title: m.session_add_to_project_title({ session: name, project: project.name }),
      summary: changes.join(" · "),
      confirm: { label: one ? m.session_add_session() : m.session_add_to_project() },
    },
    run: () => {
      const notes: string[] = []
      for (const session of adding) {
        const { result, note } = addSessionToProject(session.id, project.id)
        if (!result.ok) return result
        if (note) notes.push(note)
      }
      const title = one ? m.session_added_to_project({ session: name, project: project.name }) : m.sessions_added_to_project({ count: adding.length, project: project.name })
      toast({ message: [title, ...notes].join(" · ") })
      return { ok: true }
    },
  }
}

/**
 * "Add to Project ▸" with one item per open Project that lacks a session,
 * then New Project… for a single session: the same items in a row menu, a
 * header menu, the selection bar and Home. No submenu while no open Project
 * can take them.
 */
export function addToProjectItems(m: Messages, catalog: Catalog, sessionIds: readonly SessionId[]): MenuItem[] {
  const sessions = sessionIds.flatMap((id) => catalog.sessions[id] ?? [])
  if (sessions.length === 0) return []
  const adds = openProjects(catalog, sessions).map((p) => addAction(m, catalog, sessions, p))
  return [...(adds.length > 0 ? [{ submenu: m.session_add_to_project(), items: adds }] : []), ...(sessions.length === 1 ? [newProjectAction(m, sessions[0]!.id)] : [])]
}
