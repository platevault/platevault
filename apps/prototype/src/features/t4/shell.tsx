/**
 * T4 shell contribution (T4-owned): palette commands for calibration and
 * preparation, and a render-nothing overlay that keeps T4 observations in
 * step with the simulated world: candidate masters detected in recorded
 * output locations (CAL-FR-06) and preparation state after Pause, Cancel or
 * a restart. See src/app/shell-contract.ts.
 */
import { useEffect } from "react"
import type { PaletteCommand, ShellContribution } from "@/app/shell-contract"
import { store, useStore } from "@/store/core"
import { detectCandidates, reconcilePreparations } from "./actions"

function T4Observer() {
  const disk = useStore((s) => s.disk)
  const operations = useStore((s) => s.operations)
  const preparations = useStore((s) => s.catalog.preparations)
  useEffect(() => {
    // Observation, like indexing: it records what is on disk and never consumes a write fault.
    store.setState((s) => reconcilePreparations(detectCandidates(s).state))
  }, [disk, operations, preparations])
  return null
}

function useT4Commands(): PaletteCommand[] {
  const views = useStore((s) => s.catalog.views)
  const commands: PaletteCommand[] = [
    { id: "t4-applications", label: "Applications settings", group: "Settings", keywords: "siril pixinsight seti open in executable profile", to: "/settings/applications" },
  ]
  for (const view of Object.values(views)) {
    commands.push({ id: `t4-cal-${view.id}`, label: `Calibration for ${view.name}`, group: "Views", keywords: "calibration darks flats bias suggestions", to: `/views/${view.id}/calibration` })
    commands.push({ id: `t4-prep-${view.id}`, label: `Prepare ${view.name}`, group: "Views", keywords: "prepare handoff open review preparation", to: `/views/${view.id}/prepare` })
  }
  return commands
}

export const t4Shell: ShellContribution = {
  Overlay: T4Observer,
  useCommands: useT4Commands,
}
