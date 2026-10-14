import { describe, expect, it } from "vitest"
import type { Location } from "@/domain/types"
import { attentionRank, type LocationStatus, locationAttention } from "./locations"

const healthy: Location = {
  id: "loc_a",
  displayName: "Astro-T7 captures",
  path: "/Volumes/Astro-T7/Captures",
  volumeId: "vol_astro",
  role: "captures",
  registeredAt: "2026-10-01T10:00:00.000Z",
  access: "ok",
  lastIndexedAt: "2026-10-01T10:05:00.000Z",
  scanScope: "complete",
  unreadablePaths: [],
  lastScanOperationId: null,
}

function status(patch: Partial<Location>, availability: LocationStatus["availability"] = "online", indexing = false): LocationStatus {
  return { location: { ...healthy, ...patch }, availability, indexing }
}

describe("locationAttention (Settings › Locations and setup)", () => {
  it("names the most urgent state: availability, then access, a running index, then the scan scope", () => {
    expect(locationAttention(status({ access: "denied", scanScope: "incomplete" }, "offline", true))).toEqual({ kind: "availability", value: "offline" })
    expect(locationAttention(status({ access: "denied", scanScope: "incomplete" }, "online", true))).toEqual({ kind: "access", value: "denied" })
    expect(locationAttention(status({ access: "unknown", scanScope: "never" }))).toEqual({ kind: "access", value: "unknown" })
    expect(locationAttention(status({ scanScope: "incomplete" }, "online", true))).toEqual({ kind: "indexing" })
    expect(locationAttention(status({ scanScope: "never" }))).toEqual({ kind: "scanScope", value: "never" })
    expect(locationAttention(status({}))).toBeNull()
  })

  it("sorts the State column in that order, healthy locations last", () => {
    const states = [status({}), status({ scanScope: "incomplete" }), status({}, "online", true), status({ access: "denied" }), status({}, "retired")]
    const ranked = [...states].sort((a, b) => attentionRank(locationAttention(a)) - attentionRank(locationAttention(b))).map((s) => locationAttention(s)?.kind ?? "healthy")
    expect(ranked).toEqual(["availability", "access", "indexing", "scanScope", "healthy"])
  })
})
