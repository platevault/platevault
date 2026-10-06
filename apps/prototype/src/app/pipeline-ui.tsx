/**
 * Pipeline UI pieces shared by the shell and the Pipeline board (harness v4).
 *
 * - StageGlyph: Direction C's gate vocabulary. Each state has its own glyph
 *   shape, so colour only reinforces; the word sits beside it or in
 *   screen-reader text.
 * - useFollowLink: opens a stage link and focuses its target element (e.g.
 *   Save View) once the route has rendered.
 */
import { useNavigate } from "@tanstack/react-router"
import { Circle, CircleArrowRight, CircleCheck, CircleDashed, Loader, OctagonX, TriangleAlert } from "lucide-react"
import { cn } from "@/lib/utils"
import type { GateState, StageLink } from "./pipeline"

const GATE_GLYPH: Record<GateState, { icon: typeof Circle; className: string }> = {
  done: { icon: CircleCheck, className: "text-success" },
  ready: { icon: CircleArrowRight, className: "text-link" },
  review: { icon: TriangleAlert, className: "text-warning" },
  blocked: { icon: OctagonX, className: "text-destructive" },
  running: { icon: Loader, className: "text-link motion-safe:animate-spin" },
  partial: { icon: CircleDashed, className: "text-warning" },
  idle: { icon: Circle, className: "text-muted-foreground" },
}

export function StageGlyph({ state, className }: { state: GateState; className?: string }) {
  const meta = GATE_GLYPH[state]
  const Icon = meta.icon
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", meta.className, className)} />
}

export function useFollowLink() {
  const navigate = useNavigate()
  return (link: StageLink) => {
    void navigate({ to: link.to as never, params: link.params as never, search: link.search as never }).then(() => {
      if (link.focusId) requestAnimationFrame(() => document.getElementById(link.focusId!)?.focus())
    })
  }
}
