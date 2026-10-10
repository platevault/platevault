/**
 * Prototype measurement simulation (spec 067). Values derive from the
 * simulated pixel totals of the source file so they stay deterministic and
 * plausible. Measurements use the linear data basis only; display stretch
 * never reaches this function (PIX-FR-04). The fixture has frame totals, not
 * per-star records: saturated stars and invalid samples are reported as
 * warnings on the frame's metrics. Each result records the bytes it measured
 * (`inputSha256`), so a changed file never reuses it (PIX-AC-10).
 */
import type { Asset, DiskFile, FrameMeasurement, IsoDateTime, Metric } from "./types"
import { joinRefs, type MessageRef, msg } from "@/lib/i18n"

export const BUILT_IN_METHOD = { method: "PlateVault PSF (Moffat β=4)", version: "proto-0.1" } as const

/** `scaleArcsec` is the pixel scale; null when equipment is unknown. */
export function simulateMeasurement(
  asset: Asset,
  file: DiskFile | undefined,
  scaleArcsec: number | null,
  now: IsoDateTime,
): FrameMeasurement {
  const truth = file?.pixelTruth
  if (!file || !truth) return { assetId: asset.id, state: "unavailable", inputSha256: null, metrics: [], computedAt: null, history: [] }
  const basis = asset.observed.bayerPattern ? msg("measure_basis_cfa", { pattern: asset.observed.bayerPattern }) : msg("measure_basis_mono")
  const metric = (key: Metric["key"], value: number | null, unit: string, state: Metric["state"] = "valid", warning: MessageRef | null = null): Metric => ({
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
  const warnings = [
    truth.invalidSamples > 0 ? msg("measure_warning_invalid_samples", { count: truth.invalidSamples }) : null,
    truth.saturatedStars > 0 ? msg("measure_warning_saturated_stars", { count: truth.saturatedStars }) : null,
  ].filter((w): w is MessageRef => w !== null)
  if (warnings.length > 0) {
    for (const m of metrics) m.warning = joinRefs(warnings, "; ")
  }
  return { assetId: asset.id, state: "valid", inputSha256: file.sha256, metrics, computedAt: now, history: [] }
}
