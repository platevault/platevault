/**
 * T3 slice: View workspace and frame review (J21, J22, J25; specs 066, 067).
 * Owned by track T3. Holds T3-local state and registers the operation
 * handlers T3 owns ("measure", "import-measurements"). Registered by the
 * foundation in ./index.ts; the shape below is T3's to change (bump
 * `version` when it does).
 */
import type { SliceDefinition } from "./index"

export type T3State = Record<string, never>

export const t3Slice: SliceDefinition<T3State> = {
  id: "t3",
  version: 1,
  initial: () => ({}),
}
