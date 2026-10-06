import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        // HARNESS V1: an NSTextField bezel, 24 px, 5 px radius, white (dark: recessed) fill with a 3:1 hairline.
        "h-6 w-full min-w-0 rounded-[5px] border border-input bg-control px-2 py-0 text-sm shadow-[inset_0_0.5px_1px_rgb(0_0_0/0.06)] transition-colors outline-none file:inline-flex file:h-5 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-45 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25 dark:bg-[color-mix(in_oklab,var(--background),white_6%)]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
