/**
 * AppFrame and SetupFrame (L3 templates; plan §3.4, HARNESS-V4 "native
 * window"). The window is the layout: a full-height source list, a unified
 * toolbar over the content, one scrolling content pane and a status bar.
 * Only `MainArea` scrolls. The window is never smaller than the minimum
 * window (1280 × 640, Q35: `--window-min-w`, `--window-min-h`): below it the
 * page scrolls instead of reflowing.
 *
 * - Landmarks: the sidebar (`aside`, holding the navigation lists), the
 *   toolbar (`header`, banner), `main#main` and the status bar the host
 *   passes (`footer`, contentinfo). The skip link is the first stop and moves
 *   focus to main.
 * - Sidebar: 240 px, or a 48 px icon rail while `collapsed`. Below 768 px
 *   (WCAG 1.4.10 reflow) it leaves the window and opens as a drawer from the
 *   toolbar's leading button: a modal sheet that traps focus, closes on
 *   Escape, the backdrop or a followed link, and then returns focus to the
 *   button, or to the new page's heading after a link.
 * - Toolbar: the sidebar button, then `leading` (history), a `center` that
 *   takes the free width, and `trailing` (Issues, Import, search, More).
 * - `MainArea`: the one scroll container, with a polite live region that
 *   reads the host's route `announcement`.
 * - SetupFrame: first-run setup, one task at a time. A header with the app
 *   name and the host's `actions`, then `MainArea` around a centred column.
 *   No sidebar, toolbar or status bar.
 */
import type { LucideIcon } from "lucide-react"
import { PanelLeftClose, PanelLeftOpen } from "lucide-react"
import { type ReactNode, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { IconButton } from "@/components/app/actions"
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet"
import { useMediaQuery } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"

/** Below this width the sidebar is a drawer (1280 px at 200 % zoom stays usable). */
export const NARROW_QUERY = "(max-width: 767.98px)"

export interface AppBrand {
  name: string
  icon: LucideIcon
}

/** What a sidebar slot knows about where it renders. */
export interface SidebarContext {
  /** The icon rail: rows keep their names as tooltips. */
  collapsed: boolean
  /** In the drawer: call after a row navigates, so the drawer closes. */
  onNavigate?: () => void
}

export interface AppFrameSidebar {
  /** The source list (NavList); it takes the free height and scrolls. */
  nav: (context: SidebarContext) => ReactNode
  /** Above the utilities, e.g. the Getting started ChecklistRing. */
  footer?: (context: SidebarContext) => ReactNode
  /** The pinned rows at the bottom (Activity, Settings). */
  utilities: (context: SidebarContext) => ReactNode
}

export interface AppFrameToolbar {
  /** After the sidebar button: Back and Forward. */
  leading?: ReactNode
  /** The free width between leading and trailing. */
  center?: ReactNode
  /** The trailing controls. */
  trailing?: ReactNode
}

export interface AppFrameProps {
  brand: AppBrand
  sidebar: AppFrameSidebar
  /** The user's choice of the icon rail on wide windows; narrow windows use the drawer. */
  collapsed: boolean
  onToggleCollapsed: () => void
  toolbar: AppFrameToolbar
  /** The status bar (StatusBar, components/app/status-bar.tsx). */
  statusBar?: ReactNode
  /** Read once by the main area's polite live region after a route change: the new page's title. */
  announcement?: string
  /**
   * The design-system catalogue only: the frame as a 30rem box inside the page, with no skip link and
   * no `main#main` of its own (the page already has them); `narrow` shows the drawer layout at any width.
   */
  specimen?: { narrow?: boolean }
  children: ReactNode
}

/** The window's height, at least the minimum window, or a fixed box for a catalogue specimen. */
function frameClass(specimen: boolean): string {
  return specimen ? "flex h-120 flex-col overflow-hidden rounded-lg border border-border" : "flex h-dvh min-h-(--window-min-h) min-w-(--window-min-w) flex-col overflow-hidden"
}

/** The first stop of the window: moves focus to main, so the source list and toolbar can be skipped (WCAG 2.4.1). */
function SkipLink() {
  const m = useMessages()
  return (
    <a
      href="#main"
      onClick={(event) => {
        event.preventDefault()
        document.getElementById("main")?.focus()
      }}
      className="sr-only z-overlay rounded-md bg-primary px-3 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      data-skip-link=""
    >
      {m.shell_skip_to_content()}
    </a>
  )
}

/** The single scroll container; the skip link targets it. Its scroll padding leaves a shown SelectionBar's height free (`--selection-bar-h`). A specimen renders it as a plain box. */
export function MainArea({ announcement = "", specimen = false, children }: { announcement?: string; specimen?: boolean; children: ReactNode }) {
  const className = "relative flex min-h-0 flex-1 flex-col scroll-pb-(--selection-bar-h) overflow-y-auto outline-none"
  if (specimen) return <div className={className}>{children}</div>
  return (
    <main id="main" tabIndex={-1} className={className}>
      <p className="sr-only" aria-live="polite" data-route-announcer="">
        {announcement}
      </p>
      {children}
    </main>
  )
}

function BrandRow({ brand, collapsed }: { brand: AppBrand; collapsed: boolean }) {
  const Icon = brand.icon
  return (
    <div data-chrome className={cn("flex h-10 shrink-0 items-center gap-2 px-3", collapsed && "justify-center px-0")}>
      <Icon aria-hidden="true" className="size-4.5 shrink-0 text-link" />
      <span className={collapsed ? "sr-only" : "text-sm font-semibold"}>{brand.name}</span>
    </div>
  )
}

function SidebarBody({ brand, sidebar, context }: { brand: AppBrand; sidebar: AppFrameSidebar; context: SidebarContext }) {
  const footer = sidebar.footer?.(context)
  return (
    <>
      <BrandRow brand={brand} collapsed={context.collapsed} />
      <div className="flex min-h-0 flex-1 flex-col" data-frame-nav="">
        {sidebar.nav(context)}
      </div>
      <div data-chrome className="flex shrink-0 flex-col border-t border-sidebar-border" data-frame-utilities="">
        {footer ? <div className="flex flex-col gap-px px-2 pt-2">{footer}</div> : null}
        {sidebar.utilities(context)}
      </div>
    </>
  )
}

/** Where focus lands after the drawer closed on a followed link: the new page's heading, else main. */
function pageHeading(): HTMLElement | null {
  const main = document.getElementById("main")
  const heading = main?.querySelector<HTMLElement>("h1") ?? null
  if (heading && !heading.hasAttribute("tabindex")) heading.setAttribute("tabindex", "-1")
  return heading ?? main
}

/** The labelled sidebar as a drawer below 768 px, opened from the toolbar's leading button. */
function SidebarDrawer({ brand, sidebar }: { brand: AppBrand; sidebar: AppFrameSidebar }) {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  const navigated = useRef(false)
  const close = () => {
    navigated.current = true
    setOpen(false)
  }
  return (
    <>
      <IconButton
        label={m.shell_navigation_open()}
        icon={PanelLeftOpen}
        aria-expanded={open}
        onClick={() => {
          navigated.current = false
          setOpen(true)
        }}
        data-drawer-trigger=""
      />
      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="left" className="w-64 gap-0 bg-sidebar p-0 text-sidebar-foreground" finalFocus={() => (navigated.current ? (pageHeading() ?? true) : true)} data-drawer="">
          <SheetTitle className="sr-only">{m.shell_navigation()}</SheetTitle>
          <SidebarBody brand={brand} sidebar={sidebar} context={{ collapsed: false, onNavigate: close }} />
        </SheetContent>
      </Sheet>
    </>
  )
}

export function AppFrame({ brand, sidebar, collapsed, onToggleCollapsed, toolbar, statusBar, announcement, specimen, children }: AppFrameProps) {
  const m = useMessages()
  const narrowWindow = useMediaQuery(NARROW_QUERY)
  const narrow = specimen?.narrow ?? narrowWindow
  const rail = narrow || collapsed
  return (
    <div className={frameClass(specimen !== undefined)} data-frame="app">
      {specimen ? null : <SkipLink />}
      <div className="flex min-h-0 flex-1">
        {narrow ? null : (
          <aside aria-label={m.shell_sidebar()} className={cn("flex shrink-0 flex-col border-r border-separator bg-sidebar text-sidebar-foreground", rail ? "w-12" : "w-60")} data-sidebar={rail ? "rail" : "full"}>
            <SidebarBody brand={brand} sidebar={sidebar} context={{ collapsed: rail }} />
          </aside>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <header data-chrome className="z-shell flex h-10 min-w-0 shrink-0 flex-nowrap items-center gap-1.5 border-b border-separator bg-chrome px-2">
            {narrow ? (
              <SidebarDrawer brand={brand} sidebar={sidebar} />
            ) : (
              <IconButton label={collapsed ? m.shell_sidebar_show() : m.shell_sidebar_hide()} icon={collapsed ? PanelLeftOpen : PanelLeftClose} shortcut="[" onClick={onToggleCollapsed} data-sidebar-toggle="" />
            )}
            {toolbar.leading}
            <div className="flex min-w-0 flex-1 items-center justify-center gap-1.5" data-toolbar-center="">
              {toolbar.center}
            </div>
            {toolbar.trailing}
          </header>
          <MainArea announcement={announcement} specimen={specimen !== undefined}>
            {children}
          </MainArea>
        </div>
      </div>
      {statusBar}
    </div>
  )
}

export interface SetupFrameProps {
  brand: AppBrand
  /** Trailing header controls: the Prototype controls, the theme. */
  actions?: ReactNode
  /** The design-system catalogue only: a fixed box with no skip link and no `main#main`. */
  specimen?: boolean
  /** The setup step page. */
  children: ReactNode
}

/** First-run setup (plan §5.2 Setup): the app name, the host's actions, and one centred step page. */
export function SetupFrame({ brand, actions, specimen = false, children }: SetupFrameProps) {
  const Icon = brand.icon
  return (
    <div className={frameClass(specimen)} data-frame="setup">
      {specimen ? null : <SkipLink />}
      <header data-chrome className="flex h-11 shrink-0 items-center gap-2 border-b border-separator px-4">
        <Icon aria-hidden="true" className="size-5 text-primary" />
        <span className="font-semibold">{brand.name}</span>
        <div className="flex flex-1 items-center justify-end gap-2">{actions}</div>
      </header>
      <MainArea specimen={specimen}>
        <div className="mx-auto flex w-full max-w-4xl flex-1 flex-col">{children}</div>
      </MainArea>
    </div>
  )
}
