/**
 * App shell (foundation-owned), Harness V3 "Workspace with panes"
 * (design/HARNESS-V3.md): the window is the layout. A unified toolbar, a
 * resizable source list, document tabs over the main pane, a resizable
 * inspector that follows the page's cursor, and a status bar. Nothing
 * scrolls but the panes. Below 768 px the source list becomes a drawer and
 * the inspector hides (WCAG 1.4.10); at 1024 the inspector starts hidden.
 */
import { Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router"
import {
  Activity,
  Aperture,
  ChevronLeft,
  ChevronRight,
  FlaskConical,
  MapPinOff,
  Monitor,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Search,
  Sun,
  TriangleAlert,
  Unplug,
} from "lucide-react"
import { type ReactNode, useEffect, useRef, useState, useSyncExternalStore } from "react"
import { createPortal } from "react-dom"
import { EmptyState, LiveAnnouncer } from "@/components/app/feedback"
import { useDocumentTitle } from "@/components/app/page"
import { registerInspectorHost, Splitter, useInspectorHasContent } from "@/components/app/panes"
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
import { DocumentTabs } from "./doc-tabs"
import { HOME_ITEM, NAV_GROUPS, type NavItem, UTILITY_ITEMS } from "./navigation"
import { setTheme, type ThemePreference, usePreferences } from "./preferences"
import { MOD_LABEL, ShortcutsDialog, useGlobalShortcuts } from "./shortcuts"
import { SimulationSheet } from "./simulation-panel"
import { INSPECTOR_WIDTH, openPanel, SIDEBAR_WIDTH, setInspectorWidth, setSidebarWidth, toggleInspector, toggleSidebar, useShellUi } from "./ui-state"

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
      className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:px-3 focus:py-2"
    >
      Skip to main content
    </a>
  )
}

/** Source-list row: 26 px, icon + label, the selected place filled and barred (macOS source list). */
function NavLink({ item, collapsed, badge }: { item: NavItem; collapsed: boolean; badge?: number }) {
  const Icon = item.icon
  const link = (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === "/" }}
      className={cn(
        "flex h-6.5 items-center gap-2 rounded-md px-2 text-sm text-sidebar-foreground/85 hover:bg-sidebar-accent/70 hover:text-sidebar-accent-foreground",
        "data-[status=active]:bg-sidebar-accent data-[status=active]:font-medium data-[status=active]:text-sidebar-accent-foreground data-[status=active]:shadow-[inset_2px_0_0_var(--sidebar-primary)]",
        collapsed && "justify-center px-0",
      )}
      aria-label={collapsed ? item.label : undefined}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0 text-sidebar-primary" />
      {collapsed ? null : <span className="min-w-0 flex-1 truncate">{item.label}</span>}
      {!collapsed && badge ? (
        <span className="rounded-full bg-sidebar-foreground/12 px-1.5 text-xs tabular-nums text-sidebar-foreground/80">
          {badge}
          <span className="sr-only"> in progress</span>
        </span>
      ) : null}
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

/**
 * Below 768 px (WCAG 1.4.10 reflow, 1280 px at 200 % and up) the sidebar
 * leaves the layout and opens as an overlay from the toolbar instead.
 */
const NARROW_QUERY = "(max-width: 767.98px)"
/** Below this the inspector starts hidden and opens over the main pane. */
const COMPACT_QUERY = "(max-width: 1199.98px)"

function useMedia(query: string): boolean {
  return useSyncExternalStore(
    (listener) => {
      const list = window.matchMedia(query)
      list.addEventListener("change", listener)
      return () => list.removeEventListener("change", listener)
    },
    () => window.matchMedia(query).matches,
  )
}

function SidebarContent({ collapsed }: { collapsed: boolean }) {
  const inProgress = useStore((s) => Object.values(s.catalog.views).filter((v) => !v.completedAt).length)
  return (
    <>
      <nav aria-label="Main" className="flex-1 space-y-3 overflow-y-auto px-2 pt-2 pb-2">
        <ul className="space-y-px">
          <li>
            <NavLink item={HOME_ITEM} collapsed={collapsed} badge={inProgress} />
          </li>
        </ul>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="space-y-px">
            {collapsed ? (
              <div className="mx-auto my-1 h-px w-6 bg-sidebar-border" aria-hidden="true" />
            ) : (
              <div className="px-2 pb-0.5 text-xs font-semibold text-sidebar-foreground/60">{group.label}</div>
            )}
            <ul className="space-y-px" aria-label={collapsed ? group.label : undefined}>
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink item={item} collapsed={collapsed} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div className="space-y-px border-t border-sidebar-border p-2">
        {SHELLS.map((shell, index) => (shell.SidebarFooter ? <shell.SidebarFooter key={index} collapsed={collapsed} /> : null))}
        <ul className="space-y-px" aria-label="Utilities">
          {UTILITY_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink item={item} collapsed={collapsed} />
            </li>
          ))}
        </ul>
      </div>
    </>
  )
}

function Sidebar() {
  const { sidebarCollapsed, sidebarWidth } = useShellUi()
  return (
    <>
      <aside
        id="source-list"
        aria-label="Sidebar"
        data-chrome
        className="flex shrink-0 flex-col bg-sidebar text-sidebar-foreground"
        style={{ width: sidebarCollapsed ? 48 : sidebarWidth }}
      >
        <SidebarContent collapsed={sidebarCollapsed} />
      </aside>
      {sidebarCollapsed ? (
        <div aria-hidden="true" className="w-px shrink-0 bg-border" />
      ) : (
        <Splitter
          label="Resize sidebar"
          value={sidebarWidth}
          min={SIDEBAR_WIDTH.min}
          max={SIDEBAR_WIDTH.max}
          onChange={setSidebarWidth}
          pane="start"
          controls="source-list"
          onToggle={() => {
            // The splitter leaves with the pane; focus moves to the control that brings it back (WCAG 2.4.3).
            toggleSidebar()
            requestAnimationFrame(() => document.getElementById("sidebar-toggle")?.focus())
          }}
        />
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
        <SidebarContent collapsed={false} />
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

/** Status bar: running work, interrupted work, offline locations and Activity (A's status bus). */
function StatusBar() {
  const running = useStore((s) => Object.values(s.operations).filter((op) => op.status === "running"))
  const interrupted = useStore((s) => Object.values(s.operations).filter((op) => op.status === "interrupted").length)
  const offline = useStore((s) => Object.values(s.catalog.locations).filter((l) => !s.disk.volumes[l.volumeId]?.mounted))
  const first = running[0]
  const pct = first && first.progress.total > 0 ? Math.round((first.progress.done / first.progress.total) * 100) : null
  const chip = "inline-flex h-6 min-w-0 items-center gap-1.5 rounded-sm px-1.5 hover:bg-accent"
  return (
    <footer aria-label="Status bar" data-chrome className="flex h-6.5 shrink-0 items-center gap-1 border-t bg-statusbar px-2 text-xs text-muted-foreground">
      <Link to="/activity" className={chip}>
        <Activity aria-hidden="true" className="size-3.5" />
        Activity
      </Link>
      {first ? (
        <Link to="/activity" className={cn(chip, "max-w-80 text-foreground")}>
          <Spinner aria-hidden="true" className="size-3" />
          <span className="truncate tabular-nums">
            {first.title}
            {pct !== null ? ` ${pct}%` : ""}
            {running.length > 1 ? ` (+${running.length - 1})` : ""}
          </span>
        </Link>
      ) : (
        <span className="px-1.5">No running work</span>
      )}
      {interrupted > 0 ? (
        <Link to="/activity" className={cn(chip, "text-warning")}>
          <TriangleAlert aria-hidden="true" className="size-3.5" />
          {interrupted} interrupted
        </Link>
      ) : null}
      <div className="flex-1" />
      {offline.length > 0 ? (
        <Link to="/storage" className={cn(chip, "text-warning")}>
          <Unplug aria-hidden="true" className="size-3.5" />
          <span className="truncate">{offline.length === 1 ? `${offline[0]!.displayName} offline` : `${offline.length} locations offline`}</span>
        </Link>
      ) : null}
    </footer>
  )
}

/** The command field: the main verb surface. Full field from 768 px up; an icon button with the same name below. */
function PaletteTrigger({ narrow }: { narrow: boolean }) {
  if (narrow) {
    return (
      <Button variant="ghost" size="icon" className="text-muted-foreground" onClick={() => openPanel("palette")}>
        <Search aria-hidden="true" />
        <span className="sr-only">Search or run a command…</span>
      </Button>
    )
  }
  return (
    <button
      type="button"
      onClick={() => openPanel("palette")}
      className="flex h-6.5 w-[min(26rem,40vw)] min-w-0 items-center gap-2 rounded-md border border-input/60 bg-background/70 px-2 text-sm text-muted-foreground hover:bg-background"
    >
      <Search aria-hidden="true" className="size-3.5 shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">Search or run a command…</span>
      <Kbd>{MOD_LABEL} K</Kbd>
    </button>
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

/** The main pane's scroll container; the skip link targets it. */
function MainArea({ children }: { children: ReactNode }) {
  const announcement = useRouteFocus()
  return (
    <main id="main" tabIndex={-1} className="relative flex min-h-0 flex-1 flex-col overflow-y-auto outline-none">
      <p className="sr-only" aria-live="polite" data-route-announcer="">
        {announcement}
      </p>
      {children}
    </main>
  )
}

/**
 * The inspector pane. Its body is always mounted (pages portal into it), but
 * the pane only takes room while it is shown, has content and the window is
 * wide enough; at compact widths it floats over the main pane's edge.
 */
function InspectorPane({ compact }: { compact: boolean }) {
  const { inspectorOpen, inspectorWidth } = useShellUi()
  const hasContent = useInspectorHasContent()
  const [compactOpen, setCompactOpen] = useState(false)
  const shown = hasContent && (compact ? compactOpen : inspectorOpen)
  useEffect(() => {
    if (!compact) setCompactOpen(false)
  }, [compact])
  return (
    <>
      {shown && !compact ? (
        <Splitter
          label="Resize inspector"
          value={inspectorWidth}
          min={INSPECTOR_WIDTH.min}
          max={INSPECTOR_WIDTH.max}
          onChange={setInspectorWidth}
          pane="end"
          controls="inspector"
          onToggle={() => {
            toggleInspector(false)
            requestAnimationFrame(() => document.getElementById("inspector-toggle")?.focus())
          }}
        />
      ) : null}
      <aside
        id="inspector"
        aria-label="Inspector"
        hidden={!shown}
        className={cn("flex min-h-0 shrink-0 flex-col overflow-y-auto bg-pane", compact && "absolute inset-y-0 right-0 z-30 border-l shadow-xl")}
        style={{ width: inspectorWidth }}
        ref={registerInspectorHost}
      />
      <InspectorToggleSlot compact={compact} open={compact ? compactOpen : inspectorOpen} disabled={!hasContent} onToggle={() => (compact ? setCompactOpen((o) => !o) : toggleInspector())} />
    </>
  )
}

let toggleSlot: HTMLElement | null = null
const toggleListeners = new Set<() => void>()

/** The toolbar's inspector button lives in the toolbar; the pane owns its state, so it renders into the toolbar slot. */
function InspectorToggleSlot({ compact, open, disabled, onToggle }: { compact: boolean; open: boolean; disabled: boolean; onToggle: () => void }) {
  const slot = useSyncExternalStore(
    (listener) => {
      toggleListeners.add(listener)
      return () => {
        toggleListeners.delete(listener)
      }
    },
    () => toggleSlot,
  )
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      // ⌥⌘I (Xcode, Finder Get Info pane).
      if (event.altKey && (event.metaKey || event.ctrlKey) && event.code === "KeyI") {
        event.preventDefault()
        if (!disabled) onToggle()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [disabled, onToggle])
  if (!slot) return null
  const label = open ? "Hide inspector" : "Show inspector"
  return createPortal(
      <Tooltip>
        <TooltipTrigger
          render={
            <Button
              variant="ghost"
              size="icon"
              aria-label={label}
              aria-expanded={open}
              id="inspector-toggle"
              aria-controls="inspector"
              disabled={disabled}
              focusableWhenDisabled
              onClick={onToggle}
            />
          }
        >
          {open ? <PanelRightClose aria-hidden="true" /> : <PanelRightOpen aria-hidden="true" />}
        </TooltipTrigger>
        <TooltipContent>{disabled ? "Nothing to inspect on this page" : `${label} (${MOD_LABEL === "⌘" ? "⌥⌘I" : "Ctrl+Alt+I"})${compact ? ", floats over the page at this width" : ""}`}</TooltipContent>
      </Tooltip>,
    slot,
  )
}

function registerToggleSlot(element: HTMLElement | null) {
  toggleSlot = element
  for (const listener of toggleListeners) listener()
}

/** App toolbar under the native (Tauri) title bar: navigation on the leading edge, the command field centred, pane toggles trailing. It draws no window chrome or title. */
function Toolbar({ narrow }: { narrow: boolean }) {
  const { sidebarCollapsed } = useShellUi()
  const router = useRouter()
  return (
    <header data-chrome className="z-20 flex h-10 min-w-0 shrink-0 items-center gap-1 border-b bg-toolbar px-2">
      {narrow ? (
        <SidebarDrawer />
      ) : (
        <Button
          id="sidebar-toggle"
          variant="ghost"
          size="icon"
          onClick={toggleSidebar}
          aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}
          aria-expanded={!sidebarCollapsed}
          aria-controls="source-list"
        >
          {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
        </Button>
      )}
      <Button variant="ghost" size="icon" aria-label="Back" onClick={() => router.history.back()}>
        <ChevronLeft aria-hidden="true" />
      </Button>
      <Button variant="ghost" size="icon" aria-label="Forward" onClick={() => router.history.forward()}>
        <ChevronRight aria-hidden="true" />
      </Button>
      <div className="flex min-w-0 flex-1 justify-center">
        <PaletteTrigger narrow={narrow} />
      </div>
      <Button variant="ghost" size={narrow ? "icon" : "sm"} onClick={() => openPanel("simulation")}>
        <FlaskConical data-icon="inline-start" aria-hidden="true" />
        <span className={cn(narrow && "sr-only")}>Prototype</span>
      </Button>
      <ThemeMenu />
      <div ref={registerToggleSlot} className="contents" />
    </header>
  )
}

/** Toolbar, source list, tabs + main pane, inspector and status bar; the page goes in `children`. */
function AppFrame({ children }: { children: ReactNode }) {
  const narrow = useMedia(NARROW_QUERY)
  const compact = useMedia(COMPACT_QUERY)
  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      <SkipLink />
      <Toolbar narrow={narrow} />
      <div className="relative flex min-h-0 flex-1">
        {narrow ? null : <Sidebar />}
        <div className="flex min-w-0 flex-1 flex-col">
          <DocumentTabs />
          <MainArea>{children}</MainArea>
        </div>
        <InspectorPane compact={compact} />
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
            <Button render={<Link to="/" />} size="sm">
              Go to Work queue
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
      <header data-chrome className="flex h-10 shrink-0 items-center gap-2 border-b bg-toolbar px-3">
        <Aperture aria-hidden="true" className="size-4 text-primary" />
        <span className="text-sm font-semibold">PlateVault</span>
        <div className="flex-1" />
        <Button variant="ghost" size="sm" onClick={() => openPanel("simulation")}>
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
