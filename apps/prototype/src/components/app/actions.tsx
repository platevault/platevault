/**
 * Actions (L2; design/R9-COMPOSITION-PLAN.md P1). One `Action` descriptor
 * (contracts.ts) renders as a header button, a named pull-down item, a row
 * ⋯ item, a context-menu item and a palette command, with the same label,
 * shortcut and unavailable reason in each. Its `kind` picks the look, never
 * the flow position: primary (one per view, filled), standard (outline),
 * destructive (irreversible only, never primary).
 *
 * - `useAction()`: one runner per host. It runs an action, opens its
 *   ConfirmDialog first when it has `confirm`, and keeps a refusal or a
 *   failure as `feedback` for the host to place beside the trigger (P7). It
 *   applies the prototype's Quick actions switch to an action with `quick`
 *   (`inQuickMode`), so every surface below shows and runs the same form.
 * - `ActionButton`: one action as a Button. `size="xs"` is for DataTable
 *   cells, where a primary action stays outline (one primary per view). An
 *   unavailable action stays focusable and opens its BlockersPreview on
 *   hover and focus; nothing is inserted beside it. `iconOnly` shows an
 *   action's icon alone in the IconButton role (below).
 * - `ActionBar`: header actions. At most one primary (trailing) and three
 *   standard buttons; the rest go to one named menu ("More ▾" by default).
 * - `ActionMenu`: a named pull-down ("Run ▾"); `⋯` is for rows only
 *   (RowActions, row-actions.tsx).
 * - `MenuItems`: the items of any of these menus, also inside a context
 *   menu. Destructive actions go last, after one separator.
 * - `IconButton`: the icon-only role: ghost `icon-sm`, its name as the
 *   accessible name and as a tooltip with the shortcut (tooltip rule T1).
 * - `actionCommand`: the palette command for an action.
 */
import { ChevronDown, type LucideIcon } from "lucide-react"
import { type ComponentProps, Fragment, type MouseEvent, type ReactNode, useId, useState } from "react"
import { useMessages } from "@/app/preferences"
import type { PaletteCommand } from "@/app/shell-contract"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Kbd } from "@/components/ui/kbd"
import { Spinner } from "@/components/ui/spinner"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { StepLink } from "@/domain/derive"
import type { QuickActionMode } from "@/domain/types"
import type { Messages } from "@/lib/i18n"
import type { CommitResult } from "@/store/core"
import { useQuickActionMode } from "@/store/simulation"
import { ConfirmDialog } from "./confirm-dialog"
import type { Action, ActionKind, MenuItem, QuickUndo } from "./contracts"
import { ActionError, toast } from "./feedback"
import { useFollowLink } from "./links"
import { Blockable } from "./previews"
import { Refusal, refusalFrom } from "./refusal"

// ---------------------------------------------------------------------------
// Descriptor helpers
// ---------------------------------------------------------------------------

export function isAction(item: MenuItem): item is Action {
  return "run" in item
}

/** Whether a menu holds at least one action, also inside a submenu: a menu without one renders nothing. */
export function hasAction(items: MenuItem[]): boolean {
  return items.some((item) => isAction(item) || ("submenu" in item && hasAction(item.items)))
}

/** The label every surface shows: "…" when more input or a confirmation follows (Apple menus; copy rule W2). */
export function actionLabel(action: Action): string {
  const follows = action.opensDialog === true || action.confirm !== undefined
  return follows && !action.label.endsWith("…") ? `${action.label}…` : action.label
}

type ActionSize = "sm" | "default" | "xs"

/** The spinner takes its button's icon size, so a running action keeps its width. */
const SPINNER_SIZE: Record<ActionSize, string> = { xs: "size-3", sm: "size-3.5", default: "size-4" }

/** The variant of a kind. In a table cell (`xs`) a primary row action stays outline, so a view keeps one primary. */
function variantOf(kind: ActionKind, size: ActionSize): "default" | "outline" | "destructive" {
  if (kind === "destructive") return "destructive"
  return kind === "primary" && size !== "xs" ? "default" : "outline"
}

const SEPARATOR: MenuItem = { separator: true }

/**
 * A menu's items in the one order every menu shows: destructive actions
 * last, after one separator, in every submenu too. Separators never lead,
 * trail or double; a heading with no items after it and a submenu without an
 * action are dropped.
 */
export function orderMenu(items: MenuItem[]): MenuItem[] {
  const destructive = items.filter((item): item is Action => isAction(item) && item.kind === "destructive")
  const rest = items
    .filter((item) => !(isAction(item) && item.kind === "destructive"))
    .map((item) => ("submenu" in item ? { submenu: item.submenu, items: orderMenu(item.items) } : item))
  const segments: MenuItem[][] = []
  let segment: MenuItem[] = []
  for (const item of destructive.length > 0 ? [...rest, SEPARATOR, ...destructive] : rest) {
    if ("separator" in item) {
      segments.push(segment)
      segment = []
    } else if (!("submenu" in item) || hasAction(item.items)) segment.push(item)
  }
  segments.push(segment)
  return segments
    .map((entries) => entries.filter((entry, index) => !("heading" in entry) || headsItems(entries[index + 1])))
    .filter((entries) => entries.length > 0)
    .flatMap((entries, index) => (index === 0 ? entries : [SEPARATOR, ...entries]))
}

/** A heading needs an entry after it in its segment. */
function headsItems(next: MenuItem | undefined): boolean {
  return next !== undefined && !("heading" in next)
}

// ---------------------------------------------------------------------------
// The Quick actions switch
// ---------------------------------------------------------------------------

type Outcome = ReturnType<Action["run"]>

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return value instanceof Promise
}

/** Calls `then` once a run succeeded (a void or ok result, sync or async) and passes the result on. */
export function onSuccess(outcome: Outcome, then: () => void): Outcome {
  const done = (result: CommitResult | void) => {
    if (!result || result.ok) then()
    return result
  }
  return isPromise(outcome) ? outcome.then(done) : done(outcome)
}

interface QuickEffects {
  follow: (link: StepLink) => void
  offerUndo: (undo: QuickUndo) => void
}

/**
 * The action as the Quick actions switch has it run (contracts.ts
 * `QuickAction`), without its `quick`. One-click drops the confirm and
 * offers the Undo notice once `run` succeeds. Open page keeps the action as
 * declared, or follows its link instead of running here, or after `run`
 * when the link shows a commit. An action without `quick` comes back
 * unchanged.
 */
function inQuickMode(action: Action, mode: QuickActionMode, effects: QuickEffects): Action {
  const { quick, ...declared } = action
  if (!quick) return action
  if (mode === "one-click") {
    const form = quick.oneClick
    if ("refresh" in form) return { ...declared, confirm: undefined }
    return {
      ...declared,
      confirm: undefined,
      run: () => {
        const undo = form.undo()
        return onSuccess(action.run(), () => effects.offerUndo(undo))
      },
    }
  }
  const page = quick.openPage
  if (page === "keep") return declared
  if (page.commit) return { ...declared, confirm: undefined, run: () => onSuccess(action.run(), () => effects.follow(page.link)) }
  return { ...declared, confirm: undefined, unavailable: undefined, run: () => effects.follow(page.link) }
}

/** The Undo notice: a toast with the outcome and Undo. An Undo that is refused or fails says why in a toast of its own. */
function offerUndo(m: Messages, undo: QuickUndo): void {
  const revert = () => {
    const result = undo.run()
    if (result && !result.ok) toast({ message: result.message })
  }
  toast({ message: undo.message, action: { id: "undo", label: m.wrapup_undo(), run: revert } })
}

// ---------------------------------------------------------------------------
// Running an action
// ---------------------------------------------------------------------------

type Failure = Exclude<CommitResult, { ok: true }>

export interface ActionRunner {
  /**
   * Runs the action in the Quick actions mode: nothing while it is unavailable or already running; its ConfirmDialog first when it has `confirm`.
   * `opener` is the button that ran it: Cancel and Escape return focus there (WCAG 2.4.3), also where a click does not
   * focus the button it lands on (WebKit).
   */
  run: (action: Action, opener?: HTMLElement) => void
  /** The action as this runner runs it (`inQuickMode`): what a trigger shows, its "…" and availability included. */
  resolve: (action: Action) => Action
  /** The id of the action whose `run` promise has not settled yet. */
  pending: string | null
  /** The last run's refusal (Refusal) or failure (ActionError), else null. Place it beside the trigger, never above a list. */
  feedback: ReactNode
  /** The ConfirmDialog of an action with `confirm`. Mount it once in the host; it renders nothing while closed. */
  dialog: ReactNode
  clear: () => void
}

export interface UseActionOptions {
  /**
   * Where focus goes after a confirmed action, when confirming unmounts its
   * trigger (a batch action that empties the selection).
   */
  focusAfterConfirm?: () => HTMLElement | null | undefined
  /**
   * Where focus goes after Cancel or Escape when the button that opened the
   * dialog is gone; while it is there, focus goes back to it.
   */
  focusAfterCancel?: () => HTMLElement | null | undefined
}

/** One runner per host (a header, a menu, a table): the dialog and the feedback of every action the host shows. */
export function useAction({ focusAfterConfirm, focusAfterCancel }: UseActionOptions = {}): ActionRunner {
  const m = useMessages()
  const mode = useQuickActionMode()
  const follow = useFollowLink()
  const [failure, setFailure] = useState<{ action: Action; result: Failure } | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ action: Action; open: boolean; opener?: HTMLElement } | null>(null)

  const resolve = (action: Action) => inQuickMode(action, mode, { follow, offerUndo: (undo) => offerUndo(m, undo) })

  function settle(action: Action, result: CommitResult | void) {
    setFailure(result && !result.ok ? { action, result } : null)
  }

  /** Calls `run`. A promise marks the action pending until it settles and resolves to its result, a rejection as a failed write. */
  function execute(action: Action): CommitResult | void | Promise<CommitResult | void> {
    const outcome = action.run()
    if (!isPromise(outcome)) return outcome
    setPending(action.id)
    return outcome
      .then(
        (result) => result,
        (error: unknown): CommitResult => ({ ok: false, reason: "write-failed", message: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() => setPending((current) => (current === action.id ? null : current)))
  }

  function run(declared: Action, opener?: HTMLElement) {
    const action = resolve(declared)
    if (action.unavailable || pending === action.id) return
    setFailure(null)
    if (action.confirm) {
      setConfirming({ action, open: true, opener })
      return
    }
    const outcome = execute(action)
    if (isPromise(outcome)) void outcome.then((result) => settle(action, result))
    else settle(action, outcome)
  }

  // Without an opener (a menu item, a shortcut) the dialog keeps its default: the element focused before it opened.
  function cancelTarget(opener: HTMLElement | undefined): HTMLElement | null | undefined {
    if (opener === undefined) return undefined
    return opener.isConnected ? opener : focusAfterCancel?.()
  }

  // A refusal closes the dialog and shows beside the trigger (nothing to retry); a failed write stays in the dialog with Retry.
  // A promise goes back to the dialog too, so it stays open and busy until the run settles.
  function confirmRun(action: Action): CommitResult | void | Promise<CommitResult | void> {
    const outcome = execute(action)
    return isPromise(outcome) ? outcome.then((result) => afterConfirm(action, result)) : afterConfirm(action, outcome)
  }

  function afterConfirm(action: Action, result: CommitResult | void): CommitResult | void {
    if (result && !result.ok && result.reason !== "refused") return result
    settle(action, result)
  }

  const refusal = failure ? refusalFrom(failure.result, m.actions_blocked({ action: failure.action.label })) : null
  const feedback = failure ? refusal ? <Refusal {...refusal} /> : <ActionError message={failure.result.message} onRetry={() => run(failure.action)} /> : null

  const spec = confirming?.action.confirm
  const dialog =
    confirming && spec ? (
      <ConfirmDialog
        {...spec}
        open={confirming.open}
        onOpenChange={(open) => setConfirming({ ...confirming, open })}
        onConfirm={() => confirmRun(confirming.action)}
        focusAfterConfirm={focusAfterConfirm}
        focusAfterCancel={() => cancelTarget(confirming.opener)}
      />
    ) : null

  return { run, resolve, pending, feedback, dialog, clear: () => setFailure(null) }
}

// ---------------------------------------------------------------------------
// One action as a button
// ---------------------------------------------------------------------------

export interface ActionButtonProps {
  action: Action
  /** `sm` in headers, toolbars and batch bars (default); `default` in dialog footers; `xs` in DataTable cells only. */
  size?: ActionSize
  /**
   * Show the action's icon alone in the IconButton role (ghost `icon-sm`), its label as the accessible name and the
   * tooltip (T1); while unavailable the blockers preview names it instead. An action without an icon keeps its label.
   */
  iconOnly?: boolean
  /** The host's runner. Without one the button keeps its own and renders its feedback and dialog right after itself. */
  runner?: ActionRunner
}

export function ActionButton({ runner, ...props }: ActionButtonProps) {
  return runner ? <ActionTrigger {...props} runner={runner} /> : <OwnActionButton {...props} />
}

function OwnActionButton(props: Omit<ActionButtonProps, "runner">) {
  const runner = useAction()
  return (
    <>
      <ActionTrigger {...props} runner={runner} />
      {runner.feedback}
      {runner.dialog}
    </>
  )
}

function ActionTrigger({ action: declared, size = "sm", iconOnly = false, runner }: Omit<ActionButtonProps, "runner"> & { runner: ActionRunner }) {
  const action = runner.resolve(declared)
  const Icon = action.icon
  const busy = runner.pending === action.id
  const unavailable = action.unavailable
  const label = actionLabel(action)
  const behaviour = {
    // Focusable while unavailable, so its blockers preview can be reached (P7).
    disabled: unavailable !== undefined,
    focusableWhenDisabled: true,
    "aria-busy": busy || undefined,
    "data-action": action.id,
    onClick: (event: MouseEvent<HTMLButtonElement>) => runner.run(action, event.currentTarget),
  }
  // The preview opens on hover and focus, and describes the button with "<action> · <reason>". One wrapper in both states,
  // so the button keeps its node, and focus, when the action turns unavailable or available again.
  if (iconOnly && Icon) {
    // The tooltip names the button while it is available; the preview takes over while it is not, so one popup shows.
    return (
      <Tooltip disabled={unavailable !== undefined}>
        <Blockable unavailable={unavailable}>
          <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} {...behaviour} />}>
            {busy ? <Spinner aria-hidden="true" className={SPINNER_SIZE.sm} /> : <Icon aria-hidden="true" />}
          </TooltipTrigger>
        </Blockable>
        <TooltipContent side="bottom">{label}</TooltipContent>
      </Tooltip>
    )
  }
  return (
    <Blockable unavailable={unavailable}>
      <Button variant={variantOf(action.kind ?? "standard", size)} size={size} {...behaviour}>
        {busy ? <Spinner aria-hidden="true" data-icon="inline-start" className={SPINNER_SIZE[size]} /> : Icon ? <Icon aria-hidden="true" data-icon="inline-start" /> : null}
        {label}
      </Button>
    </Blockable>
  )
}

// ---------------------------------------------------------------------------
// Header actions
// ---------------------------------------------------------------------------

const MAX_STANDARD = 3

export interface ActionBarProps {
  actions: Action[]
  /** Items after the overflowing actions in the bar's menu. */
  overflow?: MenuItem[]
  /** The menu's name: "Project" for an object menu; default "More". */
  menuLabel?: string
  runner?: ActionRunner
  /** How many standard actions get a button: 3 in a page header (default), 2 in a narrow detail panel. The rest go to the menu. */
  buttons?: number
}

/**
 * The bar's own layout, so no header picks variants or sizes: standard
 * buttons, then the named menu, then the one primary at the trailing end.
 * Only the first primary and the first `buttons` (three) standard actions get
 * a button; every other action, and every destructive one, goes to the menu.
 */
export function ActionBar({ runner, ...props }: ActionBarProps) {
  return runner ? <ActionBarView {...props} runner={runner} /> : <OwnActionBar {...props} />
}

function OwnActionBar(props: Omit<ActionBarProps, "runner">) {
  const runner = useAction()
  return (
    <div className="flex flex-col items-end gap-1.5">
      <ActionBarView {...props} runner={runner} />
      {runner.feedback}
      {runner.dialog}
    </div>
  )
}

function ActionBarView({ actions, overflow = [], menuLabel, runner, buttons = MAX_STANDARD }: Omit<ActionBarProps, "runner"> & { runner: ActionRunner }) {
  const m = useMessages()
  const primary = actions.find((action) => action.kind === "primary")
  const standard = actions.filter((action) => (action.kind ?? "standard") === "standard").slice(0, buttons)
  const menu: MenuItem[] = [...actions.filter((action) => action !== primary && !standard.includes(action)), ...overflow]
  if (!primary && standard.length === 0 && !hasAction(menu)) return null
  return (
    <div className="flex flex-wrap items-center justify-end gap-2" data-action-bar="">
      {standard.map((action) => (
        <ActionTrigger key={action.id} action={action} runner={runner} />
      ))}
      <ActionMenuView label={menuLabel ?? m.common_more()} items={menu} runner={runner} />
      {primary ? <ActionTrigger action={primary} runner={runner} /> : null}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Named menus
// ---------------------------------------------------------------------------

export interface ActionMenuProps {
  /** The menu's name, a noun or a verb: "Run", "Project", "Add". */
  label: string
  items: MenuItem[]
  runner?: ActionRunner
}

/** A named pull-down, "Run ▾" (outline, sm). Renders nothing without an action. */
export function ActionMenu({ runner, ...props }: ActionMenuProps) {
  return runner ? <ActionMenuView {...props} runner={runner} /> : <OwnActionMenu {...props} />
}

function OwnActionMenu(props: Omit<ActionMenuProps, "runner">) {
  const runner = useAction()
  return (
    <>
      <ActionMenuView {...props} runner={runner} />
      {runner.feedback}
      {runner.dialog}
    </>
  )
}

function ActionMenuView({ label, items, runner }: Omit<ActionMenuProps, "runner"> & { runner: ActionRunner }) {
  if (!hasAction(items)) return null
  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
        {label}
        <ChevronDown aria-hidden="true" data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-auto min-w-48">
        <MenuItems items={items} runner={runner} />
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

/**
 * The items of a named menu, a row ⋯ menu or a context menu (inside
 * `DropdownMenuContent` or `ContextMenuContent`: both use the same menu
 * parts), so every surface lists the same entries in the same order. A
 * heading labels the items after it up to the next separator or heading.
 */
export function MenuItems({ items, runner }: { items: MenuItem[]; runner: ActionRunner }) {
  return <OrderedItems items={orderMenu(items)} runner={runner} />
}

type Block = { key: string; separator: true } | { key: string; heading: string | null; items: Exclude<MenuItem, { separator: true } | { heading: string }>[] }

function OrderedItems({ items, runner }: { items: MenuItem[]; runner: ActionRunner }) {
  const blocks: Block[] = []
  for (const [index, item] of items.entries()) {
    const last = blocks.at(-1)
    if ("separator" in item) blocks.push({ key: `separator-${index}`, separator: true })
    else if ("heading" in item) blocks.push({ key: `heading-${index}`, heading: item.heading, items: [] })
    else if (last && "items" in last) last.items.push(item)
    else blocks.push({ key: `items-${index}`, heading: null, items: [item] })
  }
  return blocks.map((block) => {
    if ("separator" in block) return <DropdownMenuSeparator key={block.key} />
    const entries = block.items.map((item) =>
      isAction(item) ? (
        <ActionItem key={item.id} action={item} runner={runner} />
      ) : (
        <DropdownMenuSub key={`submenu-${item.submenu}`}>
          <DropdownMenuSubTrigger>{item.submenu}</DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="min-w-48">
            <OrderedItems items={item.items} runner={runner} />
          </DropdownMenuSubContent>
        </DropdownMenuSub>
      ),
    )
    if (block.heading === null) return <Fragment key={block.key}>{entries}</Fragment>
    return (
      <DropdownMenuGroup key={block.key}>
        <DropdownMenuLabel>{block.heading}</DropdownMenuLabel>
        {entries}
      </DropdownMenuGroup>
    )
  })
}

/**
 * One action in a menu. An unavailable one stays reachable by the arrow keys
 * (a disabled menu item keeps focus) and shows its reason under the label,
 * at full strength: the reason is what the item says.
 */
function ActionItem({ action: declared, runner }: { action: Action; runner: ActionRunner }) {
  const action = runner.resolve(declared)
  const reasonId = useId()
  const Icon = action.icon
  const label = actionLabel(action)
  const unavailable = action.unavailable
  return (
    <DropdownMenuItem
      variant={action.kind === "destructive" ? "destructive" : "default"}
      disabled={unavailable !== undefined}
      label={label}
      aria-label={label}
      aria-describedby={unavailable ? reasonId : undefined}
      data-action={action.id}
      className={unavailable ? "items-start data-disabled:opacity-100" : undefined}
      onClick={() => runner.run(action)}
    >
      {Icon ? <Icon aria-hidden="true" className={unavailable ? "mt-0.5 opacity-50" : undefined} /> : null}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className={unavailable ? "opacity-50" : undefined}>{label}</span>
        {unavailable ? (
          <span id={reasonId} className="text-xs text-muted-foreground">
            {unavailable.reason}
          </span>
        ) : null}
      </span>
      {action.shortcut ? <DropdownMenuShortcut className={unavailable ? "opacity-50" : undefined}>{action.shortcut}</DropdownMenuShortcut> : null}
    </DropdownMenuItem>
  )
}

// ---------------------------------------------------------------------------
// Icon-only buttons
// ---------------------------------------------------------------------------

export interface IconButtonProps extends Omit<ComponentProps<typeof Button>, "variant" | "size" | "children" | "className" | "aria-label"> {
  /** The name: its accessible name and its tooltip. */
  label: string
  icon: LucideIcon
  /** Shown after the name in the tooltip: "Previous night ⌥←". */
  shortcut?: string
}

/** An icon-only control (ghost `icon-sm`). Its tooltip names it, the one tooltip a control gets (T1). */
export function IconButton({ label, icon: Icon, shortcut, ...props }: IconButtonProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={<Button variant="ghost" size="icon-sm" aria-label={label} {...props} />}>
        <Icon aria-hidden="true" />
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {label}
        {shortcut ? <Kbd>{shortcut}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  )
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/** The palette command of an action: the same label, shortcut and unavailable reason, run through the host's runner. */
export function actionCommand(declared: Action, group: string, runner: ActionRunner, keywords?: string): PaletteCommand {
  const action = runner.resolve(declared)
  return {
    id: `action:${action.id}`,
    label: actionLabel(action),
    group,
    keywords,
    shortcut: action.shortcut,
    unavailable: action.unavailable?.reason,
    run: () => runner.run(action),
  }
}
