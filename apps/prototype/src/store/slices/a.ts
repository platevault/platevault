/**
 * Slice A: S1 Home, S12 Sessions, S13 Import. Owned by the slice A screen
 * agent, which replaces this state with its own (Import drafts, Home filters
 * such as Show done) and may register the "import" operation handler.
 */
import type { SliceDefinition } from "./index"

export interface AState {
  /** Home: Done Projects are hidden behind "Show done" (D-W48). */
  showDone: boolean
}

export const aSlice: SliceDefinition<AState> = {
  id: "a",
  version: 1,
  initial: () => ({ showDone: false }),
}
