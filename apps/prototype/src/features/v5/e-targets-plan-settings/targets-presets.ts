/**
 * Saved Targets presets (PLAN-TGT-FR-10): a named snapshot of the Targets
 * view (Show mode, catalogues, preset, rig, sort, good-tonight band), kept
 * in slice E's state so it survives restarts. Built-in presets are
 * constants and never change.
 */
import { NARROW_BANDS } from "@/domain/labels"
import { rigBands } from "@/domain/derive"
import type { Catalog } from "@/domain/types"
import { joinRefs, m, type MessageRef, msg, say, verbatim } from "@/lib/i18n"
import { freshId, recordSaved } from "@/store/actions/shared"
import { store, updateSlice } from "@/store/core"
import type { SavedTargetPreset, TargetsViewKey } from "@/store/slices/e"
import { parseBand, presetById } from "./targets-model"

const HREF = "/targets"

export const VIEW_KEYS: TargetsViewKey[] = ["mode", "cat", "preset", "rig", "sort", "good"]

export function savePreset(name: string, view: SavedTargetPreset["view"]): SavedTargetPreset {
  const preset: SavedTargetPreset = { id: freshId("tps", name), name, view }
  updateSlice("e", (slice) => ({ ...slice, savedPresets: [...slice.savedPresets, preset] }))
  recordSaved(msg("store_saved_preset", { name }), describeViewRef(store.getState().catalog, view), HREF)
  return preset
}

export function renamePreset(id: string, name: string) {
  const before = store.getState().slices.e.savedPresets.find((p) => p.id === id)
  updateSlice("e", (slice) => ({ ...slice, savedPresets: slice.savedPresets.map((p) => (p.id === id ? { ...p, name } : p)) }))
  recordSaved(msg("store_saved_preset_renamed", { name }), before ? msg("store_preset_was", { name: before.name }) : null, HREF)
}

export function deletePreset(id: string) {
  const before = store.getState().slices.e.savedPresets.find((p) => p.id === id)
  updateSlice("e", (slice) => ({ ...slice, savedPresets: slice.savedPresets.filter((p) => p.id !== id) }))
  if (before) recordSaved(msg("store_saved_preset_deleted", { name: before.name }), null, HREF)
}

/** One line naming what a saved preset restores, worded later (Activity). */
function describeViewRef(catalog: Catalog, view: SavedTargetPreset["view"]): MessageRef {
  const parts: MessageRef[] = [view.mode === "browse" ? (view.cat ? msg("targets_browse_named", { catalogues: view.cat.split(",").join(", ") }) : msg("targets_browse_catalogues")) : msg("project_search_my_targets")]
  const preset = presetById(view.preset)
  if (preset) parts.push(preset.name)
  const band = parseBand(view.good)
  if (band) parts.push(msg("targets_band_ok_tonight", { band }))
  if (view.rig) {
    const rig = catalog.opticalTrains[view.rig]
    parts.push(rig ? verbatim(rig.name) : msg("targets_rig_gone"))
  }
  if (view.sort) parts.push(msg("targets_sorted_by", { sort: view.sort.replace(".", " ") }))
  return joinRefs(parts, " · ")
}

/** One line naming what a saved preset restores. */
export function describeView(catalog: Catalog, view: SavedTargetPreset["view"]): string {
  return say(m, describeViewRef(catalog, view))
}

/** A saved preset follows the built-in availability rules (PLAN-TGT-FR-10); the reason, or null. */
export function savedPresetUnavailable(catalog: Catalog, view: SavedTargetPreset["view"]): string | null {
  const rig = view.rig ? catalog.opticalTrains[view.rig] : undefined
  if (view.rig && !rig) return m.targets_saved_rig_gone()
  const base = presetById(view.preset)
  if (base?.needs === "rig" && !rig) return m.targets_saved_needs_rig({ name: base.label })
  if (base?.needs === "narrowband" && rig && !rigBands(catalog, rig).some((b) => NARROW_BANDS.includes(b))) return m.targets_saved_no_narrowband({ name: rig.name })
  const band = parseBand(view.good)
  if (band && rig && !rigBands(catalog, rig).includes(band)) return m.targets_saved_no_band({ name: rig.name, band })
  return null
}
