/**
 * Bundled reference objects and small geometry helpers.
 *
 * Production computes geometry and planning in Rust through the shared
 * skymath contracts (spec 072 PLAN-FR-08). The prototype uses these simplified
 * helpers so screens can show plausible evidence; every consumer labels
 * prototype calculations as such.
 */
import type { Camera, OpticalTrain } from "./types"

export interface SkyObject {
  name: string
  aliases: string[]
  ra: number
  dec: number
  widthDeg: number
  heightDeg: number
  objectType: string
}

/** Bundled offline reference catalog (subset), used for local Target records. */
export const SKY_OBJECTS: SkyObject[] = [
  { name: "NGC 7000", aliases: ["North America Nebula", "Caldwell 20", "NGC7000"], ra: 314.75, dec: 44.53, widthDeg: 2.0, heightDeg: 1.7, objectType: "Emission nebula" },
  { name: "M 31", aliases: ["Andromeda Galaxy", "NGC 224", "M31", "Messier 31"], ra: 10.685, dec: 41.269, widthDeg: 3.2, heightDeg: 1.0, objectType: "Spiral galaxy" },
  { name: "M 33", aliases: ["Triangulum Galaxy", "NGC 598", "M33"], ra: 23.462, dec: 30.66, widthDeg: 1.2, heightDeg: 0.7, objectType: "Spiral galaxy" },
  { name: "IC 1805", aliases: ["Heart Nebula", "IC1805"], ra: 38.2, dec: 61.45, widthDeg: 1.2, heightDeg: 1.2, objectType: "Emission nebula" },
  { name: "IC 1848", aliases: ["Soul Nebula", "IC1848"], ra: 42.8, dec: 60.43, widthDeg: 1.2, heightDeg: 0.9, objectType: "Emission nebula" },
  { name: "IC 5070", aliases: ["Pelican Nebula", "IC5070"], ra: 312.75, dec: 44.37, widthDeg: 1.0, heightDeg: 0.8, objectType: "Emission nebula" },
  { name: "NGC 6960", aliases: ["Western Veil Nebula", "Witch's Broom", "NGC6960"], ra: 311.42, dec: 30.71, widthDeg: 1.2, heightDeg: 0.3, objectType: "Supernova remnant" },
  { name: "M 42", aliases: ["Orion Nebula", "NGC 1976", "M42"], ra: 83.82, dec: -5.39, widthDeg: 1.1, heightDeg: 1.0, objectType: "Emission nebula" },
]

const RAD = Math.PI / 180

/** Great-circle separation in degrees. */
export function angularSeparationDeg(ra1: number, dec1: number, ra2: number, dec2: number): number {
  const d1 = dec1 * RAD
  const d2 = dec2 * RAD
  const cos = Math.sin(d1) * Math.sin(d2) + Math.cos(d1) * Math.cos(d2) * Math.cos((ra1 - ra2) * RAD)
  return Math.acos(Math.min(1, Math.max(-1, cos))) / RAD
}

/** Pixel scale in arcseconds per pixel. */
export function pixelScaleArcsec(pixelSizeUm: number, focalLengthMm: number, binning = 1): number {
  return (206.265 * pixelSizeUm * binning) / focalLengthMm
}

export interface FieldOfView {
  widthDeg: number
  heightDeg: number
  pixelScaleArcsec: number
  /** Inputs used, for provenance disclosure. */
  basis: { widthPx: number; heightPx: number; focalLengthMm: number; pixelSizeUm: number; binning: number }
}

/** FOV from confirmed equipment; null when the camera or train is unknown. */
export function fieldOfView(train: OpticalTrain | null, camera: Camera | null, binning = 1): FieldOfView | null {
  if (!train || !camera) return null
  const scale = pixelScaleArcsec(camera.pixelSizeUm, train.effectiveFocalLengthMm, binning)
  const widthPx = camera.widthPx / binning
  const heightPx = camera.heightPx / binning
  return {
    widthDeg: (widthPx * scale) / 3600,
    heightDeg: (heightPx * scale) / 3600,
    pixelScaleArcsec: scale,
    basis: { widthPx, heightPx, focalLengthMm: train.effectiveFocalLengthMm, pixelSizeUm: camera.pixelSizeUm, binning },
  }
}

export function normalizeName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]/g, "")
}
