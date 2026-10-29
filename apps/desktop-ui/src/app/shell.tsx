/**
 * The app shell (shell-owned): the root layout, the app window and the
 * surfaces for an unknown route and a failed one. The look lives in the
 * templates (`@/components/templates/app-frame`); this file wires the source
 * list, the toolbar and the status bar to the router and the library reads.
 *
 * - Root: the global shortcuts, the live region, toasts, the command
 *   palette, the keyboard help, the native menu, tray and Quit host
 *   (`NativeShellHost`, api/native-shell-host.tsx) and each contributed
 *   overlay.
 * - Source list (NavList): Home, Projects, Targets, then Library (Sessions,
 *   Calibration); Activity and Settings in the footer. A row shows once its
 *   page's route is registered (navigation.ts). Sessions and Projects carry
 *   a badge with the issues on their pages (`libraryIssues`).
 * - Toolbar: the sidebar button, Back and Forward, the palette field,
 *   Import… (once `/import` is registered) and More ▾ (the app Actions the
 *   palette also lists, then the Theme choices). Quit is the native menu's
 *   and the tray's: the host asks first while work runs (D-W157).
 * - Errors: a page that fails to render shows why inside the window, with
 *   Retry; a failure of the window itself shows in the bare frame, with
 *   Reload. Neither discards library state.
 */
import { type ErrorComponentProps, Outlet, useRouter, useRouterState } from "@tanstack/react-router"
import { Aperture, ChevronDown, Download, MapPinOff, Palette, RotateCw, TriangleAlert } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { NativeShellHost } from "@/api/native-shell-host"
import { ActionButton, MenuItems, useAction } from "@/components/app/actions"
import type { Action } from "@/components/app/contracts"
import { EmptyState, LiveAnnouncer } from "@/components/app/feedback"
import { type NavBadge, type NavListGroup, type NavListItem, NavList } from "@/components/app/nav-list"
import { useDocumentTitle } from "@/components/app/page"
import { PaletteTrigger } from "@/components/app/palette"
import { ThemeMenuItems } from "@/components/app/theme-picker"
import { AppFrame, SetupFrame } from "@/components/templates/app-frame"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubContent, DropdownMenuSubTrigger, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Toaster } from "@/components/ui/toast"
import { TooltipProvider } from "@/components/ui/tooltip"
import type { IssueView } from "@/api/ipc"
import { useMediaQuery } from "@/lib/use-media-query"
import { CommandPalette, useAppActions } from "./command-palette"
import { SHELLS } from "./contributions"
import { HistoryControl } from "./history"
import { NAV_GROUPS, type NavItem, PRIMARY_ITEMS, UTILITY_ITEMS, useRoutable } from "./navigation"
import { useMessages } from "./preferences"
import { PALETTE_SHORTCUT, ShortcutsDialog, useGlobalShortcuts } from "./shortcuts"
import { StatusBar, useLibraryIssues } from "./status-bar"
import { openPanel, toggleSidebar, useShellUi } from "./ui-state"

/** The palette field shows its whole label from 1200 px; below that an icon button with the same name. */
const WIDE_SEARCH = "(min-width: 1200px)"

export function RootLayout() {
  useGlobalShortcuts()
  return (
    <TooltipProvider delay={400}>
      <LiveAnnouncer />
      <Toaster />
      <Outlet />
      <CommandPalette />
      <ShortcutsDialog />
      <NativeShellHost />
      {SHELLS.map((shell, index) => (shell.Overlay ? <shell.Overlay key={index} /> : null))}
    </TooltipProvider>
  )
}

// ---------------------------------------------------------------------------
// Source list
// ---------------------------------------------------------------------------

interface SourceList {
  main: NavListGroup[]
  utilities: NavListGroup[]
  current: string | null
}

/** How many issues are on the Sessions page and on Projects' pages, every severity together. */
function issueBadgeCounts(view: IssueView | undefined): { sessions: number; projects: number } {
  const pages = view?.pages ?? []
  const sum = (kind: "sessions" | "project") => pages.filter((page) => page.page.kind === kind).reduce((total, page) => total + page.count, 0)
  return { sessions: sum("sessions"), projects: sum("project") }
}

/** The source list's registered rows and which one is the page: the deepest that holds the path. */
function useSourceList(): SourceList {
  const m = useMessages()
  const routable = useRoutable()
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const counts = issueBadgeCounts(useLibraryIssues().data)
  const badges: Record<string, NavBadge | undefined> = {
    "/sessions": counts.sessions > 0 ? { count: counts.sessions, label: m.shell_nav_sessions_badge({ count: counts.sessions }), tone: "warning" } : undefined,
    "/projects": counts.projects > 0 ? { count: counts.projects, label: m.shell_nav_projects_badge({ count: counts.projects }), tone: "warning" } : undefined,
  }
  const rows = (items: NavItem[]): NavListItem[] =>
    items.filter((item) => routable(item.to)).map((item) => ({ id: item.to, label: item.label, icon: item.icon, link: { to: item.to }, badge: badges[item.to] }))
  const within = (to: string) => (to === "/" ? pathname === "/" : pathname === to || pathname.startsWith(`${to}/`))
  const destinations = [...PRIMARY_ITEMS, ...NAV_GROUPS.flatMap((group) => group.items), ...UTILITY_ITEMS].filter((item) => routable(item.to))
  const deepest = destinations.filter((item) => within(item.to)).sort((a, b) => b.to.length - a.to.length)[0]
  const groups: NavListGroup[] = [{ id: "primary", items: rows(PRIMARY_ITEMS) }, ...NAV_GROUPS.map((group) => ({ id: group.label, heading: group.label, items: rows(group.items) }))]
  return {
    main: groups.filter((group) => group.items.length > 0),
    utilities: [{ id: "utilities", items: rows(UTILITY_ITEMS) }].filter((group) => group.items.length > 0),
    current: deepest?.to ?? null,
  }
}

// ---------------------------------------------------------------------------
// Toolbar
// ---------------------------------------------------------------------------

/** More ▾: the app Actions (the palette lists the same descriptors), then the Theme choices. */
function MoreItems() {
  const m = useMessages()
  const runner = useAction()
  const actions = useAppActions().filter((action) => action.id !== "theme")
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="outline" size="sm" />} data-more-menu="">
          {m.common_more()}
          <ChevronDown aria-hidden="true" data-icon="inline-end" />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          <MenuItems items={actions} runner={runner} />
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
        </DropdownMenuContent>
      </DropdownMenu>
      {runner.feedback}
      {runner.dialog}
    </>
  )
}

/** Toolbar Import…: the Import step page, once it is registered. */
function ToolbarImport() {
  const m = useMessages()
  const router = useRouter()
  const routable = useRoutable()
  if (!routable("/import")) return null
  const action: Action = { id: "import", label: m.shell_import(), icon: Download, opensDialog: true, run: () => router.history.push("/import") }
  return <ActionButton action={action} />
}

// ---------------------------------------------------------------------------
// Route focus
// ---------------------------------------------------------------------------

/**
 * Route last shown by any app window, and a navigation whose focus move has
 * not run yet. Module-level, so a switch between windows (not found to a
 * page) that unmounts one window and mounts another still completes it.
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

/** How long a closing dialog may take to hand focus back to its opener before the route takes it. */
const CLOSE_TRANSITION_MS = 450

/**
 * After a route change (WCAG 2.4.3, 4.1.3): when the activated control went
 * away with the old page, focus moves to the URL's anchor, else the page h1,
 * else #main. A control that survives the change (a sidebar row) keeps
 * focus. The new document title is announced either way. Search-param
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
    // A closing dialog (the palette) restores focus to its trigger after its exit transition; if that trigger is gone, take focus back.
    const late = window.setTimeout(() => moveFocus(false), CLOSE_TRANSITION_MS)
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
  const wideSearch = useMediaQuery(WIDE_SEARCH)
  const footers = SHELLS.filter((shell) => shell.SidebarFooter)
  return (
    <AppFrame
      brand={{ name: m.app_name(), icon: Aperture }}
      collapsed={sidebarCollapsed}
      onToggleCollapsed={toggleSidebar}
      announcement={announcement}
      sidebar={{
        nav: ({ collapsed, onNavigate }) => <NavList label={m.shell_nav_main()} groups={list.main} current={list.current} collapsed={collapsed} onNavigate={onNavigate} />,
        footer: footers.length > 0 ? ({ collapsed }) => footers.map((shell, index) => (shell.SidebarFooter ? <shell.SidebarFooter key={index} collapsed={collapsed} /> : null)) : undefined,
        utilities: ({ collapsed, onNavigate }) =>
          list.utilities.length > 0 ? <NavList label={m.shell_nav_utilities()} groups={list.utilities} current={list.current} collapsed={collapsed} onNavigate={onNavigate} /> : null,
      }}
      toolbar={{
        leading: <HistoryControl />,
        center: <PaletteTrigger label={m.shell_search_or_jump_ellipsis()} shortcut={PALETTE_SHORTCUT} compact={!wideSearch} onOpen={() => openPanel("palette")} />,
        trailing: (
          <>
            <ToolbarImport />
            <MoreItems />
          </>
        ),
      }}
      statusBar={<StatusBar />}
    >
      {children}
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

/** Unknown route: say so inside the app window and offer Home, or the palette while Home is not registered. */
export function NotFoundPage() {
  const m = useMessages()
  const router = useRouter()
  const routable = useRoutable()
  useDocumentTitle(m.shell_not_found_doc_title())
  const next: Action = routable("/")
    ? { id: "go-home", label: m.shell_not_found_home(), kind: "primary", run: () => router.history.push("/") }
    : { id: "open-palette", label: m.shell_not_found_search_action(), kind: "primary", run: () => openPanel("palette") }
  return (
    <AppWindow>
      <EmptyState icon={MapPinOff} title={m.shell_not_found_title()} titleAs="h1" className="m-auto max-w-lg flex-none" action={<ActionButton action={next} />} />
    </AppWindow>
  )
}

/** Logs a render failure for diagnosis; its English never reaches the window. */
function useReported(error: unknown) {
  useEffect(() => {
    console.error("PlateVault could not render this view", error)
  }, [error])
}

/** A page that failed to render, inside the app window: what happened, and Retry. */
export function RouteErrorPage({ error, reset }: ErrorComponentProps) {
  const m = useMessages()
  const router = useRouter()
  useReported(error)
  useDocumentTitle(m.shell_error_doc_title())
  const retry: Action = {
    id: "retry-route",
    label: m.verb_retry(),
    icon: RotateCw,
    kind: "primary",
    run: () => {
      reset()
      void router.invalidate()
    },
  }
  return <EmptyState icon={TriangleAlert} title={m.shell_error_title()} description={m.shell_error_body()} titleAs="h1" className="m-auto max-w-lg flex-none" action={<ActionButton action={retry} />} />
}

/** The window itself failed to render: the bare frame says so, with Reload. */
export function ShellErrorPage({ error }: ErrorComponentProps) {
  const m = useMessages()
  useReported(error)
  useDocumentTitle(m.shell_error_doc_title())
  const reload: Action = { id: "reload-window", label: m.shell_error_reload(), icon: RotateCw, kind: "primary", run: () => window.location.reload() }
  return (
    <SetupFrame brand={{ name: m.app_name(), icon: Aperture }}>
      <EmptyState icon={TriangleAlert} title={m.shell_error_title()} description={m.shell_error_body()} titleAs="h1" className="m-auto max-w-lg flex-none" action={<ActionButton action={reload} />} />
    </SetupFrame>
  )
}
