/**
 * Confirmation for destructive, irreversible or scope-changing actions
 * (foundation-owned). Always an AlertDialog. The dialog names the exact scope:
 * what changes and what stays unchanged (FR-006, VSEL-FR-11, STO-FR-04).
 */
import { type ReactElement, type ReactNode, useRef, useState } from "react"
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
  /**
   * Where focus goes after a successful confirm, typically the heading of the
   * outcome the action produced. Use it when confirming unmounts the element
   * that opened the dialog; Cancel and Escape still return focus to the opener.
   */
  focusAfterConfirm?: () => HTMLElement | null | undefined
}

type FrozenContent = Pick<ConfirmDialogProps, "title" | "description" | "changes" | "unchanged" | "confirmLabel" | "tone">

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
  focusAfterConfirm,
}: ConfirmDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmed = useRef(false)
  const isOpen = open ?? internalOpen
  // Confirming usually changes the state the copy is derived from. Keep showing what was
  // confirmed while the dialog animates closed, never a re-derived empty scope.
  const live: FrozenContent = { title, description, changes, unchanged, confirmLabel, tone }
  const frozen = useRef(live)
  if (isOpen) frozen.current = live
  const shown = isOpen ? live : frozen.current

  function setOpen(next: boolean) {
    if (!next) setError(null)
    if (next) confirmed.current = false
    if (open === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  function confirm() {
    const result = onConfirm()
    if (result && !result.ok) {
      setError(result.message)
      return
    }
    confirmed.current = true
    setOpen(false)
  }

  function finalFocus(): HTMLElement | boolean {
    if (!confirmed.current || !focusAfterConfirm) return true
    confirmed.current = false
    const target = focusAfterConfirm()
    if (!target) return true
    // Headings and regions are not focusable until they carry a tabindex.
    if (!target.hasAttribute("tabindex") && target.tabIndex < 0) target.tabIndex = -1
    return target
  }

  return (
    <AlertDialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <AlertDialogTrigger render={trigger} /> : null}
      <AlertDialogContent className="data-[size=default]:sm:max-w-lg" finalFocus={finalFocus}>
        <AlertDialogHeader>
          <AlertDialogTitle className="text-balance">{shown.title}</AlertDialogTitle>
          <AlertDialogDescription>{shown.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-3 text-sm">
          <div>
            <h3 className="mb-1 text-xs font-medium text-muted-foreground">This will</h3>
            <ul className="list-disc space-y-0.5 pl-5">
              {shown.changes.map((change) => (
                <li key={change}>{change}</li>
              ))}
            </ul>
          </div>
          {shown.unchanged && shown.unchanged.length > 0 ? (
            <div>
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">Unchanged</h3>
              <ul className="list-disc space-y-0.5 pl-5 text-muted-foreground">
                {shown.unchanged.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {error ? <ActionError message={error} /> : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction variant={shown.tone === "destructive" ? "destructive" : "default"} onClick={confirm}>
            {error ? "Retry" : shown.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
