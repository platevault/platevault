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
// HARNESS V1: AppKit metrics. Regular push button 24 px (the WCAG 2.5.8
// minimum), small 22 px, mini 20 px; 5 px radius, regular-weight 13 px label,
// a hairline bezel with a 0.5 px drop. No pressed translate: AppKit darkens.
const buttonVariants = cva(
  "group/button inline-flex items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-normal transition-[background-color,color,box-shadow,filter] duration-100 outline-none select-none active:not-aria-[haspopup]:brightness-[0.92] disabled:pointer-events-none disabled:opacity-45 data-disabled:pointer-events-none data-disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-3.5",
  {
    variants: {
      variant: {
        default:
          "bg-key bg-[linear-gradient(to_bottom,rgb(255_255_255/0.14),rgb(255_255_255/0))] text-key-foreground shadow-[0_0.5px_1px_rgb(0_0_0/0.25)] hover:brightness-110",
        outline:
          "border-control-border bg-control text-foreground shadow-[0_0.5px_1px_rgb(0_0_0/0.1)] hover:bg-[color-mix(in_oklab,var(--control),var(--foreground)_5%)] aria-expanded:bg-accent dark:shadow-[0_0.5px_0_rgb(255_255_255/0.06)_inset,0_0.5px_1px_rgb(0_0_0/0.4)]",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklab,var(--secondary),var(--foreground)_6%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "text-foreground hover:bg-[color-mix(in_oklab,var(--foreground)_8%,transparent)] aria-expanded:bg-[color-mix(in_oklab,var(--foreground)_10%,transparent)]",
        destructive:
          "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/16 dark:bg-destructive/16 dark:hover:bg-destructive/24",
        link: "text-primary underline-offset-2 hover:underline",
      },
      size: {
        default:
          "min-h-6 gap-1.5 px-2.5 py-0.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "min-h-5 gap-1 rounded-[4px] px-1.5 py-0 text-xs has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 [&_svg:not([class*='size-'])]:size-3",
        sm: "min-h-[22px] gap-1 px-2 py-0 text-sm has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "min-h-7 gap-1.5 px-3 py-1 has-data-[icon=inline-end]:pr-2.5 has-data-[icon=inline-start]:pl-2.5",
        icon: "size-6 shrink-0",
        "icon-xs": "size-5 shrink-0 rounded-[4px] [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-[22px] shrink-0",
        "icon-lg": "size-7 shrink-0 [&_svg:not([class*='size-'])]:size-4",
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
