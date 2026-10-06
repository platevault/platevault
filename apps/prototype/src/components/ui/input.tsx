import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(
        "h-6.5 w-full min-w-0 rounded-md border border-input bg-background px-2 py-0.5 text-sm transition-colors outline-none file:inline-flex file:h-5 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-2 aria-invalid:ring-destructive/25 dark:bg-black/20 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive",
        className
      )}
      {...props}
    />
  )
}

export { Input }
