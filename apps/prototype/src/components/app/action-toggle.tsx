/**
 * ActionToggle: an on/off state that a page header shows and changes in one
 * place, such as a Target's Favourite. It is a Toggle (outline, `sm`, like
 * the header's buttons) whose pressed state is the host's value; a press
 * runs `action` through the toggle's own runner, so a refusal or a failure
 * shows right after it, as ActionButton's does. The visible `label` names
 * the state and stays the same pressed or not; `action.label` names what the
 * press does ("Remove from favourites") wherever the runner words it.
 */
import type { LucideIcon } from "lucide-react"
import { Toggle } from "@/components/ui/toggle"
import { cn } from "@/lib/utils"
import { useAction } from "./actions"
import type { Action } from "./contracts"

export interface ActionToggleProps {
  label: string
  pressed: boolean
  /** What a press does: the inverse of the current state. */
  action: Action
  icon?: LucideIcon
  /** The icon's classes while pressed, such as a filled star. */
  pressedIconClassName?: string
}

export function ActionToggle({ label, pressed, action, icon: Icon, pressedIconClassName }: ActionToggleProps) {
  const runner = useAction()
  return (
    <>
      <Toggle variant="outline" size="sm" pressed={pressed} onPressedChange={() => runner.run(action)} data-action={action.id}>
        {Icon ? <Icon aria-hidden="true" data-icon="inline-start" className={cn(pressed && pressedIconClassName)} /> : null}
        {label}
      </Toggle>
      {runner.feedback}
      {runner.dialog}
    </>
  )
}
