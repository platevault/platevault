/**
 * Night timeline (slice E: Plan and Target detail; v4's not-done item 2): a
 * compact table whose last column is the night, sunset to sunrise at the
 * planning site in its zone. The hour axis sits on top only; under it two
 * thin bands (twilight, Moon), then one compact row per subject with its
 * altitude curve, minimum-altitude line and window blocks. A row with filter
 * chips expands to one sub-row per filter, drawing that filter's Moon-clear
 * stretches tinted by its grade. Info columns sit between the label and the
 * night. Each row carries a text summary for screen readers; the drawing is
 * decorative.
 */
import { ChevronRight } from "lucide-react"
import { Fragment, type ReactNode } from "react"
import { useMessages } from "@/app/preferences"
import { type MenuEntry, ContextMenuArea, menuKey } from "@/components/app/row-menu"
import { NoteMarker, type NoteRow } from "@/components/app/tips"
import type { ObservingWindow } from "@/domain/types"
import { formatTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { type FilterChip, type FilterGrade, filterReason, gradeLabel } from "./good-tonight"
import { FilterPill, GradePill, siteTimeRange } from "./parts"
import type { NightGrid } from "./sky-tonight"

export interface NightRow {
  key: string
  /** The label cell: a link or a name. */
  label: ReactNode
  /** Plain-text name for the row's summary. */
  name: string
  /** Panel rows sit under their mosaic. */
  indent?: boolean
  altitudes: number[] | null
  windows: ObservingWindow[]
  /** Shown instead of a curve, e.g. "No catalogued coordinates". */
  note?: string
  /** Per-filter chips; null leaves the row without filter sub-rows. */
  chips: FilterChip[] | null
}

export interface NightColumn<R extends NightRow> {
  id: string
  header: ReactNode
  /** Column width, a `w-*` class. */
  width: string
  /** Shown from 80rem (1280 px) only. */
  wide?: boolean
  align?: "right"
  cell: (row: R) => ReactNode
  /** The cell of one filter sub-row. */
  filterCell?: (row: R, chip: FilterChip) => ReactNode
}

type Sky = "day" | "civil" | "nautical" | "astronomical" | "night"

function skyOf(sunAlt: number): Sky {
  if (sunAlt > 0) return "day"
  if (sunAlt > -6) return "civil"
  if (sunAlt > -12) return "nautical"
  if (sunAlt > -18) return "astronomical"
  return "night"
}

/** Brighter sky reads as more foreground tint; full night is the bare surface. */
const SKY_OPACITY: Record<Sky, number> = { day: 0.16, civil: 0.11, nautical: 0.07, astronomical: 0.035, night: 0 }

const GRADE_FILL: Record<FilterGrade, string> = { good: "var(--success)", marginal: "var(--warning)", poor: "var(--muted-foreground)" }

function segments<T>(values: T[], from: number, to: number): Array<{ value: T; start: number; end: number }> {
  const out: Array<{ value: T; start: number; end: number }> = []
  for (let i = from; i <= to; i += 1) {
    const value = values[i]!
    const last = out[out.length - 1]
    if (last && last.value === value) last.end = i + 1
    else out.push({ value, start: i, end: i + 1 })
  }
  return out
}

interface Scale {
  span: number
  x: (ms: number) => number
  /** Label density: rank 0 every fourth hour, 1 every second, 2 the rest; narrow tracks show fewer. */
  hours: Array<{ x: number; label: string; rank: 0 | 1 | 2 }>
  nowX: number | null
}

function timeScale(grid: NightGrid, nowMs: number): Scale {
  const span = grid.to - grid.from + 1
  const startMs = grid.samples[grid.from]!.ms
  const stepMs = grid.samples[1]!.ms - grid.samples[0]!.ms
  const x = (ms: number) => (ms - startMs) / stepMs
  const hours: Scale["hours"] = []
  const firstHour = Math.ceil(startMs / 3_600_000) * 3_600_000
  for (let ms = firstHour; ms <= grid.samples[grid.to]!.ms; ms += 3_600_000) hours.push({ x: x(ms), label: formatTime(new Date(ms).toISOString(), grid.site.timeZone), rank: hours.length % 4 === 0 ? 0 : hours.length % 2 === 0 ? 1 : 2 })
  const nowX = x(nowMs)
  return { span, x, hours, nowX: nowX >= 0 && nowX <= span ? nowX : null }
}

function Track({ scale, className, children }: { scale: Scale; className: string; children: ReactNode }) {
  return (
    <svg aria-hidden="true" viewBox={`0 0 ${scale.span} 100`} preserveAspectRatio="none" className={cn("block w-full", className)}>
      {scale.hours.map((h) => (
        <line key={h.x} x1={h.x} x2={h.x} y1={0} y2={100} stroke="var(--separator)" strokeOpacity={0.6} vectorEffect="non-scaling-stroke" />
      ))}
      {children}
      {scale.nowX !== null ? <line x1={scale.nowX} x2={scale.nowX} y1={0} y2={100} stroke="var(--warning)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" /> : null}
    </svg>
  )
}

function SkyShade({ grid }: { grid: NightGrid }) {
  return (
    <>
      {segments(
        grid.samples.map((s) => skyOf(s.sunAlt)),
        grid.from,
        grid.to,
      ).map((seg) =>
        SKY_OPACITY[seg.value] > 0 ? <rect key={seg.start} x={seg.start - grid.from} y={0} width={seg.end - seg.start} height={100} fill="var(--foreground)" fillOpacity={SKY_OPACITY[seg.value]} /> : null,
      )}
    </>
  )
}

const LABEL_W = "w-36"

export interface NightTableProps<R extends NightRow> {
  grid: NightGrid
  nowMs: number
  minAltitudeDeg: number
  moonIlluminationPct: number
  /** Names the table for screen readers. */
  caption: string
  /** Header of the label column, e.g. "Target". */
  labelHeader: string
  rows: R[]
  columns?: NightColumn<R>[]
  /** Rows whose filter sub-rows are open. */
  expanded: ReadonlySet<string>
  onToggle: (key: string) => void
  /** A trailing narrow cell per row, e.g. remove from the Plan list. */
  trailing?: (row: R) => ReactNode
  /** Right-click menu per row. */
  menu?: (key: string) => MenuEntry[]
  /** Method and basis behind the drawing (the legend's ① note). */
  note: NoteRow[]
}

export function NightTable<R extends NightRow>({ grid, nowMs, minAltitudeDeg, moonIlluminationPct, caption, labelHeader, rows, columns = [], expanded, onToggle, trailing, menu, note }: NightTableProps<R>) {
  const m = useMessages()
  const scale = timeScale(grid, nowMs)
  const minY = 100 - minAltitudeDeg * (100 / 90)
  const moonSegments = segments(
    grid.samples.map((s) => s.moonAlt > 0),
    grid.from,
    grid.to,
  ).filter((s) => s.value)
  const colClass = (c: NightColumn<R>) => cn(c.width, c.wide && "hidden min-[80rem]:table-column")
  const cellClass = (c: NightColumn<R>) => cn("px-1.5 whitespace-nowrap tabular-nums", c.align === "right" ? "text-right" : "text-left", c.wide && "hidden min-[80rem]:table-cell")
  const blank = columns.map((c) => <td key={c.id} className={cellClass(c)} />)

  const table = (
    <table className="w-full table-fixed border-collapse text-sm" data-night-table>
      <caption className="sr-only">{caption}</caption>
      <colgroup>
        <col className={LABEL_W} />
        {columns.map((c) => (
          <col key={c.id} className={colClass(c)} />
        ))}
        <col />
        {trailing ? <col className="w-7" /> : null}
      </colgroup>
      <thead data-chrome className="text-[0.6875rem] text-muted-foreground">
        <tr className="h-6 border-b border-separator">
          <th scope="col" className="px-2 text-left font-medium">
            {labelHeader}
          </th>
          {columns.map((c) => (
            <th key={c.id} scope="col" className={cn(cellClass(c), "font-medium")}>
              {c.header}
            </th>
          ))}
          <th scope="col" className="overflow-hidden p-0 font-normal">
            <span className="sr-only">{m.tonight_axis({ zone: grid.site.timeZone })}</span>
            {/* Table cells cannot be size containers, so the axis sits in its own block. */}
            <div aria-hidden="true" className="@container relative h-6 w-full">
              {scale.hours.map((h) =>
                h.x / scale.span > 0.03 && h.x / scale.span < 0.97 ? (
                  <span key={h.x} className={cn("absolute top-1/2 -translate-x-1/2 -translate-y-1/2 tabular-nums", h.rank === 1 && "hidden @min-[26rem]:inline", h.rank === 2 && "hidden @min-[50rem]:inline")} style={{ left: `${(h.x / scale.span) * 100}%` }}>
                    {h.label}
                  </span>
                ) : null,
              )}
            </div>
          </th>
          {trailing ? (
            <th scope="col">
              <span className="sr-only">{m.tonight_actions()}</span>
            </th>
          ) : null}
        </tr>
        <tr aria-hidden="true" className="h-3">
          <td className="px-2 text-[0.625rem] leading-3">{m.tonight_twilight()}</td>
          {blank}
          <td className="p-0">
            <Track scale={scale} className="h-2.5">
              <SkyShade grid={grid} />
            </Track>
          </td>
          {trailing ? <td /> : null}
        </tr>
        <tr aria-hidden="true" className="h-3 border-b border-separator">
          <td className="px-2 text-[0.625rem] leading-3">{m.tonight_moon_band({ illumination: moonIlluminationPct })}</td>
          {blank}
          <td className="p-0">
            <Track scale={scale} className="h-2.5">
              {moonSegments.map((seg) => (
                <rect key={seg.start} x={seg.start - grid.from} y={20} width={seg.end - seg.start} height={60} fill="var(--muted-foreground)" fillOpacity={0.2 + (moonIlluminationPct / 100) * 0.5} />
              ))}
            </Track>
          </td>
          {trailing ? <td /> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const open = row.chips !== null && expanded.has(row.key)
          const summary =
            row.note ??
            (row.windows.length > 0 ? m.tonight_summary_windows({ windows: row.windows.map((w) => m.tonight_summary_window({ range: siteTimeRange(w.start, w.end, grid.site), altitude: Math.round(w.maxAltitudeDeg) })).join("; ") }) : m.tonight_no_window())
          const curve = row.altitudes
            ? row.altitudes
                .slice(grid.from, grid.to + 1)
                .map((alt, i) => `${i + 0.5},${100 - Math.max(0, Math.min(90, alt)) * (100 / 90)}`)
                .join(" ")
            : null
          return (
            <Fragment key={row.key}>
              <tr {...(menu ? menuKey(row.key) : {})} data-night-row={row.key} className="h-6 border-b border-border/50 hover:bg-foreground/[0.04]">
                <th scope="row" className="px-2 text-left font-normal">
                  <span className={cn("flex min-w-0 items-center gap-1", row.indent && "pl-4")}>
                    {row.chips ? (
                      <button
                        type="button"
                        aria-expanded={open}
                        aria-label={m.tonight_filters_of({ name: row.name })}
                        onClick={() => onToggle(row.key)}
                        className="inline-flex size-4 shrink-0 items-center justify-center rounded-sm text-muted-foreground hover:bg-foreground/[0.07] hover:text-foreground"
                      >
                        <ChevronRight aria-hidden="true" className={cn("size-3 transition-transform motion-reduce:transition-none", open && "rotate-90")} />
                      </button>
                    ) : (
                      <span aria-hidden="true" className="size-4 shrink-0" />
                    )}
                    <span className="flex min-w-0 items-center gap-1 truncate" title={row.name}>
                      {row.label}
                    </span>
                    <span className="sr-only">: {summary}</span>
                  </span>
                </th>
                {columns.map((c) => (
                  <td key={c.id} className={cn(cellClass(c), "text-xs")}>
                    {c.cell(row)}
                  </td>
                ))}
                <td className="p-0">
                  <Track scale={scale} className="h-6">
                    <SkyShade grid={grid} />
                    <line x1={0} x2={scale.span} y1={minY} y2={minY} stroke="var(--muted-foreground)" strokeOpacity={0.5} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
                    {row.windows.map((w) => (
                      <rect
                        key={w.key}
                        x={Math.max(0, scale.x(Date.parse(w.start)))}
                        y={60}
                        width={Math.max(0.5, scale.x(Date.parse(w.end)) - scale.x(Date.parse(w.start)))}
                        height={34}
                        fill="var(--primary)"
                        fillOpacity={0.35}
                        stroke="var(--primary)"
                        strokeWidth={1}
                        vectorEffect="non-scaling-stroke"
                      />
                    ))}
                    {curve ? <polyline points={curve} fill="none" stroke="var(--link)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" strokeLinejoin="round" /> : null}
                  </Track>
                </td>
                {trailing ? <td className="px-0.5 text-center">{trailing(row)}</td> : null}
              </tr>
              {open
                ? row.chips!.map((chip) => (
                    <tr key={chip.band} {...(menu ? menuKey(row.key) : {})} data-filter-row={`${row.key}:${chip.band}`} className="h-5 border-b border-border/30 bg-foreground/[0.025] text-xs">
                      <th scope="row" className="px-2 text-left font-normal">
                        <span className={cn("flex items-center", row.indent ? "pl-9" : "pl-5")}>
                          <FilterPill chip={chip} />
                          <span className="sr-only">: {filterReason(chip)}</span>
                        </span>
                      </th>
                      {columns.map((c) => (
                        <td key={c.id} className={cn(cellClass(c), "text-muted-foreground")}>
                          {c.filterCell?.(row, chip)}
                        </td>
                      ))}
                      <td className="p-0">
                        <Track scale={scale} className="h-5">
                          {chip.stretches.map((s) => (
                            <rect
                              key={s.start}
                              x={Math.max(0, scale.x(Date.parse(s.start)))}
                              y={28}
                              width={Math.max(0.5, scale.x(Date.parse(s.end)) - scale.x(Date.parse(s.start)))}
                              height={44}
                              rx={0.5}
                              fill={GRADE_FILL[chip.grade]}
                              fillOpacity={chip.grade === "poor" ? 0.3 : 0.6}
                            />
                          ))}
                        </Track>
                      </td>
                      {trailing ? <td /> : null}
                    </tr>
                  ))
                : null}
            </Fragment>
          )
        })}
      </tbody>
    </table>
  )

  return (
    <figure className="min-w-0 space-y-1.5" aria-label={caption}>
      {menu ? (
        <ContextMenuArea menu={menu} className="block">
          {table}
        </ContextMenuArea>
      ) : (
        table
      )}
      <figcaption className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 pb-1 text-[0.6875rem] text-muted-foreground" data-chrome>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-0.5 w-3 bg-link" />
          {m.tonight_altitude()}
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-0 w-3 border-t border-dashed border-muted-foreground" />
          {minAltitudeDeg}°
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-2 w-3 rounded-[2px] border border-primary bg-primary/35" />
          {m.tonight_window()}
        </span>
        <span className="inline-flex items-center gap-1">
          <span aria-hidden="true" className="inline-block h-2.5 w-0.5 bg-warning" />
          {m.tonight_now()}
        </span>
        <span className="inline-flex items-center gap-1">
          <GradePill grade="good">{gradeLabel("good")}</GradePill>
          <GradePill grade="marginal">{gradeLabel("marginal")}</GradePill>
          <GradePill grade="poor">{gradeLabel("poor")}</GradePill>
        </span>
        <NoteMarker label={m.tonight_method()} rows={note} />
      </figcaption>
    </figure>
  )
}
