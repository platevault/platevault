import { m } from "./paraglide/messages"
import { cn } from "cn"

export function App() {
  return (
    <main aria-label={m.app_name()} className={cn("min-h-screen")}>
      {m.app_name()}
    </main>
  )
}
