import { QueryClientProvider, QueryObserver, useQuery } from "@tanstack/react-query"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { act, renderHook, waitFor } from "@testing-library/react"
import type { ReactNode } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createRefresher, useLibraryEvent, useRefreshOnEvent } from "./events"
import { NEW_CAPTURES_EVENT, SCAN_PROGRESS_EVENT, type ScanProgressEvent } from "./ipc"
import { createQueryClient, libraryKey, libraryQuery } from "./query"

interface TauriInternals {
  __TAURI_INTERNALS__: { runCallback: (id: number, message: unknown) => void }
}

/**
 * The host's event plugin as the webview sees it: `listen` and `unlisten`
 * calls, and `emit`, which delivers to every attached listener of an event.
 * Other commands go to `commands`.
 */
function eventHost(commands: (command: string) => unknown = () => null) {
  const listeners = new Map<number, string>()
  mockIPC((command, args) => {
    const fields = (args ?? {}) as Record<string, unknown>
    if (command === "plugin:event|listen") {
      listeners.set(fields.handler as number, fields.event as string)
      return fields.handler
    }
    if (command === "plugin:event|unlisten") {
      listeners.delete(fields.eventId as number)
      return null
    }
    return commands(command)
  })
  const internals = (window as unknown as TauriInternals).__TAURI_INTERNALS__
  return {
    listeners,
    emit(event: string, payload: unknown) {
      for (const [id, name] of [...listeners]) {
        if (name === event) internals.runCallback(id, { event, id, payload })
      }
    },
  }
}

function scanProgress(operationId: string): ScanProgressEvent {
  return {
    operationId,
    revision: 1,
    locationId: "loc-1",
    state: "running",
    progress: { discovered: 1, metadataRead: 0, unsupported: 0, unreadable: 0, completeDirectories: 0 },
    completeScopes: [],
    incompleteScopes: [],
  }
}

afterEach(() => {
  clearMocks()
})

describe("useLibraryEvent", () => {
  it("delivers each event to the latest handler and detaches on unmount", async () => {
    const host = eventHost()
    const seen: string[] = []
    const onAttached = vi.fn()
    const { result, rerender, unmount } = renderHook(
      ({ tag }: { tag: string }) => useLibraryEvent(NEW_CAPTURES_EVENT, () => seen.push(tag), onAttached),
      { initialProps: { tag: "first" } },
    )

    await waitFor(() => expect(result.current).toEqual({ state: "attached" }))
    expect(onAttached).toHaveBeenCalledTimes(1)
    act(() => host.emit(NEW_CAPTURES_EVENT, { locations: [] }))
    rerender({ tag: "second" })
    act(() => host.emit(NEW_CAPTURES_EVENT, { locations: [] }))
    expect(seen).toEqual(["first", "second"])
    expect(host.listeners.size).toBe(1)

    unmount()
    await waitFor(() => expect(host.listeners.size).toBe(0))
    host.emit(NEW_CAPTURES_EVENT, { locations: [] })
    expect(seen).toEqual(["first", "second"])
  })

  it("detaches a listener whose attach finishes after the unmount", async () => {
    const host = eventHost()
    const handler = vi.fn()
    const { unmount } = renderHook(() => useLibraryEvent(SCAN_PROGRESS_EVENT, handler))

    unmount()
    host.emit(SCAN_PROGRESS_EVENT, scanProgress("op-1"))
    await waitFor(() => expect(host.listeners.size).toBe(0))
    expect(handler).not.toHaveBeenCalled()
  })

  it("reports a refused attach", async () => {
    mockIPC(() => Promise.reject("event.listen not allowed"))
    const { result, unmount } = renderHook(() => useLibraryEvent(SCAN_PROGRESS_EVENT, () => undefined))

    await waitFor(() => expect(result.current).toEqual({ state: "failed", detail: "event.listen not allowed" }))
    unmount()
  })
})

describe("useRefreshOnEvent", () => {
  it("reads durable status again once attached and on each matching event", async () => {
    let reads = 0
    const host = eventHost((command) => {
      if (command !== "library_scan_status") return null
      reads += 1
      return { id: "op-1", revision: reads }
    })
    const client = createQueryClient()
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    )
    const { result, unmount } = renderHook(
      () => {
        useRefreshOnEvent(
          SCAN_PROGRESS_EVENT,
          libraryKey("libraryScanStatus", "op-1"),
          (progress) => progress.operationId === "op-1",
        )
        return useQuery(libraryQuery("libraryScanStatus", "op-1"))
      },
      { wrapper },
    )

    // The first read, then the one that covers what was emitted before the listener attached.
    await waitFor(() => expect(result.current.data).toEqual({ id: "op-1", revision: 2 }))
    expect(reads).toBe(2)

    act(() => host.emit(SCAN_PROGRESS_EVENT, scanProgress("op-2")))
    act(() => host.emit(SCAN_PROGRESS_EVENT, scanProgress("op-1")))
    await waitFor(() => expect(result.current.data).toEqual({ id: "op-1", revision: 3 }))
    expect(reads).toBe(3)
    unmount()
  })
})

describe("createRefresher", () => {
  it("follows a read that predates the request and coalesces requests during a read", async () => {
    const client = createQueryClient()
    const key = ["library", "libraryScanStatus", "op-1"]
    const reads: ((revision: number) => void)[] = []
    const observer = new QueryObserver(client, {
      queryKey: key,
      queryFn: () => new Promise<number>((resolve) => reads.push(resolve)),
    })
    const unsubscribe = observer.subscribe(() => undefined)
    await waitFor(() => expect(reads).toHaveLength(1))
    const refresh = createRefresher(client, () => key)

    const settled = refresh()
    reads[0]?.(1)
    await waitFor(() => expect(reads).toHaveLength(2))
    void refresh()
    void refresh()
    reads[1]?.(2)
    await waitFor(() => expect(reads).toHaveLength(3))
    reads[2]?.(3)
    await settled

    expect(reads).toHaveLength(3)
    expect(observer.getCurrentResult().data).toBe(3)
    unsubscribe()
  })
})
