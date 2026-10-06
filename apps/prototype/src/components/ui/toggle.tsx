"use client"

import { Toggle as TogglePrimitive } from "@base-ui/react/toggle"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

// Pressed: HARNESS V1 segmented-control selection, the accent fill with white
// text (5.8:1), so the pressed item differs from its neighbours at ≥ 3:1 and
// not by a subtle raise alone (WCAG 1.4.1, 1.4.11).
const toggleVariants = cva(
  "group/toggle inline-flex items-center justify-center gap-1 rounded-md text-sm font-normal whitespace-nowrap transition-[background-color,color,box-shadow] duration-100 outline-none hover:bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] disabled:pointer-events-none disabled:opacity-45 aria-invalid:border-destructive data-pressed:bg-key data-pressed:text-key-foreground data-pressed:shadow-[0_0.5px_1px_rgb(0_0_0/0.25)] data-pressed:hover:bg-key [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-transparent",
        outline: "border border-control-border bg-control shadow-[0_0.5px_1px_rgb(0_0_0/0.1)] hover:bg-[color-mix(in_oklab,var(--control),var(--foreground)_5%)]",
      },
      size: {
        default:
          "h-6 min-w-6 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        sm: "h-[22px] min-w-[22px] px-2 text-sm has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5",
        lg: "h-7 min-w-7 px-3 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Toggle({
  className,
  variant = "default",
  size = "default",
  ...props
}: TogglePrimitive.Props & VariantProps<typeof toggleVariants>) {
  return (
    <TogglePrimitive
      data-slot="toggle"
      className={cn(toggleVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Toggle, toggleVariants }
