/**
 * The command palette's commands (shell-owned; spec 063 FR-042): ⌘K /
 * Ctrl+K opens it everywhere. It lists the registered destinations, the
 * app's Actions and what each feature contributes (its entities and row
 * Actions, through `ShellContribution.useCommands`). The look lives in
 * `@/components/app/palette`.
 *
 * App Actions (`useAppActions`) are the descriptors the toolbar's More menu
 * also shows; `actionCommand` turns each into a palette command, so both
 * carry one label, shortcut and run. A destination is listed only once its
 * route is registered: the palette lists no unavailable destination.
 */
import { useRouter } from "@tanstack/react-router"
import { Keyboard, Palette, PanelLeft } from "lucide-react"
import { type ActionRunner, actionCommand, useAction } from "@/components/app/actions"
import type { Action, PaletteCommand } from "@/components/app/contracts"
import { CommandPalette as PaletteDialog, type PaletteGroup } from "@/components/app/palette"
import { SHELLS } from "./contributions"
import { ALL_NAV_ITEMS, STATIC_DESTINATIONS, useRoutable } from "./navigation"
import { setSingleKeyShortcuts, useMessages, usePreferences } from "./preferences"
import { THEMES } from "./themes"
import { closePanel, openPanel, toggleSidebar, useShellUi } from "./ui-state"

const NO_COMMANDS = (): PaletteCommand[] => []
const contributed = SHELLS.map((shell) => shell.useCommands ?? NO_COMMANDS)

/** Contributed commands join the built-in Actions group through this `group` value. */
export const ACTIONS_GROUP = "Actions"

/** The search words of each app action, en-GB. */
const APP_ACTION_KEYWORDS: Record<string, string> = {
  "toggle-sidebar": "collapse expand sidebar",
  shortcuts: "help keys keyboard",
  "single-keys": "keyboard speech accessibility",
  theme: `appearance dark light language ${THEMES.map((theme) => theme.name).join(" ")}`,
}

/** The app's own Actions, for the palette and the toolbar's More menu. Theme… opens Settings › Appearance, so it is listed once that page is. */
export function useAppActions(): Action[] {
  const m = useMessages()
  const router = useRouter()
  const routable = useRoutable()
  const { singleKeyShortcuts } = usePreferences()
  const theme: Action = { id: "theme", label: m.shell_theme(), icon: Palette, opensDialog: true, run: () => router.history.push("/settings/appearance") }
  return [
    ...(routable("/settings/appearance") ? [theme] : []),
    { id: "toggle-sidebar", label: m.palette_toggle_sidebar(), icon: PanelLeft, shortcut: "[", run: () => toggleSidebar() },
    { id: "shortcuts", label: m.shortcuts_show(), icon: Keyboard, shortcut: "?", run: () => openPanel("shortcuts") },
    singleKeyShortcuts
      ? { id: "single-keys", label: m.palette_single_key_off(), icon: Keyboard, run: () => setSingleKeyShortcuts(false) }
      : { id: "single-keys", label: m.palette_single_key_on(), icon: Keyboard, run: () => setSingleKeyShortcuts(true) },
  ]
}

function usePaletteGroups(open: boolean, appActions: Action[], runner: ActionRunner): PaletteGroup[] {
  const m = useMessages()
  const routable = useRoutable()
  const extra = contributed.flatMap((hook) => hook({ open }))
  // Built-in items carry their group heading, so typing the heading finds them.
  const goTo = m.palette_group_go_to()
  const actions = m.palette_group_actions()
  const groups: PaletteGroup[] = [
    {
      value: "go-to",
      label: goTo,
      items: [
        ...ALL_NAV_ITEMS.filter((item) => routable(item.to)).map((item) => ({ id: `nav:${item.to}`, label: item.label, group: goTo, to: item.to, keywords: item.keywords })),
        ...STATIC_DESTINATIONS.filter((item) => routable(item.to)).map((item) => ({ id: `nav:${item.to}`, label: item.label, group: goTo, to: item.to, keywords: item.keywords })),
      ],
    },
    {
      value: ACTIONS_GROUP,
      label: actions,
      items: [
        ...appActions.map((action) => actionCommand(action, actions, runner, APP_ACTION_KEYWORDS[action.id])),
        ...extra.filter((command) => command.group === ACTIONS_GROUP).map((command) => ({ ...command, group: actions })),
      ],
    },
  ]
  const otherGroups = [...new Set(extra.filter((command) => command.group !== ACTIONS_GROUP).map((command) => command.group))]
  for (const value of otherGroups) groups.push({ value, label: value, items: extra.filter((command) => command.group === value) })
  return groups.filter((group) => group.items.length > 0)
}

export function CommandPalette() {
  const { panel } = useShellUi()
  const open = panel === "palette"
  const router = useRouter()
  const runner = useAction()
  const groups = usePaletteGroups(open, useAppActions(), runner)

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
    <>
      <PaletteDialog open={open} onOpenChange={(open) => !open && closePanel()} groups={groups} onRun={run} />
      {runner.feedback}
      {runner.dialog}
    </>
  )
}
