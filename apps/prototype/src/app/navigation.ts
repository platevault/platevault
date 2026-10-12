/**
 * Information architecture (foundation-owned): source list groups, go-to
 * shortcuts and the static route table the command palette lists. Route
 * paths follow HARNESS-V5-IA.md § Source list and § Screens; every route is
 * registered in `src/routes.tsx`.
 *
 * Harness v5 source list: Home (the start page), Projects and Targets as
 * primary destinations; an optional Recent group (up to three Projects, no
 * children); one Library group (Sessions, Calibration); Import in the
 * toolbar; Activity and Settings in the footer. Plan is the Targets page's
 * Planned view and Storage lives in Settings › Locations (round 5). Navigation
 * only: the Project page owns its runs and stages, a run its six steps.
 *
 * Labels are getters over the message catalogue, so reading `item.label`
 * always gives the chosen language. Search keywords stay en-GB.
 */
import { Activity, Crosshair, FolderKanban, House, Layers, type LucideIcon, Settings, SlidersHorizontal } from "lucide-react"
import { m } from "@/lib/i18n"

export interface NavItem {
  to: string
  readonly label: string
  icon: LucideIcon
  /** Second key after `g` for the go-to shortcut. */
  goKey: string
}

export interface NavGroup {
  readonly label: string
  items: NavItem[]
}

export const PRIMARY_ITEMS: NavItem[] = [
  { to: "/", get label() { return m.nav_home() }, icon: House, goKey: "h" },
  { to: "/projects", get label() { return m.nav_projects() }, icon: FolderKanban, goKey: "p" },
  { to: "/targets", get label() { return m.nav_targets() }, icon: Crosshair, goKey: "t" },
]

export const NAV_GROUPS: NavGroup[] = [
  {
    get label() { return m.nav_library() },
    items: [
      { to: "/sessions", get label() { return m.nav_sessions() }, icon: Layers, goKey: "s" },
      { to: "/calibration", get label() { return m.nav_calibration() }, icon: SlidersHorizontal, goKey: "c" },
    ],
  },
]

export const UTILITY_ITEMS: NavItem[] = [
  { to: "/activity", get label() { return m.nav_activity() }, icon: Activity, goKey: "a" },
  { to: "/settings", get label() { return m.nav_settings() }, icon: Settings, goKey: "," },
]

export const ALL_NAV_ITEMS: NavItem[] = [...PRIMARY_ITEMS, ...NAV_GROUPS.flatMap((g) => g.items), ...UTILITY_ITEMS]

export interface Destination {
  to: string
  readonly label: string
  keywords: string
}

/** Settings sections (S16): v4's settled sections plus Equipment, Goal templates, Naming and Calibration. */
export const SETTINGS_SECTIONS: Array<{ readonly group: string; items: Destination[] }> = [
  {
    get group() { return m.settings_group_general() },
    items: [{ to: "/settings/appearance", get label() { return m.settings_appearance() }, keywords: "theme dark light density language locale portuguese gruvbox nord dracula solarized catppuccin tokyo one rose pine" }],
  },
  {
    get group() { return m.nav_library() },
    items: [
      { to: "/settings/locations", get label() { return m.common_locations() }, keywords: "folders captures calibration results archive" },
      { to: "/settings/equipment", get label() { return m.settings_equipment() }, keywords: "rig optical train camera telescope filter mono osc" },
      { to: "/settings/naming", get label() { return m.settings_naming() }, keywords: "naming template tokens import archive folder" },
      { to: "/settings/calibration", get label() { return m.nav_calibration() }, keywords: "calibration raw frames keep trash masters stacking" },
      { to: "/settings/sites", get label() { return m.settings_sites() }, keywords: "site default location latitude" },
      { to: "/settings/targets", get label() { return m.settings_target_lookup() }, keywords: "simbad sesame resolver online provider" },
    ],
  },
  {
    get group() { return m.nav_projects() },
    items: [{ to: "/settings/goal-templates", get label() { return m.settings_goal_templates() }, keywords: "goals hoo sho lrgb osc dual-band template" }],
  },
  {
    get group() { return m.settings_group_processing() },
    items: [{ to: "/settings/applications", get label() { return m.settings_applications() }, keywords: "pixinsight siril seti profile executable" }],
  },
  {
    get group() { return m.common_prototype() },
    items: [{ to: "/settings/about", get label() { return m.settings_about() }, keywords: "reset demo seed prototype version" }],
  },
]

/** Static destinations listed in the command palette, beyond the source list. */
export const STATIC_DESTINATIONS: Destination[] = [
  ...SETTINGS_SECTIONS.flatMap((section) =>
    section.items.map((item) => ({ to: item.to, get label() { return m.palette_settings_destination({ name: item.label }) }, keywords: item.keywords })),
  ),
  { to: "/welcome", get label() { return m.nav_welcome() }, keywords: "onboarding first run" },
  { to: "/design-system", get label() { return m.nav_design_system() }, keywords: "tokens components states foundation" },
]
