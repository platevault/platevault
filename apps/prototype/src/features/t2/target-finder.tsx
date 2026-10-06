/**
 * Target finder (harness v4): a compact source list of Targets beside the
 * Target detail, replacing the full-width Targets table and D's sky-first
 * landing. Search by name, alias or RA Dec (°), a Show filter and dense
 * one-line rows: name, first alias, Needs review and Planned glyphs, and
 * captured integration. The query lives in the URL (`q`, `show`) on both
 * `/targets` and `/targets/$targetId`, so opening a Target keeps the list.
 *
 * Keyboard: ↑/↓, Home and End move between rows; Enter opens; Shift+F10 or
 * the Menu key opens the row's context menu (Open, Plan, Create View, New
 * Project), each of which is also on the Target's own header.
 */
import { Link, useNavigate, useRouterState, useSearch } from "@tanstack/react-router"
import { CalendarClock, Search, TriangleAlert } from "lucide-react"
import { type KeyboardEvent, type MouseEvent, type ReactNode, useId, useState } from "react"
import { ListDetail } from "@/components/app/page"
import { ContextMenu, ContextMenuContent, ContextMenuGroup, ContextMenuItem, ContextMenuLabel, ContextMenuSeparator, ContextMenuTrigger } from "@/components/ui/context-menu"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDegrees, formatDuration, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { SearchParams } from "@/routes"
import { useStore } from "@/store/core"
import { COORDINATE_SEARCH_RADIUS_DEG, parseCoordinates, searchTargets, targetSummary } from "./model"

const SHOW = [
  { value: "all", label: "All Targets" },
  { value: "captured", label: "With captures" },
  { value: "planned", label: "Planned" },
  { value: "needs-review", label: "Needs review" },
] as const

/** Finder search keys carried on every Target link, so the list survives navigation. */
function finderSearch(search: SearchParams): SearchParams {
  const kept: SearchParams = {}
  if (search.q) kept.q = search.q
  if (search.show && search.show !== "all") kept.show = search.show
  return kept
}

export function TargetFinder({ activeId }: { activeId: string | null }) {
  const search = useSearch({ strict: false }) as SearchParams
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const navigate = useNavigate()
  const query = search.q ?? ""
  const show = search.show ?? "all"
  const summaries = useStore((s) => Object.values(s.catalog.targets).map((t) => targetSummary(s, t)))
  const showId = useId()
  const [menuId, setMenuId] = useState<string | null>(null)

  function setParams(patch: SearchParams) {
    // The finder lives on two routes; stay on whichever one is open.
    navigate({
      to: pathname,
      search: (previous: SearchParams) => {
        const next: SearchParams = { ...previous, ...patch }
        for (const key of Object.keys(next)) if (!next[key] || next[key] === "all") delete next[key]
        return next
      },
      replace: true,
    } as never)
  }

  const coords = parseCoordinates(query)
  const rows = searchTargets(summaries, query)
    .filter((s) => {
      if (show === "captured") return s.breakdown.captured.frames > 0
      if (show === "planned") return s.planned
      if (show === "needs-review") return s.needsReview > 0
      return true
    })
    .sort((a, b) => (coords ? (a.separationDeg ?? 0) - (b.separationDeg ?? 0) : b.breakdown.captured.seconds - a.breakdown.captured.seconds))
  const keep = finderSearch(search)
  const menuRow = menuId ? summaries.find((s) => s.target.id === menuId) : undefined

  function onKeyDown(event: KeyboardEvent<HTMLUListElement>) {
    const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>("a[data-finder-row]"))
    const at = links.indexOf(document.activeElement as HTMLAnchorElement)
    const to = event.key === "ArrowDown" ? at + 1 : event.key === "ArrowUp" ? at - 1 : event.key === "Home" ? 0 : event.key === "End" ? links.length - 1 : null
    if (to === null || at === -1) return
    event.preventDefault()
    links[Math.max(0, Math.min(links.length - 1, to))]?.focus()
  }

  function onContextMenu(event: MouseEvent) {
    const id = (event.target as HTMLElement).closest("[data-target-id]")?.getAttribute("data-target-id") ?? null
    if (id === null) event.stopPropagation()
    else setMenuId(id)
  }

  return (
    <div className="flex min-h-full flex-col" data-chrome>
      <div className="sticky top-0 z-10 space-y-1.5 border-b border-separator bg-background px-2 py-2">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            data-page-search
            type="search"
            aria-label="Search Targets"
            placeholder="Name, alias, or RA Dec (°)"
            value={query}
            onChange={(event) => setParams({ q: event.target.value })}
            className="pl-7"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Label id={showId} className="text-xs text-muted-foreground">
            Show
          </Label>
          <Select items={SHOW} value={show} onValueChange={(value) => setParams({ show: value as string })}>
            <SelectTrigger size="sm" aria-labelledby={showId} className="min-w-0 flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SHOW.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <p className="text-[0.6875rem] text-muted-foreground tabular-nums" aria-live="polite">
          {coords ? `${plural(rows.length, "Target")} within ${COORDINATE_SEARCH_RADIUS_DEG}° of RA ${coords.ra}°, Dec ${coords.dec}°, nearest first` : plural(rows.length, "matching Target")}
        </p>
      </div>
      {rows.length === 0 ? (
        <div className="space-y-2 px-3 py-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">{query ? `No Target matches “${query}”` : "No Target matches this filter"}</p>
          <p>
            {coords
              ? `No local Target lies within ${COORDINATE_SEARCH_RADIUS_DEG}° of these coordinates. Search uses local records only.`
              : "Search matches local Target names and aliases, or RA and Dec in degrees."}
          </p>
          <button type="button" className="text-link hover:underline" onClick={() => setParams({ q: undefined, show: undefined })}>
            Clear search and filter
          </button>
        </div>
      ) : (
        <ContextMenu>
          <ContextMenuTrigger render={<ul aria-label="Targets" className="py-1" onKeyDown={onKeyDown} onContextMenu={onContextMenu} />}>
            {rows.map((r) => {
              const active = r.target.id === activeId
              const alias = r.target.aliases[0]
              return (
                <li key={r.target.id} data-target-id={r.target.id}>
                  <Link
                    data-finder-row
                    to="/targets/$targetId"
                    params={{ targetId: r.target.id }}
                    search={keep}
                    aria-current={active ? "page" : undefined}
                    title={[r.target.name, ...r.target.aliases.slice(0, 2)].join(" · ")}
                    className={cn(
                      "mx-1 flex h-(--row-h) items-center gap-1.5 rounded-[0.3125rem] px-2 text-sm hover:bg-foreground/[0.06]",
                      active && "bg-selected text-selected-foreground hover:bg-selected [&_svg]:text-selected-foreground [&_.text-muted-foreground]:text-selected-foreground/85",
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate">
                      <span className="font-medium">{r.target.name}</span>
                      {alias ? <span className="ml-1 text-xs text-muted-foreground"> {alias}</span> : null}
                    </span>
                    {r.needsReview > 0 ? (
                      <>
                        <TriangleAlert aria-hidden="true" className="size-3 shrink-0 text-warning" />
                        <span className="sr-only">, {plural(r.needsReview, "session")} {r.needsReview === 1 ? "needs" : "need"} review</span>
                      </>
                    ) : null}
                    {r.planned ? (
                      <>
                        <CalendarClock aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
                        <span className="sr-only">, Planned</span>
                      </>
                    ) : null}
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      <span className="sr-only">, captured </span>
                      {coords ? `${formatDegrees(r.separationDeg ?? 0)} away` : formatDuration(r.breakdown.captured.seconds)}
                    </span>
                  </Link>
                </li>
              )
            })}
          </ContextMenuTrigger>
          <ContextMenuContent>
            {menuRow ? (
              <ContextMenuGroup>
                <ContextMenuLabel>{menuRow.target.name}</ContextMenuLabel>
                <ContextMenuItem onClick={() => void navigate({ to: "/targets/$targetId", params: { targetId: menuRow.target.id }, search: keep })}>Open</ContextMenuItem>
                <ContextMenuItem onClick={() => void navigate({ to: "/targets/$targetId/plan", params: { targetId: menuRow.target.id } })}>Plan</ContextMenuItem>
                <ContextMenuSeparator />
                <ContextMenuItem onClick={() => void navigate({ to: "/views/new", search: { from: "target", targetId: menuRow.target.id } })}>Create View</ContextMenuItem>
                <ContextMenuItem onClick={() => void navigate({ to: "/projects/new", search: { targetId: menuRow.target.id } })}>New Project</ContextMenuItem>
              </ContextMenuGroup>
            ) : null}
          </ContextMenuContent>
        </ContextMenu>
      )}
    </div>
  )
}

/** The finder beside the Target detail (or the library overview on `/targets`). */
export function TargetsLayout({ activeId, children }: { activeId: string | null; children: ReactNode }) {
  return (
    <ListDetail listLabel="Target finder" list={<TargetFinder activeId={activeId} />} detail={children} className="grid-cols-[15rem_minmax(0,1fr)] xl:grid-cols-[17rem_minmax(0,1fr)]" />
  )
}
