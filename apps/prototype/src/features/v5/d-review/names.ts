/**
 * Frame display names (D-W15, PIX-FR-16): a token template chosen from
 * presets, built from the naming tokens and their fallbacks (D-W20). The
 * template changes how frames read in review only; it never renames a file.
 * Two display-only tokens join the nine: {file} (the file name) and {n}
 * (the frame number in its session), so every preset keeps names distinct.
 */
import { sessionTargetId } from "@/domain/derive"
import { sessionExposureS } from "@/domain/membership"
import { type NamingValues, resolveNamingTemplate } from "@/domain/templates"
import type { Catalog } from "@/domain/types"
import type { ReviewFrame } from "./model"

export interface NamePreset {
  id: string
  label: string
  template: string
}

export const NAME_PRESETS: NamePreset[] = [
  { id: "file", label: "File name", template: "{file}" },
  { id: "filter-night", label: "Filter, night, number", template: "{filter} {date} #{n}" },
  { id: "target-filter", label: "Target, filter, exposure, number", template: "{target} {filter} {exposure} #{n}" },
  { id: "night-camera", label: "Night, camera, gain, temperature, number", template: "{date} {camera} g{gain} {set_temp} #{n}" },
]

export function namePreset(id: string): NamePreset {
  return NAME_PRESETS.find((p) => p.id === id) ?? NAME_PRESETS[0]!
}

/** The nine naming tokens for one frame, from its session (corrections applied) and header. */
export function namingValuesFor(catalog: Catalog, frame: ReviewFrame): NamingValues {
  const { session, asset } = frame
  const targetId = session ? sessionTargetId(session) : null
  const exposure = session ? sessionExposureS(session) : asset.observed.exposureS
  return {
    target: targetId ? (catalog.targets[targetId]?.name ?? null) : null,
    filter: session?.channel ?? asset.observed.filter,
    date: session?.night ?? null,
    frame_type: asset.imageType,
    camera: session?.cameraName ?? asset.observed.instrument,
    exposure: `${Number(exposure.toFixed(2))}s`,
    gain: asset.observed.gain === null ? null : String(asset.observed.gain),
    binning: `${asset.observed.binning}x${asset.observed.binning}`,
    set_temp: asset.observed.ccdTempC === null ? null : `${Math.round(asset.observed.ccdTempC)}C`,
  }
}

export function displayName(catalog: Catalog, frame: ReviewFrame, template: string): string {
  if (template === "{file}") return frame.asset.fileName
  const withLocal = template.replaceAll("{file}", frame.asset.fileName).replaceAll("{n}", String(frame.number).padStart(3, "0"))
  return resolveNamingTemplate(withLocal, namingValuesFor(catalog, frame)).path
}
