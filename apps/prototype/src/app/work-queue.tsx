/**
 * Work queue (Harness V3 start page, `/`): every View in progress with the
 * stage it stands in and its one Next action, newest work first. Complete
 * Views follow, for their optional cleanup. The cursor row fills the
 * inspector with that View's gates. See design/HARNESS-V3.md §2 for why
 * the app opens here and not on Targets or tonight's sky.
 */
import { Link } from "@tanstack/react-router"
import { Inbox } from "lucide-react"
import { useMemo, useState } from "react"
import { GATE_LABEL, type Pipeline, viewPipeline } from "@/app/pipeline"
import { EmptyState } from "@/components/app/feedback"
import { PageBody, PageHeader, Section } from "@/components/app/page"
import { Inspector, InspectorSection } from "@/components/app/panes"
import { GateIcon, StageStrip } from "@/components/app/pipeline"
import { Button } from "@/components/ui/button"
import type { View } from "@/domain/types"
import { formatDateTime } from "@/lib/format"
import { cn } from "@/lib/utils"
import { useStore } from "@/store/core"

interface Row {
  view: View
  pipeline: Pipeline
  context: string
  updatedAt: string
}

function QueueTable({ rows, label, cursor, onCursor }: { rows: Row[]; label: string; cursor: string | null; onCursor: (id: string) => void }) {
  return (
    <div className="overflow-x-auto rounded-md border">
      <table className="w-full text-sm">
        <caption className="sr-only">{label}</caption>
        <thead className="bg-card text-xs text-muted-foreground" data-chrome>
          <tr className="h-(--row-h) border-b">
            <th scope="col" className="px-2.5 text-left font-medium">
              View
            </th>
            <th scope="col" className="px-2.5 text-left font-medium">
              Stage
            </th>
            <th scope="col" className="px-2.5 text-left font-medium">
              Next action
            </th>
            <th scope="col" className="px-2.5 text-right font-medium">
              Last change
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ view, pipeline, context, updatedAt }) => (
            <tr
              key={view.id}
              aria-current={cursor === view.id ? "true" : undefined}
              onClick={() => onCursor(view.id)}
              onFocus={() => onCursor(view.id)}
              className={cn(
                "h-(--row-h) border-b border-border/60 last:border-0 even:bg-foreground/[0.025] hover:bg-accent/70",
                "aria-[current=true]:bg-selection aria-[current=true]:shadow-[inset_2px_0_0_var(--primary)]",
              )}
            >
              <th scope="row" className="max-w-80 px-2.5 py-1 text-left font-normal">
                <Link to="/views/$viewId" params={{ viewId: view.id }} className="font-medium hover:underline">
                  {view.name}
                </Link>
                <span className="ml-2 text-xs text-muted-foreground">{context}</span>
              </th>
              <td className="px-2.5 py-1 whitespace-nowrap">
                <StageStrip pipeline={pipeline} />
              </td>
              <td className="px-2.5 py-1">
                {pipeline.next ? (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <Button size="xs" variant="outline" render={<Link to={pipeline.next.to} />}>
                      Next: {pipeline.next.label}
                    </Button>
                    <span className="text-xs text-muted-foreground">{pipeline.next.reason}</span>
                  </span>
                ) : (
                  <span className="text-muted-foreground">Nothing waiting</span>
                )}
              </td>
              <td className="px-2.5 py-1 text-right text-xs whitespace-nowrap text-muted-foreground">{formatDateTime(updatedAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function WorkQueuePage() {
  const catalog = useStore((s) => s.catalog)
  const disk = useStore((s) => s.disk)
  const decisions = useStore((s) => s.slices.t4.decisions)
  const rows = useMemo(() => {
    return Object.values(catalog.views)
      .map((view): Row => {
        const target = view.targetId ? catalog.targets[view.targetId] : null
        const project = view.projectId ? catalog.projects[view.projectId] : null
        return {
          view,
          pipeline: viewPipeline(catalog, disk, view, decisions),
          context: project ? `Project ${project.name}` : target ? target.name : "Standalone",
          updatedAt: view.completedAt ?? view.draft?.updatedAt ?? view.revisions.at(-1)?.savedAt ?? view.createdAt,
        }
      })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }, [catalog, disk, decisions])
  const active = rows.filter((r) => !r.view.completedAt)
  const complete = rows.filter((r) => r.view.completedAt)
  const [cursorId, setCursorId] = useState<string | null>(null)
  const cursor = rows.find((r) => r.view.id === cursorId) ?? active[0] ?? complete[0] ?? null

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader
        title="Work queue"
        description="Views in progress, the stage each one stands in and its one Next action. Targets, Sessions and tonight's Plan are one click away in the sidebar."
        actions={
          <>
            <Button size="sm" variant="outline" render={<Link to="/sessions" />}>
              Open Sessions
            </Button>
            <Button size="sm" render={<Link to="/views/new" />}>
              New View
            </Button>
          </>
        }
      />
      <PageBody>
        {rows.length === 0 ? (
          <EmptyState
            icon={Inbox}
            title="No Views yet"
            description="A View is a named, reviewed set of frames for one processing application. Select sessions to create one; it appears here with its next step."
            action={
              <Button size="sm" render={<Link to="/sessions" />}>
                Select sessions
              </Button>
            }
          />
        ) : (
          <>
            <Section title={`In progress (${active.length})`} id="queue-active">
              {active.length > 0 ? (
                <QueueTable rows={active} label="Views in progress" cursor={cursor?.view.id ?? null} onCursor={setCursorId} />
              ) : (
                <p className="text-sm text-muted-foreground">Every View is complete. Create a View from Sessions to start the next one.</p>
              )}
            </Section>
            {complete.length > 0 ? (
              <Section title={`Complete (${complete.length})`} description="Reopen a View to change it; Cleanup is optional." id="queue-complete">
                <QueueTable rows={complete} label="Complete Views" cursor={cursor?.view.id ?? null} onCursor={setCursorId} />
              </Section>
            ) : null}
          </>
        )}
      </PageBody>
      {cursor ? (
        <Inspector title={cursor.view.name}>
          <InspectorSection title="View">
            <p className="text-sm font-medium">{cursor.view.name}</p>
            <p className="text-xs text-muted-foreground">{cursor.context}</p>
          </InspectorSection>
          <InspectorSection title="Pipeline">
            <ol className="space-y-1.5">
              {cursor.pipeline.stages.map((stage, index) => (
                <li key={stage.id} className="flex gap-2">
                  <GateIcon state={stage.state} className="mt-0.5" />
                  <div className="min-w-0">
                    <Link to={`/views/$viewId/${stage.id}`} params={{ viewId: cursor.view.id }} className="text-sm hover:underline">
                      {index + 1}. {stage.label}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {GATE_LABEL[stage.state]} · {stage.gate}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </InspectorSection>
          {cursor.pipeline.next ? (
            <InspectorSection title="Next action">
              <p className="pb-2 text-xs text-muted-foreground">{cursor.pipeline.next.reason}</p>
              <Button size="sm" render={<Link to={cursor.pipeline.next.to} />}>
                Next: {cursor.pipeline.next.label}
              </Button>
            </InspectorSection>
          ) : null}
        </Inspector>
      ) : null}
    </div>
  )
}
