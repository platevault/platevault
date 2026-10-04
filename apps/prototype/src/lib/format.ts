/**
 * Shared display formatting. Every track formats durations, sizes, dates and
 * coordinates through these so numbers read the same on every surface.
 * Locale is en-GB (product copy), 24-hour clock.
 */

const LOCALE = "en-GB"

/** Integration time: "9h 15m", "45m", "0h 00m" for zero. */
export function formatDuration(seconds: number): string {
  const totalMinutes = Math.round(seconds / 60)
  const h = Math.floor(totalMinutes / 60)
  const m = totalMinutes % 60
  if (h === 0 && m > 0) return `${m}m`
  return `${h}h ${String(m).padStart(2, "0")}m`
}

/** Exposure: "300 s", "1.2 s", "32 µs" for bias-length exposures. */
export function formatExposure(seconds: number): string {
  if (seconds < 0.001) return `${Math.round(seconds * 1_000_000)} µs`
  if (seconds < 10) return `${Number(seconds.toFixed(2))} s`
  return `${Math.round(seconds)} s`
}

const BYTE_UNITS = ["B", "KB", "MB", "GB", "TB"] as const

/** Decimal byte sizes, matching the macOS Finder: "12.4 GB". */
export function formatBytes(bytes: number): string {
  let value = bytes
  let unit = 0
  while (value >= 1000 && unit < BYTE_UNITS.length - 1) {
    value /= 1000
    unit += 1
  }
  const digits = unit === 0 || value >= 100 ? 0 : 1
  return `${value.toFixed(digits)} ${BYTE_UNITS[unit]}`
}

const countFormat = new Intl.NumberFormat(LOCALE)

export function formatCount(value: number): string {
  return countFormat.format(value)
}

/** "208 lights", "1 light". Pass the plural when it is irregular. */
export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatCount(count)} ${count === 1 ? singular : pluralForm}`
}

// Product copy uses three-letter months ("18 Sep"); ICU's en-GB short month
// for September is "Sept", so months come from this table instead.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const

/** Observing night label from `YYYY-MM-DD`: "18 Sep" or "18 Sep 2026". */
export function formatNight(night: string, withYear = false): string {
  const [year, month, day] = night.split("-").map(Number)
  const label = `${day} ${MONTHS[(month ?? 1) - 1]}`
  return withYear ? `${label} ${year}` : label
}

/** Date and time in a named time zone: "18 Sep 2026, 21:04". */
export function formatDateTime(iso: string, timeZone?: string): string {
  const parts = new Intl.DateTimeFormat(LOCALE, {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).formatToParts(new Date(iso))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? ""
  return `${Number(part("day"))} ${MONTHS[Number(part("month")) - 1]} ${part("year")}, ${part("hour")}:${part("minute")}`
}

/** Clock time in a named time zone: "21:04". */
export function formatTime(iso: string, timeZone?: string): string {
  return new Intl.DateTimeFormat(LOCALE, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone }).format(
    new Date(iso),
  )
}

/** Right ascension in degrees to "20h 59m 00s". */
export function formatRa(raDeg: number): string {
  const totalSeconds = Math.round((raDeg / 15) * 3600)
  const h = Math.floor(totalSeconds / 3600) % 24
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`
}

/** Declination in degrees to "+44° 31′ 48″". */
export function formatDec(decDeg: number): string {
  const sign = decDeg < 0 ? "−" : "+"
  const totalSeconds = Math.round(Math.abs(decDeg) * 3600)
  const d = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  return `${sign}${d}° ${String(m).padStart(2, "0")}′ ${String(s).padStart(2, "0")}″`
}

/** Angle in degrees with one decimal: "1.4°". */
export function formatDegrees(deg: number, digits = 1): string {
  return `${deg.toFixed(digits)}°`
}
