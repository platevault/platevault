/**
 * The Home area's shell contribution (src/app/shell-contract.ts): the
 * palette's Import… and one Open entry per light session. It reads nothing
 * while the palette is closed: the sessions query runs only with `open`.
 */
import { useQuery } from "@tanstack/react-query"
import type { PaletteState, ShellContribution } from "@/app/shell-contract"
import { useMessages } from "@/app/preferences"
import type { PaletteCommand } from "@/components/app/contracts"
import { sessionsQuery } from "./queries"
import { sessionLabel } from "./words"

function useCommands({ open }: PaletteState): PaletteCommand[] {
  const m = useMessages()
  const sessions = useQuery({ ...sessionsQuery(null), enabled: open })
  if (!open) return []
  return [
    { id: "home:import", label: m.home_import_ellipsis(), group: "Actions", keywords: "import card sd usb device copy move", to: "/import" },
    ...(sessions.data ?? []).map(
      (s): PaletteCommand => ({ id: `sessions:open:${s.session.id}`, label: sessionLabel(m, s.session), group: m.nav_sessions(), keywords: s.session.key, to: `/sessions/${s.session.id}` }),
    ),
  ]
}

export const homeShell: ShellContribution = { useCommands }
