/**
 * Prototype measurement simulation (spec 067). Values derive from the
 * simulated pixel truth of the source file so they stay deterministic and
 * plausible. Measurements use the linear data basis only; display stretch
 * never reaches this function (PIX-FR-04). A saturated star fit fails and
 * yields no width value (PIX-AC-03).
 */
import type { Asset, DiskFile, FrameMeasurement, IsoDateTime, Metric } from "./types"

export const BUILT_IN_METHOD = { method: "PlateVault PSF (Moffat β=4)", version: "proto-0.1" } as const

/** `scaleArcsec` is the pixel scale; null when equipment is unknown. */
export function simulateMeasurement(
  asset: Asset,
  file: DiskFile | undefined,
  scaleArcsec: number | null,
  now: IsoDateTime,
): FrameMeasurement {
  const truth = file?.pixelTruth
  if (!file || !truth) return { assetId: asset.id, state: "unavailable", metrics: [], computedAt: null }
  const basis = asset.observed.bayerPattern ? `linear, CFA ${asset.observed.bayerPattern} mosaic plane` : "linear, mono"
  const metric = (key: Metric["key"], value: number | null, unit: string, state: Metric["state"] = "valid", warning: string | null = null): Metric => ({
    key,
    value,
    unit,
    ...BUILT_IN_METHOD,
    source: "built-in",
    basis,
    state,
    warning,
  })
  const widthUnit = scaleArcsec ? "arcsec" : "px"
  const toWidth = (px: number) => Number((scaleArcsec ? px * scaleArcsec : px).toFixed(2))
  const metrics: Metric[] = [
    metric("fwhm", toWidth(truth.fwhmPx), widthUnit),
    metric("hfr", toWidth(truth.fwhmPx * 0.62), widthUnit),
    metric("eccentricity", Number(truth.eccentricity.toFixed(2)), "ratio"),
    metric("star-count", truth.starCount, "stars"),
    metric("background", Math.round(truth.background), "ADU"),
    metric("snr", Number((truth.starCount / 60).toFixed(1)), "ratio"),
  ]
  if (truth.invalidSamples > 0) {
    for (const m of metrics) m.warning = `${truth.invalidSamples} invalid samples (NaN or ±∞) masked from this metric`
  }
  return { assetId: asset.id, state: "valid", metrics, computedAt: now }
}
