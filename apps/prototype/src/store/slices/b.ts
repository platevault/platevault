/**
 * Slice B: S2 Projects list, S3 Project (with its Wrap up stage and the
 * mosaic editor), S4 New Project, S8 Trash. Screen-local state, plus the
 * "archive" operation handler (Archive at Wrap up and Restore after Reopen,
 * STO-FR-13, D-W69). The handler closes a Project whose Close project
 * transfer succeeds (`closingOnSuccess`, §5.5, F2). Wrap up's step state
 * comes from `wrapUpFlowState` (U11), so the slice keeps only the archive
 * origins.
 */
import { archiveHandler } from "@/features/v5/b-projects/actions"
import type { ArchiveOrigins } from "@/domain/archive"
import { closingOnSuccess } from "@/store/actions/projects"
import type { SliceDefinition } from "./index"

export interface BState {
  /** Where each archived frame came from, so Restore puts it back (D-W69). */
  archiveOrigins: ArchiveOrigins
}

export const bSlice: SliceDefinition<BState> = {
  id: "b",
  // Saved v3 state still loads: the fields dropped here (showDone, approvals, skippedOffers) are ignored.
  version: 3,
  initial: () => ({ archiveOrigins: {} }),
  operations: [closingOnSuccess(archiveHandler)],
}
