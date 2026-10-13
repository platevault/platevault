/**
 * Archive and Restore transfers (STO-FR-13, D-W69, P-ARC1): starting one
 * reviewed transfer per approval. The plan it moves comes from
 * `domain/archive.ts`; the "archive" operation's handler that runs it is
 * registered by slice B. Lifted verbatim from features/v5/b-projects/actions.ts.
 */
import type { ArchiveMove, ArchiveRow } from "@/domain/archive"
import { sessionTargetId } from "@/domain/derive"
import { unitCount } from "@/domain/labels"
import type { Catalog, OperationId, ProjectId, Session, SessionId } from "@/domain/types"
import { formatBytes } from "@/lib/format"
import { joinRefs, type MessageRef, msg, nightRef, verbatim } from "@/lib/i18n"
import { store } from "@/store/core"
import { startOperation } from "@/store/operations"

export type TransferDirection = "archive" | "restore"

/** What the "archive" operation carries; its handler reads the same shape. */
export interface ArchivePayload {
  /** Null for Archive… from Sessions (round 6): sessions in no Project. */
  projectId: ProjectId | null
  direction: TransferDirection
  queue: Array<{ sessionId: SessionId; moves: ArchiveMove[]; folder: string }>
  moved: SessionId[]
  href: string
}

/** "NGC 7000 · 18 Sep · Ha": the session's target (or object), night and channel. */
function sessionRef(catalog: Catalog, session: Session): MessageRef {
  const targetId = sessionTargetId(session)
  const target = (targetId ? catalog.targets[targetId]?.name : null) ?? session.objectLabel
  return joinRefs([typeof target === "string" ? verbatim(target) : msg("session_no_target"), nightRef(session.night), typeof session.channel === "string" ? verbatim(session.channel) : msg("palette_session_no_filter")], " · ")
}

/** Start an approved Archive or Restore of the reviewed rows; returns the operation id. Without a Project it archives sessions from Sessions. */
export function startArchiveTransfer(projectId: ProjectId | null, rows: ArchiveRow[], direction: TransferDirection): OperationId {
  const state = store.getState()
  const project = projectId ? state.catalog.projects[projectId] : undefined
  const name = project ? project.name : projectId ? msg("project_noun") : msg("session_count", { count: rows.length })
  const payload: ArchivePayload = {
    projectId,
    direction,
    queue: rows.map((r) => ({ sessionId: r.session.id, moves: r.moves, folder: r.folder })),
    moved: [],
    href: projectId ? `/projects/${projectId}` : "/sessions",
  }
  return startOperation({
    kind: "archive",
    title: direction === "archive" ? msg("op_archive_title", { name }) : msg("op_restore_title", { name }),
    scope: { projectId: projectId ?? undefined, sessionIds: rows.map((r) => r.session.id) },
    total: rows.length,
    unit: "sessions",
    items: rows.map((r) => ({
      id: r.session.id,
      label: sessionRef(state.catalog, r.session),
      path: r.folder,
      status: "pending",
      phase: null,
      detail: joinRefs([unitCount("frames", r.moves.length), verbatim(formatBytes(r.sizeBytes))], " · "),
    })),
    payload: payload as unknown as Record<string, unknown>,
    canCancel: false,
  })
}
