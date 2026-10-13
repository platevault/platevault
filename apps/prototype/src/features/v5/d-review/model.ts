/**
 * Review model (slice D): the frames of one library session as the session
 * intake Review step reviews them (P-REV2): every live frame, its library
 * quality as it applies to the current bytes (C10), its built-in and imported
 * values and whether a copy can be read. Marks are library-wide (P-REJ2), so
 * there is no Project scope. Pure derivation over the store; nothing here
 * writes. Trashed frames are never listed (LIB-FR-18, PIX-AC-19).
 */
import { type FlowGate, frameQuality, type FrameQuality, liveAssetIds, reviewLockGate } from "@/domain/derive"
import { assetAvailability, type AssetAvailability } from "@/domain/library"
import type { Asset, AssetId, MetricKey, Metric, Operation, Session, SessionId } from "@/domain/types"
import { m } from "@/lib/i18n"
import { builtInMetrics, currentImportedMetrics, frameMeasureState, type FrameMeasureState, latestMeasureOp } from "@/store/actions/measure"
import type { PrototypeState } from "@/store/core"

/** The review buckets of library quality (PIX-FR-14): Picked (Usable), Rejected (Unusable) and Unreviewed. */
export type ReviewBucket = "picked" | "rejected" | "unreviewed"
export type QualityFilter = "all" | ReviewBucket

/** Labels are getters, so every read is in the chosen language. `key` is the ⌥ digit that picks the filter. */
export const FILTERS: Array<{ id: QualityFilter; readonly label: string; key: string }> = [
  { id: "all", get label() { return m.review_filter_all() }, key: "1" },
  { id: "picked", get label() { return m.review_picked() }, key: "2" },
  { id: "rejected", get label() { return m.review_rejected() }, key: "3" },
  { id: "unreviewed", get label() { return m.status_unreviewed() }, key: "4" },
]

export const PLOT_METRICS: MetricKey[] = ["fwhm", "hfr", "eccentricity", "star-count", "background"]

export interface ReviewFrame {
  asset: Asset
  session: Session | undefined
  quality: FrameQuality
  bucket: ReviewBucket
  measure: FrameMeasureState
  builtIn: Partial<Record<MetricKey, Metric>>
  imported: Partial<Record<MetricKey, Metric>>
  availability: AssetAvailability
  /** 1-based frame number in its session, by capture time. */
  number: number
  /** Capture order: the default sort and the plots' sequence. */
  order: number
}

export interface ReviewScope {
  /** Key for the frame UI state, the measurement operation and recorded imports: `session:<id>`. */
  key: string
  session: Session
  frames: ReviewFrame[]
  ops: Operation[]
  /** Where a mark, a measurement or an import is recorded from (activity links). */
  href: string
  /** Marks are refused while an unfinished run's prepared view holds the session (C10): the reason and the runs. */
  lock: FlowGate | null
}

function byKey(metrics: Metric[]): Partial<Record<MetricKey, Metric>> {
  return Object.fromEntries(metrics.map((metric) => [metric.key, metric]))
}

export function bucketOf(quality: FrameQuality): ReviewBucket {
  if (quality.library === "unusable") return "rejected"
  if (quality.library === "usable") return "picked"
  // Unreviewed, plus decisions that no longer apply to the current bytes (changed content, verification pending).
  return "unreviewed"
}

export function scopeKey(sessionId: SessionId): string {
  return `session:${sessionId}`
}

export function reviewScope(state: PrototypeState, sessionId: SessionId): ReviewScope | null {
  const { catalog, disk } = state
  const session = catalog.sessions[sessionId]
  if (!session) return null
  const key = scopeKey(sessionId)
  const op = latestMeasureOp(state, key)
  const assets = liveAssetIds(catalog, session)
    .map((id) => catalog.assets[id])
    .filter((asset): asset is Asset => asset !== undefined)
    .sort((a, b) => a.observed.dateObs.localeCompare(b.observed.dateObs) || a.fileName.localeCompare(b.fileName))
  const frames = assets.map((asset, order): ReviewFrame => {
    const quality = frameQuality(asset)
    const record = catalog.measurements[asset.id]
    const measure = frameMeasureState(catalog, asset.id, op)
    return {
      asset,
      session,
      quality,
      bucket: bucketOf(quality),
      measure,
      builtIn: measure === "measured" ? byKey(builtInMetrics(record)) : {},
      imported: byKey(currentImportedMetrics(record, asset.sha256)),
      availability: assetAvailability(disk, catalog, asset),
      number: order + 1,
      order,
    }
  })
  return { key, session, frames, ops: op ? [op] : [], href: `/sessions/${session.id}?step=review`, lock: reviewLockGate(state, session.id) }
}

/** The bucket a frame lands in after a library mark. */
export function bucketAfterMark(value: "usable" | "unusable" | "unreviewed"): ReviewBucket {
  return value === "unusable" ? "rejected" : value === "usable" ? "picked" : "unreviewed"
}
