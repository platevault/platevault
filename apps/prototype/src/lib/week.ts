/**
 * Calendar weeks per locale: the first day of the week and the night that
 * starts a night's week. NightPicker's month grid and Home's 5-week
 * calendar share them, so both start their weeks on the same day.
 */
import type { Locale } from "./i18n"

/** 0 = Sunday … 6 = Saturday, as `Date.getUTCDay`. */
export type WeekStart = 0 | 1

/** The first column of a calendar week, per locale: Monday in the UK, Sunday in Brazil. Keyed by Locale, so a new locale fails typecheck. */
export const WEEK_START: Record<Locale, WeekStart> = { "en-GB": 1, "pt-BR": 0 }

/** The day of the week of a night (`YYYY-MM-DD`): 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(night: string): number {
  return new Date(`${night}T00:00:00Z`).getUTCDay()
}

/** How many nights `night` lies after the first night of its week. */
export function dayInWeek(night: string, weekStart: WeekStart): number {
  return (dayOfWeek(night) - weekStart + 7) % 7
}

/** The first night of the week that holds `night`. */
export function startOfWeek(night: string, weekStart: WeekStart): string {
  return new Date(Date.parse(`${night}T00:00:00Z`) - dayInWeek(night, weekStart) * 86_400_000).toISOString().slice(0, 10)
}
