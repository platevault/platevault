/**
 * Frame pixels for review (PIX-FR-03, PIX-FR-12): the library's display
 * tiles turned into what the plate, the corner inspector and the thumbnails
 * draw. Pure functions, no IPC: `queries.ts` fetches the tiles.
 *
 * - A tile is 8-bit gray, already stretched by the library (`pix_preview_tile`),
 *   at a level where level k averages 2^k source pixels. Display only; nothing
 *   here is ever measured (PIX-FR-04).
 * - `tiledImage` draws a view window from the finest tile that covers each
 *   source pixel: level-0 detail tiles where the plate is zoomed or the corner
 *   inspector shows, else the whole-frame overview. A pixel no tile covers is
 *   transparent, so the mount shows through while its tile loads.
 * - `grayBmpUrl` encodes a thumbnail as an 8-bit grayscale BMP data URL, so a
 *   thumbnail needs no canvas.
 */
import type { AppliedStretch, PreviewTile, StarRecord, Stretch as WireStretch } from "@/api/ipc"
import type { RegionRect, RegionStar, RegionStats } from "@/components/domain/corner-grid"
import type { PlateImage, Stretch, ViewWindow } from "@/components/domain/plate"

/** The library's largest tile side (`MAX_TILE_SIDE`). */
export const MAX_TILE_SIDE = 1024
/** The library's coarsest level (`MAX_TILE_LEVEL`). */
export const MAX_LEVEL = 8
/** Level-0 detail is fetched in blocks of this side, aligned to it, so a pan reuses the blocks it already has. */
export const DETAIL_BLOCK = 512
/** CornerGrid's largest tile side: the corner inspector fetches its nine regions at this size. */
export const CORNER_SIDE = 320
/** A zone with fewer fitted stars reads no median (CornerGrid shows "–"). */
export const MIN_ZONE_STARS = 3

/** One decoded display tile in level coordinates. */
export interface GrayTile {
  level: number
  x: number
  y: number
  width: number
  height: number
  gray: Uint8Array
  /** The mapping the library applied; Strong derives from a frame's Auto result. */
  applied: AppliedStretch
}

/** A source-pixel rectangle a tile request covers, at level 0. */
export interface TileRect {
  x: number
  y: number
  width: number
  height: number
}

export function decodeBase64(text: string): Uint8Array {
  const binary = atob(text)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ""
  const CHUNK = 0x8000
  for (let i = 0; i < bytes.length; i += CHUNK) binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK))
  return btoa(binary)
}

export function grayTile(tile: PreviewTile): GrayTile {
  return { level: tile.level, x: tile.x, y: tile.y, width: tile.width, height: tile.height, gray: decodeBase64(tile.gray), applied: tile.appliedStretch }
}

/** The finest level at which the whole frame fits in one tile. */
export function overviewLevel(width: number, height: number): number {
  let level = 0
  while (level < MAX_LEVEL && Math.max(Math.ceil(width / 2 ** level), Math.ceil(height / 2 ** level)) > MAX_TILE_SIDE) level++
  return level
}

/** The frame's extent at `level`. */
export function levelExtent(size: number, level: number): number {
  return Math.max(1, Math.ceil(size / 2 ** level))
}

/** The level-0 blocks that cover a zoomed view window, clipped to the frame. */
export function detailBlocks(image: { width: number; height: number }, window: ViewWindow): TileRect[] {
  const x1 = Math.min(image.width, window.x0 + window.width * window.scale)
  const y1 = Math.min(image.height, window.y0 + window.height * window.scale)
  const blocks: TileRect[] = []
  for (let y = Math.floor(window.y0 / DETAIL_BLOCK) * DETAIL_BLOCK; y < y1; y += DETAIL_BLOCK) {
    for (let x = Math.floor(window.x0 / DETAIL_BLOCK) * DETAIL_BLOCK; x < x1; x += DETAIL_BLOCK) {
      blocks.push({ x, y, width: Math.min(DETAIL_BLOCK, image.width - x), height: Math.min(DETAIL_BLOCK, image.height - y) })
    }
  }
  return blocks
}

/**
 * The nine corner-inspector regions at level 0: the four corners, the four
 * edge centres and the centre, anchored the way CornerGrid anchors its tiles,
 * so every smaller tile it draws lies inside the region of the same place.
 */
export function cornerRegions(image: { width: number; height: number }): TileRect[] {
  const side = Math.max(1, Math.min(CORNER_SIDE, Math.floor(Math.min(image.width, image.height) / 3)))
  const at = (extent: number) => [0, Math.floor((extent - side) / 2), extent - side]
  return at(image.height).flatMap((y) => at(image.width).map((x) => ({ x, y, width: side, height: side })))
}

/**
 * A PlateImage over decoded tiles. `render` ignores its stretch: the library
 * applied the stretch the tiles were requested with, so the host makes a new
 * image when the stretch changes.
 */
export function tiledImage(width: number, height: number, tiles: readonly GrayTile[]): PlateImage {
  const finestFirst = [...tiles].sort((a, b) => a.level - b.level)
  return {
    width,
    height,
    render: (window) => {
      const out = new ImageData(window.width, window.height)
      const data = out.data
      for (let j = 0; j < window.height; j++) {
        const sy = window.y0 + (j + 0.5) * window.scale
        for (let i = 0; i < window.width; i++) {
          const sx = window.x0 + (i + 0.5) * window.scale
          const value = sampleTiles(finestFirst, sx, sy)
          const o = (j * window.width + i) * 4
          if (value === null) continue
          data[o] = value
          data[o + 1] = value
          data[o + 2] = value
          data[o + 3] = 255
        }
      }
      return out
    },
  }
}

function sampleTiles(tiles: readonly GrayTile[], sx: number, sy: number): number | null {
  for (const tile of tiles) {
    const factor = 2 ** tile.level
    const tx = Math.floor(sx / factor) - tile.x
    const ty = Math.floor(sy / factor) - tile.y
    if (tx >= 0 && ty >= 0 && tx < tile.width && ty < tile.height) return tile.gray[ty * tile.width + tx] ?? null
  }
  return null
}

/** An 8-bit grayscale BMP of the tile, as a data URL an `<img>` shows. */
export function grayBmpUrl(tile: GrayTile): string {
  const rowBytes = Math.ceil(tile.width / 4) * 4
  const offset = 14 + 40 + 256 * 4
  const size = offset + rowBytes * tile.height
  const bytes = new Uint8Array(size)
  const view = new DataView(bytes.buffer)
  bytes[0] = 0x42
  bytes[1] = 0x4d
  view.setUint32(2, size, true)
  view.setUint32(10, offset, true)
  view.setUint32(14, 40, true)
  view.setInt32(18, tile.width, true)
  view.setInt32(22, tile.height, true)
  view.setUint16(26, 1, true)
  view.setUint16(28, 8, true)
  view.setUint32(34, rowBytes * tile.height, true)
  view.setUint32(46, 256, true)
  for (let v = 0; v < 256; v++) {
    const p = 54 + v * 4
    bytes[p] = v
    bytes[p + 1] = v
    bytes[p + 2] = v
  }
  // BMP rows run bottom-up.
  for (let y = 0; y < tile.height; y++) {
    bytes.set(tile.gray.subarray(y * tile.width, (y + 1) * tile.width), offset + (tile.height - 1 - y) * rowBytes)
  }
  return `data:image/bmp;base64,${encodeBase64(bytes)}`
}

/**
 * The library stretch for a display stretch. Linear is the identity transfer
 * over the plane's range; Strong deepens the Auto midtones the library chose
 * for this frame, so it needs the frame's Auto result first (null: Auto).
 */
export function wireStretch(stretch: Stretch, auto: AppliedStretch | null): WireStretch {
  if (stretch === "linear") return { kind: "mtf", shadows: 0, midtones: 0.5, highlights: 1 }
  if (stretch === "strong" && auto?.shadows != null && auto.midtones != null) {
    return { kind: "mtf", shadows: auto.shadows, midtones: Math.min(0.999, Math.max(0.001, auto.midtones / 4)), highlights: 1 }
  }
  return { kind: "auto" }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2
}

/** The recorded stars inside `zone` and the medians over its fitted ones, as CornerGrid draws them. */
export function zoneStats(stars: readonly StarRecord[], zone: RegionRect): RegionStats {
  const inZone: RegionStar[] = []
  for (const s of stars) {
    if (s.x === null || s.y === null || s.state === "not_fitted") continue
    if (s.x < zone.x0 || s.y < zone.y0 || s.x >= zone.x0 + zone.width || s.y >= zone.y0 + zone.height) continue
    inZone.push({ id: s.index, x: s.x, y: s.y, state: s.state, fwhmPx: s.fwhmPx, eccentricity: s.eccentricity, angleDeg: s.positionAngleDeg })
  }
  const fitted = inZone.filter((s) => s.state === "fitted")
  const enough = fitted.length >= MIN_ZONE_STARS
  const values = (pick: (s: RegionStar) => number | null) => fitted.map(pick).filter((v): v is number => v !== null)
  return { stars: inZone, fwhmPx: enough ? median(values((s) => s.fwhmPx)) : null, eccentricity: enough ? median(values((s) => s.eccentricity)) : null }
}
