import { describe, expect, it } from "vitest"
import { m } from "@/lib/i18n"
import { CRITERIA, candidate, row } from "./__fixtures__/targets-host"
import { capturedText, fitText, imgTimeText, inMyTargets, matchesRow, parseRigs, parseSort, presetFilters, presetName, presetSearch, readState, targetsQuery, unknownReasonText } from "./targets-model"

const M31 = row(candidate("t-m31", "M 31"))

describe("the Targets URL", () => {
  it("reads Browse with its catalogues, preset, sort, night and site into the library's request", () => {
    const state = readState({ mode: "browse", cat: "messier,ngc,bogus", preset: "galaxies_dark_sky", sort: "-img_time", night: "2026-11-01", site: "s2" })
    expect(targetsQuery(state, CRITERIA)).toEqual({
      show: "browse",
      catalogues: ["messier", "ngc"],
      preset: "galaxies_dark_sky",
      siteId: "s2",
      night: "2026-11-01",
      criteria: CRITERIA,
      sort: { column: "img_time", descending: true },
      offset: 0,
      limit: 1000,
      rigs: { kind: "none" },
    })
  })

  it("lists My targets for the Planned view and sends no catalogue outside Browse", () => {
    const query = targetsQuery(readState({ view: "planned", cat: "messier" }), CRITERIA)
    expect(query.show).toBe("my_targets")
    expect(query.catalogues).toEqual([])
  })

  it("reads the rig selector: this Project's rigs needs the Project, else one rig, else none", () => {
    expect(parseRigs({ rig: "project", project: "p1" })).toEqual({ kind: "project", projectId: "p1" })
    expect(parseRigs({ rig: "project" })).toEqual({ kind: "none" })
    expect(parseRigs({ rig: "r1" })).toEqual({ kind: "rig", equipmentId: "r1" })
    expect(parseSort("bogus")).toBeNull()
  })

  it("restores a saved preset's filters and clears the others", () => {
    const filters = presetFilters(readState({ mode: "browse", cat: "ic", sort: "lunar" }))
    expect(filters).toEqual({ show: "browse", catalogues: ["ic"], preset: null, sort: { column: "lunar", descending: false } })
    expect(presetSearch(filters, "p9")).toMatchObject({ mode: "browse", cat: "ic", sort: "lunar", saved: "p9", fav: undefined, good: undefined })
  })
})

describe("row filters", () => {
  it("filters by Favourite, a viable chosen band and a Project badge", () => {
    const other = row(candidate("t-n7000", "NGC 7000"), { favourite: false, projects: [{ projectId: "p1", name: "Cygnus HOO" }] })
    expect(matchesRow(M31, { favourite: "no", bands: [], projectId: null })).toBe(false)
    expect(matchesRow(other, { favourite: "no", bands: [], projectId: "p1" })).toBe(true)
    // OIII is listed but not viable for M 31 tonight.
    expect(matchesRow(M31, { favourite: "", bands: ["OIII"], projectId: null })).toBe(false)
    expect(matchesRow(M31, { favourite: "", bands: ["OIII", "Ha"], projectId: null })).toBe(true)
  })

  it("counts a favourite, a Project subject or a Target with a session as in My targets", () => {
    expect(inMyTargets(row(candidate("a", "IC 1"), { favourite: false, sessions: 0 }))).toBe(false)
    expect(inMyTargets(row(candidate("b", "IC 2"), { favourite: false, sessions: 1 }))).toBe(true)
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
    expect(presetName(m, "best_tonight_broadband")).toBe(m.targets_preset_best())
  })
})
