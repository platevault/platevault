import { CheckboxGroup as CheckboxGroupPrimitive } from "@base-ui/react/checkbox-group"
import { cn } from "cn"

/** Shared state for a set of `Checkbox`es: each checkbox's `value` names it in the group's `value` list. */
function CheckboxGroup({ className, ...props }: CheckboxGroupPrimitive.Props) {
  return <CheckboxGroupPrimitive data-slot="checkbox-group" className={cn("flex flex-wrap gap-x-4 gap-y-2", className)} {...props} />
}

export { CheckboxGroup }
