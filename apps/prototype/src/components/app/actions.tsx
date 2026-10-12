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
 *   failure as `feedback` for the host to place beside the trigger (P7).
 * - `ActionButton`: one action as a Button. `size="xs"` is for DataTable
 *   cells, where a primary action stays outline (one primary per view). An
 *   unavailable action stays focusable and opens its BlockersPreview on
 *   hover and focus; nothing is inserted beside it.
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
import { type ComponentProps, Fragment, type ReactNode, useId, useState } from "react"
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
import type { CommitResult } from "@/store/core"
import { ConfirmDialog } from "./confirm-dialog"
import type { Action, ActionKind, MenuItem } from "./contracts"
import { ActionError } from "./feedback"
import { BlockersPreview } from "./previews"
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
// Running an action
// ---------------------------------------------------------------------------

type Failure = Exclude<CommitResult, { ok: true }>

export interface ActionRunner {
  /** Runs the action: nothing while it is unavailable or already running; its ConfirmDialog first when it has `confirm`. */
  run: (action: Action) => void
  /** The id of the action whose `run` promise has not settled yet. */
  pending: string | null
  /** The last run's refusal (Refusal) or failure (ActionError), else null. Place it beside the trigger, never above a list. */
  feedback: ReactNode
  /** The ConfirmDialog of an action with `confirm`. Mount it once in the host; it renders nothing while closed. */
  dialog: ReactNode
  clear: () => void
}

function isPromise<T>(value: T | Promise<T>): value is Promise<T> {
  return value instanceof Promise
}

/** One runner per host (a header, a menu, a table): the dialog and the feedback of every action the host shows. */
export function useAction(): ActionRunner {
  const m = useMessages()
  const [failure, setFailure] = useState<{ action: Action; result: Failure } | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [confirming, setConfirming] = useState<{ action: Action; open: boolean } | null>(null)

  function settle(action: Action, result: CommitResult | void) {
    setFailure(result && !result.ok ? { action, result } : null)
  }

  /** Calls `run`; a promise settles into `feedback`, a direct result is returned to the caller. */
  function execute(action: Action): CommitResult | void {
    const outcome = action.run()
    if (!isPromise(outcome)) return outcome
    setPending(action.id)
    outcome
      .then(
        (result) => settle(action, result),
        (error: unknown) => settle(action, { ok: false, reason: "write-failed", message: error instanceof Error ? error.message : String(error) }),
      )
      .finally(() => setPending((current) => (current === action.id ? null : current)))
  }

  function run(action: Action) {
    if (action.unavailable || pending === action.id) return
    setFailure(null)
    if (action.confirm) {
      setConfirming({ action, open: true })
      return
    }
    settle(action, execute(action))
  }

  // A refusal closes the dialog and shows beside the trigger (nothing to retry); a failed write stays in the dialog with Retry.
  function confirmRun(action: Action): CommitResult | void {
    const result = execute(action)
    if (result && !result.ok && result.reason !== "refused") return result
    settle(action, result)
  }

  const refusal = failure ? refusalFrom(failure.result, m.actions_blocked({ action: failure.action.label })) : null
  const feedback = failure ? refusal ? <Refusal {...refusal} /> : <ActionError message={failure.result.message} onRetry={() => run(failure.action)} /> : null

  const spec = confirming?.action.confirm
  // Interim mapping onto today's ConfirmDialog; U5's ConfirmDialog takes the ConfirmSpec as it is (P8).
  const dialog =
    confirming && spec ? (
      <ConfirmDialog
        open={confirming.open}
        onOpenChange={(open) => setConfirming({ action: confirming.action, open })}
        title={spec.title}
        description={spec.summary ?? null}
        changes={(spec.groups ?? []).map((group) => m.actions_confirm_group({ label: group.label, count: group.rows.length }))}
        confirmLabel={spec.confirm.label}
        tone={spec.confirm.kind === "destructive" ? "destructive" : "default"}
        onConfirm={() => confirmRun(confirming.action)}
      />
    ) : null

  return { run, pending, feedback, dialog, clear: () => setFailure(null) }
}

// ---------------------------------------------------------------------------
// One action as a button
// ---------------------------------------------------------------------------

export interface ActionButtonProps {
  action: Action
  /** `sm` in headers, toolbars and batch bars (default); `default` in dialog footers; `xs` in DataTable cells only. */
  size?: ActionSize
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

function ActionTrigger({ action, size = "sm", runner }: Omit<ActionButtonProps, "runner"> & { runner: ActionRunner }) {
  const Icon = action.icon
  const busy = runner.pending === action.id
  const unavailable = action.unavailable
  const button = (
    <Button
      variant={variantOf(action.kind ?? "standard", size)}
      size={size}
      // Focusable while unavailable, so its blockers preview can be reached (P7).
      disabled={unavailable !== undefined}
      focusableWhenDisabled
      aria-busy={busy || undefined}
      data-action={action.id}
      onClick={() => runner.run(action)}
    >
      {busy ? <Spinner aria-hidden="true" data-icon="inline-start" className={SPINNER_SIZE[size]} /> : Icon ? <Icon aria-hidden="true" data-icon="inline-start" /> : null}
      {actionLabel(action)}
    </Button>
  )
  // The preview opens on hover and focus, and describes the button with "<action> · <reason>".
  return unavailable ? <BlockersPreview {...unavailable}>{button}</BlockersPreview> : button
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
}

/**
 * The bar's own layout, so no header picks variants or sizes: standard
 * buttons, then the named menu, then the one primary at the trailing end.
 * Only the first primary and the first three standard actions get a button;
 * every other action, and every destructive one, goes to the menu.
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

function ActionBarView({ actions, overflow = [], menuLabel, runner }: Omit<ActionBarProps, "runner"> & { runner: ActionRunner }) {
  const m = useMessages()
  const primary = actions.find((action) => action.kind === "primary")
  const standard = actions.filter((action) => (action.kind ?? "standard") === "standard").slice(0, MAX_STANDARD)
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
function ActionItem({ action, runner }: { action: Action; runner: ActionRunner }) {
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
export function actionCommand(action: Action, group: string, runner: ActionRunner, keywords?: string): PaletteCommand {
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
