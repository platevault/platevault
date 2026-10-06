import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { isValidElement } from "react"

// `data-disabled` also covers `focusableWhenDisabled`, which keeps the button
// focusable (no `disabled` attribute) so its reason can be reached.
// Labels may wrap (WCAG 1.4.10): text sizes set a minimum height, not a fixed
// one, so a label that runs out of room grows a line instead of pushing the
// page sideways. Icon sizes stay square.
// Harness V3: native push-button density. 26 px regular, 24 px small (the
// WCAG 2.5.8 floor), 4 px radius, a hairline bezel and a 1 px drop, no lift.
const buttonVariants = cva(
  "group/button inline-flex items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-normal transition-[background-color,color,border-color,filter] duration-100 outline-none select-none active:brightness-90 disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/30 dark:aria-invalid:border-destructive [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default: "bg-primary font-medium text-primary-foreground shadow-[0_1px_0_0_oklch(0_0_0/0.25)] hover:bg-primary/88",
        outline:
          "border-input/70 bg-card shadow-[0_1px_0_0_oklch(0_0_0/0.18)] hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground dark:border-white/14 dark:bg-white/[0.07] dark:hover:bg-white/[0.12]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost: "hover:bg-accent hover:text-foreground aria-expanded:bg-accent aria-expanded:text-foreground",
        destructive:
          "bg-destructive/12 text-destructive hover:bg-destructive/20 dark:bg-destructive/18 dark:hover:bg-destructive/26",
        link: "text-primary underline-offset-3 hover:underline",
      },
      size: {
        default:
          "min-h-6.5 gap-1.5 px-2.5 py-0.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "min-h-6 gap-1 px-2 py-0.5 text-xs in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "min-h-6 gap-1 px-2 py-0.5 text-sm in-data-[slot=button-group]:rounded-md has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "min-h-7 gap-1.5 px-3 py-1 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        icon: "size-6.5 shrink-0",
        "icon-xs": "size-6 shrink-0 in-data-[slot=button-group]:rounded-md [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-6 shrink-0 in-data-[slot=button-group]:rounded-md",
        "icon-lg": "size-7 shrink-0",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

type ButtonProps = ButtonPrimitive.Props & VariantProps<typeof buttonVariants>

/**
 * A `render` target that navigates (`<Link to>`, `<a href>`) stays a link
 * with only the button's look: Base UI's Button warns that it is not a
 * native button, and its non-native mode adds `role="button"`, which
 * announces navigation as an action. Links cannot be disabled. Any other
 * target (a Base UI trigger) keeps the Button behaviour.
 */
function Button({ className, variant = "default", size = "default", ...props }: ButtonProps) {
  const classes = cn(buttonVariants({ variant, size, className }))
  if (isLinkElement(props.render)) return <ButtonLink {...props} render={props.render} className={classes} />
  return <ButtonPrimitive data-slot="button" className={classes} {...props} />
}

function isLinkElement(render: ButtonProps["render"]): render is React.ReactElement {
  if (!isValidElement(render)) return false
  const linkProps = render.props as { href?: unknown; to?: unknown }
  return linkProps.href !== undefined || linkProps.to !== undefined
}

function ButtonLink({
  render,
  ref,
  disabled: _disabled,
  focusableWhenDisabled: _focusable,
  nativeButton: _native,
  ...props
}: Omit<ButtonPrimitive.Props, "render" | "className"> & { render: React.ReactElement; className: string }) {
  return useRender({ render, ref, props: { "data-slot": "button", ...props } })
}

export { Button, buttonVariants }
