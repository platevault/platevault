/**
 * Slice D: S6 Review (frame review, specs 067 and D-W13 to D-W15, D-W22,
 * D-W40, D-W42, D-W53, D-W54). Holds frame-review UI state per session under
 * review (current frame, filters, metric) and registers the built-in
 * "measure" operation (v4's T3 measurement, kept for this slice), which is
 * keyed by the same session. Durable data (quality, measurements) lives in
 * the catalog.
 */
import type { AssetId, MetricKey, SessionId } from "@/domain/types"
import { measureHandler } from "@/store/actions/measure"
import type { SliceDefinition } from "./index"

export interface FrameUi {
  /** Current frame: highlighted in the row, plot and preview at once (PIX-FR-02). */
  activeAssetId: AssetId | null
  showExcluded: boolean
  search: string
  metric: MetricKey
}

export function defaultFrameUi(): FrameUi {
  return { activeAssetId: null, showExcluded: false, search: "", metric: "fwhm" }
}

export interface DState {
  /** By the session under review. */
  frames: Record<SessionId, FrameUi>
}

export const dSlice: SliceDefinition<DState> = {
  id: "d",
  version: 2,
  initial: () => ({ frames: {} }),
  operations: [measureHandler],
}
