/**
 * StepPage (L3 template; plan §3.4, §5). The one host of every staged flow
 * with three or more steps or with persistent state: setup, import, session
 * intake, calibration processes, runs, run groups and Wrap up (F9; two-step
 * tasks use FormDialog `steps`).
 *
 * - Header: the path, the title, its StatusBadge and the object menu ("Run ▾"
 *   with Reopen…, Move to Trash…). No header buttons: Proceed in the footer
 *   is the page's one primary (F1), and step operations sit in the step's
 *   own toolbar (F8).
 * - StepStrip under the header, StepFooter fixed at the bottom of the step
 *   pane, and one step region between them that scrolls. Strip, footer and
 *   region keep their heights on every step, so a step change moves nothing.
 * - The step on screen is `viewing` (the route's `$step`). Steps link to
 *   `flow.linkFor`; a flow on local state passes `onSelectStep` instead.
 *   The order rule (C3) is the flow's: read `stepEditable(flow, viewing)` to
 *   make the region read-only.
 */
import type { ReactNode } from "react"
import type { StepFlow } from "@/components/app/contracts"
import type { PageNotice } from "@/components/app/feedback"
import { PageHeader, type PathItem } from "@/components/app/page"
import { StepFooter, StepStrip } from "@/components/app/step-flow"
import { headerActions, headerBar, type ObjectMenu } from "./parts"

export interface StepPageProps {
  path?: PathItem[]
  title: string
  /** 1 for a route's page; 2 for a catalogue specimen. */
  level?: 1 | 2
  status?: ReactNode
  menu?: ObjectMenu
  flow: StepFlow
  /** The step on screen; default the flow's current step. */
  viewing?: string
  /** A flow on local state: the strip's steps become buttons that call this. */
  onSelectStep?: (stepId: string) => void
  /** Names the step strip: "Run steps". Default "Steps". */
  stepsLabel?: string
  notice?: PageNotice | null
  /** The viewed step's one region: a toolbar and a DataTable, or Field rows. */
  step: ReactNode
}

export function StepPage({ path, title, level = 1, status, menu, flow, viewing = flow.current, onSelectStep, stepsLabel, notice, step }: StepPageProps) {
  const viewed = flow.steps.find((item) => item.id === viewing)
  return (
    <div data-template="step" className="flex min-h-0 flex-1 flex-col">
      <PageHeader level={level} path={path} title={title} meta={status} actions={headerActions([], menu)} notice={notice} className={headerBar(level)} />
      <StepStrip flow={flow} viewing={viewing} onSelect={onSelectStep} label={stepsLabel} />
      <section aria-label={viewed?.label} data-step-region="" className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
        {step}
      </section>
      <StepFooter flow={flow} viewing={viewing} />
    </div>
  )
}
