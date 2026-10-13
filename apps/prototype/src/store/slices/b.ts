/**
 * Slice B: S2 Projects list, S3 Project (with its Wrap up stage and the
 * mosaic editor), S4 New Project, S8 Trash. Screen-local state, plus the
 * "archive" operation handler (Archive at Wrap up and Restore after Reopen,
 * STO-FR-13, D-W69). The handler closes a Project whose Close project
 * transfer succeeds (`closingOnSuccess`, §5.5, F2).
 */
import { archiveHandler } from "@/features/v5/b-projects/actions"
import type { ArchiveOrigins, OfferKind } from "@/features/v5/b-projects/model"
import type { OperationId, ProjectId } from "@/domain/types"
import { closingOnSuccess } from "@/store/actions/projects"
import type { SliceDefinition } from "./index"

/** A Wrap up or Trash approval whose operation the Project keeps showing. */
export type WrapUpApproval = "archive" | "restore" | OfferKind | "empty-trash"

export interface BState {
  /** Projects list: Done Projects are hidden behind "Show done" (D-W48). */
  showDone: boolean
  /** Where each archived frame came from, so Restore puts it back (D-W69). */
  archiveOrigins: ArchiveOrigins
  /** The latest operation of each approval, per Project. */
  approvals: Record<ProjectId, Partial<Record<WrapUpApproval, OperationId>>>
  /** Wrap up trash offers the user skipped, per Project; with the approvals and what is left they give the Trash step's state (`trashStep`). */
  skippedOffers: Record<ProjectId, OfferKind[]>
}

export const bSlice: SliceDefinition<BState> = {
  id: "b",
  version: 3,
  initial: () => ({ showDone: false, archiveOrigins: {}, approvals: {}, skippedOffers: {} }),
  operations: [closingOnSuccess(archiveHandler)],
}
