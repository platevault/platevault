/**
 * The status bar (shell-owned; round 5 P-SB3, F7, D-W92, D-W144): the
 * library reads behind the window's bottom bar. The look lives in
 * `@/components/app/status-bar`.
 *
 * - Left: the locations online, from `libraryListLocations`, opening
 *   Settings › Locations; then the selection count a list reports with
 *   `useStatusSelection`.
 * - Middle: the scans running now, newest first, each opening Activity,
 *   with Cancel (`libraryCancelScan`). Two show from 1440 px, one below,
 *   the rest under "+N".
 * - Right: one counter per severity with issues, from `libraryIssues`
 *   (counts only). Each opens a menu of the pages its issues are on, each
 *   filtered to the affected rows, with its count. There is no Issues hub,
 *   and Dismiss and Restore stay on the rows (issue-actions.ts).
 *
 * Every link appears once its page's route is registered (navigation.ts);
 * until then the item shows its words without a link. A failed read stays
 * visible in the bar. Scans refresh these reads when they settle; a write
 * that changes issues invalidates `libraryKey("libraryIssues")` itself.
 */
import { useQuery } from "@tanstack/react-query"
import { CircleAlert, CircleCheck, HardDrive } from "lucide-react"
import { type RefObject, useRef, useState } from "react"
import { useRefreshOnEvent } from "@/api/events"
import { type IssuePage, type IssueSeverity, type IssueView, type Issue as LibraryIssue, library, type Location, SCAN_PROGRESS_EVENT, type ScanOperation } from "@/api/ipc"
import { libraryKey, libraryQuery } from "@/api/query"
import { toast } from "@/components/app/feedback"
import { ISSUE_SEVERITY_ICON } from "@/components/app/issue-copy"
import { failureMessage } from "@/components/app/run-result"
import type { StepLink } from "@/components/app/contracts"
import {
  ListOperationRow,
  ListPopover,
  ListRows,
  StatusBar as StatusBarFrame,
  StatusCounter,
  type StatusCounterPage,
  StatusGroup,
  StatusLink,
  StatusOperation,
  StatusSelection,
  StatusText,
} from "@/components/app/status-bar"
import { useSelectionContext } from "@/components/app/status-selection"
import { formatCount } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { useMediaQuery } from "@/lib/use-media-query"
import { useRoutable } from "./navigation"
import { useMessages } from "./preferences"

const NARROW = "(max-width: 767.98px)"
/** Two running scans show inline from here; below it one. */
const WIDE = "(min-width: 1440px)"
/** The newest scans the bar reads; running ones are always among them. */
const RECENT_SCANS = 20

const SEVERITY_ORDER: readonly IssueSeverity[] = ["danger", "warning", "info"]

/** The Issues facet value each owning page filters its rows by (issue-actions.ts). */
const WITH_ISSUES = { issues: "with-issues" }

/** The page an issue's action opens, filtered to the rows it is on. */
export function issuePageLink(page: IssuePage): StepLink {
  switch (page.kind) {
    case "sessions":
      return { to: "/sessions", search: WITH_ISSUES }
    case "locations":
      return { to: "/settings/locations", search: WITH_ISSUES }
    case "activity":
      return { to: "/activity", search: WITH_ISSUES }
    case "project":
      return { to: "/projects/$projectId", params: { projectId: page.id }, search: WITH_ISSUES }
  }
}

function samePage(a: IssuePage, b: IssuePage): boolean {
  return a.kind === b.kind && (a.kind !== "project" || (b.kind === "project" && a.id === b.id))
}

/** The words of an issue page: its area, or the Project its issues name. */
function pageName(m: Messages, page: IssuePage, issues: readonly LibraryIssue[]): string {
  switch (page.kind) {
    case "sessions":
      return m.nav_sessions()
    case "locations":
      return m.common_locations()
    case "activity":
      return m.nav_activity()
    case "project":
      return issues.find((issue) => samePage(issue.page, page))?.name ?? m.nav_projects()
  }
}

/** A counter's words: "2 errors", "1 warning", "3 info". */
function counterLabel(m: Messages, severity: IssueSeverity, count: number): string {
  if (severity === "danger") return m.status_bar_errors({ count })
  if (severity === "warning") return m.status_bar_warnings({ count })
  return m.status_bar_info({ count })
}

/** The pages one severity's issues are on, in the library's order, each with its count; a page whose route is not registered yet is left out. */
export function counterPages(m: Messages, view: IssueView, severity: IssueSeverity, routable: (to: string) => boolean): StatusCounterPage[] {
  return view.pages
    .filter((page) => page.severity === severity)
    .map((page) => ({ page, link: issuePageLink(page.page) }))
    .filter(({ link }) => routable(link.to))
    .map(({ page, link }) => ({
      id: `${severity}:${JSON.stringify(page.page)}`,
      link,
      label: m.status_bar_issue_page({ page: pageName(m, page.page, view.issues), count: formatCount(page.count) }),
    }))
}

/** The library's issues, read again whenever a scan settles. */
export function useLibraryIssues() {
  useRefreshOnEvent(SCAN_PROGRESS_EVENT, libraryKey("libraryIssues"), (event) => event.state !== "running")
  return useQuery(libraryQuery("libraryIssues"))
}

// ---------------------------------------------------------------------------
// Left: locations and the selection
// ---------------------------------------------------------------------------

function onlineOf(locations: readonly { location: Location }[]): { online: number; total: number } {
  const live = locations.filter(({ location }) => location.lifecycle === "active")
  return { total: live.length, online: live.filter(({ location }) => location.availability === "available").length }
}

function LocationsItem({ narrow }: { narrow: boolean }) {
  const m = useMessages()
  const routable = useRoutable()
  useRefreshOnEvent(SCAN_PROGRESS_EVENT, libraryKey("libraryListLocations"), (event) => event.state !== "running")
  const read = useQuery(libraryQuery("libraryListLocations"))
  if (read.isPending) return null
  if (read.isError) {
    return (
      <StatusText data-status-locations="failed">
        <CircleAlert role="img" aria-label={m.status_bar_locations_failed()} className="size-3 text-destructive" />
      </StatusText>
    )
  }
  const { online, total } = onlineOf(read.data)
  const text = total === 0 ? m.storage_no_locations() : m.status_bar_locations_online({ online, total })
  if (routable("/settings/locations")) return <StatusLink to="/settings/locations" icon={HardDrive} label={m.common_locations()} text={text} compact={narrow} data-status-locations="" />
  return <StatusText data-status-locations="">{`${m.common_locations()}: ${text}`}</StatusText>
}

function SelectionItem() {
  const m = useMessages()
  const selection = useSelectionContext()
  if (!selection) return null
  return <StatusSelection>{selection.total !== null ? m.status_bar_selected_of({ count: selection.count, total: selection.total }) : m.status_bar_selected({ count: selection.count })}</StatusSelection>
}

// ---------------------------------------------------------------------------
// Middle: running scans
// ---------------------------------------------------------------------------

function useRunningScans(): ScanOperation[] {
  const read = useQuery(libraryQuery("libraryListOperations", null, 0, RECENT_SCANS))
  const running = (read.data ?? []).filter((scan) => scan.state === "running")
  // A scan that starts or settles changes the list; progress within a listed scan does not.
  useRefreshOnEvent(SCAN_PROGRESS_EVENT, libraryKey("libraryListOperations"), (event) => event.state !== "running" || !running.some((scan) => scan.id === event.operationId))
  return running
}

/** A cancelled scan settles through its next event; a refused Cancel says why. */
async function cancelScan(m: Messages, scan: ScanOperation): Promise<void> {
  const result = await library.libraryCancelScan(scan.id)
  if (!result.ok) toast({ message: failureMessage(m, result.failure) })
}

function ScanItem({ scan, name, expanded = false, onCancel }: { scan: ScanOperation; name: string; expanded?: boolean; onCancel: () => void }) {
  const m = useMessages()
  // A scan discovers its size as it goes: it pulses, with no percentage.
  return <StatusOperation id={scan.id} title={m.op_index_title_one({ name })} href="/activity" value={null} word="" expanded={expanded} onCancel={onCancel} />
}

/** Running scans, newest first: `inline` in the bar, the rest under "+N". */
function RunningScans({ running, inline, names, group }: { running: ScanOperation[]; inline: ScanOperation[]; names: Map<string, string>; group: RefObject<HTMLDivElement | null> }) {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  const rows = useRef<HTMLUListElement>(null)
  const rest = running.length - inline.length
  const name = (scan: ScanOperation) => names.get(scan.locationId) ?? m.common_locations()
  // Focus moves before the cancelled item unmounts (WCAG 2.4.3): to the next scan in its list, else to the first issue counter.
  const cancel = (scan: ScanOperation, listed: boolean) => {
    const listGoes = listed && rest <= 1
    const scans = listGoes ? [] : listed ? running : inline
    const next = scans[scans.indexOf(scan) + 1]
    const scope = listed ? rows.current : group.current
    const footer = group.current?.closest("footer")
    const target = (next ? scope?.querySelector<HTMLElement>(`[data-operation="${next.id}"] a`) : null) ?? footer?.querySelector<HTMLElement>("[data-status-counter]")
    target?.focus()
    if (listGoes) setOpen(false)
    void cancelScan(m, scan)
  }
  return (
    <StatusGroup ref={group} label={m.status_running()} layout="work" data-status-work="">
      {inline.map((scan) => (
        <ScanItem key={scan.id} scan={scan} name={name(scan)} onCancel={() => cancel(scan, false)} />
      ))}
      {rest > 0 ? (
        <ListPopover open={open} onOpenChange={setOpen} align="center" width="sm" label={m.status_running()} trigger={{ label: m.status_bar_more_running({ count: rest }), content: `+${rest}`, "data-status-more": "work" }}>
          <ListRows ref={rows} dense>
            {running.map((scan) => (
              <ListOperationRow key={scan.id}>
                <ScanItem scan={scan} name={name(scan)} expanded onCancel={() => cancel(scan, true)} />
              </ListOperationRow>
            ))}
          </ListRows>
        </ListPopover>
      ) : null}
    </StatusGroup>
  )
}

/** The running scans, once Activity, where each opens, is registered. */
function RunningWork({ wide }: { wide: boolean }) {
  const running = useRunningScans()
  const locations = useQuery(libraryQuery("libraryListLocations"))
  const group = useRef<HTMLDivElement>(null)
  if (running.length === 0) return null
  const names = new Map((locations.data ?? []).map(({ location }) => [location.id, location.name]))
  return <RunningScans running={running} inline={running.slice(0, wide ? 2 : 1)} names={names} group={group} />
}

// ---------------------------------------------------------------------------
// Right: the issue counters
// ---------------------------------------------------------------------------

function IssueCounters() {
  const m = useMessages()
  const routable = useRoutable()
  const read = useLibraryIssues()
  if (read.isPending) return null
  if (read.isError) {
    return (
      <StatusGroup label={m.issues_title()} data-status-issues="failed">
        <StatusText>
          <CircleAlert role="img" aria-label={m.status_bar_issues_failed()} className="size-3 text-destructive" />
        </StatusText>
      </StatusGroup>
    )
  }
  const view = read.data
  const total = view.counts.danger + view.counts.warning + view.counts.info
  return (
    <StatusGroup label={m.issues_title()} data-status-issues={total === 0 ? "none" : total}>
      {total === 0 ? (
        <StatusText>
          <CircleCheck role="img" aria-label={m.issues_none()} className="size-3" />
        </StatusText>
      ) : (
        SEVERITY_ORDER.map((severity) => {
          const count = view.counts[severity]
          if (count === 0) return null
          return (
            <StatusCounter
              key={severity}
              label={counterLabel(m, severity, count)}
              icon={ISSUE_SEVERITY_ICON[severity]}
              tone={severity}
              count={count}
              pages={counterPages(m, view, severity, routable)}
              data-status-counter={severity}
              data-count={count}
            />
          )
        })
      )}
    </StatusGroup>
  )
}

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------

export function StatusBar() {
  const m = useMessages()
  const routable = useRoutable()
  const narrow = useMediaQuery(NARROW)
  const wide = useMediaQuery(WIDE)
  return (
    <StatusBarFrame
      label={m.status_bar()}
      start={
        <>
          <LocationsItem narrow={narrow} />
          <SelectionItem />
        </>
      }
      middle={routable("/activity") ? <RunningWork wide={wide} /> : null}
      end={<IssueCounters />}
    />
  )
}
