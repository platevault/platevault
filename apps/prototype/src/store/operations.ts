/**
 * Simulated operations (foundation-owned runner).
 *
 * Long app-owned work (indexing, measurement, preparation, cleanup, archive,
 * filing, master adoption) runs as an Operation with visible progress,
 * per-item outcomes and exactly one settled status. A track owns an
 * operation kind by registering an `OperationHandler` in its slice
 * definition; the runner advances every running operation once per tick.
 *
 * After a restart, operations that were running become "interrupted" with
 * their recorded items intact; Retry resumes from the recorded state and
 * never infers progress from file names (D09).
 */
import { fileKey } from "@/domain/disk"
import { listLocation, markScanStopped, markVerificationPending, readFiles, settleLocationScan } from "@/domain/indexing"
import type { LocationId, Operation, OperationId, OperationItem, OperationKind, OperationScope, OperationStatus } from "@/domain/types"
import { plural } from "@/lib/format"
import { nowIso, type PrototypeState, store } from "./core"

export interface OperationHandler {
  kind: OperationKind
  /**
   * Advance `op` by one tick and return the next state. Read the op from
   * `state.operations[op.id]`; settle it with `settleOperation` when done.
   */
  step: (state: PrototypeState, op: Operation) => PrototypeState
}

const handlers: Partial<Record<OperationKind, OperationHandler>> = {}

export function registerOperationHandlers(list: OperationHandler[]) {
  for (const handler of list) handlers[handler.kind] = handler
}

export const TICK_MS = 160

const SETTLED: OperationStatus[] = ["succeeded", "partial", "failed", "canceled"]

export function isSettled(status: OperationStatus): boolean {
  return SETTLED.includes(status)
}

let opCounter = 0

export interface StartOperation {
  kind: OperationKind
  title: string
  scope: OperationScope
  total: number
  unit: string
  items?: OperationItem[]
  payload?: Record<string, unknown>
  canPause?: boolean
  canCancel?: boolean
}

export function startOperation(init: StartOperation): OperationId {
  opCounter += 1
  const id = `op_${init.kind}_${Date.now().toString(36)}_${opCounter}`
  const now = nowIso()
  const op: Operation = {
    id,
    kind: init.kind,
    title: init.title,
    status: "running",
    scope: init.scope,
    progress: { done: 0, total: init.total, unit: init.unit },
    items: init.items ?? [],
    summary: null,
    canPause: init.canPause ?? false,
    canCancel: init.canCancel ?? true,
    payload: init.payload ?? {},
    createdAt: now,
    updatedAt: now,
    settledAt: null,
  }
  store.setState((s) => ({ ...s, operations: { ...s.operations, [id]: op } }))
  ensureTicker()
  return id
}

/** Patch an operation inside a handler step or action. */
export function patchOperation(state: PrototypeState, id: OperationId, patch: Partial<Operation>): PrototypeState {
  const op = state.operations[id]
  if (!op) return state
  return { ...state, operations: { ...state.operations, [id]: { ...op, ...patch, updatedAt: nowIso() } } }
}

/** Settle an operation and record its outcome in Activity. */
export function settleOperation(
  state: PrototypeState,
  id: OperationId,
  status: Exclude<OperationStatus, "running" | "paused" | "interrupted">,
  summary: string,
  href: string | null = null,
): PrototypeState {
  const op = state.operations[id]
  if (!op) return state
  const now = nowIso()
  const event = {
    id: `act_${id}`,
    at: now,
    kind: "operation" as const,
    title: `${op.title}: ${STATUS_WORD[status]}`,
    detail: summary,
    operationId: id,
    href,
  }
  return {
    ...state,
    operations: { ...state.operations, [id]: { ...op, status, summary, settledAt: now, updatedAt: now } },
    activity: [event, ...state.activity].slice(0, 200),
  }
}

const STATUS_WORD: Record<Exclude<OperationStatus, "running" | "paused" | "interrupted">, string> = {
  succeeded: "finished",
  partial: "partial",
  failed: "failed",
  canceled: "canceled",
}

export function pauseOperation(id: OperationId) {
  store.setState((s) => (s.operations[id]?.canPause ? patchOperation(s, id, { status: "paused" }) : s))
}

/** Resume a paused or interrupted operation from its recorded state. */
export function resumeOperation(id: OperationId) {
  store.setState((s) => {
    const op = s.operations[id]
    if (!op || (op.status !== "paused" && op.status !== "interrupted")) return s
    return patchOperation(s, id, { status: "running", summary: null })
  })
  ensureTicker()
}

export function cancelOperation(id: OperationId) {
  store.setState((s) => {
    const op = s.operations[id]
    if (!op || isSettled(op.status) || !op.canCancel) return s
    const done = op.items.filter((i) => i.status === "done").length
    let next = s
    if (op.kind === "index") {
      const { current } = op.payload as unknown as IndexPayload
      // A canceled index leaves the location it was reading incomplete, never provisional (LIB-FR-03).
      if (current) next = { ...next, catalog: markScanStopped(next.catalog, current.locationId, nowIso()) }
      const items = op.items.map((item): OperationItem => {
        if (item.id === current?.locationId) {
          return { ...item, status: "uncertain", detail: `Canceled after ${plural(current.observed.length, "file")}. Incomplete until indexed again.` }
        }
        if (item.status === "pending") return { ...item, status: "skipped", detail: "Not started: indexing was canceled." }
        return item
      })
      next = patchOperation(next, id, { items })
    }
    // A canceled operation still links to its owning surface in Activity (seam 16).
    const viewId = op.scope.viewIds?.[0]
    const area = { measure: "frames", "import-measurements": "frames", prepare: "prepare", cleanup: "cleanup" } as Partial<Record<OperationKind, string>>
    const href =
      op.kind === "index"
        ? "/settings/locations"
        : op.kind === "archive" || op.kind === "filing"
          ? `/storage/transfers/${op.id}`
          : op.kind === "adopt-master"
            ? "/calibration"
            : viewId && area[op.kind]
              ? `/views/${viewId}/${area[op.kind]}`
              : null
    return settleOperation(
      next,
      id,
      "canceled",
      `Canceled. ${done} of ${op.items.length || op.progress.total} items finished before cancel; nothing else was changed.`,
      href,
    )
  })
}

/**
 * Unsettled operations (running, paused or interrupted) that affect a View;
 * Mark complete waits for them (RES-AC-07, D09). Archive and filing list
 * every View whose members they move in `scope.viewIds`.
 */
export function unsettledOperationsForView(state: PrototypeState, viewId: string): Operation[] {
  return Object.values(state.operations).filter((op) => op.scope.viewIds?.includes(viewId) && !isSettled(op.status))
}

let timer: number | null = null

function tick() {
  const state = store.getState()
  const running = Object.values(state.operations).filter((op) => op.status === "running")
  if (running.length === 0) {
    window.clearInterval(timer ?? undefined)
    timer = null
    return
  }
  store.setState((current) => {
    let next = current
    for (const op of running) {
      const handler = handlers[op.kind]
      const latest = next.operations[op.id]
      if (!handler || !latest || latest.status !== "running") continue
      next = handler.step(next, latest)
    }
    return next
  })
}

export function ensureTicker() {
  if (timer) return
  timer = window.setInterval(tick, TICK_MS)
}

/** Called on load: running work from a previous session is interrupted. */
export function interruptRunningOperations(state: PrototypeState): PrototypeState {
  let next = state
  for (const op of Object.values(state.operations)) {
    if (op.status !== "running") continue
    next = patchOperation(next, op.id, {
      status: "interrupted",
      summary: "PlateVault restarted while this was running. Recorded progress is kept; Retry resumes it.",
    })
  }
  return next
}

// ---------------------------------------------------------------------------
// Indexing (foundation-provided because onboarding (T1) and the library (T2)
// both start it). Reads a batch of files per tick; results are browsable
// while it runs and totals are provisional until it settles.
// ---------------------------------------------------------------------------

interface IndexPayload {
  queue: LocationId[]
  current: { locationId: LocationId; pending: string[]; observed: string[] } | null
  counts: { discovered: number; read: number; unsupported: number; unreadableFolders: number }
}

const BATCH = 14
/** Files per tick while `faults.slowIndexing` is on. */
const SLOW_BATCH = 2

function startNextLocation(state: PrototypeState, op: Operation, payload: IndexPayload): { state: PrototypeState; payload: IndexPayload } {
  let next = state
  const queue = [...payload.queue]
  while (queue.length > 0) {
    const locationId = queue.shift()!
    const location = next.catalog.locations[locationId]
    if (!location) continue
    const listing = listLocation(next.disk, location)
    const items = op.items.map((item): OperationItem => {
      if (item.id !== locationId) return item
      if (listing.offline) return { ...item, status: "blocked", detail: "Offline. Last-observed metadata and decisions are kept." }
      return { ...item, status: "running", detail: `${listing.readable.length} files to read` }
    })
    next = patchOperation(next, op.id, { items })
    if (listing.offline) continue
    next = { ...next, catalog: markVerificationPending(next.catalog, locationId) }
    return {
      state: next,
      payload: {
        queue,
        current: { locationId, pending: listing.readable.map((f) => f.path), observed: [] },
        counts: {
          ...payload.counts,
          discovered: payload.counts.discovered + listing.readable.length + listing.unsupported.length,
          unsupported: payload.counts.unsupported + listing.unsupported.length,
          unreadableFolders: payload.counts.unreadableFolders + listing.unreadableFolders.length,
        },
      },
    }
  }
  return { state: next, payload: { ...payload, queue, current: null } }
}

const indexHandler: OperationHandler = {
  kind: "index",
  step(state, op) {
    let payload = op.payload as unknown as IndexPayload
    let next = state
    if (!payload.current) {
      const started = startNextLocation(next, op, payload)
      next = started.state
      payload = started.payload
      if (!payload.current) return finishIndex(next, op.id, payload)
    }
    const current = payload.current!
    const location = next.catalog.locations[current.locationId]!
    const volumeMounted = next.disk.volumes[location.volumeId]?.mounted
    const batchPaths = volumeMounted ? current.pending.slice(0, next.faults.slowIndexing ? SLOW_BATCH : BATCH) : []
    const files = batchPaths.map((p) => next.disk.files[fileKey(location.volumeId, p)]).filter((f) => f !== undefined)
    if (files.length > 0) next = { ...next, catalog: readFiles(next.catalog, location, files, nowIso()) }
    const observed = [...current.observed, ...batchPaths]
    const pending = current.pending.slice(batchPaths.length)
    payload = { ...payload, current: { ...current, pending, observed }, counts: { ...payload.counts, read: payload.counts.read + files.length } }

    if (!volumeMounted || pending.length === 0) {
      next = { ...next, catalog: settleLocationScan(next.catalog, next.disk, current.locationId, new Set(observed), nowIso()) }
      const settled = next.catalog.locations[current.locationId]!
      next = {
        ...next,
        catalog: { ...next.catalog, locations: { ...next.catalog.locations, [settled.id]: { ...settled, lastScanOperationId: op.id } } },
      }
      const latest = next.operations[op.id]!
      const items = latest.items.map((item): OperationItem => {
        if (item.id !== current.locationId) return item
        if (!volumeMounted) return { ...item, status: "blocked", detail: `Went offline after ${observed.length} files. Files read so far are kept.` }
        if (settled.access === "denied") return { ...item, status: "blocked", detail: "Access denied. Choose folder again or Retry." }
        if (settled.scanScope === "incomplete") {
          return { ...item, status: "uncertain", detail: `Incomplete: ${settled.unreadablePaths.length} folder unreadable. Readable folders were indexed.` }
        }
        return { ...item, status: "done", detail: `${observed.length} files read` }
      })
      next = patchOperation(next, op.id, { items })
      payload = { ...payload, current: null }
    }
    next = patchOperation(next, op.id, {
      payload: payload as unknown as Record<string, unknown>,
      // Unsupported files are discovered and skipped up front, so they count as processed.
      progress: { done: payload.counts.read + payload.counts.unsupported, total: Math.max(payload.counts.discovered, op.progress.total), unit: "files" },
    })
    if (!payload.current && payload.queue.length === 0) return finishIndex(next, op.id, payload)
    return next
  },
}

function finishIndex(state: PrototypeState, id: OperationId, payload: IndexPayload): PrototypeState {
  const op = state.operations[id]!
  const blocked = op.items.filter((i) => i.status === "blocked" || i.status === "uncertain").length
  const summary = [
    `${payload.counts.read} files read`,
    payload.counts.unsupported ? `${payload.counts.unsupported} unsupported` : null,
    payload.counts.unreadableFolders ? `${payload.counts.unreadableFolders} unreadable folder${payload.counts.unreadableFolders === 1 ? "" : "s"}` : null,
    blocked
      ? op.items.length === 1
        ? "scope incomplete or unavailable"
        : `${blocked} of ${op.items.length} locations incomplete or unavailable`
      : `${op.items.length} location${op.items.length === 1 ? "" : "s"} complete`,
  ]
    .filter(Boolean)
    .join(" · ")
  // Indexing outcomes belong to the locations they scanned (seam 16).
  return settleOperation(state, id, blocked ? "partial" : "succeeded", summary, "/settings/locations")
}

/**
 * Index the given locations in place. Registering never indexes by itself;
 * this records metadata only and never changes source files. A retired
 * location is never rescanned (LIB-FR-15).
 */
export function startIndexing(locationIds: LocationId[]): OperationId {
  const state = store.getState()
  const locations = locationIds.map((id) => state.catalog.locations[id]).filter((l): l is NonNullable<typeof l> => l !== undefined && !l.retiredAt)
  const total = locations.reduce((sum, l) => sum + listLocation(state.disk, l).readable.length, 0)
  const payload: IndexPayload = {
    queue: locations.map((l) => l.id),
    current: null,
    counts: { discovered: 0, read: 0, unsupported: 0, unreadableFolders: 0 },
  }
  const id = startOperation({
    kind: "index",
    title: locations.length === 1 ? `Indexing ${locations[0]!.displayName}` : `Indexing ${locations.length} locations`,
    scope: { locationIds: locations.map((l) => l.id) },
    total,
    unit: "files",
    items: locations.map((l) => ({ id: l.id, label: l.displayName, path: l.path, status: "pending", phase: null, detail: null })),
    payload: payload as unknown as Record<string, unknown>,
    // Pause stops between batches; Resume continues from `current.pending`.
    canPause: true,
    canCancel: true,
  })
  return id
}

registerOperationHandlers([indexHandler])
