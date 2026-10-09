/**
 * Slice E shell contribution (see `src/app/shell-contract.ts`): palette
 * actions for Plan tonight, each built-in Targets preset and each saved
 * preset. Slice E owns this file.
 */
import { useMessages } from "@/app/preferences"
import type { PaletteCommand, ShellContribution } from "@/app/shell-contract"
import { useStore } from "@/store/core"
import { BUILT_IN_PRESETS } from "./targets-model"

function useCommands(): PaletteCommand[] {
  const m = useMessages()
  const saved = useStore((s) => s.slices.e.savedPresets)
  return [
    { id: "e:plan-tonight", label: m.target_plan_tonight(), group: "Actions", keywords: "tonight window moon darkness timeline planner", to: "/plan" },
    // Presets that need a rig stay on the Targets toolbar, where the rig is chosen.
    ...BUILT_IN_PRESETS.filter((p) => p.needs !== "rig").map((p) => ({ id: `e:preset:${p.id}`, label: m.targets_palette_preset({ name: p.label }), group: "Actions", keywords: `preset targets ${p.definition}`, to: `/targets?preset=${p.id}` })),
    ...saved.map((p) => {
      const query = new URLSearchParams({ saved: p.id, ...Object.fromEntries(Object.entries(p.view).filter((e): e is [string, string] => Boolean(e[1]))) })
      return { id: `e:saved:${p.id}`, label: m.targets_palette_preset({ name: p.name }), group: "Actions", keywords: "saved preset targets", to: `/targets?${query.toString()}` }
    }),
  ]
}

export const eShell: ShellContribution = { useCommands }
