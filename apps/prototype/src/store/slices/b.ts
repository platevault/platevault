/**
 * Slice B: S2 Projects list, S3 Project (with its Wrap up stage), S4 New
 * Project, S8 Trash. It registers the "archive" operation handler
 * (`archiveHandler`, store/actions/archive.ts; Archive at Wrap up and
 * Sessions › Archive…, STO-FR-13), composed with `closingOnSuccess` so a
 * Project whose Close project transfer succeeds closes then (§5.5, F2).
 * There is no Restore. Wrap up's step state comes from `wrapUpFlowState`
 * (domain/project-view.ts), so the slice holds no state of its own.
 */
import { archiveHandler } from "@/store/actions/archive"
import { closingOnSuccess } from "@/store/actions/projects"
import type { SliceDefinition } from "./index"

export type BState = Record<string, never>

export const bSlice: SliceDefinition<BState> = {
  id: "b",
  version: 4,
  initial: () => ({}),
  operations: [closingOnSuccess(archiveHandler)],
}
