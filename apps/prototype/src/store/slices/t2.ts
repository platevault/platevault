/**
 * T2 slice: Library home, scans, sessions, corrections, quality, Targets and Projects (J19, J20; specs 064, 065).
 * Owned by track T2. Holds T2-local state and registers the operation
 * handlers T2 owns. Registered by the foundation in ./index.ts; the shape
 * below is T2's to change (bump `version` when it does).
 */
import type { SliceDefinition } from "./index"

export type T2State = Record<string, never>

export const t2Slice: SliceDefinition<T2State> = {
  id: "t2",
  version: 1,
  initial: () => ({}),
}
