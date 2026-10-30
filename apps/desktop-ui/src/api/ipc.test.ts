import { clearMocks, mockIPC } from "@tauri-apps/api/mocks"
import { afterEach, describe, expect, it } from "vitest"
import { data, type ErrorResponse, failureOf, LibraryError, library, type NativePathWire } from "./ipc"

const dataPath: NativePathWire = { encoding: "unix-bytes", payload: [47, 100], display: "/d" }

/** A structured refusal, as the host serialises a `LibraryError`. */
const conflict: ErrorResponse = {
  code: "conflict",
  identity: "loc-1",
  scope: null,
  retry: "review",
  currentRevision: 4,
  successors: [],
  window: null,
  correction: null,
  field: null,
}

afterEach(() => {
  clearMocks()
})

describe("library", () => {
  it("invokes the registered command name with the generated arguments and resolves its data", async () => {
    const calls: [string, unknown][] = []
    mockIPC((command, args) => {
      calls.push([command, args])
      return { id: "loc-1" }
    })

    const result = await library.libraryRegisterLocation(dataPath, "Data", "captures")

    expect(result).toEqual({ ok: true, data: { id: "loc-1" } })
    expect(calls).toEqual([
      ["library_register_location", { path: dataPath, displayName: "Data", role: "captures" }],
    ])
  })

  it("resolves a structured refusal as the library's failure, without rejecting", async () => {
    mockIPC(() => Promise.reject(conflict))

    const result = await library.libraryScanStatus("op-1")

    expect(result).toEqual({
      ok: false,
      failure: { source: "library", command: "libraryScanStatus", error: conflict },
    })
  })

  it("reports a rejection that is no ErrorResponse as an IPC failure", async () => {
    // What Tauri rejects with for a command the host does not register.
    mockIPC(() => Promise.reject("command library_scan_status not found"))

    const result = await library.libraryScanStatus("op-1")

    expect(result).toEqual({
      ok: false,
      failure: { source: "ipc", command: "libraryScanStatus", detail: "command library_scan_status not found" },
    })
  })

  it("reports an object without the ErrorResponse shape as an IPC failure", async () => {
    mockIPC(() => Promise.reject({ code: "conflict" }))

    const result = await library.libraryScanStatus("op-1")

    expect(result.ok).toBe(false)
    expect(!result.ok && result.failure.source).toBe("ipc")
  })

  it("reports a missing runtime as an IPC failure instead of throwing", async () => {
    // No mockIPC: no Tauri internals, so the generated call throws a JS Error.
    const result = await library.libraryListLocations()

    expect(result.ok).toBe(false)
    expect(!result.ok && result.failure.source).toBe("ipc")
  })

  it("resolves the bare data of a command that cannot fail, and its transport rejection as a failure", async () => {
    mockIPC(() => ({ locations: [] }))
    expect(await library.libraryNewCaptures()).toEqual({ ok: true, data: { locations: [] } })

    mockIPC(() => Promise.reject("invalid args"))
    expect(await library.libraryNewCaptures()).toEqual({
      ok: false,
      failure: { source: "ipc", command: "libraryNewCaptures", detail: "invalid args" },
    })
  })
})

describe("data", () => {
  it("returns the data of a success and throws the failure as a LibraryError", async () => {
    mockIPC(() => [])
    await expect(data(library.libraryListLocations())).resolves.toEqual([])

    mockIPC(() => Promise.reject(conflict))
    const error: unknown = await data(library.libraryListLocations()).catch((thrown: unknown) => thrown)
    expect(error).toBeInstanceOf(LibraryError)
    expect(failureOf(error)).toEqual({ source: "library", command: "libraryListLocations", error: conflict })
  })

  it("reads no library failure from another error", () => {
    expect(failureOf(new Error("render bug"))).toBeNull()
  })
})
