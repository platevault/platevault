/**
 * The status bar (foundation-owned; round 1b "Status bar", round 5 P-SB3):
 * the store wiring of the window's bottom bar. The look lives in
 * `@/components/app/status-bar`.
 *
 * - Left: locations online ("No locations" with none), then the selection
 *   count a list reports with `useStatusSelection` (`status-selection.ts`).
 * - Middle: running work, newest first, with a mini progress bar and Cancel
 *   on hover or focus (two from 1440 px, one below, the rest under "+N");
 *   "Idle" when nothing runs.
 * - Right: a counter per severity (errors, warnings, info), shown only when
 *   non-zero, counting the issues not dismissed (`useIssues()`, so the
 *   source-list badges agree). Each opens a menu naming each owning page,
 *   filtered to the affected rows, with its count, for one issue as for
 *   several (R11); never a list of the issues (F7). A muted ✓ with no issues. Then
 *   the bell with the unread count, opening the notification history;
 *   opening it marks every notification read. The live region reads each
 *   notification once, as it arrives.
 */
import { Bell, CircleCheck, HardDrive } from "lucide-react"
import { type RefObject, useRef, useState } from "react"
import { ISSUE_SEVERITY_ICON } from "@/components/app/issue-copy"
import { ListNotice, ListOperationRow, ListPopover, ListRows, StatusBar as StatusBarFrame, StatusCounter, type StatusCounterPage, StatusGroup, StatusLink, StatusOperation, StatusSelection, StatusText } from "@/components/app/status-bar"
import type { StepLink } from "@/domain/derive"
import { type Issue, type IssueSeverity, SEVERITY_ORDER } from "@/domain/issues"
import { locationAvailability } from "@/domain/library"
import { sessionRef } from "@/domain/membership"
import type { Catalog, Operation } from "@/domain/types"
import { filterLabel, parseFilter } from "@/features/v5/a-home/session-model"
import { formatCount, formatNight, formatTime } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { useMediaQuery } from "@/lib/use-media-query"
import { nowIso, type PrototypeState, useStore } from "@/store/core"
import { useIssues } from "@/store/issues"
import { markNoticesRead, type Notice, noticeText, useNotices } from "@/store/notifications"
import { cancelOperation } from "@/store/operations"
import { useMessages } from "./preferences"
import { useSelectionContext } from "./status-selection"

const NARROW = "(max-width: 767.98px)"
/** Two running operations show inline from here; below it one. */
const WIDE = "(min-width: 1440px)"

// ---------------------------------------------------------------------------
// Left: locations and the selection
// ---------------------------------------------------------------------------

const selectLocations = (s: PrototypeState) => {
  const live = Object.values(s.catalog.locations).filter((l) => !l.retiredAt)
  return { total: live.length, online: live.filter((l) => locationAvailability(s.disk, l) === "online").length }
}

function LocationsItem({ narrow }: { narrow: boolean }) {
  const m = useMessages()
  const { online, total } = useStore(selectLocations)
  const text = total === 0 ? m.storage_no_locations() : m.status_bar_locations_online({ online, total })
  return <StatusLink to="/settings/locations" icon={HardDrive} label={m.common_locations()} text={text} compact={narrow} data-status-locations="" />
}

function SelectionItem() {
  const m = useMessages()
  const selection = useSelectionContext()
  if (!selection) return null
  return <StatusSelection>{selection.total !== null ? m.status_bar_selected_of({ count: selection.count, total: selection.total }) : m.status_bar_selected({ count: selection.count })}</StatusSelection>
}

// ---------------------------------------------------------------------------
// Middle: running work
// ---------------------------------------------------------------------------

function OperationItem({ op, expanded = false, onCancel }: { op: Operation; expanded?: boolean; onCancel: () => void }) {
  const m = useMessages()
  const pct = op.progress.total > 0 ? Math.round((op.progress.done / op.progress.total) * 100) : null
  const word = op.status === "paused" ? m.status_paused() : pct !== null ? `${pct}%` : ""
  return <StatusOperation id={op.id} title={say(m, op.title)} href="/activity" value={pct} word={word} expanded={expanded} onCancel={op.canCancel ? onCancel : undefined} />
}

const selectRunning = (s: PrototypeState) =>
  Object.values(s.operations)
    .filter((op) => op.status === "running" || op.status === "paused")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

/** Running work, newest first: `inline` in the bar, the rest under "+N". */
function RunningWork({ running, inline, group }: { running: Operation[]; inline: Operation[]; group: RefObject<HTMLDivElement | null> }) {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  const rows = useRef<HTMLUListElement>(null)
  if (running.length === 0) return <StatusText data-status-idle="">{m.status_bar_idle()}</StatusText>
  const rest = running.length - inline.length
  const label = m.status_bar_more_running({ count: rest })
  // Focus moves before the cancelled item unmounts (WCAG 2.4.3): to the next operation in its list, while that list stays, else to the notifications trigger (or the first issue counter).
  const cancel = (op: Operation, listed: boolean) => {
    const listGoes = listed && rest <= 1
    const ops = listGoes ? [] : listed ? running : inline
    const next = ops[ops.indexOf(op) + 1]
    const scope = listed ? rows.current : group.current
    const footer = group.current?.closest("footer")
    const target =
      (next ? scope?.querySelector<HTMLElement>(`[data-operation="${next.id}"] a`) : null) ??
      footer?.querySelector<HTMLElement>("[data-status-notice]") ??
      footer?.querySelector<HTMLElement>("[data-status-counter]")
    target?.focus()
    if (listGoes) setOpen(false)
    cancelOperation(op.id)
  }
  return (
    <StatusGroup ref={group} label={m.status_running()} layout="work" data-status-work="">
      {inline.map((op) => (
        <OperationItem key={op.id} op={op} onCancel={() => cancel(op, false)} />
      ))}
      {rest > 0 ? (
        <ListPopover open={open} onOpenChange={setOpen} align="center" width="sm" label={m.status_running()} trigger={{ label, content: `+${rest}`, "data-status-more": "work" }}>
          <ListRows ref={rows} dense>
            {running.map((op) => (
              <ListOperationRow key={op.id}>
                <OperationItem op={op} expanded onCancel={() => cancel(op, true)} />
              </ListOperationRow>
            ))}
          </ListRows>
        </ListPopover>
      ) : null}
    </StatusGroup>
  )
}

// ---------------------------------------------------------------------------
// Right: the issue counters
// ---------------------------------------------------------------------------

/** A counter's words: "2 errors", "1 warning", "3 info". */
function counterLabel(m: Messages, severity: IssueSeverity, count: number): string {
  if (severity === "danger") return m.status_bar_errors({ count })
  if (severity === "warning") return m.status_bar_warnings({ count })
  return m.status_bar_info({ count })
}

/** The words of the page an issue leads to: a Library list by its filter, a record by its name. */
function pageName(m: Messages, catalog: Catalog, link: StepLink): string {
  switch (link.to) {
    case "/sessions":
      return m.status_bar_page_in({ area: m.nav_sessions(), page: filterLabel(m, parseFilter(link.search?.filter)) })
    case "/sessions/$sessionId": {
      const session = catalog.sessions[link.params?.sessionId ?? ""]
      return session ? say(m, sessionRef(session)) : m.nav_sessions()
    }
    case "/projects/$projectId":
      return catalog.projects[link.params?.projectId ?? ""]?.name ?? m.nav_projects()
    case "/settings/locations":
      return m.common_locations()
    case "/calibration":
      return m.nav_calibration()
    default:
      // Work that ran on no Project: its row is in Activity.
      return m.nav_activity()
  }
}

/** The pages one severity's issues are on (F7): each issue's owning page, filtered to its rows; issues on the same page share it and add up their rows. */
function counterPages(m: Messages, catalog: Catalog, issues: Issue[]): StatusCounterPage[] {
  const pages = new Map<string, { link: StepLink; count: number }>()
  for (const issue of issues) {
    const id = JSON.stringify([issue.link.to, issue.link.params ?? null, issue.link.search ?? null])
    const page = pages.get(id)
    if (page) page.count += issue.count
    else pages.set(id, { link: issue.link, count: issue.count })
  }
  return [...pages].map(([id, page]) => ({ id, link: page.link, label: m.status_bar_issue_page({ page: pageName(m, catalog, page.link), count: formatCount(page.count) }) }))
}

function IssueCounters() {
  const m = useMessages()
  const catalog = useStore((s) => s.catalog)
  const { issues } = useIssues()
  return (
    <StatusGroup label={m.issues_title()} data-status-issues={issues.length === 0 ? "none" : issues.length}>
      {issues.length === 0 ? (
        <StatusText>
          <CircleCheck role="img" aria-label={m.issues_none()} className="size-3" />
        </StatusText>
      ) : (
        SEVERITY_ORDER.map((severity) => {
          const mine = issues.filter((i) => i.severity === severity)
          if (mine.length === 0) return null
          return (
            <StatusCounter
              key={severity}
              label={counterLabel(m, severity, mine.length)}
              icon={ISSUE_SEVERITY_ICON[severity]}
              tone={severity}
              count={mine.length}
              pages={counterPages(m, catalog, mine)}
              data-status-counter={severity}
              data-count={mine.length}
            />
          )
        })
      )}
    </StatusGroup>
  )
}

// ---------------------------------------------------------------------------
// Right: notifications
// ---------------------------------------------------------------------------

/** "21:04" today, else the day: "27 Sep". */
function noticeTime(at: string): string {
  return at.slice(0, 10) === nowIso().slice(0, 10) ? formatTime(at) : formatNight(at.slice(0, 10))
}

function NoticeItem({ notice, onNavigate }: { notice: Notice; onNavigate: () => void }) {
  const m = useMessages()
  const words = noticeText(m, notice)
  return (
    <ListNotice
      id={notice.id}
      tone={notice.tone}
      text={words}
      full={notice.detail ? `${words} · ${say(m, notice.detail)}` : words}
      href={notice.href ?? undefined}
      onNavigate={onNavigate}
      at={notice.at}
      time={noticeTime(notice.at)}
    />
  )
}

/**
 * The words of the latest notification, fixed per notice id (WCAG 4.1.3):
 * the live region announces each notification once, as it arrives, and
 * re-wording the same notice (a language switch) announces nothing.
 */
function useNoticeAnnouncement(notice: Notice | undefined): string {
  const m = useMessages()
  const id = notice?.id ?? null
  const [said, setSaid] = useState({ id, text: notice ? noticeText(m, notice) : "" })
  if (said.id !== id) setSaid({ id, text: notice ? noticeText(m, notice) : "" })
  return said.text
}

/** The bell with the unread count, opening the notification history, newest first; opening it marks every notification read. */
function NotificationHistory({ notices, unread }: { notices: Notice[]; unread: Notice[] }) {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  if (notices.length === 0) return null
  const unreadText = unread.length > 0 ? m.status_bar_unread({ count: unread.length }) : null
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) markNoticesRead()
  }
  return (
    <ListPopover
      open={open}
      onOpenChange={onOpenChange}
      title={m.status_bar_notifications()}
      link={{ label: m.nav_activity(), to: "/activity" }}
      width="lg"
      trigger={{
        label: unreadText ? `${m.status_bar_notifications()}: ${unreadText}` : m.status_bar_notifications(),
        icon: Bell,
        content: unread.length > 0 ? unread.length : null,
        "data-status-notice": "",
        "data-unread": unread.length,
      }}
    >
      <ListRows>
        {notices.map((notice) => (
          <NoticeItem key={notice.id} notice={notice} onNavigate={() => setOpen(false)} />
        ))}
      </ListRows>
    </ListPopover>
  )
}

// ---------------------------------------------------------------------------
// The bar
// ---------------------------------------------------------------------------

export function StatusBar() {
  const m = useMessages()
  const narrow = useMediaQuery(NARROW)
  const wide = useMediaQuery(WIDE)
  const { notices, unread } = useNotices()
  const running = useStore(selectRunning)
  const work = useRef<HTMLDivElement>(null)
  const announcement = useNoticeAnnouncement(notices[0])
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
      middle={<RunningWork running={running} inline={running.slice(0, wide ? 2 : 1)} group={work} />}
      end={
        <>
          <IssueCounters />
          <NotificationHistory notices={notices} unread={unread} />
        </>
      }
    />
  )
}
