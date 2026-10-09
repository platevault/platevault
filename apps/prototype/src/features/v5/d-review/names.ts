/**
 * Frame display names (D-W15, PIX-FR-16): a token template chosen from
 * presets, built from the naming tokens and their fallbacks (D-W20). The
 * template changes how frames read in review only; it never renames a file.
 * Two display-only tokens join the nine: {file} (the file name) and {n}
 * (the frame number in its session), so every preset keeps names distinct.
 */
import { sessionNamingValues } from "@/domain/derive"
import { headerNamingValues, resolveNamingTemplate } from "@/domain/templates"
import type { Catalog } from "@/domain/types"
import { m } from "@/lib/i18n"
import type { ReviewFrame } from "./model"

export interface NamePreset {
  id: string
  readonly label: string
  template: string
}

/** Labels are getters, so every read is in the chosen language. */
export const NAME_PRESETS: NamePreset[] = [
  { id: "file", get label() { return m.review_name_file() }, template: "{file}" },
  { id: "filter-night", get label() { return m.review_name_filter_night() }, template: "{filter} {date} #{n}" },
  { id: "target-filter", get label() { return m.review_name_target_filter() }, template: "{target} {filter} {exposure} #{n}" },
  { id: "night-camera", get label() { return m.review_name_night_camera() }, template: "{date} {camera} g{gain} {set_temp} #{n}" },
]

export function namePreset(id: string): NamePreset {
  return NAME_PRESETS.find((p) => p.id === id) ?? NAME_PRESETS[0]!
}

/** A frame's display name: the template over its session's naming values (corrections applied), else its observed header's. */
export function displayName(catalog: Catalog, frame: ReviewFrame, template: string): string {
  if (template === "{file}") return frame.asset.fileName
  const withLocal = template.replaceAll("{file}", frame.asset.fileName).replaceAll("{n}", String(frame.number).padStart(3, "0"))
  const values = frame.session ? sessionNamingValues(catalog, frame.session, frame.asset.imageType) : headerNamingValues(frame.asset.observed, frame.asset.imageType)
  return resolveNamingTemplate(withLocal, values).path
}
