/**
 * The status bar (foundation-owned; round 1b "Status bar", round 2c P-SB2):
 * the window's full bottom bar, terse words, pills and counts only.
 *
 * - Left: locations online, then the context slot: the selection count a
 *   list reports with `useStatusSelection` (`status-selection.ts`).
 * - Middle: every issue in the Issues hub (`useStatusIssues`), worst first,
 *   at the densest level that fits: (1) one named pill per issue, linking to
 *   its action; (2) one chip per kind ("2 blocked"), a chip of several
 *   opening a popover of them; (3) those chips with the trailing ones under
 *   "+N". With no issues, a muted "No issues".
 * - Right: running work, each with a mini progress bar and Cancel on hover
 *   or focus (more than fit collapse into "+N"); up to three unread
 *   notifications, newest first; and the history trigger with the unread
 *   count. Opening the history marks every notification read.
 *
 * An invisible ruler measures every candidate, so the row never wraps or
 * clips. The chips and the inline notifications share the room the rest
 * leaves (`fitBar`); the oldest notification shown may truncate to fit.
 * Below 768 px the bar stays as it was: chips by kind and the last
 * notification.
 */
import { Link } from "@tanstack/react-router"
import {
  Ban,
  Bell,
  CircleCheck,
  CircleX,
  Crosshair,
  FileDiff,
  FolderMinus,
  HardDrive,
  Info,
  Layers,
  type LucideIcon,
  OctagonX,
  PackagePlus,
  SquareCheck,
  TriangleAlert,
  Unplug,
  X,
} from "lucide-react"
import { type RefObject, useCallback, useLayoutEffect, useRef, useState } from "react"
import { CountBadge, pillClass } from "@/components/app/pill"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { type Issue, type IssueSeverity, STATUS_CHIP_OF, type StatusChip, type StatusChipId, type StatusIssues } from "@/domain/issues"
import { locationAvailability } from "@/domain/library"
import type { Operation } from "@/domain/types"
import { formatNight, formatTime } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { useMediaQuery } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"
import { nowIso, type PrototypeState, useStore } from "@/store/core"
import { useStatusIssues } from "@/store/issues"
import { markNoticesRead, type Notice, type NoticeTone, noticeText, useNotices } from "@/store/notifications"
import { cancelOperation } from "@/store/operations"
import { IssueRow, issueCopy, SEVERITY_TONE } from "./issues-hub"
import { useMessages } from "./preferences"
import { useSelectionContext } from "./status-selection"

const NARROW = "(max-width: 767.98px)"
/** Two running operations show inline from here; below it one, so the issue chips keep their room. */
const WIDE = "(min-width: 1440px)"

const CHIP_ICON: Record<StatusChipId, LucideIcon> = {
  offline: Unplug,
  failed: CircleX,
  blocked: Ban,
  "needs-target": Crosshair,
  "not-in-project": FolderMinus,
  calibration: Layers,
  "master-offer": PackagePlus,
  drift: FileDiff,
}

/** Matches the chip row's `gap-1`. */
const CHIP_GAP_PX = 4
/** Matches the footer's and the notice list's `gap-2`. */
const SLOT_GAP_PX = 8
/** Unread notifications shown inline at most. */
const INLINE_NOTICES = 3
/** A notification is truncated to fit down to this width; below it, it drops. */
const NOTICE_MIN_PX = 128

/** The chip's words: a count by kind ("2 blocked"). */
function chipText(m: Messages, chip: StatusChip): string {
  const { count } = chip
  const text: Record<StatusChipId, () => string> = {
    offline: () => m.status_bar_offline({ count }),
    failed: () => m.status_bar_failed({ count }),
    blocked: () => m.status_bar_runs_blocked({ count }),
    "needs-target": () => m.issue_needs_target({ count }),
    "not-in-project": () => m.issue_not_in_project({ count }),
    calibration: () => m.status_bar_calibration_waiting({ count }),
    "master-offer": () => m.issue_master_offered({ count }),
    drift: () => m.status_bar_changed({ count }),
  }
  return text[chip.id]()
}

// ---------------------------------------------------------------------------
// Fit: how the chips and the inline notifications share the room
// ---------------------------------------------------------------------------

/** `level` 1 names every issue, 2 groups them by kind, 3 also folds the chips from `chips` on into "+N". */
interface BarFit {
  level: 1 | 2 | 3
  chips: number
  notices: number
  /** The width the oldest notice shown is truncated to, when it fits only truncated. */
  squeezed: number | null
}

/** Natural widths from the ruler, in bar order; `notices` newest first. */
interface BarWidths {
  pills: number[]
  chips: number[]
  more: number
  empty: number
  notices: number[]
}

const rowWidth = (widths: number[]) => widths.reduce((sum, w, i) => sum + w + (i > 0 ? CHIP_GAP_PX : 0), 0)

/**
 * The densest fit for `room`, the width the chips and the inline notices
 * share. What gives way first: the named pills (level 1), then the notices,
 * oldest first, then the trailing chips (level 3).
 */
function fitBar(widths: BarWidths, room: number): BarFit {
  const grouped = widths.chips.length > 0 ? rowWidth(widths.chips) : widths.empty
  if (grouped > room) {
    let used = widths.more
    let chips = 0
    for (const width of widths.chips) {
      if (used + CHIP_GAP_PX + width > room) break
      used += CHIP_GAP_PX + width
      chips += 1
    }
    return { level: 3, chips, notices: 0, squeezed: null }
  }
  let left = room - grouped
  let notices = 0
  let squeezed: number | null = null
  for (const width of widths.notices) {
    if (width + SLOT_GAP_PX <= left) {
      left -= width + SLOT_GAP_PX
      notices += 1
      continue
    }
    if (left - SLOT_GAP_PX >= NOTICE_MIN_PX) {
      squeezed = left - SLOT_GAP_PX
      left = 0
      notices += 1
    }
    break
  }
  const named = widths.pills.length > 0 && rowWidth(widths.pills) <= grouped + left
  return { level: named ? 1 : 2, chips: widths.chips.length, notices, squeezed }
}

/**
 * Re-fits on every resize of the chip slot, and whenever the ruler's words
 * change (issues, unread notices, the language). The room is the chip slot
 * plus the inline notices, so the slot growing as a notice drops keeps it.
 */
function useBarFit(box: RefObject<HTMLDivElement | null>, list: RefObject<HTMLUListElement | null>, ruler: RefObject<HTMLDivElement | null>): BarFit {
  // Every chip until the first measure, which runs before paint.
  const [fit, setFit] = useState<BarFit>({ level: 2, chips: Number.POSITIVE_INFINITY, notices: 0, squeezed: null })
  const words = useRef<string | null>(null)
  const measure = useCallback(() => {
    const row = box.current
    const marks = ruler.current
    if (!row || !marks) return
    const widths = (kind: string) => [...marks.querySelectorAll<HTMLElement>(`[data-measure="${kind}"]`)].map((el) => Math.ceil(el.getBoundingClientRect().width))
    const inline = list.current
    const room = Math.floor(row.getBoundingClientRect().width + (inline ? inline.getBoundingClientRect().width + SLOT_GAP_PX : 0))
    const next = fitBar({ pills: widths("pill"), chips: widths("chip"), more: widths("more")[0] ?? 0, empty: widths("empty")[0] ?? 0, notices: widths("notice") }, room)
    setFit((prev) => (prev.level === next.level && prev.chips === next.chips && prev.notices === next.notices && prev.squeezed === next.squeezed ? prev : next))
  }, [box, list, ruler])
  useLayoutEffect(() => {
    const marks = ruler.current
    const now = marks ? [...marks.children].map((c) => `${c.getAttribute("data-measure")}:${c.textContent}`).join("|") : ""
    if (now === words.current) return
    words.current = now
    measure()
  })
  useLayoutEffect(() => {
    const row = box.current
    if (!row) return
    const observer = new ResizeObserver(measure)
    observer.observe(row)
    return () => observer.disconnect()
  }, [box, measure])
  return fit
}

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
  const text = m.status_bar_locations_online({ online, total })
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
// Middle: the issues
// ---------------------------------------------------------------------------

/** A pill straight to one issue's action, worded by the issue itself ("Cold-1 offline") or by its chip ("1 offline"). */
function IssueLink({ issue, text }: { issue: Issue; text?: string }) {
  const m = useMessages()
  const copy = issueCopy(m, issue)
  const Icon = CHIP_ICON[STATUS_CHIP_OF[issue.kind]]
  const tone = SEVERITY_TONE[issue.severity]
  return (
    <Link
      to={issue.link.to as never}
      params={issue.link.params as never}
      search={issue.link.search as never}
      className={pillClass(tone, true)}
      title={`${copy.text} · ${copy.action}`}
      data-pill={tone}
      data-chip-issues={1}
    >
      <Icon aria-hidden="true" />
      <span className="truncate">{text ?? copy.text}</span>
    </Link>
  )
}

function ChipIssues({ chip, onNavigate }: { chip: StatusChip; onNavigate: () => void }) {
  return (
    <ul className="py-1">
      {chip.issues.map((issue) => (
        <IssueRow key={issue.id} issue={issue} onNavigate={onNavigate} />
      ))}
    </ul>
  )
}

/** One chip: a link to the action of its one issue, or a popover listing its issues. */
function ChipControl({ chip }: { chip: StatusChip }) {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  const text = chipText(m, chip)
  if (chip.issues.length === 1) return <IssueLink issue={chip.issues[0]!} text={text} />
  const Icon = CHIP_ICON[chip.id]
  const tone = SEVERITY_TONE[chip.severity]
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={pillClass(tone, true)} title={text} data-pill={tone} data-chip-issues={chip.issues.length}>
        <Icon aria-hidden="true" />
        <span className="truncate">{text}</span>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="w-80 gap-0 p-0" aria-label={text}>
        <ChipIssues chip={chip} onNavigate={() => setOpen(false)} />
      </PopoverContent>
    </Popover>
  )
}

/** Chips that do not fit: "+N", opening each with its issues. */
function MoreChips({ chips }: { chips: StatusChip[] }) {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  const label = m.status_bar_more({ count: chips.length })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        className={pillClass("neutral", true)}
        title={label}
        aria-label={label}
        data-status-more="chips"
        data-chip-issues={chips.reduce((n, chip) => n + chip.issues.length, 0)}
      >
        +{chips.length}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="max-h-[min(28rem,var(--available-height))] w-80 gap-0 overflow-y-auto p-0" aria-label={label}>
        {chips.map((chip) => {
          const Icon = CHIP_ICON[chip.id]
          return (
            <section key={chip.id} aria-label={chipText(m, chip)} className="border-b border-border last:border-0">
              <h3 data-chrome className="flex items-center gap-1.5 px-3 pt-2 text-[0.6875rem] font-semibold text-muted-foreground">
                <Icon aria-hidden="true" className="size-3" />
                {chipText(m, chip)}
              </h3>
              <ChipIssues chip={chip} onNavigate={() => setOpen(false)} />
            </section>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

function NoIssues() {
  const m = useMessages()
  return (
    <span className="inline-flex shrink-0 items-center gap-1 text-muted-foreground">
      <CircleCheck aria-hidden="true" className="size-3" />
      {m.issues_none()}
    </span>
  )
}

function IssueSlot({ status, fit, box }: { status: StatusIssues; fit: BarFit; box: RefObject<HTMLDivElement | null> }) {
  const m = useMessages()
  const empty = status.chips.length === 0
  const hidden = status.chips.slice(fit.chips)
  return (
    <div ref={box} role="group" aria-label={m.issues_title()} className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" data-status-chips data-level={empty ? "none" : fit.level}>
      {empty ? (
        <NoIssues />
      ) : fit.level === 1 ? (
        status.pills.map((issue) => <IssueLink key={issue.id} issue={issue} />)
      ) : (
        <>
          {status.chips.slice(0, fit.chips).map((chip) => (
            <ChipControl key={chip.id} chip={chip} />
          ))}
          {hidden.length > 0 ? <MoreChips chips={hidden} /> : null}
        </>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Right: running work
// ---------------------------------------------------------------------------

/** A mini progress bar; work whose size is unknown (a tool stacking) pulses instead. */
function MiniProgress({ value, label }: { value: number | null; label: string }) {
  const m = useMessages()
  if (value === null) {
    return <span role="progressbar" aria-label={label} aria-valuetext={m.status_bar_working()} className="block h-1 w-10 shrink-0 animate-pulse rounded-full bg-primary/40 motion-reduce:animate-none" />
  }
  return <Progress value={value} aria-label={label} className="w-10 shrink-0 gap-0 [&_[data-slot=progress-track]]:bg-foreground/15" />
}

function OperationItem({ op, expanded = false }: { op: Operation; expanded?: boolean }) {
  const m = useMessages()
  const pct = op.progress.total > 0 ? Math.round((op.progress.done / op.progress.total) * 100) : null
  const word = op.status === "paused" ? m.status_paused() : pct !== null ? `${pct}%` : ""
  return (
    <div className={cn("group/op flex min-w-0 items-center gap-1.5", expanded ? "w-full" : "max-w-48")} data-operation={op.id}>
      <Link to="/activity" className={cn("min-w-0 truncate text-foreground hover:underline", expanded && "flex-1")} title={op.title}>
        {op.title}
      </Link>
      <MiniProgress value={pct} label={op.title} />
      <span className={cn("relative inline-flex h-4 shrink-0 items-center justify-end gap-1 tabular-nums", expanded ? "min-w-12" : "w-8")}>
        <span className={cn(!expanded && op.canCancel && "group-focus-within/op:invisible group-hover/op:invisible")}>{word}</span>
        {op.canCancel ? (
          <button
            type="button"
            onClick={() => cancelOperation(op.id)}
            aria-label={`${m.verb_cancel()}: ${op.title}`}
            title={m.verb_cancel()}
            className={cn(
              "inline-flex size-4 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-accent-foreground",
              !expanded && "absolute right-0 opacity-0 group-focus-within/op:opacity-100 group-hover/op:opacity-100",
            )}
            data-cancel={op.id}
          >
            <X aria-hidden="true" className="size-3" />
          </button>
        ) : null}
      </span>
    </div>
  )
}

const selectRunning = (s: PrototypeState) =>
  Object.values(s.operations)
    .filter((op) => op.status === "running" || op.status === "paused")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))

/** Running work, newest first: two inline from 1440 px, one below, the rest under "+N". */
function RunningWork() {
  const m = useMessages()
  const running = useStore(selectRunning)
  const wide = useMediaQuery(WIDE)
  const [open, setOpen] = useState(false)
  if (running.length === 0) return <span className="shrink-0 px-1">{m.status_bar_idle()}</span>
  const inline = running.slice(0, wide ? 2 : 1)
  const rest = running.length - inline.length
  const label = m.status_bar_more_running({ count: rest })
  return (
    <div role="group" aria-label={m.status_running()} className="flex min-w-0 shrink items-center gap-3" data-status-work>
      {inline.map((op) => (
        <OperationItem key={op.id} op={op} />
      ))}
      {rest > 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger className={pillClass("neutral", true)} title={label} aria-label={label} data-status-more="work">
            +{rest}
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-80 gap-0 p-0" aria-label={m.status_running()}>
            <ul className="py-1 text-xs">
              {running.map((op) => (
                <li key={op.id} className="flex min-h-(--row-h) items-center px-3">
                  <OperationItem op={op} expanded />
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
// Right: notifications
// ---------------------------------------------------------------------------

const NOTICE_GLYPH: Record<NoticeTone, { icon: LucideIcon; className: string }> = {
  success: { icon: CircleCheck, className: "text-success" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  danger: { icon: OctagonX, className: "text-destructive" },
  neutral: { icon: Info, className: "text-muted-foreground" },
}

/** One inline notification, after a divider; the ruler measures the same box. */
const NOTICE_INLINE = "flex min-w-0 max-w-60 shrink-0 items-center gap-1 border-l border-separator pl-2"

/** "21:04" today, else the day: "27 Sep". */
function noticeTime(at: string): string {
  return at.slice(0, 10) === nowIso().slice(0, 10) ? formatTime(at) : formatNight(at.slice(0, 10))
}

function NoticeRow({ notice, onNavigate }: { notice: Notice; onNavigate: () => void }) {
  const m = useMessages()
  const { icon: Glyph, className } = NOTICE_GLYPH[notice.tone]
  const words = noticeText(m, notice)
  const text = notice.href ? (
    <Link to={notice.href as never} onClick={onNavigate} className="min-w-0 flex-1 truncate hover:underline" title={notice.detail ?? words}>
      {words}
    </Link>
  ) : (
    <span className="min-w-0 flex-1 truncate" title={notice.detail ?? words}>
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

/** An unread notification inline; following it marks it read. `width` truncates it to fit. */
function InlineNotice({ notice, width }: { notice: Notice; width: number | null }) {
  const m = useMessages()
  const { icon: Glyph, className } = NOTICE_GLYPH[notice.tone]
  const words = noticeText(m, notice)
  return (
    <li className={NOTICE_INLINE} style={width === null ? undefined : { maxWidth: width }} data-notice-inline={notice.id}>
      <Glyph aria-hidden="true" className={cn("size-3 shrink-0", className)} />
      {notice.href ? (
        <Link to={notice.href as never} onClick={() => markNoticesRead(notice.id)} className="min-w-0 truncate text-foreground hover:underline" title={notice.detail ?? words}>
          {words}
        </Link>
      ) : (
        <span className="min-w-0 truncate text-foreground" title={notice.detail ?? words}>
          {words}
        </span>
      )}
    </li>
  )
}

/** The unread notifications that fit, newest first; the last one shown takes `squeezed` when it fits only truncated. */
function InlineNotices({ notices, squeezed, list }: { notices: Notice[]; squeezed: number | null; list: RefObject<HTMLUListElement | null> }) {
  const m = useMessages()
  if (notices.length === 0) return null
  return (
    <ul ref={list} aria-label={m.status_bar_notifications()} className="flex shrink-0 items-center gap-2" data-status-notices>
      {notices.map((notice, i) => (
        <InlineNotice key={notice.id} notice={notice} width={i === notices.length - 1 ? squeezed : null} />
      ))}
    </ul>
  )
}

/**
 * The notification history, newest first. Its trigger shows the unread
 * count (below 768 px, the last notification instead); opening it marks
 * every notification read.
 */
function NotificationHistory({ notices, unread, narrow }: { notices: Notice[]; unread: Notice[]; narrow: boolean }) {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  const latest = notices[0]
  if (!latest) return null
  const latestText = noticeText(m, latest)
  const unreadText = unread.length > 0 ? m.status_bar_unread({ count: unread.length }) : null
  const { icon: Glyph, className } = NOTICE_GLYPH[latest.tone]
  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (next) markNoticesRead()
  }
  return (
    <>
      <span role="status" className="sr-only">
        {latestText}
      </span>
      <Popover open={open} onOpenChange={onOpenChange}>
        {narrow ? (
          <PopoverTrigger
            render={<Button variant="ghost" size="xs" className="min-w-0 max-w-48 shrink justify-start text-muted-foreground" />}
            title={latestText}
            aria-label={`${m.status_bar_notifications()}: ${latestText}`}
            data-status-notice
            data-unread={unread.length}
          >
            <Glyph data-icon="inline-start" aria-hidden="true" className={className} />
            <span className="truncate">{latestText}</span>
          </PopoverTrigger>
        ) : (
          <PopoverTrigger
            render={<Button variant="ghost" size="xs" className="shrink-0 gap-1 px-1 text-muted-foreground" />}
            title={m.status_bar_notifications()}
            aria-label={unreadText ? `${m.status_bar_notifications()}: ${unreadText}` : m.status_bar_notifications()}
            data-status-notice
            data-unread={unread.length}
          >
            <Bell aria-hidden="true" />
            {unread.length > 0 ? <CountBadge count={unread.length} tone="info" /> : null}
          </PopoverTrigger>
        )}
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
    </>
  )
}

// ---------------------------------------------------------------------------
// The ruler and the bar
// ---------------------------------------------------------------------------

function RulerPill({ measure, icon: Icon, severity, text }: { measure: "pill" | "chip"; icon: LucideIcon; severity: IssueSeverity; text: string }) {
  return (
    <span data-measure={measure} className={pillClass(SEVERITY_TONE[severity])}>
      <Icon />
      <span>{text}</span>
    </span>
  )
}

/** Every candidate at its natural width, invisible and out of the layout, so a fit is chosen before paint. */
function BarRuler({ status, notices, narrow, ruler }: { status: StatusIssues; notices: Notice[]; narrow: boolean; ruler: RefObject<HTMLDivElement | null> }) {
  const m = useMessages()
  return (
    <div aria-hidden="true" className="pointer-events-none invisible absolute top-0 left-0 size-0 overflow-hidden">
      <div ref={ruler} className="flex w-max items-center">
        {narrow
          ? null
          : status.pills.map((issue) => <RulerPill key={`pill:${issue.id}`} measure="pill" icon={CHIP_ICON[STATUS_CHIP_OF[issue.kind]]} severity={issue.severity} text={issueCopy(m, issue).text} />)}
        {status.chips.map((chip) => (
          <RulerPill key={`chip:${chip.id}`} measure="chip" icon={CHIP_ICON[chip.id]} severity={chip.severity} text={chipText(m, chip)} />
        ))}
        <span data-measure="more" className={pillClass("neutral")}>
          +{status.chips.length}
        </span>
        <span data-measure="empty" className="flex">
          <NoIssues />
        </span>
        {notices.map((notice) => {
          const { icon: Glyph } = NOTICE_GLYPH[notice.tone]
          return (
            <span key={notice.id} data-measure="notice" className={NOTICE_INLINE}>
              <Glyph className="size-3 shrink-0" />
              <span className="min-w-0 truncate">{noticeText(m, notice)}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function StatusBar() {
  const m = useMessages()
  const narrow = useMediaQuery(NARROW)
  const status = useStatusIssues()
  const { notices, unread } = useNotices()
  const candidates = narrow ? [] : unread.slice(0, INLINE_NOTICES)
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const ruler = useRef<HTMLDivElement>(null)
  const fit = useBarFit(box, list, ruler)
  return (
    <footer data-chrome aria-label={m.status_bar()} className="relative flex h-6 shrink-0 items-center gap-2 border-t border-separator bg-chrome px-2 text-[0.6875rem] text-muted-foreground">
      <LocationsItem narrow={narrow} />
      <SelectionItem />
      <IssueSlot status={status} fit={fit} box={box} />
      <RunningWork />
      <InlineNotices notices={candidates.slice(0, fit.notices)} squeezed={fit.squeezed} list={list} />
      <NotificationHistory notices={notices} unread={unread} narrow={narrow} />
      <BarRuler status={status} notices={candidates} narrow={narrow} ruler={ruler} />
    </footer>
  )
}
