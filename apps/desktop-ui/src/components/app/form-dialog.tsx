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
 *   Attach results…), and with `steps` the host of short flows on local
 *   state (P11, F9: import CSV, import masters). The StepStrip goes under
 *   the title and the footer acts on the step on screen, as StepFooter does
 *   on a page. Initial focus goes to the first field; Escape and Cancel
 *   close it and return focus to the trigger. An action with `confirm`
 *   asks first, as everywhere else: its ConfirmDialog opens over the form,
 *   and confirming it runs the action (a review's Move all to Trash).
 * - `useDialogCommit`: the commit rule both FormDialog and ConfirmDialog
 *   share. A returned failure keeps the dialog open with the error and turns
 *   the action into Retry; a promise shows the action busy and keeps the
 *   dialog open until it settles.
 */
import { type ReactElement, type ReactNode, type SubmitEvent, useId, useLayoutEffect, useRef, useState } from "react"
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
import { m } from "@/lib/i18n"
import type { Action, StepFlow } from "./contracts"
import { ConfirmDialog } from "./confirm-dialog"
import { ActionError } from "./feedback"
import { BlockersPreview } from "./previews"
import { failureMessage, isPromise, type RunFailure, type RunOutcome, type Settled, settled, settlePending } from "./run-result"
import { StepStrip, stepEditable, useStepActions } from "./step-flow"

/** What a dialog's action runs (run-result.ts): a failure keeps the dialog open; a promise shows it busy until it settles. */
export type DialogCommit = () => RunOutcome

/** Marks the control a confirm dialog focuses first: Cancel when the action is destructive, else the action. */
export const DIALOG_DEFAULT_ATTR = "data-dialog-default"

export interface DialogFooterProps {
  /**
   * The dialog's one action, last. Its `kind` picks primary or destructive (red); `unavailable` keeps it focusable-disabled with its blockers.
   * Absent on a flow step that offers no action (FormDialog `steps`): the footer is Cancel alone.
   */
  confirm?: Action
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
  const destructive = confirm?.kind === "destructive"
  const submits = confirm !== undefined && form !== undefined && !destructive
  const Icon = confirm?.icon
  // The marker sits on Cancel for a destructive action, or with no action, so Enter on open never runs a destructive one.
  const defaultMark = { [DIALOG_DEFAULT_ATTR]: "" }
  const action = confirm ? (
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
  ) : null
  return (
    <FooterLayout>
      <DialogClose disabled={busy} {...(destructive || !confirm ? defaultMark : {})} render={<Button variant="outline" />}>
        {cancel ?? m.verb_cancel()}
      </DialogClose>
      {skip ? (
        <Button variant="ghost" disabled={busy} data-action={skip.id} onClick={onSkip ?? (() => void skip.run())}>
          {skip.label}
        </Button>
      ) : null}
      {action && confirm?.unavailable ? <BlockersPreview {...confirm.unavailable}>{action}</BlockersPreview> : action}
    </FooterLayout>
  )
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
  /**
   * Where focus goes after Cancel or Escape, for a dialog without a trigger
   * of its own (a runner's): the control that opened it. Nothing (or no
   * option) keeps the default, the element focused before it opened.
   */
  focusAfterCancel?: () => HTMLElement | null | undefined
}

export interface DialogCommitState {
  isOpen: boolean
  /** Opens or closes the dialog; closing is ignored while a commit runs. */
  setOpen: (open: boolean) => void
  /** Runs `run`; on success the dialog closes unless `close` is false (a flow's next step). */
  commit: (run: DialogCommit, close?: boolean) => void
  busy: boolean
  /** The last failure, worded, shown in the dialog until the next run or close. */
  error: string | null
  /** For the popup's `finalFocus`. */
  finalFocus: () => HTMLElement | boolean
}

export function useDialogCommit({ open, onOpenChange, focusAfterConfirm, focusAfterCancel }: DialogCommitOptions): DialogCommitState {
  const messages = useMessages()
  const [internalOpen, setInternalOpen] = useState(false)
  const [failure, setFailure] = useState<RunFailure | null>(null)
  const [busy, setBusy] = useState(false)
  const running = useRef(false)
  const confirmed = useRef(false)
  const isOpen = open ?? internalOpen
  // The control focused as the dialog opens is its opener. A dialog opened from state (a row's Edit…, a section's Add…) has
  // no trigger of its own, so closing returns focus there unless the host names another target (WCAG 2.4.3).
  const opener = useRef<HTMLElement | null>(null)
  const wasOpen = useRef(false)
  if (isOpen && !wasOpen.current && typeof document !== "undefined") {
    const focused = document.activeElement
    opener.current = focused instanceof HTMLElement && focused !== document.body ? focused : null
  }
  wasOpen.current = isOpen

  function setOpen(next: boolean) {
    // A write in flight keeps the dialog, so its outcome is never lost.
    if (!next && running.current) return
    if (!next) setFailure(null)
    if (next) confirmed.current = false
    if (open === undefined) setInternalOpen(next)
    onOpenChange?.(next)
  }

  function settle(result: Settled, close: boolean) {
    if (!result.ok) {
      setFailure(result.failure)
      return
    }
    setFailure(null)
    if (!close) return
    confirmed.current = true
    setOpen(false)
  }

  function commit(run: DialogCommit, close = true) {
    if (running.current) return
    setFailure(null)
    const outcome = run()
    if (!isPromise(outcome)) {
      settle(settled(outcome), close)
      return
    }
    running.current = true
    setBusy(true)
    void settlePending(outcome).then((result) => {
      running.current = false
      setBusy(false)
      settle(result, close)
    })
  }

  function finalFocus(): HTMLElement | boolean {
    const target = (confirmed.current ? focusAfterConfirm : focusAfterCancel)?.()
    confirmed.current = false
    if (!target) return opener.current?.isConnected ? opener.current : true
    // Headings and regions are not focusable until they carry a tabindex.
    if (!target.hasAttribute("tabindex") && target.tabIndex < 0) target.tabIndex = -1
    return target
  }

  return { isOpen, setOpen, commit, busy, error: failure ? failureMessage(messages, failure) : null, finalFocus }
}

type ReactElementLike = ReactElement<Record<string, unknown>>

interface FormDialogBaseProps extends DialogCommitOptions {
  /** Element that opens the dialog; omit when controlling `open`. */
  trigger?: ReactElementLike
  /** Verb plus object: "Edit run", "Add location". */
  title: string
  /** `sm` short forms, `md` most forms (default), `lg` forms with a table or a preview. */
  size?: DialogSize
  /** Cancel's label; default "Cancel". */
  cancel?: string
}

/** A dialog with one action. */
interface FormDialogActionProps {
  /** The dialog's action. Its `run` commits the fields: a failure keeps the dialog open with the error. */
  confirm: Action
  steps?: never
  /** The fields (components/app/fields.tsx). */
  children: ReactNode
}

/** What FormDialog `steps` hands its fields: the step on screen, and whether it takes input (`stepEditable`). */
export interface DialogStepView {
  step: string
  editable: boolean
}

/** A short flow on local state (P11, F9: import CSV, import masters). */
interface FormDialogStepsProps {
  /**
   * The flow, without `linkFor`. Its StepStrip goes under the title, each step
   * a button that shows it. The footer acts on the step on screen, as
   * StepFooter does on a page: the current step's Proceed (focusable-disabled
   * while its gate is unmet) and Skip, an earlier step's Reopen step, else
   * Cancel alone. Only the last step's Proceed or Skip closes the dialog.
   */
  steps: StepFlow
  confirm?: never
  /** The fields of the step on screen, read-only while `editable` is false. */
  children: (view: DialogStepView) => ReactNode
}

export type FormDialogProps = FormDialogBaseProps & (FormDialogActionProps | FormDialogStepsProps)

export function FormDialog(props: FormDialogProps) {
  if (props.steps) return <StepsFormDialog {...props} steps={props.steps} />
  const { steps: _none, ...dialog } = props
  return <DialogFrame {...dialog} />
}

/**
 * FormDialog `steps`. The step on screen is the current one until the strip
 * shows another; it returns to the current one when the flow moves on or the
 * dialog opens again.
 */
function StepsFormDialog({ steps, children, cancel, open, onOpenChange, ...dialog }: FormDialogBaseProps & FormDialogStepsProps) {
  const m = useMessages()
  const [shown, setShown] = useState<{ step: string; at: string } | null>(null)
  // A controlled dialog opens without calling onOpenChange; its opening shows the current step too.
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) setShown(null)
  }
  const viewing = shown?.at === steps.current ? shown.step : steps.current
  const { access, proceed, skip, reopen } = useStepActions(steps, viewing)
  const last = steps.steps.at(-1)?.id === steps.current
  return (
    <DialogFrame
      {...dialog}
      open={open}
      onOpenChange={(next) => {
        if (next) setShown(null)
        onOpenChange?.(next)
      }}
      cancel={steps.proceed === null ? m.verb_close() : cancel}
      strip={<StepStrip flow={steps} viewing={viewing} onSelect={(step) => setShown({ step, at: steps.current })} />}
      confirm={proceed ?? reopen}
      skip={skip}
      closeOnConfirm={proceed !== null && last}
      actionsKey={`${viewing}:${access}:${proceed?.unavailable ? "unavailable" : "available"}:${skip ? "skip" : ""}`}
    >
      {children({ step: viewing, editable: stepEditable(steps, viewing) })}
    </DialogFrame>
  )
}

interface DialogFrameProps extends FormDialogBaseProps {
  confirm?: Action
  strip?: ReactNode
  skip?: Action
  closeOnConfirm?: boolean
  /** Changes when the footer's controls swap (a flow step moves on, a gate clears); a removed control's focus goes to the action. */
  actionsKey?: string
  children: ReactNode
}

/** What can take focus in a step's fields. */
const FOCUSABLE = "input:not([disabled]), select:not([disabled]), textarea:not([disabled]), button:not([disabled]), [tabindex]:not([tabindex='-1'])"

function DialogFrame({ trigger, title, size = "md", confirm, cancel, strip, skip, closeOnConfirm = true, actionsKey, children, ...options }: DialogFrameProps) {
  const formId = useId()
  const form = useRef<HTMLFormElement>(null)
  const { isOpen, setOpen, commit, busy, error, finalFocus } = useDialogCommit(options)
  const [reviewing, setReviewing] = useState(false)
  /** Runs the action, or opens its ConfirmDialog first when it has one. */
  const act = (action: Action) => (action.confirm ? setReviewing(true) : commit(action.run, closeOnConfirm))

  // Skip leaves with its step, and a gate wraps or unwraps the action; focus then stays in the footer, on its last control.
  useLayoutEffect(() => {
    const popup = form.current?.closest<HTMLElement>("[data-slot=dialog-content]")
    const active = document.activeElement
    if (!popup || (active !== null && active !== document.body && active !== popup)) return
    ;[...popup.querySelectorAll<HTMLElement>("[data-slot=dialog-footer] button")].at(-1)?.focus()
  }, [actionsKey])

  /** Enter in a field. A destructive action has no submit button, so only implicit submission reaches here: it never runs (HIG). */
  function submit(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault()
    if (busy || !confirm || confirm.unavailable || confirm.kind === "destructive") return
    act(confirm)
  }

  // Under a strip, focus starts on the step's first field rather than on the strip.
  const initialFocus = strip ? () => form.current?.querySelector<HTMLElement>(FOCUSABLE) ?? true : undefined

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger ? <DialogTrigger render={trigger} /> : null}
      <DialogContent size={size} showCloseButton={false} initialFocus={initialFocus} finalFocus={finalFocus}>
        <DialogTitle className="text-balance">{title}</DialogTitle>
        {strip}
        <form ref={form} id={formId} noValidate onSubmit={submit} className="flex min-w-0 flex-col gap-3">
          {/* Only there to disable every field while a commit runs; it is no named group. */}
          <fieldset role="none" disabled={busy} className="flex min-w-0 flex-col gap-3">
            {children}
          </fieldset>
          {error ? <ActionError message={error} /> : null}
        </form>
        <DialogFooter
          confirm={confirm}
          form={formId}
          onConfirm={confirm ? () => act(confirm) : undefined}
          cancel={cancel}
          skip={skip}
          onSkip={skip ? () => commit(skip.run, closeOnConfirm) : undefined}
          busy={busy}
          failed={error !== null}
        />
        {confirm?.confirm ? <ConfirmDialog {...confirm.confirm} open={reviewing} onOpenChange={setReviewing} onConfirm={() => commit(confirm.run, closeOnConfirm)} /> : null}
      </DialogContent>
    </Dialog>
  )
}

// ---------------------------------------------------------------------------
// Form checks: the action stays unavailable while a field fails; a field shows its message once changed
// ---------------------------------------------------------------------------

/** A form's checks: each field's message, or undefined when it passes. */
export type FieldErrors<K extends string> = Partial<Record<K, string>>

/** The unavailable state of a dialog action labelled `label` while any of `errors` is set: it stays focusable, and its preview names every field still to fix. Undefined when the fields pass. */
export function blockedByErrors(label: string, errors: FieldErrors<string>): Action["unavailable"] {
  const messages = [...new Set(Object.values(errors).filter((message): message is string => Boolean(message)))]
  if (messages.length === 0) return undefined
  return { action: m.actions_blocked({ action: label }), reason: m.refusal_blockers({ count: messages.length }), blockers: messages.map((message) => ({ label: message })) }
}

/** The errors of the fields the user has changed, so a fresh form opens without messages. */
export function shownErrors<K extends string>(errors: FieldErrors<K>, touched: ReadonlySet<K>): FieldErrors<K> {
  return Object.fromEntries(Object.entries(errors).filter(([key]) => touched.has(key as K))) as FieldErrors<K>
}

/**
 * A controlled dialog's form: it starts from `initial` each time the dialog
 * opens; `set` records which fields the user changed, and `shown` gives a
 * field's message only once it has.
 */
export function useDialogForm<T extends object>(open: boolean, initial: () => T) {
  const [values, setValues] = useState<T>(initial)
  const [touched, setTouched] = useState<ReadonlySet<keyof T & string>>(new Set())
  const [wasOpen, setWasOpen] = useState(open)
  if (open !== wasOpen) {
    setWasOpen(open)
    if (open) {
      setValues(initial())
      setTouched(new Set())
    }
  }
  function set(patch: Partial<T>) {
    setValues((current) => ({ ...current, ...patch }))
    setTouched((current) => new Set([...current, ...(Object.keys(patch) as (keyof T & string)[])]))
  }
  function shown<K extends keyof T & string>(errors: FieldErrors<K>, key: K): string | undefined {
    return shownErrors(errors, touched as ReadonlySet<K>)[key]
  }
  return { values, set, shown }
}
