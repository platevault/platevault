/**
 * Data display primitives (foundation-owned): key-value lists, stats,
 * paths, channel coverage and filter chips. EvidenceList is in
 * evidence-list.tsx (a DataTable, which itself uses FilterChips).
 */
import { X } from "lucide-react"
import { useRef, type ReactNode } from "react"
import { useMessages } from "@/app/preferences"
import { Button } from "@/components/ui/button"
import type { QualityBreakdown } from "@/domain/library"
import { formatCount, formatDateTime, formatDuration } from "@/lib/format"
import { cn } from "@/lib/utils"
import { titleWhenCut } from "./cut-title"

export interface KeyValueItem {
  label: string
  value: ReactNode
  /** Monospace for paths, hashes and identifiers. */
  mono?: boolean
  /** Where the value came from, e.g. "Header FILTER", "Catalog correction". */
  source?: string
}

/**
 * Label/value pairs with optional source notes. Layout follows the space the
 * list actually has (a container query, so it also follows text zoom): two
 * columns of pairs from 46rem when `columns={2}`, label beside value from
 * 22rem, and label above value below that. Nothing scrolls sideways at 200%
 * text (WCAG 1.4.4, 1.4.10). Source notes use the data face and wrap.
 */
export function KeyValueList({ items, className, columns = 1 }: { items: KeyValueItem[]; className?: string; columns?: 1 | 2 }) {
  return (
    <div className={cn("@container/kv min-w-0", className)}>
      <dl className={cn("grid grid-cols-1 gap-x-6 gap-y-2 text-sm", columns === 2 && "@min-[46rem]/kv:grid-cols-2")}>
        {items.map((item) => (
          <div key={item.label} className="grid min-w-0 grid-cols-1 gap-0.5 @min-[22rem]/kv:grid-cols-[10rem_minmax(0,1fr)] @min-[22rem]/kv:items-baseline @min-[22rem]/kv:gap-3">
            <dt className="text-muted-foreground">{item.label}</dt>
            <dd className={cn("min-w-0 tabular-nums [overflow-wrap:anywhere]", item.mono && "font-mono text-xs break-all")}>
              {item.value}
              {item.source ? <span className="ml-2 font-mono text-xs text-muted-foreground [overflow-wrap:anywhere]">{item.source}</span> : null}
            </dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

export function Stat({ label, value, hint, className }: { label: string; value: ReactNode; hint?: ReactNode; className?: string }) {
  return (
    <div className={cn("min-w-0 space-y-0.5", className)}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-base font-semibold tabular-nums">{value}</div>
      {hint ? <div className="text-xs text-muted-foreground">{hint}</div> : null}
    </div>
  )
}

/**
 * A filesystem path in monospace. It wraps by default so the whole path is
 * visible to everyone; `truncate` is for dense table cells only, where the
 * row's detail pane must show the full path, and the cut path shows in full
 * on hover.
 */
export function PathText({ path, className, truncate = false }: { path: string; className?: string; truncate?: boolean }) {
  return (
    <span className={cn("block font-mono text-xs", truncate ? "truncate" : "[overflow-wrap:anywhere]", className)} onPointerEnter={truncate ? titleWhenCut : undefined}>
      {path}
    </span>
  )
}

export interface ChannelCoverageProps {
  channel: string
  breakdown: QualityBreakdown
  /** Optional goal in seconds (Project checklist). */
  goalS?: number
  /** Oldest last verification among the frames counted Usable (D19); labels the usable figure. */
  usableVerifiedAt?: string | null
}

/**
 * Coverage for one channel: captured, library-usable and Unreviewed
 * integration, with unavailable and changed-content time named separately
 * (LIB-FR-08). The usable figure names when its frames were last verified
 * (D19). The bar is decorative; the numbers carry the meaning.
 */
export function ChannelCoverage({ channel, breakdown, goalS, usableVerifiedAt }: ChannelCoverageProps) {
  const m = useMessages()
  const scale = Math.max(breakdown.captured.seconds, goalS ?? 0, 1)
  const pct = (seconds: number) => `${(seconds / scale) * 100}%`
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <span className="font-medium">{channel}</span>
        <span className="text-xs text-muted-foreground tabular-nums">
          {m.coverage_frames_captured({ count: breakdown.captured.frames, frames: formatCount(breakdown.captured.frames) })}
          {goalS ? ` · ${m.coverage_goal({ duration: formatDuration(goalS) })}` : ""}
        </span>
      </div>
      <div aria-hidden="true" className="relative flex h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: pct(breakdown.usable.seconds) }} />
        <div className="h-full bg-primary/35" style={{ width: pct(breakdown.unreviewed.seconds) }} />
        <div
          className="h-full bg-foreground/25"
          style={{ width: pct(breakdown.unusable.seconds + breakdown.changedContent.seconds + breakdown.verificationPending.seconds) }}
        />
        {goalS ? <div className="absolute inset-y-0 w-0.5 bg-foreground" style={{ left: `calc(${pct(goalS)} - 1px)` }} /> : null}
      </div>
      {/* Pairs wrap value under label when a cell is narrow (200% text), so nothing spills into the next cell. */}
      <dl className="grid grid-cols-2 gap-x-4 gap-y-0.5 text-xs tabular-nums sm:grid-cols-4">
        <div className="flex min-w-0 flex-wrap gap-x-1.5">
          <dt className="text-muted-foreground">{m.coverage_captured()}</dt>
          <dd>{formatDuration(breakdown.captured.seconds)}</dd>
        </div>
        <div className="flex min-w-0 flex-wrap gap-x-1.5">
          <dt className="text-muted-foreground">{m.status_usable()}</dt>
          <dd>{formatDuration(breakdown.usable.seconds)}</dd>
          {usableVerifiedAt && breakdown.usable.frames > 0 ? (
            <dd className="basis-full text-muted-foreground">{m.coverage_last_verified({ date: formatDateTime(usableVerifiedAt) })}</dd>
          ) : null}
        </div>
        <div className="flex min-w-0 flex-wrap gap-x-1.5">
          <dt className="text-muted-foreground">{m.status_unreviewed()}</dt>
          <dd>{formatDuration(breakdown.unreviewed.seconds)}</dd>
        </div>
        {breakdown.unavailable.frames > 0 ? (
          <div className="flex min-w-0 flex-wrap gap-x-1.5 text-warning">
            <dt>{m.coverage_unavailable()}</dt>
            <dd>{formatDuration(breakdown.unavailable.seconds)}</dd>
          </div>
        ) : null}
        {breakdown.changedContent.frames > 0 ? (
          <div className="flex min-w-0 flex-wrap gap-x-1.5 text-warning">
            <dt>{m.status_changed_content()}</dt>
            <dd>{formatDuration(breakdown.changedContent.seconds)}</dd>
          </div>
        ) : null}
        {breakdown.verificationPending.frames > 0 ? (
          <div className="flex min-w-0 flex-wrap gap-x-1.5">
            <dt className="text-muted-foreground">{m.status_verification_pending()}</dt>
            <dd>{formatDuration(breakdown.verificationPending.seconds)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  )
}

export interface FilterChip {
  id: string
  label: string
}

export interface FilterChipsProps {
  chips: FilterChip[]
  onRemove: (id: string) => void
  onClear: () => void
  /** e.g. "12 matches"; FilterBar passes its match count. */
  matchLabel: string
  /** A filter is on even without a chip (a search query); default: any chip. */
  active?: boolean
}

/**
 * Active filters with remove buttons, the match count and Clear filters
 * (VSEL-FR-05): the chip line of FilterBar (filter-bar.tsx). The group stays
 * mounted, out of the layout while no filter is on, so its live count is
 * announced; removing a chip moves focus to the next chip, the previous one,
 * the page search, or the group itself. Not the Targets grade strip, which
 * plan P5 renames GradeBadges.
 */
export function FilterChips({ chips, onRemove, onClear, matchLabel, active = chips.length > 0 }: FilterChipsProps) {
  const m = useMessages()
  const group = useRef<HTMLDivElement>(null)
  function moveFocusAfterRemoval(index: number) {
    // Runs after the parent re-renders without the removed chip.
    requestAnimationFrame(() => {
      const buttons = group.current?.querySelectorAll<HTMLElement>("[data-chip-remove]")
      const next = buttons?.[index] ?? buttons?.[index - 1] ?? document.querySelector<HTMLElement>("[data-page-search]")
      ;(next ?? group.current)?.focus()
    })
  }
  return (
    <div ref={group} tabIndex={-1} className={cn("flex flex-wrap items-center gap-2 text-sm outline-none", !active && "sr-only")} role="group" aria-label={m.filters_active()}>
      {chips.map((chip, index) => (
        <span key={chip.id} className="inline-flex h-6 items-center gap-1 rounded-md bg-secondary pr-0.5 pl-2 text-xs text-secondary-foreground">
          {chip.label}
          <Button
            data-chip-remove
            size="icon-sm"
            variant="ghost"
            aria-label={m.filters_remove({ name: chip.label })}
            onClick={() => {
              onRemove(chip.id)
              moveFocusAfterRemoval(index)
            }}
          >
            <X aria-hidden="true" />
          </Button>
        </span>
      ))}
      <span className="text-xs text-muted-foreground tabular-nums" aria-live="polite">
        {active ? matchLabel : <span className="sr-only">{m.filters_none()}</span>}
      </span>
      {active ? (
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            onClear()
            moveFocusAfterRemoval(0)
          }}
        >
          {m.filters_clear()}
        </Button>
      ) : null}
    </div>
  )
}
