/**
 * Resolve one calibration requirement (CAL-FR-05, J23 S5-S6): choose another
 * input, record a scoped exception with a reason, defer, or hand off without
 * this kind. A non-compatible input always needs a reason; the criterion and
 * the reason are both kept, and the input's evidence never changes.
 */
import { Link } from "@tanstack/react-router"
import { useEffect, useId, useState } from "react"
import { ActionError } from "@/components/app/feedback"
import { StatusBadge } from "@/components/app/status"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { Textarea } from "@/components/ui/textarea"
import type { View } from "@/domain/types"
import { plural } from "@/lib/format"
import { cn } from "@/lib/utils"
import { type AssignmentDecision, decideRow } from "./actions"
import { CRITERION_LABEL, inputKey, KIND_LABEL, type RequirementRow, sameInput, sessionLabel, summaryText } from "./domain"

type Choice = { type: "input"; key: string } | { type: "defer" } | { type: "exclude" }

function initialChoice(row: RequirementRow, preferException: boolean): string {
  if (row.state === "deferred") return "defer"
  if (row.state === "excluded") return "exclude"
  const current = row.input ?? row.closest?.source.input ?? null
  if (preferException) {
    const nonCompatible = row.candidates.find((c) => !c.summary.allCompatible && (current ? sameInput(c.source.input, current) : true)) ?? row.candidates.find((c) => !c.summary.allCompatible)
    if (nonCompatible) return `input:${inputKey(nonCompatible.source.input)}`
  }
  return current ? `input:${inputKey(current)}` : row.candidates[0] ? `input:${inputKey(row.candidates[0].source.input)}` : "defer"
}

export interface ResolveDialogProps {
  view: View
  row: RequirementRow | null
  /** Open with a non-compatible candidate preselected (Record exception). */
  preferException: boolean
  onOpenChange: (open: boolean) => void
}

export function ResolveDialog({ view, row, preferException, onOpenChange }: ResolveDialogProps) {
  const [value, setValue] = useState("defer")
  const [reason, setReason] = useState("")
  const [reasonError, setReasonError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const reasonId = useId()
  const legendId = useId()
  const rowKey = row?.key ?? null
  // Reset only when another row opens: a write elsewhere recomputes the plan and must not clear a typed reason.
  // biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the row's identity, not the recomputed object
  useEffect(() => {
    if (!row) return
    setValue(initialChoice(row, preferException))
    setReason(row.assignment?.exception?.reason ?? "")
    setReasonError(null)
    setError(null)
  }, [rowKey, preferException])

  if (!row) return <Dialog open={false} onOpenChange={onOpenChange} />
  const kind = KIND_LABEL[row.kind].toLowerCase()
  const choice: Choice = value === "defer" ? { type: "defer" } : value === "exclude" ? { type: "exclude" } : { type: "input", key: value.slice("input:".length) }
  const candidate = choice.type === "input" ? row.candidates.find((c) => inputKey(c.source.input) === choice.key) : undefined
  const needsReason = Boolean(candidate && !candidate.summary.allCompatible)
  const nonCompatible = candidate?.criteria.filter((c) => c.result !== "compatible") ?? []

  function submit() {
    if (!row) return
    let decision: AssignmentDecision
    let label: string
    if (choice.type === "defer") {
      decision = { state: "deferred", input: null, criteria: [] }
      label = `Defer ${kind} for ${sessionLabel(row.member.session)}`
    } else if (choice.type === "exclude") {
      decision = { state: "excluded", input: null, criteria: [] }
      label = `Hand off without a ${kind} for ${sessionLabel(row.member.session)}`
    } else if (candidate && needsReason) {
      if (!reason.trim()) {
        setReasonError("Enter a reason for this exception. It is kept with the criteria that are not compatible.")
        document.getElementById(reasonId)?.focus()
        return
      }
      decision = { state: "exception", input: candidate.source.input, criteria: candidate.criteria, reason: reason.trim() }
      label = `Exception for ${sessionLabel(row.member.session)} ${kind}`
    } else if (candidate) {
      decision = { state: "accepted", input: candidate.source.input, criteria: candidate.criteria }
      label = `Accept ${candidate.source.name}`
    } else return
    const result = decideRow(view, row, decision, label)
    if (!result.ok) {
      setError(result.message)
      return
    }
    onOpenChange(false)
  }

  function clear() {
    if (!row) return
    const result = decideRow(view, row, null, `Clear ${kind} decision`)
    if (!result.ok) return setError(result.message)
    onOpenChange(false)
  }

  const submitLabel =
    choice.type === "defer"
      ? "Defer this decision"
      : choice.type === "exclude"
        ? `Hand off without a ${kind}`
        : needsReason
          ? "Record exception"
          : `Use ${candidate?.source.name ?? "this input"}`

  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-4rem)] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>
            Resolve {kind} for {sessionLabel(row.member.session)}
          </DialogTitle>
          <DialogDescription>
            {plural(row.member.included.length, "frame")} in this View. Choose an input, record an exception with a reason, defer, or hand off without a {kind}.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="space-y-2">
          <legend id={legendId} className="mb-1 text-sm font-medium">
            {KIND_LABEL[row.kind]} input
          </legend>
          <RadioGroup aria-labelledby={legendId} value={value} onValueChange={(next) => setValue(String(next))} className="gap-1.5">
            {row.candidates.map((c) => {
              const key = `input:${inputKey(c.source.input)}`
              const isCurrent = row.input ? sameInput(row.input, c.source.input) : false
              return (
                <label
                  key={key}
                  className={cn(
                    "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted/60",
                    value === key && "border-primary bg-primary/8",
                  )}
                >
                  <RadioGroupItem value={key} className="mt-0.5" />
                  <span className="min-w-0 flex-1 space-y-0.5">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{c.source.name}</span>
                      <span className="text-xs text-muted-foreground">{c.source.isMaster ? "Library master" : `Raw set · ${plural(c.source.frameCount ?? 0, "frame")}`}</span>
                      {isCurrent ? <span className="text-xs text-muted-foreground">Current</span> : null}
                    </span>
                    <span className="flex flex-wrap items-center gap-2 text-xs">
                      <StatusBadge kind="match" value={c.summary.allCompatible ? "compatible" : c.summary.incompatible > 0 ? "incompatible" : "unknown"} />
                      <span className="text-muted-foreground">{summaryText(c.criteria)}</span>
                    </span>
                  </span>
                </label>
              )
            })}
            <label className={cn("flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted/60", value === "defer" && "border-primary bg-primary/8")}>
              <RadioGroupItem value="defer" className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="block font-medium">Defer</span>
                <span className="block text-xs text-muted-foreground">Decide later. Prepare stays blocked until this is resolved.</span>
              </span>
            </label>
            <label className={cn("flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2 text-sm hover:bg-muted/60", value === "exclude" && "border-primary bg-primary/8")}>
              <RadioGroupItem value="exclude" className="mt-0.5" />
              <span className="space-y-0.5">
                <span className="block font-medium">Hand off without a {kind}</span>
                <span className="block text-xs text-muted-foreground">The application receives no {kind} for these lights. The frames stay in the View.</span>
              </span>
            </label>
          </RadioGroup>
        </fieldset>
        {needsReason && candidate ? (
          <div className="space-y-1.5 rounded-md border border-warning/40 p-3">
            <p className="text-sm">
              Not compatible: {nonCompatible.map((c) => `${CRITERION_LABEL[c.name]} ${c.result} (lights ${c.lightValue}, calibration ${c.calibrationValue})`).join("; ")}.
            </p>
            <p className="text-xs text-pretty text-muted-foreground">
              An exception applies to this View only. {candidate.source.name}'s evidence stays as recorded everywhere else.
            </p>
            <Label htmlFor={reasonId}>Reason</Label>
            <Textarea
              id={reasonId}
              value={reason}
              placeholder="e.g. Same rotation as 26 Sep; train not changed"
              aria-invalid={reasonError ? true : undefined}
              aria-describedby={reasonError ? `${reasonId}-error` : undefined}
              onChange={(event) => {
                setReason(event.target.value)
                if (reasonError && event.target.value.trim()) setReasonError(null)
              }}
            />
            {reasonError ? (
              <p id={`${reasonId}-error`} className="text-xs text-destructive">
                {reasonError}
              </p>
            ) : null}
          </div>
        ) : null}
        <p className="text-xs text-muted-foreground">
          To drop these lights from the View instead, use{" "}
          <Link to="/views/$viewId/sessions" params={{ viewId: view.id }} className="text-primary underline-offset-4 hover:underline">
            Sessions in this View
          </Link>
          .
        </p>
        {error ? <ActionError message={error} onRetry={submit} /> : null}
        <DialogFooter>
          {row.assignment ? (
            <Button variant="ghost" className="sm:mr-auto" onClick={clear}>
              Clear decision
            </Button>
          ) : null}
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit}>{submitLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
