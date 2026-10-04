/**
 * Bulk Confirm Target / Confirm equipment for selected sessions (J19 S10).
 * Commits session by session with the revision each had when the dialog
 * opened; the first failure stops the run and names what was and was not
 * saved, with Retry for the remaining sessions. A stale refusal offers
 * Review current revision, which reloads the remaining sessions' revisions
 * so the next Retry uses them (D08).
 */
import { Link } from "@tanstack/react-router"
import { useEffect, useId, useState } from "react"
import { ActionError, Notice, SaveState } from "@/components/app/feedback"
import { Button } from "@/components/ui/button"
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { SessionId } from "@/domain/types"
import { plural } from "@/lib/format"
import { store, useStore } from "@/store/core"
import { type BulkOutcome, confirmEquipment, confirmMany, confirmTarget } from "./actions"
import { sessionLabel } from "./model"

export type BulkMode = "target" | "equipment"

const SOURCE_WORD = { manual: "Manual", detected: "Detected", "built-in": "Built-in" } as const

export function BulkConfirmDialog({
  open,
  onOpenChange,
  mode,
  sessionIds,
  onDone,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: BulkMode
  sessionIds: SessionId[]
  /** Called with a sentence describing what was saved. */
  onDone: (message: string) => void
}) {
  const catalog = useStore((s) => s.catalog)
  const [value, setValue] = useState<string | null>(null)
  const [revisions, setRevisions] = useState<Record<SessionId, number>>({})
  const [pending, setPending] = useState<SessionId[]>(sessionIds)
  const [showFieldError, setShowFieldError] = useState(false)
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null)
  /** Label of the session whose stale refusal was reviewed; the next Retry uses its current revision. */
  const [reviewed, setReviewed] = useState<string | null>(null)
  const labelId = useId()
  const errorId = useId()

  // Each opening starts from the sessions and revisions as they are now.
  useEffect(() => {
    if (!open) return
    const sessions = store.getState().catalog.sessions
    setRevisions(Object.fromEntries(sessionIds.map((id) => [id, sessions[id]?.revision ?? 0])))
    setPending(sessionIds)
    setOutcome(null)
    setReviewed(null)
    setShowFieldError(false)
    const values = new Set(sessionIds.map((id) => (mode === "target" ? sessions[id]?.target.value : sessions[id]?.equipment.value) ?? null))
    const [only] = [...values]
    setValue(values.size === 1 && only ? only : null)
  }, [open])

  const items =
    mode === "target"
      ? Object.values(catalog.targets)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((t) => ({ value: t.id, label: t.name }))
      : Object.values(catalog.opticalTrains)
          .sort((a, b) => a.name.localeCompare(b.name))
          .map((t) => ({ value: t.id, label: `${t.name} · ${SOURCE_WORD[t.source]}` }))
  const noun = mode === "target" ? "Target" : "optical train"
  const verb = mode === "target" ? "Confirm Target" : "Confirm equipment"

  function confirm() {
    if (!value) {
      setShowFieldError(true)
      return
    }
    setReviewed(null)
    const run = confirmMany(pending, revisions, (id, revision) => (mode === "target" ? confirmTarget(id, value, revision) : confirmEquipment(id, value, revision)))
    const done = (outcome?.confirmed ?? []).concat(run.confirmed)
    if (run.failure) {
      setOutcome({ ...run, confirmed: done })
      setPending(run.remaining)
      return
    }
    const chosen = items.find((i) => i.value === value)?.label ?? ""
    onDone(`${mode === "target" ? "Target" : "Equipment"} confirmed for ${plural(done.length, "session")}: ${chosen}.`)
    onOpenChange(false)
  }

  function review() {
    const sessions = store.getState().catalog.sessions
    setRevisions((current) => ({ ...current, ...Object.fromEntries(pending.map((id) => [id, sessions[id]?.revision ?? 0])) }))
    setReviewed(failedLabel)
    setOutcome((current) => (current ? { ...current, failure: null } : current))
  }

  const failedLabel = outcome?.failure ? sessionLabel(catalog, catalog.sessions[outcome.failure.sessionId]!) : ""
  const failedMessage = outcome?.failure ? `Confirmed ${outcome.confirmed.length} of ${sessionIds.length}. ${failedLabel} not saved: ${outcome.failure.result.message}` : ""
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {verb} for {plural(sessionIds.length, "session")}
          </DialogTitle>
          <DialogDescription>
            The confirmation is stored in the PlateVault catalog next to each session's observed evidence. Source headers are not changed.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4 text-sm">
          {items.length === 0 ? (
            mode === "equipment" ? (
              <Notice
                tone="info"
                title="No optical train record yet"
                actions={
                  <Button size="sm" variant="outline" render={<Link to="/settings/equipment" search={{ return: "/sessions" }} />}>
                    Add an optical train
                  </Button>
                }
              >
                Equipment is confirmed against a camera and optical-train record. Add one in Settings, then return here.
              </Notice>
            ) : (
              <Notice
                tone="info"
                title="No Target yet"
                actions={
                  <Button size="sm" variant="outline" render={<Link to="/targets" />}>
                    Add a Target
                  </Button>
                }
              >
                Add a local Target record on Targets, then confirm it here.
              </Notice>
            )
          ) : (
            <div className="space-y-1.5">
              <Label id={labelId}>{mode === "target" ? "Target" : "Optical train"}</Label>
              <Select
                items={items}
                value={value}
                onValueChange={(next) => {
                  setValue(next as string)
                  setShowFieldError(false)
                }}
              >
                <SelectTrigger aria-labelledby={labelId} aria-invalid={showFieldError || undefined} aria-describedby={showFieldError ? errorId : undefined} className="w-full">
                  <SelectValue placeholder={`Choose a ${noun}`} />
                </SelectTrigger>
                <SelectContent>
                  {items.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {showFieldError ? (
                <p id={errorId} role="alert" className="text-sm text-destructive">
                  Choose a {noun} to confirm.
                </p>
              ) : null}
            </div>
          )}
          <div>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">Sessions</h3>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto">
              {sessionIds.map((id) => {
                const session = catalog.sessions[id]
                if (!session) return null
                const done = outcome?.confirmed.includes(id)
                return (
                  <li key={id} className="flex justify-between gap-3">
                    <span>{sessionLabel(catalog, session)}</span>
                    <span className="text-muted-foreground">{done ? "Saved" : pending.includes(id) && outcome ? "Not saved yet" : ""}</span>
                  </li>
                )
              })}
            </ul>
          </div>
          <div>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">Unchanged</h3>
            <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
              <li>Source files and their headers{mode === "target" ? ", including OBJECT labels" : ""}</li>
              <li>Session boundaries and frame counts</li>
              <li>Quality decisions and View membership</li>
            </ul>
          </div>
          {outcome?.failure?.result.reason === "stale" ? (
            <SaveState state="stale" message={failedMessage} onReview={review} />
          ) : outcome?.failure ? (
            <ActionError message={failedMessage} />
          ) : reviewed ? (
            <p role="status" className="text-sm text-pretty">
              Reloaded the current revision of {reviewed}. Choose Retry to confirm the {plural(pending.length, "remaining session")}.
            </p>
          ) : null}
        </div>
        <DialogFooter>
          <DialogClose render={<Button variant="outline" />}>Cancel</DialogClose>
          <Button onClick={confirm} disabled={items.length === 0}>
            {outcome ? `Retry ${plural(pending.length, "remaining session")}` : `${verb} for ${plural(sessionIds.length, "session")}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
