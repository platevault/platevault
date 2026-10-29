import "@/test/jsdom-render"
import { describe, expect, it } from "vitest"
import type { PreviewTile, StarRecord } from "@/api/ipc"
import { cornerRegions, decodeBase64, detailBlocks, type GrayTile, grayBmpUrl, grayTile, overviewLevel, tiledImage, wireStretch, zoneStats } from "./pixels"

const APPLIED = { kind: "auto" as const, black: 0, white: 1, shadows: 0.02, midtones: 0.2, highlights: 1 }
const gray = (level: number, x: number, y: number, width: number, height: number, value: number): GrayTile => ({ level, x, y, width, height, gray: new Uint8Array(width * height).fill(value), applied: APPLIED })

describe("tiles", () => {
  it("decodes a library tile's base64 gray", () => {
    const tile: PreviewTile = { plane: 0, level: 2, x: 1, y: 0, width: 2, height: 1, appliedStretch: APPLIED, gray: btoa("\u0001\u00ff"), mask: null }
    expect(grayTile(tile)).toMatchObject({ level: 2, x: 1, width: 2, height: 1, gray: new Uint8Array([1, 255]) })
  })

  it("picks the coarsest overview level that fits one 1024 px tile", () => {
    expect(overviewLevel(1000, 800)).toBe(0)
    expect(overviewLevel(6248, 4176)).toBe(3)
  })

  it("draws from the level-0 detail where it has it, the overview elsewhere, nothing where neither covers", () => {
    const image = tiledImage(8, 4, [gray(1, 0, 0, 4, 2, 10), gray(0, 0, 0, 2, 2, 200)])
    const out = image.render({ x0: 0, y0: 0, scale: 1, width: 8, height: 4 }, "auto").data
    expect(out[0]).toBe(200)
    expect(out[(0 * 8 + 4) * 4]).toBe(10)
    const sparse = tiledImage(4, 4, [gray(0, 0, 0, 2, 2, 50)]).render({ x0: 0, y0: 0, scale: 1, width: 4, height: 4 }, "auto").data
    expect(sparse[(3 * 4 + 3) * 4 + 3]).toBe(0)
  })

  it("covers a zoomed window with aligned 512 px blocks clipped to the frame", () => {
    expect(detailBlocks({ width: 1200, height: 900 }, { x0: 400, y0: 100, scale: 1, width: 700, height: 500 })).toEqual([
      { x: 0, y: 0, width: 512, height: 512 },
      { x: 512, y: 0, width: 512, height: 512 },
      { x: 1024, y: 0, width: 176, height: 512 },
      { x: 0, y: 512, width: 512, height: 388 },
      { x: 512, y: 512, width: 512, height: 388 },
      { x: 1024, y: 512, width: 176, height: 388 },
    ])
  })

  it("anchors the nine corner regions like the corner grid: corners, edge centres and the centre", () => {
    const regions = cornerRegions({ width: 1200, height: 900 })
    expect(regions).toHaveLength(9)
    expect(regions[0]).toEqual({ x: 0, y: 0, width: 300, height: 300 })
    expect(regions[4]).toEqual({ x: 450, y: 300, width: 300, height: 300 })
    expect(regions[8]).toEqual({ x: 900, y: 600, width: 300, height: 300 })
  })

  it("encodes a thumbnail as an 8-bit grayscale BMP, rows bottom-up and padded to four bytes", () => {
    const tile: GrayTile = { level: 3, x: 0, y: 0, width: 3, height: 2, gray: new Uint8Array([1, 2, 3, 4, 5, 6]), applied: APPLIED }
    const url = grayBmpUrl(tile)
    expect(url.startsWith("data:image/bmp;base64,")).toBe(true)
    const bytes = decodeBase64(url.slice("data:image/bmp;base64,".length))
    const view = new DataView(bytes.buffer)
    expect(String.fromCharCode(bytes[0]!, bytes[1]!)).toBe("BM")
    expect(view.getInt32(18, true)).toBe(3)
    expect(view.getUint16(28, true)).toBe(8)
    const offset = view.getUint32(10, true)
    expect([...bytes.slice(offset, offset + 8)]).toEqual([4, 5, 6, 0, 1, 2, 3, 0])
  })
})

describe("stretch", () => {
  it("asks the library for Auto, an identity transfer for Linear, and deepens Auto's midtones for Strong", () => {
    expect(wireStretch("auto", null)).toEqual({ kind: "auto" })
    expect(wireStretch("linear", null)).toEqual({ kind: "mtf", shadows: 0, midtones: 0.5, highlights: 1 })
    expect(wireStretch("strong", APPLIED)).toEqual({ kind: "mtf", shadows: 0.02, midtones: 0.05, highlights: 1 })
    expect(wireStretch("strong", null)).toEqual({ kind: "auto" })
  })
})

describe("zoneStats", () => {
  const star = (index: number, x: number, y: number, fwhmPx: number | null, state: StarRecord["state"] = "fitted"): StarRecord => ({
    index,
    x,
    y,
    state,
    reasons: [],
    warnings: [],
    peak: null,
    flux: null,
    localBackground: null,
    boxRadius: 8,
    model: null,
    fwhmMajorPx: null,
    fwhmMinorPx: null,
    fwhmPx,
    eccentricity: fwhmPx === null ? null : 0.3,
    positionAngleDeg: 10,
    hfrPx: null,
  })

  it("takes the medians over the zone's fitted stars and keeps failed fits for the overlay", () => {
    const stats = zoneStats([star(0, 1, 1, 2), star(1, 2, 2, 4), star(2, 3, 3, 3), star(3, 4, 4, null, "failed"), star(4, 50, 50, 9), star(5, 5, 5, null, "not_fitted")], { x0: 0, y0: 0, width: 10, height: 10 })
    expect(stats.fwhmPx).toBe(3)
    expect(stats.eccentricity).toBe(0.3)
    expect(stats.stars.map((s) => s.state)).toEqual(["fitted", "fitted", "fitted", "failed"])
  })

  it("reads no median with fewer than three fitted stars", () => {
    expect(zoneStats([star(0, 1, 1, 2), star(1, 2, 2, 4)], { x0: 0, y0: 0, width: 10, height: 10 }).fwhmPx).toBeNull()
  })
})
