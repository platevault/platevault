/**
 * T2 UI building blocks shared by the library pages: the commit flow behind
 * `SaveState` (D08), association and quality cells, and the library-scope
 * strip with its indexing, interrupted, incomplete and offline notices.
 */
import { Link } from "@tanstack/react-router"
import { ChevronDown } from "lucide-react"
import { Fragment, useRef, useState } from "react"
import { PathText } from "@/components/app/data"
import { Notice, SaveState, UnknownValue } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { QualityBreakdown } from "@/domain/derive"
import type { Association, Location } from "@/domain/types"
import { formatCount, formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { type CommitResult, useStore } from "@/store/core"
import { resumeOperation, startIndexing } from "@/store/operations"
import { activeIndexOperations, interruptedIndexOperations, libraryScope, type LocationScopeRow, type SessionKind, type SessionRow } from "./model"

// ---------------------------------------------------------------------------
// Commit flow (D08): Saved only after commit() returned ok
// ---------------------------------------------------------------------------

export interface CommitFlow {
  state: "saved" | "failed" | "stale" | null
  message: string | undefined
  run: (action: () => CommitResult) => CommitResult
  retry: () => void
  reset: () => void
}

export function useCommitFlow(): CommitFlow {
  const [outcome, setOutcome] = useState<{ state: CommitFlow["state"]; message?: string }>({ state: null })
  const last = useRef<(() => CommitResult) | null>(null)
  function run(action: () => CommitResult): CommitResult {
    last.current = action
    const result = action()
    setOutcome(result.ok ? { state: "saved" } : { state: result.reason === "stale" ? "stale" : "failed", message: result.message })
    return result
  }
  return {
    state: outcome.state,
    message: outcome.message,
    run,
    retry: () => {
      if (last.current) run(last.current)
    },
    reset: () => setOutcome({ state: null }),
  }
}

/**
 * Save status beside an edited value: failures and refusals win, then
 * "Unsaved changes" while the edit differs from the catalog, then "Saved"
 * after a successful commit. Nothing before the first edit.
 */
export function FlowStatus({ flow, dirty, onReview, className }: { flow: CommitFlow; dirty: boolean; onReview: () => void; className?: string }) {
  const holder = useRef<HTMLDivElement>(null)
  const [reviewed, setReviewed] = useState(false)
  const state = flow.state === "failed" || flow.state === "stale" ? flow.state : dirty ? "unsaved" : flow.state
  // Review resets the flow; until the next save the status says what Review did.
  const showReviewed = reviewed && !state
  const announcement = state === "failed" ? `Not saved. ${flow.message ?? ""}` : state === "stale" ? `Changed elsewhere. ${flow.message ?? ""}` : state === "saved" ? "Saved." : ""
  // Retry and Review remove their own button; move focus to this status first, so it never drops to the page (WCAG 2.4.3).
  const keepFocus = (action: () => void) => () => {
    holder.current?.focus()
    action()
    // Failed again: its Retry is still there, so go back to it.
    requestAnimationFrame(() => holder.current?.querySelector<HTMLElement>("button")?.focus())
  }
  return (
    <div ref={holder} tabIndex={-1} className={cn("outline-none", className)}>
      {/* Mounted before the first save, so each outcome changes its text and is announced (WCAG 4.1.3). */}
      <p role="status" className={showReviewed ? "text-xs text-pretty text-muted-foreground" : "sr-only"}>
        {showReviewed ? "Showing the current revision. Make your change again to save it." : announcement}
      </p>
      {state ? (
        <SaveState
          state={state}
          message={flow.message}
          onRetry={keepFocus(flow.retry)}
          onReview={keepFocus(() => {
            onReview()
            setReviewed(true)
          })}
        />
      ) : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Cells
// ---------------------------------------------------------------------------

export function AssociationBadge({ association }: { association: Association<string> }) {
  return <StatusBadge kind="association" value={association.status} />
}

/** Target column: the associated Target with its status; unresolved reads Unresolved, never a guess. */
export function TargetCell({ row }: { row: SessionRow }) {
  const { target } = row.session
  return (
    <span className="inline-flex max-w-40 flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 whitespace-normal">
      {target.value && row.targetName ? (
        <Link to="/targets/$targetId" params={{ targetId: target.value }} className="underline-offset-2 hover:underline">
          {row.targetName}
        </Link>
      ) : null}
      <AssociationBadge association={target} />
    </span>
  )
}

export function EquipmentCell({ row }: { row: SessionRow }) {
  return (
    <span className="inline-flex max-w-48 flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 whitespace-normal">
      {row.trainName ? <span>{row.trainName}</span> : <UnknownValue label="Unknown" />}
      <AssociationBadge association={row.session.equipment} />
    </span>
  )
}

/** Locations holding copies; an offline location says so. Copies of one frame count once. */
export function LocationsCell({ row }: { row: SessionRow }) {
  return (
    <span className="inline-flex max-w-40 flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 whitespace-normal">
      {row.locations.map(({ location, availability }) => (
        <span key={location.id} className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
          {location.displayName}
          {availability === "offline" ? <StatusBadge kind="availability" value="offline" /> : null}
        </span>
      ))}
      {row.multiCopyFrames > 0 ? (
        <span className="text-xs text-muted-foreground">
          {row.multiCopyFrames === row.session.assetIds.length ? "every frame" : formatCount(row.multiCopyFrames)} in {row.locations.length} copies
        </span>
      ) : null}
    </span>
  )
}

/** Frame counts per quality state; Changed content and Verification pending are named separately (LIB-FR-09). */
export function QualityCounts({ breakdown }: { breakdown: QualityBreakdown }) {
  const parts: Array<{ key: string; text: string }> = []
  if (breakdown.usable.frames) parts.push({ key: "usable", text: `${formatCount(breakdown.usable.frames)} Usable` })
  if (breakdown.unusable.frames) parts.push({ key: "unusable", text: `${formatCount(breakdown.unusable.frames)} Unusable` })
  if (breakdown.unreviewed.frames) parts.push({ key: "unreviewed", text: `${formatCount(breakdown.unreviewed.frames)} Unreviewed` })
  return (
    <span className="inline-flex max-w-44 flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 whitespace-normal">
      {parts.length > 0 ? (
        <span>
          {parts.map((p, i) => (
            <Fragment key={p.key}>
              {i > 0 ? " · " : null}
              <span className="whitespace-nowrap">{p.text}</span>
            </Fragment>
          ))}
        </span>
      ) : null}
      {breakdown.changedContent.frames ? (
        <StatusBadge kind="quality" value="changed-content" label={`Changed content · ${formatCount(breakdown.changedContent.frames)}`} />
      ) : null}
      {breakdown.verificationPending.frames ? (
        <StatusBadge kind="quality" value="verification-pending" label={`Verification pending · ${formatCount(breakdown.verificationPending.frames)}`} />
      ) : null}
    </span>
  )
}

/** Scope column: blank when complete; Provisional while read; Incomplete scope when part was unreadable. */
export function ScopeCell({ scope }: { scope: SessionRow["session"]["scope"] }) {
  if (scope === "complete") return null
  return <StatusBadge kind="scanScope" value={scope} />
}

// ---------------------------------------------------------------------------
// Library scope (LIB-FR-03, LIB-FR-06, LIB-FR-07, LIB-AC-07)
// ---------------------------------------------------------------------------

const ITEM_WORD: Record<string, string> = {
  pending: "queued",
  running: "reading",
  done: "read",
  blocked: "blocked",
  uncertain: "incomplete scope",
  failed: "failed",
  skipped: "skipped",
}

/** While indexing runs, totals are provisional; after a restart, interrupted indexing offers Retry. */
export function IndexingNotices() {
  const active = useStore((s) => activeIndexOperations(s))
  const interrupted = useStore((s) => interruptedIndexOperations(s))
  return (
    <>
      {active.map((op) => (
        <Notice
          key={op.id}
          tone="info"
          title={op.status === "paused" ? "Indexing is paused. Totals are provisional." : "Indexing in progress. Totals are provisional."}
          actions={
            <Button size="sm" variant="outline" render={<Link to="/activity" />}>
              View progress
            </Button>
          }
        >
          Sessions appear as their metadata is read and can be inspected now.{" "}
          {op.items.map((item) => `${item.label}: ${ITEM_WORD[item.status] ?? item.status}`).join(" · ")}.
        </Notice>
      ))}
      {interrupted.map((op) => (
        <Notice
          key={op.id}
          tone="warning"
          title="Indexing was interrupted"
          actions={
            <>
              <Button size="sm" variant="outline" onClick={() => resumeOperation(op.id)}>
                Retry indexing
              </Button>
              <Button size="sm" variant="ghost" render={<Link to="/activity" />}>
                Open Activity
              </Button>
            </>
          }
        >
          PlateVault restarted while {op.title.replace(/^Indexing /, "")} was being read. Totals cover only what was read; Retry resumes from the recorded
          progress.
        </Notice>
      ))}
    </>
  )
}

function locationsLink(location: Location) {
  return { to: "/settings/locations" as const, search: { locationId: location.id } }
}

function ScopeActions({ row }: { row: LocationScopeRow }) {
  const { location } = row
  if (row.activity) {
    return (
      <span className="text-xs text-muted-foreground">{row.activity === "reading" ? "Being read now" : "Queued for indexing"}</span>
    )
  }
  if (row.availability === "offline") {
    return (
      <Button size="sm" variant="outline" render={<Link {...locationsLink(location)} />}>
        Locate or remap
      </Button>
    )
  }
  const denied = location.access === "denied"
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => startIndexing([location.id])}>
        {denied ? "Retry" : location.scanScope === "never" ? "Index now" : "Rescan"}
        <span className="sr-only"> {location.displayName}</span>
      </Button>
      {denied || location.scanScope === "incomplete" ? (
        <Button size="sm" variant="ghost" render={<Link {...locationsLink(location)} />}>
          Choose folder again
          <span className="sr-only"> for {location.displayName}</span>
        </Button>
      ) : null}
    </>
  )
}

function ScopeRow({ row }: { row: LocationScopeRow }) {
  const { location } = row
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 py-2">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{location.displayName}</span>
          <StatusBadge kind="role" value={location.role} />
          <StatusBadge kind="availability" value={row.availability} />
          {location.access === "denied" ? <StatusBadge kind="access" value="denied" /> : null}
          <StatusBadge kind="scanScope" value={row.state} />
        </div>
        <PathText path={location.path} className="text-muted-foreground" />
        <p className="text-xs text-muted-foreground">
          {location.lastIndexedAt ? `Last indexed ${formatDateTime(location.lastIndexedAt)}` : "Never indexed"}
          {row.availability === "offline" ? ". Last-observed metadata and decisions are kept; nothing here is available as an input." : ""}
        </p>
        {location.unreadablePaths.length > 0 ? (
          <div className="text-xs">
            <span className="text-muted-foreground">Unreadable at the last scan (not marked missing):</span>
            {location.unreadablePaths.map((path) => (
              <PathText key={path} path={path} />
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap justify-end gap-2">
        <ScopeActions row={row} />
      </div>
    </li>
  )
}

/**
 * "Totals cover …": names the locations behind every total and their scope,
 * so no total implies unscanned folders were included (LIB-FR-03, J19 S6).
 */
export function LibraryScopeStrip({ kind, className }: { kind: SessionKind; className?: string }) {
  const rows = useStore((s) => libraryScope(s, kind))
  const [open, setOpen] = useState(false)
  if (rows.length === 0) return null
  const covered = rows.filter((r) => r.state !== "never")
  const notIndexed = rows.filter((r) => r.state === "never")
  const flags: string[] = []
  const count = (n: number, word: string) => (n > 0 ? flags.push(`${n} ${word}`) : 0)
  count(rows.filter((r) => r.state === "provisional").length, "provisional")
  count(rows.filter((r) => r.state === "incomplete").length, "incomplete")
  count(rows.filter((r) => r.availability === "offline").length, "offline")
  count(rows.filter((r) => r.location.access === "denied").length, "access denied")
  const describe = (r: LocationScopeRow) => {
    const notes = [r.state === "provisional" ? "provisional" : null, r.state === "incomplete" ? "incomplete" : null, r.availability === "offline" ? "offline" : null]
    const note = notes.filter(Boolean).join(", ")
    return note ? `${r.location.displayName} (${note})` : r.location.displayName
  }
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("rounded-lg border px-3 py-2", className)}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <p className="min-w-0 flex-1 text-pretty">
          {covered.length > 0 ? (
            <>
              <span className="text-muted-foreground">Totals cover </span>
              {covered.map(describe).join(", ")}.
            </>
          ) : (
            <span className="text-muted-foreground">No location is indexed yet, so there are no totals.</span>
          )}
          {notIndexed.length > 0 ? <span className="text-muted-foreground"> Not indexed yet: {notIndexed.map((r) => r.location.displayName).join(", ")}.</span> : null}
        </p>
        <CollapsibleTrigger render={<Button size="sm" variant="ghost" />}>
          {open ? "Hide scope" : "Show scope"}
          {flags.length > 0 ? <span className="text-muted-foreground"> · {flags.join(" · ")}</span> : null}
          <ChevronDown aria-hidden="true" data-icon="inline-end" className={cn(open && "rotate-180")} />
        </CollapsibleTrigger>
      </div>
      <CollapsibleContent>
        <ul className="mt-2 divide-y border-t">
          {rows.map((row) => (
            <ScopeRow key={row.location.id} row={row} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}

/** Locations needing action: access denied or incomplete scope (Retry, Choose folder again) and offline (Locate or remap). */
export function ScopeProblemNotices({ kind }: { kind: SessionKind }) {
  const rows = useStore((s) => libraryScope(s, kind))
  const problems = rows.filter((r) => !r.activity && r.availability === "online" && (r.location.access === "denied" || r.state === "incomplete"))
  const offline = rows.filter((r) => r.availability === "offline")
  return (
    <>
      {problems.length > 0 ? (
        <Notice
          tone="warning"
          title={problems.length === 1 ? `${problems[0]!.location.displayName}: incomplete scope` : `${problems.length} locations have incomplete scope`}
          actions={problems.map((r) => (
            <ProblemActions key={r.location.id} row={r} many={problems.length > 1} />
          ))}
        >
          {problems
            .map((r) =>
              r.location.access === "denied"
                ? `${r.location.displayName}: access denied, so its folder could not be read.`
                : `${r.location.displayName}: ${r.location.unreadablePaths.length} unreadable folder${r.location.unreadablePaths.length === 1 ? "" : "s"}; readable folders were indexed.`,
            )
            .join(" ")}{" "}
          Frames there keep their last-observed metadata and are never marked missing.
        </Notice>
      ) : null}
      {offline.length > 0 ? (
        <Notice
          tone="offline"
          title={offline.length === 1 ? `${offline[0]!.location.displayName} is offline` : `${offline.length} locations are offline`}
          actions={offline.map((r) => (
            <Button key={r.location.id} size="sm" variant="outline" render={<Link {...locationsLink(r.location)} />}>
              Locate or remap{offline.length > 1 ? ` ${r.location.displayName}` : ""}
            </Button>
          ))}
        >
          {offline.length === 1 ? "Its" : "Their"} sessions stay listed with values last observed
          {offline.length === 1 && offline[0]!.location.lastIndexedAt ? ` ${formatDateTime(offline[0]!.location.lastIndexedAt)}` : " at the last scan"}. They count in captured
          totals and are not available as inputs until {offline.length === 1 ? "it is" : "they are"} reconnected.
        </Notice>
      ) : null}
    </>
  )
}

function ProblemActions({ row, many }: { row: LocationScopeRow; many: boolean }) {
  const name = many ? ` ${row.location.displayName}` : ""
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => startIndexing([row.location.id])}>
        {row.location.access === "denied" ? "Retry" : "Rescan"}
        {name}
      </Button>
      <Button size="sm" variant="ghost" render={<Link {...locationsLink(row.location)} />}>
        Choose folder again{name}
      </Button>
    </>
  )
}
