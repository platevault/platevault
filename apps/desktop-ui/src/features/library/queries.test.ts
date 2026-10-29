import { describe, expect, it } from "vitest"
import { createQueryClient, libraryKey } from "@/api/query"
import { invalidateLibraryReads } from "./queries"

describe("invalidateLibraryReads", () => {
  it("refreshes the Targets rows, which read Home's stored criteria and the sessions' Targets", async () => {
    const client = createQueryClient()
    const rows = libraryKey("planningTargetRows")
    client.setQueryData(rows, {})
    await invalidateLibraryReads(client)
    expect(client.getQueryState(rows)?.isInvalidated).toBe(true)
  })
})
