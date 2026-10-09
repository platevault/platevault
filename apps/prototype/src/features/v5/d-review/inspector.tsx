/**
 * Review inspector (D-W13, D-W15, D-W42, PIX-FR-02, PIX-FR-05, PIX-FR-06):
 * the current frame's display name and full path, both quality levels with
 * their marks (library only in a session review), the histogram of its
 * displayed region, and tabs for its measured values with their sources,
 * detected stars with cutouts, and the header. The corners at 1:1 live on
 * the stage (`corners.tsx`).
 */
import { Link } from "@tanstack/react-router"
import { Sparkles, X } from "lucide-react"
import { HelpTip } from "@/components/app/tips"
import { PathText } from "@/components/app/data"
import { Button } from "@/components/ui/button"
import { Kbd } from "@/components/ui/kbd"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Toggle } from "@/components/ui/toggle"
import { pixelScaleFor } from "@/domain/membership"
import type { Catalog, FrameMeasurement } from "@/domain/types"
import { HeaderDetails, MetricTable, StarDetail } from "@/features/t3/frame-preview"
import { detectedStars, type StarField, type StarRecord, type ViewWindow } from "@/features/t3/raster"
import { cn } from "@/lib/utils"
import type { ReviewFrame, ReviewScope } from "./model"
import { HistogramView } from "./preview"
import { MEMBER_WORD, QualityLabel } from "./quality"

export interface InspectorActions {
  mark: (value: "usable" | "unusable" | "unreviewed") => void
  projectReject: () => void
  clearProjectReject: () => void
}

export function Inspector({
  scope,
  frame,
  name,
  catalog,
  field,
  window,
  starsOn,
  onStarsOn,
  star,
  onStar,
  tab,
  onTab,
  targets,
  actions,
  overlay = false,
  onClose,
}: {
  scope: ReviewScope
  frame: ReviewFrame
  name: string
  catalog: Catalog
  field: StarField | null
  window: ViewWindow | null
  starsOn: boolean
  onStarsOn: (on: boolean) => void
  star: StarRecord | null
  onStar: (star: StarRecord) => void
  tab: string
  onTab: (tab: string) => void
  /** How many frames a mark applies to: the selection when it holds more than one. */
  targets: number
  actions: InspectorActions
  /** Under 1000 px of pane the inspector opens over the preview instead of beside it. */
  overlay?: boolean
  onClose?: () => void
}) {
  const record: FrameMeasurement | undefined = catalog.measurements[frame.asset.id]
  const applies = frame.measure === "measured"
  const disabled = scope.readOnlyReason
  const plural = targets > 1 ? ` ${targets} frames` : ""
  const stars = field ? detectedStars(field) : []
  return (
    <aside
      aria-label="Frame inspector"
      className={cn(
        "flex min-h-0 shrink-0 flex-col overflow-y-auto border-l border-separator bg-background",
        overlay ? "absolute inset-y-0 right-0 z-20 w-[min(19rem,100%)] shadow-lg" : "w-[19rem]",
      )}
    >
      <div className="space-y-2 border-b border-separator px-3 py-2">
        <div className="flex min-w-0 items-start gap-2">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-semibold" title={frame.asset.copies[0]?.path}>
              {name}
            </h2>
            <ul className="mt-0.5 space-y-0.5 text-xs text-muted-foreground">
              {frame.asset.copies.map((c) => (
                <li key={`${c.volumeId}${c.path}`} className="min-w-0">
                  <span>{catalog.locations[c.locationId]?.displayName ?? "Unknown location"}: </span>
                  <PathText path={c.path} className="inline" />
                </li>
              ))}
            </ul>
          </div>
          {onClose ? (
            <Button size="icon-sm" variant="ghost" aria-label="Close the inspector (I)" onClick={onClose}>
              <X aria-hidden="true" />
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
          <QualityLabel frame={frame} />
          {frame.member ? <span className="text-muted-foreground">In run: {MEMBER_WORD[frame.member]}</span> : null}
          {frame.panel && frame.run ? (
            <Link to="/projects/$projectId/runs/$runId/$step" params={{ projectId: frame.run.projectId, runId: frame.run.id, step: "review" }} className="text-link hover:underline">
              Panel {frame.panel.n} run
            </Link>
          ) : null}
          {frame.subject ? <span className="text-muted-foreground">Subject: {frame.subject}</span> : null}
        </div>
        <div className="grid grid-cols-3 gap-1" role="group" aria-label={`Library quality${plural}`}>
          {(
            [
              ["usable", "Picked", "P"],
              ["unusable", "Rejected", "X"],
              ["unreviewed", "Unreviewed", "U"],
            ] as const
          ).map(([value, label, key]) => (
            <Button
              key={value}
              size="xs"
              className="justify-between px-1.5"
              variant={frame.quality.library === value && targets <= 1 ? "secondary" : "outline"}
              aria-pressed={targets <= 1 ? frame.quality.library === value : undefined}
              disabled={disabled !== null}
              title={disabled ?? undefined}
              onClick={() => actions.mark(value)}
            >
              {label}
              <Kbd>{key}</Kbd>
            </Button>
          ))}
        </div>
        {scope.project ? (
          <div className="flex flex-wrap items-center gap-2">
            {frame.rejectedBy.project && targets <= 1 ? (
              <Button size="xs" variant="ghost" disabled={disabled !== null} onClick={actions.clearProjectReject}>
                Clear Project reject
              </Button>
            ) : (
              <Button size="xs" variant="ghost" disabled={disabled !== null} onClick={actions.projectReject}>
                Reject for this Project{plural ? `:${plural}` : ""}
              </Button>
            )}
            <HelpTip label="Mark scope">P, X and U mark the library, in every Project. A Project reject stays in this Project.</HelpTip>
          </div>
        ) : null}
      </div>
      <div className="border-b border-separator px-3 py-2">{field && window ? <HistogramView field={field} window={window} /> : <p className="text-xs text-muted-foreground">No pixels</p>}</div>
      <Tabs value={tab === "regions" ? "values" : tab} onValueChange={(v) => onTab(String(v))} className="gap-0">
        <TabsList variant="line" className="w-full shrink-0 justify-start border-b border-separator px-2">
          <TabsTrigger value="values">Values</TabsTrigger>
          <TabsTrigger value="stars">Stars</TabsTrigger>
          <TabsTrigger value="header">Header</TabsTrigger>
        </TabsList>
        <TabsContent value="values" className="px-3 py-2">
          <MetricTable record={record} state={frame.measure} applies={applies} sha256={frame.asset.sha256} />
        </TabsContent>
        <TabsContent value="stars" className="space-y-2 px-3 py-2">
          {field ? (
            <>
              <Toggle variant="outline" size="sm" pressed={starsOn} onPressedChange={onStarsOn}>
                <Sparkles aria-hidden="true" data-icon="inline-start" />
                Show stars
              </Toggle>
              <ul className="max-h-36 overflow-y-auto rounded-md border text-xs" aria-label={`Detected stars, ${stars.length} brightest`}>
                {stars.map((s) => (
                  <li key={s.id} className={cn("border-b last:border-0", s.id === star?.id && "bg-accent")}>
                    <button type="button" className="flex w-full justify-between gap-2 px-2 py-0.5 text-left tabular-nums hover:bg-foreground/[0.05]" aria-current={s.id === star?.id ? "true" : undefined} onClick={() => onStar(s)}>
                      <span>Star {s.id}</span>
                      <span className="text-muted-foreground">
                        {s.x}, {s.y}
                      </span>
                      <span className={s.state === "failed" ? "text-warning" : undefined}>{s.state === "failed" ? "Failed fit" : `${s.fwhmPx} px`}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {star ? <StarDetail field={field} star={star} scaleArcsec={pixelScaleFor(catalog, frame.session)} /> : null}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">No pixels</p>
          )}
        </TabsContent>
        <TabsContent value="header" className="px-3 py-2">
          <HeaderDetails header={frame.asset.observed} />
        </TabsContent>
      </Tabs>
    </aside>
  )
}
