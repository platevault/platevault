/**
 * App shell (foundation-owned): root providers, the main layout with sidebar,
 * header and status area, and the minimal onboarding layout.
 */
import { Link, Outlet } from "@tanstack/react-router"
import { Aperture, FlaskConical, MapPinOff, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Search, Sun, TriangleAlert, Unplug } from "lucide-react"
import type { ReactNode } from "react"
import { EmptyState } from "@/components/app/feedback"
import { useDocumentTitle } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { t1Shell } from "@/features/t1/shell"
import { t2Shell } from "@/features/t2/shell"
import { t3Shell } from "@/features/t3/shell"
import { t4Shell } from "@/features/t4/shell"
import { t5Shell } from "@/features/t5/shell"
import { cn } from "@/lib/utils"
import { useStore } from "@/store/core"
import { CommandPalette } from "./command-palette"
import { NAV_GROUPS, type NavItem, UTILITY_ITEMS } from "./navigation"
import { setTheme, type ThemePreference, usePreferences } from "./preferences"
import { MOD_LABEL, ShortcutsDialog, useGlobalShortcuts } from "./shortcuts"
import { SimulationSheet } from "./simulation-panel"
import { openPanel, toggleSidebar, useShellUi } from "./ui-state"

const SHELLS = [t1Shell, t2Shell, t3Shell, t4Shell, t5Shell]

export function RootLayout() {
  useGlobalShortcuts()
  return (
    <TooltipProvider delay={400}>
      <Outlet />
      <CommandPalette />
      <ShortcutsDialog />
      <SimulationSheet />
      {SHELLS.map((shell, index) => (shell.Overlay ? <shell.Overlay key={index} /> : null))}
    </TooltipProvider>
  )
}

function SkipLink() {
  return (
    <a
      href="#main"
      onClick={(event) => {
        event.preventDefault()
        document.getElementById("main")?.focus()
      }}
      className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:px-3 focus:py-2"
    >
      Skip to main content
    </a>
  )
}

function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon
  const link = (
    <Link
      to={item.to}
      className={cn(
        "flex h-8 items-center gap-2.5 rounded-md px-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
        "data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-sidebar-accent-foreground data-[status=active]:shadow-[inset_2px_0_0_var(--sidebar-primary)]",
        collapsed && "justify-center px-0",
      )}
      aria-label={collapsed ? item.label : undefined}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </Link>
  )
  if (!collapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">{item.label}</TooltipContent>
    </Tooltip>
  )
}

function Sidebar() {
  const { sidebarCollapsed: collapsed } = useShellUi()
  return (
    <aside
      className={cn("flex shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground", collapsed ? "w-12" : "w-56")}
      aria-label="Sidebar"
    >
      <div className={cn("flex h-11 items-center gap-2 border-b border-sidebar-border px-3", collapsed && "justify-center px-0")}>
        <Aperture aria-hidden="true" className="size-5 shrink-0 text-primary" />
        {collapsed ? <span className="sr-only">PlateVault</span> : <span className="font-semibold">PlateVault</span>}
      </div>
      <nav aria-label="Main" className="flex-1 space-y-4 overflow-y-auto p-2">
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="space-y-0.5">
            {collapsed ? (
              <div className="mx-auto my-1 h-px w-6 bg-sidebar-border" aria-hidden="true" />
            ) : (
              <div className="px-2 pb-1 text-xs text-sidebar-foreground/60">{group.label}</div>
            )}
            <ul className="space-y-0.5">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink item={item} collapsed={collapsed} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="space-y-0.5 border-t border-sidebar-border p-2">
        {SHELLS.map((shell, index) => (shell.SidebarFooter ? <shell.SidebarFooter key={index} collapsed={collapsed} /> : null))}
        <ul className="space-y-0.5" aria-label="Utilities">
          {UTILITY_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink item={item} collapsed={collapsed} />
            </li>
          ))}
        </ul>
      </div>
    </aside>
  )
}

const THEME_ICON: Record<ThemePreference, typeof Moon> = { dark: Moon, light: Sun, system: Monitor }

function ThemeMenu() {
  const { theme } = usePreferences()
  const Icon = THEME_ICON[theme]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={`Theme: ${theme === "system" ? "match system" : theme}`} />}>
        <Icon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Theme</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemePreference)}>
            <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="system">Match system</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Header status area: running work, interrupted work and offline locations. */
function StatusArea() {
  const running = useStore((s) => Object.values(s.operations).filter((op) => op.status === "running"))
  const interrupted = useStore((s) => Object.values(s.operations).filter((op) => op.status === "interrupted").length)
  const offline = useStore((s) => Object.values(s.catalog.locations).filter((l) => !s.disk.volumes[l.volumeId]?.mounted))
  const first = running[0]
  const pct = first && first.progress.total > 0 ? Math.round((first.progress.done / first.progress.total) * 100) : null
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {first ? (
        <Button variant="ghost" size="sm" render={<Link to="/activity" />} className="min-w-0 max-w-48 shrink tabular-nums xl:max-w-64">
          <Spinner data-icon="inline-start" aria-hidden="true" />
          <span className="truncate">
            {first.title}
            {pct !== null ? ` ${pct}%` : ""}
            {running.length > 1 ? ` (+${running.length - 1})` : ""}
          </span>
        </Button>
      ) : null}
      {interrupted > 0 ? (
        <Button variant="ghost" size="sm" render={<Link to="/activity" />} className="text-warning" aria-label={`${interrupted} interrupted operation${interrupted === 1 ? "" : "s"}`}>
          <TriangleAlert data-icon="inline-start" aria-hidden="true" />
          <span className="tabular-nums">{interrupted}</span>
          <span className="hidden xl:inline">interrupted</span>
        </Button>
      ) : null}
      {offline.length > 0 ? (
        <Button
          variant="ghost"
          size="sm"
          render={<Link to="/storage" />}
          className="text-warning"
          aria-label={offline.length === 1 ? `${offline[0]!.displayName} offline` : `${offline.length} locations offline`}
        >
          <Unplug data-icon="inline-start" aria-hidden="true" />
          <span className="tabular-nums xl:hidden">{offline.length}</span>
          <span className="hidden xl:inline">{offline.length === 1 ? `${offline[0]!.displayName} offline` : `${offline.length} locations offline`}</span>
        </Button>
      ) : null}
      <Button variant="outline" size="sm" onClick={() => openPanel("simulation")}>
        <FlaskConical data-icon="inline-start" aria-hidden="true" />
        Prototype
      </Button>
      <ThemeMenu />
    </div>
  )
}

function PaletteTrigger() {
  return (
    <Button variant="outline" size="sm" className="w-44 min-w-0 shrink justify-start text-muted-foreground xl:w-72" onClick={() => openPanel("palette")}>
      <Search data-icon="inline-start" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left">Search or jump to…</span>
      <Kbd>{MOD_LABEL} K</Kbd>
    </Button>
  )
}

/** The single scroll container; the skip link targets it. */
function MainArea({ children }: { children: ReactNode }) {
  return (
    <main id="main" tabIndex={-1} className="relative flex min-h-0 flex-1 flex-col overflow-y-auto outline-none">
      {children}
    </main>
  )
}

/** Sidebar, header and main area; the page goes in `children`. */
function AppFrame({ children }: { children: ReactNode }) {
  const { sidebarCollapsed } = useShellUi()
  return (
    <div className="flex h-dvh overflow-hidden">
      <SkipLink />
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="z-20 flex h-11 min-w-0 shrink-0 items-center gap-2 border-b px-2">
          <Button variant="ghost" size="icon" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
          </Button>
          <PaletteTrigger />
          <div className="min-w-0 flex-1" />
          <StatusArea />
        </header>
        <MainArea>{children}</MainArea>
      </div>
    </div>
  )
}

export function AppShell() {
  return (
    <AppFrame>
      <Outlet />
    </AppFrame>
  )
}

/** Unknown route: say what happened and offer the home surface, inside the shell. */
export function NotFoundPage() {
  useDocumentTitle("Page not found")
  return (
    <AppFrame>
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center p-6">
        <EmptyState
          icon={MapPinOff}
          title="This page does not exist"
          titleAs="h1"
          description="The link may come from an older prototype build. Your library is unchanged."
          action={
            <Button render={<Link to="/targets" />} size="sm">
              Go to Targets
            </Button>
          }
        />
      </div>
    </AppFrame>
  )
}

/** Focused layout for first-run setup: no sidebar, one task at a time. */
export function SetupShell() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <SkipLink />
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <Aperture aria-hidden="true" className="size-5 text-primary" />
        <span className="font-semibold">PlateVault</span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => openPanel("simulation")}>
          <FlaskConical data-icon="inline-start" aria-hidden="true" />
          Prototype
        </Button>
        <ThemeMenu />
      </header>
      <MainArea>
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col">
          <Outlet />
        </div>
      </MainArea>
    </div>
  )
}
