/**
 * NavList (plan §3.3 P14): the one source list, for the sidebar and the
 * Settings section list. The host passes groups of rows and the id of the
 * current row; NavList owns the row look and its states.
 *
 * - **Current:** the one row the host names takes the selected fill and
 *   `aria-current="page"`. The host decides which row is deepest (a Recent
 *   Project row while its Project is open), because TanStack Link would mark
 *   every active ancestor as the page.
 * - **Holds:** a row whose menu contains the current row, or that the host
 *   names in `holds`, keeps a left accent bar and semibold text (A SH2), so
 *   the selection's section stays visible without a second fill.
 * - **Menu rows** (Recent › Projects, Sessions, Targets; A SH3) open a named
 *   menu of links to the side instead of growing the list, so the rows below
 *   never move.
 * - **Collapsed:** an icon rail. Each row keeps its accessible name, the
 *   badge becomes a dot, and a tooltip shows the name (T1, icon-only).
 */
import { createLink } from "@tanstack/react-router"
import { ChevronRight, type LucideIcon } from "lucide-react"
import { type AnchorHTMLAttributes, type ReactElement, type Ref, useId } from "react"
import { CountBadge } from "@/components/app/pill"
import type { Tone } from "@/components/app/status"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

/** A route of the router, as the host would pass it to `<Link>`. */
export interface NavTarget {
  to: string
  params?: Record<string, string>
  search?: Record<string, unknown>
}

export interface NavBadge {
  count: number
  /** Screen-reader text, e.g. "3 need attention". */
  label: string
  tone?: Tone
}

interface NavRowBase {
  id: string
  label: string
  /** Required for the collapsed rail; Settings rows go without. */
  icon?: LucideIcon
}

/** A row that navigates. */
export interface NavLinkItem extends NavRowBase {
  link: NavTarget
  badge?: NavBadge
}

/** A row that opens a named menu of links beside the list. */
export interface NavMenuItem extends NavRowBase {
  items: NavLinkItem[]
}

export type NavListItem = NavLinkItem | NavMenuItem

export interface NavListGroup {
  id: string
  /** Group heading; the first group usually has none. In the rail a hairline replaces it. */
  heading?: string
  items: NavListItem[]
}

/** Sidebar rows sit on the sidebar tokens; Settings rows on the content background. */
export type NavSurface = "sidebar" | "content"

export interface NavListProps {
  /** The landmark's name: "Main", "Settings sections". */
  label: string
  groups: NavListGroup[]
  /** Id of the one current row, a link row or a menu's link; null when none is. */
  current: string | null
  /** Ids of rows that hold the current row although they do not contain it (Projects while a Recent Project is open). */
  holds?: string[]
  collapsed?: boolean
  surface?: NavSurface
  /** Runs after a row navigates: the narrow-viewport drawer closes. */
  onNavigate?: () => void
}

const ROW = "relative flex min-h-(--row-h) w-full cursor-default items-center gap-2 rounded-lg px-2 text-left text-sm [&>svg]:size-4 [&>svg]:shrink-0"

const SURFACE: Record<NavSurface, { rest: string; current: string; holds: string; rule: string; currentBadge: string }> = {
  sidebar: {
    rest: "text-sidebar-foreground hover:bg-sidebar-foreground/10 active:bg-sidebar-foreground/15 aria-expanded:bg-sidebar-foreground/10 [&>svg]:text-link",
    current: "bg-sidebar-primary font-semibold text-sidebar-primary-foreground hover:bg-sidebar-primary active:bg-sidebar-primary [&>svg]:text-sidebar-primary-foreground",
    holds: "font-semibold before:bg-sidebar-primary",
    rule: "bg-sidebar-border",
    currentBadge: "bg-sidebar-primary-foreground text-sidebar-primary",
  },
  content: {
    rest: "text-foreground hover:bg-foreground/10 active:bg-foreground/15 aria-expanded:bg-foreground/10 [&>svg]:text-link",
    current: "bg-selected font-semibold text-selected-foreground hover:bg-selected active:bg-selected [&>svg]:text-selected-foreground",
    holds: "font-semibold before:bg-selected",
    rule: "bg-border",
    currentBadge: "bg-selected-foreground text-selected",
  },
}

/** The holds bar: a 2 px accent at the row's leading edge. */
const HOLDS_BAR = "before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:rounded-full"

const DOT_TONE: Record<Tone, string> = {
  neutral: "bg-muted-foreground",
  muted: "bg-muted-foreground",
  info: "bg-info",
  success: "bg-success",
  warning: "bg-warning",
  danger: "bg-destructive",
}

/** The row look of every source-list row, the ChecklistRing trigger included. */
export function navRowClass({ surface = "sidebar", collapsed = false, current = false, holds = false }: { surface?: NavSurface; collapsed?: boolean; current?: boolean; holds?: boolean } = {}): string {
  const look = SURFACE[surface]
  return cn(ROW, look.rest, current && look.current, holds && [HOLDS_BAR, look.holds], collapsed && "justify-center px-0")
}

/** An anchor whose aria-current the row sets: TanStack Link would mark every active ancestor as the page. */
function NavAnchor({ current = false, ref, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { current?: boolean; ref?: Ref<HTMLAnchorElement> }) {
  return <a ref={ref} {...props} aria-current={current ? "page" : undefined} />
}

const NavRouterLink = createLink(NavAnchor)

function isMenu(item: NavListItem): item is NavMenuItem {
  return "items" in item
}

function shownBadge(badge: NavBadge | undefined): NavBadge | null {
  return badge && badge.count > 0 ? badge : null
}

/** In the rail the name moves to a tooltip on the right; expanded rows need none. */
function RailTip({ collapsed, label, children }: { collapsed: boolean; label: string; children: ReactElement }) {
  if (!collapsed) return children
  return (
    <Tooltip>
      <TooltipTrigger render={children} />
      <TooltipContent side="right">{label}</TooltipContent>
    </Tooltip>
  )
}

interface RowContext {
  current: string | null
  holds: ReadonlySet<string>
  collapsed: boolean
  surface: NavSurface
  onNavigate?: () => void
}

function LinkRow({ item, ctx }: { item: NavLinkItem; ctx: RowContext }) {
  const isCurrent = ctx.current === item.id
  const holds = !isCurrent && ctx.holds.has(item.id)
  const badge = shownBadge(item.badge)
  const Icon = item.icon
  const name = badge ? `${item.label}, ${badge.label}` : item.label
  return (
    <RailTip collapsed={ctx.collapsed} label={badge ? `${item.label} · ${badge.count}` : item.label}>
      <NavRouterLink
        to={item.link.to as never}
        params={item.link.params as never}
        search={item.link.search as never}
        current={isCurrent}
        onClick={ctx.onNavigate}
        aria-label={ctx.collapsed ? name : undefined}
        className={navRowClass({ surface: ctx.surface, collapsed: ctx.collapsed, current: isCurrent, holds })}
        data-nav-link
        data-nav-item={item.id}
        data-holds={holds || undefined}
      >
        {Icon ? <Icon aria-hidden="true" /> : null}
        {ctx.collapsed ? (
          badge ? (
            <span aria-hidden="true" className={cn("absolute top-0.5 right-1.5 size-1.5 rounded-full", isCurrent ? "bg-current" : DOT_TONE[badge.tone ?? "warning"])} />
          ) : null
        ) : (
          <>
            <span className="min-w-0 flex-1 truncate">{item.label}</span>
            {badge ? <CountBadge count={badge.count} tone={badge.tone ?? "warning"} label={badge.label} className={cn(isCurrent && SURFACE[ctx.surface].currentBadge)} /> : null}
          </>
        )}
      </NavRouterLink>
    </RailTip>
  )
}

function MenuRow({ item, ctx }: { item: NavMenuItem; ctx: RowContext }) {
  const holds = item.items.some((child) => child.id === ctx.current) || ctx.holds.has(item.id)
  const Icon = item.icon
  return (
    <DropdownMenu>
      <RailTip collapsed={ctx.collapsed} label={item.label}>
        <DropdownMenuTrigger
          className={navRowClass({ surface: ctx.surface, collapsed: ctx.collapsed, holds })}
          aria-label={ctx.collapsed ? item.label : undefined}
          data-nav-link
          data-nav-item={item.id}
          data-holds={holds || undefined}
        >
          {Icon ? <Icon aria-hidden="true" /> : null}
          {ctx.collapsed ? null : (
            <>
              <span className="min-w-0 flex-1 truncate">{item.label}</span>
              <ChevronRight aria-hidden="true" className="text-muted-foreground" />
            </>
          )}
        </DropdownMenuTrigger>
      </RailTip>
      <DropdownMenuContent side="right" align="start" className="w-56">
        {item.items.map((child) => {
          const ChildIcon = child.icon
          const isCurrent = child.id === ctx.current
          return (
            <DropdownMenuItem
              key={child.id}
              render={<NavRouterLink to={child.link.to as never} params={child.link.params as never} search={child.link.search as never} current={isCurrent} />}
              onClick={ctx.onNavigate}
              className={cn(isCurrent && "font-semibold")}
              data-nav-item={child.id}
            >
              {ChildIcon ? <ChildIcon aria-hidden="true" className="text-link" /> : null}
              <span className="min-w-0 flex-1 truncate">{child.label}</span>
            </DropdownMenuItem>
          )
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export function NavList({ label, groups, current, holds = [], collapsed = false, surface = "sidebar", onNavigate }: NavListProps) {
  const ctx: RowContext = { current, holds: new Set(holds), collapsed, surface, onNavigate }
  const look = SURFACE[surface]
  const uid = useId()
  return (
    <nav aria-label={label} data-chrome data-nav-list={surface} className={cn("flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2", collapsed && "gap-1")}>
      {groups.map((group) => {
        const headingId = group.heading ? `${uid}-${group.id}` : undefined
        return (
          <div key={group.id} className="flex flex-col gap-px">
            {group.heading ? (
              collapsed ? (
                <div aria-hidden="true" className={cn("mx-auto my-1 h-px w-6", look.rule)} />
              ) : (
                <div id={headingId} className="px-2 pb-0.5 text-xs font-semibold text-muted-foreground">
                  {group.heading}
                </div>
              )
            ) : null}
            <ul aria-labelledby={collapsed ? undefined : headingId} aria-label={collapsed ? group.heading : undefined} className="flex flex-col gap-px">
              {group.items.map((item) => (
                <li key={item.id}>{isMenu(item) ? <MenuRow item={item} ctx={ctx} /> : <LinkRow item={item} ctx={ctx} />}</li>
              ))}
            </ul>
          </div>
        )
      })}
    </nav>
  )
}
