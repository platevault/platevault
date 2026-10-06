/**
 * Recent sessions: the harness-v2 start page (HARNESS-V2.md §Start page).
 *
 * The first thing an imager wants after a night is to see what came in: the
 * newest sessions as plates on their mounts, newest night first, with the
 * session's facts and their sources in the inspector. It needs no planning
 * site and no Target decision, so it works on the first launch after indexing,
 * while a scan is still provisional, and for sessions without a Target yet.
 *
 * Interaction: one tab stop (listbox); arrows move the selection, Enter or a
 * double-click opens the session, the context menu holds the same commands.
 */
import { Link, useNavigate } from "@tanstack/react-router"
import { CalendarClock, Crosshair, ExternalLink, Hourglass, Layers, TriangleAlert, Unplug } from "lucide-react"
import { type KeyboardEvent, useMemo, useState } from "react"
import { EmptyState } from "@/components/app/feedback"
import { PageHeader } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Inspector, PanelSection, PaneToolbar, Plate, ValueList } from "@/components/app/studio"
import { Button } from "@/components/ui/button"
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu"
import { DropdownMenuItem, DropdownMenuSeparator, DropdownMenuShortcut } from "@/components/ui/dropdown-menu"
import { captureSite } from "@/domain/derive"
import { formatDuration, formatExposure, formatNight, plural } from "@/lib/format"
import { useStore } from "@/store/core"
import { type SessionRow, sessionRow, targetNeedsReview } from "../model"
import { SessionThumb } from "../session-thumb"

export function RecentPage() {
  const state = useStore((s) => s)
  const navigate = useNavigate()
  const rows = useMemo(
    () =>
      Object.values(state.catalog.sessions)
        .filter((session) => !session.supersededBy && session.imageType === "light")
        .sort((a, b) => b.night.localeCompare(a.night) || b.startedAt.localeCompare(a.startedAt))
        .map((session) => sessionRow(state, session)),
    [state],
  )
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const selected = rows.find((r) => r.session.id === selectedId) ?? rows[0] ?? null
  const totalSeconds = rows.reduce((sum, r) => sum + r.breakdown.captured.seconds, 0)
  const open = (id: string) => navigate({ to: "/sessions/$sessionId", params: { sessionId: id } })

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const options = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("[role=option]"))
    const index = options.findIndex((o) => o.dataset.sessionId === selected?.session.id)
    if (event.key === "Enter" && selected) {
      event.preventDefault()
      open(selected.session.id)
      return
    }
    let next = -1
    if (event.key === "ArrowRight") next = index + 1
    else if (event.key === "ArrowLeft") next = index - 1
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = options.length - 1
    else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      // Nearest option in the next / previous visual row.
      const here = options[index]?.getBoundingClientRect()
      if (!here) return
      const down = event.key === "ArrowDown"
      let best = -1
      let bestScore = Number.POSITIVE_INFINITY
      options.forEach((option, i) => {
        const box = option.getBoundingClientRect()
        const dy = down ? box.top - here.bottom : here.top - box.bottom
        if (dy < -4) return
        const score = dy * 4 + Math.abs(box.left - here.left)
        if (score < bestScore) {
          bestScore = score
          best = i
        }
      })
      next = best
    } else return
    event.preventDefault()
    const target = options[Math.max(0, Math.min(options.length - 1, next))]
    if (!target) return
    setSelectedId(target.dataset.sessionId ?? null)
    target.focus()
    target.scrollIntoView({ block: "nearest" })
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <PageHeader
          title="Recent sessions"
          meta={
            <span className="num text-xs text-muted-foreground">
              {plural(rows.length, "session")} · {formatDuration(totalSeconds)} captured
            </span>
          }
          actions={
            <Button variant="outline" size="sm" render={<Link to="/sessions" />}>
              <Layers data-icon="inline-start" aria-hidden="true" />
              All sessions
            </Button>
          }
        />
        <PaneToolbar>
          <span className="text-xs text-muted-foreground">Newest night first · first frame of each session, Auto stretch · display only</span>
        </PaneToolbar>
        <div className="min-h-0 flex-1 overflow-y-auto bg-canvas">
          {rows.length === 0 ? (
            <div className="mx-auto max-w-md p-8">
              <EmptyState
                icon={Layers}
                title="No light sessions yet"
                description="Sessions appear here as soon as indexing reads them, newest night first."
                action={
                  <Button size="sm" variant="outline" render={<Link to="/settings/locations" />}>
                    Manage locations
                  </Button>
                }
              />
            </div>
          ) : (
            // biome-ignore lint/a11y/useSemanticElements: a grid of plates with one tab stop is a listbox, not a <select>.
            <div
              role="listbox"
              aria-label="Recent sessions, newest night first"
              onKeyDown={onKeyDown}
              className="grid grid-cols-[repeat(auto-fill,minmax(12.5rem,1fr))] content-start gap-2 p-2.5"
            >
              {rows.map((row) => {
                const isSelected = row.session.id === selected?.session.id
                const label = row.label
                const offline = row.availability.offline > 0
                return (
                        <ContextMenu key={row.session.id}>
                          <ContextMenuTrigger>
                            <div
                              role="option"
                              aria-selected={isSelected}
                              aria-label={`${label}, ${row.targetName ?? "no Target"}`}
                              tabIndex={isSelected ? 0 : -1}
                              data-session-id={row.session.id}
                              data-inset-focus=""
                              onClick={() => setSelectedId(row.session.id)}
                              onDoubleClick={() => open(row.session.id)}
                              onFocus={() => setSelectedId(row.session.id)}
                              className="rounded-md outline-none"
                            >
                              <Plate
                                selected={isSelected}
                                faded={offline && row.availability.available === 0}
                                image={
                                  <>
                                    <SessionThumb session={row.session} label={label} />
                                    <PlateFlags row={row} />
                                  </>
                                }
                                title={`${formatNight(row.session.night)} · ${row.session.channel ?? "No filter"} · ${formatExposure(row.session.exposureS)}`}
                                subtitle={`${row.targetName ?? (row.session.target.status === "unresolved" ? "Unresolved sky" : "No Target")} · ${row.session.assetIds.length} frames`}
                                meta={formatDuration(row.breakdown.captured.seconds)}
                              />
                            </div>
                          </ContextMenuTrigger>
                          <ContextMenuContent>
                            <DropdownMenuItem onClick={() => open(row.session.id)}>
                              Open session
                              <DropdownMenuShortcut>↵</DropdownMenuShortcut>
                            </DropdownMenuItem>
                            {row.session.target.value ? (
                              <DropdownMenuItem onClick={() => navigate({ to: "/targets/$targetId", params: { targetId: row.session.target.value! } })}>Open Target</DropdownMenuItem>
                            ) : null}
                            {row.session.target.value ? (
                              <DropdownMenuItem onClick={() => navigate({ to: "/targets/$targetId/plan", params: { targetId: row.session.target.value! } })}>Plan this Target</DropdownMenuItem>
                            ) : null}
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onClick={() => navigate({ to: "/sessions", search: { q: row.session.night } as never })}>Show night in Sessions</DropdownMenuItem>
                          </ContextMenuContent>
                        </ContextMenu>
                )
              })}
            </div>
          )}
        </div>
      </div>
      {selected ? <RecentInspector row={selected} onOpen={() => open(selected.session.id)} /> : null}
    </div>
  )
}

/** Corner glyphs on the print: offline, provisional, needs review. Each also has a word for assistive tech. */
function PlateFlags({ row }: { row: SessionRow }) {
  const flags: Array<{ icon: typeof Unplug; label: string; tone: string }> = []
  if (row.availability.offline > 0) flags.push({ icon: Unplug, label: "Offline", tone: "text-warning" })
  if (row.session.scope === "provisional") flags.push({ icon: Hourglass, label: "Provisional", tone: "text-info" })
  if (targetNeedsReview(row.session)) flags.push({ icon: TriangleAlert, label: "Target needs review", tone: "text-warning" })
  if (flags.length === 0) return null
  return (
    <div className="absolute top-1 right-1 flex gap-0.5">
      {flags.map((flag) => (
        <span key={flag.label} title={flag.label} className={`flex items-center gap-1 rounded-sm bg-canvas/85 px-1 py-px text-2xs ${flag.tone}`}>
          <flag.icon aria-hidden="true" className="size-3" />
          <span className="sr-only">{flag.label}</span>
        </span>
      ))}
    </div>
  )
}

function RecentInspector({ row, onOpen }: { row: SessionRow; onOpen: () => void }) {
  const catalog = useStore((s) => s.catalog)
  const { session, breakdown } = row
  const site = captureSite(catalog, session)
  const quality: Array<{ key: string; label: string; seconds: number; frames: number; className: string }> = [
    { key: "usable", label: "Usable", ...breakdown.usable, className: "bg-success" },
    { key: "unreviewed", label: "Unreviewed", ...breakdown.unreviewed, className: "bg-muted-foreground/60" },
    { key: "unusable", label: "Unusable", ...breakdown.unusable, className: "bg-destructive" },
    { key: "changed", label: "Changed content", ...breakdown.changedContent, className: "bg-warning" },
  ]
  return (
    <Inspector label="Session inspector" widthKey="recent-inspector" initialWidth={300}>
      <PanelSection title="Navigator" id="recent.navigator" level={2}>
        <Plate image={<SessionThumb session={session} label={row.label} />} title={row.label} subtitle={row.targetName ?? "No Target"} />
      </PanelSection>
      <PanelSection title="Session" id="recent.session" level={2}>
        <ValueList
          label="Session facts and their sources"
          items={[
            { label: "Night", value: formatNight(session.night, true), source: site ? `local night at ${site.name}` : "from DATE-OBS" },
            { label: "Channel", value: session.channel ?? "No filter", source: session.corrections.some((c) => c.field === "filter") ? "Corrected in catalogue" : "FILTER header" },
            { label: "Exposure", value: formatExposure(session.exposureS), source: session.corrections.some((c) => c.field === "exposure") ? "Corrected in catalogue" : "EXPTIME header" },
            { label: "Frames", value: `${session.assetIds.length}`, source: "Indexed" },
            { label: "Integration", value: formatDuration(breakdown.captured.seconds), source: "Derived" },
            { label: "OBJECT", value: session.objectLabel ?? "Not recorded", source: "OBJECT header", mono: Boolean(session.objectLabel) },
            {
              label: "Target",
              value: (
                <span className="inline-flex flex-wrap items-center gap-1">
                  {row.targetName ?? "None"}
                  <StatusBadge kind="association" value={session.target.status} />
                </span>
              ),
            },
            {
              label: "Equipment",
              value: (
                <span className="inline-flex flex-wrap items-center gap-1">
                  {row.trainName ?? "Unknown"}
                  <StatusBadge kind="association" value={session.equipment.status} />
                </span>
              ),
            },
            {
              label: "Location",
              value: row.locations.map((l) => l.location.displayName).join(", ") || "None",
              source: row.availability.offline > 0 ? "Offline · last observed" : "Online",
            },
          ]}
        />
      </PanelSection>
      <PanelSection title="Quality" id="recent.quality" level={2} summary={`${breakdown.usable.frames} usable / ${breakdown.captured.frames}`}>
        <div className="space-y-2">
          <div className="flex h-1.5 overflow-hidden rounded-full bg-canvas" aria-hidden="true">
            {quality.map((q) => (breakdown.captured.frames ? <div key={q.key} className={q.className} style={{ width: `${(q.frames / breakdown.captured.frames) * 100}%` }} /> : null))}
          </div>
          <ValueList items={quality.map((q) => ({ label: q.label, value: `${q.frames} · ${formatDuration(q.seconds)}` }))} />
          <p className="text-2xs text-muted-foreground">Quality is decided in a View&apos;s Frames review; nothing here changes the library.</p>
        </div>
      </PanelSection>
      <div className="chrome flex flex-wrap gap-1.5 p-3">
        <Button size="sm" onClick={onOpen}>
          <ExternalLink data-icon="inline-start" aria-hidden="true" />
          Open session
        </Button>
        {session.target.value ? (
          <Button size="sm" variant="outline" render={<Link to="/targets/$targetId" params={{ targetId: session.target.value }} />}>
            <Crosshair data-icon="inline-start" aria-hidden="true" />
            Open Target
          </Button>
        ) : null}
        {session.target.value ? (
          <Button size="sm" variant="outline" render={<Link to="/targets/$targetId/plan" params={{ targetId: session.target.value }} />}>
            <CalendarClock data-icon="inline-start" aria-hidden="true" />
            Plan
          </Button>
        ) : null}
      </div>
    </Inspector>
  )
}
