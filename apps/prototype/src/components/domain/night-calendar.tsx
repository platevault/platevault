/**
 * NightCalendar (L2-domain, decision C8): the nights ahead at a site, one
 * week per row, starting on the locale's first day of the current week.
 * Each night shows its date, the Moon's phase, the hours of darkness, the
 * goals it suits and the Targets planned for it.
 *
 * - Grid: the WAI-ARIA grid pattern NightPicker's month grid follows. One
 *   Tab stop; the arrow keys move a night or a week, Home and End to the
 *   week's ends. Nights before `today` show their date only and take no
 *   focus.
 * - Each night is a link to its place (Targets set to that night), wrapped
 *   in a `Preview`: the card opens on hover and on keyboard focus, stays
 *   open while the pointer is over it, and Escape closes it (WCAG 1.4.13).
 *   The card holds no controls, so it takes no focus and traps none; the
 *   link is the way in.
 * - A legend under the grid names the four figures, so the cells need no
 *   tooltips.
 */
import { Link } from "@tanstack/react-router"
import { CalendarCheck, Clock, Goal } from "lucide-react"
import { type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { Preview } from "@/components/app/previews"
import { formatHours, type StepLink } from "@/domain/derive"
import type { MoonTonight } from "@/domain/planning"
import { formatCount } from "@/lib/format"
import { getLocale, type Messages, say } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { dayInWeek, startOfWeek, WEEK_START, type WeekStart } from "@/lib/week"

export interface CalendarNight {
  /** `YYYY-MM-DD`. */
  night: string
  moon: MoonTonight
  /** The Moon grows from this night to the next: its lit limb is on the right. */
  waxing: boolean
  /** Seconds of darkness at the site; null when it never gets dark. */
  darkS: number | null
  /** Unfinished goals the night suits. */
  goals: number
  /** Targets on the night's plan. */
  planned: number
  /** Where the night leads: Targets set to it. */
  link: StepLink
  /** The card's body: the dark window, the Moon, the goals it suits and rules out, the plan. */
  card: ReactNode
}

export interface NightCalendarProps {
  /** Names the grid: "Next 5 weeks". */
  label: string
  /** Tonight at the site: marked, and the night that holds the Tab stop first. */
  today: string
  /** The nights from `today` on, in order. The grid ends with the week of the last one. */
  nights: CalendarNight[]
}

const DAY_MS = 86_400_000

function shift(night: string, days: number): string {
  return new Date(Date.parse(`${night}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
}

/** Whole weeks from the start of `today`'s week through the week of `last`. */
function gridWeeks(today: string, last: string, weekStart: WeekStart): string[][] {
  const weeks: string[][] = []
  let night = startOfWeek(today, weekStart)
  while (night <= last) {
    const week: string[] = []
    for (let i = 0; i < 7; i += 1) {
      week.push(night)
      night = shift(night, 1)
    }
    weeks.push(week)
  }
  return weeks
}

const KEYS: Record<string, (night: string, weekStart: WeekStart) => string> = {
  ArrowLeft: (n) => shift(n, -1),
  ArrowRight: (n) => shift(n, 1),
  ArrowUp: (n) => shift(n, -7),
  ArrowDown: (n) => shift(n, 7),
  Home: (n, s) => startOfWeek(n, s),
  End: (n, s) => shift(n, 6 - dayInWeek(n, s)),
}

function dateFormat(options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat(getLocale(), { ...options, timeZone: "UTC" })
}

const atNoon = (night: string) => new Date(`${night}T12:00:00Z`)

/** The night's figures as one sentence: the link's accessible name. */
function nightName(m: Messages, n: CalendarNight, date: string): string {
  return m.calendar_night_name({
    date,
    moon: m.calendar_moon({ illumination: n.moon.illuminationPct, phase: say(m, n.moon.phase) }),
    dark: n.darkS === null ? m.calendar_never_dark() : m.calendar_dark({ time: formatHours(n.darkS) }),
    goals: m.calendar_goals_suit({ count: n.goals, n: formatCount(n.goals) }),
    planned: m.calendar_planned({ count: n.planned, n: formatCount(n.planned) }),
  })
}

export function NightCalendar({ label, today, nights }: NightCalendarProps) {
  const m = useMessages()
  const weekStart = WEEK_START[getLocale()]
  const byNight = useMemo(() => new Map(nights.map((n) => [n.night, n])), [nights])
  const last = nights.at(-1)?.night ?? today
  const weeks = useMemo(() => gridWeeks(today, last, weekStart), [today, last, weekStart])
  const [focus, setFocus] = useState(today)
  const current = byNight.has(focus) ? focus : today
  const grid = useRef<HTMLDivElement>(null)
  const moved = useRef(false)
  const weekday = dateFormat({ weekday: "short" })
  const weekdayLong = dateFormat({ weekday: "long" })
  const full = dateFormat({ weekday: "long", day: "numeric", month: "long" })

  useEffect(() => {
    if (!moved.current) return
    moved.current = false
    grid.current?.querySelector<HTMLElement>(`[data-night="${current}"]`)?.focus()
  }, [current])

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = KEYS[event.key]
    if (!next) return
    event.preventDefault()
    const target = next(current, weekStart)
    moved.current = true
    setFocus(target < today ? today : target > last ? last : target)
  }

  if (weeks.length === 0) return null
  return (
    <div className="grid gap-2" data-night-calendar="">
      <div ref={grid} role="grid" aria-label={label} onKeyDown={onKeyDown} className="grid gap-1">
        <div role="row" className="grid grid-cols-7 gap-1">
          {weeks[0]!.map((night) => (
            <span key={night} role="columnheader" aria-label={weekdayLong.format(atNoon(night))} className="truncate text-center text-xs text-muted-foreground">
              {weekday.format(atNoon(night))}
            </span>
          ))}
        </div>
        {weeks.map((week) => (
          <div key={week[0]} role="row" className="grid grid-cols-7 gap-1">
            {week.map((night) => {
              const entry = byNight.get(night)
              const day = Number(night.slice(8, 10))
              if (!entry) {
                return (
                  <span key={night} role="gridcell" className="flex min-h-16 items-start rounded-md p-1.5 text-xs text-muted-foreground tabular-nums">
                    {day}
                  </span>
                )
              }
              const date = full.format(atNoon(night))
              const trigger = (
                <Link
                  to={entry.link.to as never}
                  params={entry.link.params as never}
                  search={entry.link.search as never}
                  data-night={night}
                  tabIndex={night === current ? 0 : -1}
                  aria-label={nightName(m, entry, date)}
                  aria-current={night === today ? "date" : undefined}
                  onFocus={() => setFocus(night)}
                  className={cn(
                    "flex min-h-16 min-w-0 flex-col gap-0.5 rounded-md border p-1.5 text-xs tabular-nums transition-colors hover:bg-muted",
                    night === today ? "border-ring" : "border-border",
                  )}
                >
                  <span className="flex items-center justify-between gap-1">
                    <span className="font-medium">{day}</span>
                    <MoonPhase illuminationPct={entry.moon.illuminationPct} waxing={entry.waxing} />
                  </span>
                  <span className="flex min-w-0 items-center gap-0.5 text-muted-foreground">
                    <Clock aria-hidden="true" className="size-3 shrink-0" />
                    <span className="truncate">{entry.darkS === null ? "–" : formatHours(entry.darkS)}</span>
                  </span>
                  <span className="flex flex-wrap items-center gap-x-1.5">
                    <Figure icon={Goal} value={entry.goals} />
                    <Figure icon={CalendarCheck} value={entry.planned} />
                  </span>
                </Link>
              )
              return (
                <span key={night} role="gridcell" className="min-w-0">
                  <Preview trigger={trigger} title={date}>
                    {entry.card}
                  </Preview>
                </span>
              )
            })}
          </div>
        ))}
      </div>
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-calendar-legend="">
        <span className="inline-flex items-center gap-1">
          <MoonPhase illuminationPct={50} waxing />
          {m.calendar_legend_moon()}
        </span>
        <span className="inline-flex items-center gap-1">
          <Clock aria-hidden="true" className="size-3" />
          {m.calendar_legend_dark()}
        </span>
        <span className="inline-flex items-center gap-1">
          <Goal aria-hidden="true" className="size-3" />
          {m.calendar_legend_goals()}
        </span>
        <span className="inline-flex items-center gap-1">
          <CalendarCheck aria-hidden="true" className="size-3" />
          {m.calendar_legend_planned()}
        </span>
      </p>
    </div>
  )
}

function Figure({ icon: Icon, value }: { icon: typeof Goal; value: number }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", value === 0 && "text-muted-foreground")}>
      <Icon aria-hidden="true" className="size-3" />
      {formatCount(value)}
    </span>
  )
}

/**
 * The Moon's phase as a glyph: the disk, with its lit part from the
 * illuminated fraction, on the right while waxing. Decorative: the night's
 * accessible name says the phase.
 */
export function MoonPhase({ illuminationPct, waxing }: { illuminationPct: number; waxing: boolean }) {
  const r = 6
  const lit = Math.min(1, Math.max(0, illuminationPct / 100))
  // The terminator is a half-ellipse; its width shrinks to 0 at the quarters.
  const rx = Math.abs(1 - 2 * lit) * r
  const limb = waxing ? 1 : 0
  const terminator = lit < 0.5 ? 1 - limb : limb
  return (
    <svg aria-hidden="true" viewBox="-7 -7 14 14" className="size-3.5 shrink-0" data-moon-phase="">
      <circle r={r} className="fill-muted stroke-muted-foreground" strokeWidth={1} />
      {lit > 0.01 ? <path d={`M 0 ${-r} A ${r} ${r} 0 0 ${limb} 0 ${r} A ${rx} ${r} 0 0 ${terminator} 0 ${-r} Z`} className="fill-muted-foreground" /> : null}
    </svg>
  )
}
