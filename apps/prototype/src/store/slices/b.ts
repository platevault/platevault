/**
 * Slice B: S2 Projects list, S3 Project, S4 New Project, S8 Trash, S9 Done /
 * Archive. Screen-local state, plus the "archive" operation handler (Archive
 * of a Done Project and Restore after Reopen, STO-FR-13, D-W69).
 */
import { archiveHandler } from "@/features/v5/b-projects/actions"
import type { ArchiveOrigins } from "@/features/v5/b-projects/model"
import type { OperationId, ProjectId } from "@/domain/types"
import type { SliceDefinition } from "./index"

/** A Done / Archive sheet approval whose operation the sheet keeps showing. */
export type DoneApproval = "archive" | "restore" | "rejected-frames" | "intermediates" | "duplicate-copies" | "empty-trash"

export interface BState {
  /** Projects list: Done Projects are hidden behind "Show done" (D-W48). */
  showDone: boolean
  /** Where each archived frame came from, so Restore puts it back (D-W69). */
  archiveOrigins: ArchiveOrigins
  /** The latest operation of each approval, per Project. */
  approvals: Record<ProjectId, Partial<Record<DoneApproval, OperationId>>>
}

export const bSlice: SliceDefinition<BState> = {
  id: "b",
  version: 2,
  initial: () => ({ showDone: false, archiveOrigins: {}, approvals: {} }),
  operations: [archiveHandler],
}
