/**
 * Review model (slice D): the frames a review shows. A review is one
 * library session as the session intake Review step reviews it (P-REV2):
 * every live frame, its library quality as it applies to the current bytes
 * (C10), its built-in and imported values and whether a copy can be read.
 * Marks are library-wide (P-REJ2), so no review has a Project scope.
 *
 * Pure derivation over the store; nothing here writes. Trashed frames are
 * never listed (LIB-FR-18, PIX-AC-19).
 */
import { frameQuality, type FrameQuality, liveAssetIds } from "@/domain/derive"
import { assetAvailability, type AssetAvailability } from "@/domain/library"
import type { Asset, MetricKey, Metric, Operation, Session, SessionId } from "@/domain/types"
import { m } from "@/lib/i18n"
import { builtInMetrics, currentImportedMetrics, frameMeasureState, type FrameMeasureState, latestMeasureOp } from "@/store/actions/measure"
import type { PrototypeState } from "@/store/core"

/** Where a review opens: one library session (the intake Review step). */
export interface ReviewContext {
  kind: "session"
  sessionId: SessionId
}

/** The review buckets of library quality (PIX-FR-14), shown with the STATUS words: Usable ("picked"), Unusable ("rejected") and Unreviewed. */
export type ReviewBucket = "picked" | "rejected" | "unreviewed"
export type QualityFilter = "all" | ReviewBucket

/** Labels are getters, so every read is in the chosen language. `key` is the ⌥ digit that picks the filter. */
export const FILTERS: Array<{ id: QualityFilter; readonly label: string; key: string }> = [
  { id: "all", get label() { return m.review_filter_all() }, key: "1" },
  { id: "picked", get label() { return m.status_usable() }, key: "2" },
  { id: "rejected", get label() { return m.status_unusable() }, key: "3" },
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
  /** The session under review: its id keys the frame UI state, the measurement operation and recorded imports. */
  session: Session
  frames: ReviewFrame[]
  ops: Operation[]
  /** Where a mark, a measurement or an import is recorded from (activity links). */
  href: string
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

export function reviewScope(state: PrototypeState, context: ReviewContext): ReviewScope | null {
  const { catalog, disk } = state
  const session = catalog.sessions[context.sessionId]
  if (!session) return null
  const op = latestMeasureOp(state, session.id)
  const assets = [...new Set(liveAssetIds(catalog, session))]
    .map((id) => catalog.assets[id])
    .filter((asset): asset is Asset => asset !== undefined && !asset.trashed)
    .sort((a, b) => a.observed.dateObs.localeCompare(b.observed.dateObs) || a.fileName.localeCompare(b.fileName))
  // The frame number counts within each session, by capture time.
  const perSession = new Map<string, number>()
  const frames = assets.map((asset, order): ReviewFrame => {
    const quality = frameQuality(asset)
    const record = catalog.measurements[asset.id]
    const measure = frameMeasureState(catalog, asset.id, op)
    const sessionKey = asset.sessionId ?? ""
    const number = (perSession.get(sessionKey) ?? 0) + 1
    perSession.set(sessionKey, number)
    return {
      asset,
      session: asset.sessionId ? catalog.sessions[asset.sessionId] : undefined,
      quality,
      bucket: bucketOf(quality),
      measure,
      builtIn: measure === "measured" ? byKey(builtInMetrics(record)) : {},
      imported: byKey(currentImportedMetrics(record, asset.sha256)),
      availability: assetAvailability(disk, catalog, asset),
      number,
      order,
    }
  })
  return { session, frames, ops: op ? [op] : [], href: `/sessions/${session.id}?step=review` }
}

/** The bucket a frame lands in after a library mark. */
export function bucketAfterMark(value: "usable" | "unusable" | "unreviewed"): ReviewBucket {
  return value === "unusable" ? "rejected" : value === "usable" ? "picked" : "unreviewed"
}
