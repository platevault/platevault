/**
 * Information architecture (foundation-owned): source list groups, go-to
 * shortcuts and the static route table the command palette lists. Route
 * paths follow HARNESS-V5-IA.md § Source list and § Screens; every route is
 * registered in `src/routes.tsx`.
 *
 * Harness v5 source list: Home (the start page), Projects, Targets and Plan
 * as primary destinations; an optional Recent group (up to three Projects,
 * no children); one Library group (Sessions, Calibration, Storage); Import in
 * the toolbar; Activity and Settings in the footer. Navigation only: the
 * Project page owns its runs and stages, a run its six steps. Labels are
 * en-GB source strings, shown through `t()`.
 */
import { Activity, CalendarClock, Crosshair, FolderKanban, HardDrive, House, Layers, type LucideIcon, Settings, SlidersHorizontal } from "lucide-react"

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Second key after `g` for the go-to shortcut. */
  goKey: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const PRIMARY_ITEMS: NavItem[] = [
  { to: "/", label: "Home", icon: House, goKey: "h" },
  { to: "/projects", label: "Projects", icon: FolderKanban, goKey: "p" },
  { to: "/targets", label: "Targets", icon: Crosshair, goKey: "t" },
  { to: "/plan", label: "Plan", icon: CalendarClock, goKey: "l" },
]

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Library",
    items: [
      { to: "/sessions", label: "Sessions", icon: Layers, goKey: "s" },
      { to: "/calibration", label: "Calibration", icon: SlidersHorizontal, goKey: "c" },
      { to: "/storage", label: "Storage", icon: HardDrive, goKey: "o" },
    ],
  },
]

export const UTILITY_ITEMS: NavItem[] = [
  { to: "/activity", label: "Activity", icon: Activity, goKey: "a" },
  { to: "/settings", label: "Settings", icon: Settings, goKey: "," },
]

export const ALL_NAV_ITEMS: NavItem[] = [...PRIMARY_ITEMS, ...NAV_GROUPS.flatMap((g) => g.items), ...UTILITY_ITEMS]

/** Settings sections (S16): v4's settled sections plus Equipment, Goal templates and Naming. */
export const SETTINGS_SECTIONS: Array<{ group: string; items: Array<{ to: string; label: string; keywords: string }> }> = [
  { group: "General", items: [{ to: "/settings/appearance", label: "Appearance", keywords: "theme dark light density language locale portuguese gruvbox nord dracula solarized catppuccin tokyo one rose pine" }] },
  {
    group: "Library",
    items: [
      { to: "/settings/locations", label: "Locations", keywords: "folders captures calibration results archive" },
      { to: "/settings/equipment", label: "Equipment", keywords: "rig optical train camera telescope filter mono osc" },
      { to: "/settings/naming", label: "Naming", keywords: "naming template tokens import archive folder" },
      { to: "/settings/sites", label: "Observing sites", keywords: "site default location latitude" },
      { to: "/settings/targets", label: "Target lookup", keywords: "simbad sesame resolver online provider" },
    ],
  },
  {
    group: "Projects",
    items: [{ to: "/settings/goal-templates", label: "Goal templates", keywords: "goals hoo sho lrgb osc dual-band template" }],
  },
  { group: "Processing", items: [{ to: "/settings/applications", label: "Applications", keywords: "pixinsight siril seti profile executable" }] },
  { group: "Prototype", items: [{ to: "/settings/about", label: "About this prototype", keywords: "reset demo seed prototype version" }] },
]

/** Static destinations listed in the command palette, beyond the source list. */
export const STATIC_DESTINATIONS: Array<{ to: string; label: string; keywords: string }> = [
  ...SETTINGS_SECTIONS.flatMap((section) => section.items.map((item) => ({ to: item.to, label: `Settings: ${item.label}`, keywords: item.keywords }))),
  { to: "/welcome", label: "Welcome and setup", keywords: "onboarding first run" },
  { to: "/design-system", label: "Design system reference", keywords: "tokens components states foundation" },
]
