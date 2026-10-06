/**
 * Target (`/targets/$targetId`), a document with D's Target-scoped tabs
 * (Harness V3): Overview (captured, library-usable and Unreviewed
 * integration by channel with availability as a separate state, offline
 * contributions with their last observation, Project goals and the local
 * record with resolver enrichment), Sessions (contributing and needs
 * review), Views (each with its pipeline stage and Next action), Plan
 * (`/targets/$targetId/plan`) and accepted Results. `?tab=` selects the tab
 * (J20 S1; B1; LIB-FR-08, LIB-AC-05, LIB-AC-12, D18).
 */
import { Link, useParams, useSearch } from "@tanstack/react-router"
import { CalendarClock, Crosshair } from "lucide-react"
import { useEffect, useId, useRef, useState } from "react"
import { ChannelCoverage, type KeyValueItem, KeyValueList, PathText, Stat } from "@/components/app/data"
import { type Column, DataTable } from "@/components/app/data-table"
import { ActionError, EmptyState, Notice, SaveState, UnknownValue } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import { projectProgress, targetCoverage, viewStatus } from "@/domain/derive"
import type { Target } from "@/domain/types"
import { usableVerifiedAt } from "@/domain/verification"
import { viewPipeline } from "@/app/pipeline"
import { StageStrip } from "@/components/app/pipeline"
import type { SearchParams } from "@/routes"
import { formatDateTime, formatDec, formatDegrees, formatDuration, formatRa, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { type CommitResult, store, useStore } from "@/store/core"
import { acceptEnrichment, type EnrichmentProposal, LOOKUP_DELAY_MS, type LookupOutcome, PROVIDER_LABEL, resolveTargetLookup } from "../actions"
import { acceptedResultsForViews, COORDINATE_SOURCE, sessionRow, type SessionRow, sumBreakdowns, viewsForTarget } from "../model"
import { AssociationBadge, DENSITY_CELL, LibraryStatus, QualityCounts, ScopeCell } from "../parts"
import { TargetRecordDialog } from "../target-record-dialog"

export function TargetPage() {
  const { targetId = "" } = useParams({ strict: false }) as { targetId?: string }
  const exists = useStore((s) => Boolean(s.catalog.targets[targetId]))
  if (!exists) {
    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <PageHeader title="Target not found" />
        <PageBody>
          <EmptyState
            icon={Crosshair}
            titleAs="h2"
            title="This Target does not exist"
            description="It may come from an older prototype build or a reset. The library is unchanged."
            action={
              <Button size="sm" render={<Link to="/targets" />}>
                Go to Targets
              </Button>
            }
          />
        </PageBody>
      </div>
    )
  }
  return <TargetDetail key={targetId} targetId={targetId} />
}

type TargetTab = "overview" | "sessions" | "views" | "plan" | "results"

const TABS: Array<{ tab: TargetTab; label: string }> = [
  { tab: "overview", label: "Overview" },
  { tab: "sessions", label: "Sessions" },
  { tab: "views", label: "Views" },
  { tab: "plan", label: "Plan" },
  { tab: "results", label: "Results" },
]

/**
 * The Target document's header (Harness V3, from direction D): the path,
 * the name, the record-level actions, and the Target-scoped tabs as one
 * segmented control. Every tab keeps this header, so the Target stays the
 * place and its sessions, Views, plan and Results hang from it.
 */
export function TargetHeader({ target }: { target: Target }) {
  const targetId = target.id
  const planned = useStore((s) => Boolean(s.catalog.plans[targetId]?.planned))
  const counts = useStore((s) => {
    const coverage = targetCoverage(s.disk, s.catalog, targetId)
    const views = viewsForTarget(s.catalog, targetId)
    return {
      sessions: coverage.channels.reduce((n, c) => n + c.sessionIds.length, 0) + coverage.needsReview.length,
      views: views.length,
      results: acceptedResultsForViews(s.catalog, views).length,
    } as Partial<Record<TargetTab, number>>
  })
  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/targets" className="underline-offset-2 hover:underline">
            Targets
          </Link>
        }
        title={target.name}
        meta={
          planned ? (
            <Link to="/targets/$targetId/plan" params={{ targetId }} className="inline-flex items-center gap-1 text-xs text-muted-foreground underline-offset-2 hover:underline">
              <CalendarClock aria-hidden="true" className="size-3.5" />
              Planned
            </Link>
          ) : undefined
        }
        description={target.aliases.length > 0 ? target.aliases.join(" · ") : undefined}
        className="border-b-0 pb-1.5"
        actions={
          <>
            <Button size="sm" variant="outline" render={<Link to="/projects/new" search={{ targetId }} />}>
              New Project
            </Button>
            <Button size="sm" render={<Link to="/views/new" search={{ from: "target", targetId }} />}>
              Create View
            </Button>
          </>
        }
      />
      <nav aria-label={`${target.name} sections`} className="shrink-0 border-b px-4 pb-2" data-chrome>
        <ul className="inline-flex max-w-full flex-wrap items-center gap-0.5 rounded-md border bg-muted/50 p-0.5">
          {TABS.map((item) => {
            const count = counts[item.tab]
            return (
              <li key={item.tab}>
                <Link
                  to={item.tab === "plan" ? "/targets/$targetId/plan" : "/targets/$targetId"}
                  params={{ targetId }}
                  search={item.tab === "plan" || item.tab === "overview" ? {} : { tab: item.tab }}
                  // The router marks the current tab (aria-current="page"); exact, so Overview is not current on the other tabs.
                  activeOptions={{ exact: true }}
                  className={cn(
                    "inline-flex h-6 items-center gap-1.5 rounded-[4px] px-2.5 text-sm text-muted-foreground hover:text-foreground",
                    "aria-[current=page]:bg-background aria-[current=page]:font-medium aria-[current=page]:text-foreground aria-[current=page]:shadow-[0_0_0_1px_var(--border),0_1px_1px_rgb(0_0_0/0.18)]",
                  )}
                >
                  {item.label}
                  {count !== undefined ? <span className="text-xs font-normal text-muted-foreground tabular-nums"> {count}</span> : null}
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>
    </>
  )
}

function TargetDetail({ targetId }: { targetId: string }) {
  const target = useStore((s) => s.catalog.targets[targetId]!)
  const search = useSearch({ strict: false }) as SearchParams
  const tab: TargetTab = search.tab === "sessions" || search.tab === "views" || search.tab === "results" ? search.tab : "overview"
  const { coverage, contributing, needsReview } = useStore((s) => {
    const coverage = targetCoverage(s.disk, s.catalog, targetId)
    return {
      coverage,
      contributing: coverage.channels.flatMap((c) => c.sessionIds).map((id) => sessionRow(s, s.catalog.sessions[id]!)),
      needsReview: coverage.needsReview.map((session) => sessionRow(s, session)),
    }
  })
  const catalog = useStore((s) => s.catalog)
  const totals = sumBreakdowns(coverage.channels.map((c) => c.breakdown))
  // Verification time of each usable figure (D19): read from the catalog, never a rehash.
  const channelAssetIds = coverage.channels.map((c) => c.sessionIds.flatMap((id) => catalog.sessions[id]?.assetIds ?? []))
  const verifiedAt = channelAssetIds.map((ids) => usableVerifiedAt(catalog, ids))
  const totalVerifiedAt = usableVerifiedAt(catalog, channelAssetIds.flat())
  const offline = contributing.filter((r) => r.availability.offline > 0)
  const projects = Object.values(catalog.projects).filter((p) => p.targetIds.includes(targetId))
  const views = viewsForTarget(catalog, targetId)
  const results = acceptedResultsForViews(catalog, views)

  const sessionColumns: Column<SessionRow>[] = [
    {
      id: "session",
      header: "Session",
      rowHeader: true,
      className: DENSITY_CELL,
      sortValue: (r) => `${r.session.night}|${r.label}`,
      cell: (r) => (
        <span className="flex flex-col items-start gap-0.5 compact:flex-row compact:items-center compact:gap-2">
          <Link to="/sessions/$sessionId" params={{ sessionId: r.session.id }} className="font-medium underline-offset-2 hover:underline">
            {r.label}
          </Link>
          <ScopeCell scope={r.session.scope} />
        </span>
      ),
    },
    { id: "association", header: "Association", className: DENSITY_CELL, cell: (r) => <AssociationBadge association={r.session.target} /> },
    { id: "frames", header: "Frames", align: "right", className: DENSITY_CELL, sortValue: (r) => r.session.assetIds.length, cell: (r) => r.session.assetIds.length },
    {
      id: "integration",
      header: "Integration",
      align: "right",
      className: DENSITY_CELL,
      sortValue: (r) => r.breakdown.captured.seconds,
      cell: (r) => formatDuration(r.breakdown.captured.seconds),
    },
    { id: "quality", header: "Quality", className: DENSITY_CELL, cell: (r) => <QualityCounts breakdown={r.breakdown} /> },
    {
      id: "availability",
      header: "Availability",
      className: cn("whitespace-normal xl:compact:whitespace-nowrap", DENSITY_CELL),
      sortValue: (r) => r.breakdown.unavailable.frames,
      cell: (r) =>
        r.availability.offline > 0 ? (
          <span className="inline-flex flex-wrap items-center gap-2 xl:compact:flex-nowrap">
            <StatusBadge kind="availability" value="offline" />
            <span className="text-xs text-muted-foreground">
              Last observed {r.lastObservedAt ? formatDateTime(r.lastObservedAt) : "at the last scan"}
              {/* Compact keeps one line; the offline notice above says the same. */}
              <span className="compact:hidden"> · not available as input</span>
            </span>
          </span>
        ) : r.availability.unreadable > 0 ? (
          <StatusBadge kind="availability" value="unreadable" label={`Unreadable · ${r.availability.unreadable}`} />
        ) : (
          <span className="text-muted-foreground">Available</span>
        ),
    },
  ]

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <TargetHeader target={target} />
      <PageBody>
        {tab === "overview" ? (
          <>
            <LibraryStatus kind="light" />
            {offline.length > 0 ? (
              <Notice
                tone="offline"
                title={offline.length === 1 ? "1 contribution is offline" : `${offline.length} contributions are offline`}
                actions={[...new Map(offline.flatMap((r) => r.locations.filter((l) => l.availability === "offline")).map((l) => [l.location.id, l.location])).values()].map(
                  (location) => (
                    <Button key={location.id} size="sm" variant="outline" render={<Link to="/settings/locations" search={{ locationId: location.id }} />}>
                      Locate or remap {location.displayName}
                    </Button>
                  ),
                )}
              >
                <ul className="space-y-0.5">
                  {offline.map((r) => (
                    <li key={r.session.id}>
                      {r.label} ({plural(r.availability.offline, "frame")}, {formatDuration(r.breakdown.unavailable.seconds)}) counts in captured integration with values
                      last observed {r.lastObservedAt ? formatDateTime(r.lastObservedAt) : "at the last scan"}. It is not available as a processing input.
                    </li>
                  ))}
                </ul>
              </Notice>
            ) : null}

            <Section
              id="coverage"
              title="Coverage by channel"
              description="Usable counts only library-scope quality decisions. Sessions that need review are not counted. Availability is shown separately."
            >
              {coverage.channels.length === 0 ? (
                <EmptyState
                  icon={Crosshair}
                  title={`No session is associated with ${target.name} yet`}
                  description={
                    coverage.needsReview.length > 0
                      ? `${plural(coverage.needsReview.length, "session")} below need review before they count.`
                      : "Sessions count here once their pointing or a confirmed Target associates them."
                  }
                  action={
                    <Button size="sm" variant="outline" render={<Link to="/sessions" search={{ target: coverage.needsReview.length > 0 ? "needs-review" : "unresolved" }} />}>
                      Review sessions
                    </Button>
                  }
                />
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border px-3 py-2 sm:grid-cols-3 lg:grid-cols-6">
                    <Stat label="Captured" value={formatDuration(totals.captured.seconds)} hint={plural(totals.captured.frames, "frame")} />
                    <Stat
                      label="Usable"
                      value={formatDuration(totals.usable.seconds)}
                      hint={
                        totalVerifiedAt && totals.usable.frames > 0 ? (
                          <>
                            {plural(totals.usable.frames, "frame")}
                            <br />
                            Last verified {formatDateTime(totalVerifiedAt)}
                          </>
                        ) : (
                          plural(totals.usable.frames, "frame")
                        )
                      }
                    />
                    <Stat label="Unreviewed" value={formatDuration(totals.unreviewed.seconds)} hint={plural(totals.unreviewed.frames, "frame")} />
                    <Stat label="Unusable" value={formatDuration(totals.unusable.seconds)} hint={plural(totals.unusable.frames, "frame")} />
                    <Stat
                      label="Unavailable now"
                      value={formatDuration(totals.unavailable.seconds)}
                      hint={totals.unavailable.frames > 0 ? "offline or unreadable; still captured" : "every frame readable"}
                    />
                    <Stat label="Sessions" value={contributing.length} hint={plural(coverage.channels.length, "channel")} />
                  </div>
                  <ul className="divide-y rounded-md border">
                    {coverage.channels.map((c, index) => (
                      <li key={c.channel} className="px-3 py-2.5">
                        <ChannelCoverage channel={c.channel} breakdown={c.breakdown} usableVerifiedAt={verifiedAt[index]} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </Section>

            <Section
              id="projects"
              title="Projects"
              description="Optional goals for this Target; New Project in the header starts one."
            >
              {projects.length === 0 ? (
                <p className="text-sm text-muted-foreground">No Project uses {target.name}. Projects are optional goals; the library and Views work without them.</p>
              ) : (
                <ul className="divide-y rounded-md border">
                  {projects.map((p) => {
                    const progress = projectProgress(catalog, p)
                    const met = progress.filter((x) => x.state === "met").length
                    return (
                      <li key={p.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                        <Link to="/projects/$projectId" params={{ projectId: p.id }} className="font-medium underline-offset-2 hover:underline">
                          {p.name}
                        </Link>
                        <span className="text-muted-foreground tabular-nums">
                          {progress.length > 0 ? `${met} of ${progress.length} checklist items met` : "No checklist"} · {plural(p.linkedSessionIds.length, "linked session")}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </Section>

            <TargetRecordSection target={target} />
          </>
        ) : null}

        {tab === "sessions" ? (
          <>
            {contributing.length > 0 ? (
              <Section id="contributing" title="Contributing sessions" description="The sessions the coverage counts. Each frame counts once, however many copies exist.">
                <DataTable
                  label={`Sessions contributing to ${target.name}`}
                  rows={contributing}
                  columns={sessionColumns}
                  getRowId={(r) => r.session.id}
                  initialSort={{ columnId: "session", direction: "desc" }}
                  scroll="none"
                />
              </Section>
            ) : null}

            {needsReview.length > 0 ? (
              <Section id="needs-review" title="Needs review" description={`Not counted for ${target.name} until you confirm the Target in Inspect session.`}>
                <DataTable
                  label={`Sessions that need review for ${target.name}`}
                  rows={needsReview}
                  columns={[
                    sessionColumns[0]!,
                    {
                      id: "object",
                      header: "OBJECT",
                      className: DENSITY_CELL,
                      cell: (r) => (r.session.objectLabel ? <span className="font-mono text-xs">{r.session.objectLabel}</span> : <span className="text-muted-foreground">No OBJECT</span>),
                    },
                    {
                      id: "evidence",
                      header: "Why",
                      className: DENSITY_CELL,
                      cell: (r) =>
                        r.session.target.evidence
                          .filter((e) => e.agrees === false)
                          .map((e) => `${e.label} ${e.value} conflicts`)
                          .join("; ") || "Evidence is unknown",
                    },
                    { id: "status", header: "Association", className: DENSITY_CELL, cell: (r) => <AssociationBadge association={r.session.target} /> },
                    sessionColumns[2]!,
                  ]}
                  getRowId={(r) => r.session.id}
                  scroll="none"
                />
              </Section>
            ) : null}

            {contributing.length === 0 && needsReview.length === 0 ? (
              <EmptyState
                icon={Crosshair}
                title={`No session is associated with ${target.name} yet`}
                description="Sessions appear here once their pointing or a confirmed Target associates them."
                action={
                  <Button size="sm" variant="outline" render={<Link to="/sessions" search={{ target: "unresolved" }} />}>
                    Review sessions
                  </Button>
                }
              />
            ) : null}
          </>
        ) : null}

        {tab === "views" ? <TargetViews target={target} /> : null}

        {tab === "results" ? (
          <Section id="results" title="Accepted Results" description="Results accepted inside this Target's Views, with their recorded lineage.">
            {results.length === 0 ? (
              <p className="text-sm text-muted-foreground">No accepted Result yet. Results are accepted inside a View after processing.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {results.map((r) => (
                  <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <Link to="/views/$viewId/results" params={{ viewId: r.viewId }} className="font-medium underline-offset-2 hover:underline">
                        {r.path.slice(r.path.lastIndexOf("/") + 1)}
                      </Link>
                      <PathText path={r.path} className="text-muted-foreground" />
                    </div>
                    <span className="flex flex-wrap items-center gap-2">
                      <StatusBadge kind="lineage" value={r.lineage} />
                      {r.contentState === "drifted" ? <StatusBadge kind="content" value="drifted" /> : null}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        ) : null}
      </PageBody>
    </div>
  )
}

/** The Target's Views with C's stage strip and the one Next action each (D: Views hang from their Target). */
function TargetViews({ target }: { target: Target }) {
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const decisions = useStore((s) => s.slices.t4.decisions)
  const views = viewsForTarget(catalog, target.id)
  return (
    <Section id="views" title="Views" description="Each View with the stage it stands in and its one Next action.">
      {views.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No View uses {target.name} yet.{" "}
          <Link to="/views/new" search={{ from: "target", targetId: target.id }} className="text-primary underline-offset-2 hover:underline">
            Create View
          </Link>{" "}
          starts one from this Target.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-md border">
          <table className="w-full text-sm">
            <caption className="sr-only">Views of {target.name}</caption>
            <thead className="bg-card text-xs text-muted-foreground" data-chrome>
              <tr className="h-(--row-h) border-b">
                <th scope="col" className="px-2.5 text-left font-medium">
                  View
                </th>
                <th scope="col" className="px-2.5 text-left font-medium">
                  Status
                </th>
                <th scope="col" className="px-2.5 text-left font-medium">
                  Stage
                </th>
                <th scope="col" className="px-2.5 text-left font-medium">
                  Next action
                </th>
              </tr>
            </thead>
            <tbody>
              {views.map((v) => {
                const pipeline = viewPipeline(catalog, disk, v, decisions)
                return (
                  <tr key={v.id} className="h-(--row-h) border-b border-border/60 last:border-0 even:bg-foreground/[0.025] hover:bg-accent/70">
                    <th scope="row" className="px-2.5 py-1 text-left font-normal">
                      <Link to="/views/$viewId" params={{ viewId: v.id }} className="font-medium underline-offset-2 hover:underline">
                        {v.name}
                      </Link>
                    </th>
                    <td className="px-2.5 py-1 whitespace-nowrap">
                      <StatusBadge kind="view" value={viewStatus(catalog, v)} />
                    </td>
                    <td className="px-2.5 py-1 whitespace-nowrap">
                      <StageStrip pipeline={pipeline} />
                    </td>
                    <td className="px-2.5 py-1">
                      {pipeline.next ? (
                        <Link to={pipeline.next.to} className="text-sm text-primary underline-offset-2 hover:underline">
                          Next: {pipeline.next.label}
                        </Link>
                      ) : (
                        <span className="text-muted-foreground">Nothing waiting</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  )
}

// ---------------------------------------------------------------------------
// Target record and resolver enrichment (LIB-AC-12, D18)
// ---------------------------------------------------------------------------

type LookupState = { phase: "idle" } | { phase: "loading" } | { phase: "done"; outcome: LookupOutcome }

function TargetRecordSection({ target }: { target: Target }) {
  const lookup = useStore((s) => s.settings.targetLookup)
  const [state, setState] = useState<LookupState>({ phase: "idle" })
  const [review, setReview] = useState<EnrichmentProposal | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const reasonId = useId()
  const provider = PROVIDER_LABEL[lookup.provider]
  useEffect(() => () => window.clearTimeout(timer.current), [])

  function run() {
    setState({ phase: "loading" })
    timer.current = window.setTimeout(() => {
      const outcome = resolveTargetLookup(target.id)
      setState({ phase: "done", outcome })
      if (outcome.kind === "found") setReview(outcome.proposal)
    }, LOOKUP_DELAY_MS)
  }

  const items: KeyValueItem[] = [
    {
      label: "Coordinates",
      value:
        target.ra !== null && target.dec !== null ? (
          `RA ${formatRa(target.ra)} · Dec ${formatDec(target.dec)}`
        ) : (
          <UnknownValue label="Position unknown" reason="This record has no coordinates. Look it up online or add them in Edit record." />
        ),
      source: COORDINATE_SOURCE[target.coordinateSource],
    },
    {
      label: "Size",
      value: target.sizeDeg ? `${formatDegrees(target.sizeDeg.width)} × ${formatDegrees(target.sizeDeg.height)}` : <UnknownValue />,
    },
    { label: "Aliases", value: target.aliases.length > 0 ? target.aliases.join(", ") : <span className="text-muted-foreground">None</span> },
    { label: "Object type", value: target.resolver?.objectType ?? <UnknownValue label="Not looked up" />, source: target.resolver ? `From ${target.resolver.provider}` : undefined },
    {
      label: "Provenance",
      value: target.resolver ? `${target.resolver.provider}, fetched ${formatDateTime(target.resolver.fetchedAt)}` : "Local record only",
    },
    { label: "Notes", value: target.notes || <span className="text-muted-foreground">None</span> },
  ]

  return (
    <Section
      id="record"
      title="Target record"
      description="Catalog and resolver details are kept apart from capture metadata. OBJECT labels and pointing evidence on sessions never change here."
      actions={
        <>
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            Edit record
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={run}
            disabled={!lookup.enabled || state.phase === "loading"}
            focusableWhenDisabled
            aria-describedby={!lookup.enabled ? reasonId : undefined}
          >
            {state.phase === "loading" ? <Spinner data-icon="inline-start" aria-hidden="true" /> : null}
            {state.phase === "loading" ? `Looking up at ${provider}…` : "Look up online"}
          </Button>
        </>
      }
    >
      {!lookup.enabled ? (
        <p id={reasonId} className="text-sm text-muted-foreground">
          Online lookup is off.{" "}
          <Link to="/settings/targets" search={{ return: `/targets/${target.id}` }} className="text-primary underline-offset-2 hover:underline">
            Turn it on in Settings › Target lookup
          </Link>
          . Local search and the library keep working without it.
        </p>
      ) : null}
      <p className="sr-only" role="status">
        {state.phase === "loading"
          ? `Looking up ${target.name} at ${provider}`
          : state.phase === "done" && (state.outcome.kind === "failed" || state.outcome.kind === "no-match")
            ? `${state.outcome.kind === "failed" ? "Lookup failed" : "No match"}. ${state.outcome.message}`
            : ""}
      </p>
      {state.phase === "done" && state.outcome.kind === "failed" ? (
        <Notice
          tone="refusal"
          title="Lookup failed"
          actions={
            <Button size="sm" variant="outline" onClick={run}>
              Retry lookup
            </Button>
          }
        >
          {state.outcome.message}
        </Notice>
      ) : null}
      {state.phase === "done" && state.outcome.kind === "no-match" ? (
        <Notice tone="info" title="No match">
          {state.outcome.message}
        </Notice>
      ) : null}
      <div className="rounded-lg border p-3">
        <KeyValueList items={items} columns={2} />
      </div>
      <EnrichmentDialog target={target} proposal={review} onClose={() => setReview(null)} />
      <TargetRecordDialog open={editOpen} onOpenChange={setEditOpen} target={target} />
    </Section>
  )
}

function EnrichmentDialog({ target, proposal, onClose }: { target: Target; proposal: EnrichmentProposal | null; onClose: () => void }) {
  const [baseRevision, setBaseRevision] = useState(target.revision)
  const [error, setError] = useState<Extract<CommitResult, { ok: false }> | null>(null)
  useEffect(() => {
    if (!proposal) return
    setBaseRevision(store.getState().catalog.targets[target.id]?.revision ?? target.revision)
    setError(null)
  }, [proposal])
  if (!proposal) return null

  function accept() {
    if (!proposal) return
    const result = acceptEnrichment(target.id, proposal, baseRevision)
    if (!result.ok) {
      setError(result)
      return
    }
    onClose()
  }

  const current = target.ra !== null && target.dec !== null ? `RA ${formatRa(target.ra)} · Dec ${formatDec(target.dec)}` : "Unknown"
  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Review enrichment for {target.name}</DialogTitle>
          <DialogDescription>
            {proposal.provider} answered on {formatDateTime(proposal.fetchedAt)}. Prototype: this answer is simulated from the bundled reference catalog.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 text-sm">
          <KeyValueList
            items={[
              { label: "Coordinates now", value: current, source: COORDINATE_SOURCE[target.coordinateSource] },
              { label: "Proposed", value: `RA ${formatRa(proposal.ra)} · Dec ${formatDec(proposal.dec)}`, source: proposal.provider },
              { label: "Aliases to add", value: proposal.aliases.length > 0 ? proposal.aliases.join(", ") : "None" },
              { label: "Object type", value: proposal.objectType },
              { label: "Size", value: `${formatDegrees(proposal.sizeDeg.width)} × ${formatDegrees(proposal.sizeDeg.height)}` },
            ]}
          />
          <p className="text-muted-foreground">
            Capture metadata stays as observed: OBJECT labels, pointing evidence and session associations do not change.
          </p>
          {error?.reason === "stale" ? (
            <SaveState
              state="stale"
              message={error.message}
              onReview={() => {
                setBaseRevision(store.getState().catalog.targets[target.id]?.revision ?? target.revision)
                setError(null)
              }}
            />
          ) : error ? (
            <ActionError message={error.message} onRetry={accept} />
          ) : null}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Keep the local record</DialogClose>
          <Button onClick={accept}>Accept enrichment</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
