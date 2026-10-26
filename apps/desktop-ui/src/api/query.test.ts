import { MutationObserver, onlineManager } from "@tanstack/react-query"
import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { afterEach, describe, expect, it } from "vitest"
import { data, library } from "./ipc"
import { createQueryClient, libraryKey, libraryQuery } from "./query"

afterEach(() => {
  clearMocks()
  onlineManager.setOnline(true)
})

describe("createQueryClient", () => {
  it("reads and writes the library while the machine is offline", async () => {
    onlineManager.setOnline(false)
    const writes: string[] = []
    mockIPC((command) => {
      if (command === "library_cancel_scan") writes.push(command)
      return []
    })
    const client = createQueryClient()

    await expect(client.fetchQuery(libraryQuery("libraryListLocations"))).resolves.toEqual([])
    const cancel = new MutationObserver(client, {
      mutationFn: (operationId: string) => data(library.libraryCancelScan(operationId)),
    })
    await expect(cancel.mutate("op-1")).resolves.toEqual([])
    expect(writes).toEqual(["library_cancel_scan"])
  })

  it("does not retry a refused read", async () => {
    let reads = 0
    mockIPC(() => {
      reads += 1
      return Promise.reject({
        code: "not_found",
        identity: "op-1",
        scope: null,
        retry: "none",
        currentRevision: null,
        successors: [],
        window: null,
        correction: null,
      })
    })
    const client = createQueryClient()

    await expect(client.fetchQuery(libraryQuery("libraryScanStatus", "op-1"))).rejects.toThrow("libraryScanStatus")
    expect(reads).toBe(1)
  })
})

describe("libraryKey", () => {
  it("lets one command key invalidate every read of that command", async () => {
    mockIPC(() => ({ id: "op" }))
    const client = createQueryClient()
    await client.fetchQuery(libraryQuery("libraryScanStatus", "op-1"))
    await client.fetchQuery(libraryQuery("libraryScanStatus", "op-2"))
    await client.fetchQuery(libraryQuery("libraryListLocations"))

    await client.invalidateQueries({ queryKey: libraryKey("libraryScanStatus") })

    const invalidated = (key: readonly unknown[]) => client.getQueryState(key)?.isInvalidated
    expect(invalidated(libraryKey("libraryScanStatus", "op-1"))).toBe(true)
    expect(invalidated(libraryKey("libraryScanStatus", "op-2"))).toBe(true)
    expect(invalidated(libraryKey("libraryListLocations"))).toBe(false)
  })
})
