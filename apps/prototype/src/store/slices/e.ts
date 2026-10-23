/**
 * Slice E: S10 Targets (with its Planned view), S16 Settings, and S14
 * Calibration, S15 Storage and S17 Activity carried over from v4. Holds the
 * v4 setup and Settings UI state the kept Settings pages use (setup indexing
 * runs, the last Target lookup test), the user's saved Targets presets
 * (PLAN-TGT-FR-10) and the order the user gave each night's plan. The live
 * Targets view (view, night, mode, catalogues, preset, rig, sort, Project
 * context) lives in the URL, so a saved preset is a snapshot of those keys.
 */
import type { NightDate, OperationId, TargetId } from "@/domain/types"
import type { SliceDefinition } from "./index"

/** The outcome only: Settings › Target lookup words it at render, in the current language. */
export interface TargetLookupTest {
  at: string
  query: string
  provider: "cds-sesame" | "simbad"
  outcome: "resolved" | "not-found" | "failed" | "off"
  result: { name: string; ra: number; dec: number; objectType: string; aliases: string[] } | null
}

/** The Targets URL keys a saved preset restores: Show mode, catalogues, built-in preset, rig, sort, the good-tonight filter band and the Favourite filter. */
export type TargetsViewKey = "mode" | "cat" | "preset" | "rig" | "sort" | "good" | "fav"

export interface SavedTargetPreset {
  id: string
  name: string
  view: Partial<Record<TargetsViewKey, string>>
}

export interface EState {
  /** Indexing runs started from the setup flow, oldest first. */
  setupOperationIds: OperationId[]
  /** Last simulated Target lookup on Settings › Target lookup. */
  lastLookupTest: TargetLookupTest | null
  /** User-saved Targets presets, listed after the built-ins (PLAN-TGT-FR-10). */
  savedPresets: SavedTargetPreset[]
  /** Each night's Planned order as the user last moved it; planned Targets missing here follow by window start. */
  planOrder: Record<NightDate, TargetId[]>
}

export const eSlice: SliceDefinition<EState> = {
  id: "e",
  version: 4,
  initial: () => ({ setupOperationIds: [], lastLookupTest: null, savedPresets: [], planOrder: {} }),
}
