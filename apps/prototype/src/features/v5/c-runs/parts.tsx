/**
 * Slice C UI parts shared by the run and run group pages: the step bar (the
 * pane's gate bar, glyph plus word), the inline outcome of an action
 * (refusals name each blocker), radio option cards, the Prototype menu for
 * simulated-disk controls, and small read-outs. The run status is the shared
 * `StatusBadge kind="run"`.
 */
import { Link } from "@tanstack/react-router"
import { FlaskConical } from "lucide-react"
import { type ReactNode, useCallback, useState } from "react"
import { StepGlyph } from "@/app/run-ui"
import { Notice } from "@/components/app/feedback"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { RadioGroupItem } from "@/components/ui/radio-group"
import type { RunStepState } from "@/domain/derive"
import type { RunStep } from "@/domain/types"
import { cn } from "@/lib/utils"
import type { CommitResult } from "@/store/core"

// ---------------------------------------------------------------------------
// Step bar
// ---------------------------------------------------------------------------

export function StepBar({ steps, here, nextId, linkFor, label }: { steps: RunStepState[]; here: RunStep; nextId: RunStep | null; linkFor: (step: RunStep) => { to: string; params: Record<string, string> }; label: string }) {
  return (
    <nav aria-label={label} data-chrome className="@container border-b border-separator bg-background px-3">
      <ol className="flex min-w-0 items-stretch">
        {steps.map((step) => {
          const link = linkFor(step.id)
          const current = step.id === here
          return (
            <li key={step.id} className="min-w-0 flex-1">
              <Link
                to={link.to as never}
                params={link.params as never}
                aria-current={current ? "step" : undefined}
                className={cn(
                  "group flex h-9 min-w-0 items-center gap-1.5 border-b-2 px-2 text-[0.75rem] outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  current ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                <StepGlyph state={step.state} />
                <span className={cn("shrink-0 font-medium", nextId === step.id && !current && "text-link")}>{step.label}</span>
                <span className="sr-only">: </span>
                <span className="hidden min-w-0 truncate text-muted-foreground @min-[48rem]:inline" title={step.status}>
                  {step.status}
                </span>
                <span className="sr-only @min-[48rem]:hidden">{step.status}</span>
              </Link>
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
  title: string
  reasons: string[]
  tone: "refusal" | "warning" | "info"
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
    if (r.reason === "refused") {
      const suffix = `: ${r.reasons.join("; ")}.`
      const title = r.message.endsWith(suffix) ? r.message.slice(0, -suffix.length) : "Refused"
      setOutcome({ value: { title, reasons: r.reasons, tone: "refusal" }, key: resetKey })
    } else setOutcome({ value: { title: r.reason === "stale" ? "Changed elsewhere" : "Not saved", reasons: [r.message], tone: "warning" }, key: resetKey })
    return false
  }, [resetKey])
  return { outcome: outcome && outcome.key === resetKey ? outcome.value : null, act, clear: () => setOutcome(null) }
}

export function OutcomeNotice({ outcome, onDismiss, className }: { outcome: Outcome | null; onDismiss: () => void; className?: string }) {
  if (!outcome) return null
  return (
    <Notice
      tone={outcome.tone}
      title={outcome.title}
      className={className}
      actions={
        <Button size="sm" variant="outline" onClick={onDismiss}>
          Dismiss
        </Button>
      }
    >
      {outcome.reasons.length === 1 ? (
        <p>{outcome.reasons[0]}</p>
      ) : (
        <ul className="list-disc space-y-0.5 pl-4">
          {outcome.reasons.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}
    </Notice>
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
