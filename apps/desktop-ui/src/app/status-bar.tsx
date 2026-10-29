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
 *   filtered to the affected rows, with its count; a counter none of whose
 *   pages is registered yet shows its count without a menu. There is no
 *   Issues hub, and Dismiss and Restore stay on the rows (issue-actions.ts).
 *
 * Every link appears once its page's route is registered (navigation.ts);
 * until then the item shows its words without a link. A failed read says so
 * in the bar, with Retry. The bar's polite live region reads each change
 * once: the counters changing, a scan finishing, a read failing; what the
 * window shows at start is not announced.
 *
 * `useStatusRefresh`, mounted once per window, keeps one refresher per
 * read: a settled scan refreshes issues and locations, and a scan that
 * starts or settles refreshes the running list. A write that changes issues
 * invalidates `libraryKey("libraryIssues")` itself.
 */
import { type QueryClient, useQuery, useQueryClient } from "@tanstack/react-query"
import { CircleAlert, CircleCheck, HardDrive } from "lucide-react"
import { type RefObject, useEffect, useRef, useState } from "react"
import { useRefreshOnEvent } from "@/api/events"
import { type IssuePage, type IssueSeverity, type IssueView, type Issue as LibraryIssue, library, SCAN_PROGRESS_EVENT, type ScanOperation, type ScanProgressEvent } from "@/api/ipc"
import { libraryKey, libraryQuery } from "@/api/query"
import type { StepLink } from "@/components/app/contracts"
import { toast } from "@/components/app/feedback"
import { ISSUE_SEVERITY_ICON } from "@/components/app/issue-copy"
import { failureMessage } from "@/components/app/run-result"
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
import { Button } from "@/components/ui/button"
import { formatCount, formatList } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { useMediaQuery } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"
import { useRoutable } from "./navigation"
import { useMessages } from "./preferences"

const NARROW = "(max-width: 767.98px)"
/** Two running scans show inline from here; below it one. */
const WIDE = "(min-width: 1440px)"
/** The newest scans the bar reads; running ones are always among them. */
const RECENT_SCANS = 20

/** The status bar's library reads. */
export const ISSUES_QUERY = libraryQuery("libraryIssues")
const LOCATIONS_QUERY = libraryQuery("libraryListLocations")
const SCANS_QUERY = libraryQuery("libraryListOperations", null, 0, RECENT_SCANS)

const SEVERITY_ORDER: readonly IssueSeverity[] = ["danger", "warning", "info"]

const SEVERITY_TEXT: Record<IssueSeverity, string> = { danger: "text-destructive", warning: "text-warning", info: "text-info" }

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

/** All the counters in words, "1 error and 2 warnings", or "No issues". */
function issuesWords(m: Messages, view: IssueView): string {
  const counters = SEVERITY_ORDER.filter((severity) => view.counts[severity] > 0).map((severity) => counterLabel(m, severity, view.counts[severity]))
  return counters.length > 0 ? formatList(counters) : m.issues_none()
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

function settled(event: ScanProgressEvent): boolean {
  return event.state !== "running"
}

/** Whether the last running-list read already lists `operationId` as running. */
function listedRunning(client: QueryClient, operationId: string): boolean {
  return (client.getQueryData(SCANS_QUERY.queryKey) ?? []).some((scan) => scan.id === operationId && scan.state === "running")
}

/** One refresher per status read, for the window's lifetime (see the module comment). */
export function useStatusRefresh(): void {
  const client = useQueryClient()
  useRefreshOnEvent(SCAN_PROGRESS_EVENT, libraryKey("libraryIssues"), settled)
  useRefreshOnEvent(SCAN_PROGRESS_EVENT, libraryKey("libraryListLocations"), settled)
  // A scan that starts or settles changes the list; progress within a listed scan does not.
  useRefreshOnEvent(SCAN_PROGRESS_EVENT, libraryKey("libraryListOperations"), (event) => settled(event) || !listedRunning(client, event.operationId))
}

/** A read that failed: what failed, then Retry. */
function FailedRead({ text, onRetry, ...data }: { text: string; onRetry: () => void } & { [key: `data-${string}`]: string }) {
  const m = useMessages()
  return (
    <StatusGroup label={text} {...data}>
      <StatusText>
        <CircleAlert aria-hidden="true" className="mr-1 inline size-3 text-destructive" />
        {text}
      </StatusText>
      <Button variant="ghost" size="xs" aria-label={`${m.verb_retry()}: ${text}`} onClick={onRetry}>
        {m.verb_retry()}
      </Button>
    </StatusGroup>
  )
}

// ---------------------------------------------------------------------------
// Left: locations and the selection
// ---------------------------------------------------------------------------

function LocationsItem({ narrow }: { narrow: boolean }) {
  const m = useMessages()
  const routable = useRoutable()
  const read = useQuery(LOCATIONS_QUERY)
  if (read.isPending) return null
  if (read.isError) return <FailedRead text={m.status_bar_locations_failed()} onRetry={() => void read.refetch()} data-status-locations="failed" />
  const live = read.data.filter(({ location }) => location.lifecycle === "active")
  const online = live.filter(({ location }) => location.availability === "available").length
  const text = live.length === 0 ? m.storage_no_locations() : m.status_bar_locations_online({ online, total: live.length })
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
function RunningScans({ running, inline, nameOf, group }: { running: ScanOperation[]; inline: ScanOperation[]; nameOf: (scan: ScanOperation) => string; group: RefObject<HTMLDivElement | null> }) {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  const rows = useRef<HTMLUListElement>(null)
  const rest = running.length - inline.length
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
        <ScanItem key={scan.id} scan={scan} name={nameOf(scan)} onCancel={() => cancel(scan, false)} />
      ))}
      {rest > 0 ? (
        <ListPopover open={open} onOpenChange={setOpen} align="center" width="sm" label={m.status_running()} trigger={{ label: m.status_bar_more_running({ count: rest }), content: `+${rest}`, "data-status-more": "work" }}>
          <ListRows ref={rows} dense>
            {running.map((scan) => (
              <ListOperationRow key={scan.id}>
                <ScanItem scan={scan} name={nameOf(scan)} expanded onCancel={() => cancel(scan, true)} />
              </ListOperationRow>
            ))}
          </ListRows>
        </ListPopover>
      ) : null}
    </StatusGroup>
  )
}

/** The running scans; shown once Activity, where each opens, is registered. */
function RunningWork({ running, nameOf, wide, failed, onRetry }: { running: ScanOperation[]; nameOf: (scan: ScanOperation) => string; wide: boolean; failed: boolean; onRetry: () => void }) {
  const m = useMessages()
  const group = useRef<HTMLDivElement>(null)
  if (failed) return <FailedRead text={m.status_bar_scans_failed()} onRetry={onRetry} data-status-work="failed" />
  if (running.length === 0) return null
  return <RunningScans running={running} inline={running.slice(0, wide ? 2 : 1)} nameOf={nameOf} group={group} />
}

// ---------------------------------------------------------------------------
// Right: the issue counters
// ---------------------------------------------------------------------------

/** A counter whose pages are not registered yet: its count, with no menu. */
function CountOnly({ label, severity, count }: { label: string; severity: IssueSeverity; count: number }) {
  const Icon = ISSUE_SEVERITY_ICON[severity]
  return (
    <StatusText data-status-counter={severity} data-count={count}>
      <Icon role="img" aria-label={label} className={cn("mr-1 inline size-3", SEVERITY_TEXT[severity])} />
      <span aria-hidden="true">{count}</span>
    </StatusText>
  )
}

function IssueCounters() {
  const m = useMessages()
  const routable = useRoutable()
  const read = useQuery(ISSUES_QUERY)
  if (read.isPending) return null
  if (read.isError) return <FailedRead text={m.status_bar_issues_failed()} onRetry={() => void read.refetch()} data-status-issues="failed" />
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
          const label = counterLabel(m, severity, count)
          const pages = counterPages(m, view, severity, routable)
          if (pages.length === 0) return <CountOnly key={severity} label={label} severity={severity} count={count} />
          return <StatusCounter key={severity} label={label} icon={ISSUE_SEVERITY_ICON[severity]} tone={severity} count={count} pages={pages} data-status-counter={severity} data-count={count} />
        })
      )}
    </StatusGroup>
  )
}

// ---------------------------------------------------------------------------
// The live region
// ---------------------------------------------------------------------------

interface StatusSnapshot {
  /** The counters in words; null until the first read answers or while it fails. */
  issues: string | null
  failures: string[]
  /** Running scan id to its location's name; null while the list is unread. */
  running: Map<string, string> | null
}

/** What changed between two snapshots, in words; a failure is news even at start, the first counts are not. */
function statusNews(m: Messages, before: StatusSnapshot, now: StatusSnapshot): string[] {
  const news: string[] = []
  if (now.issues !== null && before.issues !== null && now.issues !== before.issues) news.push(now.issues)
  if (now.issues !== null && before.issues === null && before.failures.includes(m.status_bar_issues_failed())) news.push(now.issues)
  news.push(...now.failures.filter((failure) => !before.failures.includes(failure)))
  if (before.running && now.running) {
    for (const [id, name] of before.running) if (!now.running.has(id)) news.push(m.status_bar_scan_finished({ name }))
  }
  return news
}

/** The words the bar's live region reads: set only when something changes, so one change is read once. */
function useStatusAnnouncement(snapshot: StatusSnapshot): string {
  const m = useMessages()
  const previous = useRef<StatusSnapshot | null>(null)
  const [announcement, setAnnouncement] = useState("")
  const key = JSON.stringify([snapshot.issues, snapshot.failures, snapshot.running ? [...snapshot.running] : null])
  useEffect(() => {
    const before = previous.current
    previous.current = snapshot
    if (!before) return
    const news = statusNews(m, before, snapshot)
    if (news.length > 0) setAnnouncement(news.join(". "))
  }, [key]) // `key` is the snapshot's words: the effect runs once per change.
  return announcement
}

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------

export function StatusBar() {
  const m = useMessages()
  const routable = useRoutable()
  const narrow = useMediaQuery(NARROW)
  const wide = useMediaQuery(WIDE)
  const issues = useQuery(ISSUES_QUERY)
  const locations = useQuery(LOCATIONS_QUERY)
  // Running work opens Activity: until that page is registered the bar neither reads nor announces it.
  const activity = routable("/activity")
  const scans = useQuery({ ...SCANS_QUERY, enabled: activity })
  const running = activity ? (scans.data ?? []).filter((scan) => scan.state === "running") : []
  const names = new Map((locations.data ?? []).map(({ location }) => [location.id, location.name]))
  const nameOf = (scan: ScanOperation) => names.get(scan.locationId) ?? m.common_locations()
  const announcement = useStatusAnnouncement({
    issues: issues.data ? issuesWords(m, issues.data) : null,
    failures: [
      ...(issues.isError ? [m.status_bar_issues_failed()] : []),
      ...(locations.isError ? [m.status_bar_locations_failed()] : []),
      ...(activity && scans.isError ? [m.status_bar_scans_failed()] : []),
    ],
    running: activity && scans.data ? new Map(running.map((scan) => [scan.id, nameOf(scan)])) : null,
  })
  return (
    <StatusBarFrame
      label={m.status_bar()}
      announcement={announcement}
      start={
        <>
          <LocationsItem narrow={narrow} />
          <SelectionItem />
        </>
      }
      middle={activity ? <RunningWork running={running} nameOf={nameOf} wide={wide} failed={scans.isError} onRetry={() => void scans.refetch()} /> : null}
      end={<IssueCounters />}
    />
  )
}
