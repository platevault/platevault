/**
 * Slice A shared pieces: Add to Project as menu items (D-W59: it also adds
 * the session's rig) with its confirm, Create Project prefilled from a
 * session, and the terse refusal for a failed write. Used by Home, Sessions
 * and the session detail.
 */
import type { Action, MenuItem } from "@/components/app/contracts"
import { toast } from "@/components/app/feedback"
import { type RefusalProps, refusalFrom } from "@/components/app/refusal"
import { openSheet } from "@/app/ui-state"
import { projectCandidates, rigName, sessionRigId, sessionTargetId } from "@/domain/derive"
import { sessionLabel } from "@/domain/membership"
import type { Catalog, Project, SessionId } from "@/domain/types"
import type { Messages } from "@/lib/i18n"
import { addSessionToProject } from "@/store/actions/projects"
import type { CommitResult } from "@/store/core"

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

/** Create Project…, prefilled with the session's Target and rig (LIB-FR-17). */
export function createProjectAction(m: Messages, sessionId: SessionId): Action {
  return { id: `create-project-${sessionId}`, label: m.session_create_project_menu(), opensDialog: true, run: () => openSheet({ kind: "new-project", fromSessionId: sessionId }) }
}

/** Adding one session to one Project: the confirm names what the Project gains, the outcome is a toast. */
function addAction(m: Messages, catalog: Catalog, sessionId: SessionId, project: Project): Action {
  const session = catalog.sessions[sessionId]!
  const label = sessionLabel(m, session)
  const targetId = sessionTargetId(session)
  const rigId = sessionRigId(session)
  const targetName = targetId ? (catalog.targets[targetId]?.name ?? targetId) : null
  const changes = [
    ...(targetName && !project.subjects.some((s) => s.targetId === targetId) ? [m.session_adds_subject({ name: targetName })] : []),
    ...(rigId && !project.rigIds.includes(rigId) ? [m.session_adds_rig({ name: rigName(m, catalog, rigId) })] : []),
    m.session_becomes_candidate({ name: label }),
  ]
  return {
    id: `add-to-${project.id}`,
    label: project.name,
    confirm: {
      title: m.session_add_to_project_title({ session: label, project: project.name }),
      summary: changes.join(" · "),
      confirm: { label: m.session_add_session() },
    },
    run: () => {
      const { result, note } = addSessionToProject(sessionId, project.id)
      if (result.ok) {
        const title = m.session_added_to_project({ session: label, project: project.name })
        toast({ message: note ? `${title} · ${note}` : title })
      }
      return result
    },
  }
}

/** "Add to Project ▸": one item per open Project, then Create Project…; the same list in a row menu, a header menu and Home. */
export function addToProjectItems(m: Messages, catalog: Catalog, sessionId: SessionId): MenuItem[] {
  if (!catalog.sessions[sessionId]) return []
  const adds: MenuItem[] = openProjects(catalog, sessionId).map((p) => addAction(m, catalog, sessionId, p))
  return [{ submenu: m.session_add_to_project(), items: [...adds, ...(adds.length > 0 ? [{ separator: true } as const] : []), createProjectAction(m, sessionId)] }]
}
