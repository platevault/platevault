/**
 * T3 shell contribution: palette entries for every View, New View, and, while
 * Review frames is open, its frame commands (the visible J, K and X controls).
 */
import { useSyncExternalStore } from "react"
import type { PaletteCommand, ShellContribution } from "@/app/shell-contract"
import { useStore } from "@/store/core"

export interface FrameCommands {
  next: () => void
  previous: () => void
  exclude: () => void
  excludeLabel: string
}

let frameCommands: FrameCommands | null = null
const listeners = new Set<() => void>()

/** Review frames registers its commands while mounted; null on unmount. */
export function registerFrameCommands(commands: FrameCommands | null) {
  frameCommands = commands
  for (const listener of listeners) listener()
}

function useFrameCommands() {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => frameCommands,
  )
}

function useCommands(): PaletteCommand[] {
  const views = useStore((s) => Object.values(s.catalog.views).sort((a, b) => b.createdAt.localeCompare(a.createdAt)))
  const frames = useFrameCommands()
  const commands: PaletteCommand[] = [
    { id: "t3-new-view", label: "New View", group: "Actions", keywords: "create view standalone", to: "/views/new" },
    ...views.map((view) => ({ id: `t3-view-${view.id}`, label: view.name, group: "Views", keywords: "view workspace", to: `/views/${view.id}/sessions` })),
  ]
  if (frames) {
    commands.push(
      { id: "t3-next-frame", label: "Next frame (J)", group: "Review frames", keywords: "frame next j", run: frames.next },
      { id: "t3-previous-frame", label: "Previous frame (K)", group: "Review frames", keywords: "frame previous k", run: frames.previous },
      { id: "t3-exclude-frame", label: `${frames.excludeLabel} (X)`, group: "Review frames", keywords: "exclude restore frame view x", run: frames.exclude },
    )
  }
  return commands
}

export const t3Shell: ShellContribution = { useCommands }
