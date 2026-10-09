/**
 * Small dialogs slice E reuses: name a thing (save or rename a preset) with
 * inline validation and the write's error kept beside the field.
 */
import { type FormEvent, useEffect, useId, useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionError } from "@/components/app/feedback"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

export interface NameDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: string
  label: string
  initial: string
  confirmLabel: string
  /** Returns an error message to keep the dialog open, or null when done. */
  onSubmit: (name: string) => string | null
  /** Names already taken (compared case-insensitively). */
  taken?: string[]
}

export function NameDialog({ open, onOpenChange, title, description, label, initial, confirmLabel, onSubmit, taken = [] }: NameDialogProps) {
  const m = useMessages()
  const [name, setName] = useState(initial)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  useEffect(() => {
    if (open) {
      setName(initial)
      setError(null)
    }
  }, [open, initial])

  function submit(event: FormEvent) {
    event.preventDefault()
    const trimmed = name.trim()
    if (!trimmed) return setError(m.targets_name_empty({ label }))
    if (taken.some((t) => t.toLowerCase() === trimmed.toLowerCase())) return setError(m.targets_name_taken({ label, name: trimmed }))
    const failure = onSubmit(trimmed)
    if (failure) setError(failure)
    else onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={submit} noValidate className="space-y-3">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            <Label htmlFor={id}>{label}</Label>
            <Input id={id} value={name} autoFocus aria-invalid={error ? true : undefined} aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => setName(event.target.value)} />
            {error ? <ActionError id={`${id}-error`} message={error} /> : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              {m.verb_cancel()}
            </Button>
            <Button type="submit">{confirmLabel}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
