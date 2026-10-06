/**
 * App shell (foundation-owned): root providers, the main layout with sidebar,
 * header and status area, and the minimal onboarding layout.
 */
import { Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import {
  Aperture,
  Circle,
  CircleArrowRight,
  CircleCheck,
  CircleDashed,
  FlaskConical,
  HardDrive,
  Loader,
  MapPinOff,
  Monitor,
  Moon,
  OctagonX,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Search,
  Sun,
  TriangleAlert,
  Unplug,
} from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { EmptyState, LiveAnnouncer } from "@/components/app/feedback"
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
import { NAV_GROUPS, type NavItem, PRIMARY_ITEMS, UTILITY_ITEMS } from "./navigation"
import { GATE_LABEL, type GateState, type StageLink, stageForPath, viewPipeline } from "./pipeline"
import { setTheme, type ThemePreference, usePreferences } from "./preferences"
import { MOD_LABEL, ShortcutsDialog, useGlobalShortcuts } from "./shortcuts"
import { SimulationSheet } from "./simulation-panel"
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
        "flex h-6.5 items-center gap-2 rounded-[0.3125rem] px-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:text-link",
        "data-[status=active]:bg-sidebar-primary data-[status=active]:font-medium data-[status=active]:text-sidebar-primary-foreground data-[status=active]:[&>svg]:text-sidebar-primary-foreground",
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

/**
 * Below 768 px (WCAG 1.4.10 reflow, 1280 px at 200 % and up) the sidebar
 * leaves the layout and opens as an overlay from the header instead.
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

const GATE_GLYPH: Record<GateState, { icon: typeof Circle; className: string }> = {
  done: { icon: CircleCheck, className: "text-success" },
  ready: { icon: CircleArrowRight, className: "text-link" },
  review: { icon: TriangleAlert, className: "text-warning" },
  blocked: { icon: OctagonX, className: "text-destructive" },
  running: { icon: Loader, className: "text-link motion-safe:animate-spin" },
  partial: { icon: CircleDashed, className: "text-warning" },
  idle: { icon: Circle, className: "text-muted-foreground" },
}

/** C's state vocabulary: glyph shape plus word, colour only reinforces. */
export function StageGlyph({ state, className }: { state: GateState; className?: string }) {
  const meta = GATE_GLYPH[state]
  const Icon = meta.icon
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", meta.className, className)} />
}

/** The open View and its pipeline, derived from the route; null outside a View. */
function useActivePipeline() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const viewId = pathname.match(/^\/views\/([^/]+)/)?.[1]
  const state = useStore((s) => s)
  const view = viewId && viewId !== "new" ? state.catalog.views[viewId] : undefined
  const pipeline = useMemo(() => (view ? viewPipeline(state, view) : null), [state, view])
  return { pathname, view, pipeline }
}

function useFollowLink() {
  const navigate = useNavigate()
  return (link: StageLink) => {
    void navigate({ to: link.to as never, params: link.params as never, search: link.search as never }).then(() => {
      if (link.focusId) requestAnimationFrame(() => document.getElementById(link.focusId!)?.focus())
    })
  }
}

/**
 * The pipeline navigator (Xcode-style): under Pipeline, the open View's seven
 * numbered stages with their gate state. The current area is the selected row.
 */
function PipelineOutline() {
  const { pathname, view, pipeline } = useActivePipeline()
  if (!view || !pipeline) return null
  const here = stageForPath(pathname)
  return (
    <div className="mt-0.5 mb-1 ml-3 border-l border-sidebar-border pl-1.5">
      <p className="truncate px-1.5 py-1 text-[0.6875rem] font-semibold text-sidebar-foreground" title={view.name}>
        {view.name}
      </p>
      <ol aria-label={`Pipeline of ${view.name}`} className="space-y-px">
        {pipeline.stages.map((stage) => (
          <li key={stage.id}>
            <Link
              to={stage.link.to as never}
              params={stage.link.params as never}
              aria-current={here === stage.id ? "page" : undefined}
              className={cn(
                "flex h-6 items-center gap-1.5 rounded-[0.3125rem] px-1.5 text-[0.75rem] hover:bg-sidebar-accent",
                here === stage.id && "bg-sidebar-accent font-medium",
                pipeline.current.id === stage.id && here !== stage.id && "shadow-[inset_2px_0_0_var(--link)]",
              )}
            >
              <span className="w-3 text-right text-muted-foreground tabular-nums">{stage.n}</span>
              <StageGlyph state={stage.state} />
              <span className="min-w-0 flex-1 truncate">{stage.label}</span>
              <span className="max-w-24 truncate text-[0.6875rem] text-muted-foreground">
                <span className="sr-only">{GATE_LABEL[stage.state]}: </span>
                {stage.status}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  )
}

/**
 * The one Next action of the open View, in the toolbar like a Run button:
 * ⌘↩ runs it, ⌃1–⌃7 jump to a stage.
 */
function NextActionButton() {
  const { pipeline } = useActivePipeline()
  const follow = useFollowLink()
  const followRef = useRef(follow)
  followRef.current = follow
  const pipelineRef = useRef(pipeline)
  pipelineRef.current = pipeline
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const current = pipelineRef.current
      if (!current) return
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && current.next) {
        event.preventDefault()
        followRef.current(current.next.link)
        return
      }
      const n = Number(event.key)
      if (event.ctrlKey && !event.metaKey && n >= 1 && n <= 7) {
        event.preventDefault()
        followRef.current(current.stages[n - 1]!.link)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
  if (!pipeline?.next) return null
  const next = pipeline.next
  return (
    <div className="flex min-w-0 items-center gap-2">
      <span className="hidden min-w-0 items-center gap-1.5 truncate text-[0.75rem] text-muted-foreground lg:flex" title={next.reason}>
        <StageGlyph state={next.stage.state} />
        <span className="truncate">
          {next.stage.n} {next.stage.label} · {next.reason}
        </span>
      </span>
      <Button size="sm" onClick={() => follow(next.link)} title={`${next.reason} (${MOD_LABEL}↩)`}>
        <Play aria-hidden="true" data-icon="inline-start" className="fill-current" />
        Next: {next.label}
      </Button>
    </div>
  )
}

function SidebarContent({ collapsed }: { collapsed: boolean }) {
  return (
    <>
      <div data-chrome className={cn("flex h-10 shrink-0 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
        <Aperture aria-hidden="true" className="size-4.5 shrink-0 text-link" />
        {collapsed ? <span className="sr-only">PlateVault</span> : <span className="text-sm font-semibold">PlateVault</span>}
      </div>
      <nav aria-label="Main" data-chrome className="flex-1 space-y-3 overflow-y-auto px-2 pb-2">
        <ul className="space-y-px">
          {PRIMARY_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink item={item} collapsed={collapsed} />
              {item.to === "/views" && !collapsed ? <PipelineOutline /> : null}
            </li>
          ))}
        </ul>
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="space-y-px">
            {collapsed ? (
              <div className="mx-auto my-1 h-px w-6 bg-sidebar-border" aria-hidden="true" />
            ) : (
              <div className="px-2 pb-0.5 text-[0.6875rem] font-semibold text-muted-foreground">{group.label}</div>
            )}
            <ul className="space-y-px">
              {group.items.map((item) => (
                <li key={item.to}>
                  <NavLink item={item} collapsed={collapsed} />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div data-chrome className="space-y-px border-t border-sidebar-border p-2">
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
  const { sidebarCollapsed: collapsed } = useShellUi()
  return (
    <aside
      className={cn("flex shrink-0 flex-col border-r border-separator bg-sidebar text-sidebar-foreground", collapsed ? "w-12" : "w-60")}
      aria-label="Sidebar"
    >
      <SidebarContent collapsed={collapsed} />
    </aside>
  )
}

/**
 * The sidebar as an overlay below 768 px, opened from the header. Choosing a
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

/** Status bar: locations, running and interrupted work. Each item opens where it is resolved. */
function StatusArea({ narrow }: { narrow: boolean }) {
  const running = useStore((s) => Object.values(s.operations).filter((op) => op.status === "running"))
  const interrupted = useStore((s) => Object.values(s.operations).filter((op) => op.status === "interrupted").length)
  const locations = useStore((s) => Object.values(s.catalog.locations))
  const offline = useStore((s) => Object.values(s.catalog.locations).filter((l) => !s.disk.volumes[l.volumeId]?.mounted))
  const first = running[0]
  const pct = first && first.progress.total > 0 ? Math.round((first.progress.done / first.progress.total) * 100) : null
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Button variant="ghost" size="xs" render={<Link to="/settings/locations" />} className="text-muted-foreground">
        <HardDrive data-icon="inline-start" aria-hidden="true" />
        <span className="tabular-nums">
          {locations.length - offline.length} of {locations.length} locations online
        </span>
      </Button>
      {offline.length > 0 ? (
        <Button
          variant="ghost"
          size="xs"
          render={<Link to="/storage" />}
          className="text-warning"
          aria-label={offline.length === 1 ? `${offline[0]!.displayName} offline` : `${offline.length} locations offline`}
        >
          <Unplug data-icon="inline-start" aria-hidden="true" />
          <span className={cn(narrow && "sr-only")}>{offline.length === 1 ? `${offline[0]!.displayName} offline` : `${offline.length} locations offline`}</span>
        </Button>
      ) : null}
      <div className="min-w-0 flex-1" />
      {interrupted > 0 ? (
        <Button variant="ghost" size="xs" render={<Link to="/activity" />} className="text-warning" aria-label={`${interrupted} interrupted operation${interrupted === 1 ? "" : "s"}`}>
          <TriangleAlert data-icon="inline-start" aria-hidden="true" />
          <span className="tabular-nums">{interrupted} interrupted</span>
        </Button>
      ) : null}
      {first ? (
        <Button variant="ghost" size="xs" render={<Link to="/activity" />} className="min-w-0 max-w-72 shrink tabular-nums">
          <Spinner data-icon="inline-start" aria-hidden="true" />
          <span className="truncate">
            {first.title}
            {pct !== null ? ` ${pct}%` : ""}
            {running.length > 1 ? ` (+${running.length - 1})` : ""}
          </span>
        </Button>
      ) : (
        <span className="px-2">No work running</span>
      )}
    </div>
  )
}

/** The palette trigger keeps its whole label from 768 px up; below that it is an icon button with the same name. */
function PaletteTrigger({ narrow }: { narrow: boolean }) {
  if (narrow) {
    return (
      <Button variant="outline" size="icon-sm" className="text-muted-foreground" onClick={() => openPanel("palette")}>
        <Search aria-hidden="true" />
        <span className="sr-only">Search or jump to…</span>
      </Button>
    )
  }
  return (
    <Button variant="outline" size="sm" className="w-60 min-w-0 shrink justify-start text-muted-foreground xl:w-72" onClick={() => openPanel("palette")}>
      <Search data-icon="inline-start" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left">Search or jump to…</span>
      <Kbd>{MOD_LABEL} K</Kbd>
    </Button>
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

/** The single scroll container; the skip link targets it. */
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
 * The window: a full-height source list, a unified toolbar over the content,
 * the content pane (the only scroll container) and a status bar. The page
 * itself never scrolls.
 */
function AppFrame({ children }: { children: ReactNode }) {
  const { sidebarCollapsed } = useShellUi()
  const narrow = useNarrowViewport()
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <SkipLink />
      <div className="flex min-h-0 flex-1">
        {narrow ? null : <Sidebar />}
        <div className="flex min-w-0 flex-1 flex-col">
          <header data-chrome className="z-20 flex min-h-10 min-w-0 shrink-0 flex-wrap items-center gap-2 border-b border-separator bg-chrome px-2 py-1">
            {narrow ? (
              <SidebarDrawer />
            ) : (
              <Button variant="ghost" size="icon-sm" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}>
                {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
              </Button>
            )}
            <NextActionButton />
            <div className="min-w-0 flex-1" />
            <PaletteTrigger narrow={narrow} />
            <Button variant="ghost" size={narrow ? "icon-sm" : "sm"} onClick={() => openPanel("simulation")}>
              <FlaskConical data-icon="inline-start" aria-hidden="true" />
              <span className={cn(narrow && "sr-only")}>Prototype</span>
            </Button>
            <ThemeMenu />
          </header>
          <MainArea>{children}</MainArea>
        </div>
      </div>
      <footer data-chrome aria-label="Status" className="flex h-6 shrink-0 items-center gap-3 border-t border-separator bg-chrome px-2 text-[0.6875rem] text-muted-foreground">
        <StatusArea narrow={narrow} />
      </footer>
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
