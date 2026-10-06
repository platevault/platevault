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
//
// Studio look (HARNESS-V2.md): desktop-density controls (28 / 24 px), neutral
// grey fills with a 1 px top light, no press translation. The accent fill is
// reserved for `accent`, the one Next action on a surface; `default` is the
// strong neutral used for a surface's own primary command.
const buttonVariants = cva(
  "group/button chrome inline-flex items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium transition-colors outline-none select-none active:not-aria-[haspopup]:brightness-90 disabled:pointer-events-none disabled:opacity-50 data-disabled:pointer-events-none data-disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-strong text-strong-foreground shadow-[inset_0_1px_0_oklch(1_0_0/10%)] hover:bg-[color-mix(in_oklch,var(--strong),var(--foreground)_10%)]",
        accent: "bg-primary text-primary-foreground shadow-[inset_0_1px_0_oklch(1_0_0/18%)] hover:bg-[color-mix(in_oklch,var(--primary),white_10%)]",
        outline:
          "border-border bg-raised text-foreground shadow-[inset_0_1px_0_oklch(1_0_0/5%)] hover:bg-hover aria-expanded:bg-hover dark:border-transparent",
        secondary: "bg-raised text-secondary-foreground hover:bg-hover aria-expanded:bg-hover",
        ghost: "text-foreground hover:bg-hover aria-expanded:bg-hover",
        destructive: "bg-raised text-destructive hover:bg-hover",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "min-h-7 gap-1.5 px-2.5 py-0.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2 [&_svg:not([class*='size-'])]:size-3.5",
        xs: "min-h-6 gap-1 rounded-md px-1.5 py-0.5 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&_svg:not([class*='size-'])]:size-3",
        sm: "min-h-6 gap-1 rounded-md px-2 py-0.5 text-sm in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "min-h-8 gap-1.5 px-3 py-1 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-7 shrink-0",
        "icon-xs": "size-6 shrink-0 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-6 shrink-0 rounded-md in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3.5",
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
