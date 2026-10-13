/**
 * Dialog footer and form dialog (L2; design/R9-COMPOSITION-PLAN.md P8).
 *
 * - `DialogFooter`: the one footer every dialog renders. It owns the button
 *   order on every OS (C1): Cancel first, then an optional Skip, then the
 *   dialog's one action at the trailing end. The action is the primary
 *   button; a destructive action (Move to Trash, Delete) is red instead
 *   (C2). An unavailable action stays focusable and previews its blockers.
 *   Enter in a field never triggers a destructive action (GNOME HIG): only a
 *   non-destructive action submits its form.
 * - `FormDialog`: a centred dialog for a task with fields (Edit…, Add…,
 *   Attach results…), and the host of short two-step flows (P11): the
 *   StepStrip goes in `strip`, the flow's Skip and Proceed in `skip` and
 *   `confirm`. Initial focus goes to the first field; Escape and Cancel
 *   close it and return focus to the trigger.
 * - `useDialogCommit`: the commit rule both FormDialog and ConfirmDialog
 *   share. A returned failure keeps the dialog open with the error and turns
 *   the action into Retry; a promise shows the action busy and keeps the
 *   dialog open until it settles.
 */
import { type ReactElement, type ReactNode, type SubmitEvent, useId, useRef, useState } from "react"
import { useMessages } from "@/app/preferences"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogClose,
  DialogContent,
  type DialogSize,
  DialogTitle,
  DialogTrigger,
  DialogFooter as FooterLayout,
} from "@/components/ui/dialog"
import { Spinner } from "@/components/ui/spinner"
import type { CommitResult } from "@/store/core"
import type { Action } from "./contracts"
import { ActionError } from "./feedback"
import { BlockersPreview } from "./previews"

/** What a dialog's action runs: a failure keeps the dialog open; a promise shows it busy until it settles. */
export type DialogCommit = () => CommitResult | void | Promise<CommitResult | void>

/** Marks the control a confirm dialog focuses first: Cancel when the action is destructive, else the action. */
export const DIALOG_DEFAULT_ATTR = "data-dialog-default"

export interface DialogFooterProps {
  /** The dialog's one action, last. Its `kind` picks primary or destructive (red); `unavailable` keeps it focusable-disabled with its blockers. */
  confirm: Action
  /** Runs the action on click; default `confirm.run`. Ignored when the action submits `form`. */
  onConfirm?: () => void
  /** The id of the form a non-destructive action submits, so Enter in a field submits it too. */
  form?: string
  /** Cancel's label; default "Cancel". */
  cancel?: string
  /** An optional step's Skip: a ghost button between Cancel and the action. */
  skip?: Action
  onSkip?: () => void
  /** The action is running: it shows a spinner, and nothing in the footer can be pressed. */
  busy?: boolean
  /** The last run failed: the action reads Retry. */
  failed?: boolean
}

export function DialogFooter({ confirm, onConfirm, form, cancel, skip, onSkip, busy = false, failed = false }: DialogFooterProps) {
  const m = useMessages()
  const destructive = confirm.kind === "destructive"
  const submits = form !== undefined && !destructive
  const Icon = confirm.icon
  // The marker sits on Cancel for a destructive action, so Enter on open never runs it.
  const defaultMark = { [DIALOG_DEFAULT_ATTR]: "" }
  const action = (
    <Button
      variant={destructive ? "destructive" : "default"}
      type={submits ? "submit" : "button"}
      form={submits ? form : undefined}
      // Focusable while unavailable, so its blockers preview can be reached (P7).
      disabled={confirm.unavailable !== undefined}
      focusableWhenDisabled
      aria-busy={busy || undefined}
      data-action={confirm.id}
      {...(destructive ? {} : defaultMark)}
      onClick={submits || busy ? undefined : (onConfirm ?? (() => void confirm.run()))}
    >
      {busy ? <Spinner aria-hidden="true" data-icon="inline-start" /> : Icon ? <Icon aria-hidden="true" data-icon="inline-start" /> : null}
      {failed ? m.verb_retry() : confirm.label}
    </Button>
  )
  return (
    <FooterLayout>
      <DialogClose disabled={busy} {...(destructive ? defaultMark : {})} render={<Button variant="outline" />}>
        {cancel ?? m.verb_cancel()}
      </DialogClose>
      {skip ? (
        <Button variant="ghost" disabled={busy} data-action={skip.id} onClick={onSkip ?? (() => void skip.run())}>
          {skip.label}
        </Button>
      ) : null}
      {confirm.unavailable ? <BlockersPreview {...confirm.unavailable}>{action}</BlockersPreview> : action}
    </FooterLayout>
  )
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return value instanceof Promise
}

export interface DialogCommitOptions {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /**
   * Where focus goes after a successful commit, typically the heading of the
   * outcome. Use it when committing unmounts the element that opened the
   * dialog; Cancel and Escape still return focus to the opener.
   */
  focusAfterConfirm?: () => HTMLElement | null | undefined
}

export interface DialogCommitState {
  isOpen: boolean
  /** Opens or closes the dialog; closing is ignored while a commit runs. */
  setOpen: (open: boolean) => void
  /** Runs `run`; on success the dialog closes unless `close` is false (a flow's next step). */
  commit: (run: DialogCommit, close?: boolean) => void
  busy: boolean
  /** The last failure's message, shown in the dialog until the next run or close. */
  error: string | null
  /** For the popup's `finalFocus`. */
  finalFocus: () => HTMLElement | boolean
}

export function useDialogCommit({ open, onOpenChange, focusAfterConfirm }: DialogCommitOptions): DialogCommitState {
  const [internalOpen, setInternalOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const confirmed = useRef(false)
  const isOpen = open ?? internalOpen

  function setOpen(next: boolean) {
    // A write in flight keeps the dialog, so its outcome is never lost.
    if (!next && running.current) return
    if (!next) setError(null)
    if (next) confirmed.current = false
    if (open === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  function settle(result: CommitResult | void, close: boolean) {
    if (result && !result.ok) {
      setError(result.message)
      return
    }
    setError(null)
    if (!close) return
    confirmed.current = true
    setOpen(false)
  }

  function commit(run: DialogCommit, close = true) {
    if (running.current) return
    setError(null)
    const outcome = run()
    if (!isPromise(outcome)) {
      settle(outcome, close)
      return
    }
    running.current = true
    setBusy(true)
    outcome
      .then(
        (result) => result,
        (failure: unknown): CommitResult => ({ ok: false, reason: "write-failed", message: failure instanceof Error ? failure.message : String(failure) }),
      )
      .then((result) => {
        running.current = false
        setBusy(false)
        settle(result, close)
      })
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

  return { isOpen, setOpen, commit, busy, error, finalFocus }
}

type ReactElementLike = ReactElement<Record<string, unknown>>

export interface FormDialogProps extends DialogCommitOptions {
  /** Element that opens the dialog; omit when controlling `open`. */
  trigger?: ReactElementLike
  /** Verb plus object: "Edit run", "Add location". */
  title: string
  /** `sm` short forms, `md` most forms (default), `lg` forms with a table or a preview. */
  size?: DialogSize
  /** The dialog's action. Its `run` commits the fields: a failure keeps the dialog open with the error. */
  confirm: Action
  /** Cancel's label; default "Cancel". */
  cancel?: string
  /** A two-step flow's StepStrip (step-flow.tsx), under the title. */
  strip?: ReactNode
  /** The current step's Skip, on optional steps only. */
  skip?: Action
  /** Whether a successful `confirm` closes the dialog; false on a flow's earlier step, whose Proceed opens the next one. Default true. */
  closeOnConfirm?: boolean
  /** The fields (components/app/fields.tsx). */
  children: ReactNode
}

export function FormDialog({
  trigger,
  title,
  size = "md",
  confirm,
  cancel,
  strip,
  skip,
  closeOnConfirm = true,
  children,
  ...options
}: FormDialogProps) {
  const formId = useId()
  const { isOpen, setOpen, commit, busy, error, finalFocus } = useDialogCommit(options)

  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || confirm.unavailable) return
    commit(confirm.run, closeOnConfirm)
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger render={trigger} /> : null}
      <DialogContent size={size} showCloseButton={false} finalFocus={finalFocus}>
        <DialogTitle className="text-balance">{title}</DialogTitle>
        {strip}
        <form id={formId} noValidate onSubmit={submit} className="flex min-w-0 flex-col gap-3">
          {/* Only there to disable every field while a commit runs; it is no named group. */}
          <fieldset role="none" disabled={busy} className="flex min-w-0 flex-col gap-3">
            {children}
          </fieldset>
          {error ? <ActionError message={error} /> : null}
        </form>
        <DialogFooter
          confirm={confirm}
          form={formId}
          onConfirm={() => commit(confirm.run, closeOnConfirm)}
          cancel={cancel}
          skip={skip}
          onSkip={skip ? () => commit(skip.run, closeOnConfirm) : undefined}
          busy={busy}
          failed={error !== null}
        />
      </DialogContent>
    </Dialog>
  )
}
