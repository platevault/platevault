/**
 * Information architecture (shell-owned): the source list's rows, their
 * go-to keys, and the destinations the command palette lists (spec 063
 * FR-042, HARNESS-V5-IA § Source list).
 *
 * Home, Projects and Targets lead the source list; the Library group holds
 * Sessions and Calibration; Activity and Settings sit in the footer. Import
 * is the toolbar's.
 *
 * Every row, go-to key, palette destination and status-bar link appears only
 * once the router registers its route (`useRoutable`): the palette lists no
 * unavailable destination (FR-042), and nothing links to a page that is not
 * built. A feature's page lights its row up by registering its route in
 * `src/routes.tsx`.
 *
 * Labels are getters over the message catalogue, so `item.label` is always
 * in the chosen language. Search keywords stay en-GB.
 */
import { useRouter } from "@tanstack/react-router"
import { Activity, Crosshair, FolderKanban, House, Layers, type LucideIcon, Settings, SlidersHorizontal } from "lucide-react"
import { m } from "@/lib/i18n"

export interface NavItem {
  to: string
  readonly label: string
  icon: LucideIcon
  /** The key after `G` that opens it. */
  goKey: string
  /** Extra words the palette matches, en-GB. */
  keywords?: string
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
      { to: "/calibration", get label() { return m.nav_calibration() }, icon: SlidersHorizontal, goKey: "c", keywords: "calibration raw frames keep trash masters stacking" },
    ],
  },
]

export const UTILITY_ITEMS: NavItem[] = [
  { to: "/activity", get label() { return m.nav_activity() }, icon: Activity, goKey: "a" },
  { to: "/settings", get label() { return m.nav_settings() }, icon: Settings, goKey: "," },
]

/** Every source-list row, in source-list order: the go-to keys and Help follow it. */
export const ALL_NAV_ITEMS: NavItem[] = [...PRIMARY_ITEMS, ...NAV_GROUPS.flatMap((group) => group.items), ...UTILITY_ITEMS]

export interface Destination {
  to: string
  readonly label: string
  keywords: string
}

function settingsDestination(to: string, name: () => string, keywords: string): Destination {
  return { to, get label() { return m.palette_settings_destination({ name: name() }) }, keywords }
}

/** Palette destinations beyond the source list: each Settings section, then the design-system reference. */
export const STATIC_DESTINATIONS: Destination[] = [
  settingsDestination("/settings/appearance", () => m.settings_appearance(), "theme dark light language locale"),
  settingsDestination("/settings/help", () => m.settings_help(), "help shortcuts keyboard tips guide walk"),
  settingsDestination("/settings/locations", () => m.common_locations(), "folders captures calibration results archive"),
  settingsDestination("/settings/equipment", () => m.settings_equipment(), "rig optical train camera telescope reducer filter mono osc add equipment"),
  settingsDestination("/settings/matching", () => m.settings_matching(), "matching thresholds framing overlap rotation flats darks bias"),
  settingsDestination("/settings/naming", () => m.settings_naming(), "naming template tokens import archive folder"),
  settingsDestination("/settings/sites", () => m.settings_sites(), "site default location latitude"),
  settingsDestination("/settings/targets", () => m.settings_target_lookup(), "simbad sesame resolver online provider"),
  settingsDestination("/settings/goal-templates", () => m.settings_goal_templates(), "goals hoo sho lrgb osc dual-band template"),
  settingsDestination("/settings/applications", () => m.settings_applications(), "pixinsight siril profile executable"),
  settingsDestination("/settings/about", () => m.settings_about(), "version about"),
  { to: "/design-system", get label() { return m.nav_design_system() }, keywords: "tokens components states foundation" },
]

/** Whether the router registers `to`, a route pattern such as `/projects/$projectId`. */
export function isRoutable(routesByPath: Record<string, unknown>, to: string): boolean {
  return Object.hasOwn(routesByPath, to)
}

/** `isRoutable` over the mounted router. */
export function useRoutable(): (to: string) => boolean {
  const { routesByPath } = useRouter()
  return (to) => isRoutable(routesByPath, to)
}
