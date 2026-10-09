/**
 * Slice B: S2 Projects list, S3 Project, S4 New Project, S8 Trash, S9 Done /
 * Archive. Owned by the slice B screen agent, which replaces this state (New
 * Project draft, sheet choices) and may register the "archive" and "trash"
 * operation handlers.
 */
import type { SliceDefinition } from "./index"

export interface BState {
  /** Projects list: Done Projects are hidden behind "Show done" (D-W48). */
  showDone: boolean
}

export const bSlice: SliceDefinition<BState> = {
  id: "b",
  version: 1,
  initial: () => ({ showDone: false }),
}
