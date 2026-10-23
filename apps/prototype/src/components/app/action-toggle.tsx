/**
 * ActionToggle: an on/off state that a page header shows and changes in one
 * place, such as a Target's Favourite. It is a Toggle (outline, `sm`, like
 * the header's buttons) whose pressed state is the host's value; a press
 * runs `action` through a runner. The visible `label` names the state and
 * stays the same pressed or not; `action.label` names what the press does
 * ("Remove from favourites") wherever the runner words it.
 *
 * Without a `runner` the toggle keeps its own and shows a refusal or a
 * failure right after itself. A page header passes its runner and places
 * `runner.feedback` in the header's feedback row instead, so the toggle
 * never moves when the alert appears.
 */
import type { LucideIcon } from "lucide-react"
import { Toggle } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"
import { type ActionRunner, useAction } from "./actions"
import type { Action } from "./contracts"

export interface ActionToggleProps {
  label: string
  pressed: boolean
  /** What a press does: the inverse of the current state. */
  action: Action
  icon?: LucideIcon
  /** The icon's classes while pressed, such as a filled star. */
  pressedIconClassName?: string
  /** The host's runner; the host then places its feedback and dialog. */
  runner?: ActionRunner
}

export function ActionToggle({ runner, ...props }: ActionToggleProps) {
  return runner ? <ToggleTrigger {...props} runner={runner} /> : <OwnActionToggle {...props} />
}

function OwnActionToggle(props: Omit<ActionToggleProps, "runner">) {
  const runner = useAction()
  return (
    <>
      <ToggleTrigger {...props} runner={runner} />
      {runner.feedback}
      {runner.dialog}
    </>
  )
}

function ToggleTrigger({ label, pressed, action, icon: Icon, pressedIconClassName, runner }: Omit<ActionToggleProps, "runner"> & { runner: ActionRunner }) {
  return (
    <Toggle variant="outline" size="sm" pressed={pressed} onPressedChange={() => runner.run(action)} data-action={action.id}>
      {Icon ? <Icon aria-hidden="true" data-icon="inline-start" className={cn(pressed && pressedIconClassName)} /> : null}
      {label}
    </Toggle>
  )
}
