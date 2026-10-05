/**
 * T3 slice: View workspace and frame review (J21, J22, J25; specs 066, 067).
 * Holds T3-local UI state (filters, the current session and frame, review
 * choices, measurement-import review) and registers the "measure" operation.
 * Durable data (View membership, quality, measurements) lives in the catalog.
 */
import type { AssetId, MetricKey, SessionId, ViewId } from "@/domain/types"
import { measureHandler } from "@/features/t3/measure"
import type { SliceDefinition } from "./index"

export type QualityFilter = "unreviewed" | "usable" | "unusable" | "changed-content"
export type AvailabilityFilter = "available" | "offline" | "unreadable" | "absent"

/** Browsing filters for the session table; they never change the selected ids (VSEL-FR-06). */
export interface SessionFilters {
  object: string
  missingObject: boolean
  channels: string[]
  night: string | null
  startedFrom: string | null
  startedTo: string | null
  exposureMin: number | null
  exposureMax: number | null
  equipment: string | null
  quality: QualityFilter | null
  locationId: string | null
  availability: AvailabilityFilter | null
  targetId: string | null
  camera: string | null
  gain: number | null
  offset: number | null
  binning: number | null
  tempMin: number | null
  tempMax: number | null
  /** "near": framing radius, Target association or Position unknown. */
  scope: "near" | "all"
  selectedOnly: boolean
}

export function defaultSessionFilters(): SessionFilters {
  return {
    object: "",
    missingObject: false,
    channels: [],
    night: null,
    startedFrom: null,
    startedTo: null,
    exposureMin: null,
    exposureMax: null,
    equipment: null,
    quality: null,
    locationId: null,
    availability: null,
    targetId: null,
    camera: null,
    gain: null,
    offset: null,
    binning: null,
    tempMin: null,
    tempMax: null,
    scope: "near",
    selectedOnly: false,
  }
}

export interface FrameUi {
  /** Current frame: highlighted in the row, plot and preview at once (PIX-FR-02). */
  activeAssetId: AssetId | null
  showExcluded: boolean
  sessionId: SessionId | null
  search: string
  metric: MetricKey
}

export function defaultFrameUi(): FrameUi {
  return { activeAssetId: null, showExcluded: false, sessionId: null, search: "", metric: "fwhm" }
}

export interface RefreshUi {
  decisions: Record<string, "accept" | "decline">
  /** Changes declined earlier, shown as such the next time. */
  declined: string[]
}

export interface T3State {
  sessionFilters: Record<ViewId, SessionFilters>
  /** Session whose evidence is open; its footprint is highlighted. */
  activeSession: Record<ViewId, SessionId | null>
  sky: Record<ViewId, boolean>
  frames: Record<ViewId, FrameUi>
  refresh: Record<ViewId, RefreshUi>
}

export const t3Slice: SliceDefinition<T3State> = {
  id: "t3",
  version: 4,
  initial: () => ({ sessionFilters: {}, activeSession: {}, sky: {}, frames: {}, refresh: {} }),
  operations: [measureHandler],
}
