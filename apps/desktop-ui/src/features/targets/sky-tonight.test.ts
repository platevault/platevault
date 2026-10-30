import { describe, expect, it } from "vitest"
import { BASIS, candidate, DARKNESS, NIGHT_END, NIGHT_START, row } from "./__fixtures__/targets-host"
import { darknessTonight, sparkNight, sparkOf } from "./sky-tonight"

const M31 = candidate("t-m31", "M 31")
const darkness = darknessTonight(DARKNESS)

describe("the altitude sparkline's values", () => {
  it("spaces the library's samples evenly over the night's bounds, every one drawn", () => {
    const grid = sparkNight(BASIS, 49)
    expect(grid.samples[0]?.ms).toBe(Date.parse(NIGHT_START))
    expect(grid.samples[48]?.ms).toBe(Date.parse(NIGHT_END))
    expect(grid.samples[22]?.ms).toBe(Date.parse("2026-10-29T22:00:00Z"))
    expect({ from: grid.from, to: grid.to }).toEqual({ from: 0, to: 48 })
  })

  it("takes the library's peak, timed where the samples peak in darkness, even at its edge", () => {
    const grid = sparkNight(BASIS, 49)
    const culminating = sparkOf(grid, darkness, row(M31))
    expect(culminating).toMatchObject({ peakDeg: 71.4, peakAt: "2026-10-29T22:00:00.000Z" })
    // Setting all night: the peak in darkness is where darkness starts.
    const setting = sparkOf(grid, darkness, row(M31, { altitudeSamplesDeg: Array.from({ length: 49 }, (_, i) => 80 - i), maxAltitudeDeg: 66.5 }))
    expect(setting!.peakAt).toBe(DARKNESS.startUtc.replace("Z", ".000Z"))
  })

  it("leaves out the best window it isn't given, and says there is none with no Img time", () => {
    const grid = sparkNight(BASIS, 49)
    expect(sparkOf(grid, darkness, row(M31))!.best).toBeUndefined()
    expect(sparkOf(grid, darkness, row(M31, { imgTimeMinutes: 0, imgTimeZeroReason: "altitude" }))!.best).toBeNull()
    expect(sparkOf(grid, null, row(M31))).toMatchObject({ peakDeg: null, peakAt: null })
  })

  it("draws no sparkline without samples or with one missing, as the wire sends a non-finite number", () => {
    const grid = sparkNight(BASIS, 49)
    expect(sparkOf(grid, darkness, row(M31, { altitudeSamplesDeg: [] }))).toBeNull()
    expect(sparkOf(grid, darkness, row(M31, { altitudeSamplesDeg: Array.from({ length: 49 }, (_, i) => (i === 20 ? null : 40)) }))).toBeNull()
  })
})
