import { beforeEach, describe, expect, it } from "vitest"
import { PIN_KINDS } from "@/domain/calibration"
import { sessionLongRef } from "@/domain/membership"
import { createSeed } from "@/domain/seed"
import type { Location } from "@/domain/types"
import { m, say } from "@/lib/i18n"
import { SCHEMA_VERSION, store, withCatalog } from "@/store/core"
import { initialSliceStates, sliceVersions } from "@/store/slices"
import { attentionRank, type LocationStatus, locationAttention, locationPins, retireLocation, reviewRetire } from "./locations"

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

describe("Retire location while a session pins a calibration file there (LIB-FR-15, LIB-AC-16)", () => {
  const CALIBRATION = "loc_calibration"
  const HREF = "/settings/locations"

  beforeEach(() => {
    store.replace({ ...createSeed("demo"), schemaVersion: SCHEMA_VERSION, sliceVersions: sliceVersions(), slices: initialSliceStates() })
    // M 31 LRGB is Archived, so the refusal names an open, a Closed (NGC 7000 OIII test) and an Archived Project.
    store.setState((s) => withCatalog(s, (c) => ({ ...c, projects: { ...c.projects, prj_m31: { ...c.projects.prj_m31!, state: "archived" } } })))
  })

  it("is refused, naming every session that pins a file there and every Project holding it, Closed and Archived marked; nothing changes", () => {
    const before = store.getState().catalog
    const root = `${before.locations[CALIBRATION]!.path}/`
    const pinning = Object.values(before.sessions).filter(
      (s) => !s.supersededBy && PIN_KINDS.some((kind) => s.calibration?.[kind].state === "pinned" && s.calibration[kind].evidence.files.some((f) => f.path.startsWith(root))),
    )
    expect(pinning.length).toBeGreaterThan(0)
    expect(new Set(locationPins(before, before.locations[CALIBRATION]!).map((p) => p.session.id))).toEqual(new Set(pinning.map((s) => s.id)))

    const review = reviewRetire(store.getState(), CALIBRATION)!
    const result = retireLocation(review, HREF)

    expect(result.ok).toBe(false)
    if (result.ok || result.reason !== "refused") throw new Error("expected a refusal")
    expect(result.reasons).toHaveLength(pinning.length)
    const reason = (sessionId: string, projects: string) => m.location_retire_pinned_by({ session: say(m, sessionLongRef(before.sessions[sessionId]!)), projects })
    expect(result.reasons).toContain(reason("ses_573cbz", "M 31 LRGB (Archived)"))
    expect(result.reasons).toContain(reason("ses_k30zg8", "NGC 7000 OIII test (Closed)"))
    expect(result.reasons).toContain(reason("ses_1oeln5l", "Cygnus HOO 2026"))
    expect(result.reasons).toContain(reason("ses_1mict9d", m.location_retire_pin_no_project()))
    expect(store.getState().catalog).toBe(before)
    expect(store.getState().catalog.locations[CALIBRATION]!.retiredAt).toBeFalsy()
  })

  it("retires a location where no session pins a file, as before", () => {
    const spare = store.getState().catalog.locations.loc_spare!
    expect(locationPins(store.getState().catalog, spare)).toEqual([])
    const result = retireLocation(reviewRetire(store.getState(), spare.id)!, HREF)
    expect(result).toEqual({ ok: true })
    expect(store.getState().catalog.locations[spare.id]!.retiredAt).toBeTruthy()
  })
})
