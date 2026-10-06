/**
 * `/overview` — the start page (HARNESS V1, design/HARNESS-V1.md §Start page).
 * What changed in the library since the last visit: new captures, the
 * decisions waiting for you and the work that is running. It reads the
 * catalog, operations and Activity; it never writes the catalog. The last
 * visit time is a shell preference in localStorage, like the sidebar width.
 */
import { Link } from "@tanstack/react-router"
import { CircleAlert, CircleCheck, Clock, Crosshair, ImageOff, Loader, Unplug } from "lucide-react"
import { type ReactNode, useEffect, useState } from "react"
import { PageBody, PageHeader } from "@/components/app/page"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { formatDuration } from "@/lib/format"
import { useStore } from "@/store/core"

const LAST_VISIT_KEY = "platevault.overview.lastVisit"

/** The previous visit, read once per mount; this visit is recorded when the page closes. */
function useLastVisit(): string | null {
  const [previous] = useState<string | null>(() => {
    try {
      return localStorage.getItem(LAST_VISIT_KEY)
    } catch {
      return null
    }
  })
  useEffect(
    () => () => {
      try {
        localStorage.setItem(LAST_VISIT_KEY, new Date().toISOString())
      } catch {
        // The next visit compares against the last recorded one.
      }
    },
    [],
  )
  return previous
}

function when(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })
}

/** One group box: a titled pane of rows. Never nested in another box. */
function Pane({ title, id, trailing, children }: { title: string; id: string; trailing?: ReactNode; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex min-w-0 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="flex min-h-8 items-center justify-between gap-2 border-b px-3">
        <h2 id={id} className="text-sm font-semibold">
          {title}
        </h2>
        {trailing}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
    </section>
  )
}

function Row({ icon, tone, children, to, count }: { icon: ReactNode; tone?: string; children: ReactNode; to: string; count?: number }) {
  return (
    <li className="border-b last:border-0">
      <Link to={to} className="flex min-h-8 items-center gap-2 px-3 py-1 text-sm hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)]">
        <span aria-hidden="true" className={tone ?? "text-muted-foreground"}>
          {icon}
        </span>
        <span className="min-w-0 flex-1">{children}</span>
        {count !== undefined ? <span className="text-xs font-medium tabular-nums text-muted-foreground">{count}</span> : null}
      </Link>
    </li>
  )
}

export function OverviewPage() {
  const lastVisit = useLastVisit()
  const data = useStore((s) => {
    const sessions = Object.values(s.catalog.sessions).filter((x) => !x.supersededBy && x.imageType === "light")
    const latest = [...sessions].sort((a, b) => b.startedAt.localeCompare(a.startedAt)).slice(0, 6)
    const noTarget = sessions.filter((x) => x.target.status === "unresolved").length
    const conflicting = sessions.filter((x) => x.target.status === "needs-review").length
    const incomplete = sessions.filter((x) => x.scope !== "complete").length
    let unreviewed = 0
    for (const x of sessions) for (const id of x.assetIds) if (s.catalog.assets[id]?.quality.value === "unreviewed") unreviewed += 1
    const offline = Object.values(s.catalog.locations).filter((l) => !l.retiredAt && !s.disk.volumes[l.volumeId]?.mounted)
    const work = Object.values(s.operations)
      .filter((op) => op.status === "running" || op.status === "paused" || op.status === "interrupted")
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    const since = lastVisit ? s.activity.filter((e) => e.at > lastVisit) : s.activity
    return {
      latest: latest.map((x) => ({
        id: x.id,
        night: x.night,
        channel: x.channel ?? "No filter",
        target: x.target.value ? (s.catalog.targets[x.target.value]?.name ?? null) : null,
        frames: x.assetIds.length,
        seconds: x.assetIds.length * x.exposureS,
      })),
      noTarget,
      conflicting,
      incomplete,
      unreviewed,
      offline: offline.map((l) => l.displayName),
      work,
      since: since.slice(0, 7),
      sinceCount: since.length,
      totals: { targets: Object.keys(s.catalog.targets).length, sessions: sessions.length, views: Object.keys(s.catalog.views).length },
    }
  })
  const decisions = data.noTarget + data.conflicting + data.incomplete + (data.unreviewed > 0 ? 1 : 0) + data.offline.length
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Overview"
        description={
          lastVisit
            ? `What changed since your last visit on ${when(lastVisit)}: new captures, decisions waiting for you and running work.`
            : "What changed in your library: new captures, decisions waiting for you and running work."
        }
        meta={decisions > 0 ? <Badge variant="secondary">{decisions} to review</Badge> : null}
      />
      <PageBody className="grid grid-cols-1 gap-4 space-y-0 lg:grid-cols-2 2xl:grid-cols-3">
        <Pane
          title={lastVisit ? "Since your last visit" : "Recent activity"}
          id="overview-since"
          trailing={
            <Button variant="link" size="xs" render={<Link to="/activity" />}>
              {data.sinceCount > data.since.length ? `All ${data.sinceCount} in Activity` : "Activity"}
            </Button>
          }
        >
          {data.since.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Nothing changed since then. New indexing, saves and refusals appear here.</p>
          ) : (
            <ul>
              {data.since.map((event) => (
                <Row
                  key={event.id}
                  to={event.href?.replace(/^#/, "") ?? "/activity"}
                  tone={event.kind === "operation" || event.kind === "saved" ? "text-success" : "text-warning"}
                  icon={event.kind === "operation" || event.kind === "saved" ? <CircleCheck className="size-3.5" /> : <CircleAlert className="size-3.5" />}
                >
                  <span className="block truncate">{event.title}</span>
                  <span className="block text-xs text-muted-foreground tabular-nums">{when(event.at)}</span>
                </Row>
              ))}
            </ul>
          )}
        </Pane>

        <Pane title="Needs review" id="overview-review" trailing={<span className="text-xs text-muted-foreground tabular-nums">{decisions === 0 ? "All clear" : `${decisions} items`}</span>}>
          {decisions === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Every session has a Target, every scan finished and every location is online.</p>
          ) : (
            <ul>
              {data.noTarget > 0 ? (
                <Row to="/sessions" tone="text-warning" icon={<Crosshair className="size-3.5" />} count={data.noTarget}>
                  Sessions without a Target
                </Row>
              ) : null}
              {data.conflicting > 0 ? (
                <Row to="/sessions" tone="text-warning" icon={<CircleAlert className="size-3.5" />} count={data.conflicting}>
                  Sessions with conflicting Target evidence
                </Row>
              ) : null}
              {data.unreviewed > 0 ? (
                <Row to="/views" icon={<ImageOff className="size-3.5" />} count={data.unreviewed}>
                  Unreviewed light frames (review them in a View)
                </Row>
              ) : null}
              {data.incomplete > 0 ? (
                <Row to="/settings/locations" tone="text-warning" icon={<Clock className="size-3.5" />} count={data.incomplete}>
                  Sessions from an unfinished or partial scan
                </Row>
              ) : null}
              {data.offline.map((name) => (
                <Row key={name} to="/storage" tone="text-warning" icon={<Unplug className="size-3.5" />}>
                  {name} offline: its frames count as captured, never as inputs
                </Row>
              ))}
            </ul>
          )}
        </Pane>

        <Pane title="Running work" id="overview-work" trailing={<span className="text-xs text-muted-foreground tabular-nums">{data.work.length === 0 ? "Idle" : `${data.work.length} operations`}</span>}>
          {data.work.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">Nothing is running. Indexing, measurement, preparation and transfers show progress here and in the status bar.</p>
          ) : (
            <ul>
              {data.work.map((op) => {
                const pct = op.progress.total > 0 ? Math.round((op.progress.done / op.progress.total) * 100) : 0
                return (
                  <li key={op.id} className="space-y-1 border-b px-3 py-2 last:border-0">
                    <div className="flex items-center gap-2 text-sm">
                      {op.status === "running" ? <Loader aria-hidden="true" className="size-3.5 animate-spin text-primary" /> : <CircleAlert aria-hidden="true" className="size-3.5 text-warning" />}
                      <Link to="/activity" className="min-w-0 flex-1 truncate hover:underline">
                        {op.title}
                      </Link>
                      <span className="text-xs text-muted-foreground tabular-nums">
                        {op.status === "running" ? `${op.progress.done} of ${op.progress.total} ${op.progress.unit}` : op.status === "paused" ? "Paused" : "Interrupted"}
                      </span>
                    </div>
                    <Progress value={pct} aria-label={`${op.title} progress`} className="h-1" />
                  </li>
                )
              })}
            </ul>
          )}
        </Pane>

        <Pane
          title="Latest captures"
          id="overview-captures"
          trailing={
            <Button variant="link" size="xs" render={<Link to="/sessions" />}>
              All sessions
            </Button>
          }
        >
          {data.latest.length === 0 ? (
            <p className="px-3 py-3 text-sm text-muted-foreground">No light sessions yet. Add a capture location in Settings › Locations.</p>
          ) : (
            <table className="w-full text-sm">
              <caption className="sr-only">Latest light sessions</caption>
              <thead className="text-xs text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="h-6 px-3 text-left font-medium">Session</th>
                  <th scope="col" className="h-6 px-2 text-left font-medium">Target</th>
                  <th scope="col" className="h-6 px-3 text-right font-medium">Integration</th>
                </tr>
              </thead>
              <tbody>
                {data.latest.map((row) => (
                  <tr key={row.id} className="h-(--row-h) even:bg-row-alt">
                    <th scope="row" className="px-3 text-left font-normal">
                      <Link to="/sessions/$sessionId" params={{ sessionId: row.id }} className="hover:underline">
                        {row.night} · {row.channel}
                      </Link>
                    </th>
                    <td className="px-2">{row.target ?? <span className="text-warning">No Target yet</span>}</td>
                    <td className="px-3 text-right tabular-nums">
                      {row.frames} · {formatDuration(row.seconds)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Pane>

        <Pane title="Library" id="overview-library">
          <dl className="grid grid-cols-3 divide-x text-center">
            {[
              ["Targets", data.totals.targets, "/targets"],
              ["Light sessions", data.totals.sessions, "/sessions"],
              ["Views", data.totals.views, "/views"],
            ].map(([label, value, to]) => (
              <div key={label as string} className="px-2 py-3">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="text-xl font-semibold tabular-nums">
                  <Link to={to as string} className="hover:underline">
                    {value}
                  </Link>
                </dd>
              </div>
            ))}
          </dl>
          <div className="border-t px-3 py-2 text-xs text-muted-foreground">
            Plan the next night in{" "}
            <Link to="/plans" className="text-primary hover:underline">
              Plan
            </Link>
            ; find a Target with{" "}
            <Link to="/targets" className="text-primary hover:underline">
              Targets
            </Link>
            .
          </div>
        </Pane>
      </PageBody>
    </div>
  )
}
