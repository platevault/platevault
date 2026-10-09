/**
 * App shell (foundation-owned): root providers, the main layout with source
 * list, unified toolbar and status bar, and the minimal onboarding layout.
 * Harness v5 keeps v4's window: the page never scrolls, only panes do.
 */
import { Link, Outlet, useRouterState } from "@tanstack/react-router"
import { Aperture, Download, Ellipsis, FlaskConical, HardDrive, MapPinOff, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Play, Search, Sun, TriangleAlert, Unplug } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react"
import { EmptyState, LiveAnnouncer } from "@/components/app/feedback"
import { useDocumentTitle } from "@/components/app/page"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { GATE_LABEL, groupPipeline, type NextAction, nextFrom, projectNext, runPipeline, type RunStepState } from "@/domain/derive"
import { cn } from "@/lib/utils"
import { nowIso, useStore } from "@/store/core"
import { CommandPalette } from "./command-palette"
import { SHELLS } from "./contributions"
import { NAV_GROUPS, type NavItem, PRIMARY_ITEMS, UTILITY_ITEMS } from "./navigation"
import { ProjectOutline, useActiveRoute } from "./outline"
import { setTheme, type ThemePreference, usePreferences } from "./preferences"
import { CurrentLink, StepGlyph, useFollowLink } from "./run-ui"
import { MOD_LABEL, ShortcutsDialog, useGlobalShortcuts } from "./shortcuts"
import { SimulationSheet } from "./simulation-panel"
import { openPanel, openSheet, toggleSidebar, useShellUi } from "./ui-state"

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

/**
 * A source-list row. The deepest current row takes the accent fill and
 * aria-current: inside a Project the outline row does, and Projects only
 * marks that it contains the selection (unless the sidebar is collapsed).
 */
function NavLink({ item, collapsed }: { item: NavItem; collapsed: boolean }) {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const Icon = item.icon
  const within = item.to === "/" ? pathname === "/" : pathname === item.to || pathname.startsWith(`${item.to}/`)
  const deeper = within && !collapsed && item.to === "/projects" && pathname !== "/projects"
  const current = within && !deeper
  const link = (
    <CurrentLink
      to={item.to}
      current={current ? "page" : false}
      className={cn(
        "flex h-6.5 items-center gap-2 rounded-[0.3125rem] px-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground [&>svg]:text-link",
        current && "bg-sidebar-primary font-medium text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground [&>svg]:text-sidebar-primary-foreground",
        deeper && "font-medium",
        collapsed && "justify-center px-0",
      )}
      aria-label={collapsed ? item.label : undefined}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {collapsed ? null : <span className="truncate">{item.label}</span>}
    </CurrentLink>
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

/**
 * The open context's one Next action and step list, derived from the route:
 * a run's or run group's Next (its six steps), else the open Project's Next
 * (D-W35). Null on other pages. On the step that holds Next, Next moves on
 * (`nextFrom`) and `here` carries that step for the caption.
 */
function useContextNext(): { next: NextAction | null; steps: RunStepState[] | null; here: RunStepState | null } {
  const active = useActiveRoute()
  const state = useStore((s) => s)
  return useMemo(() => {
    const run = active.runId ? state.catalog.runs[active.runId] : undefined
    const group = !run && active.groupId ? state.catalog.runGroups[active.groupId] : undefined
    const pipeline = run ? runPipeline(state, run) : group ? groupPipeline(state, group) : null
    if (pipeline) {
      const next = nextFrom(pipeline.steps, pipeline.next, active.step)
      // `here` only when the step on screen held Next and Next moved past it (or now waits on it).
      const moved = pipeline.next?.step?.id === active.step && next !== pipeline.next
      return { next, steps: pipeline.steps, here: moved ? (pipeline.steps.find((s) => s.id === active.step) ?? null) : null }
    }
    const project = active.projectId ? state.catalog.projects[active.projectId] : undefined
    if (project) {
      const next = projectNext(state, project, Date.parse(nowIso()))
      // On the candidate review it names, the Project's Next has nothing more to open.
      const onIt = next?.link.search?.candidates !== undefined && active.search.candidates === next.link.search.candidates
      return { next: onIt ? null : next, steps: null, here: null }
    }
    return { next: null, steps: null, here: null }
  }, [active, state])
}

/**
 * The one Next action, in the toolbar like a Run button: ⌘↩ runs it, ⌃1–⌃6
 * jump to a step of the open run or run group. One row that never wraps: the
 * label and the caption truncate, with the whole text in the tooltip.
 */
function NextActionButton() {
  const context = useContextNext()
  const follow = useFollowLink()
  const followRef = useRef(follow)
  followRef.current = follow
  const contextRef = useRef(context)
  contextRef.current = context
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const current = contextRef.current
      if ((event.metaKey || event.ctrlKey) && event.key === "Enter" && current.next) {
        event.preventDefault()
        followRef.current(current.next.link)
        return
      }
      const n = Number(event.key)
      if (event.ctrlKey && !event.metaKey && current.steps && n >= 1 && n <= current.steps.length) {
        event.preventDefault()
        followRef.current(current.steps[n - 1]!.link)
      }
    }
    window.addEventListener("keydown", onKeyDown)
    return () => window.removeEventListener("keydown", onKeyDown)
  }, [])
  const { next, here } = context
  // The step on screen leads the caption when Next has moved past it ("2 Review: Needs review · 4 of 48 · then …").
  const hereText = here ? `${here.n} ${here.label}: ${GATE_LABEL[here.state]} · ${here.items.find((i) => i.met === false)?.detail ?? here.status}` : null
  const caption = [hereText, next ? `${next.step ? `${next.step.n} ${next.step.label} · ` : ""}${next.reason}` : null].filter(Boolean).join(" · then ")
  if (!next && !here) return <div className="min-w-0 flex-1" />
  const glyphState = here ? here.state : next?.step?.state
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {next ? (
        <Button size="sm" className="min-w-0 max-w-[22rem] shrink" onClick={() => follow(next.link)} title={`Next: ${next.label}. ${next.reason} (${MOD_LABEL}↩)`}>
          <Play aria-hidden="true" data-icon="inline-start" className="fill-current" />
          <span className="min-w-0 truncate">Next: {next.label}</span>
        </Button>
      ) : null}
      <span className={cn("min-w-0 flex-1 items-center gap-1.5 text-xs text-muted-foreground", next ? "hidden lg:flex" : "flex")} title={caption}>
        {glyphState ? <StepGlyph state={glyphState} /> : null}
        <span className="truncate">{caption}</span>
      </span>
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
              {item.to === "/projects" && !collapsed ? <ProjectOutline /> : null}
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

/** The toolbar's overflow: Prototype controls and Theme, so the toolbar keeps one row at every width. */
function MoreMenu() {
  const { theme } = usePreferences()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="More: Prototype and Theme" />}>
        <Ellipsis aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => openPanel("simulation")}>
          <FlaskConical aria-hidden="true" />
          Prototype controls…
        </DropdownMenuItem>
        <DropdownMenuSeparator />
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

/** The palette trigger keeps its whole label from 1200 px up; below that it is an icon button with the same name, so the toolbar never wraps. */
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
    <Button
      variant="outline"
      size="sm"
      className="min-w-0 shrink-0 justify-start text-muted-foreground max-[75rem]:size-6 max-[75rem]:justify-center max-[75rem]:px-0 min-[75rem]:w-60 2xl:w-72"
      onClick={() => openPanel("palette")}
      title={`Search or jump to… (${MOD_LABEL} K)`}
    >
      <Search data-icon="inline-start" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left max-[75rem]:sr-only">Search or jump to…</span>
      <Kbd className="max-[75rem]:hidden">{MOD_LABEL} K</Kbd>
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
          <header data-chrome className="z-20 flex h-10 min-w-0 shrink-0 flex-nowrap items-center gap-2 border-b border-separator bg-chrome px-2">
            {narrow ? (
              <SidebarDrawer />
            ) : (
              <Button variant="ghost" size="icon-sm" onClick={toggleSidebar} aria-label={sidebarCollapsed ? "Show sidebar" : "Hide sidebar"}>
                {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
              </Button>
            )}
            <NextActionButton />
            <Button variant="ghost" size="sm" className="shrink-0 max-xl:size-6 max-xl:px-0" onClick={() => openSheet({ kind: "import" })} title="Import from a card, folder or network share">
              <Download data-icon="inline-start" aria-hidden="true" />
              <span className="max-xl:sr-only">Import</span>
            </Button>
            <PaletteTrigger narrow={narrow} />
            <MoreMenu />
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
            <Button render={<Link to="/" />} size="sm">
              Go to Home
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
