/**
 * One registered location (J19 S2-S3, LIB-FR-01): display name, path, role,
 * access, availability and scan scope, with the recovery notice that applies
 * (access denied, incomplete scope, offline). Used by the setup steps and by
 * Settings › Locations.
 */
import { FolderSearch, RotateCw } from "lucide-react"
import type { ReactNode } from "react"
import { PathText } from "@/components/app/data"
import { Notice } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { locationAvailability } from "@/domain/derive"
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
  /** Recovery handlers; the row decides which apply. */
  onChooseAgain: (location: Location) => void
  onRetry: (location: Location) => void
  onLocate?: (location: Location) => void
  /** Outcome of the last recovery action on this row (refusal or failed write). */
  feedback?: ReactNode
  /** Heading level of the name inside its section. */
  headingLevel?: 3 | 4
}

export function LocationRow({ location, current, actions, onChooseAgain, onRetry, onLocate, feedback, headingLevel = 3 }: LocationRowProps) {
  const availability = useStore((s) => locationAvailability(s.disk, location))
  const volume = useStore((s) => s.disk.volumes[location.volumeId])
  const frames = useStore((s) => framesInLocation(s.catalog, location.id))
  const run = useStore((s) => latestIndexRun(s.operations, location.id))
  const indexing = run !== null && !isSettled(run.op.status) && run.op.status !== "interrupted" && (run.item?.status === "running" || run.item?.status === "pending")
  const Heading = headingLevel === 3 ? "h3" : "h4"
  const offline = availability === "offline"
  const denied = !offline && location.access === "denied"
  const incomplete = !offline && !denied && location.scanScope === "incomplete"

  const facts = [
    location.lastIndexedAt ? `Last indexed ${formatDateTime(location.lastIndexedAt)}` : null,
    frames > 0 || location.lastIndexedAt ? `${formatCount(frames)} ${frames === 1 ? "frame" : "frames"} read` : null,
    location.managed ? "Accepts reviewed filing" : null,
  ].filter((fact) => fact !== null)

  return (
    <li
      aria-current={current ? "true" : undefined}
      data-location-id={location.id}
      className={cn("space-y-2 rounded-lg border bg-card p-3", current && "border-primary/60 shadow-[inset_2px_0_0_var(--primary)]")}
    >
      <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1 basis-56 space-y-0.5">
          <Heading className="text-sm font-medium">{location.displayName}</Heading>
          <PathText path={location.path} className="text-muted-foreground" />
        </div>
        <div className="flex flex-wrap items-center gap-1.5" aria-label={`${location.displayName} state`} role="group">
          <StatusBadge kind="role" value={location.role} />
          {/* While offline the last-observed access and scope are history, not current state; the Offline notice says so. */}
          {offline ? null : <StatusBadge kind="access" value={location.access} />}
          <StatusBadge kind="availability" value={availability} />
          {indexing ? (
            <StatusBadge kind="operation" value="running" label="Indexing" />
          ) : (
            offline ? null : <StatusBadge kind="scanScope" value={location.scanScope} />
          )}
        </div>
        {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
      </div>

      {/* The "Not indexed" badge already says a location was never indexed; this line carries only facts the badges do not. */}
      {facts.length ? <p className="text-xs text-muted-foreground tabular-nums">{facts.join(" · ")}</p> : null}

      {offline ? (
        <Notice
          tone="offline"
          title={`${location.displayName} is offline`}
          actions={
            onLocate && frames > 0 ? (
              <Button size="sm" variant="outline" onClick={() => onLocate(location)}>
                <FolderSearch aria-hidden="true" data-icon="inline-start" />
                Locate or remap
              </Button>
            ) : undefined
          }
        >
          Volume {volume?.name ?? "unknown"} is not mounted. Its frames keep their last-observed metadata and quality decisions
          {location.lastIndexedAt ? ` from ${formatDateTime(location.lastIndexedAt)}` : ""} and are not offered as inputs. Reconnect it, or locate the
          folder on another volume.
        </Notice>
      ) : null}

      {denied ? (
        <Notice
          tone="warning"
          title="Access denied"
          actions={
            <>
              <Button size="sm" variant="outline" onClick={() => onChooseAgain(location)}>
                <FolderSearch aria-hidden="true" data-icon="inline-start" />
                Choose folder again
              </Button>
              <Button size="sm" variant="outline" disabled={indexing} onClick={() => onRetry(location)}>
                <RotateCw aria-hidden="true" data-icon="inline-start" />
                Retry
              </Button>
            </>
          }
        >
          PlateVault could not read {location.path}. None of its files are marked missing, and other locations keep indexing.
        </Notice>
      ) : null}

      {incomplete ? (
        <Notice
          tone="warning"
          title="Incomplete scope"
          actions={
            <Button size="sm" variant="outline" disabled={indexing} onClick={() => onRetry(location)}>
              <RotateCw aria-hidden="true" data-icon="inline-start" />
              Rescan
            </Button>
          }
        >
          {location.unreadablePaths.length > 0 ? (
            <>
              {location.unreadablePaths.length === 1 ? "1 folder" : `${location.unreadablePaths.length} folders`} could not be read:
              <ul className="my-1 space-y-0.5">
                {location.unreadablePaths.map((path) => (
                  <li key={path}>
                    <PathText path={path} />
                  </li>
                ))}
              </ul>
              Frames there read Unknown, never missing, and their sessions keep their last-observed metadata.
            </>
          ) : (
            "Indexing stopped before it finished. Sessions read so far are kept; the rest reads Unknown until you rescan."
          )}
        </Notice>
      ) : null}

      {feedback}
    </li>
  )
}
