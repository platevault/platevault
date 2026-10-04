/**
 * Confirmation for destructive, irreversible or scope-changing actions
 * (foundation-owned). Always an AlertDialog. The dialog names the exact scope:
 * what changes and what stays unchanged (FR-006, VSEL-FR-11, STO-FR-04).
 */
import { type ReactElement, type ReactNode, useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import type { CommitResult } from "@/store/core"
import { ActionError } from "./feedback"

export interface ConfirmDialogProps {
  /** Element that opens the dialog; omit when controlling `open`. */
  trigger?: ReactElementLike
  open?: boolean
  onOpenChange?: (open: boolean) => void
  title: string
  description: ReactNode
  /** What this action changes, item by item. */
  changes: string[]
  /** What stays unchanged; state custody guarantees explicitly. */
  unchanged?: string[]
  /** Repeats the verb and object, e.g. "Send 14 files to Trash". */
  confirmLabel: string
  tone?: "default" | "destructive"
  /** Return a CommitResult to keep the dialog open with the error on failure. */
  onConfirm: () => CommitResult | void
}

type ReactElementLike = ReactElement<Record<string, unknown>>

export function ConfirmDialog({
  trigger,
  open,
  onOpenChange,
  title,
  description,
  changes,
  unchanged,
  confirmLabel,
  tone = "default",
  onConfirm,
}: ConfirmDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const isOpen = open ?? internalOpen

  function setOpen(next: boolean) {
    if (!next) setError(null)
    if (open === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  function confirm() {
    const result = onConfirm()
    if (result && !result.ok) {
      setError(result.message)
      return
    }
    setOpen(false)
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <AlertDialogTrigger render={trigger} /> : null}
      <AlertDialogContent className="data-[size=default]:sm:max-w-lg">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-balance">{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">This will</h3>
            <ul className="list-disc space-y-0.5 pl-5">
              {changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </div>
          {unchanged && unchanged.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">Unchanged</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                {unchanged.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {error ? <ActionError message={error} /> : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={tone === "destructive" ? "destructive" : "default"} onClick={confirm}>
            {error ? "Retry" : confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
