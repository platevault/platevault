/**
 * T2 shell contribution (T2-owned): palette commands for library review
 * shortcuts and indexing. See src/app/shell-contract.ts.
 */
import type { PaletteCommand, ShellContribution } from "@/app/shell-contract"
import { useStore } from "@/store/core"
import { startIndexing } from "@/store/operations"

function useCommands(): PaletteCommand[] {
  const online = useStore((s) =>
    Object.values(s.catalog.locations)
      .filter((l) => s.disk.volumes[l.volumeId]?.mounted)
      .map((l) => l.id)
      .join(","),
  )
  const commands: PaletteCommand[] = [
    { id: "t2:needs-review", label: "Sessions that need review", group: "Library", keywords: "target association confirm evidence", to: "/sessions?target=needs-review" },
    { id: "t2:unresolved", label: "Sessions with no Target", group: "Library", keywords: "unresolved object missing", to: "/sessions?target=unresolved" },
    { id: "t2:changed", label: "Frames with changed content", group: "Library", keywords: "drift quality rehash", to: "/sessions?quality=changed-content" },
    { id: "t2:unavailable", label: "Sessions with unavailable frames", group: "Library", keywords: "offline unreadable", to: "/sessions?availability=unavailable" },
    { id: "t2:calibration", label: "Calibration sets in Sessions", group: "Library", keywords: "dark flat bias", to: "/sessions?type=calibration" },
  ]
  if (online) {
    commands.push({
      id: "t2:rescan",
      label: "Rescan every online location",
      group: "Actions",
      keywords: "index scan refresh",
      run: () => startIndexing(online.split(",")),
    })
  }
  return commands
}

export const t2Shell: ShellContribution = { useCommands }
