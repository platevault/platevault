/**
 * Confirmation for destructive, irreversible or scope-changing actions
 * (foundation-owned). Always an AlertDialog. The dialog names the exact scope:
 * what changes and what stays unchanged (FR-006, VSEL-FR-11, STO-FR-04).
 *
 * Harness v4: Direction B's preview-then-confirm. The scope reads as a
 * preview receipt, changes beside what stays; the confirm button repeats the
 * verb and object.
 */
import { ArrowRight, Lock } from "lucide-react"
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
import { useMessages } from "@/app/preferences"
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
  const m = useMessages()
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
        <div className="space-y-2 text-sm">
          <div className="divide-y divide-separator overflow-hidden rounded-[0.3125rem] border border-separator bg-background">
            <section aria-label={m.confirm_changes()} className="px-3 py-2">
              <h3 className="mb-1 text-xs font-medium text-muted-foreground">{m.confirm_changes()}</h3>
              <ul className="space-y-0.5">
                {shown.changes.map((change) => (
                  <li key={change} className="flex gap-2">
                    <ArrowRight aria-hidden="true" className={shown.tone === "destructive" ? "mt-0.5 size-3.5 shrink-0 text-destructive" : "mt-0.5 size-3.5 shrink-0 text-link"} />
                    <span>{change}</span>
                  </li>
                ))}
              </ul>
            </section>
            {shown.unchanged && shown.unchanged.length > 0 ? (
              <section aria-label={m.confirm_unchanged()} className="bg-muted/40 px-3 py-2">
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">{m.confirm_unchanged()}</h3>
                <ul className="space-y-0.5 text-muted-foreground">
                  {shown.unchanged.map((item) => (
                    <li key={item} className="flex gap-2">
                      <Lock aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </div>
          {error ? <ActionError message={error} /> : null}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{m.verb_cancel()}</AlertDialogCancel>
          <AlertDialogAction variant={shown.tone === "destructive" ? "destructive" : "default"} onClick={confirm}>
            {error ? m.verb_retry() : shown.confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
