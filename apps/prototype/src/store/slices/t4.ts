/**
 * T4 slice: Calibration and application handoff (J23, J24; specs 068, 069).
 * Owned by track T4. Holds T4-local state and registers the operation
 * handlers T4 owns ("prepare", "adopt-master"). Registered by the
 * foundation in ./index.ts; the shape below is T4's to change (bump
 * `version` when it does).
 */
import type { SliceDefinition } from "./index"

export type T4State = Record<string, never>

export const t4Slice: SliceDefinition<T4State> = {
  id: "t4",
  version: 1,
  initial: () => ({}),
}
