/**
 * Command palette (foundation-owned): ⌘K / Ctrl+K. Jump to any surface or
 * named record (Projects, runs and run groups, Targets, sessions), or run a
 * global action. Slices add commands through their shell contribution.
 * Built on Base UI Dialog and Autocomplete (one primitive system; no cmdk).
 */
import { Autocomplete } from "@base-ui/react/autocomplete"
import { useRouter } from "@tanstack/react-router"
import { CornerDownLeft, Search } from "lucide-react"
import { useMemo, useRef } from "react"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import { Kbd } from "@/components/ui/kbd"
import { groupHref, isTrashedSession, runHref } from "@/domain/derive"
import { formatExposure, formatNight } from "@/lib/format"
import { LOCALE_META, LOCALES } from "@/lib/i18n"
import { useStore } from "@/store/core"
import { SHELLS } from "./contributions"
import { ALL_NAV_ITEMS, STATIC_DESTINATIONS } from "./navigation"
import { setLocale, setSingleKeyShortcuts, setTheme, useMessages, usePreferences } from "./preferences"
import { THEMES } from "./themes"
import type { PaletteCommand } from "./shell-contract"
import { closePanel, openPanel, toggleSidebar, useShellUi } from "./ui-state"

const NO_COMMANDS = (): PaletteCommand[] => []
const contributed = SHELLS.map((shell) => shell.useCommands ?? NO_COMMANDS)

/** Contributed commands join the built-in Actions group through this `group` value. */
const ACTIONS = "Actions"

interface Group {
  value: string
  /** The heading; a contributed group's `group` value as given. */
  label: string
  items: PaletteCommand[]
}

function useCommands(): Group[] {
  const m = useMessages()
  const { locale } = usePreferences()
  const catalog = useStore((s) => s.catalog)
  const extra = contributed.flatMap((hook) => hook())
  return useMemo(() => {
    // Built-in items carry their group heading, so typing the heading finds them.
    const goTo = m.palette_group_go_to()
    const targets = m.nav_targets()
    const projects = m.nav_projects()
    const runs = m.common_runs()
    const sessions = m.nav_sessions()
    const actions = m.palette_group_actions()
    const groups: Group[] = [
      {
        value: "go-to",
        label: goTo,
        items: [
          ...ALL_NAV_ITEMS.map((item) => ({ id: `nav:${item.to}`, label: item.label, group: goTo, to: item.to })),
          ...STATIC_DESTINATIONS.map((d) => ({ id: `nav:${d.to}`, label: d.label, group: goTo, to: d.to, keywords: d.keywords })),
        ],
      },
      {
        value: "targets",
        label: targets,
        items: Object.values(catalog.targets).map((t) => ({ id: `target:${t.id}`, label: t.name, group: targets, to: `/targets/${t.id}`, keywords: t.aliases.join(" ") })),
      },
      {
        value: "projects",
        label: projects,
        items: Object.values(catalog.projects).map((p) => ({ id: `project:${p.id}`, label: p.name, group: projects, to: `/projects/${p.id}` })),
      },
      {
        value: "runs",
        label: runs,
        items: [
          ...Object.values(catalog.runs)
            .filter((r) => !r.trashedAt && !r.groupId)
            .map((r) => ({ id: `run:${r.id}`, label: r.name, group: runs, keywords: "processing run", to: runHref(r) })),
          ...Object.values(catalog.runGroups).map((g) => ({ id: `group:${g.id}`, label: g.name, group: runs, keywords: "run group mosaic panels", to: groupHref(g) })),
        ],
      },
      {
        value: "sessions",
        label: sessions,
        items: Object.values(catalog.sessions)
          .filter((s) => s.imageType === "light" && !s.supersededBy && !isTrashedSession(catalog, s))
          .map((s) => ({
            id: `session:${s.id}`,
            label: `${formatNight(s.night)} · ${s.channel ?? m.palette_session_no_filter()} · ${formatExposure(s.exposureS)} · ${s.objectLabel ?? m.palette_session_missing_object()}`,
            group: sessions,
            to: `/sessions/${s.id}`,
          })),
      },
      {
        value: ACTIONS,
        label: actions,
        items: [
          ...THEMES.map((theme) => ({ id: `act:theme-${theme.id}`, label: m.shell_theme_named({ name: theme.name }), group: actions, keywords: `appearance ${theme.scheme}`, run: () => setTheme(theme.id) })),
          { id: "act:theme-system", label: m.shell_theme_named({ name: m.shell_theme_match_system() }), group: actions, keywords: "appearance auto", run: () => setTheme("system") },
          ...LOCALES.map((id) => ({ id: `act:locale-${id}`, label: m.shell_language_named({ name: LOCALE_META[id].nativeName }), group: actions, keywords: "language locale translation", run: () => setLocale(id) })),
          { id: "act:sidebar", label: m.palette_toggle_sidebar(), group: actions, keywords: "collapse expand", run: () => toggleSidebar() },
          { id: "act:sim", label: m.palette_open_simulation(), group: actions, keywords: "prototype offline mount fault", run: () => openPanel("simulation") },
          { id: "act:keys", label: m.shortcuts_show(), group: actions, keywords: "help keys", run: () => openPanel("shortcuts") },
          { id: "act:single-keys-off", label: m.palette_single_key_off(), group: actions, keywords: "keyboard speech accessibility", run: () => setSingleKeyShortcuts(false) },
          { id: "act:single-keys-on", label: m.palette_single_key_on(), group: actions, keywords: "keyboard", run: () => setSingleKeyShortcuts(true) },
          ...extra.filter((c) => c.group === ACTIONS),
        ],
      },
    ]
    const otherGroups = [...new Set(extra.filter((c) => c.group !== ACTIONS).map((c) => c.group))]
    for (const value of otherGroups) groups.push({ value, label: value, items: extra.filter((c) => c.group === value) })
    return groups.filter((g) => g.items.length > 0)
  }, [m, locale, catalog, extra])
}

export function CommandPalette() {
  const m = useMessages()
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
        <DialogTitle className="sr-only">{m.palette_title()}</DialogTitle>
        <DialogDescription className="sr-only">{m.palette_description()}</DialogDescription>
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
              aria-label={m.palette_search_label()}
              placeholder={m.shell_search_or_jump()}
              className="h-11 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
              onKeyDown={(event) => {
                if (event.key === "Enter" && highlighted.current) {
                  event.preventDefault()
                  run(highlighted.current)
                }
              }}
            />
            <Kbd>{m.key_escape()}</Kbd>
          </div>
          <Autocomplete.Empty>
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{m.palette_empty()}</p>
          </Autocomplete.Empty>
          <Autocomplete.List className="max-h-[min(60dvh,26rem)] overflow-y-auto overscroll-contain p-1">
            {(group: Group) => (
              <Autocomplete.Group key={group.value} items={group.items} className="pb-1">
                <Autocomplete.GroupLabel className="px-2 py-1.5 text-xs text-muted-foreground">{group.label}</Autocomplete.GroupLabel>
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
