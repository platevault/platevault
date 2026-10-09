/**
 * Run UI pieces shared by the shell, the outlines and the screens
 * (foundation-owned; v4's pipeline UI moved to the run).
 *
 * - StepGlyph: Direction C's gate vocabulary. Each state has its own glyph
 *   shape, so colour only reinforces; the word sits beside it or in
 *   screen-reader text (glyph plus word).
 * - useFollowLink: opens a step link and focuses its target element (e.g.
 *   Save run) once the route has rendered.
 */
import { useNavigate } from "@tanstack/react-router"
import { Circle, CircleArrowRight, CircleCheck, CircleDashed, Loader, OctagonX, TriangleAlert } from "lucide-react"
import { GATE_LABEL, type GateState, type StepLink } from "@/domain/derive"
import { cn } from "@/lib/utils"

const GATE_GLYPH: Record<GateState, { icon: typeof Circle; className: string }> = {
  done: { icon: CircleCheck, className: "text-success" },
  ready: { icon: CircleArrowRight, className: "text-link" },
  review: { icon: TriangleAlert, className: "text-warning" },
  blocked: { icon: OctagonX, className: "text-destructive" },
  running: { icon: Loader, className: "text-link motion-safe:animate-spin" },
  partial: { icon: CircleDashed, className: "text-warning" },
  idle: { icon: Circle, className: "text-muted-foreground" },
}

export function StepGlyph({ state, className }: { state: GateState; className?: string }) {
  const meta = GATE_GLYPH[state]
  const Icon = meta.icon
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", meta.className, className)} />
}

/** Glyph plus word: the gate state as a native status label. */
export function GateLabel({ state, label, className }: { state: GateState; label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 text-[0.75rem] font-medium", className)} data-gate={state}>
      <StepGlyph state={state} />
      {label ?? GATE_LABEL[state]}
    </span>
  )
}

export function useFollowLink() {
  const navigate = useNavigate()
  return (link: StepLink) => {
    void navigate({ to: link.to as never, params: link.params as never, search: link.search as never }).then(() => {
      if (link.focusId) requestAnimationFrame(() => document.getElementById(link.focusId!)?.focus())
    })
  }
}
