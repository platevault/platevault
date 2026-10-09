/**
 * Data display primitives (foundation-owned): key-value lists, evidence,
 * stats, paths, channel coverage and filter chips.
 */
import { Check, CircleHelp, X } from "lucide-react"
import { useRef, type ReactNode } from "react"
import { useMessages } from "@/app/preferences"
import { Button } from "@/components/ui/button"
import type { QualityBreakdown } from "@/domain/library"
import type { Evidence } from "@/domain/types"
import { formatCount, formatDateTime, formatDuration } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { cn } from "@/lib/utils"

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

const AGREEMENT = {
  agrees: { icon: Check, word: (m: Messages) => m.evidence_agrees(), className: "text-success" },
  conflicts: { icon: X, word: (m: Messages) => m.evidence_conflicts(), className: "text-destructive" },
  unknown: { icon: CircleHelp, word: (m: Messages) => m.status_unknown(), className: "text-muted-foreground" },
} as const

function sourceName(m: Messages, source: Evidence["source"]): string {
  const name: Record<Evidence["source"], () => string> = {
    header: m.evidence_source_header,
    pointing: m.evidence_source_pointing,
    "equipment-record": m.evidence_source_equipment_record,
    user: m.evidence_source_user,
    resolver: m.evidence_source_resolver,
    catalog: m.evidence_source_catalog,
  }
  return name[source]()
}

/**
 * Evidence used for an association (LIB-FR-05), observed values first. The
 * value cell may break inside a word so the table reflows at narrow widths
 * (WCAG 1.4.10); header keywords stay whole, and a container narrower than
 * the shortest columns scrolls the table, not the page.
 */
export function EvidenceList({ evidence, caption }: { evidence: Evidence[]; caption: string }) {
  const m = useMessages()
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead className="text-xs text-muted-foreground">
          <tr className="border-b">
            <th scope="col" className="py-1.5 pr-2 text-left font-medium">{m.evidence_column_source()}</th>
            <th scope="col" className="py-1.5 pr-2 text-left font-medium">{m.evidence_column_evidence()}</th>
            <th scope="col" className="py-1.5 pr-2 text-left font-medium">{m.evidence_column_value()}</th>
            <th scope="col" className="py-1.5 text-left font-medium">{m.evidence_column_result()}</th>
          </tr>
        </thead>
        <tbody>
          {evidence.map((item) => {
            const agreement = AGREEMENT[item.agrees === true ? "agrees" : item.agrees === false ? "conflicts" : "unknown"]
            const Icon = agreement.icon
            return (
              <tr key={`${item.source}-${item.label}`} className="border-b last:border-0">
                <td className="py-1.5 pr-2 text-muted-foreground">{sourceName(m, item.source)}</td>
                <td className="py-1.5 pr-2 font-mono text-xs">{item.label}</td>
                <td className="py-1.5 pr-2 [overflow-wrap:anywhere]">{item.value}</td>
                <td className={cn("py-1.5", agreement.className)}>
                  <span className="inline-flex items-center gap-1">
                    <Icon aria-hidden="true" className="size-3.5" />
                    {agreement.word(m)}
                  </span>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
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
 * row's detail pane must show the full path.
 */
export function PathText({ path, className, truncate = false }: { path: string; className?: string; truncate?: boolean }) {
  return (
    <span className={cn("block font-mono text-xs", truncate ? "truncate" : "[overflow-wrap:anywhere]", className)} title={truncate ? path : undefined}>
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

/**
 * Active filters with remove buttons and the match count (VSEL-FR-05). The
 * group stays mounted so its live count is announced, and removing a chip
 * moves focus to the next chip, the previous one, the page search, or the
 * group itself.
 */
export function FilterChips({
  chips,
  onRemove,
  onClear,
  matchLabel,
}: {
  chips: FilterChip[]
  onRemove: (id: string) => void
  onClear: () => void
  /** e.g. "12 matching sessions". */
  matchLabel: string
}) {
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
    <div ref={group} tabIndex={-1} className="flex flex-wrap items-center gap-2 text-sm outline-none" role="group" aria-label={m.filters_active()}>
      {chips.map((chip, index) => (
        <span key={chip.id} className="inline-flex h-6 items-center gap-1 rounded-md bg-secondary pr-0.5 pl-2 text-xs text-secondary-foreground">
          {chip.label}
          <Button
            data-chip-remove
            size="icon-xs"
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
        {chips.length > 0 ? matchLabel : <span className="sr-only">{m.filters_none()}</span>}
      </span>
      {chips.length > 0 ? (
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
