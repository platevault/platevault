/**
 * Target finder (harness v2, HARNESS-V2.md §Target finder): the source list's
 * Targets panel. A filter field over dense one-line rows (name, channels,
 * captured integration, a review glyph), so finding NGC 7000 is "f, type, ↓,
 * Enter" and the list never grows into a sky-first landing page. The panel
 * header links to the full Targets table.
 */
import { Link, useRouterState } from "@tanstack/react-router"
import { ChevronDown, ChevronRight, Search, TriangleAlert } from "lucide-react"
import { type KeyboardEvent, useId, useMemo, useState } from "react"
import { useStoredState } from "@/components/app/studio"
import { targetCoverage } from "@/domain/derive"
import { formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useStore } from "@/store/core"

export function TargetFinder() {
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const [open, setOpen] = useStoredState<boolean>("nav.targets", true)
  const [query, setQuery] = useState("")
  const listId = useId()
  const fieldId = useId()

  const rows = useMemo(
    () =>
      Object.values(catalog.targets)
        .map((target) => {
          const coverage = targetCoverage(disk, catalog, target.id)
          return {
            target,
            channels: coverage.channels.map((c) => c.channel),
            seconds: coverage.channels.reduce((sum, c) => sum + c.breakdown.captured.seconds, 0),
            review: coverage.needsReview.length,
          }
        })
        .sort((a, b) => a.target.name.localeCompare(b.target.name, undefined, { numeric: true })),
    [catalog, disk],
  )
  const needle = query.trim().toLowerCase()
  const shown = needle ? rows.filter((r) => [r.target.name, ...r.target.aliases].some((n) => n.toLowerCase().includes(needle))) : rows

  function moveFocus(event: KeyboardEvent<HTMLElement>) {
    const links = Array.from(document.getElementById(listId)?.querySelectorAll<HTMLElement>("a") ?? [])
    const index = links.indexOf(document.activeElement as HTMLElement)
    if (event.key === "ArrowDown") {
      event.preventDefault()
      links[Math.min(links.length - 1, index + 1)]?.focus()
    } else if (event.key === "ArrowUp") {
      event.preventDefault()
      if (index <= 0) document.getElementById(fieldId)?.focus()
      else links[index - 1]?.focus()
    } else if (event.key === "Escape" && query) {
      event.preventDefault()
      setQuery("")
      document.getElementById(fieldId)?.focus()
    }
  }

  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <section aria-labelledby={`${listId}-title`} className="py-1">
      <div className="flex h-6 items-center pr-1.5">
        <h2 id={`${listId}-title`} className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${listId}-body`}
            onClick={() => setOpen(!open)}
            data-inset-focus=""
            className="flex h-6 w-full items-center gap-1 rounded-sm pl-2 text-left outline-none"
          >
            <Chevron aria-hidden="true" className="size-3 text-muted-foreground" />
            <span className="panel-title">Targets</span>
            <span className="num ml-1 text-2xs text-muted-foreground">{rows.length}</span>
          </button>
        </h2>
        <Link to="/targets" className="rounded-sm px-1.5 text-2xs text-muted-foreground hover:text-foreground data-[status=active]:text-primary">
          All Targets
        </Link>
      </div>
      <div id={`${listId}-body`} hidden={!open} className="space-y-0.5 px-1.5 pt-0.5">
        <div className="relative">
          <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-1.5 size-3 -translate-y-1/2 text-muted-foreground" />
          <input
            id={fieldId}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={moveFocus}
            data-target-finder=""
            aria-label="Find a Target"
            aria-controls={listId}
            autoComplete="off"
            className="h-6 w-full rounded-md border border-input bg-raised pr-1.5 pl-5.5 text-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring dark:bg-canvas"
            placeholder="Find a Target…"
          />
        </div>
        <ul id={listId} aria-label="Targets" className="max-h-[11.5rem] overflow-y-auto" onKeyDown={moveFocus}>
          {shown.map((row) => {
            const to = `/targets/${row.target.id}`
            const current = pathname === to || pathname.startsWith(`${to}/`)
            return (
              <li key={row.target.id}>
                <Link
                  to="/targets/$targetId"
                  params={{ targetId: row.target.id }}
                  aria-current={current ? "page" : undefined}
                  data-inset-focus=""
                  className={cn(
                    "group flex h-6 items-center gap-1.5 rounded-sm px-1.5 text-xs text-sidebar-foreground outline-none hover:bg-hover",
                    current && "bg-selected text-selected-foreground hover:bg-selected",
                  )}
                >
                  <span className="min-w-0 flex-1 truncate">
                    <span className="font-medium">{row.target.name}</span>
                    {row.channels.length ? <span className="ml-1.5 text-2xs text-muted-foreground group-aria-[current=page]:text-selected-foreground/80">{row.channels.join(" · ")}</span> : null}
                  </span>
                  {row.review ? (
                    <span className="flex items-center text-warning" title={`${row.review} needs review`}>
                      <TriangleAlert aria-hidden="true" className="size-3" />
                      <span className="sr-only">{row.review} session needs review</span>
                    </span>
                  ) : null}
                  <span className="num shrink-0 text-2xs text-muted-foreground group-aria-[current=page]:text-selected-foreground/80">
                    {row.seconds ? formatDuration(row.seconds) : "–"}
                    <span className="sr-only"> captured</span>
                  </span>
                </Link>
              </li>
            )
          })}
          {shown.length === 0 ? <li className="px-1.5 py-1 text-xs text-muted-foreground">No Target matches “{query.trim()}”.</li> : null}
        </ul>
      </div>
    </section>
  )
}
