/**
 * Pipeline presentation (Harness V3, from direction C): the View areas as an
 * ordered rail of stages with their gate, a compact stage strip for lists,
 * and the one Next action. Gate states pair an icon with a word; colour is
 * never the only signal.
 */
import { Link } from "@tanstack/react-router"
import { ArrowRight, CircleCheck, CircleDashed, CircleDot, Loader, OctagonAlert, type LucideIcon } from "lucide-react"
import type { ReactNode } from "react"
import { GATE_LABEL, type GateState, type Pipeline, type Stage, type StageId } from "@/app/pipeline"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export const GATE_ICON: Record<GateState, LucideIcon> = {
  done: CircleCheck,
  ready: ArrowRight,
  blocked: OctagonAlert,
  running: Loader,
  advisory: CircleDot,
  waiting: CircleDashed,
}

export const GATE_TONE: Record<GateState, string> = {
  done: "text-success",
  ready: "text-primary",
  blocked: "text-destructive",
  running: "text-info",
  advisory: "text-warning",
  waiting: "text-muted-foreground",
}

export function GateIcon({ state, className }: { state: GateState; className?: string }) {
  const Icon = GATE_ICON[state]
  return <Icon aria-hidden="true" className={cn("size-3.5 shrink-0", GATE_TONE[state], state === "running" && "motion-safe:animate-spin", className)} />
}

/**
 * The View areas nav as the pipeline rail: Sessions → Frames → Calibration →
 * Prepare → Results → Cleanup. Each link's name is the area name; its gate
 * (state word and finding) is the link's description, shown beside it.
 */
export function PipelineRail({ viewId, pipeline, active }: { viewId: string; pipeline: Pipeline; active: StageId | null }) {
  return (
    <nav aria-label="View areas" className="border-b bg-pane" data-chrome>
      <ol className="flex min-w-0 overflow-x-auto [scrollbar-width:thin]">
        {pipeline.stages.map((stage, index) => (
          <RailStage key={stage.id} viewId={viewId} stage={stage} index={index} active={active === stage.id} current={pipeline.current === stage.id} last={index === pipeline.stages.length - 1} />
        ))}
      </ol>
    </nav>
  )
}

function RailStage({ viewId, stage, index, active, current, last }: { viewId: string; stage: Stage; index: number; active: boolean; current: boolean; last: boolean }) {
  const gateId = `rail-${stage.id}-gate`
  return (
    <li
      className={cn(
        "relative flex min-w-[8.5rem] flex-1 items-center gap-2 border-r px-3 py-1.5 last:border-r-0",
        active ? "bg-background shadow-[inset_0_-2px_0_var(--primary)]" : "hover:bg-accent/50",
      )}
    >
      <GateIcon state={stage.state} />
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-1.5">
          <span aria-hidden="true" className="text-xs text-muted-foreground tabular-nums">
            {index + 1}
          </span>
          <Link
            to={`/views/$viewId/${stage.id}`}
            params={{ viewId }}
            aria-current={active ? "page" : undefined}
            aria-describedby={gateId}
            className={cn("text-sm after:absolute after:inset-0 after:content-['']", active || current ? "font-semibold text-foreground" : "text-foreground/90")}
          >
            {stage.label}
          </Link>
        </div>
        <p id={gateId} className="truncate text-xs text-muted-foreground" title={`${GATE_LABEL[stage.state]}: ${stage.gate}`}>
          <span className={cn("font-medium", GATE_TONE[stage.state])}>{GATE_LABEL[stage.state]}</span> · {stage.gate}
        </p>
      </div>
      {last ? null : <span aria-hidden="true" className="pointer-events-none absolute top-1/2 -right-[5px] z-10 size-2.5 -translate-y-1/2 rotate-45 border-t border-r bg-inherit" />}
    </li>
  )
}

/** Six-segment stage strip for list rows: where a View stands, at a glance. */
export function StageStrip({ pipeline, className }: { pipeline: Pipeline; className?: string }) {
  const index = pipeline.stages.findIndex((s) => s.id === pipeline.current)
  const stage = pipeline.stages[index] ?? pipeline.stages[0]!
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span aria-hidden="true" className="flex gap-0.5">
        {pipeline.stages.map((s) => (
          <span
            key={s.id}
            className={cn(
              "h-2 w-3 rounded-[2px]",
              s.state === "done" && "bg-success/80",
              s.state === "ready" && "bg-primary",
              s.state === "blocked" && "bg-destructive",
              s.state === "running" && "bg-info motion-safe:animate-pulse",
              s.state === "advisory" && "bg-warning/80",
              s.state === "waiting" && "bg-foreground/15",
              s.id === pipeline.current && "ring-1 ring-foreground/60 ring-offset-1 ring-offset-background",
            )}
          />
        ))}
      </span>
      <span className="text-sm">
        <span className="sr-only">
          Stage {index + 1} of {pipeline.stages.length}:{" "}
        </span>
        {stage.label}
        <span className="text-muted-foreground"> · {GATE_LABEL[stage.state]}</span>
      </span>
    </span>
  )
}

/**
 * The one Next action, docked at the bottom of the View pane (C's action
 * bar). It routes to the area that owns the control; it never acts itself.
 */
export function NextActionBar({ pipeline, extra }: { pipeline: Pipeline; extra?: ReactNode }) {
  const next = pipeline.next
  return (
    <div role="region" aria-label="Next action" className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t bg-pane px-4 py-1" data-chrome>
      {next ? (
        <>
          <GateIcon state={pipeline.stages.find((s) => s.id === next.stage)?.state ?? "ready"} />
          <p className="min-w-0 flex-1 text-sm">
            <span className="font-medium">Next action</span>
            <span className="text-muted-foreground">
              {" "}
              · {pipeline.stages.find((s) => s.id === next.stage)?.label}: {next.reason}
            </span>
          </p>
          {extra}
          <Button size="sm" render={<Link to={next.to} />}>
            Next: {next.label}
          </Button>
        </>
      ) : (
        <p className="min-w-0 flex-1 text-sm text-muted-foreground">Nothing is waiting in this View.</p>
      )}
    </div>
  )
}
