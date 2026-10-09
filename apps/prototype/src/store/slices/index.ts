/**
 * Slice registry contract (foundation-owned).
 *
 * Each harness-v5 screen slice owns exactly one slice module,
 * `src/store/slices/<slice>.ts`, that exports a `SliceDefinition`:
 *
 * | Slice | Screens |
 * |---|---|
 * | a | S1 Home, S12 Sessions, S13 Import |
 * | b | S2 Projects list, S3 Project, S4 New Project, S8 Trash, S9 Wrap up |
 * | c | S5 Run (Select, Calibrate, Prepare, Results, Done), S7 Run group |
 * | d | S6 Review (frame review) |
 * | e | S10 Targets, S11 Plan, S16 Settings, S14 Calibration, S15 Storage, S17 Activity |
 *
 * The foundation registers all five here; slices never edit this file. A
 * slice holds screen-local state (drafts, UI choices, review progress) and
 * may register operation handlers for the operation kinds it owns. Durable
 * domain data lives in the shared catalog (`src/domain/types.ts`), not in
 * slices. Bump a slice's `version` when its state shape changes.
 */
import type { OperationHandler } from "../operations"
import { aSlice, type AState } from "./a"
import { bSlice, type BState } from "./b"
import { cSlice, type CState } from "./c"
import { dSlice, type DState } from "./d"
import { eSlice, type EState } from "./e"

export interface SliceDefinition<S> {
  id: SliceId
  /** Bump when the slice state shape changes; a stored mismatch resets the slice. */
  version: number
  initial: () => S
  /** Handlers for operation kinds this slice owns (see operations.ts). */
  operations?: OperationHandler[]
}

export type SliceId = "a" | "b" | "c" | "d" | "e"

export const SLICES = {
  a: aSlice,
  b: bSlice,
  c: cSlice,
  d: dSlice,
  e: eSlice,
} as const

export interface SliceStates {
  a: AState
  b: BState
  c: CState
  d: DState
  e: EState
}

export function initialSliceStates(): SliceStates {
  return { a: aSlice.initial(), b: bSlice.initial(), c: cSlice.initial(), d: dSlice.initial(), e: eSlice.initial() }
}

export function sliceVersions(): Record<SliceId, number> {
  return { a: aSlice.version, b: bSlice.version, c: cSlice.version, d: dSlice.version, e: eSlice.version }
}
