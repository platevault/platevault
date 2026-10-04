/**
 * Slice registry contract (foundation-owned).
 *
 * Each track owns exactly one slice module, `src/store/slices/<track>.ts`,
 * that exports a `SliceDefinition`. The foundation registers all five here;
 * tracks never edit this file. A slice holds track-local state (drafts, UI
 * choices, review progress) and may register operation handlers for the
 * operation kinds the track owns. Durable domain data lives in the shared
 * catalog (`src/domain/types.ts`), not in slices.
 */
import type { OperationHandler } from "../operations"
import { t1Slice, type T1State } from "./t1"
import { t2Slice, type T2State } from "./t2"
import { t3Slice, type T3State } from "./t3"
import { t4Slice, type T4State } from "./t4"
import { t5Slice, type T5State } from "./t5"

export interface SliceDefinition<S> {
  id: SliceId
  /** Bump when the slice state shape changes; a stored mismatch resets the slice. */
  version: number
  initial: () => S
  /** Handlers for operation kinds this track owns (see operations.ts). */
  operations?: OperationHandler[]
}

export type SliceId = "t1" | "t2" | "t3" | "t4" | "t5"

export const SLICES = {
  t1: t1Slice,
  t2: t2Slice,
  t3: t3Slice,
  t4: t4Slice,
  t5: t5Slice,
} as const

export interface SliceStates {
  t1: T1State
  t2: T2State
  t3: T3State
  t4: T4State
  t5: T5State
}
export function initialSliceStates(): SliceStates {
  return {
    t1: t1Slice.initial(),
    t2: t2Slice.initial(),
    t3: t3Slice.initial(),
    t4: t4Slice.initial(),
    t5: t5Slice.initial(),
  }
}

export function sliceVersions(): Record<SliceId, number> {
  return { t1: t1Slice.version, t2: t2Slice.version, t3: t3Slice.version, t4: t4Slice.version, t5: t5Slice.version }
}
