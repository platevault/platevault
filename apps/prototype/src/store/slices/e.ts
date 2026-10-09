/**
 * Slice E: S10 Targets, S11 Plan, S16 Settings, and S14 Calibration, S15
 * Storage and S17 Activity carried over from v4. Holds the v4 setup and
 * Settings UI state the kept Settings pages use (setup indexing runs, the
 * last Target lookup test). The slice E screen agent extends it (Targets
 * presets, rig selector, Plan scope).
 */
import type { OperationId } from "@/domain/types"
import type { SliceDefinition } from "./index"

export interface TargetLookupTest {
  at: string
  query: string
  provider: "cds-sesame" | "simbad"
  outcome: "resolved" | "not-found" | "failed" | "off"
  message: string
  result: { name: string; ra: number; dec: number; objectType: string; aliases: string[] } | null
}

export interface EState {
  /** Indexing runs started from the setup flow, oldest first. */
  setupOperationIds: OperationId[]
  /** Last simulated Target lookup on Settings › Target lookup. */
  lastLookupTest: TargetLookupTest | null
}

export const eSlice: SliceDefinition<EState> = {
  id: "e",
  version: 1,
  initial: () => ({ setupOperationIds: [], lastLookupTest: null }),
}
