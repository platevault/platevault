/**
 * Command palette (foundation-owned): ⌘K / Ctrl+K. Jump to any surface or
 * named record, or run a global action. Built on Base UI Dialog and
 * Autocomplete (one primitive system; no cmdk).
 */
import { Autocomplete } from "@base-ui/react/autocomplete"
import { useRouter } from "@tanstack/react-router"
import { CornerDownLeft, Search } from "lucide-react"
import { useMemo, useRef } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { t1Shell } from "@/features/t1/shell"
import { t2Shell } from "@/features/t2/shell"
import { t3Shell } from "@/features/t3/shell"
import { t4Shell } from "@/features/t4/shell"
import { t5Shell } from "@/features/t5/shell"
import { formatExposure, formatNight } from "@/lib/format"
import { useStore } from "@/store/core"
import { ALL_NAV_ITEMS, STATIC_DESTINATIONS } from "./navigation"
import { setSingleKeyShortcuts, setTheme } from "./preferences"
import type { PaletteCommand } from "./shell-contract"
import { closePanel, openPanel, toggleSidebar, useShellUi } from "./ui-state"

const NO_COMMANDS = (): PaletteCommand[] => []
const contributed = [t1Shell, t2Shell, t3Shell, t4Shell, t5Shell].map((shell) => shell.useCommands ?? NO_COMMANDS)

interface Group {
  value: string
  items: PaletteCommand[]
}

function useCommands(): Group[] {
  const targets = useStore((s) => s.catalog.targets)
  const projects = useStore((s) => s.catalog.projects)
  const views = useStore((s) => s.catalog.views)
  const sessions = useStore((s) => s.catalog.sessions)
  const extra = contributed.flatMap((hook) => hook())
  return useMemo(() => {
    const groups: Group[] = [
      {
        value: "Go to",
        items: [
          ...ALL_NAV_ITEMS.map((item) => ({ id: `nav:${item.to}`, label: item.label, group: "Go to", to: item.to })),
          ...STATIC_DESTINATIONS.map((d) => ({ id: `nav:${d.to}`, label: d.label, group: "Go to", to: d.to, keywords: d.keywords })),
        ],
      },
      {
        value: "Targets",
        items: Object.values(targets).map((t) => ({ id: `target:${t.id}`, label: t.name, group: "Targets", to: `/targets/${t.id}`, keywords: t.aliases.join(" ") })),
      },
      {
        value: "Projects",
        items: Object.values(projects).map((p) => ({ id: `project:${p.id}`, label: p.name, group: "Projects", to: `/projects/${p.id}` })),
      },
      {
        value: "Views",
        items: Object.values(views).map((v) => ({ id: `view:${v.id}`, label: v.name, group: "Views", to: `/views/${v.id}` })),
      },
      {
        value: "Sessions",
        items: Object.values(sessions)
          .filter((s) => s.imageType === "light")
          .map((s) => ({
            id: `session:${s.id}`,
            label: `${formatNight(s.night)} · ${s.channel ?? "No filter"} · ${formatExposure(s.exposureS)} · ${s.objectLabel ?? "Missing OBJECT"}`,
            group: "Sessions",
            to: `/sessions/${s.id}`,
          })),
      },
      {
        value: "Actions",
        items: [
          { id: "act:theme-dark", label: "Theme: Dark", group: "Actions", keywords: "appearance night", run: () => setTheme("dark") },
          { id: "act:theme-light", label: "Theme: Light", group: "Actions", keywords: "appearance day", run: () => setTheme("light") },
          { id: "act:theme-system", label: "Theme: Match system", group: "Actions", keywords: "appearance auto", run: () => setTheme("system") },
          { id: "act:sidebar", label: "Toggle sidebar", group: "Actions", keywords: "collapse expand", run: () => toggleSidebar() },
          { id: "act:sim", label: "Open simulation controls", group: "Actions", keywords: "prototype offline mount fault", run: () => openPanel("simulation") },
          { id: "act:keys", label: "Show keyboard shortcuts", group: "Actions", keywords: "help keys", run: () => openPanel("shortcuts") },
          { id: "act:single-keys-off", label: "Single-key shortcuts: Off", group: "Actions", keywords: "keyboard speech accessibility", run: () => setSingleKeyShortcuts(false) },
          { id: "act:single-keys-on", label: "Single-key shortcuts: On", group: "Actions", keywords: "keyboard", run: () => setSingleKeyShortcuts(true) },
          ...extra.filter((c) => c.group === "Actions"),
        ],
      },
    ]
    const otherGroups = [...new Set(extra.filter((c) => c.group !== "Actions").map((c) => c.group))]
    for (const value of otherGroups) groups.push({ value, items: extra.filter((c) => c.group === value) })
    return groups.filter((g) => g.items.length > 0)
  }, [targets, projects, views, sessions, extra])
}

export function CommandPalette() {
  const { panel } = useShellUi()
  const router = useRouter()
  const groups = useCommands()
  const highlighted = useRef<PaletteCommand | undefined>(undefined)

  function run(command: PaletteCommand) {
    if (command.to) {
      // Navigate first, then close, so focus can land on the new page.
      router.history.push(command.to)
      closePanel()
      return
    }
    closePanel()
    command.run?.()
  }

  return (
    <Dialog open={panel === "palette"} onOpenChange={(open) => !open && closePanel()}>
      <DialogContent showCloseButton={false} className="top-24 max-w-xl translate-y-0 gap-0 overflow-hidden p-0 sm:max-w-xl">
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <DialogDescription className="sr-only">Type to search surfaces, records and actions. Use arrow keys to move and Enter to open.</DialogDescription>
        <Autocomplete.Root
          inline
          open
          items={groups}
          autoHighlight="always"
          itemToStringValue={(item: PaletteCommand) => `${item.label} ${item.keywords ?? ""} ${item.group}`}
          onItemHighlighted={(item: PaletteCommand | undefined) => {
            highlighted.current = item
          }}
        >
          {/* The row carries the focus indicator; an outline on the input itself would be clipped by the dialog. */}
          <div className="flex items-center gap-2 border-b px-3 focus-within:shadow-[inset_0_-2px_0_var(--ring)]">
            <Search aria-hidden="true" className="size-4 text-muted-foreground" />
            <Autocomplete.Input
              data-palette-input
              aria-label="Search surfaces, records and actions"
              placeholder="Search or jump to…"
              className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onKeyDown={(event) => {
                if (event.key === "Enter" && highlighted.current) {
                  event.preventDefault()
                  run(highlighted.current)
                }
              }}
            />
            <Kbd>Esc</Kbd>
          </div>
          <Autocomplete.Empty>
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              No matches. Try a Target name, a surface such as Sessions, or an action such as Theme.
            </p>
          </Autocomplete.Empty>
          <Autocomplete.List className="max-h-[min(60dvh,26rem)] overflow-y-auto overscroll-contain p-1">
            {(group: Group) => (
              <Autocomplete.Group key={group.value} items={group.items} className="pb-1">
                <Autocomplete.GroupLabel className="px-2 py-1.5 text-xs text-muted-foreground">{group.value}</Autocomplete.GroupLabel>
                <Autocomplete.Collection>
                  {(item: PaletteCommand) => (
                    <Autocomplete.Item
                      key={item.id}
                      value={item}
                      onClick={() => run(item)}
                      className="flex h-8 cursor-default items-center gap-2 rounded-md px-2 text-sm outline-none select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-highlighted:shadow-[inset_2px_0_0_var(--primary)]"
                    >
                      <span className="min-w-0 flex-1 truncate">{item.label}</span>
                      <CornerDownLeft aria-hidden="true" className="size-3.5 text-muted-foreground opacity-0 in-data-highlighted:opacity-100" />
                    </Autocomplete.Item>
                  )}
                </Autocomplete.Collection>
              </Autocomplete.Group>
            )}
          </Autocomplete.List>
        </Autocomplete.Root>
      </DialogContent>
    </Dialog>
  )
}
