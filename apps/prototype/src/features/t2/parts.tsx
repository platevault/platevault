/**
 * T2 UI building blocks shared by the library pages: the commit flow behind
 * `SaveState` (D08), association and quality cells, and the library status
 * row with its indexing state, scope and per-location actions.
 */
import { Link } from "@tanstack/react-router"
import { ChevronDown, TriangleAlert } from "lucide-react"
import { Fragment, type ReactNode, useEffect, useRef, useState } from "react"
import { PathText } from "@/components/app/data"
import { announce, SaveState, UnknownValue } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import type { QualityBreakdown } from "@/domain/derive"
import type { Association, Location, Operation } from "@/domain/types"
import { formatCount, formatDateTime, plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { type CommitResult, useStore } from "@/store/core"
import { resumeOperation, startIndexing } from "@/store/operations"
import { activeIndexOperations, interruptedIndexOperations, libraryScope, type LocationScopeRow, type SessionKind, type SessionRow, targetNeedsReview } from "./model"

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
  // SaveState announces its own changes and failed or stale on appearing; a
  // save that makes it appear already "Saved" is announced here, once.
  const shown = useRef(state)
  useEffect(() => {
    if (!shown.current && state === "saved") announce("Saved")
    shown.current = state
  }, [state])
  // Retry and Review remove their own button; move focus to this status first, so it never drops to the page (WCAG 2.4.3).
  const keepFocus = (action: () => void) => () => {
    holder.current?.focus()
    action()
    // Failed again: its Retry is still there, so go back to it.
    requestAnimationFrame(() => holder.current?.querySelector<HTMLElement>("button")?.focus())
  }
  return (
    <div ref={holder} tabIndex={-1} className={cn("outline-none", className)}>
      {/* Mounted before Review, so its outcome is announced (WCAG 4.1.3). */}
      <p role="status" className={showReviewed ? "text-xs text-pretty text-muted-foreground" : "sr-only"}>
        {showReviewed ? "Showing the current revision. Make your change again to save it." : ""}
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

/**
 * Table cell padding that follows the density token, so one-line rows are
 * exactly `--row-h` and two-line rows grow with it. Compact density drops
 * the stacking: secondary lines and settled badges (Associated, Confirmed)
 * stay for assistive technology only, problem badges sit inline, and a row
 * that fits its frame is one `--row-h` line.
 */
export const DENSITY_CELL = "py-[max(0.25rem,calc((var(--row-h)-1.25rem)/2))]"
/**
 * From 1280 px the short cells stay on one line, so only a cell with an extra problem badge wraps
 * (Needs review under its Target, Changed content under the frame count); narrower frames wrap instead of scrolling.
 */
const INLINE_IN_COMPACT = "compact:max-w-none compact:py-0 xl:compact:flex-nowrap xl:compact:whitespace-nowrap"
const WRAP_IN_COMPACT = "compact:max-w-none compact:py-0"
/** A settled association needs no action, so compact keeps it for assistive technology only. */
const SETTLED: Record<string, true> = { confirmed: true, associated: true }

export function AssociationBadge({ association }: { association: Association<string> }) {
  return <StatusBadge kind="association" value={association.status} />
}

function CellAssociationBadge({ association, quiet = false }: { association: Association<string>; quiet?: boolean }) {
  return <StatusBadge kind="association" value={association.status} className={quiet || SETTLED[association.status] ? "compact:sr-only" : undefined} />
}

/** Target column: the associated Target with its status; unresolved reads Unresolved with Needs review, never a guess (LIB-AC-03). */
export function TargetCell({ row }: { row: SessionRow }) {
  const { target } = row.session
  const needsReview = target.status === "unresolved" && targetNeedsReview(row.session)
  return (
    <span className={cn("inline-flex max-w-40 flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 whitespace-normal", WRAP_IN_COMPACT)}>
      {target.value && row.targetName ? (
        <Link to="/targets/$targetId" params={{ targetId: target.value }} className="underline-offset-2 hover:underline">
          {row.targetName}
        </Link>
      ) : null}
      {/* Compact shows one badge: Needs review carries the action when the Target is also unresolved. */}
      <CellAssociationBadge association={target} quiet={needsReview} />
      {needsReview ? <StatusBadge kind="association" value="needs-review" /> : null}
    </span>
  )
}

export function EquipmentCell({ row }: { row: SessionRow }) {
  return (
    <span className={cn("inline-flex max-w-48 flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 whitespace-normal", INLINE_IN_COMPACT)}>
      {row.trainName ? <span>{row.trainName}</span> : <UnknownValue label="Unknown" />}
      <CellAssociationBadge association={row.session.equipment} />
    </span>
  )
}

/** Locations holding copies; an offline location says so. Copies of one frame count once; copies whose bytes differ read Conflicting copies. */
export function LocationsCell({ row }: { row: SessionRow }) {
  return (
    <span className={cn("inline-flex max-w-40 flex-wrap items-center gap-x-2 gap-y-0.5 py-0.5 whitespace-normal", INLINE_IN_COMPACT)}>
      {row.locations.map(({ location, availability }) => (
        <span key={location.id} className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5 xl:compact:flex-nowrap">
          {location.displayName}
          {availability === "offline" ? <StatusBadge kind="availability" value="offline" /> : null}
        </span>
      ))}
      {row.multiCopyFrames > 0 ? (
        <span className="text-xs text-muted-foreground">
          {row.multiCopyFrames === row.session.assetIds.length ? "every frame" : formatCount(row.multiCopyFrames)} in {row.locations.length} copies
        </span>
      ) : null}
      {row.conflictingFrames > 0 ? <StatusBadge kind="copies" value="conflicting" label={`Conflicting copies · ${formatCount(row.conflictingFrames)}`} /> : null}
    </span>
  )
}

/**
 * Frame counts per quality state; Changed content and Verification pending are named separately (LIB-FR-09).
 * `secondary`: the counts sit under a frame count, so compact keeps the plain counts for assistive technology only.
 */
export function QualityCounts({ breakdown, secondary = false }: { breakdown: QualityBreakdown; secondary?: boolean }) {
  const parts: Array<{ key: string; text: string }> = []
  if (breakdown.usable.frames) parts.push({ key: "usable", text: `${formatCount(breakdown.usable.frames)} Usable` })
  if (breakdown.unusable.frames) parts.push({ key: "unusable", text: `${formatCount(breakdown.unusable.frames)} Unusable` })
  if (breakdown.unreviewed.frames) parts.push({ key: "unreviewed", text: `${formatCount(breakdown.unreviewed.frames)} Unreviewed` })
  return (
    <span className={cn("inline-flex max-w-44 flex-wrap items-center gap-x-2 gap-y-0.5 whitespace-normal", INLINE_IN_COMPACT)}>
      {parts.length > 0 ? (
        <span className={secondary ? "compact:sr-only" : undefined}>
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

/** Index operations reading or interrupted now; their per-location progress is listed in the details. */
function IndexingDetails({ active, interrupted }: { active: Operation[]; interrupted: Operation[] }) {
  return (
    <>
      {active.map((op) => (
        <li key={op.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 py-2">
          <p className="text-pretty">
            <span className="font-medium">{op.status === "paused" ? "Indexing is paused." : "Indexing in progress."}</span>{" "}
            <span className="text-muted-foreground">
              Sessions appear as their metadata is read and can be inspected now.{" "}
              {op.items.map((item) => `${item.label}: ${ITEM_WORD[item.status] ?? item.status}`).join(" · ")}.
            </span>
          </p>
        </li>
      ))}
      {interrupted.map((op) => (
        <li key={op.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 py-2">
          <p className="text-pretty">
            <span className="font-medium">Indexing was interrupted.</span>{" "}
            <span className="text-muted-foreground">
              PlateVault restarted while {op.title.replace(/^Indexing /, "")} was being read. Totals cover only what was read; Retry resumes from the recorded progress.
            </span>
          </p>
          <Button size="sm" variant="ghost" render={<Link to="/activity" />}>
            Open Activity
          </Button>
        </li>
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

/** A page-specific item that needs attention, listed in the library status row (for example sessions with no Target). */
export interface LibraryNote {
  id: string
  /** Short sentence fragment shown in the summary line. */
  summary: string
  /** Longer explanation shown in the details. */
  detail: string
  action?: ReactNode
}

/**
 * One library status row for Targets, Sessions and Target: indexing state,
 * "Totals cover …" naming the locations behind every total and their scope
 * (LIB-FR-03, J19 S6), and what needs attention. Location rows with their
 * actions sit behind one disclosure. Offline state is left to the header
 * status and the location list rather than repeated as a notice.
 */
export function LibraryStatus({ kind, notes = [], className }: { kind: SessionKind; notes?: LibraryNote[]; className?: string }) {
  const rows = useStore((s) => libraryScope(s, kind))
  const active = useStore((s) => activeIndexOperations(s))
  const interrupted = useStore((s) => interruptedIndexOperations(s))
  const [open, setOpen] = useState(false)
  if (rows.length === 0 && active.length === 0 && interrupted.length === 0 && notes.length === 0) return null
  const covered = rows.filter((r) => r.state !== "never")
  const notIndexed = rows.filter((r) => r.state === "never")
  const describe = (r: LocationScopeRow) => {
    const flags = [r.state === "provisional" ? "provisional" : null, r.state === "incomplete" ? "incomplete" : null, r.availability === "offline" ? "offline" : null]
    const note = flags.filter(Boolean).join(", ")
    return note ? `${r.location.displayName} (${note})` : r.location.displayName
  }
  const problems = rows.filter((r) => !r.activity && r.availability === "online" && (r.location.access === "denied" || r.state === "incomplete"))
  const attention = [
    ...problems.map((r) =>
      r.location.access === "denied" ? `${r.location.displayName}: access denied` : `${r.location.displayName}: ${plural(r.location.unreadablePaths.length, "unreadable folder")}`,
    ),
    ...notes.map((n) => n.summary),
  ]
  const paused = active.length > 0 && active.every((op) => op.status === "paused")
  return (
    <Collapsible open={open} onOpenChange={setOpen} className={cn("rounded-lg border px-3 py-2", className)}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 text-sm">
        <div className="min-w-0 flex-1 space-y-0.5 py-1">
          <p className="text-pretty">
            <span role="status">
              {active.length > 0 ? <span className="font-medium">{paused ? "Indexing is paused. " : "Indexing in progress. "}Totals are provisional. </span> : null}
              {interrupted.length > 0 ? <span className="font-medium">Indexing was interrupted. </span> : null}
            </span>
            {covered.length > 0 ? (
              <>
                <span className="text-muted-foreground">Totals cover </span>
                {covered.map(describe).join(", ")}.
              </>
            ) : rows.length > 0 ? (
              <span className="text-muted-foreground">No location is indexed yet, so there are no totals.</span>
            ) : null}
            {notIndexed.length > 0 ? <span className="text-muted-foreground"> Not indexed yet: {notIndexed.map((r) => r.location.displayName).join(", ")}.</span> : null}
          </p>
          {attention.length > 0 ? (
            <p className="flex items-start gap-1.5 text-pretty text-warning">
              <TriangleAlert aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
              <span>
                <span className="sr-only">Needs attention: </span>
                {attention.join(" · ")}
              </span>
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          {interrupted.length > 0 ? (
            <Button size="sm" variant="outline" onClick={() => interrupted.forEach((op) => resumeOperation(op.id))}>
              Retry indexing
            </Button>
          ) : null}
          {active.length > 0 ? (
            <Button size="sm" variant="outline" render={<Link to="/activity" />}>
              View progress
            </Button>
          ) : null}
          <CollapsibleTrigger render={<Button size="sm" variant="ghost" />}>
            {open ? "Hide details" : "Show details"}
            <ChevronDown aria-hidden="true" data-icon="inline-end" className={cn(open && "rotate-180")} />
          </CollapsibleTrigger>
        </div>
      </div>
      <CollapsibleContent>
        <ul className="mt-2 divide-y border-t text-sm">
          <IndexingDetails active={active} interrupted={interrupted} />
          {notes.map((note) => (
            <li key={note.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-x-4 gap-y-1 py-2">
              <p className="text-pretty">
                <span className="font-medium">{note.summary}.</span> <span className="text-muted-foreground">{note.detail}</span>
              </p>
              {note.action ? <div className="flex flex-wrap justify-end gap-2">{note.action}</div> : null}
            </li>
          ))}
          {rows.map((row) => (
            <ScopeRow key={row.location.id} row={row} />
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  )
}
