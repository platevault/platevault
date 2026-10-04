/**
 * T1 shell contribution: Getting started in the sidebar footer, the one-time
 * orientation tour overlay (J18) and palette commands. See src/app/shell-contract.ts.
 */
import type { PaletteCommand, ShellContribution } from "@/app/shell-contract"
import { useStore } from "@/store/core"
import { replayTour, setChecklistHidden } from "./lib/writes"
import { GettingStarted, setChecklistOpen } from "./onboarding/getting-started"
import { OrientationTour } from "./onboarding/tour"

function useT1Commands(): PaletteCommand[] {
  const hidden = useStore((s) => s.settings.onboarding.checklistHidden)
  return [
    { id: "t1:tour", label: "Replay orientation tour", group: "Actions", keywords: "onboarding walk help introduction", run: replayTour },
    hidden
      ? { id: "t1:checklist", label: "Restore Getting started", group: "Actions", keywords: "onboarding checklist", run: () => setChecklistHidden(false) }
      : { id: "t1:checklist", label: "Open Getting started", group: "Actions", keywords: "onboarding checklist progress", run: () => setChecklistOpen(true) },
    { id: "t1:add-capture", label: "Add a capture location", group: "Actions", keywords: "folder register captures index", to: "/settings/locations?add=captures" },
  ]
}

export const t1Shell: ShellContribution = {
  SidebarFooter: GettingStarted,
  Overlay: OrientationTour,
  useCommands: useT1Commands,
}
