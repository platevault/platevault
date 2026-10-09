/**
 * Slice C UI parts shared by the run and run group pages: the step bar (the
 * pane's gate bar, glyph plus word), the inline outcome of an action (a
 * refusal is the foundation's terse `Refusal` with its blockers as chips; a
 * success is one status line), radio option cards, the Prototype menu for
 * simulated-disk controls, and small read-outs. The run status is the shared
 * `StatusBadge kind="run"`.
 */
import { CircleCheck, FlaskConical, MoreHorizontal, X } from "lucide-react"
import { type ReactNode, useCallback, useState } from "react"
import { CurrentLink, StepGlyph } from "@/app/run-ui"
import { Refusal } from "@/components/app/refusal"
import { Button } from "@/components/ui/button"
import type { MenuEntry } from "@/components/app/row-menu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { RadioGroupItem } from "@/components/ui/radio-group"
import { GATE_LABEL, type RunStepState, type StepLink } from "@/domain/derive"
import type { Catalog, RunStep } from "@/domain/types"
import { profileOptions } from "@/features/v5/b-projects/start-run"
import { plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { CommitResult } from "@/store/core"

// ---------------------------------------------------------------------------
// Step bar
// ---------------------------------------------------------------------------

/**
 * The pane's gate bar: each step's glyph and name, never truncated. The
 * outline beside it carries the short statuses, so here the gate word and
 * status are in the tooltip and the accessible name ("Calibrate: Blocked,
 * 1 needs review"); the step that holds Next carries a visible "Next" marker.
 */
export function StepBar({ steps, here, nextId, linkFor, label }: { steps: RunStepState[]; here: RunStep; nextId: RunStep | null; linkFor: (step: RunStep) => { to: string; params: Record<string, string> }; label: string }) {
  return (
    <nav aria-label={label} data-chrome className="border-b border-separator bg-background px-3">
      <ol className="flex min-w-0 items-stretch">
        {steps.map((step) => {
          const link = linkFor(step.id)
          const current = step.id === here
          const holdsNext = nextId === step.id && !current
          const status = step.status && step.status !== "–" ? step.status : null
          return (
            <li key={step.id} className="min-w-0 flex-1">
              <CurrentLink
                to={link.to as never}
                params={link.params as never}
                current={current ? "step" : false}
                title={`${step.n} ${step.label}: ${GATE_LABEL[step.state]}${status ? ` · ${status}` : ""}${holdsNext ? " · holds Next" : ""}`}
                className={cn(
                  "group flex h-8 min-w-0 items-center gap-1.5 border-b-2 px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  current ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <StepGlyph state={step.state} />
                <span className="shrink-0 font-medium">{step.label}</span>
                <span className="sr-only">
                  : {GATE_LABEL[step.state]}
                  {status ? `, ${status}` : ""}
                </span>
                {holdsNext ? (
                  <span className="shrink-0 rounded-sm border border-link/50 px-1 text-xs leading-4 font-semibold text-link">
                    <span className="sr-only">, </span>Next
                  </span>
                ) : null}
              </CurrentLink>
            </li>
          )
        })}
      </ol>
    </nav>
  )
}

// ---------------------------------------------------------------------------
// Action outcome
// ---------------------------------------------------------------------------

export interface Outcome {
  /** "Prepare M 31 blocked", or a success: "Prepared". */
  title: string
  /** Blockers of a refusal; the reason of a failure. A success carries none. */
  reasons?: string[]
  tone: "refusal" | "warning" | "info"
}

/** A store refusal title ("Prepare M 31 refused") in the terse form: "Prepare M 31 blocked". */
function refusalTitle(r: Extract<CommitResult, { reason: "refused" }>): string {
  const suffix = `: ${r.reasons.join("; ")}.`
  const title = r.message.endsWith(suffix) ? r.message.slice(0, -suffix.length) : "Blocked"
  return title.endsWith(" refused") ? `${title.slice(0, -" refused".length)} blocked` : title
}

/**
 * Runs an action and keeps its refusal (or failure) on screen beside the
 * control. A change of `resetKey` (the route's step) clears it, so an old
 * refusal never reads as the state of another step.
 */
export function useOutcome(resetKey?: string) {
  const [outcome, setOutcome] = useState<{ value: Outcome; key: string | undefined } | null>(null)
  const act = useCallback((result: CommitResult | { result: CommitResult }, success?: Outcome | null): boolean => {
    const r = "result" in result ? result.result : result
    if (r.ok) {
      setOutcome(success ? { value: success, key: resetKey } : null)
      return true
    }
    if (r.reason === "refused") setOutcome({ value: { title: refusalTitle(r), reasons: r.reasons, tone: "refusal" }, key: resetKey })
    else setOutcome({ value: { title: r.reason === "stale" ? "Changed elsewhere" : "Not saved", reasons: [r.message], tone: "warning" }, key: resetKey })
    return false
  }, [resetKey])
  return { outcome: outcome && outcome.key === resetKey ? outcome.value : null, act, clear: () => setOutcome(null) }
}

/** The outcome beside its control: `<Action> blocked · N blockers ▸` with chips (linked through `linkFor`), or one status line. */
export function OutcomeNotice({ outcome, onDismiss, className, linkFor }: { outcome: Outcome | null; onDismiss: () => void; className?: string; linkFor?: (blocker: string) => StepLink | undefined }) {
  if (!outcome) return null
  const reasons = outcome.reasons ?? []
  const dismiss = (
    <Button size="icon-xs" variant="ghost" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
      <X aria-hidden="true" />
    </Button>
  )
  if (outcome.tone === "info") {
    return (
      <div role="status" className={cn("flex min-w-0 items-center gap-1.5 text-sm", className)} data-outcome="info">
        <CircleCheck aria-hidden="true" className="size-3.5 shrink-0 text-success" />
        <span className="min-w-0 truncate">{outcome.title}</span>
        {dismiss}
      </div>
    )
  }
  return (
    <div className={cn("flex min-w-0 items-start gap-1.5", className)} data-outcome={outcome.tone}>
      {outcome.tone === "refusal" ? (
        <Refusal className="min-w-0 flex-1" action={outcome.title} reason={plural(reasons.length, "blocker")} blockers={reasons.map((label) => ({ label, link: linkFor?.(label) }))} />
      ) : (
        <Refusal className="min-w-0 flex-1" action={outcome.title} reason={reasons[0] ?? "try again"} blockers={[]} />
      )}
      {dismiss}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Option card (a labelled radio)
// ---------------------------------------------------------------------------

export function OptionCard({ value, current, disabled, children }: { value: string; current: string; disabled?: boolean; children: ReactNode }) {
  return (
    <label
      className={cn(
        "flex items-start gap-2.5 rounded-md border px-3 py-2 text-sm",
        disabled ? "opacity-70" : "hover:bg-muted/60",
        value === current ? "border-primary bg-primary/[0.08]" : "border-border",
      )}
    >
      <RadioGroupItem value={value} disabled={disabled} className="mt-0.5" />
      <span className="min-w-0 flex-1 space-y-0.5">{children}</span>
    </label>
  )
}

// ---------------------------------------------------------------------------
// Prototype menu
// ---------------------------------------------------------------------------

export interface PrototypeAction {
  label: string
  detail: string
  run: () => void
}

/** Simulated-disk controls for the review; labelled Prototype, never product actions. */
export function PrototypeMenu({ actions, label = "Prototype" }: { actions: PrototypeAction[]; label?: string }) {
  if (actions.length === 0) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />}>
        <FlaskConical aria-hidden="true" data-icon="inline-start" />
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuGroup>
          <DropdownMenuLabel>Simulate on the prototype disk</DropdownMenuLabel>
          {actions.map((a) => (
            <DropdownMenuItem key={a.label} onClick={a.run}>
              <span className="flex flex-col">
                <span>{a.label}</span>
                <span className="text-xs text-muted-foreground">{a.detail}</span>
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

// ---------------------------------------------------------------------------
// Row actions
// ---------------------------------------------------------------------------

/**
 * The ⋯ button of a row: the same `MenuEntry` list its right-click menu
 * shows, so every context-menu item is reachable from the row itself.
 * Headings label the right-click menu only.
 */
export function RowActions({ entries, label }: { entries: MenuEntry[]; label: string }) {
  const items = entries.filter((e) => !("heading" in e))
  if (!items.some((e) => "label" in e)) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size="icon-sm" variant="ghost" className="-my-1" aria-label={label} />}>
        <MoreHorizontal aria-hidden="true" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {items.map((e, i) =>
          "separator" in e ? (
            // biome-ignore lint/suspicious/noArrayIndexKey: separators have no identity
            <DropdownMenuSeparator key={`sep-${i}`} />
          ) : "label" in e ? (
            <DropdownMenuItem key={e.label} disabled={e.disabled} variant={e.destructive ? "destructive" : "default"} onClick={e.onSelect}>
              {e.icon ? <e.icon aria-hidden="true" /> : null}
              {e.label}
            </DropdownMenuItem>
          ) : null,
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/** A profile's name as the pickers show it (one convention with Start run): the generic launcher reads "Other app". */
export function profileLabel(catalog: Catalog, profileId: string | null): string {
  return profileOptions(catalog).find((o) => o.value === profileId)?.label ?? "Application"
}

// ---------------------------------------------------------------------------
// Read-outs
// ---------------------------------------------------------------------------

export function Sha({ value, label = "SHA-256" }: { value: string | null; label?: string }) {
  if (!value) return <span className="text-muted-foreground">–</span>
  return (
    <span className="font-mono text-[0.6875rem] text-muted-foreground" title={`${label} ${value}`}>
      {value.slice(0, 10)}…
    </span>
  )
}

/** A layout line: a monospace path with what it holds. */
export function LayoutLine({ path, note, depth = 0, emphasis = false }: { path: string; note: string; depth?: number; emphasis?: boolean }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5" style={{ paddingLeft: `${depth * 1.25}rem` }}>
      <span className={cn("font-mono text-xs [overflow-wrap:anywhere]", emphasis ? "text-foreground" : "text-muted-foreground")}>{path}</span>
      <span className="text-[0.75rem] text-muted-foreground">{note}</span>
    </li>
  )
}
