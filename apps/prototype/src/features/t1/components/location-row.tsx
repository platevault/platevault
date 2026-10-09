/**
 * One registered location (J19 S2-S3, LIB-FR-01): display name, path, role,
 * access, availability and scan scope, with the recovery notice that applies
 * (access denied, incomplete scope, offline), terse: the title names the
 * state, the actions fix it. Used by the setup steps and by Settings ›
 * Locations, where a `ContextMenuArea` around the list finds each row by its
 * menu key.
 */
import { Archive, FolderSearch, RotateCw } from "lucide-react"
import type { ReactNode } from "react"
import { useMessages } from "@/app/preferences"
import { PathText } from "@/components/app/data"
import { Notice } from "@/components/app/feedback"
import { menuKey } from "@/components/app/row-menu"
import { StatusBadge, statusMeta } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { locationAvailability } from "@/domain/library"
import type { Location, Operation, OperationItem } from "@/domain/types"
import { formatCount, formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useStore } from "@/store/core"
import { isSettled } from "@/store/operations"
import { framesInLocation } from "../lib/locations"

/** The newest indexing run that covered this location, and its item for it. */
export function latestIndexRun(operations: Record<string, Operation>, locationId: string): { op: Operation; item: OperationItem | null } | null {
  let latest: Operation | null = null
  for (const op of Object.values(operations)) {
    if (op.kind !== "index" || !op.scope.locationIds?.includes(locationId)) continue
    if (!latest || op.createdAt > latest.createdAt) latest = op
  }
  return latest ? { op: latest, item: latest.items.find((i) => i.id === locationId) ?? null } : null
}

export interface LocationRowProps {
  location: Location
  /** Opened from `?locationId=` or the detail sheet. */
  current?: boolean
  /** Buttons at the end of the row (Rescan, More actions, Remove). */
  actions?: ReactNode
  /** The row actions already offer Rescan, so the Incomplete scope notice does not repeat it. */
  actionsIncludeRescan?: boolean
  /** Recovery handlers; the row decides which apply. */
  onChooseAgain: (location: Location) => void
  onRetry: (location: Location) => void
  onLocate?: (location: Location) => void
  /** Opens the Retire location review (LIB-FR-15); offered on an offline row that holds frames. */
  onRetire?: (location: Location) => void
  /** Outcome of the last recovery action on this row (refusal or failed write). */
  feedback?: ReactNode
  /** Pills beside the role, e.g. the Default archive location. */
  badges?: ReactNode
  /** Heading level of the name inside its section. */
  headingLevel?: 3 | 4
}

// Recovery notices sit inside the row's card: inline, without a second border or surface.
const INLINE_NOTICE = "rounded-none border-0 bg-transparent px-0 py-0"

export function LocationRow({ location, current, actions, actionsIncludeRescan = false, onChooseAgain, onRetry, onLocate, onRetire, feedback, badges, headingLevel = 3 }: LocationRowProps) {
  const m = useMessages()
  const availability = useStore((s) => locationAvailability(s.disk, location))
  const volume = useStore((s) => s.disk.volumes[location.volumeId])
  const frames = useStore((s) => framesInLocation(s.catalog, location.id))
  const run = useStore((s) => latestIndexRun(s.operations, location.id))
  const indexing = run !== null && !isSettled(run.op.status) && run.op.status !== "interrupted" && (run.item?.status === "running" || run.item?.status === "pending")
  const Heading = headingLevel === 3 ? "h3" : "h4"
  const offline = availability === "offline"
  const retired = availability === "retired"
  const denied = !offline && !retired && location.access === "denied"
  const incomplete = !offline && !denied && !retired && location.scanScope === "incomplete"

  // A scan that could not read the folder is an attempt, never an index; a denied folder with nothing read shows no frame count.
  const facts = [
    location.lastIndexedAt ? (denied ? m.location_last_attempt({ date: formatDateTime(location.lastIndexedAt) }) : m.location_indexed({ date: formatDateTime(location.lastIndexedAt) })) : null,
    frames > 0 || (location.lastIndexedAt && !denied) ? m.location_frames({ count: frames, n: formatCount(frames) }) : null,
  ].filter((fact) => fact !== null)
  const nominal = [
    !offline && !retired && location.access === "ok" ? statusMeta("access", "ok").label : null,
    availability === "online" ? statusMeta("availability", "online").label : null,
    !indexing && !offline && !retired && location.scanScope === "complete" ? statusMeta("scanScope", "complete").label : null,
  ].filter((label) => label !== null)

  return (
    <li
      aria-current={current ? "true" : undefined}
      data-location-id={location.id}
      {...menuKey(location.id)}
      className={cn("space-y-2 rounded-md border bg-card p-3", current && "border-primary/60 shadow-[inset_2px_0_0_var(--primary)]")}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-56 space-y-0.5">
          <Heading className="text-sm font-medium">{location.displayName}</Heading>
          <PathText path={location.path} className="text-muted-foreground" />
        </div>
        {/* Only health that needs attention is a badge. Nominal access, availability and scope (J19 S2) read as one quiet line. */}
        <div className="flex flex-wrap items-center gap-1.5" aria-label={m.location_state_group({ name: location.displayName })} role="group">
          <StatusBadge kind="role" value={location.role} />
          {badges}
          {/* While offline or retired the last-observed access and scope are history, not current state. */}
          {offline || retired || location.access === "ok" ? null : <StatusBadge kind="access" value={location.access} />}
          {availability === "online" ? null : <StatusBadge kind="availability" value={availability} />}
          {indexing ? (
            <StatusBadge kind="operation" value="running" label={m.location_indexing()} />
          ) : offline || retired || location.scanScope === "complete" ? null : (
            <StatusBadge kind="scanScope" value={location.scanScope} />
          )}
          {nominal.length ? <span className="text-xs text-muted-foreground">{nominal.join(" · ")}</span> : null}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      {facts.length ? <p className="text-xs text-muted-foreground tabular-nums">{facts.join(" · ")}</p> : null}

      {offline ? (
        <Notice
          tone="offline"
          className={INLINE_NOTICE}
          title={volume ? m.location_volume_not_mounted({ name: volume.name }) : m.location_volume_missing()}
          actions={
            frames > 0 && (onLocate || onRetire) ? (
              <>
                {onLocate ? (
                  <Button size="sm" variant="outline" onClick={() => onLocate(location)}>
                    <FolderSearch aria-hidden="true" data-icon="inline-start" />
                    {m.location_locate_or_remap()}
                  </Button>
                ) : null}
                {onRetire ? (
                  <Button size="sm" variant="outline" onClick={() => onRetire(location)}>
                    <Archive aria-hidden="true" data-icon="inline-start" />
                    {m.location_retire()}
                  </Button>
                ) : null}
              </>
            ) : undefined
          }
        />
      ) : null}

      {denied ? (
        <Notice
          tone="warning"
          className={INLINE_NOTICE}
          title={m.status_access_denied()}
          // LIB-FR-07 names Choose folder again or Retry for a denied folder, so Retry stays even beside the row's Rescan.
          actions={
            <>
              <Button size="sm" variant="outline" onClick={() => onChooseAgain(location)}>
                <FolderSearch aria-hidden="true" data-icon="inline-start" />
                {m.location_choose_folder_again()}
              </Button>
              <Button size="sm" variant="outline" disabled={indexing} onClick={() => onRetry(location)}>
                <RotateCw aria-hidden="true" data-icon="inline-start" />
                {m.verb_retry()}
              </Button>
            </>
          }
        />
      ) : null}

      {incomplete ? (
        <Notice
          tone="warning"
          className={INLINE_NOTICE}
          title={location.unreadablePaths.length > 0 ? m.location_incomplete_unread({ count: location.unreadablePaths.length }) : m.status_incomplete_scope()}
          actions={
            actionsIncludeRescan ? undefined : (
              <Button size="sm" variant="outline" disabled={indexing} onClick={() => onRetry(location)}>
                <RotateCw aria-hidden="true" data-icon="inline-start" />
                {m.location_rescan()}
              </Button>
            )
          }
        >
          {location.unreadablePaths.length > 0 ? (
            <ul className="space-y-0.5">
              {location.unreadablePaths.map((path) => (
                <li key={path}>
                  <PathText path={path} />
                </li>
              ))}
            </ul>
          ) : null}
        </Notice>
      ) : null}

      {retired ? (
        <Notice tone="info" className={INLINE_NOTICE} title={m.location_retired_copies({ date: formatDateTime(location.retiredAt!), count: frames, copies: formatCount(frames) })} />
      ) : null}

      {feedback}
    </li>
  )
}
