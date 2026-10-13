/**
 * Command palette (foundation-owned): the commands of ⌘K / Ctrl+K. Jump to
 * any surface or named record (Projects, runs and run groups, Targets,
 * sessions), or run a registered app Action. Slices add commands through
 * their shell contribution. The look lives in `@/components/app/palette`.
 *
 * App Actions (`useAppActions`) are the same descriptors the toolbar's More
 * menu shows, turned into palette commands by `actionCommand`. The palette
 * lists one "Theme…" entry, opening Settings › Appearance (A SH15), instead
 * of one entry per theme.
 */
import { useNavigate, useRouter } from "@tanstack/react-router"
import { FlaskConical, Keyboard, Languages, Palette, PanelLeft } from "lucide-react"
import { type ActionRunner, actionCommand, useAction } from "@/components/app/actions"
import type { Action } from "@/components/app/contracts"
import { CommandPalette as PaletteDialog, type PaletteGroup } from "@/components/app/palette"
import { groupHref, isTrashedSession, runHref } from "@/domain/derive"
import { formatExposure, formatNight } from "@/lib/format"
import { LOCALE_META, LOCALES } from "@/lib/i18n"
import { useStore } from "@/store/core"
import { SHELLS } from "./contributions"
import { ALL_NAV_ITEMS, STATIC_DESTINATIONS } from "./navigation"
import { setLocale, setSingleKeyShortcuts, useMessages, usePreferences } from "./preferences"
import type { PaletteCommand } from "./shell-contract"
import { THEMES } from "./themes"
import { closePanel, openPanel, toggleSidebar, useShellUi } from "./ui-state"

const NO_COMMANDS = (): PaletteCommand[] => []
const contributed = SHELLS.map((shell) => shell.useCommands ?? NO_COMMANDS)

/** Contributed commands join the built-in Actions group through this `group` value. */
const ACTIONS = "Actions"

/** The search words of each app action, en-GB. */
export const APP_ACTION_KEYWORDS: Record<string, string> = {
  "toggle-sidebar": "collapse expand sidebar",
  "prototype-controls": "prototype simulation offline mount fault",
  shortcuts: "help keys keyboard",
  "single-keys": "keyboard speech accessibility",
  theme: `appearance dark light ${THEMES.map((theme) => theme.name).join(" ")}`,
  language: "language locale translation",
}

export interface AppActions {
  toggleSidebar: Action
  prototypeControls: Action
  shortcuts: Action
  singleKeys: Action
  theme: Action
  /** One per shipped locale other than the current one. */
  languages: Action[]
}

/** The app's own Actions, for the palette and the toolbar's More menu. */
export function useAppActions(): AppActions {
  const m = useMessages()
  const navigate = useNavigate()
  const { locale, singleKeyShortcuts } = usePreferences()
  return {
    toggleSidebar: { id: "toggle-sidebar", label: m.palette_toggle_sidebar(), icon: PanelLeft, shortcut: "[", run: () => toggleSidebar() },
    prototypeControls: { id: "prototype-controls", label: m.shell_prototype_controls(), icon: FlaskConical, opensDialog: true, run: () => openPanel("simulation") },
    shortcuts: { id: "shortcuts", label: m.shortcuts_show(), icon: Keyboard, shortcut: "?", run: () => openPanel("shortcuts") },
    singleKeys: singleKeyShortcuts
      ? { id: "single-keys", label: m.palette_single_key_off(), icon: Keyboard, run: () => setSingleKeyShortcuts(false) }
      : { id: "single-keys", label: m.palette_single_key_on(), icon: Keyboard, run: () => setSingleKeyShortcuts(true) },
    theme: { id: "theme", label: m.shell_theme(), icon: Palette, opensDialog: true, run: () => void navigate({ to: "/settings/appearance" }) },
    languages: LOCALES.filter((id) => id !== locale).map((id) => ({ id: `language-${id}`, label: m.shell_language_named({ name: LOCALE_META[id].nativeName }), icon: Languages, run: () => setLocale(id) })),
  }
}

function useGroups(appActions: Action[], runner: ActionRunner): PaletteGroup[] {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const extra = contributed.flatMap((hook) => hook())
  // Built-in items carry their group heading, so typing the heading finds them.
  const goTo = m.palette_group_go_to()
  const targets = m.nav_targets()
  const projects = m.nav_projects()
  const runs = m.common_runs()
  const sessions = m.nav_sessions()
  const actions = m.palette_group_actions()
  const groups: PaletteGroup[] = [
    {
      value: "go-to",
      label: goTo,
      items: [
        ...ALL_NAV_ITEMS.map((item) => ({ id: `nav:${item.to}`, label: item.label, group: goTo, to: item.to, keywords: item.keywords })),
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
        ...appActions.map((action) => actionCommand(action, actions, runner, APP_ACTION_KEYWORDS[action.id.startsWith("language-") ? "language" : action.id])),
        ...extra.filter((c) => c.group === ACTIONS).map((c) => ({ ...c, group: actions })),
      ],
    },
  ]
  const otherGroups = [...new Set(extra.filter((c) => c.group !== ACTIONS).map((c) => c.group))]
  for (const value of otherGroups) groups.push({ value, label: value, items: extra.filter((c) => c.group === value) })
  return groups.filter((g) => g.items.length > 0)
}

export function CommandPalette() {
  const { panel } = useShellUi()
  const router = useRouter()
  const runner = useAction()
  const app = useAppActions()
  const groups = useGroups([app.theme, ...app.languages, app.toggleSidebar, app.shortcuts, app.singleKeys, app.prototypeControls], runner)

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
      <PaletteDialog open={panel === "palette"} onOpenChange={(open) => !open && closePanel()} groups={groups} onRun={run} />
      {runner.feedback}
      {runner.dialog}
    </>
  )
}
