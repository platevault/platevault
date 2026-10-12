/**
 * The status bar (foundation-owned; round 1b "Status bar", round 5 P-SB3):
 * the window's full bottom bar, plain text and glyphs only, no pills.
 *
 * - Left: locations online ("No locations" with none), then the selection
 *   count a list reports with `useStatusSelection` (`status-selection.ts`).
 * - Middle: running work, newest first, as plain text with a mini progress
 *   bar and Cancel on hover or focus (two from 1440 px, one below, the rest
 *   under "+N"); "Idle" when nothing runs.
 * - Right: a counter per severity (⛔ errors, ⚠ warnings, ℹ info), shown only
 *   when non-zero, each opening a popout of that severity's issues
 *   (`IssueRow`, from the same `useIssues()` as the hub, so the counts agree);
 *   a muted ✓ with no issues. Then the bell with the unread count, opening
 *   the notification history; opening it marks every notification read.
 */
import { Link } from "@tanstack/react-router"
import { Bell, CircleCheck, HardDrive, Info, type LucideIcon, OctagonX, SquareCheck, TriangleAlert, X } from "lucide-react"
import { type RefObject, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { type Issue, type IssueSeverity, SEVERITY_ORDER } from "@/domain/issues"
import { locationAvailability } from "@/domain/library"
import type { Operation } from "@/domain/types"
import { formatNight, formatTime } from "@/lib/format"
import { type Messages, say } from "@/lib/i18n"
import { useMediaQuery } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"
import { nowIso, type PrototypeState, useStore } from "@/store/core"
import { useIssues } from "@/store/issues"
import { markNoticesRead, type Notice, type NoticeTone, noticeText, useNotices } from "@/store/notifications"
import { cancelOperation } from "@/store/operations"
import { IssueRow, SEVERITY_ICON, SEVERITY_TEXT } from "./issues-hub"
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
  return (
    <Button variant="ghost" size="xs" render={<Link to="/settings/locations" />} className="shrink-0 text-muted-foreground" title={`${m.common_locations()}: ${text}`} data-status-locations>
      <HardDrive data-icon="inline-start" aria-hidden="true" />
      <span className={cn("tabular-nums", narrow && "sr-only")}>{text}</span>
    </Button>
  )
}

function SelectionItem() {
  const m = useMessages()
  const selection = useSelectionContext()
  if (!selection) return null
  return (
    <span className="inline-flex shrink-0 items-center gap-1 border-l border-separator pl-2 text-foreground tabular-nums" data-status-selection>
      <SquareCheck aria-hidden="true" className="size-3 text-link" />
      {selection.total !== null ? m.status_bar_selected_of({ count: selection.count, total: selection.total }) : m.status_bar_selected({ count: selection.count })}
    </span>
  )
}

// ---------------------------------------------------------------------------
// Middle: running work
// ---------------------------------------------------------------------------

/** A mini progress bar; work whose size is unknown (a tool stacking) pulses instead. */
function MiniProgress({ value, label }: { value: number | null; label: string }) {
  const m = useMessages()
  if (value === null) {
    return <span role="progressbar" aria-label={label} aria-valuetext={m.status_bar_working()} className="block h-1 w-10 shrink-0 animate-pulse rounded-full bg-primary/40 motion-reduce:animate-none" />
  }
  return <Progress value={value} aria-label={label} className="w-10 shrink-0 gap-0 [&_[data-slot=progress-track]]:bg-foreground/15" />
}

/**
 * One operation: its title, progress and word ("42%", "Paused"). Inline,
 * Cancel shows on hover or focus in place of what ends the item: the word,
 * else the pulse of work whose size is unknown.
 */
function OperationItem({ op, expanded = false, onCancel }: { op: Operation; expanded?: boolean; onCancel: () => void }) {
  const m = useMessages()
  const pct = op.progress.total > 0 ? Math.round((op.progress.done / op.progress.total) * 100) : null
  const word = op.status === "paused" ? m.status_paused() : pct !== null ? `${pct}%` : ""
  const title = say(m, op.title)
  const yields = !expanded && op.canCancel && "group-focus-within/op:invisible group-hover/op:invisible"
  const cancel = op.canCancel ? (
    <button
      type="button"
      onClick={onCancel}
      aria-label={`${m.verb_cancel()}: ${title}`}
      title={m.verb_cancel()}
      className={cn(
        "inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
        !expanded && "absolute right-0 opacity-0 group-focus-within/op:opacity-100 group-hover/op:opacity-100",
      )}
      data-cancel={op.id}
    >
      <X aria-hidden="true" className="size-3" />
    </button>
  ) : null
  return (
    <div className={cn("group/op flex min-w-0 items-center gap-1.5", expanded ? "w-full" : "max-w-60")} data-operation={op.id}>
      <Link to="/activity" className={cn("min-w-0 truncate text-foreground hover:underline", expanded && "flex-1")} title={title}>
        {title}
      </Link>
      {word || expanded ? (
        <>
          <MiniProgress value={pct} label={title} />
          <span className={cn("relative inline-flex h-4 shrink-0 items-center justify-end gap-1 tabular-nums", expanded ? "min-w-12" : "min-w-8")}>
            <span className={cn(yields)}>{word}</span>
            {cancel}
          </span>
        </>
      ) : (
        <span className="relative inline-flex h-4 shrink-0 items-center justify-end">
          <span className={cn("flex", yields)}>
            <MiniProgress value={pct} label={title} />
          </span>
          {cancel}
        </span>
      )}
    </div>
  )
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
  if (running.length === 0) {
    return (
      <span className="shrink-0 px-1" data-status-idle>
        {m.status_bar_idle()}
      </span>
    )
  }
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
    <div ref={group} role="group" aria-label={m.status_running()} className="flex min-w-0 shrink items-center gap-3" data-status-work>
      {inline.map((op) => (
        <OperationItem key={op.id} op={op} onCancel={() => cancel(op, false)} />
      ))}
      {rest > 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger render={<Button variant="ghost" size="xs" className="shrink-0 px-1 text-muted-foreground tabular-nums" />} title={label} aria-label={label} data-status-more="work">
            +{rest}
          </PopoverTrigger>
          <PopoverContent side="top" align="center" className="w-80 gap-0 p-0" aria-label={m.status_running()}>
            <ul ref={rows} className="py-1 text-xs">
              {running.map((op) => (
                <li key={op.id} className="flex min-h-(--row-h) items-center px-3">
                  <OperationItem op={op} expanded onCancel={() => cancel(op, true)} />
                </li>
              ))}
            </ul>
          </PopoverContent>
        </Popover>
      ) : null}
    </div>
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

/** One severity's count with its glyph, opening a popout of its issues in hub order. */
function SeverityCounter({ severity, issues }: { severity: IssueSeverity; issues: Issue[] }) {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  const label = counterLabel(m, severity, issues.length)
  const Glyph = SEVERITY_ICON[severity]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={<Button variant="ghost" size="xs" className="shrink-0 gap-1 px-1 text-muted-foreground tabular-nums" />}
        title={label}
        aria-label={label}
        data-status-counter={severity}
        data-count={issues.length}
      >
        <Glyph aria-hidden="true" className={cn("size-3", SEVERITY_TEXT[severity])} />
        {issues.length}
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="max-h-[min(28rem,var(--available-height))] w-88 gap-0 overflow-y-auto p-0" aria-label={label} data-status-popout={severity}>
        <div data-chrome className="border-b border-border px-3 py-1.5">
          <h2 className="text-sm font-semibold">{label}</h2>
        </div>
        <ul className="py-1">
          {issues.map((issue) => (
            <IssueRow key={issue.id} issue={issue} onNavigate={() => setOpen(false)} />
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

function IssueCounters() {
  const m = useMessages()
  const { issues } = useIssues()
  return (
    <div role="group" aria-label={m.issues_title()} className="flex shrink-0 items-center gap-0.5" data-status-issues={issues.length === 0 ? "none" : issues.length}>
      {issues.length === 0 ? (
        <span role="img" aria-label={m.issues_none()} title={m.issues_none()} className="inline-flex px-1 text-muted-foreground">
          <CircleCheck aria-hidden="true" className="size-3" />
        </span>
      ) : (
        SEVERITY_ORDER.map((severity) => {
          const mine = issues.filter((i) => i.severity === severity)
          return mine.length > 0 ? <SeverityCounter key={severity} severity={severity} issues={mine} /> : null
        })
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Right: notifications
// ---------------------------------------------------------------------------

const NOTICE_GLYPH: Record<NoticeTone, { icon: LucideIcon; className: string }> = {
  success: { icon: CircleCheck, className: "text-success" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  danger: { icon: OctagonX, className: "text-destructive" },
  neutral: { icon: Info, className: "text-muted-foreground" },
}

/** "21:04" today, else the day: "27 Sep". */
function noticeTime(at: string): string {
  return at.slice(0, 10) === nowIso().slice(0, 10) ? formatTime(at) : formatNight(at.slice(0, 10))
}

function NoticeRow({ notice, onNavigate }: { notice: Notice; onNavigate: () => void }) {
  const m = useMessages()
  const { icon: Glyph, className } = NOTICE_GLYPH[notice.tone]
  const words = noticeText(m, notice)
  // The title holds the words in full plus the detail, so a truncated row reads whole on hover.
  const title = notice.detail ? `${words} · ${say(m, notice.detail)}` : words
  const text = notice.href ? (
    <Link to={notice.href as never} onClick={onNavigate} className="min-w-0 flex-1 truncate hover:underline" title={title}>
      {words}
    </Link>
  ) : (
    <span className="min-w-0 flex-1 truncate" title={title}>
      {words}
    </span>
  )
  return (
    <li className="flex min-h-(--row-h) items-center gap-2 px-3 text-sm" data-notice={notice.id}>
      <Glyph aria-hidden="true" className={cn("size-3.5 shrink-0", className)} />
      {text}
      <time dateTime={notice.at} className="shrink-0 text-xs text-muted-foreground tabular-nums">
        {noticeTime(notice.at)}
      </time>
    </li>
  )
}

/**
 * Announces the latest notification once, as it arrives (WCAG 4.1.3). The
 * live region stays mounted and its words are fixed per notice id, so
 * re-wording the same notice (a language switch) announces nothing.
 */
function NoticeAnnouncer({ notice }: { notice: Notice | undefined }) {
  const m = useMessages()
  const id = notice?.id ?? null
  const [said, setSaid] = useState({ id, text: notice ? noticeText(m, notice) : "" })
  if (said.id !== id) setSaid({ id, text: notice ? noticeText(m, notice) : "" })
  return (
    <span role="status" className="sr-only">
      {said.text}
    </span>
  )
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
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger
        render={<Button variant="ghost" size="xs" className="shrink-0 gap-1 px-1 text-muted-foreground tabular-nums" />}
        title={m.status_bar_notifications()}
        aria-label={unreadText ? `${m.status_bar_notifications()}: ${unreadText}` : m.status_bar_notifications()}
        data-status-notice
        data-unread={unread.length}
      >
        <Bell aria-hidden="true" />
        {unread.length > 0 ? <span className="text-foreground">{unread.length}</span> : null}
      </PopoverTrigger>
      <PopoverContent side="top" align="end" className="w-96 gap-0 p-0" aria-label={m.status_bar_notifications()}>
        <div data-chrome className="flex items-center gap-2 border-b border-border px-3 py-1.5">
          <h2 className="flex-1 text-sm font-semibold">{m.status_bar_notifications()}</h2>
          <Button variant="ghost" size="xs" className="text-link" render={<Link to="/activity" />} onClick={() => setOpen(false)}>
            {m.nav_activity()}
          </Button>
        </div>
        <ul className="max-h-[min(24rem,var(--available-height))] overflow-y-auto py-1">
          {notices.map((notice) => (
            <NoticeRow key={notice.id} notice={notice} onNavigate={() => setOpen(false)} />
          ))}
        </ul>
      </PopoverContent>
    </Popover>
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
  return (
    <footer data-chrome aria-label={m.status_bar()} className="relative flex h-6 shrink-0 items-center gap-2 border-t border-separator bg-chrome px-2 text-[0.6875rem] text-muted-foreground">
      <LocationsItem narrow={narrow} />
      <SelectionItem />
      <div className="flex min-w-0 flex-1 justify-center">
        <RunningWork running={running} inline={running.slice(0, wide ? 2 : 1)} group={work} />
      </div>
      <IssueCounters />
      <NotificationHistory notices={notices} unread={unread} />
      <NoticeAnnouncer notice={notices[0]} />
    </footer>
  )
}
