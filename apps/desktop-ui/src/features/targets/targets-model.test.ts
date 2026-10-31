import { describe, expect, it } from "vitest"
import { m } from "@/lib/i18n"
import { candidate, row } from "./__fixtures__/targets-host"
import {
  bandGrades,
  capturedText,
  fitText,
  imgTimeText,
  parseRigs,
  parseSort,
  presetFilters,
  presetName,
  presetSearch,
  readState,
  targetContext,
  targetsQuery,
  unknownReasonText,
} from "./targets-model"

const M31 = row(candidate("t-m31", "M 31"))

describe("the Targets URL", () => {
  it("reads Browse with its catalogues, preset, sort, night and site into the library's request, which carries no criteria", () => {
    const state = readState({ mode: "browse", cat: "messier,ngc,bogus", preset: "galaxies_dark_sky", sort: "-img_time", night: "2026-11-01", site: "s2" })
    expect(targetsQuery(state)).toEqual({
      show: "browse",
      catalogues: ["messier", "ngc"],
      preset: "galaxies_dark_sky",
      siteId: "s2",
      night: "2026-11-01",
      sort: { column: "img_time", descending: true },
      offset: 0,
      limit: 1000,
      rigs: { kind: "none" },
      favourite: null,
      suitableBands: [],
      projectId: null,
    })
  })

  it("lists My targets for the Planned view and sends no catalogue outside Browse", () => {
    const query = targetsQuery(readState({ view: "planned", cat: "messier" }))
    expect(query.show).toBe("my_targets")
    expect(query.catalogues).toEqual([])
  })

  it("sends the Favourite filter, Suitable filters and the Project's subjects to the library, which filters before it pages", () => {
    const query = targetsQuery(readState({ fav: "no", good: "Ha,bogus,OIII", project: "p1" }))
    expect(query).toMatchObject({ favourite: false, suitableBands: ["Ha", "OIII"], projectId: "p1" })
    expect(targetsQuery(readState({ fav: "yes" })).favourite).toBe(true)
  })

  it("reads a Target page's planning context from its list's site, night and rig, and nothing else", () => {
    expect(targetContext({ site: "s2", night: "2026-11-01", rig: "r1", fav: "yes", good: "Ha" })).toEqual({ siteId: "s2", night: "2026-11-01", rigs: { kind: "rig", equipmentId: "r1" } })
    expect(targetContext({})).toEqual({ siteId: null, night: null, rigs: { kind: "none" } })
  })

  it("reads the rig selector: this Project's rigs needs the Project, else one rig, else none", () => {
    expect(parseRigs({ rig: "project", project: "p1" })).toEqual({ kind: "project", projectId: "p1" })
    expect(parseRigs({ rig: "project" })).toEqual({ kind: "none" })
    expect(parseRigs({ rig: "r1" })).toEqual({ kind: "rig", equipmentId: "r1" })
    expect(parseSort("bogus")).toBeNull()
  })

  it("saves a preset's Favourite filter, Suitable filters and single rig, and restores them clearing the others", () => {
    const filters = presetFilters(readState({ mode: "browse", cat: "ic", sort: "lunar", fav: "yes", good: "Ha", rig: "r1" }))
    expect(filters).toEqual({ show: "browse", catalogues: ["ic"], preset: null, favourite: true, suitableBands: ["Ha"], rigId: "r1", sort: { column: "lunar", descending: false } })
    expect(presetSearch(filters, "p9")).toMatchObject({ mode: "browse", cat: "ic", sort: "lunar", saved: "p9", fav: "yes", good: "Ha", rig: "r1" })
    const plain = presetFilters(readState({ rig: "project", project: "p1" }))
    expect(plain).toMatchObject({ favourite: null, suitableBands: [], rigId: null })
    expect(presetSearch(plain, "p8")).toMatchObject({ fav: undefined, good: undefined, rig: undefined })
  })
})

describe("row words", () => {
  it("grades every band of the strip as the library graded it", () => {
    expect(bandGrades(M31.bands)).toEqual([
      { band: "L", grade: "good" },
      { band: "Ha", grade: "marginal" },
      { band: "OIII", grade: "poor" },
    ])
  })
})

describe("planning words", () => {
  it("states why Img time is zero as part of the value", () => {
    expect(imgTimeText(m, M31)).toBe("2h10")
    expect(imgTimeText(m, row(candidate("z", "M 1"), { imgTimeMinutes: 0, imgTimeZeroReason: "altitude" }))).toBe(`${m.tonight_zero_hours()} · ${m.tonight_zero_low()}`)
    expect(imgTimeText(m, row(candidate("u", "M 2"), { imgTimeMinutes: null }))).toBeNull()
  })

  it("words Fit, the captured integration, the reasons and built-in presets from the catalogue", () => {
    expect(fitText(m, { state: "panels", coverage: 1.4, panels: 2 }).text).toBe(m.targets_fit_panels({ count: 2 }))
    expect(fitText(m, { state: "unknown", reason: "field_of_view_unknown" })).toEqual({ text: m.domain_fov_unknown(), unknown: true })
    expect(capturedText(m, [{ channel: null, seconds: 3600, frames: 12 }])).toBe(`${m.palette_session_no_filter()} 1h`)
    expect(unknownReasonText(m, "no_site")).toBe(m.targets_reason_no_site())
    expect(unknownReasonText(m, "no_criteria")).toBe(m.targets_reason_no_criteria())
    expect(presetName(m, "best_tonight_broadband")).toBe(m.targets_preset_best())
  })
})
