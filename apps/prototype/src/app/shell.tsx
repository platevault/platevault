/**
 * App shell (foundation-owned): root providers, the app window and the
 * first-run setup window. The look lives in the templates
 * (`@/components/templates/app-frame`); this file wires the source list,
 * the toolbar and the status bar to the router and the store.
 *
 * - Source list (NavList): Home, Projects, Targets; the Library (Sessions,
 *   Calibration); then Recent, below Library so nothing above it moves
 *   (A SH3): Projects, Sessions and Targets menus of the records opened last.
 *   Getting started (ChecklistRing) sits above Activity and Settings.
 * - Toolbar: the sidebar button, Back and Forward, the search field of the
 *   command palette, Issues, Import… and More ▾ (Prototype controls, Quit,
 *   Theme, Language). The step page's Proceed is ⌘↩ (`shortcuts.tsx`); there
 *   is no second advance button in the toolbar.
 * - The root carries the quit guard (`quit-guard.tsx`) and the app window
 *   the orientation walk after setup (`onboarding.tsx`).
 */
import { Outlet, useNavigate, useRouterState } from "@tanstack/react-router"
import { Aperture, ChevronDown, Crosshair, Download, FlaskConical, FolderKanban, Languages, Layers, MapPinOff, Palette, Power } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { ActionButton, MenuItems, useAction } from "@/components/app/actions"
import type { Action } from "@/components/app/contracts"
import { EmptyState, LiveAnnouncer } from "@/components/app/feedback"
import { type NavBadge, type NavListGroup, type NavListItem, NavList } from "@/components/app/nav-list"
import { useDocumentTitle } from "@/components/app/page"
import { PaletteTrigger } from "@/components/app/palette"
import { ThemeMenuItems } from "@/components/app/theme-picker"
import { AppFrame, SetupFrame } from "@/components/templates/app-frame"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import { formatNight } from "@/lib/format"
import { LOCALE_META, LOCALES, type Locale } from "@/lib/i18n"
import { useMediaQuery } from "@/lib/use-media-query"
import { store, useStore } from "@/store/core"
import { useNavCounts } from "@/store/issues"
import { CommandPalette, useAppActions } from "./command-palette"
import { SHELLS } from "./contributions"
import { HistoryControl } from "./history"
import { IssuesHub } from "./issues-hub"
import { NAV_GROUPS, type NavItem, PRIMARY_ITEMS, UTILITY_ITEMS } from "./navigation"
import { GettingStartedRing, OrientationWalk, useGettingStartedDue } from "./onboarding"
import { setLocale, useMessages, usePreferences } from "./preferences"
import { guardedWork, QuitDialog, quitPrototype, useQuitGuard } from "./quit-guard"
import { PALETTE_SHORTCUT, ShortcutsDialog, useGlobalShortcuts } from "./shortcuts"
import { SimulationSheet } from "./simulation-panel"
import { StatusBar } from "./status-bar"
import { openPanel, type RecentKind, rememberRecent, toggleSidebar, useShellUi } from "./ui-state"

export function RootLayout() {
  useGlobalShortcuts()
  useQuitGuard()
  return (
    <TooltipProvider delay={400}>
      <LiveAnnouncer />
      <Toaster />
      <Outlet />
      <CommandPalette />
      <ShortcutsDialog />
      <SimulationSheet />
      {SHELLS.map((shell, index) => (shell.Overlay ? <shell.Overlay key={index} /> : null))}
    </TooltipProvider>
  )
}

// ---------------------------------------------------------------------------
// Source list
// ---------------------------------------------------------------------------

interface RecentRecord {
  id: string
  label: string
}

/** The records of each Recent menu that still exist, newest first. */
function useRecent(): Record<RecentKind, RecentRecord[]> {
  const m = useMessages()
  const { recent } = useShellUi()
  const catalog = useStore((s) => s.catalog)
  const pick = <T,>(ids: string[], table: Record<string, T | undefined>, label: (record: T) => string) => ids.flatMap((id) => (table[id] ? [{ id, label: label(table[id]) }] : []))
  return {
    projects: pick(recent.projects, catalog.projects, (p) => p.name),
    sessions: pick(recent.sessions, catalog.sessions, (s) => `${formatNight(s.night)} · ${s.objectLabel ?? m.palette_session_missing_object()}`),
    targets: pick(recent.targets, catalog.targets, (t) => t.name),
  }
}

const RECENT_ROUTE: Record<RecentKind, { pattern: RegExp; to: string; param: string; row: string }> = {
  projects: { pattern: /^\/projects\/([^/]+)/, to: "/projects/$projectId", param: "projectId", row: "projects" },
  sessions: { pattern: /^\/sessions\/([^/]+)/, to: "/sessions/$sessionId", param: "sessionId", row: "sessions" },
  targets: { pattern: /^\/targets\/([^/]+)/, to: "/targets/$targetId", param: "targetId", row: "targets" },
}

const RECENT_KINDS: RecentKind[] = ["projects", "sessions", "targets"]

/** An opened Project, session or Target leads its Recent menu. */
function useRememberRecent() {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const catalog = useStore((s) => s.catalog)
  useEffect(() => {
    for (const kind of RECENT_KINDS) {
      const id = pathname.match(RECENT_ROUTE[kind].pattern)?.[1]
      if (id && catalog[kind][id]) rememberRecent(kind, id)
    }
  }, [pathname, catalog])
}

interface SourceList {
  main: NavListGroup[]
  utilities: NavListGroup[]
  current: string | null
  holds: string[]
}

/** The source list's groups and which row is the page: the deepest one, a Recent record while it is open. */
function useSourceList(): SourceList {
  const m = useMessages()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const counts = useNavCounts()
  const recent = useRecent()
  const badges: Record<string, NavBadge> = {
    "/sessions": { count: counts.sessions, label: m.shell_nav_sessions_badge({ count: counts.sessions }), tone: "warning" },
    "/projects": { count: counts.projects, label: m.shell_nav_projects_badge({ count: counts.projects }), tone: "warning" },
  }
  const row = (item: NavItem): NavListItem => ({ id: item.to, label: item.label, icon: item.icon, link: { to: item.to }, badge: badges[item.to] })
  const recentIcon: Record<RecentKind, typeof FolderKanban> = { projects: FolderKanban, sessions: Layers, targets: Crosshair }
  const recentLabel: Record<RecentKind, string> = { projects: m.nav_projects(), sessions: m.nav_sessions(), targets: m.nav_targets() }
  const recentRows: NavListItem[] = RECENT_KINDS.filter((kind) => recent[kind].length > 0).map((kind) => ({
    id: `recent-${kind}`,
    label: recentLabel[kind],
    icon: recentIcon[kind],
    items: recent[kind].map((record) => ({ id: `${kind}:${record.id}`, label: record.label, icon: recentIcon[kind], link: { to: RECENT_ROUTE[kind].to, params: { [RECENT_ROUTE[kind].param]: record.id } } })),
  }))

  // A Recent record that is open is the page; the destination it belongs to holds it.
  const open = RECENT_KINDS.map((kind) => ({ kind, id: pathname.match(RECENT_ROUTE[kind].pattern)?.[1] })).find(({ kind, id }) => id && recent[kind].some((record) => record.id === id))
  const destinations = [...PRIMARY_ITEMS, ...NAV_GROUPS.flatMap((group) => group.items), ...UTILITY_ITEMS]
  const within = (to: string) => (to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`))
  const deepest = destinations.filter((item) => within(item.to)).sort((a, b) => b.to.length - a.to.length)[0]
  const current = open ? `${open.kind}:${open.id}` : (deepest?.to ?? null)
  const holds = open ? [`/${RECENT_ROUTE[open.kind].row}`] : []

  return {
    main: [
      { id: "primary", items: PRIMARY_ITEMS.map(row) },
      ...NAV_GROUPS.map((group) => ({ id: group.label, heading: group.label, items: group.items.map(row) })),
      ...(recentRows.length > 0 ? [{ id: "recent", heading: m.shell_nav_recent(), items: recentRows }] : []),
    ],
    utilities: [{ id: "utilities", items: UTILITY_ITEMS.map(row) }],
    current,
    holds,
  }
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

/** More ▾: the Prototype controls and Quit, then the Theme and Language choices (ThemeMenuItems, the menu form of ThemePicker). */
function MoreItems() {
  const m = useMessages()
  const app = useAppActions()
  const runner = useAction()
  const { locale } = usePreferences()
  const [asking, setAsking] = useState(false)
  // Quit asks first while an import, index or prepare runs (Round 6); otherwise it quits at once.
  const quit: Action = { id: "quit", label: m.shell_quit_app(), icon: Power, run: () => (guardedWork(store.getState().operations).length > 0 ? setAsking(true) : quitPrototype()) }
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />} data-more-menu="">
          {m.common_more()}
          <ChevronDown aria-hidden="true" data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <MenuItems items={[{ heading: m.common_prototype() }, app.prototypeControls, quit]} runner={runner} />
          <DropdownMenuSeparator />
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Palette aria-hidden="true" />
              {m.shell_theme()}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              <ThemeMenuItems />
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Languages aria-hidden="true" />
              {m.shell_language()}
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-52">
              <DropdownMenuRadioGroup value={locale} onValueChange={(value) => setLocale(value as Locale)}>
                {LOCALES.map((id) => (
                  <DropdownMenuRadioItem key={id} value={id} lang={id}>
                    {LOCALE_META[id].nativeName}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuContent>
      </DropdownMenu>
      {runner.dialog}
      <QuitDialog open={asking} onOpenChange={setAsking} />
    </>
  )
}

/** Toolbar Import…: the Import step page. */
function useImportAction(): Action {
  const m = useMessages()
  const navigate = useNavigate()
  return { id: "import", label: m.shell_import(), icon: Download, opensDialog: true, run: () => void navigate({ to: "/import" as never }) }
}

/** The palette field shows its whole label from 1200 px; below that an icon button with the same name. */
const WIDE_SEARCH = "(min-width: 1200px)"

// ---------------------------------------------------------------------------
// Route focus
// ---------------------------------------------------------------------------

/**
 * Route last shown by any app window, and a navigation whose focus move has
 * not run yet. Module-level, so a shell switch (not found -> page, setup ->
 * app) that unmounts one window and mounts another still completes it.
 */
let shownRoute: string | null = null
let pendingRoute: string | null = null

/** Where focus lands after a navigation: the URL's anchor, else the page h1, else #main. */
function routeFocusTarget(anchorId: string | null): HTMLElement | null {
  const anchor = anchorId ? document.getElementById(anchorId) : null
  const main = document.getElementById("main")
  const target = anchor ?? main?.querySelector<HTMLElement>("h1") ?? main
  if (target && !target.hasAttribute("tabindex") && target.tabIndex < 0) target.setAttribute("tabindex", "-1")
  return target
}

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

// ---------------------------------------------------------------------------
// Windows
// ---------------------------------------------------------------------------

/** The app window: source list, toolbar, content and status bar. */
function AppWindow({ children }: { children: ReactNode }) {
  const m = useMessages()
  const { sidebarCollapsed } = useShellUi()
  const announcement = useRouteFocus()
  const list = useSourceList()
  const checklistDue = useGettingStartedDue()
  const wideSearch = useMediaQuery(WIDE_SEARCH)
  const importAction = useImportAction()
  useRememberRecent()
  const contributedFooters = SHELLS.filter((shell) => shell.SidebarFooter)
  return (
    <AppFrame
      brand={{ name: m.app_name(), icon: Aperture }}
      collapsed={sidebarCollapsed}
      onToggleCollapsed={toggleSidebar}
      announcement={announcement}
      sidebar={{
        nav: ({ collapsed, onNavigate }) => <NavList label={m.shell_nav_main()} groups={list.main} current={list.current} holds={list.holds} collapsed={collapsed} onNavigate={onNavigate} />,
        footer:
          checklistDue || contributedFooters.length > 0
            ? ({ collapsed }) => (
                <>
                  <GettingStartedRing collapsed={collapsed} />
                  {contributedFooters.map((shell, index) => (shell.SidebarFooter ? <shell.SidebarFooter key={index} collapsed={collapsed} /> : null))}
                </>
              )
            : undefined,
        utilities: ({ collapsed, onNavigate }) => <NavList label={m.shell_nav_utilities()} groups={list.utilities} current={list.current} collapsed={collapsed} onNavigate={onNavigate} />,
      }}
      toolbar={{
        leading: <HistoryControl />,
        center: <PaletteTrigger label={m.shell_search_or_jump()} shortcut={PALETTE_SHORTCUT} compact={!wideSearch} onOpen={() => openPanel("palette")} />,
        trailing: (
          <>
            <IssuesHub />
            <ActionButton action={importAction} />
            <MoreItems />
          </>
        ),
      }}
      statusBar={<StatusBar />}
    >
      {children}
      <OrientationWalk />
    </AppFrame>
  )
}

export function AppShell() {
  return (
    <AppWindow>
      <Outlet />
    </AppWindow>
  )
}

/** Unknown route: say what happened and offer the home surface, inside the app window. */
export function NotFoundPage() {
  const m = useMessages()
  const navigate = useNavigate()
  useDocumentTitle(m.shell_not_found_doc_title())
  return (
    <AppWindow>
      <EmptyState
        icon={MapPinOff}
        title={m.shell_not_found_title()}
        titleAs="h1"
        className="m-auto max-w-lg flex-none"
        action={<ActionButton action={{ id: "go-home", label: m.shell_not_found_home(), kind: "primary", run: () => void navigate({ to: "/" }) }} />}
      />
    </AppWindow>
  )
}

/** First-run setup: no source list, one task at a time; the Prototype controls and the theme in the header. */
export function SetupShell() {
  const m = useMessages()
  const prototype: Action = { id: "prototype-controls", label: m.common_prototype(), icon: FlaskConical, run: () => openPanel("simulation") }
  return (
    <SetupFrame
      brand={{ name: m.app_name(), icon: Aperture }}
      actions={
        <>
          <ActionButton action={prototype} />
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />} data-theme-menu="">
              <Palette aria-hidden="true" data-icon="inline-start" />
              {m.shell_theme()}
              <ChevronDown aria-hidden="true" data-icon="inline-end" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <ThemeMenuItems />
            </DropdownMenuContent>
          </DropdownMenu>
        </>
      }
    >
      <Outlet />
    </SetupFrame>
  )
}
