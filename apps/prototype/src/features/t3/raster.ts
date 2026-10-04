/**
 * Synthetic preview raster and per-star records (PIX-FR-03, PIX-FR-05).
 *
 * Prototype only: there are no real pixels, so the preview is drawn from the
 * fixture's pixel facts (`PixelTruth`: FWHM, eccentricity, star count,
 * background, saturated stars, invalid samples, trailing) with a
 * deterministic star field per frame. Values are linear ADU in source pixel
 * coordinates; display stretch maps them for the screen only and never feeds
 * a measurement (PIX-FR-04). Per-star records follow HLD §14: saturated stars
 * are failed fits with a warning and no width (PIX-AC-03).
 */
import { stableHash } from "@/domain/indexing"
import type { PixelTruth } from "@/domain/types"

export const ADU_MAX = 65_535
const BETA = 4
/** α of a Moffat profile with unit FWHM: 1 / (2·√(2^(1/β) − 1)). */
const ALPHA_PER_FWHM = 1 / (2 * Math.sqrt(2 ** (1 / BETA) - 1))
const CELL = 32

export interface FieldStar {
  x: number
  y: number
  peak: number
  fwhm: number
  eccentricity: number
  angle: number
}

export interface StarField {
  width: number
  height: number
  background: number
  noise: number
  stars: FieldStar[]
  grid: Map<number, number[]>
  /** Block of invalid samples (NaN or ±∞) in source pixels; null when none. */
  invalid: { x: number; y: number; w: number; h: number; count: number } | null
  /** Recorded CFA pattern, drawn as the mosaic plane; never debayered (PIX-AC-09). */
  cfa: string | null
  seed: number
}

function mulberry(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const cache = new Map<string, StarField>()

export function starField(key: string, truth: PixelTruth, width: number, height: number, cfa: string | null): StarField {
  const cacheKey = `${key}|${width}x${height}|${cfa ?? ""}`
  const hit = cache.get(cacheKey)
  if (hit) return hit
  const seed = Number.parseInt(stableHash(key), 36)
  const random = mulberry(seed)
  const trailAngle = random() * 180
  const stars: FieldStar[] = []
  const count = Math.min(truth.starCount, 2600)
  for (let i = 0; i < count; i += 1) {
    // Brightness follows a steep power law: a few bright stars, many faint ones.
    const peak = 220 + 26_000 * random() ** 6
    stars.push({
      x: 12 + random() * (width - 24),
      y: 12 + random() * (height - 24),
      peak,
      fwhm: truth.fwhmPx * (0.94 + random() * 0.12),
      eccentricity: Math.min(0.95, truth.eccentricity * (0.9 + random() * 0.2)),
      angle: truth.trailed ? trailAngle + (random() - 0.5) * 4 : random() * 180,
    })
  }
  stars.sort((a, b) => b.peak - a.peak)
  // The brightest stars saturate: their profile clips at the full-well value.
  for (let i = 0; i < Math.min(truth.saturatedStars, stars.length); i += 1) stars[i]!.peak = 150_000 + random() * 80_000
  const grid = new Map<number, number[]>()
  stars.forEach((star, index) => {
    const key = Math.floor(star.x / CELL) * 10_000 + Math.floor(star.y / CELL)
    grid.set(key, [...(grid.get(key) ?? []), index])
  })
  const invalid =
    truth.invalidSamples > 0
      ? { x: Math.round(width * 0.62), y: Math.round(height * 0.38), w: 14, h: Math.ceil(truth.invalidSamples / 14), count: truth.invalidSamples }
      : null
  const field: StarField = { width, height, background: truth.background, noise: Math.sqrt(truth.background * 1.2) + 8, stars, grid, invalid, cfa, seed }
  cache.set(cacheKey, field)
  if (cache.size > 12) cache.delete(cache.keys().next().value!)
  return field
}

function moffat(star: FieldStar, dx: number, dy: number): number {
  const q = Math.sqrt(1 - star.eccentricity ** 2)
  const alpha = star.fwhm * ALPHA_PER_FWHM
  const a = (star.angle * Math.PI) / 180
  const u = (dx * Math.cos(a) + dy * Math.sin(a)) / (alpha / Math.sqrt(q))
  const v = (-dx * Math.sin(a) + dy * Math.cos(a)) / (alpha * Math.sqrt(q))
  return star.peak * (1 + u * u + v * v) ** -BETA
}

function noiseAt(field: StarField, x: number, y: number): number {
  let h = (Math.imul(x, 73_856_093) ^ Math.imul(y, 19_349_663) ^ field.seed) >>> 0
  h = Math.imul(h ^ (h >>> 13), 1_274_126_177) >>> 0
  const u1 = (h & 0xffff) / 0xffff
  const u2 = (h >>> 16) / 0xffff
  return (u1 + u2 - 1) * field.noise * 1.7
}

const CFA_GAIN: Record<string, [number, number, number, number]> = {
  RGGB: [0.85, 1, 1, 0.7],
  BGGR: [0.7, 1, 1, 0.85],
  GRBG: [1, 0.85, 0.7, 1],
  GBRG: [1, 0.7, 0.85, 1],
}

/** Linear ADU at one source pixel; NaN inside the invalid block. */
export function sampleAt(field: StarField, x: number, y: number, only?: FieldStar): number {
  const inv = field.invalid
  if (inv && x >= inv.x && x < inv.x + inv.w && y >= inv.y && y < inv.y + inv.h) return Number.NaN
  let value = field.background + noiseAt(field, x, y)
  if (only) value += moffat(only, x + 0.5 - only.x, y + 0.5 - only.y)
  else {
    const cx = Math.floor(x / CELL)
    const cy = Math.floor(y / CELL)
    for (let gx = cx - 1; gx <= cx + 1; gx += 1) {
      for (let gy = cy - 1; gy <= cy + 1; gy += 1) {
        for (const index of field.grid.get(gx * 10_000 + gy) ?? []) {
          const star = field.stars[index]!
          value += moffat(star, x + 0.5 - star.x, y + 0.5 - star.y)
        }
      }
    }
  }
  if (field.cfa) value *= CFA_GAIN[field.cfa]?.[(y & 1) * 2 + (x & 1)] ?? 1
  return Math.min(ADU_MAX, value)
}

export type Stretch = "linear" | "auto" | "strong"

/** Display transfer: linear, or a midtones transfer that puts the background at a target level. */
export function stretchLut(field: StarField, stretch: Stretch): Uint8ClampedArray {
  const lut = new Uint8ClampedArray(4097)
  const shadows = stretch === "linear" ? 0 : Math.max(0, field.background - (stretch === "auto" ? 2.8 : 1.5) * field.noise)
  const target = stretch === "auto" ? 0.25 : 0.5
  const m = (field.background - shadows) / (ADU_MAX - shadows)
  const mb = (m * (target - 1)) / (2 * target * m - target - m)
  for (let i = 0; i <= 4096; i += 1) {
    const v = (i / 4096) * ADU_MAX
    const x = Math.min(1, Math.max(0, (v - shadows) / (ADU_MAX - shadows)))
    const y = stretch === "linear" ? x : x === 0 ? 0 : ((mb - 1) * x) / ((2 * mb - 1) * x - mb)
    lut[i] = Math.round(y * 255)
  }
  return lut
}

export interface ViewWindow {
  /** Source pixel at the canvas origin. */
  x0: number
  y0: number
  /** Source pixels per canvas pixel: > 1 when the whole frame is fitted, 1 at 1:1, 0.5 at 2:1. */
  scale: number
  width: number
  height: number
}

const INVALID_RGB = [235, 64, 64] as const

/** Render a window of the field into RGBA, binning when zoomed out so faint stars stay visible. */
export function renderWindow(field: StarField, window: ViewWindow, stretch: Stretch): ImageData {
  const { width, height, scale, x0, y0 } = window
  const image = new ImageData(width, height)
  const lut = stretchLut(field, stretch)
  const values = new Float32Array(width * height)
  if (scale <= 1) {
    for (let j = 0; j < height; j += 1) {
      for (let i = 0; i < width; i += 1) {
        const x = Math.floor(x0 + i * scale)
        const y = Math.floor(y0 + j * scale)
        values[j * width + i] = x < 0 || y < 0 || x >= field.width || y >= field.height ? field.background : sampleAt(field, x, y)
      }
    }
  } else {
    const noiseScale = 1 / scale
    for (let j = 0; j < height; j += 1) {
      for (let i = 0; i < width; i += 1) {
        values[j * width + i] = field.background + noiseAt(field, i, j) * noiseScale
      }
    }
    for (const star of field.stars) {
      const alphaM = (star.fwhm * ALPHA_PER_FWHM) / Math.sqrt(Math.sqrt(1 - star.eccentricity ** 2))
      const flux = (star.peak * Math.PI * alphaM * alphaM) / (BETA - 1)
      const ci = (star.x - x0) / scale
      const cj = (star.y - y0) / scale
      const sigma = Math.max(0.45, star.fwhm / 2.355 / scale)
      const perBin = flux / (scale * scale) / (2 * Math.PI * sigma * sigma)
      for (let dj = -2; dj <= 2; dj += 1) {
        for (let di = -2; di <= 2; di += 1) {
          const i = Math.floor(ci) + di
          const j = Math.floor(cj) + dj
          if (i < 0 || j < 0 || i >= width || j >= height) continue
          const r2 = (i + 0.5 - ci) ** 2 + (j + 0.5 - cj) ** 2
          values[j * width + i]! += perBin * Math.exp(-r2 / (2 * sigma * sigma))
        }
      }
    }
    const inv = field.invalid
    if (inv) {
      for (let j = Math.floor((inv.y - y0) / scale); j <= Math.floor((inv.y + inv.h - y0) / scale); j += 1) {
        for (let i = Math.floor((inv.x - x0) / scale); i <= Math.floor((inv.x + inv.w - x0) / scale); i += 1) {
          if (i >= 0 && j >= 0 && i < width && j < height) values[j * width + i] = Number.NaN
        }
      }
    }
  }
  for (let p = 0; p < values.length; p += 1) {
    const v = values[p]!
    const o = p * 4
    if (Number.isNaN(v)) {
      image.data[o] = INVALID_RGB[0]
      image.data[o + 1] = INVALID_RGB[1]
      image.data[o + 2] = INVALID_RGB[2]
    } else {
      const g = lut[Math.min(4096, Math.max(0, Math.round((v / ADU_MAX) * 4096)))]!
      image.data[o] = g
      image.data[o + 1] = g
      image.data[o + 2] = g
    }
    image.data[o + 3] = 255
  }
  return image
}

export interface StarRecord {
  id: number
  x: number
  y: number
  state: "fitted" | "failed"
  fwhmPx: number | null
  hfrPx: number | null
  eccentricity: number | null
  angleDeg: number | null
  peakAdu: number
  backgroundAdu: number
  snr: number
  warnings: string[]
  source: FieldStar
}

/** The brightest detected stars with fit results; saturated stars are failed fits with no width. */
export function detectedStars(field: StarField, limit = 40): StarRecord[] {
  return field.stars.slice(0, limit).map((star, index) => {
    const saturated = star.peak >= ADU_MAX
    const nearEdge = star.x < 40 || star.y < 40 || star.x > field.width - 40 || star.y > field.height - 40
    const jitter = 1 + (((index * 7919) % 61) - 30) / 1000
    const warnings = [
      saturated ? "Saturated: the core is clipped at 65,535 ADU, so the PSF fit failed" : null,
      nearEdge ? "Near the frame edge: part of the profile may be cut off" : null,
    ].filter((w): w is string => w !== null)
    return {
      id: index + 1,
      x: Math.round(star.x),
      y: Math.round(star.y),
      state: saturated ? "failed" : "fitted",
      fwhmPx: saturated ? null : Number((star.fwhm * jitter).toFixed(2)),
      hfrPx: saturated ? null : Number((star.fwhm * 0.62 * jitter).toFixed(2)),
      eccentricity: saturated ? null : Number(star.eccentricity.toFixed(2)),
      angleDeg: saturated ? null : Number((star.angle % 180).toFixed(1)),
      peakAdu: Math.round(Math.min(ADU_MAX, star.peak + field.background)),
      backgroundAdu: Math.round(field.background),
      snr: Number((Math.min(ADU_MAX, star.peak) / field.noise).toFixed(1)),
      warnings,
      source: star,
    }
  })
}

export type CutoutKind = "observed" | "fitted" | "residual"

/** A square cutout around a star at 1:1: the data, the fitted model, or their difference. */
export function renderCutout(field: StarField, star: StarRecord, kind: CutoutKind, size = 25): ImageData {
  const image = new ImageData(size, size)
  const half = Math.floor(size / 2)
  const lut = stretchLut(field, "auto")
  const span = Math.max(field.noise * 6, Math.min(ADU_MAX, star.peakAdu) * 0.08)
  for (let j = 0; j < size; j += 1) {
    for (let i = 0; i < size; i += 1) {
      const x = star.x - half + i
      const y = star.y - half + j
      const observed = sampleAt(field, x, y)
      const model = field.background + moffat(star.source, x + 0.5 - star.source.x, y + 0.5 - star.source.y)
      const o = (j * size + i) * 4
      let g: number
      if (kind === "residual") g = Math.round(Math.min(1, Math.max(0, 0.5 + (observed - model) / (2 * span))) * 255)
      else {
        const v = kind === "observed" ? observed : Math.min(ADU_MAX, model)
        g = Number.isNaN(v) ? 0 : lut[Math.round((v / ADU_MAX) * 4096)]!
      }
      image.data[o] = g
      image.data[o + 1] = g
      image.data[o + 2] = g
      image.data[o + 3] = 255
    }
  }
  return image
}
