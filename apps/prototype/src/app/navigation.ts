/**
 * Information architecture (foundation-owned): sidebar groups, go-to
 * shortcuts and the static route table the command palette lists.
 * Route paths are fixed in HIGH-LEVEL-DESIGN.md §4 and must not drift.
 *
 * Harness v4 source list: two primary destinations (Pipeline, the start
 * page, and Plan), one Library group, and Activity and Settings in the
 * footer. Views are reached from the Pipeline board, not as menu items.
 */
import {
  Activity,
  CalendarClock,
  Crosshair,
  Goal,
  HardDrive,
  Layers,
  type LucideIcon,
  Settings,
  SlidersHorizontal,
  Workflow,
} from "lucide-react"

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

/** Pipeline is the start page: every View, grouped by its current stage. */
export const PRIMARY_ITEMS: NavItem[] = [
  { to: "/views", label: "Pipeline", icon: Workflow, goKey: "v" },
  { to: "/plans", label: "Plan", icon: CalendarClock, goKey: "l" },
]

export const NAV_GROUPS: NavGroup[] = [
  {
    label: "Library",
    items: [
      { to: "/targets", label: "Targets", icon: Crosshair, goKey: "t" },
      { to: "/sessions", label: "Sessions", icon: Layers, goKey: "s" },
      { to: "/calibration", label: "Calibration", icon: SlidersHorizontal, goKey: "c" },
      { to: "/projects", label: "Projects", icon: Goal, goKey: "p" },
      { to: "/storage", label: "Storage", icon: HardDrive, goKey: "o" },
    ],
  },
]

export const UTILITY_ITEMS: NavItem[] = [
  { to: "/activity", label: "Activity", icon: Activity, goKey: "a" },
  { to: "/settings", label: "Settings", icon: Settings, goKey: "," },
]

export const ALL_NAV_ITEMS: NavItem[] = [...PRIMARY_ITEMS, ...NAV_GROUPS.flatMap((g) => g.items), ...UTILITY_ITEMS]

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
