/**
 * The source-list outline (foundation-owned; HARNESS-V5-IA.md § Source
 * list). When a Project is open, its outline sits under Projects: subjects,
 * runs and run groups (each with its current step glyph) and Trash with a
 * count. When a run or run group is open, its six steps appear under it
 * with their gate glyph and short status: v4's pipeline navigator, moved to
 * the run. The step that holds Next carries an accent edge.
 */
import { Link, useRouterState } from "@tanstack/react-router"
import { Trash2 } from "lucide-react"
import { useMemo } from "react"
import {
  GATE_LABEL,
  groupPipeline,
  projectGroups,
  projectRuns,
  projectTrash,
  runPipeline,
  type RunStepState,
  subjectName,
} from "@/domain/derive"
import type { RunStep } from "@/domain/types"
import { cn } from "@/lib/utils"
import { type PrototypeState, useStore } from "@/store/core"
import { StepGlyph } from "./run-ui"

export interface ActiveRoute {
  pathname: string
  projectId: string | null
  runId: string | null
  groupId: string | null
  step: RunStep | null
}

/** Which Project, run or group the current route opens. */
export function useActiveRoute(): ActiveRoute {
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  return useMemo(() => {
    const project = pathname.match(/^\/projects\/([^/]+)/)?.[1] ?? null
    const run = pathname.match(/^\/projects\/[^/]+\/runs\/([^/]+)(?:\/([^/]+))?/)
    const group = pathname.match(/^\/projects\/[^/]+\/groups\/([^/]+)(?:\/([^/]+))?/)
    return {
      pathname,
      projectId: project,
      runId: run?.[1] ?? null,
      groupId: group?.[1] ?? null,
      step: ((run?.[2] ?? group?.[2]) as RunStep | undefined) ?? null,
    }
  }, [pathname])
}

const ROW = "flex h-6 items-center gap-1.5 rounded-[0.3125rem] px-1.5 text-[0.75rem] hover:bg-sidebar-accent"

function StepRows({ steps, here, nextId, label }: { steps: RunStepState[]; here: RunStep | null; nextId: RunStep | null; label: string }) {
  return (
    <ol aria-label={label} className="ml-2 space-y-px border-l border-sidebar-border pl-1">
      {steps.map((step) => (
        <li key={step.id}>
          <Link
            to={step.link.to as never}
            params={step.link.params as never}
            aria-current={here === step.id ? "page" : undefined}
            className={cn(ROW, here === step.id && "bg-sidebar-accent font-medium", nextId === step.id && here !== step.id && "shadow-[inset_2px_0_0_var(--link)]")}
          >
            <span className="w-3 text-right text-muted-foreground tabular-nums">{step.n}</span>
            <StepGlyph state={step.state} />
            <span className="min-w-0 flex-1 truncate">{step.label}</span>
            <span className="max-w-24 truncate text-[0.6875rem] text-muted-foreground">
              <span className="sr-only">{GATE_LABEL[step.state]}: </span>
              {step.status}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  )
}

function OutlineHeading({ children }: { children: string }) {
  return <p className="px-1.5 pt-1.5 pb-0.5 text-[0.6875rem] font-semibold text-muted-foreground">{children}</p>
}

function ProjectOutlineBody({ state, active }: { state: PrototypeState; active: ActiveRoute }) {
  const { catalog } = state
  const project = catalog.projects[active.projectId!]
  if (!project) return null
  const runs = projectRuns(catalog, project.id).filter((r) => !r.groupId)
  const groups = projectGroups(catalog, project.id)
  const trash = projectTrash(catalog, project.id)
  const onProject = active.pathname === `/projects/${project.id}`
  return (
    <div className="mt-0.5 mb-1 ml-3 border-l border-sidebar-border pl-1.5">
      <Link
        to="/projects/$projectId"
        params={{ projectId: project.id }}
        aria-current={onProject ? "page" : undefined}
        className={cn(ROW, "font-semibold", onProject && "bg-sidebar-accent")}
        title={project.name}
      >
        <span className="truncate">{project.name}</span>
      </Link>
      <OutlineHeading>Subjects</OutlineHeading>
      <ul aria-label={`Subjects of ${project.name}`} className="space-y-px">
        {project.subjects.map((subject) => (
          <li key={subject.id} className={cn(ROW, "hover:bg-transparent")}>
            <span className="min-w-0 flex-1 truncate">{subjectName(catalog, subject)}</span>
            {subject.mosaic ? <span className="text-[0.6875rem] text-muted-foreground tabular-nums">{subject.mosaic.panels.length} panels</span> : null}
          </li>
        ))}
      </ul>
      <OutlineHeading>Runs</OutlineHeading>
      <ul aria-label={`Runs of ${project.name}`} className="space-y-px">
        {runs.length === 0 && groups.length === 0 ? <li className={cn(ROW, "text-muted-foreground hover:bg-transparent")}>No runs yet</li> : null}
        {runs.map((run) => {
          const pipeline = runPipeline(state, run)
          const open = active.runId === run.id
          return (
            <li key={run.id}>
              <Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: project.id, runId: run.id, step: pipeline.current.id }} className={cn(ROW, open && !active.step && "bg-sidebar-accent")} title={`${run.name}: ${pipeline.current.label} ${GATE_LABEL[pipeline.current.state]}`}>
                <StepGlyph state={pipeline.current.state} />
                <span className="min-w-0 flex-1 truncate">{run.name}</span>
                <span className="text-[0.6875rem] text-muted-foreground">
                  <span className="sr-only">{GATE_LABEL[pipeline.current.state]} at </span>
                  {pipeline.current.label}
                </span>
              </Link>
              {open ? <StepRows steps={pipeline.steps} here={active.step} nextId={pipeline.next?.step?.id ?? null} label={`Steps of ${run.name}`} /> : null}
            </li>
          )
        })}
        {groups.map((group) => {
          const pipeline = groupPipeline(state, group)
          const groupOpen = active.groupId === group.id
          const open = groupOpen || group.runIds.includes(active.runId ?? "")
          const current = pipeline.next?.step ?? pipeline.steps.at(-1)!
          return (
            <li key={group.id}>
              <Link to="/projects/$projectId/groups/$groupId/$step" params={{ projectId: project.id, groupId: group.id, step: current.id }} className={ROW} title={`${group.name}: ${current.label} ${GATE_LABEL[current.state]}`}>
                <StepGlyph state={current.state} />
                <span className="min-w-0 flex-1 truncate">{group.name}</span>
                <span className="text-[0.6875rem] text-muted-foreground tabular-nums">{pipeline.panels.length} panels</span>
              </Link>
              {groupOpen ? <StepRows steps={pipeline.steps} here={active.step} nextId={pipeline.next?.step?.id ?? null} label={`Steps of ${group.name}`} /> : null}
              {open ? (
                <ul aria-label={`Panels of ${group.name}`} className="ml-2 space-y-px border-l border-sidebar-border pl-1">
                  {pipeline.panels.map((p) => (
                    <li key={p.run.id}>
                      <Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: project.id, runId: p.run.id, step: p.pipeline.current.id }} className={ROW}>
                        <StepGlyph state={p.trashed ? "idle" : p.pipeline.current.state} />
                        <span className="min-w-0 flex-1 truncate">Panel {p.panel.n}</span>
                        <span className="text-[0.6875rem] text-muted-foreground">{p.trashed ? "Trashed" : p.pipeline.current.label}</span>
                      </Link>
                      {active.runId === p.run.id ? <StepRows steps={p.pipeline.steps} here={active.step} nextId={p.pipeline.next?.step?.id ?? null} label={`Steps of ${p.run.name}`} /> : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          )
        })}
      </ul>
      <Link
        to="/projects/$projectId/trash"
        params={{ projectId: project.id }}
        aria-current={active.pathname === `/projects/${project.id}/trash` ? "page" : undefined}
        className={cn(ROW, "mt-1", active.pathname === `/projects/${project.id}/trash` && "bg-sidebar-accent")}
      >
        <Trash2 aria-hidden="true" className="size-3.5 text-muted-foreground" />
        <span className="flex-1">Trash</span>
        <span className="text-[0.6875rem] text-muted-foreground tabular-nums">
          {trash.length}
          <span className="sr-only"> trashed runs</span>
        </span>
      </Link>
    </div>
  )
}

/** The open Project's outline, or nothing outside a Project. */
export function ProjectOutline() {
  const active = useActiveRoute()
  const state = useStore((s) => s)
  if (!active.projectId) return null
  return <ProjectOutlineBody state={state} active={active} />
}
