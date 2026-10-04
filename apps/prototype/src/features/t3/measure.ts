/**
 * Built-in measurement during frame review (PIX-FR-01, PIX-AC-01, PIX-AC-10).
 * One "measure" operation per review: it first re-hashes frames with cached
 * values ("Verifying"), restores an earlier record when the bytes match it
 * again, then measures the rest, the current frame first. Cancel (foundation)
 * stops it; frames it never reached read "Not measured". Measurement never
 * changes membership or quality (PIX-FR-08).
 */
import { BUILT_IN_METHOD, simulateMeasurement } from "@/domain/measurement"
import type { AssetId, Catalog, FrameMeasurement, MeasurementRecord, Metric, Operation, OperationId, OperationItem, ViewId } from "@/domain/types"
import { plural } from "@/lib/format"
import { nowIso, type PrototypeState, store } from "@/store/core"
import { type OperationHandler, isSettled, patchOperation, settleOperation, startOperation } from "@/store/operations"
import { currentFile, pixelScaleFor, sessionLabel } from "./model"

interface MeasurePayload {
  viewId: ViewId
  verify: AssetId[]
  queue: AssetId[]
  /** Frames that could not be read when their turn came (offline, unreadable, absent). */
  skipped: AssetId[]
  measured: number
  reused: number
  total: number
  /** Frames per session, for per-session item progress. */
  perSession: Record<string, AssetId[]>
}

const VERIFY_BATCH = 24
const MEASURE_BATCH = 3

/** Latest measure operation of a View, settled or not. */
export function latestMeasureOp(state: PrototypeState, viewId: ViewId): Operation | undefined {
  return Object.values(state.operations)
    .filter((op) => op.kind === "measure" && (op.payload as unknown as MeasurePayload).viewId === viewId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .at(-1)
}

export type FrameMeasureState = "verifying" | "pending" | "measured" | "history-only" | "not-measured"

/** What a frame reads in review, from the catalog record and the running operation. */
export function frameMeasureState(catalog: Catalog, assetId: AssetId, op: Operation | undefined): FrameMeasureState {
  if (op && !isSettled(op.status)) {
    const payload = op.payload as unknown as MeasurePayload
    if (payload.verify.includes(assetId)) return "verifying"
    if (payload.queue.includes(assetId)) return op.status === "running" ? "pending" : "not-measured"
  }
  const asset = catalog.assets[assetId]
  const record = catalog.measurements[assetId]
  if (!asset || !record || record.inputSha256 === null) return "not-measured"
  if (record.state === "valid" && record.inputSha256 === asset.sha256) return "measured"
  return "history-only"
}

/** Built-in metrics of a record that applies to the frame's current bytes. */
export function builtInMetrics(record: FrameMeasurement | undefined): Metric[] {
  return record?.metrics.filter((m) => m.source === "built-in") ?? []
}

export function importedMetricsOf(record: FrameMeasurement | undefined): Metric[] {
  return record?.metrics.filter((m) => m.source === "imported") ?? []
}

function snapshot(record: FrameMeasurement): MeasurementRecord | null {
  if (!record.inputSha256 || !record.computedAt || record.state === "pending" || record.state === "verifying") return null
  return { inputSha256: record.inputSha256, state: record.state, metrics: builtInMetrics(record), computedAt: record.computedAt }
}

/**
 * Start review measurement for `assetIds` unless one is already unsettled for
 * this View. Returns the running operation id, or null when nothing needs work.
 */
export function startMeasurement(viewId: ViewId, assetIds: AssetId[]): OperationId | null {
  const state = store.getState()
  const existing = latestMeasureOp(state, viewId)
  if (existing && !isSettled(existing.status)) return existing.id
  const { catalog } = state
  const verify: AssetId[] = []
  const queue: AssetId[] = []
  const perSession: Record<string, AssetId[]> = {}
  for (const id of assetIds) {
    const asset = catalog.assets[id]
    if (!asset) continue
    const record = catalog.measurements[id]
    if (record?.inputSha256) verify.push(id)
    else queue.push(id)
    const key = asset.sessionId ?? "none"
    perSession[key] = [...(perSession[key] ?? []), id]
  }
  const total = verify.length + queue.length
  if (total === 0) return null
  const items: OperationItem[] = Object.entries(perSession).map(([sessionId, ids]) => {
    const session = catalog.sessions[sessionId]
    return { id: sessionId, label: session ? sessionLabel(session) : "Frames without a session", path: null, status: "pending", phase: null, detail: `0 of ${ids.length} frames` }
  })
  const payload: MeasurePayload = { viewId, verify, queue, skipped: [], measured: 0, reused: 0, total, perSession }
  return startOperation({
    kind: "measure",
    title: "Measure frames",
    scope: { viewIds: [viewId] },
    total,
    unit: "frames",
    items,
    payload: payload as unknown as Record<string, unknown>,
    canCancel: true,
  })
}

/** Re-hash a cached frame. Returns a record to write when an earlier one applies again; otherwise counts or queues it. */
function verifyOne(state: PrototypeState, id: AssetId, payload: MeasurePayload): FrameMeasurement | null {
  const asset = state.catalog.assets[id]
  const record = state.catalog.measurements[id]
  const file = asset ? currentFile(state.disk, state.catalog, asset) : undefined
  if (!asset || !record || !file) {
    payload.skipped.push(id)
    return null
  }
  if (record.inputSha256 === file.sha256 && record.state === "valid") {
    payload.reused += 1
    return null
  }
  // The bytes match an earlier record again (restored content): it applies once more.
  const earlier = record.history.find((h) => h.inputSha256 === file.sha256 && h.state === "valid")
  if (!earlier) {
    payload.queue.push(id)
    return null
  }
  payload.reused += 1
  const current = snapshot(record)
  return {
    ...record,
    state: "valid",
    inputSha256: earlier.inputSha256,
    computedAt: earlier.computedAt,
    metrics: [...earlier.metrics, ...importedMetricsOf(record)],
    history: [...(current ? [current] : []), ...record.history.filter((h) => h !== earlier)],
  }
}

/** Measure one frame from its current bytes; the earlier record becomes history, imported values stay. */
function measureOne(state: PrototypeState, id: AssetId, payload: MeasurePayload): FrameMeasurement | null {
  const asset = state.catalog.assets[id]
  const file = asset ? currentFile(state.disk, state.catalog, asset) : undefined
  if (!asset || !file) {
    payload.skipped.push(id)
    return null
  }
  const session = asset.sessionId ? state.catalog.sessions[asset.sessionId] : undefined
  const result = simulateMeasurement(asset, file, pixelScaleFor(state.catalog, session), nowIso())
  const previous = state.catalog.measurements[id]
  const earlier = previous && previous.inputSha256 !== result.inputSha256 ? snapshot(previous) : null
  payload.measured += 1
  return {
    ...result,
    metrics: [...result.metrics, ...importedMetricsOf(previous)],
    history: [...(earlier ? [earlier] : []), ...(previous?.history ?? [])],
  }
}

export const measureHandler: OperationHandler = {
  kind: "measure",
  step(state, op) {
    const source = op.payload as unknown as MeasurePayload
    const payload: MeasurePayload = { ...source, verify: [...source.verify], queue: [...source.queue], skipped: [...source.skipped] }
    const writes: FrameMeasurement[] = []
    if (payload.verify.length > 0) {
      for (const id of payload.verify.splice(0, VERIFY_BATCH)) {
        const record = verifyOne(state, id, payload)
        if (record) writes.push(record)
      }
    } else {
      // Selected work first: the current frame jumps the queue (PIX-FR-01).
      const active = state.slices.t3.frames[payload.viewId]?.activeAssetId
      const index = active ? payload.queue.indexOf(active) : -1
      if (index > 0) payload.queue.unshift(...payload.queue.splice(index, 1))
      for (const id of payload.queue.splice(0, MEASURE_BATCH)) {
        const record = measureOne(state, id, payload)
        if (record) writes.push(record)
      }
    }
    const measurements = { ...state.catalog.measurements }
    for (const record of writes) measurements[record.assetId] = record
    let next: PrototypeState = writes.length > 0 ? { ...state, catalog: { ...state.catalog, measurements } } : state
    const remaining = new Set([...payload.verify, ...payload.queue])
    const items = op.items.map((item): OperationItem => {
      const ids = payload.perSession[item.id] ?? []
      const left = ids.filter((id) => remaining.has(id)).length
      const skipped = ids.filter((id) => payload.skipped.includes(id)).length
      const done = ids.length - left
      const status = left > 0 ? (done > 0 ? "running" : "pending") : skipped > 0 ? "blocked" : "done"
      const detail = skipped > 0 ? `${done - skipped} of ${ids.length} frames; ${skipped} not readable` : `${done} of ${ids.length} frames`
      return { ...item, status, detail }
    })
    next = patchOperation(next, op.id, {
      payload: payload as unknown as Record<string, unknown>,
      items,
      progress: { done: payload.total - remaining.size, total: payload.total, unit: "frames" },
    })
    if (remaining.size > 0) return next
    const parts = [`${plural(payload.measured, "frame")} measured`, `${payload.reused} cached ${payload.reused === 1 ? "value" : "values"} still valid`]
    if (payload.skipped.length > 0) parts.push(`${payload.skipped.length} not measured: no readable copy`)
    return settleOperation(
      next,
      op.id,
      payload.skipped.length > 0 ? "partial" : "succeeded",
      `${parts.join(", ")}. ${BUILT_IN_METHOD.method}, linear data. No exclusion or quality change.`,
      `/views/${payload.viewId}/frames`,
    )
  },
}

/** Frames left unmeasured by the last settled (canceled, partial) review. */
export function unfinishedCount(op: Operation | undefined): number {
  if (!op || !isSettled(op.status)) return 0
  const payload = op.payload as unknown as MeasurePayload
  return payload.verify.length + payload.queue.length
}

export const METRIC_LABEL: Record<Metric["key"], string> = {
  fwhm: "FWHM",
  hfr: "HFR",
  eccentricity: "Eccentricity",
  "star-count": "Star count",
  background: "Background",
  snr: "SNR",
}

/** "6.42″", "2.10 px", "0.41", "1,820 stars", "880 ADU"; null values never become numbers. */
export function formatMetric(metric: Pick<Metric, "value" | "unit">): string {
  if (metric.value === null) return "Not reported"
  const value = metric.unit === "stars" || metric.unit === "ADU" ? metric.value.toLocaleString("en-GB") : String(metric.value)
  if (metric.unit === "arcsec") return `${value}″`
  if (metric.unit === "ratio" || metric.unit === "") return value
  return `${value} ${metric.unit}`
}
