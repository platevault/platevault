/**
 * The status bar (foundation-owned; round 1b "Status bar", round 2c P-SB2):
 * the window's full bottom bar, terse words, pills and counts only.
 *
 * - Left: locations online ("No locations" with none), then the context
 *   slot: the selection count a list reports with `useStatusSelection`
 *   (`status-selection.ts`).
 * - Middle: every issue in the Issues hub (`useStatusIssues`), worst first,
 *   at the densest level that fits: (1) one named pill per issue, linking to
 *   its action; (2) the first issues named and the rest as one chip per kind
 *   ("2 blocked"), a chip of several opening a popover of them; (3) every
 *   issue as a chip, the trailing ones under "+N". With no issues, a muted
 *   "No issues".
 * - Right: running work, each with a mini progress bar and Cancel on hover
 *   or focus (more than fit collapse into "+N"); up to three unread
 *   notifications, newest first; and the history trigger with the unread
 *   count. Opening the history marks every notification read.
 *
 * An invisible ruler measures every candidate, so the row never wraps or
 * clips. The issues, the inline notifications and the running work share
 * the room the rest leaves (`fitBar`); the oldest notification shown may
 * truncate to fit. Room left over widens cut-off running work, then
 * notifications, and then names one more issue, truncated. Below 768 px the
 * bar stays as it was: chips by kind and the last notification.
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
import { type Messages, say } from "@/lib/i18n"
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
/** An inline notification's width until room left over widens it. */
const NOTICE_MAX_PX = 240
/** A notification is truncated to fit down to this width; below it, it drops. */
const NOTICE_MIN_PX = 128
/** One more issue is named, truncated to the room left, while at least half of it and this width show; else it stays grouped. */
const PILL_MIN_PX = 64
/** An inline operation's width until room left over widens it. */
const OPERATION_MAX_PX = 192

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

/** What a chip looks like: kind, tone and count. The ruler measures each look once. */
const chipLook = (chip: StatusChip) => `${chip.id}:${chip.severity}:${chip.count}`

// ---------------------------------------------------------------------------
// Fit: how the issues, the inline notifications and the running work share the room
// ---------------------------------------------------------------------------

interface BarFit {
  /** Issues named, worst first; the rest show as the chips of `StatusIssues.chipsAfter[named]`. */
  named: number
  /** The width the last named pill is truncated to, when it fits only truncated. */
  squeezed: number | null
  /** Those chips shown; the trailing ones fold into "+N". */
  chips: number
  /** The width of each inline notification shown, newest first. */
  notices: number[]
  /** The width of each inline operation. */
  work: number[]
}

/** Natural widths, in bar order; `notices` newest first. */
interface BarWidths {
  /** Each issue as a named pill; none below 768 px, where nothing is named. */
  pills: number[]
  /** The chips of `StatusIssues.chipsAfter[k]`. */
  chipsAfter: number[][]
  more: number
  empty: number
  notices: number[]
  work: number[]
}

const rowWidth = (widths: number[]) => widths.reduce((sum, w, i) => sum + w + (i > 0 ? CHIP_GAP_PX : 0), 0)

/**
 * The densest fit for `room`, the width the issues and the inline notices
 * share with what the running work is widened by. What gives way first: the
 * named pills, the last named first, then the notices, oldest first, then
 * the trailing chips ("+N"). Room left over widens what is cut off (the
 * running work, then the notices, newest first), and what is still left
 * names one more issue, truncated.
 */
function fitBar(widths: BarWidths, room: number): BarFit {
  const rowAt = (named: number) => {
    const row = [...widths.pills.slice(0, named), ...(widths.chipsAfter[named] ?? [])]
    return row.length > 0 ? rowWidth(row) : widths.empty
  }
  let left = room
  const widen = (width: number, natural: number) => {
    const extra = Math.max(0, Math.min(left, natural - width))
    left -= extra
    return width + extra
  }
  const widenWork = () => widths.work.map((natural) => widen(Math.min(natural, OPERATION_MAX_PX), natural))
  const grouped = rowAt(0)
  if (grouped > room) {
    let used = widths.more
    let chips = 0
    for (const width of widths.chipsAfter[0] ?? []) {
      if (used + CHIP_GAP_PX + width > room) break
      used += CHIP_GAP_PX + width
      chips += 1
    }
    left = room - used
    return { named: 0, squeezed: null, chips, notices: [], work: widenWork() }
  }
  left = room - grouped
  const shown: number[] = []
  for (const natural of widths.notices) {
    const width = Math.min(natural, NOTICE_MAX_PX)
    if (width + SLOT_GAP_PX <= left) {
      left -= width + SLOT_GAP_PX
      shown.push(width)
      continue
    }
    if (left - SLOT_GAP_PX >= NOTICE_MIN_PX) {
      shown.push(left - SLOT_GAP_PX)
      left = 0
    }
    break
  }
  let named = widths.pills.length
  while (named > 0 && rowAt(named) > grouped + left) named -= 1
  left += grouped - rowAt(named)
  const work = widenWork()
  const notices = shown.map((width, i) => widen(width, widths.notices[i]!))
  const next = widths.pills[named]
  const truncated = next === undefined ? 0 : next - (rowAt(named + 1) - rowAt(named) - left)
  const squeezed = next !== undefined && truncated >= Math.max(PILL_MIN_PX, next / 2) ? truncated : null
  if (squeezed !== null) named += 1
  return { named, squeezed, chips: widths.chipsAfter[named]?.length ?? 0, notices, work }
}

const sameWidths = (a: number[], b: number[]) => a.length === b.length && a.every((w, i) => w === b[i])
const sameFit = (a: BarFit, b: BarFit) => a.named === b.named && a.squeezed === b.squeezed && a.chips === b.chips && sameWidths(a.notices, b.notices) && sameWidths(a.work, b.work)

/**
 * The fit, and the refs it measures: the chip slot (`box`), the inline
 * notices (`list`), the running work (`work`) and the ruler. Re-fits on
 * every resize of the chip slot, and whenever the ruler's words, the
 * grouping or the inline work change (issues, unread notices, running work,
 * the language). The room is the chip slot, plus the inline notices, plus
 * what the running work is widened by, so the slot changing as they do
 * keeps it.
 */
function useBarFit(status: StatusIssues, inline: Operation[]) {
  const box = useRef<HTMLDivElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const work = useRef<HTMLDivElement>(null)
  const ruler = useRef<HTMLDivElement>(null)
  const grouping = useRef<StatusChip[][]>([])
  const words = useRef<string | null>(null)
  // Every chip until the first measure, which runs before paint.
  const [fit, setFit] = useState<BarFit>({ named: 0, squeezed: null, chips: Number.POSITIVE_INFINITY, notices: [], work: [] })
  const measure = useCallback(() => {
    const row = box.current
    const marks = ruler.current
    if (!row || !marks) return
    const width = (el: Element) => el.getBoundingClientRect().width
    const marked = (kind: string) => [...marks.querySelectorAll(`[data-measure="${kind}"]`)]
    const natural = (kind: string) => marked(kind).map((el) => Math.ceil(width(el)))
    const looks = new Map(marked("chip").map((el) => [el.getAttribute("data-chip"), Math.ceil(width(el))]))
    // An operation's natural width: its label's from the ruler, plus its progress and word as laid out.
    const labels = natural("work")
    const ops = work.current ? [...work.current.querySelectorAll(":scope > [data-operation]")] : []
    const opWidths = ops.map((op, i) => Math.ceil((labels[i] ?? 0) + width(op) - width(op.querySelector("a")!)))
    const widened = ops.reduce((sum, op, i) => sum + width(op) - Math.min(opWidths[i]!, OPERATION_MAX_PX), 0)
    const notices = list.current
    const room = Math.floor(width(row) + (notices ? width(notices) + SLOT_GAP_PX : 0) + widened)
    const next = fitBar(
      {
        pills: natural("pill"),
        chipsAfter: grouping.current.map((chips) => chips.map((chip) => looks.get(chipLook(chip)) ?? 0)),
        more: natural("more")[0] ?? 0,
        empty: natural("empty")[0] ?? 0,
        notices: natural("notice"),
        work: opWidths,
      },
      room,
    )
    setFit((prev) => (sameFit(prev, next) ? prev : next))
  }, [])
  useLayoutEffect(() => {
    grouping.current = status.chipsAfter
    const marks = ruler.current
    const now = [
      marks ? [...marks.children].map((c) => `${c.getAttribute("data-measure")}:${c.textContent}`).join("|") : "",
      status.chipsAfter.map((chips) => chips.map(chipLook).join(",")).join(";"),
      inline.map((op) => `${op.status}:${op.progress.total > 0}`).join(","),
    ].join("#")
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
  }, [measure])
  return { fit, box, list, work, ruler }
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
// Middle: the issues
// ---------------------------------------------------------------------------

/** A pill straight to one issue's action, worded by the issue itself ("Cold-1 offline") or by its chip ("1 offline"); `width` truncates it to fit. */
function IssueLink({ issue, text, width }: { issue: Issue; text?: string; width?: number }) {
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
      style={width === undefined ? undefined : { maxWidth: width }}
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

/** `data-level`: 1 names every issue, 2 the first `data-named` with the rest as chips, 3 folds the trailing chips into "+N". */
function IssueSlot({ status, fit, box }: { status: StatusIssues; fit: BarFit; box: RefObject<HTMLDivElement | null> }) {
  const m = useMessages()
  const empty = status.pills.length === 0
  const named = Math.min(fit.named, status.pills.length)
  const chips = status.chipsAfter[named] ?? []
  const hidden = chips.slice(fit.chips)
  const level = empty ? "none" : named === status.pills.length ? 1 : hidden.length > 0 ? 3 : 2
  return (
    <div ref={box} role="group" aria-label={m.issues_title()} className="flex min-w-0 flex-1 items-center gap-1 overflow-hidden" data-status-chips data-level={level} data-named={empty ? undefined : named}>
      {empty ? (
        <NoIssues />
      ) : (
        <>
          {status.pills.slice(0, named).map((issue, i) => (
            <IssueLink key={issue.id} issue={issue} width={i === named - 1 ? (fit.squeezed ?? undefined) : undefined} />
          ))}
          {chips.slice(0, fit.chips).map((chip) => (
            <ChipControl key={`chip:${chip.id}`} chip={chip} />
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

/**
 * One operation: its title, progress and word ("42%", "Paused"). Inline,
 * Cancel shows on hover or focus in place of what ends the item: the word,
 * else the pulse of work whose size is unknown. `width` caps it inline.
 */
function OperationItem({ op, width, expanded = false, onCancel }: { op: Operation; width?: number; expanded?: boolean; onCancel: () => void }) {
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
    <div className={cn("group/op flex min-w-0 items-center gap-1.5", expanded && "w-full")} style={width === undefined ? undefined : { maxWidth: width }} data-operation={op.id}>
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

/** Running work, newest first: `inline` in the bar at the fitted `widths` (two from 1440 px, one below), the rest under "+N". */
function RunningWork({ running, inline, widths, group }: { running: Operation[]; inline: Operation[]; widths: number[]; group: RefObject<HTMLDivElement | null> }) {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  const rows = useRef<HTMLUListElement>(null)
  if (running.length === 0) return <span className="shrink-0 px-1">{m.status_bar_idle()}</span>
  const rest = running.length - inline.length
  const label = m.status_bar_more_running({ count: rest })
  // Focus moves before the cancelled item unmounts (WCAG 2.4.3): to the next operation in its list, while that list stays, else to the notifications trigger.
  const cancel = (op: Operation, listed: boolean) => {
    const listGoes = listed && rest <= 1
    const ops = listGoes ? [] : listed ? running : inline
    const next = ops[ops.indexOf(op) + 1]
    const scope = listed ? rows.current : group.current
    const target = (next ? scope?.querySelector<HTMLElement>(`[data-operation="${next.id}"] a`) : null) ?? group.current?.closest("footer")?.querySelector<HTMLElement>("[data-status-notice]")
    target?.focus()
    if (listGoes) setOpen(false)
    cancelOperation(op.id)
  }
  return (
    <div ref={group} role="group" aria-label={m.status_running()} className="flex min-w-0 shrink items-center gap-3" data-status-work>
      {inline.map((op, i) => (
        <OperationItem key={op.id} op={op} width={widths[i]} onCancel={() => cancel(op, false)} />
      ))}
      {rest > 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger className={pillClass("neutral", true)} title={label} aria-label={label} data-status-more="work">
            +{rest}
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-80 gap-0 p-0" aria-label={m.status_running()}>
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
// Right: notifications
// ---------------------------------------------------------------------------

const NOTICE_GLYPH: Record<NoticeTone, { icon: LucideIcon; className: string }> = {
  success: { icon: CircleCheck, className: "text-success" },
  warning: { icon: TriangleAlert, className: "text-warning" },
  danger: { icon: OctagonX, className: "text-destructive" },
  neutral: { icon: Info, className: "text-muted-foreground" },
}

/** One inline notification, after a divider; the ruler measures the same box at its natural width. */
const NOTICE_INLINE = "flex min-w-0 shrink-0 items-center gap-1 border-l border-separator pl-2"

/** "21:04" today, else the day: "27 Sep". */
function noticeTime(at: string): string {
  return at.slice(0, 10) === nowIso().slice(0, 10) ? formatTime(at) : formatNight(at.slice(0, 10))
}

/** A notification's words, and its title: the words in full plus the detail, so a truncated one reads whole on hover. */
function noticeWords(m: Messages, notice: Notice): { words: string; title: string } {
  const words = noticeText(m, notice)
  return { words, title: notice.detail ? `${words} · ${say(m, notice.detail)}` : words }
}

function NoticeRow({ notice, onNavigate }: { notice: Notice; onNavigate: () => void }) {
  const m = useMessages()
  const { icon: Glyph, className } = NOTICE_GLYPH[notice.tone]
  const { words, title } = noticeWords(m, notice)
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

/** An unread notification inline at the fitted `width`; following it marks it read. */
function InlineNotice({ notice, width }: { notice: Notice; width: number }) {
  const m = useMessages()
  const { icon: Glyph, className } = NOTICE_GLYPH[notice.tone]
  const { words, title } = noticeWords(m, notice)
  return (
    <li className={NOTICE_INLINE} style={{ maxWidth: width }} data-notice-inline={notice.id}>
      <Glyph aria-hidden="true" className={cn("size-3 shrink-0", className)} />
      {notice.href ? (
        <Link to={notice.href as never} onClick={() => markNoticesRead(notice.id)} className="min-w-0 truncate text-foreground hover:underline" title={title}>
          {words}
        </Link>
      ) : (
        <span className="min-w-0 truncate text-foreground" title={title}>
          {words}
        </span>
      )}
    </li>
  )
}

/** The unread notifications that fit, newest first, each at its fitted width. */
function InlineNotices({ notices, widths, list }: { notices: Notice[]; widths: number[]; list: RefObject<HTMLUListElement | null> }) {
  const m = useMessages()
  if (notices.length === 0) return null
  return (
    <ul ref={list} aria-label={m.status_bar_notifications()} className="flex shrink-0 items-center gap-2" data-status-notices>
      {notices.map((notice, i) => (
        <InlineNotice key={notice.id} notice={notice} width={widths[i]!} />
      ))}
    </ul>
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
  )
}

// ---------------------------------------------------------------------------
// The ruler and the bar
// ---------------------------------------------------------------------------

function RulerPill({ measure, look, icon: Icon, severity, text }: { measure: "pill" | "chip"; look?: string; icon: LucideIcon; severity: IssueSeverity; text: string }) {
  return (
    <span data-measure={measure} data-chip={look} className={pillClass(SEVERITY_TONE[severity])}>
      <Icon />
      <span>{text}</span>
    </span>
  )
}

/**
 * Every candidate at its natural width, invisible and out of the layout, so a
 * fit is chosen before paint: each named pill, each chip look of every
 * grouping, the inline notifications and the inline operations' titles.
 */
function BarRuler({ status, notices, work, narrow, ruler }: { status: StatusIssues; notices: Notice[]; work: Operation[]; narrow: boolean; ruler: RefObject<HTMLDivElement | null> }) {
  const m = useMessages()
  const looks = new Map(status.chipsAfter.flat().map((chip) => [chipLook(chip), chip]))
  return (
    <div aria-hidden="true" className="pointer-events-none invisible absolute top-0 left-0 size-0 overflow-hidden">
      <div ref={ruler} className="flex w-max items-center">
        {narrow
          ? null
          : status.pills.map((issue) => <RulerPill key={`pill:${issue.id}`} measure="pill" icon={CHIP_ICON[STATUS_CHIP_OF[issue.kind]]} severity={issue.severity} text={issueCopy(m, issue).text} />)}
        {[...looks].map(([look, chip]) => (
          <RulerPill key={`chip:${look}`} measure="chip" look={look} icon={CHIP_ICON[chip.id]} severity={chip.severity} text={chipText(m, chip)} />
        ))}
        <span data-measure="more" className={pillClass("neutral")}>
          +{status.chipsAfter[0]?.length ?? 0}
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
        {work.map((op) => (
          <span key={op.id} data-measure="work">
            {say(m, op.title)}
          </span>
        ))}
      </div>
    </div>
  )
}

export function StatusBar() {
  const m = useMessages()
  const narrow = useMediaQuery(NARROW)
  const wide = useMediaQuery(WIDE)
  const status = useStatusIssues()
  const { notices, unread } = useNotices()
  const running = useStore(selectRunning)
  const candidates = narrow ? [] : unread.slice(0, INLINE_NOTICES)
  const inline = running.slice(0, wide ? 2 : 1)
  const { fit, box, list, work, ruler } = useBarFit(status, inline)
  return (
    <footer data-chrome aria-label={m.status_bar()} className="relative flex h-6 shrink-0 items-center gap-2 border-t border-separator bg-chrome px-2 text-[0.6875rem] text-muted-foreground">
      <LocationsItem narrow={narrow} />
      <SelectionItem />
      <IssueSlot status={status} fit={fit} box={box} />
      <RunningWork running={running} inline={inline} widths={fit.work} group={work} />
      <InlineNotices notices={candidates.slice(0, fit.notices.length)} widths={fit.notices} list={list} />
      <NotificationHistory notices={notices} unread={unread} narrow={narrow} />
      <NoticeAnnouncer notice={notices[0]} />
      <BarRuler status={status} notices={candidates} work={inline} narrow={narrow} ruler={ruler} />
    </footer>
  )
}
