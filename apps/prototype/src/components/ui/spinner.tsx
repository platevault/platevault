import { cn } from "cn"
import { Loader2Icon } from "lucide-react"
import { useMessages } from "@/app/preferences"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const m = useMessages()
  return (
    <Loader2Icon data-slot="spinner" role="status" aria-label={m.common_loading()} className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
