/**
 * Information architecture (foundation-owned): the source list, go-to
 * shortcuts and the static route table the command palette lists. Route
 * paths are fixed in HIGH-LEVEL-DESIGN.md §4 and must not drift.
 *
 * HARNESS V1 (design/HARNESS-V1.md): Direction D's Target-scoped structure in
 * a concise macOS source list. Overview is the start page; seven items in two
 * groups; Projects live in the Plan area beside D's planner; Activity and
 * Settings sit in the sidebar's bottom bar and the status bar, as macOS keeps
 * Settings out of the source list.
 */
import {
  Activity,
  CalendarClock,
  Crosshair,
  Goal,
  HardDrive,
  LayoutGrid,
  Layers,
  ListChecks,
  type LucideIcon,
  Settings,
  SlidersHorizontal,
} from "lucide-react"

export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  /** Second key after `g` for the go-to shortcut. */
  goKey: string
  /** ⌘-number shortcut shown in the source list, as Xcode and Finder do. */
  digit?: string
  /** Other route prefixes that belong to this item's area. */
  area?: string[]
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const HOME_ITEM: NavItem = { to: "/overview", label: "Overview", icon: LayoutGrid, goKey: "h", digit: "1" }

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Library",
    items: [
      { to: "/targets", label: "Targets", icon: Crosshair, goKey: "t", digit: "2" },
      { to: "/sessions", label: "Sessions", icon: Layers, goKey: "s", digit: "3" },
      { to: "/calibration", label: "Calibration", icon: SlidersHorizontal, goKey: "c" },
    ],
  },
  {
    label: "Work",
    items: [
      { to: "/views", label: "Views", icon: ListChecks, goKey: "v", digit: "4" },
      { to: "/projects", label: "Projects", icon: Goal, goKey: "p" },
      { to: "/plans", label: "Plan", icon: CalendarClock, goKey: "l", digit: "5" },
      { to: "/storage", label: "Storage", icon: HardDrive, goKey: "o" },
    ],
  },
]

export const UTILITY_ITEMS: NavItem[] = [
  { to: "/activity", label: "Activity", icon: Activity, goKey: "a" },
  { to: "/settings", label: "Settings", icon: Settings, goKey: "," },
]

export const ALL_NAV_ITEMS: NavItem[] = [HOME_ITEM, ...NAV_GROUPS.flatMap((g) => g.items), ...UTILITY_ITEMS]

/** Static destinations listed in the command palette, beyond the sidebar. */
export const STATIC_DESTINATIONS: Array<{ to: string; label: string; keywords: string }> = [
  { to: "/projects/new", label: "New Project", keywords: "create goal checklist" },
  { to: "/views/new", label: "New View", keywords: "create selection" },
  { to: "/settings/appearance", label: "Settings: Appearance", keywords: "theme dark light density" },
  { to: "/settings/locations", label: "Settings: Locations", keywords: "folders captures calibration results archive" },
  { to: "/settings/equipment", label: "Settings: Equipment", keywords: "camera telescope optical train filter" },
  { to: "/settings/sites", label: "Settings: Observing sites", keywords: "site default location latitude" },
  { to: "/settings/targets", label: "Settings: Target lookup", keywords: "simbad sesame resolver online provider" },
  { to: "/settings/applications", label: "Settings: Applications", keywords: "pixinsight siril seti profile executable" },
  { to: "/settings/about", label: "Settings: About this prototype", keywords: "reset demo seed prototype version" },
  { to: "/welcome", label: "Welcome and setup", keywords: "onboarding first run" },
  { to: "/design-system", label: "Design system reference", keywords: "tokens components states foundation" },
]
