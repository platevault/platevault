/**
 * Saved Targets presets (PLAN-TGT-FR-10): a named snapshot of the Targets
 * view (Show mode, catalogues, preset, rig, sort), kept in slice E's state so
 * it survives restarts. Built-in presets are constants and never change.
 */
import { NARROW_BANDS } from "@/domain/labels"
import { rigBands } from "@/domain/derive"
import type { Catalog } from "@/domain/types"
import { freshId, recordSaved } from "@/store/actions/shared"
import { store, updateSlice } from "@/store/core"
import type { SavedTargetPreset, TargetsViewKey } from "@/store/slices/e"
import { presetById } from "./targets-model"

const HREF = "/targets"

export const VIEW_KEYS: TargetsViewKey[] = ["mode", "cat", "preset", "rig", "sort"]

export function savePreset(name: string, view: SavedTargetPreset["view"]): SavedTargetPreset {
  const preset: SavedTargetPreset = { id: freshId("tps", name), name, view }
  updateSlice("e", (slice) => ({ ...slice, savedPresets: [...slice.savedPresets, preset] }))
  recordSaved(`Targets preset saved: ${name}`, describeView(store.getState().catalog, view), HREF)
  return preset
}

export function renamePreset(id: string, name: string) {
  const before = store.getState().slices.e.savedPresets.find((p) => p.id === id)
  updateSlice("e", (slice) => ({ ...slice, savedPresets: slice.savedPresets.map((p) => (p.id === id ? { ...p, name } : p)) }))
  recordSaved(`Targets preset renamed: ${name}`, before ? `Was “${before.name}”.` : null, HREF)
}

export function deletePreset(id: string) {
  const before = store.getState().slices.e.savedPresets.find((p) => p.id === id)
  updateSlice("e", (slice) => ({ ...slice, savedPresets: slice.savedPresets.filter((p) => p.id !== id) }))
  if (before) recordSaved(`Targets preset deleted: ${before.name}`, "Built-in presets and your other presets are unchanged.", HREF)
}

/** One line naming what a saved preset restores. */
export function describeView(catalog: Catalog, view: SavedTargetPreset["view"]): string {
  const parts = [view.mode === "browse" ? `Browse ${view.cat ? view.cat.split(",").join(", ") : "catalogues"}` : "My targets"]
  const preset = presetById(view.preset)
  if (preset) parts.push(preset.label)
  if (view.rig) parts.push(catalog.opticalTrains[view.rig]?.name ?? "a rig that no longer exists")
  if (view.sort) parts.push(`sorted by ${view.sort.replace(".", " ")}`)
  return parts.join(" · ")
}

/** A saved preset follows the built-in availability rules (PLAN-TGT-FR-10); the reason, or null. */
export function savedPresetUnavailable(catalog: Catalog, view: SavedTargetPreset["view"]): string | null {
  const rig = view.rig ? catalog.opticalTrains[view.rig] : undefined
  if (view.rig && !rig) return "Its rig is no longer in Settings › Equipment"
  const base = presetById(view.preset)
  if (base?.needs === "rig" && !rig) return `${base.label} needs a rig`
  if (base?.needs === "narrowband" && rig && !rigBands(catalog, rig).some((b) => NARROW_BANDS.includes(b))) return `${rig.name} has no Ha, SII or OIII filter`
  return null
}
