/**
 * Slice C: S5 Run (Select, Calibrate, Prepare, Results, Done) and S7 Run
 * group. Screen-local state: Select's browsing filter and the Prepare
 * review choices (link type and the corrected-metadata decisions, D15) per
 * run or run group. Durable outcomes live in the catalog. Registers the
 * "prepare" operation handler (`src/features/v5/c-runs/operations.ts`);
 * Clean up uses the foundation trash engine.
 */
import type { RunId } from "@/domain/types"
import { cOperationHandlers } from "@/features/v5/c-runs/operations"
import type { PrepareChoices } from "@/features/v5/c-runs/model"
import type { SliceDefinition } from "./index"

export interface CState {
  /** Select: candidate list scope per run, so filters never change the selected ids (VSEL-FR-06). */
  selectFilter: Record<RunId, { channel: string | null; selectedOnly: boolean }>
  /** Prepare review choices, keyed by run id (or group id for Prepare all). */
  prepare: Record<string, PrepareChoices>
}

export const cSlice: SliceDefinition<CState> = {
  id: "c",
  version: 2,
  initial: () => ({ selectFilter: {}, prepare: {} }),
  operations: cOperationHandlers,
}
