/**
 * App shell (foundation-owned): root providers, the main layout with source
 * list, unified toolbar and status bar, and the minimal onboarding layout.
 * Harness v5 keeps v4's window: the page never scrolls, only panes do.
 *
 * Round 2: the source list is navigation only (no Project outline), with an
 * optional Recent group and count badges; the toolbar leads with Back and
 * Forward and carries the Issues hub; every word comes from the message
 * catalogue (`useMessages()`). The
 * status bar is its own module (`status-bar.tsx`).
 */
import { Link, Outlet, useRouterState } from "@tanstack/react-router"
import { Aperture, Download, Ellipsis, FlaskConical, FolderKanban, Languages, MapPinOff, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Palette, Play, Search, Sun } from "lucide-react"
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { EmptyState, LiveAnnouncer } from "@/components/app/feedback"
import { useDocumentTitle } from "@/components/app/page"
import { CountBadge } from "@/components/app/pill"
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
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { groupPipeline, type NextAction, nextFrom, projectNext, runPipeline, type RunStepState } from "@/domain/derive"
import { LOCALE_META, LOCALES, type Locale, say } from "@/lib/i18n"
import { useMediaQuery } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"
import { useNavCounts } from "@/store/issues"
import { nowIso, useStore } from "@/store/core"
import { useActiveRoute } from "./active-route"
import { CommandPalette } from "./command-palette"
import { SHELLS } from "./contributions"
import { HistoryControl } from "./history"
import { IssuesButton } from "./issues-hub"
import { NAV_GROUPS, type NavItem, PRIMARY_ITEMS, UTILITY_ITEMS } from "./navigation"
import { setLocale, setTheme, type ThemePreference, useMessages, usePreferences } from "./preferences"
import { CurrentLink, gateWord, StepGlyph, stepName, useFollowLink } from "./run-ui"
import { MOD_LABEL, PALETTE_SHORTCUT, ShortcutsDialog, useGlobalShortcuts } from "./shortcuts"
import { SimulationSheet } from "./simulation-panel"
import { THEMES, themeInfo } from "./themes"
import { StatusBar } from "./status-bar"
import { openPanel, openSheet, rememberProject, toggleSidebar, useShellUi } from "./ui-state"

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
  const m = useMessages()
  return (
    <a
      href="#main"
      onClick={(event) => {
        event.preventDefault()
        document.getElementById("main")?.focus()
      }}
      className="sr-only z-50 rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:px-3 focus:py-2"
    >
      {m.shell_skip_to_content()}
    </a>
  )
}

/**
 * Source-list row states, all from the sidebar tokens: hover takes
 * `--sidebar-accent` (at least 0.05 OKLCH lightness from the list), the
 * current row the selection fill with its own text colour, a row that holds
 * the current page (Projects, while a Recent Project is open) semibold
 * text, and keyboard focus an inset 2 px ring (index.css).
 */
const NAV_ROW = "flex h-6.5 items-center gap-2 rounded-[0.3125rem] px-2 text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent [&>svg]:text-link"
const NAV_CURRENT = "bg-sidebar-primary font-semibold text-sidebar-primary-foreground hover:bg-sidebar-primary hover:text-sidebar-primary-foreground active:bg-sidebar-primary [&>svg]:text-sidebar-primary-foreground"

interface NavBadge {
  count: number
  /** Screen-reader text, e.g. "3 need attention". */
  label: string
}

/**
 * A source-list row. The deepest current row takes the accent fill and
 * aria-current: a Recent Project row while its Project is open, so Projects
 * then only marks that it holds the selection.
 */
function NavLink({ to, label, icon: Icon, collapsed, current, holds, badge }: { to: string; label: string; icon: NavItem["icon"]; collapsed: boolean; current: boolean; holds?: boolean; badge?: NavBadge }) {
  const shownBadge = badge && badge.count > 0 ? badge : null
  const link = (
    <CurrentLink
      to={to}
      data-nav-link
      current={current ? "page" : false}
      className={cn(NAV_ROW, current && NAV_CURRENT, holds && !current && "font-semibold", collapsed && "relative justify-center px-0")}
      aria-label={collapsed ? (shownBadge ? `${label}, ${shownBadge.label}` : label) : undefined}
    >
      <Icon aria-hidden="true" className="size-4 shrink-0" />
      {collapsed ? (
        shownBadge ? <span aria-hidden="true" className={cn("absolute top-0.5 right-1.5 size-1.5 rounded-full", current ? "bg-sidebar-primary-foreground" : "bg-warning")} /> : null
      ) : (
        <>
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {shownBadge ? <CountBadge count={shownBadge.count} tone="warning" label={shownBadge.label} className={cn(current && "bg-sidebar-primary-foreground text-sidebar-primary")} /> : null}
        </>
      )}
    </CurrentLink>
  )
  if (!collapsed) return link
  return (
    <Tooltip>
      <TooltipTrigger render={link} />
      <TooltipContent side="right">{shownBadge ? `${label} · ${shownBadge.count}` : label}</TooltipContent>
    </Tooltip>
  )
}

/**
 * Below 768 px (WCAG 1.4.10 reflow, 1280 px at 200 % and up) the sidebar
 * leaves the layout and opens as an overlay from the header instead.
 */
const NARROW_QUERY = "(max-width: 767.98px)"

function useNarrowViewport(): boolean {
  return useMediaQuery(NARROW_QUERY)
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
    // The mosaic editor (Start group) and Wrap up (its steps) hold their own primary action.
    const ownsPrimary = Boolean(active.search.mosaic) || active.search.stage === "wrap-up"
    if (project && !ownsPrimary) {
      const next = projectNext(state, project, Date.parse(nowIso()))
      // On the screen it names (the candidate review), the Project's Next has nothing more to open.
      const search = next?.link.search ?? {}
      const onIt = Object.keys(search).length > 0 && Object.entries(search).every(([key, value]) => active.search[key] === value)
      return { next: onIt ? null : next, steps: null, here: null }
    }
    return { next: null, steps: null, here: null }
  }, [active, state])
}

/**
 * The one Next action, in the toolbar like a Run button: ⌘↩ runs it, ⌃1–⌃6
 * jump to a step of the open run or run group. One row that never wraps:
 * beside it only the gate glyph and word of the step on screen or the step
 * that holds Next; the reason is in the tooltip.
 */
function NextActionButton() {
  const m = useMessages()
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
  if (!next && !here) return <div className="min-w-0 flex-1" />
  const gateStep = here ?? next?.step ?? null
  const gateDetail = here ? (here.items.find((i) => i.met === false)?.detail ?? here.status) : null
  const detail = [here && gateDetail ? `${here.n} ${stepName(m, here.id)}: ${gateWord(m, here.state)} · ${say(m, gateDetail)}` : null, next?.reason ? say(m, next.reason) : null].filter(Boolean).join(" · ")
  return (
    <div className="flex min-w-0 flex-1 items-center gap-2">
      {next ? (
        <Button variant="outline" size="sm" className="min-w-0 max-w-[22rem] shrink" onClick={() => follow(next.link)} title={`${detail} (${MOD_LABEL}↩)`}>
          <Play aria-hidden="true" data-icon="inline-start" className="fill-current" />
          <span className="min-w-0 truncate">{m.shell_next({ label: say(m, next.label) })}</span>
        </Button>
      ) : null}
      {gateStep ? (
        <span className={cn("min-w-0 items-center gap-1.5 text-xs text-muted-foreground", next ? "hidden lg:flex" : "flex")} title={detail}>
          <StepGlyph state={gateStep.state} />
          <span className="truncate">{gateWord(m, gateStep.state)}</span>
        </span>
      ) : null}
      <div className="min-w-0 flex-1" />
    </div>
  )
}

/** Recent Projects (max 3, newest first) that still exist; no outline children. */
function useRecentProjects(): Array<{ id: string; name: string }> {
  const { recentProjectIds } = useShellUi()
  const projects = useStore((s) => s.catalog.projects)
  return recentProjectIds.flatMap((id) => (projects[id] ? [{ id, name: projects[id]!.name }] : []))
}

function GroupHeading({ collapsed, children }: { collapsed: boolean; children: ReactNode }) {
  if (collapsed) return <div className="mx-auto my-1 h-px w-6 bg-sidebar-border" aria-hidden="true" />
  return <div className="px-2 pb-0.5 text-[0.6875rem] font-semibold text-muted-foreground">{children}</div>
}

function SidebarContent({ collapsed }: { collapsed: boolean }) {
  const m = useMessages()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const counts = useNavCounts()
  const recent = useRecentProjects()
  const openProject = pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null
  const recentCurrent = openProject !== null && recent.some((p) => p.id === openProject)
  const within = (to: string) => (to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`))
  const badges: Record<string, NavBadge> = {
    "/sessions": { count: counts.sessions, label: m.shell_nav_sessions_badge({ count: counts.sessions }) },
    "/projects": { count: counts.projects, label: m.shell_nav_projects_badge({ count: counts.projects }) },
  }
  const row = (item: NavItem) => {
    const inside = within(item.to)
    // A Recent row is the deepest current row while its Project is open; Projects then holds it.
    const current = inside && !(item.to === "/projects" && recentCurrent)
    return <NavLink to={item.to} label={item.label} icon={item.icon} collapsed={collapsed} current={current} holds={inside} badge={badges[item.to]} />
  }
  return (
    <>
      <div data-chrome className={cn("flex h-10 shrink-0 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
        <Aperture aria-hidden="true" className="size-4.5 shrink-0 text-link" />
        {collapsed ? <span className="sr-only">{m.app_name()}</span> : <span className="text-sm font-semibold">{m.app_name()}</span>}
      </div>
      <nav aria-label={m.shell_nav_main()} data-chrome className="flex-1 space-y-3 overflow-y-auto px-2 pb-2">
        <ul className="space-y-px">
          {PRIMARY_ITEMS.map((item) => (
            <li key={item.to}>{row(item)}</li>
          ))}
        </ul>
        {recent.length > 0 ? (
          <div className="space-y-px">
            <GroupHeading collapsed={collapsed}>{m.shell_nav_recent()}</GroupHeading>
            <ul className="space-y-px" aria-label={m.shell_nav_recent()}>
              {recent.map((project) => (
                <li key={project.id}>
                  <NavLink to={`/projects/${project.id}`} label={project.name} icon={FolderKanban} collapsed={collapsed} current={openProject === project.id} />
                </li>
              ))}
            </ul>
          </div>
        ) : null}
        {NAV_GROUPS.map((group) => (
          <div key={group.label} className="space-y-px">
            <GroupHeading collapsed={collapsed}>{group.label}</GroupHeading>
            <ul className="space-y-px">
              {group.items.map((item) => (
                <li key={item.to}>{row(item)}</li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
      <div data-chrome className="space-y-px border-t border-sidebar-border p-2">
        {SHELLS.map((shell, index) => (shell.SidebarFooter ? <shell.SidebarFooter key={index} collapsed={collapsed} /> : null))}
        <ul className="space-y-px" aria-label={m.shell_nav_utilities()}>
          {UTILITY_ITEMS.map((item) => (
            <li key={item.to}>{row(item)}</li>
          ))}
        </ul>
      </div>
    </>
  )
}

function Sidebar() {
  const m = useMessages()
  const { sidebarCollapsed: collapsed } = useShellUi()
  return (
    <aside className={cn("flex shrink-0 flex-col border-r border-separator bg-sidebar text-sidebar-foreground", collapsed ? "w-12" : "w-60")} aria-label={m.shell_sidebar()}>
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
  const m = useMessages()
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
      <SheetTrigger render={<Button variant="ghost" size="icon" aria-label={m.shell_navigation_open()} />}>
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
        <SheetTitle className="sr-only">{m.shell_navigation()}</SheetTitle>
        <SidebarContent collapsed={false} />
      </SheetContent>
    </Sheet>
  )
}

/** Every theme of the registry plus Match system, as menu radio items. */
function ThemeItems() {
  const m = useMessages()
  const { theme } = usePreferences()
  return (
    <DropdownMenuRadioGroup value={theme} onValueChange={(value) => setTheme(value as ThemePreference)}>
      {THEMES.map((option) => (
        <DropdownMenuRadioItem key={option.id} value={option.id}>
          {option.name}
        </DropdownMenuRadioItem>
      ))}
      <DropdownMenuRadioItem value="system">{m.shell_theme_match_system()}</DropdownMenuRadioItem>
    </DropdownMenuRadioGroup>
  )
}

function LanguageItems() {
  const { locale } = usePreferences()
  return (
    <DropdownMenuRadioGroup value={locale} onValueChange={(value) => setLocale(value as Locale)}>
      {LOCALES.map((id) => (
        <DropdownMenuRadioItem key={id} value={id} lang={id}>
          {LOCALE_META[id].nativeName}
        </DropdownMenuRadioItem>
      ))}
    </DropdownMenuRadioGroup>
  )
}

/** The setup layout's theme menu: the icon follows the applied theme's scheme. */
function ThemeMenu() {
  const m = useMessages()
  const { theme, scheme } = usePreferences()
  const Icon = theme === "system" ? Monitor : scheme === "dark" ? Moon : Sun
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon" aria-label={m.shell_theme_named({ name: theme === "system" ? m.shell_theme_match_system() : themeInfo(theme).name })} />}>
        <Icon aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{m.shell_theme()}</DropdownMenuLabel>
          <ThemeItems />
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The toolbar's overflow: Prototype controls, Theme and Language, so the toolbar keeps one row at every width. */
function MoreMenu() {
  const m = useMessages()
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={m.common_more()} title={m.common_more()} />}>
        <Ellipsis aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        <DropdownMenuItem onClick={() => openPanel("simulation")}>
          <FlaskConical aria-hidden="true" />
          {m.shell_prototype_controls()}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Palette aria-hidden="true" />
            {m.shell_theme()}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <ThemeItems />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <Languages aria-hidden="true" />
            {m.shell_language()}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-52">
            <LanguageItems />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** The palette trigger keeps its whole label from 1200 px up; below that it is an icon button with the same name, so the toolbar never wraps. */
function PaletteTrigger({ narrow }: { narrow: boolean }) {
  const m = useMessages()
  const label = m.shell_search_or_jump()
  if (narrow) {
    return (
      <Button variant="outline" size="icon-sm" className="text-muted-foreground" onClick={() => openPanel("palette")}>
        <Search aria-hidden="true" />
        <span className="sr-only">{label}</span>
      </Button>
    )
  }
  return (
    <Button
      variant="outline"
      size="sm"
      className="min-w-0 shrink-0 justify-start text-muted-foreground max-[75rem]:size-6 max-[75rem]:justify-center max-[75rem]:px-0 min-[75rem]:w-60 2xl:w-72"
      onClick={() => openPanel("palette")}
      title={m.shell_with_shortcut({ label, shortcut: PALETTE_SHORTCUT })}
    >
      <Search data-icon="inline-start" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-left max-[75rem]:sr-only">{label}</span>
      <Kbd className="max-[75rem]:hidden">{PALETTE_SHORTCUT}</Kbd>
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

/** An opened Project leads the source list's Recent group. */
function useRememberProject() {
  const { projectId } = useActiveRoute()
  const exists = useStore((s) => (projectId ? Boolean(s.catalog.projects[projectId]) : false))
  useEffect(() => {
    if (projectId && exists) rememberProject(projectId)
  }, [projectId, exists])
}

/**
 * The window: a full-height source list, a unified toolbar over the content,
 * the content pane (the only scroll container) and a status bar. The page
 * itself never scrolls.
 */
function AppFrame({ children }: { children: ReactNode }) {
  const m = useMessages()
  const { sidebarCollapsed } = useShellUi()
  const narrow = useNarrowViewport()
  useRememberProject()
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <SkipLink />
      <div className="flex min-h-0 flex-1">
        {narrow ? null : <Sidebar />}
        <div className="flex min-w-0 flex-1 flex-col">
          <header data-chrome className="z-20 flex h-10 min-w-0 shrink-0 flex-nowrap items-center gap-1.5 border-b border-separator bg-chrome px-2">
            {narrow ? (
              <SidebarDrawer />
            ) : (
              <Button variant="ghost" size="icon-sm" onClick={toggleSidebar} aria-label={sidebarCollapsed ? m.shell_sidebar_show() : m.shell_sidebar_hide()} title={sidebarCollapsed ? m.shell_sidebar_show() : m.shell_sidebar_hide()}>
                {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
              </Button>
            )}
            <HistoryControl />
            <NextActionButton />
            <IssuesButton />
            <Button variant="ghost" size="sm" className="shrink-0 max-xl:size-6 max-xl:px-0" onClick={() => openSheet({ kind: "import" })} title={m.shell_import()}>
              <Download data-icon="inline-start" aria-hidden="true" />
              <span className="max-xl:sr-only">{m.shell_import()}</span>
            </Button>
            <PaletteTrigger narrow={narrow} />
            <MoreMenu />
          </header>
          <MainArea>{children}</MainArea>
        </div>
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
  const m = useMessages()
  useDocumentTitle(m.shell_not_found_doc_title())
  return (
    <AppFrame>
      <div className="mx-auto flex w-full max-w-lg flex-1 flex-col justify-center p-6">
        <EmptyState
          icon={MapPinOff}
          title={m.shell_not_found_title()}
          titleAs="h1"
          description={m.shell_not_found_description()}
          action={
            <Button render={<Link to="/" />} size="sm">
              {m.shell_not_found_home()}
            </Button>
          }
        />
      </div>
    </AppFrame>
  )
}

/** Focused layout for first-run setup: no sidebar, one task at a time. */
export function SetupShell() {
  const m = useMessages()
  return (
    <div className="flex h-dvh flex-col overflow-hidden">
      <SkipLink />
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-4">
        <Aperture aria-hidden="true" className="size-5 text-primary" />
        <span className="font-semibold">{m.app_name()}</span>
        <div className="flex-1" />
        <Button variant="outline" size="sm" onClick={() => openPanel("simulation")}>
          <FlaskConical data-icon="inline-start" aria-hidden="true" />
          {m.common_prototype()}
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
