/**
 * The Targets page's Presets ▾ (PLAN-TGT-FR-09/10): the built-ins the
 * selected rigs offer, then the saved presets by name, from
 * `targets_presets_list`. A built-in is named from the catalogue by its id.
 * Save current… stores the Show mode, catalogues, preset and sort; Rename
 * and Delete name the saved preset's revision, and a stale one is refused
 * as `conflict`: the presets are read again and the failure says so, so the
 * next attempt names the revision read now.
 */
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { type LibraryFailure, library, type PresetFilters, type SavedPreset, type TargetsPresets } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import type { Preset } from "@/components/app/contracts"
import { TextField } from "@/components/app/fields"
import { blockedByErrors, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import type { Messages } from "@/lib/i18n"
import { targetsWrite } from "./queries"
import { presetName } from "./targets-model"

const BUILT_IN = "builtin:"
const SAVED = "saved:"

/** One Presets ▾ entry's id: `builtin:<preset>` or `saved:<id>`. */
export type PresetId = { kind: "builtin"; preset: string } | { kind: "saved"; id: string }

export function parsePresetId(id: string): PresetId | null {
  if (id.startsWith(BUILT_IN)) return { kind: "builtin", preset: id.slice(BUILT_IN.length) }
  if (id.startsWith(SAVED)) return { kind: "saved", id: id.slice(SAVED.length) }
  return null
}

export function presetItems(m: Messages, presets: TargetsPresets): Preset[] {
  return [
    ...presets.builtin.map((p): Preset => ({ id: `${BUILT_IN}${p.preset}`, label: presetName(m, p.preset), source: "builtin" })),
    ...presets.saved.map((p): Preset => ({ id: `${SAVED}${p.id}`, label: p.name, source: "custom" })),
  ]
}

/** The checked entry: a saved preset the URL names, else the built-in. */
export function activePreset(preset: string | null, saved: string | null): string | null {
  if (saved) return `${SAVED}${saved}`
  return preset ? `${BUILT_IN}${preset}` : null
}

export interface PresetWrites {
  save: (name: string) => void
  remove: (preset: SavedPreset) => void
  /** The last refused or failed preset write, until the next one. */
  failure: LibraryFailure | null
  dismiss: () => void
}

export function usePresetWrites(filters: PresetFilters, onSaved: (preset: SavedPreset) => void, onRemoved: (preset: SavedPreset) => void): PresetWrites {
  const client = useQueryClient()
  const [failure, setFailure] = useState<LibraryFailure | null>(null)
  async function save(name: string) {
    setFailure(null)
    const result = await targetsWrite(client, () => library.targetsPresetSave(name, filters))
    if (result.ok) onSaved(result.data)
    else setFailure(result.failure)
  }
  async function remove(preset: SavedPreset) {
    setFailure(null)
    const result = await targetsWrite(client, () => library.targetsPresetDelete({ kind: "saved", id: preset.id }, preset.revision))
    if (result.ok) onRemoved(preset)
    else setFailure(result.failure)
  }
  return { save: (name) => void save(name), remove: (preset) => void remove(preset), failure, dismiss: () => setFailure(null) }
}

/** Rename preset…: the saved preset at the revision the page read. */
export function RenamePresetDialog({ preset, open, onOpenChange }: { preset: SavedPreset; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const { values, set, shown } = useDialogForm(open, () => ({ name: preset.name }))
  const label = m.equipment_rename()
  const errors = values.name.trim() === "" ? { name: m.project_name_required() } : {}
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.common_rename_title({ name: preset.name })}
      size="sm"
      confirm={{
        id: "rename-preset",
        label,
        kind: "primary",
        unavailable: blockedByErrors(m, label, errors),
        run: () => targetsWrite(client, () => library.targetsPresetRename({ kind: "saved", id: preset.id }, values.name.trim(), preset.revision)),
      }}
    >
      <TextField label={m.filter_bar_preset_name()} value={values.name} onChange={(name) => set({ name })} autoFocus error={shown(errors, "name")} />
    </FormDialog>
  )
}
