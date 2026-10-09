/**
 * Simulated operations (foundation-owned runner).
 *
 * Long app-owned work (indexing, measurement, import, preparation, cleanup,
 * archive, OS Trash moves, master adoption) runs as an Operation with
 * visible progress, per-item outcomes and exactly one settled status. The
 * foundation owns "index" (here) and "trash" (`store/actions/trash.ts`); a
 * slice owns another kind by registering an `OperationHandler` in its slice
 * definition. The runner advances every running operation once per tick.
 *
 * After a restart, operations that were running become "interrupted" with
 * their recorded items intact; Retry resumes from the recorded state and
 * never infers progress from file names (D09).
 */
import { runHref } from "@/domain/derive"
import { fileKey } from "@/domain/disk"
import { listLocation, markScanStopped, markVerificationPending, readFiles, settleLocationScan } from "@/domain/indexing"
import { unitCount } from "@/domain/labels"
import type { ActivityEvent, LocationId, Operation, OperationId, OperationItem, OperationKind, OperationScope, OperationStatus, OperationUnit, RunStep, SettledStatus } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { joinRefs, type MessageRef, msg, verbatim } from "@/lib/i18n"
import { nowIso, type PrototypeState, store } from "./core"

export interface OperationHandler {
  kind: OperationKind
  /**
   * Advance `op` by one tick and return the next state. Read the op from
   * `state.operations[op.id]`; settle it with `settleOperation` when done.
   * Return `state` itself when nothing changed, so nothing re-renders.
   */
  step: (state: PrototypeState, op: Operation) => PrototypeState
  /** Kind-specific bookkeeping when the user cancels, before the operation settles as canceled. */
  cancel?: (state: PrototypeState, op: Operation) => PrototypeState
  /** Where a canceled operation of this kind links in Activity. */
  href?: (op: Operation) => string | null
  /** Work that resumes by itself after a restart (a folder watch) stays running instead of interrupted. */
  survivesRestart?: boolean
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
  title: MessageRef
  scope: OperationScope
  total: number
  unit: OperationUnit
  items?: OperationItem[]
  payload?: Record<string, unknown>
  canPause?: boolean
  canCancel?: boolean
}

/**
 * Add a running operation to `state` without touching the store, for an
 * action's `commit` mutator or another operation's step. The caller runs
 * `ensureTicker()` once the state is applied (a step already runs in the ticker).
 */
export function addOperation(state: PrototypeState, init: StartOperation): { state: PrototypeState; id: OperationId } {
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
  return { state: { ...state, operations: { ...state.operations, [id]: op } }, id }
}

export function startOperation(init: StartOperation): OperationId {
  let id = ""
  store.setState((s) => {
    const added = addOperation(s, init)
    id = added.id
    return added.state
  })
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
export function settleOperation(state: PrototypeState, id: OperationId, status: SettledStatus, summary: MessageRef, href: string | null = null): PrototypeState {
  const op = state.operations[id]
  if (!op) return state
  const now = nowIso()
  const event: ActivityEvent = { id: `act_${id}`, at: now, kind: "operation", title: op.title, detail: summary, status, operationId: id, href }
  return {
    ...state,
    operations: { ...state.operations, [id]: { ...op, status, summary, settledAt: now, updatedAt: now } },
    activity: [event, ...state.activity].slice(0, 200),
  }
}

/** The word a settled operation reads in Activity: "Import finished". */
const SETTLED_WORD: Record<SettledStatus, MessageRef> = {
  succeeded: msg("op_settled_succeeded"),
  partial: msg("op_settled_partial"),
  failed: msg("op_settled_failed"),
  canceled: msg("op_settled_canceled"),
}

/** An Activity entry's title: an operation's reads "<title>: finished", other entries their own title. */
export function activityTitle(event: Pick<ActivityEvent, "title" | "status">): MessageRef {
  return event.status ? msg("op_settled_title", { title: event.title, outcome: SETTLED_WORD[event.status] }) : event.title
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
          return { ...item, status: "uncertain", detail: msg("op_index_canceled_item", { files: unitCount("files", current.observed.length) }) }
        }
        if (item.status === "pending") return { ...item, status: "skipped", detail: msg("op_index_not_started") }
        return item
      })
      next = patchOperation(next, id, { items })
    }
    const handler = handlers[op.kind]
    if (handler?.cancel) next = handler.cancel(next, op)
    // A canceled operation still links to its owning surface in Activity (seam 16).
    const runId = op.scope.runIds?.[0]
    const run = runId ? next.catalog.runs[runId] : undefined
    const step: Partial<Record<OperationKind, RunStep>> = { measure: "review", "import-measurements": "review", prepare: "prepare", cleanup: "done" }
    const href =
      handler?.href?.(op) ??
      (op.kind === "index"
        ? "/settings/locations"
        : op.kind === "adopt-master"
          ? "/calibration"
          : op.kind === "import"
            ? "/sessions"
            : run && step[op.kind]
              ? runHref(run, step[op.kind])
              : op.scope.projectId
                ? `/projects/${op.scope.projectId}`
                : null)
    return settleOperation(next, id, "canceled", msg("op_canceled_summary", { done, total: op.items.length || op.progress.total }), href)
  })
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

/** Called on load: running work from a previous session is interrupted, except work that resumes by itself. */
export function interruptRunningOperations(state: PrototypeState): PrototypeState {
  let next = state
  for (const op of Object.values(state.operations)) {
    if (op.status !== "running" || handlers[op.kind]?.survivesRestart) continue
    next = patchOperation(next, op.id, {
      status: "interrupted",
      summary: msg("op_interrupted_summary"),
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
  /** Ticks spent on the current network-share location (D-W12 pacing). */
  ticks?: number
}

const BATCH = 14
/** Files per tick while `faults.slowIndexing` is on. */
const SLOW_BATCH = 2
/** A network share is hashed over the network: one file every this many ticks (D-W12). */
const NETWORK_TICKS_PER_FILE = 5

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
      if (listing.offline) return { ...item, status: "blocked", detail: msg("op_index_offline") }
      return { ...item, status: "running", detail: msg("op_index_files_to_read", { count: listing.readable.length, n: formatCount(listing.readable.length) }) }
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
    const volume = next.disk.volumes[location.volumeId]
    const ticks = (payload.ticks ?? 0) + 1
    const size = volume?.network ? (ticks % NETWORK_TICKS_PER_FILE === 0 ? 1 : 0) : next.faults.slowIndexing ? SLOW_BATCH : BATCH
    const batchPaths = volumeMounted ? current.pending.slice(0, size) : []
    const files = batchPaths.map((p) => next.disk.files[fileKey(location.volumeId, p)]).filter((f) => f !== undefined)
    if (files.length > 0) next = { ...next, catalog: readFiles(next.catalog, location, files, nowIso()) }
    const observed = [...current.observed, ...batchPaths]
    const pending = current.pending.slice(batchPaths.length)
    payload = { ...payload, ticks, current: { ...current, pending, observed }, counts: { ...payload.counts, read: payload.counts.read + files.length } }

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
        if (!volumeMounted) return { ...item, status: "blocked", detail: msg("op_index_went_offline", { files: unitCount("files", observed.length) }) }
        if (settled.access === "denied") return { ...item, status: "blocked", detail: msg("op_index_access_denied") }
        if (settled.scanScope === "incomplete") return { ...item, status: "uncertain", detail: msg("op_index_incomplete", { count: settled.unreadablePaths.length }) }
        return { ...item, status: "done", detail: msg("op_index_files_read", { count: observed.length, n: formatCount(observed.length) }) }
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
  const { read, unsupported, unreadableFolders } = payload.counts
  const parts = [
    msg("op_index_files_read", { count: read, n: formatCount(read) }),
    unsupported ? msg("op_index_unsupported", { count: unsupported }) : null,
    unreadableFolders ? msg("op_index_unreadable_folders", { count: unreadableFolders }) : null,
    blocked
      ? op.items.length === 1
        ? msg("op_index_scope_incomplete")
        : msg("op_index_locations_incomplete", { blocked, count: op.items.length })
      : msg("op_index_locations_complete", { count: op.items.length }),
  ].filter((part) => part !== null)
  // Indexing outcomes belong to the locations they scanned (seam 16).
  return settleOperation(state, id, blocked ? "partial" : "succeeded", joinRefs(parts, " · "), "/settings/locations")
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
    title: locations.length === 1 ? msg("op_index_title_one", { name: locations[0]!.displayName }) : msg("op_index_title_many", { count: locations.length }),
    scope: { locationIds: locations.map((l) => l.id) },
    total,
    unit: "files",
    items: locations.map((l) => ({ id: l.id, label: verbatim(l.displayName), path: l.path, status: "pending", phase: null, detail: null })),
    payload: payload as unknown as Record<string, unknown>,
    // Pause stops between batches; Resume continues from `current.pending`.
    canPause: true,
    canCancel: true,
  })
  return id
}

registerOperationHandlers([indexHandler])
