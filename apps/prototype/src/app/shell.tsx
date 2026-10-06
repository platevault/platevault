/**
 * App shell (foundation-owned): root providers, the window frame and the
 * minimal onboarding layout.
 *
 * HARNESS V1 (design/HARNESS-V1.md): a first-party macOS window. A
 * full-height translucent source list with the traffic-light inset, a unified
 * toolbar over the content (back/forward, the page title and actions, search),
 * an optional inspector the page provides, and a status bar. Nothing scrolls
 * the document; only content panes scroll.
 */
import { Link, Outlet, useCanGoBack, useRouter, useRouterState } from "@tanstack/react-router"
import {
  Aperture,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  MapPinOff,
  Monitor,
  Moon,
  PanelLeft,
  Search,
  Sun,
  TriangleAlert,
  Unplug,
} from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { EmptyState, LiveAnnouncer } from "@/components/app/feedback"
import { ToolbarSlotsContext, useDocumentTitle } from "@/components/app/page"
import { SplitHandle } from "@/components/app/split"
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
import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useStore } from "@/store/core"
import { CommandPalette } from "./command-palette"
import { HOME_ITEM, NAV_GROUPS, type NavItem, UTILITY_ITEMS } from "./navigation"
import { setTheme, type ThemePreference, usePreferences } from "./preferences"
import { MOD_LABEL, ShortcutsDialog, useGlobalShortcuts } from "./shortcuts"
import { SimulationSheet } from "./simulation-panel"
import { openPanel, SIDEBAR_WIDTH, setSidebarWidth, toggleSidebar, useShellUi } from "./ui-state"

const SHELLS = [t1Shell, t2Shell, t3Shell, t4Shell, t5Shell]

/** Tauri draws the real traffic lights over its overlay title bar; the browser preview draws stand-ins. */
const IN_TAURI = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window

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
      className="sr-only z-50 rounded-md bg-key px-3 py-1.5 text-key-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-24 focus:px-3 focus:py-1.5"
    >
      Skip to main content
    </a>
  )
}

/** The window controls' place: real ones in Tauri (titleBarStyle "Overlay"), decorative stand-ins in a browser. */
function TrafficLights() {
  if (IN_TAURI) return null
  return (
    <div aria-hidden="true" data-traffic-lights="" className="pointer-events-none absolute top-[19px] left-[20px] flex gap-2">
      <span className="size-3 rounded-full bg-[#ff5f57] shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.18)]" />
      <span className="size-3 rounded-full bg-[#febc2e] shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.18)]" />
      <span className="size-3 rounded-full bg-[#28c840] shadow-[inset_0_0_0_0.5px_rgb(0_0_0/0.18)]" />
    </div>
  )
}

function useAreaActive(item: NavItem): boolean {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return [item.to, ...(item.area ?? [])].some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))
}

/** A source-list row: 26 px, accent-tinted icon, a selection fill like Finder's sidebar. */
function SourceListLink({ item, collapsed, trailing }: { item: NavItem; collapsed: boolean; trailing?: ReactNode }) {
  const Icon = item.icon
  const active = useAreaActive(item)
  const link = (
    <Link
      to={item.to}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex h-[26px] items-center gap-2 rounded-md px-2 text-sm text-sidebar-foreground hover:bg-[color-mix(in_oklab,var(--sidebar-foreground)_6%,transparent)]",
        "aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium",
        collapsed && "justify-center px-0",
      )}
      aria-label={collapsed ? item.label : undefined}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0 text-sidebar-primary" />
      {collapsed ? null : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {collapsed ? null : trailing}
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

/** The trailing count a source list shows for attention items (Mail's unread badge). */
function SourceListBadge({ count, label }: { count: number; label: string }) {
  if (count === 0) return null
  return (
    <span className="rounded-full bg-[color-mix(in_oklab,var(--sidebar-foreground)_12%,transparent)] px-1.5 text-xs font-medium tabular-nums">
      {count}
      <span className="sr-only"> {label}</span>
    </span>
  )
}

/**
 * Below 768 px (WCAG 1.4.10 reflow, 1280 px at 200 % and up) the sidebar
 * leaves the layout and opens as an overlay from the toolbar instead.
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

/** Recently captured Targets, newest first: the Target context D's rail gave, in three rows. */
function RecentTargets({ collapsed }: { collapsed: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const rows = useStore((s) => {
    const latest: Record<string, { at: string; seconds: number }> = {}
    for (const session of Object.values(s.catalog.sessions)) {
      const id = session.target.value
      if (!id || session.supersededBy || session.imageType !== "light") continue
      const entry = (latest[id] ??= { at: "", seconds: 0 })
      if (session.startedAt > entry.at) entry.at = session.startedAt
      entry.seconds += session.assetIds.length * session.exposureS
    }
    return Object.entries(latest)
      .sort((a, b) => b[1].at.localeCompare(a[1].at))
      .slice(0, 3)
      .flatMap(([id, entry]) => {
        const target = s.catalog.targets[id]
        return target ? [{ id, name: target.name, seconds: entry.seconds }] : []
      })
  })
  if (collapsed || rows.length === 0) return null
  return (
    <div className="space-y-px">
      <h2 className="px-2 pt-3 pb-1 text-xs font-semibold text-sidebar-foreground/70">Recent Targets</h2>
      <ul className="space-y-px">
        {rows.map((row) => {
          const current = pathname === `/targets/${row.id}` || pathname.startsWith(`/targets/${row.id}/`)
          return (
            <li key={row.id}>
              <Link
                to="/targets/$targetId"
                params={{ targetId: row.id }}
                aria-current={current ? "page" : undefined}
                className="flex h-[26px] items-center gap-2 rounded-md px-2 text-sm text-sidebar-foreground hover:bg-[color-mix(in_oklab,var(--sidebar-foreground)_6%,transparent)] aria-[current=page]:bg-sidebar-accent aria-[current=page]:font-medium"
              >
                <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
                  <span className="size-2 rounded-full border-[1.5px] border-sidebar-primary" />
                </span>
                <span className="min-w-0 flex-1 truncate">{row.name}</span>
                <span className="text-xs text-sidebar-foreground/70 tabular-nums">{formatDuration(row.seconds)}</span>
              </Link>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

function SidebarContent({ collapsed, drawer = false }: { collapsed: boolean; drawer?: boolean }) {
  const needsReview = useStore(
    (s) => Object.values(s.catalog.sessions).filter((x) => !x.supersededBy && x.imageType === "light" && (x.target.status === "needs-review" || x.target.status === "unresolved")).length,
  )
  return (
    <>
      <div className={cn("relative flex h-(--toolbar-h) shrink-0 items-center justify-end gap-1 px-2", drawer && "justify-start px-4")} data-tauri-drag-region="">
        {drawer ? (
          <>
            <Aperture aria-hidden="true" className="size-4 text-sidebar-primary" />
            <span className="font-semibold">PlateVault</span>
          </>
        ) : (
          <>
            <TrafficLights />
            <span className="sr-only">PlateVault</span>
            {collapsed ? null : (
              <Tooltip>
                <TooltipTrigger
                  render={<Button variant="ghost" size="icon-sm" onClick={toggleSidebar} aria-label="Collapse sidebar" className="text-sidebar-foreground/80" />}
                >
                  <PanelLeft aria-hidden="true" />
                </TooltipTrigger>
                <TooltipContent side="bottom">Hide sidebar ([)</TooltipContent>
              </Tooltip>
            )}
          </>
        )}
      </div>
      {collapsed ? (
        <div className="flex justify-center pb-1">
          <Button variant="ghost" size="icon-sm" onClick={toggleSidebar} aria-label="Expand sidebar">
            <PanelLeft aria-hidden="true" />
          </Button>
        </div>
      ) : null}
      <nav aria-label="Main" className={cn("min-h-0 flex-1 overflow-y-auto px-2.5 pb-2", collapsed && "px-1.5")}>
        <ul className="space-y-px">
          <li>
            <SourceListLink item={HOME_ITEM} collapsed={collapsed} trailing={<SourceListBadge count={needsReview} label="sessions need a Target decision" />} />
          </li>
        </ul>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="space-y-px">
            {collapsed ? (
              <div className="mx-auto my-2 h-px w-6 bg-sidebar-border" aria-hidden="true" />
            ) : (
              <h2 className="px-2 pt-3 pb-1 text-xs font-semibold text-sidebar-foreground/70">{group.label}</h2>
            )}
            <ul className="space-y-px">
              {group.items.map((item) => (
                <li key={item.to}>
                  <SourceListLink item={item} collapsed={collapsed} />
                </li>
              ))}
            </ul>
          </div>
        ))}
        <RecentTargets collapsed={collapsed} />
      </nav>
      <div className={cn("space-y-px border-t border-sidebar-border px-2.5 py-1.5", collapsed && "px-1.5")}>
        {SHELLS.map((shell, index) => (shell.SidebarFooter ? <shell.SidebarFooter key={index} collapsed={collapsed} /> : null))}
        <ul aria-label="Utilities" className={cn("flex gap-0.5", collapsed && "flex-col items-center")}>
          {UTILITY_ITEMS.map((item) => {
            const Icon = item.icon
            return (
              <li key={item.to}>
                <Tooltip>
                  <TooltipTrigger
                    render={
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        render={<Link to={item.to} />}
                        aria-label={item.label}
                        className="text-sidebar-foreground/80 data-[status=active]:bg-sidebar-accent data-[status=active]:text-sidebar-foreground"
                      />
                    }
                  >
                    <Icon aria-hidden="true" />
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    {item.label} (G {item.goKey === "," ? "," : item.goKey.toUpperCase()})
                  </TooltipContent>
                </Tooltip>
              </li>
            )
          })}
        </ul>
      </div>
    </>
  )
}

function Sidebar() {
  const { sidebarCollapsed: collapsed, sidebarWidth } = useShellUi()
  return (
    <>
      <aside
        data-chrome=""
        style={{ width: collapsed ? 76 : sidebarWidth }}
        className="material-sidebar relative flex shrink-0 flex-col border-r border-sidebar-border text-sidebar-foreground"
        aria-label="Sidebar"
      >
        <SidebarContent collapsed={collapsed} />
      </aside>
      {collapsed ? null : (
        <SplitHandle label="Resize sidebar" value={sidebarWidth} {...SIDEBAR_WIDTH} onChange={setSidebarWidth} pane="before" className="-ml-[4px] mr-[-3px]" />
      )}
    </>
  )
}

/**
 * The sidebar as an overlay below 768 px, opened from the toolbar. Choosing a
 * link closes it and focus moves to the new page's heading; Escape or the
 * backdrop returns focus to the menu button.
 */
function SidebarDrawer() {
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
      <SheetTrigger render={<Button variant="ghost" size="icon" aria-label="Open navigation" />}>
        <PanelLeft aria-hidden="true" />
      </SheetTrigger>
      <SheetContent
        side="left"
        className="material-sidebar w-64 max-w-[85vw] gap-0 p-0 text-sidebar-foreground"
        finalFocus={() => (navigated.current ? (routeFocusTarget(null) ?? true) : true)}
        onClick={(event) => {
          if (!(event.target as Element).closest("a[href]")) return
          navigated.current = true
          setOpen(false)
        }}
      >
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        <SidebarContent collapsed={false} drawer />
      </SheetContent>
    </Sheet>
  )
}

const THEME_ICON: Record<ThemePreference, typeof Moon> = { dark: Moon, light: Sun, system: Monitor }

function ThemeMenu() {
  const { theme } = usePreferences()
  const Icon = THEME_ICON[theme]
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Theme: ${theme === "system" ? "match system" : theme}`} />}>
        <Icon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" side="top" className="w-44">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Appearance</DropdownMenuLabel>
          <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemePreference)}>
            <DropdownMenuRadioItem value="system">Match system</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="light">Light</DropdownMenuRadioItem>
            <DropdownMenuRadioItem value="dark">Dark</DropdownMenuRadioItem>
          </DropdownMenuRadioGroup>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** Window status bar: running and interrupted work, offline locations, prototype controls. */
function StatusBar({ narrow }: { narrow: boolean }) {
  const running = useStore((s) => Object.values(s.operations).filter((op) => op.status === "running"))
  const interrupted = useStore((s) => Object.values(s.operations).filter((op) => op.status === "interrupted").length)
  const offline = useStore((s) => Object.values(s.catalog.locations).filter((l) => !l.retiredAt && !s.disk.volumes[l.volumeId]?.mounted))
  const counts = useStore((s) => {
    const sessions = Object.values(s.catalog.sessions).filter((x) => !x.supersededBy && x.imageType === "light")
    return { targets: Object.keys(s.catalog.targets).length, sessions: sessions.length }
  })
  const first = running[0]
  const pct = first && first.progress.total > 0 ? Math.round((first.progress.done / first.progress.total) * 100) : null
  return (
    <footer
      data-chrome=""
      aria-label="Status bar"
      className="material-toolbar flex h-(--statusbar-h) shrink-0 items-center gap-1 border-t px-2 text-xs text-muted-foreground"
    >
      {first ? (
        <Button variant="ghost" size="xs" render={<Link to="/activity" />} className="min-w-0 max-w-64 shrink text-foreground tabular-nums">
          <Spinner data-icon="inline-start" aria-hidden="true" />
          <span className="truncate">
            {first.title}
            {pct !== null ? ` ${pct}%` : ""}
            {running.length > 1 ? ` (+${running.length - 1})` : ""}
          </span>
        </Button>
      ) : (
        <span className="truncate px-1.5 tabular-nums">
          {counts.targets} Targets · {counts.sessions} light sessions
        </span>
      )}
      {interrupted > 0 ? (
        <Button variant="ghost" size="xs" render={<Link to="/activity" />} className="text-warning" aria-label={`${interrupted} interrupted operation${interrupted === 1 ? "" : "s"}`}>
          <TriangleAlert data-icon="inline-start" aria-hidden="true" />
          <span className="tabular-nums">{interrupted} interrupted</span>
        </Button>
      ) : null}
      {offline.length > 0 ? (
        <Button
          variant="ghost"
          size="xs"
          render={<Link to="/storage" />}
          className="min-w-0 text-warning"
          aria-label={offline.length === 1 ? `${offline[0]!.displayName} offline` : `${offline.length} locations offline`}
        >
          <Unplug data-icon="inline-start" aria-hidden="true" />
          <span className="truncate">{offline.length === 1 ? `${offline[0]!.displayName} offline` : `${offline.length} locations offline`}</span>
        </Button>
      ) : null}
      <div className="min-w-0 flex-1" />
      <Button variant="ghost" size="xs" onClick={() => openPanel("simulation")} className="text-foreground">
        <FlaskConical data-icon="inline-start" aria-hidden="true" />
        <span className={cn(narrow && "sr-only")}>Prototype</span>
      </Button>
      <ThemeMenu />
    </footer>
  )
}

/** The toolbar search field: opens the command palette (⌘K), placed trailing as AppKit's NSSearchToolbarItem. */
function ToolbarSearch({ narrow }: { narrow: boolean }) {
  if (narrow) {
    return (
      <Button variant="ghost" size="icon" className="text-muted-foreground" onClick={() => openPanel("palette")}>
        <Search aria-hidden="true" />
        <span className="sr-only">Search or jump to…</span>
      </Button>
    )
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className="w-44 min-w-0 shrink justify-start rounded-md bg-[color-mix(in_oklab,var(--foreground)_6%,transparent)] text-muted-foreground shadow-none xl:w-56 dark:bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)]"
      onClick={() => openPanel("palette")}
    >
      <Search data-icon="inline-start" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left">Search or jump to…</span>
      <Kbd>{MOD_LABEL}K</Kbd>
    </Button>
  )
}

/** Back and forward through this window's history, like Finder's toolbar. */
function HistoryButtons() {
  const router = useRouter()
  const canGoBack = useCanGoBack()
  const [forward, setForward] = useState(0)
  const stepping = useRef(false)
  const location = useRouterState({ select: (s) => s.location.href })
  useEffect(() => {
    if (stepping.current) stepping.current = false
    else setForward(0)
  }, [location])
  return (
    <div className="flex shrink-0 items-center" role="group" aria-label="History">
      <Button
        variant="ghost"
        size="icon"
        aria-label="Back"
        disabled={!canGoBack}
        onClick={() => {
          stepping.current = true
          setForward((n) => n + 1)
          router.history.back()
        }}
      >
        <ChevronLeft aria-hidden="true" className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label="Forward"
        disabled={forward === 0}
        onClick={() => {
          stepping.current = true
          setForward((n) => Math.max(0, n - 1))
          router.history.forward()
        }}
      >
        <ChevronRight aria-hidden="true" className="size-4" />
      </Button>
    </div>
  )
}

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
 * else #main. A control that survives the change (sidebar link, View tab)
 * keeps focus. The new document title is announced either way. Search-param
 * changes (filters) never move focus.
 */
function useRouteFocus(): string {
  const route = useRouterState({ select: (s) => `${s.location.pathname}#${s.location.hash}` })
  const [announcement, setAnnouncement] = useState("")
  useEffect(() => {
    if (shownRoute !== null && shownRoute !== route) pendingRoute = route
    shownRoute = route
    if (pendingRoute !== route) return
    const anchorId = route.slice(route.indexOf("#") + 1)
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

/**
 * The main landmark: the unified toolbar (inside main, so the page h1 and its
 * actions stay in the landmark) and the single content scroll area.
 */
function MainArea({ children, toolbar, trailing }: { children: ReactNode; toolbar: ReactNode | null; trailing?: ReactNode }) {
  const announcement = useRouteFocus()
  const [title, setTitle] = useState<HTMLElement | null>(null)
  const [actions, setActions] = useState<HTMLElement | null>(null)
  const slots = useMemo(() => ({ title, actions }), [title, actions])
  return (
    <main id="main" tabIndex={-1} className="relative flex min-h-0 min-w-0 flex-1 flex-col bg-background outline-none">
      <p className="sr-only" aria-live="polite" data-route-announcer="">
        {announcement}
      </p>
      {toolbar === null ? null : (
        <div
          data-chrome=""
          data-tauri-drag-region=""
          className="material-toolbar z-20 flex min-h-(--toolbar-h) shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b px-2 py-1"
        >
          {toolbar}
          {/* The title keeps 14rem; when the page's actions do not fit beside it they wrap to a second toolbar row (AppKit overflows instead, WCAG 1.4.10 needs reflow). */}
          <div ref={setTitle} data-toolbar-title="" className="flex min-w-[12rem] flex-[1_1_14rem] items-center" />
          <div ref={setActions} data-toolbar-actions="" className="ml-auto flex min-w-0 items-center justify-end gap-1.5" />
          {trailing}
        </div>
      )}
      <ToolbarSlotsContext.Provider value={toolbar === null ? { title: null, actions: null } : slots}>
        <div data-scroll-area="" className="relative flex min-h-0 flex-1 flex-col overflow-y-auto">
          {children}
        </div>
      </ToolbarSlotsContext.Provider>
    </main>
  )
}

/** Window frame: source list, toolbar + content, status bar; the page goes in `children`. */
function AppFrame({ children }: { children: ReactNode }) {
  const narrow = useNarrowViewport()
  return (
    <div className="flex h-dvh overflow-hidden bg-window">
      <SkipLink />
      {narrow ? null : <Sidebar />}
      <div className="flex min-w-0 flex-1 flex-col">
        <MainArea
          toolbar={
            <>
              {narrow ? <SidebarDrawer /> : null}
              <HistoryButtons />
            </>
          }
          trailing={<ToolbarSearch narrow={narrow} />}
        >
          {children}
        </MainArea>
        <StatusBar narrow={narrow} />
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
            <Button render={<Link to="/overview" />} size="sm">
              Go to Overview
            </Button>
          }
        />
      </div>
    </AppFrame>
  )
}

/** Focused layout for first-run setup: no sidebar, one task at a time, in a plain window. */
export function SetupShell() {
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-window">
      <SkipLink />
      <header data-chrome="" data-tauri-drag-region="" className="relative flex h-(--toolbar-h) shrink-0 items-center gap-2 border-b pr-3 pl-(--traffic-lights-w)">
        <TrafficLights />
        <Aperture aria-hidden="true" className="size-4 text-primary" />
        <span className="font-semibold">PlateVault</span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => openPanel("simulation")}>
          <FlaskConical data-icon="inline-start" aria-hidden="true" />
          Prototype
        </Button>
        <ThemeMenu />
      </header>
      <MainArea toolbar={null}>
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col">
          <Outlet />
        </div>
      </MainArea>
    </div>
  )
}
