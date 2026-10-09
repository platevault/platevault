/**
 * Slice C: S5 Run (Select, Calibrate, Prepare, Results, Done) and S7 Run
 * group. Owned by the slice C screen agent, which replaces this state
 * (Select filters, preparation review choices) and owns the "prepare" and
 * "cleanup" operation handlers it registers here; the foundation's
 * `prepareRun` and `cleanUpRun` actions use the handlers in
 * `src/store/actions/runs.ts` until then.
 */
import type { RunId } from "@/domain/types"
import type { SliceDefinition } from "./index"

export interface CState {
  /** Select: candidate list scope per run, so filters never change the selected ids (VSEL-FR-06). */
  selectFilter: Record<RunId, { channel: string | null; selectedOnly: boolean }>
}

export const cSlice: SliceDefinition<CState> = {
  id: "c",
  version: 1,
  initial: () => ({ selectFilter: {} }),
}
