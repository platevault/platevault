/**
 * T1 slice: Onboarding, setup and Settings (J18, J10, J15, J19 registration; spec 064 locations).
 * Owned by track T1. Holds T1-local state and registers the operation
 * handlers T1 owns. Registered by the foundation in ./index.ts; the shape
 * below is T1's to change (bump `version` when it does).
 */
import type { SliceDefinition } from "./index"

export type T1State = Record<string, never>

export const t1Slice: SliceDefinition<T1State> = {
  id: "t1",
  version: 1,
  initial: () => ({}),
}
