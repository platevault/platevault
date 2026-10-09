/**
 * The status bar (foundation-owned; round 1b "Status bar"): the window's
 * full bottom bar, terse words, pills and counts only.
 *
 * - Left: locations online, then the context slot: the selection count a
 *   list reports with `useStatusSelection` (`status-selection.ts`).
 * - Middle: issue chips by kind (offline, blocked runs, need a Target,
 *   calibration waiting), from the same issues as the Issues hub
 *   (`useStatusChips`). A chip covering one issue links to its action; a chip
 *   covering several lists them. Chips that do not fit collapse into "+N".
 * - Right: running work, each with a mini progress bar and Cancel on hover
 *   or focus (more than fit collapse into "+N"), and the last notification,
 *   which opens the notification history.
 */
import { Link } from "@tanstack/react-router"
import { Ban, CircleCheck, Crosshair, HardDrive, Info, Layers, type LucideIcon, OctagonX, SquareCheck, TriangleAlert, Unplug, X } from "lucide-react"
import { useLayoutEffect, useRef, useState } from "react"
import { Pill, pillClass } from "@/components/app/pill"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import type { StatusChip, StatusChipId } from "@/domain/issues"
import { locationAvailability } from "@/domain/library"
import type { Operation } from "@/domain/types"
import { formatNight, formatTime } from "@/lib/format"
import { useMediaQuery } from "@/lib/use-media-query"
import { cn } from "@/lib/utils"
import { nowIso, type PrototypeState, useStore } from "@/store/core"
import { useStatusChips } from "@/store/issues"
import { type Notice, type NoticeTone, useNotices } from "@/store/notifications"
import { cancelOperation } from "@/store/operations"
import { IssueRow, issueText, SEVERITY_TONE } from "./issues-hub"
import { type Translate, useT } from "./preferences"
import { useSelectionContext } from "./status-selection"

const NARROW = "(max-width: 767.98px)"
/** Two running operations show inline from here; below it one, so the issue chips keep their room. */
const WIDE = "(min-width: 1440px)"

const CHIP_ICON: Record<StatusChipId, LucideIcon> = { offline: Unplug, blocked: Ban, "needs-target": Crosshair, calibration: Layers }

/** Matches the chip row's `gap-1`. */
const CHIP_GAP_PX = 4

function chipText(t: Translate, chip: StatusChip): string {
  return t(chip.label, { n: chip.count, name: chip.name ?? "" })
}

const selectLocations = (s: PrototypeState) => {
  const live = Object.values(s.catalog.locations).filter((l) => !l.retiredAt)
  return { total: live.length, online: live.filter((l) => locationAvailability(s.disk, l) === "online").length }
}

function LocationsItem({ narrow }: { narrow: boolean }) {
  const t = useT()
  const { online, total } = useStore(selectLocations)
  const text = t("{n} of {total} online", { n: online, total })
  return (
    <Button variant="ghost" size="xs" render={<Link to="/settings/locations" />} className="shrink-0 text-muted-foreground" title={`${t("Locations")}: ${text}`} data-status-locations>
      <HardDrive data-icon="inline-start" aria-hidden="true" />
      <span className={cn("tabular-nums", narrow && "sr-only")}>{text}</span>
    </Button>
  )
}

function SelectionItem() {
  const t = useT()
  const selection = useSelectionContext()
  if (!selection) return null
  return (
    <span className="inline-flex shrink-0 items-center gap-1 border-l border-separator pl-2 text-foreground tabular-nums" data-status-selection>
      <SquareCheck aria-hidden="true" className="size-3 text-link" />
      {selection.total !== null ? t("{n} of {total} selected", { n: selection.count, total: selection.total }) : t("{n} selected", { n: selection.count })}
    </span>
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
  const t = useT()
  const [open, setOpen] = useState(false)
  const Icon = CHIP_ICON[chip.id]
  const tone = SEVERITY_TONE[chip.severity]
  const text = chipText(t, chip)
  const only = chip.issues.length === 1 ? chip.issues[0]! : null
  if (only) {
    return (
      <Pill tone={tone} icon={Icon} link={only.action.link} title={`${issueText(t, only)} · ${t(only.action.label)}`}>
        {text}
      </Pill>
    )
  }
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={pillClass(tone, true)} title={text} data-pill={tone}>
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
  const t = useT()
  const [open, setOpen] = useState(false)
  const label = t("{n} more", { n: chips.length })
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger className={pillClass("neutral", true)} title={label} aria-label={label} data-status-more="chips">
        +{chips.length}
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="max-h-[min(28rem,var(--available-height))] w-80 gap-0 overflow-y-auto p-0" aria-label={label}>
        {chips.map((chip) => {
          const Icon = CHIP_ICON[chip.id]
          return (
            <section key={chip.id} aria-label={chipText(t, chip)} className="border-b border-border last:border-0">
              <h3 data-chrome className="flex items-center gap-1.5 px-3 pt-2 text-[0.6875rem] font-semibold text-muted-foreground">
                <Icon aria-hidden="true" className="size-3" />
                {chipText(t, chip)}
              </h3>
              <ChipIssues chip={chip} onNavigate={() => setOpen(false)} />
            </section>
          )
        })}
      </PopoverContent>
    </Popover>
  )
}

/**
 * The issue chips, as many as fit: an invisible ruler row measures every
 * chip and the "+N" button, so the visible row never wraps or clips a chip.
 */
function IssueChips() {
  const t = useT()
  const chips = useStatusChips()
  const box = useRef<HTMLDivElement>(null)
  const ruler = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState(chips.length)
  const key = chips.map((c) => `${c.id}:${c.count}:${c.severity}:${c.name ?? ""}`).join("|")
  useLayoutEffect(() => {
    const row = box.current
    const marks = ruler.current
    if (!row || !marks) return
    const fit = () => {
      const widths = [...marks.children].map((child) => (child as HTMLElement).offsetWidth)
      const more = widths.pop() ?? 0
      const available = row.clientWidth
      const all = widths.reduce((sum, w, i) => sum + w + (i > 0 ? CHIP_GAP_PX : 0), 0)
      if (all <= available) return setShown(widths.length)
      let used = more
      let n = 0
      for (const w of widths) {
        if (used + CHIP_GAP_PX + w > available) break
        used += CHIP_GAP_PX + w
        n += 1
      }
      setShown(n)
    }
    fit()
    const observer = new ResizeObserver(fit)
    observer.observe(row)
    return () => observer.disconnect()
  }, [key, t])
  const hidden = chips.slice(shown)
  return (
    <div ref={box} role="group" aria-label={t("Issues")} className="relative flex min-w-0 flex-1 items-center gap-1 overflow-hidden" data-status-chips>
      {chips.slice(0, shown).map((chip) => (
        <ChipControl key={chip.id} chip={chip} />
      ))}
      {hidden.length > 0 ? <MoreChips chips={hidden} /> : null}
      <div ref={ruler} aria-hidden="true" className="pointer-events-none invisible absolute top-0 left-0 flex whitespace-nowrap">
        {chips.map((chip) => {
          const Icon = CHIP_ICON[chip.id]
          return (
            <span key={chip.id} className={pillClass(SEVERITY_TONE[chip.severity])}>
              <Icon />
              <span>{chipText(t, chip)}</span>
            </span>
          )
        })}
        <span className={pillClass("neutral")}>+{chips.length}</span>
      </div>
    </div>
  )
}

/** A mini progress bar; work whose size is unknown (a tool stacking) pulses instead. */
function MiniProgress({ value, label }: { value: number | null; label: string }) {
  const t = useT()
  if (value === null) {
    return <span role="progressbar" aria-label={label} aria-valuetext={t("Working")} className="block h-1 w-10 shrink-0 animate-pulse rounded-full bg-primary/40 motion-reduce:animate-none" />
  }
  return <Progress value={value} aria-label={label} className="w-10 shrink-0 gap-0 [&_[data-slot=progress-track]]:bg-foreground/15" />
}

function OperationItem({ op, expanded = false }: { op: Operation; expanded?: boolean }) {
  const t = useT()
  const pct = op.progress.total > 0 ? Math.round((op.progress.done / op.progress.total) * 100) : null
  const word = op.status === "paused" ? t("Paused") : pct !== null ? `${pct}%` : ""
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
            aria-label={`${t("Cancel")}: ${op.title}`}
            title={t("Cancel")}
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
  const t = useT()
  const running = useStore(selectRunning)
  const wide = useMediaQuery(WIDE)
  const [open, setOpen] = useState(false)
  if (running.length === 0) return <span className="shrink-0 px-1">{t("Idle")}</span>
  const inline = running.slice(0, wide ? 2 : 1)
  const rest = running.length - inline.length
  const label = t("{n} more running", { n: rest })
  return (
    <div role="group" aria-label={t("Running")} className="flex min-w-0 shrink items-center gap-3" data-status-work>
      {inline.map((op) => (
        <OperationItem key={op.id} op={op} />
      ))}
      {rest > 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger className={pillClass("neutral", true)} title={label} aria-label={label} data-status-more="work">
            +{rest}
          </PopoverTrigger>
          <PopoverContent side="top" align="end" className="w-80 gap-0 p-0" aria-label={t("Running")}>
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
  const { icon: Glyph, className } = NOTICE_GLYPH[notice.tone]
  const text = notice.href ? (
    <Link to={notice.href as never} onClick={onNavigate} className="min-w-0 flex-1 truncate hover:underline" title={notice.detail ?? notice.text}>
      {notice.text}
    </Link>
  ) : (
    <span className="min-w-0 flex-1 truncate" title={notice.detail ?? notice.text}>
      {notice.text}
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

/** The last notification; its popover holds the history, newest first. */
function LastNotification() {
  const t = useT()
  const notices = useNotices()
  const [open, setOpen] = useState(false)
  const latest = notices[0]
  if (!latest) return null
  const { icon: Glyph, className } = NOTICE_GLYPH[latest.tone]
  return (
    <>
      <span role="status" className="sr-only">
        {latest.text}
      </span>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger
          render={<Button variant="ghost" size="xs" className="min-w-0 max-w-48 shrink justify-start text-muted-foreground min-[1440px]:max-w-72" />}
          title={latest.text}
          aria-label={`${t("Notifications")}: ${latest.text}`}
          data-status-notice
        >
          <Glyph data-icon="inline-start" aria-hidden="true" className={className} />
          <span className="truncate">{latest.text}</span>
        </PopoverTrigger>
        <PopoverContent side="top" align="end" className="w-96 gap-0 p-0" aria-label={t("Notifications")}>
          <div data-chrome className="flex items-center gap-2 border-b border-border px-3 py-1.5">
            <h2 className="flex-1 text-sm font-semibold">{t("Notifications")}</h2>
            <Button variant="ghost" size="xs" className="text-link" render={<Link to="/activity" />} onClick={() => setOpen(false)}>
              {t("Activity")}
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

export function StatusBar() {
  const t = useT()
  const narrow = useMediaQuery(NARROW)
  return (
    <footer data-chrome aria-label={t("Status")} className="flex h-6 shrink-0 items-center gap-2 border-t border-separator bg-chrome px-2 text-[0.6875rem] text-muted-foreground">
      <LocationsItem narrow={narrow} />
      <SelectionItem />
      <IssueChips />
      <RunningWork />
      <LastNotification />
    </footer>
  )
}
