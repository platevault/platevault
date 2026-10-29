/**
 * The Targets shell contribution (src/app/shell-contract.ts): the palette's
 * built-in presets ("Targets: Best tonight") and one Open entry per Target
 * in My targets. Reads nothing while the palette is closed: every query
 * runs only with `open`. My targets lists only under Home's criteria
 * (astro-plan-wre19.19), so without them the palette offers the presets
 * alone.
 */
import { useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useMessages } from "@/app/preferences"
import type { PaletteState, ShellContribution } from "@/app/shell-contract"
import type { PaletteCommand } from "@/components/app/contracts"
import { homeCriteriaQuery, libraryQueryWhen, myTargetsRequest, presetsQuery } from "./queries"
import { presetName } from "./targets-model"

function useCommands({ open }: PaletteState): PaletteCommand[] {
  const m = useMessages()
  const navigate = useNavigate()
  const criteria = useQuery({ ...homeCriteriaQuery(), enabled: open })
  const stored = criteria.data?.criteria ?? null
  const rows = useQuery(libraryQueryWhen("planningTargetRows", open && stored ? [myTargetsRequest(stored)] : null))
  const presets = useQuery({ ...presetsQuery({ kind: "none" }), enabled: open })
  if (!open) return []
  return [
    ...(presets.data?.builtin ?? []).map(
      (p): PaletteCommand => ({ id: `targets:preset:${p.preset}`, label: m.targets_palette_preset({ name: presetName(m, p.preset) }), group: m.nav_targets(), keywords: "targets preset plan tonight", run: () => void navigate({ to: "/targets", search: { preset: p.preset } }) }),
    ),
    ...(rows.data?.rows ?? []).map(
      (r): PaletteCommand => ({
        id: `targets:open:${r.target.id}`,
        label: r.target.commonName ? `${r.target.designation} · ${r.target.commonName}` : r.target.designation,
        group: m.nav_targets(),
        keywords: r.target.aliases.map((a) => a.text).join(" "),
        to: `/targets/${r.target.id}`,
      }),
    ),
  ]
}

export const targetsShell: ShellContribution = { useCommands }
