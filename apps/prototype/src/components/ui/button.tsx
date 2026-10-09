import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { useRender } from "@base-ui/react/use-render"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { isValidElement } from "react"

// `data-disabled` also covers `focusableWhenDisabled`, which keeps the button
// focusable (no `disabled` attribute) so its reason can be reached.
// Labels may wrap (WCAG 1.4.10): text sizes set a minimum height, not a fixed
// one, so a label that runs out of room grows a line instead of pushing the
// page sideways. Icon sizes stay square. Harness v4: native push-button
// density (24 px small, 28 px regular), a 5 px radius, a pressed state that
// darkens instead of moving, and the arrow cursor.
const buttonVariants = cva(
  "group/button inline-flex cursor-default items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium transition-[background-color,border-color,color,box-shadow,filter] duration-150 outline-none select-none active:not-aria-[haspopup]:brightness-90 disabled:pointer-events-none disabled:opacity-45 data-disabled:pointer-events-none data-disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/0.18),0_1px_1px_oklch(0_0_0/0.18)] hover:bg-[color-mix(in_oklch,var(--primary),white_8%)]",
        outline:
          "border-input/45 bg-background shadow-[0_1px_1px_oklch(0_0_0/0.06)] hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-white/10 dark:bg-white/[0.07] dark:shadow-[inset_0_1px_0_oklch(1_0_0/0.06)] dark:hover:bg-white/[0.12]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_6%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-foreground/[0.07] hover:text-foreground aria-expanded:bg-foreground/[0.09] aria-expanded:text-foreground",
        // The one destructive style: a tinted fill with --destructive-foreground text (4.6:1 or better over the fill on every surface).
        destructive:
          "bg-destructive/10 text-destructive-foreground hover:bg-destructive/15 dark:bg-destructive/20 dark:hover:bg-destructive/30",
        link: "text-link underline-offset-4 hover:underline",
      },
      size: {
        default:
          "min-h-7 gap-1.5 px-2.5 py-0.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "min-h-6 gap-1 rounded-md px-2 py-0.5 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "min-h-6 gap-1 rounded-md px-2 py-0.5 text-sm in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "min-h-8 gap-1.5 px-3 py-1 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-7 shrink-0",
        "icon-xs":
          "size-6 shrink-0 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-6 shrink-0 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3.5",
        "icon-lg": "size-8 shrink-0",
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
