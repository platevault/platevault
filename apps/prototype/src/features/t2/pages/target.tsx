/**
 * Target (`/targets/$targetId`): captured, library-usable and Unreviewed
 * integration by channel with availability as a separate state, offline
 * contributions with their last observation, sessions that still need
 * review, the local record with resolver enrichment, and the Projects,
 * Views and accepted Results for this Target (J20 S1; B1; LIB-FR-08,
 * LIB-AC-05, LIB-AC-12, D18).
 */
import { Link, useParams } from "@tanstack/react-router"
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
import { formatDateTime, formatDec, formatDegrees, formatDuration, formatRa, plural } from "@/lib/format"
import { type CommitResult, store, useStore } from "@/store/core"
import { acceptEnrichment, type EnrichmentProposal, LOOKUP_DELAY_MS, type LookupOutcome, PROVIDER_LABEL, resolveTargetLookup } from "../actions"
import { acceptedResultsForViews, sessionRow, type SessionRow, sumBreakdowns, viewsForTarget } from "../model"
import { AssociationBadge, IndexingNotices, LibraryScopeStrip, QualityCounts, ScopeCell } from "../parts"
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

const COORDINATE_SOURCE = {
  catalog: "Bundled reference catalog",
  user: "Entered by you",
  resolver: "Online resolver",
  unknown: "Unknown",
} as const

function TargetDetail({ targetId }: { targetId: string }) {
  const target = useStore((s) => s.catalog.targets[targetId]!)
  const { coverage, contributing, needsReview } = useStore((s) => {
    const coverage = targetCoverage(s.disk, s.catalog, targetId)
    return {
      coverage,
      contributing: coverage.channels.flatMap((c) => c.sessionIds).map((id) => sessionRow(s, s.catalog.sessions[id]!)),
      needsReview: coverage.needsReview.map((session) => sessionRow(s, session)),
    }
  })
  const catalog = useStore((s) => s.catalog)
  const planned = Boolean(catalog.plans[targetId]?.planned)
  const totals = sumBreakdowns(coverage.channels.map((c) => c.breakdown))
  const offline = contributing.filter((r) => r.availability.offline > 0)
  const projects = Object.values(catalog.projects).filter((p) => p.targetIds.includes(targetId))
  const views = viewsForTarget(catalog, targetId)
  const results = acceptedResultsForViews(catalog, views)

  const sessionColumns: Column<SessionRow>[] = [
    {
      id: "session",
      header: "Session",
      rowHeader: true,
      sortValue: (r) => `${r.session.night}|${r.label}`,
      cell: (r) => (
        <span className="flex flex-col items-start gap-0.5 py-1">
          <Link to="/sessions/$sessionId" params={{ sessionId: r.session.id }} className="font-medium underline-offset-2 hover:underline">
            {r.label}
          </Link>
          <ScopeCell scope={r.session.scope} />
        </span>
      ),
    },
    { id: "association", header: "Association", cell: (r) => <AssociationBadge association={r.session.target} /> },
    { id: "frames", header: "Frames", align: "right", sortValue: (r) => r.session.assetIds.length, cell: (r) => r.session.assetIds.length },
    { id: "integration", header: "Integration", align: "right", sortValue: (r) => r.breakdown.captured.seconds, cell: (r) => formatDuration(r.breakdown.captured.seconds) },
    { id: "quality", header: "Quality", cell: (r) => <QualityCounts breakdown={r.breakdown} /> },
    {
      id: "availability",
      header: "Availability",
      className: "whitespace-normal",
      sortValue: (r) => r.breakdown.unavailable.frames,
      cell: (r) =>
        r.availability.offline > 0 ? (
          <span className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge kind="availability" value="offline" />
            <span className="text-xs text-muted-foreground">
              Last observed {r.lastObservedAt ? formatDateTime(r.lastObservedAt) : "at the last scan"} · not available as input
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
        actions={
          <>
            <Button variant="outline" render={<Link to="/targets/$targetId/plan" params={{ targetId }} />}>
              Plan
            </Button>
            <Button variant="outline" render={<Link to="/projects/new" search={{ targetId }} />}>
              New Project
            </Button>
            <Button render={<Link to="/views/new" search={{ from: "target", targetId }} />}>Create View</Button>
          </>
        }
      />
      <PageBody>
        <IndexingNotices />
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
        <LibraryScopeStrip kind="light" />

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
              <div className="grid grid-cols-2 gap-4 rounded-lg border p-3 sm:grid-cols-3 lg:grid-cols-6">
                <Stat label="Captured" value={formatDuration(totals.captured.seconds)} hint={plural(totals.captured.frames, "frame")} />
                <Stat label="Usable" value={formatDuration(totals.usable.seconds)} hint={plural(totals.usable.frames, "frame")} />
                <Stat label="Unreviewed" value={formatDuration(totals.unreviewed.seconds)} hint={plural(totals.unreviewed.frames, "frame")} />
                <Stat label="Unusable" value={formatDuration(totals.unusable.seconds)} hint={plural(totals.unusable.frames, "frame")} />
                <Stat
                  label="Unavailable now"
                  value={formatDuration(totals.unavailable.seconds)}
                  hint={totals.unavailable.frames > 0 ? "offline or unreadable; still captured" : "every frame readable"}
                />
                <Stat label="Sessions" value={contributing.length} hint={plural(coverage.channels.length, "channel")} />
              </div>
              <ul className="grid gap-4 2xl:grid-cols-2">
                {coverage.channels.map((c) => (
                  <li key={c.channel} className="rounded-lg border p-3">
                    <ChannelCoverage channel={c.channel} breakdown={c.breakdown} />
                  </li>
                ))}
              </ul>
            </>
          )}
        </Section>

        {contributing.length > 0 ? (
          <Section id="contributing" title="Contributing sessions" description="Each frame counts once, however many copies exist.">
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
                  cell: (r) => (r.session.objectLabel ? <span className="font-mono text-xs">{r.session.objectLabel}</span> : <span className="text-muted-foreground">No OBJECT</span>),
                },
                {
                  id: "evidence",
                  header: "Why",
                  cell: (r) =>
                    r.session.target.evidence
                      .filter((e) => e.agrees === false)
                      .map((e) => `${e.label} ${e.value} conflicts`)
                      .join("; ") || "Evidence is unknown",
                },
                { id: "status", header: "Association", cell: (r) => <AssociationBadge association={r.session.target} /> },
                sessionColumns[2]!,
              ]}
              getRowId={(r) => r.session.id}
              scroll="none"
            />
          </Section>
        ) : null}

        <TargetRecordSection target={target} />

        <Section
          id="projects"
          title="Projects"
          actions={
            <Button size="sm" variant="outline" render={<Link to="/projects/new" search={{ targetId }} />}>
              New Project
            </Button>
          }
        >
          {projects.length === 0 ? (
            <p className="text-sm text-muted-foreground">No Project uses {target.name}. Projects are optional goals; the library and Views work without them.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
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

        <Section id="views" title="Views">
          {views.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No View uses {target.name} yet.{" "}
              <Link to="/views/new" search={{ from: "target", targetId }} className="text-primary underline-offset-2 hover:underline">
                Create View
              </Link>{" "}
              starts one from this Target.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {views.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center justify-between gap-3 px-3 py-2 text-sm">
                  <Link to="/views/$viewId" params={{ viewId: v.id }} className="font-medium underline-offset-2 hover:underline">
                    {v.name}
                  </Link>
                  <StatusBadge kind="view" value={viewStatus(catalog, v)} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <Section id="results" title="Accepted Results">
          {results.length === 0 ? (
            <p className="text-sm text-muted-foreground">No accepted Result yet. Results are accepted inside a View after processing.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
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
      </PageBody>
    </div>
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
        {state.phase === "loading" ? `Looking up ${target.name} at ${provider}` : ""}
      </p>
      {state.phase === "done" && state.outcome.kind === "failed" ? (
        <Notice
          tone="warning"
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
