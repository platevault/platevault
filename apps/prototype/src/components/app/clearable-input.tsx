/**
 * ClearableInput (foundation primitive): every text field that filters or
 * searches carries a clear (×) button once it holds text; Escape clears it
 * too. `search` adds the leading magnifier and marks the field for the `/`
 * shortcut (`data-page-search`).
 */
import { Search, X } from "lucide-react"
import { type ComponentProps, useRef } from "react"
import { useT } from "@/app/preferences"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

export interface ClearableInputProps extends Omit<ComponentProps<"input">, "value" | "onChange" | "defaultValue"> {
  value: string
  onValueChange: (value: string) => void
  /** Leading magnifier; the field becomes the page search for `/`. */
  search?: boolean
  /** Class of the wrapper; `className` styles the input. */
  wrapperClassName?: string
}

export function ClearableInput({ value, onValueChange, search = false, wrapperClassName, className, onKeyDown, ...props }: ClearableInputProps) {
  const t = useT()
  const input = useRef<HTMLInputElement>(null)
  const clear = () => {
    onValueChange("")
    input.current?.focus()
  }
  return (
    <div className={cn("relative min-w-0", wrapperClassName)}>
      {search ? <Search aria-hidden="true" className="pointer-events-none absolute top-1/2 left-2 size-3.5 -translate-y-1/2 text-muted-foreground" /> : null}
      <Input
        ref={input}
        type={search ? "search" : "text"}
        data-page-search={search || undefined}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onKeyDown={(event) => {
          onKeyDown?.(event)
          if (event.key === "Escape" && value !== "" && !event.defaultPrevented) {
            // Clear first; a second Escape reaches the sheet or dialog.
            event.preventDefault()
            event.stopPropagation()
            onValueChange("")
          }
        }}
        className={cn(search && "pl-7", "pr-7 [&::-webkit-search-cancel-button]:hidden", className)}
        {...props}
      />
      {value !== "" ? (
        <button
          type="button"
          onClick={clear}
          aria-label={t("Clear")}
          className="absolute top-1/2 right-1 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-accent-foreground"
        >
          <X aria-hidden="true" className="size-3" />
        </button>
      ) : null}
    </div>
  )
}
