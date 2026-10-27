/**
 * Library events: the live half of a durable read.
 *
 * The library host emits five events, whose names and payload types the
 * generated client exports (`library_specta_builder`). An event can be lost:
 * one emitted before a listener attaches, while the webview reloads, or
 * across a restart reaches nobody. The status command it reports on stays
 * the truth. So an event never replaces a read; it only says that a read is
 * due.
 *
 * - `listenLibraryEvent` attaches a typed listener and resolves the function
 *   that detaches it.
 * - `useLibraryEvent` keeps one listener for a component's lifetime, calling
 *   its latest handler. It detaches on unmount, also when the unmount comes
 *   before the attach has finished. It reports whether the attach succeeded.
 * - `useRefreshOnEvent` refetches the queries under a key on each event, and
 *   once when its listener attaches, so a read covers whatever was emitted
 *   before the listener existed.
 */
import { type QueryClient, type QueryKey, useQueryClient } from "@tanstack/react-query"
import { listen, type UnlistenFn } from "@tauri-apps/api/event"
import { useEffect, useMemo, useRef, useState } from "react"
import {
  APPLY_WAITING_EVENT,
  type ApplyWaiting,
  MEASUREMENT_PROGRESS_EVENT,
  type MeasurementProgress_Serialize,
  NEW_CAPTURES_EVENT,
  type NewCaptures,
  SCAN_PROGRESS_EVENT,
  type ScanProgressEvent,
  NATIVE_QUIT_CONFIRM_EVENT,
  type NativeQuitRequest,
} from "./ipc"

/** The payload each library event carries, as the host serialises it. */
export interface LibraryEventPayloads {
  [SCAN_PROGRESS_EVENT]: ScanProgressEvent
  [MEASUREMENT_PROGRESS_EVENT]: MeasurementProgress_Serialize
  [NEW_CAPTURES_EVENT]: NewCaptures
  [APPLY_WAITING_EVENT]: ApplyWaiting
  [NATIVE_QUIT_CONFIRM_EVENT]: NativeQuitRequest
}

export type LibraryEventName = keyof LibraryEventPayloads

/** Whether a component's listener is attached; a failed attach means no live updates, only reads. */
export type EventAttachment = { state: "attaching" } | { state: "attached" } | { state: "failed"; detail: string }

const ATTACHING: EventAttachment = { state: "attaching" }
const ATTACHED: EventAttachment = { state: "attached" }

/** Attach `handler` to `event`; resolves the function that detaches it. */
export function listenLibraryEvent<E extends LibraryEventName>(
  event: E,
  handler: (payload: LibraryEventPayloads[E]) => void,
): Promise<UnlistenFn> {
  return listen<LibraryEventPayloads[E]>(event, (message) => handler(message.payload))
}

/** One listener on `event` while the component is mounted; `onAttached` runs once it is attached. */
export function useLibraryEvent<E extends LibraryEventName>(
  event: E,
  handler: (payload: LibraryEventPayloads[E]) => void,
  onAttached?: () => void,
): EventAttachment {
  const [attachment, setAttachment] = useState<EventAttachment>(ATTACHING)
  const latest = useRef({ handler, onAttached })
  useEffect(() => {
    latest.current = { handler, onAttached }
  })
  useEffect(() => {
    let disposed = false
    let detach: UnlistenFn | undefined
    setAttachment(ATTACHING)
    listenLibraryEvent(event, (payload) => {
      if (!disposed) latest.current.handler(payload)
    }).then(
      (unlisten) => {
        if (disposed) {
          unlisten()
          return
        }
        detach = unlisten
        setAttachment(ATTACHED)
        latest.current.onAttached?.()
      },
      (rejection: unknown) => {
        if (!disposed) {
          setAttachment({ state: "failed", detail: rejection instanceof Error ? rejection.message : String(rejection) })
        }
      },
    )
    return () => {
      disposed = true
      detach?.()
    }
  }, [event])
  return attachment
}

/**
 * Refetch the queries under `queryKey` on each `event` that `matches`, and
 * once when the listener attaches. The queries read durable status, so that
 * first refetch recovers what was emitted before the listener existed.
 */
export function useRefreshOnEvent<E extends LibraryEventName>(
  event: E,
  queryKey: QueryKey,
  matches?: (payload: LibraryEventPayloads[E]) => boolean,
): EventAttachment {
  const client = useQueryClient()
  const key = useRef(queryKey)
  useEffect(() => {
    key.current = queryKey
  })
  const refresh = useMemo(() => createRefresher(client, () => key.current), [client])
  return useLibraryEvent(
    event,
    (payload) => {
      if (matches === undefined || matches(payload)) void refresh()
    },
    () => void refresh(),
  )
}

/**
 * A refresh of the queries under `queryKey()` that always ends with a read
 * started after the latest request. A read already running when a request
 * arrives may predate it, so one more read follows; requests during a read
 * coalesce into one. It never cancels a read, so a burst of events cannot
 * starve the query of a result.
 */
export function createRefresher(client: QueryClient, queryKey: () => QueryKey): () => Promise<void> {
  let running: Promise<void> | null = null
  let again = false
  const drain = async () => {
    do {
      again = false
      const key = queryKey()
      if (client.isFetching({ queryKey: key }) > 0) again = true
      await client.invalidateQueries({ queryKey: key }, { cancelRefetch: false })
    } while (again)
    running = null
  }
  return () => {
    if (running) {
      again = true
      return running
    }
    running = drain()
    return running
  }
}
