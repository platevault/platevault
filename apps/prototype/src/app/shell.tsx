/**
 * App shell (foundation-owned): root providers and the window layout.
 *
 * Harness v2 (HARNESS-V2.md §Window): the window is the layout. A unified
 * toolbar on top, the source list on the left (resizable, collapsible to an
 * icon rail with `[`), the content pane, and a status bar at the bottom. The
 * window never scrolls; each pane scrolls on its own. Below 768 px (WCAG
 * 1.4.10 reflow) the source list leaves the layout and opens as a drawer.
 */
import { Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router"
import {
  Activity,
  Aperture,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  FlaskConical,
  Keyboard,
  MapPinOff,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Search,
  Settings,
  Sun,
  TriangleAlert,
  Unplug,
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { EmptyState, LiveAnnouncer } from "@/components/app/feedback"
import { useDocumentTitle } from "@/components/app/page"
import { SplitHandle, useStoredState } from "@/components/app/studio"
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
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
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
import { NAV_GROUPS, type NavGroup, type NavItem } from "./navigation"
import { setTheme, type ThemePreference, usePreferences } from "./preferences"
import { MOD_LABEL, ShortcutsDialog, useGlobalShortcuts } from "./shortcuts"
import { SimulationSheet } from "./simulation-panel"
import { TargetFinder } from "./target-finder"
import { openPanel, toggleSidebar, useShellUi } from "./ui-state"

const SHELLS = [t1Shell, t2Shell, t3Shell, t4Shell, t5Shell]

export function RootLayout() {
  useGlobalShortcuts()
  return (
    <TooltipProvider delay={400}>
      <LiveAnnouncer />
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
      className="sr-only rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-[80]"
    >
      Skip to main content
    </a>
  )
}

/* ---------------------------------------------------------------- source list */

function SourceLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const Icon = item.icon
  const link = (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === "/" }}
      data-inset-focus=""
      className={cn(
        "flex h-6.5 items-center gap-2 rounded-sm px-2 text-sm text-sidebar-foreground outline-none hover:bg-hover",
        "data-[status=active]:bg-selected data-[status=active]:font-medium data-[status=active]:text-selected-foreground",
        collapsed && "justify-center px-0",
      )}
      aria-label={collapsed ? item.label : undefined}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground in-data-[status=active]:text-primary" />
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

function SourceGroup({ group, collapsed }: { group: NavGroup; collapsed: boolean }) {
  const [open, setOpen] = useStoredState<boolean>(`nav.${group.id}`, true)
  const Chevron = open ? ChevronDown : ChevronRight
  const items = (
    <ul className="space-y-px px-1.5" aria-label={collapsed ? group.label : undefined}>
      {group.items.map((item) => (
        <li key={item.to}>
          <SourceLink item={item} collapsed={collapsed} />
        </li>
      ))}
    </ul>
  )
  if (collapsed) return <div className="py-1">{items}</div>
  return (
    <section aria-labelledby={`nav-${group.id}`} className="py-1">
      <h2 id={`nav-${group.id}`}>
        <button
          type="button"
          aria-expanded={open}
          aria-controls={`nav-${group.id}-items`}
          onClick={() => setOpen(!open)}
          data-inset-focus=""
          className="flex h-6 w-full items-center gap-1 pl-2 text-left outline-none"
        >
          <Chevron aria-hidden="true" className="size-3 text-muted-foreground" />
          <span className="panel-title">{group.label}</span>
        </button>
      </h2>
      <div id={`nav-${group.id}-items`} hidden={!open}>
        {items}
      </div>
    </section>
  )
}

function SourceListContent({ collapsed }: { collapsed: boolean }) {
  const [library, work] = NAV_GROUPS as [NavGroup, NavGroup]
  return (
    <>
      <nav aria-label="Main" className="flex min-h-0 flex-1 flex-col overflow-y-auto py-1">
        <SourceGroup group={library} collapsed={collapsed} />
        {collapsed ? (
          <div className="px-1.5 py-1">
            <SourceLink item={{ to: "/targets", label: "Targets", icon: Crosshair, goKey: "t" }} collapsed />
          </div>
        ) : (
          <TargetFinder />
        )}
        <SourceGroup group={work} collapsed={collapsed} />
      </nav>
      <div className="space-y-px border-t border-seam p-1.5">
        {SHELLS.map((shell, index) => (shell.SidebarFooter ? <shell.SidebarFooter key={index} collapsed={collapsed} /> : null))}
      </div>
    </>
  )
}

const SOURCE_LIST_WIDTH = 216

function SourceList() {
  const { sidebarCollapsed: collapsed } = useShellUi()
  const [width, setWidth] = useStoredState<number>("width.source-list", SOURCE_LIST_WIDTH)
  return (
    <>
      <aside
        id="source-list"
        aria-label="Source list"
        style={collapsed ? undefined : { width }}
        className={cn("chrome flex shrink-0 flex-col bg-sidebar text-sidebar-foreground", collapsed && "w-10")}
      >
        <SourceListContent collapsed={collapsed} />
      </aside>
      {collapsed ? (
        <div aria-hidden="true" className="w-px shrink-0 bg-seam" />
      ) : (
        <SplitHandle label="Resize source list" value={width} min={184} max={320} reset={SOURCE_LIST_WIDTH} direction={1} onChange={setWidth} controls="source-list" />
      )}
    </>
  )
}

/**
 * Below 768 px (WCAG 1.4.10 reflow, 1280 px at 200 % and up) the source
 * list leaves the layout and opens as a drawer from the toolbar.
 */
const NARROW_QUERY = "(max-width: 767.98px)"

function useNarrowViewport(): boolean {
  return useSyncExternalStore(
    (listener) => {
      const query = window.matchMedia(NARROW_QUERY)
      query.addEventListener("change", listener)
      return () => query.removeEventListener("change", listener)
    },
    () => window.matchMedia(NARROW_QUERY).matches,
  )
}

/**
 * The source list as a drawer below 768 px. Choosing a link closes it and
 * focus moves to the new page's heading; Escape or the backdrop returns
 * focus to the menu button.
 */
function SourceListDrawer() {
  const [open, setOpen] = useState(false)
  const navigated = useRef(false)
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        if (next) navigated.current = false
        setOpen(next)
      }}
    >
      <SheetTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Open navigation" />}>
        <PanelLeftOpen aria-hidden="true" />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="w-64 max-w-[85vw] gap-0 bg-sidebar p-0 text-sidebar-foreground"
        finalFocus={() => (navigated.current ? (routeFocusTarget(null) ?? true) : true)}
        onClick={(event) => {
          if (!(event.target as Element).closest("a[href]")) return
          navigated.current = true
          setOpen(false)
        }}
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SourceListContent collapsed={false} />
      </SheetContent>
    </Sheet>
  )
}

/* ---------------------------------------------------------------- toolbar */

const THEME_ICON: Record<ThemePreference, typeof Moon> = { dark: Moon, light: Sun, system: Monitor }

function ThemeMenu() {
  const { theme } = usePreferences()
  const Icon = THEME_ICON[theme]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Theme: ${theme === "system" ? "match system" : theme}`} />}>
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

/** The palette trigger reads as the toolbar's search field; below 768 px it is an icon button with the same name. */
function PaletteTrigger({ narrow }: { narrow: boolean }) {
  if (narrow) {
    return (
      <Button variant="ghost" size="icon-sm" onClick={() => openPanel("palette")}>
        <Search aria-hidden="true" />
        <span className="sr-only">Search or jump to...</span>
      </Button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => openPanel("palette")}
      className="flex h-6.5 w-72 min-w-0 shrink items-center gap-1.5 rounded-md border border-input/60 bg-canvas px-2 text-left text-xs text-muted-foreground outline-none hover:border-input xl:w-96"
    >
      <Search aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate">Search or jump to...</span>
      <Kbd>{MOD_LABEL} K</Kbd>
    </button>
  )
}

function Toolbar({ narrow }: { narrow: boolean }) {
  const router = useRouter()
  const { sidebarCollapsed } = useShellUi()
  return (
    <header className="chrome z-20 flex h-[var(--toolbar-h)] min-w-0 shrink-0 items-center gap-1 border-b border-seam bg-toolbar px-2">
      {narrow ? (
        <SourceListDrawer />
      ) : (
        <Button variant="ghost" size="icon-sm" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Expand source list" : "Collapse source list"} aria-controls="source-list">
          {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </Button>
      )}
      <div className="flex items-center" role="group" aria-label="History">
        <Button variant="ghost" size="icon-sm" aria-label="Back" onClick={() => router.history.back()}>
          <ChevronLeft aria-hidden="true" />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Forward" onClick={() => router.history.forward()}>
          <ChevronRight aria-hidden="true" />
        </Button>
      </div>
      <div className="flex min-w-0 items-center gap-1.5 px-1.5 max-sm:hidden">
        <Aperture aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
        <span className="text-sm font-semibold text-foreground">PlateVault</span>
      </div>
      <div className="flex min-w-0 flex-1 justify-center px-2">
        <PaletteTrigger narrow={narrow} />
      </div>
      <Button variant="ghost" size={narrow ? "icon-sm" : "sm"} onClick={() => openPanel("simulation")}>
        <FlaskConical data-icon="inline-start" aria-hidden="true" />
        <span className={cn(narrow && "sr-only")}>Prototype</span>
      </Button>
      <ThemeMenu />
      <Button variant="ghost" size="icon-sm" aria-label="Settings" render={<Link to="/settings" />}>
        <Settings aria-hidden="true" />
      </Button>
    </header>
  )
}

/* ---------------------------------------------------------------- status bar */

/** Library totals in the status bar: what the catalogue holds right now. */
function LibraryTotals() {
  const catalog = useStore((s) => s.catalog)
  let sessions = 0
  let frames = 0
  for (const session of Object.values(catalog.sessions)) {
    if (session.supersededBy || session.imageType !== "light") continue
    sessions += 1
    frames += session.assetIds.length
  }
  return (
    <span className="num truncate max-md:hidden">
      {sessions} light sessions · {frames} frames
    </span>
  )
}

/** Status bar: running and interrupted work, offline locations, totals, and Activity. */
function StatusBar() {
  const running = useStore((s) => Object.values(s.operations).filter((op) => op.status === "running"))
  const interrupted = useStore((s) => Object.values(s.operations).filter((op) => op.status === "interrupted").length)
  const offline = useStore((s) => Object.values(s.catalog.locations).filter((l) => !s.disk.volumes[l.volumeId]?.mounted))
  const first = running[0]
  const pct = first && first.progress.total > 0 ? Math.round((first.progress.done / first.progress.total) * 100) : null
  return (
    <footer
      aria-label="Status bar"
      className="chrome flex h-[var(--statusbar-h)] min-w-0 shrink-0 items-center gap-1 border-t border-seam bg-toolbar px-1.5 text-xs text-muted-foreground"
    >
      {first ? (
        <Button variant="ghost" size="xs" render={<Link to="/activity" />} className="min-w-0 max-w-64 font-normal text-foreground">
          <Spinner data-icon="inline-start" aria-hidden="true" />
          <span className="num truncate">
            {first.title}
            {pct !== null ? ` ${pct}%` : ""}
            {running.length > 1 ? ` (+${running.length - 1})` : ""}
          </span>
        </Button>
      ) : (
        <span className="px-1.5 max-sm:hidden">Idle</span>
      )}
      {interrupted > 0 ? (
        <Button variant="ghost" size="xs" render={<Link to="/activity" />} className="font-normal text-warning">
          <TriangleAlert data-icon="inline-start" aria-hidden="true" />
          <span className="num">
            {interrupted} interrupted
          </span>
        </Button>
      ) : null}
      {offline.length > 0 ? (
        <Button variant="ghost" size="xs" render={<Link to="/storage" />} className="min-w-0 font-normal text-warning">
          <Unplug data-icon="inline-start" aria-hidden="true" />
          <span className="truncate">{offline.length === 1 ? `${offline[0]!.displayName} offline` : `${offline.length} locations offline`}</span>
        </Button>
      ) : null}
      <span aria-hidden="true" className="mx-1 h-3 w-px bg-border max-md:hidden" />
      <LibraryTotals />
      <span className="flex-1" />
      <Button variant="ghost" size="xs" onClick={() => openPanel("shortcuts")} className="font-normal max-sm:hidden">
        <Keyboard data-icon="inline-start" aria-hidden="true" />
        Shortcuts
      </Button>
      <Button variant="ghost" size="xs" render={<Link to="/activity" />} className="font-normal data-[status=active]:text-primary">
        <Activity data-icon="inline-start" aria-hidden="true" />
        Activity
      </Button>
    </footer>
  )
}

/* ---------------------------------------------------------------- route focus */

/**
 * Route last shown by any MainArea, and a navigation whose focus move has
 * not run yet. Module-level, so a shell switch (not found → page, setup →
 * app) that unmounts one MainArea and mounts another still completes it.
 */
let shownRoute: string | null = null
let pendingRoute: string | null = null

/**
 * After a route change (WCAG 2.4.3, 4.1.3): when the activated control went
 * away with the old page, focus moves to the URL's anchor, else the page h1,
 * else #main. A control that survives the change (source list link, View
 * tab) keeps focus. The new document title is announced either way.
 * Search-param changes (filters) never move focus.
 */
function useRouteFocus(): string {
  const route = useRouterState({ select: (s) => `${s.location.pathname}#${s.location.hash}` })
  const [announcement, setAnnouncement] = useState("")
  useEffect(() => {
    if (shownRoute !== null && shownRoute !== route) pendingRoute = route
    shownRoute = route
    if (pendingRoute !== route) return
    const anchorId = route.slice(route.indexOf("#") + 1) || null
    const moveFocus = (force: boolean) => {
      const active = document.activeElement
      const lost = !active || active === document.body || !active.isConnected
      const anchor = anchorId ? document.getElementById(anchorId) : null
      if (!lost && !(force && anchor)) return
      routeFocusTarget(anchorId)?.focus()
    }
    const frame = requestAnimationFrame(() => {
      pendingRoute = null
      moveFocus(true)
      setAnnouncement(document.title)
    })
    // A closing dialog (palette) restores focus to its trigger after its exit transition; if that trigger is gone, take focus back.
    const late = window.setTimeout(() => moveFocus(false), 450)
    return () => {
      cancelAnimationFrame(frame)
      window.clearTimeout(late)
    }
  }, [route])
  return announcement
}

/** Where focus lands after a navigation: the URL's anchor, else the page h1, else #main. */
function routeFocusTarget(anchorId: string | null): HTMLElement | null {
  const anchor = anchorId ? document.getElementById(anchorId) : null
  const main = document.getElementById("main")
  const target = anchor ?? main?.querySelector<HTMLElement>("h1") ?? main
  if (target && !target.hasAttribute("tabindex") && target.tabIndex < 0) target.setAttribute("tabindex", "-1")
  return target
}

/** The content pane; it scrolls on its own and the skip link targets it. */
function MainArea({ children }: { children: ReactNode }) {
  const announcement = useRouteFocus()
  return (
    <main id="main" tabIndex={-1} className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto bg-background outline-none">
      <p className="sr-only" aria-live="polite" data-route-announcer="">
        {announcement}
      </p>
      {children}
    </main>
  )
}

/** Toolbar, source list, content pane and status bar; the page goes in `children`. */
function AppFrame({ children }: { children: ReactNode }) {
  const narrow = useNarrowViewport()
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-seam">
      <SkipLink />
      <Toolbar narrow={narrow} />
      <div className="flex min-h-0 flex-1">
        {narrow ? null : <SourceList />}
        <MainArea>{children}</MainArea>
      </div>
      <StatusBar />
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

/** Unknown route: say what happened and offer the start page, inside the shell. */
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
            <Button render={<Link to="/" />} size="sm">
              Go to Recent sessions
            </Button>
          }
        />
      </div>
    </AppFrame>
  )
}

/** Focused layout for first-run setup: no source list, one task at a time. */
export function SetupShell() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-seam">
      <SkipLink />
      <header className="chrome flex h-[var(--toolbar-h)] shrink-0 items-center gap-2 border-b border-seam bg-toolbar px-3">
        <Aperture aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="text-sm font-semibold">PlateVault</span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => openPanel("simulation")}>
          <FlaskConical data-icon="inline-start" aria-hidden="true" />
          Prototype
        </Button>
      </header>
      <MainArea>
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col">
          <Outlet />
        </div>
      </MainArea>
    </div>
  )
}
