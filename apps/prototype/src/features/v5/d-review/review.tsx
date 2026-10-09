/**
 * S6 Review (slice D): frame review inside a run's Review step, and Review
 * all across a run group's panels (D-W13, D-W14, D-W22, D-W40, D-W42,
 * D-W53, D-W54, D-W15). v4's frame-review components are kept for this
 * slice under `src/features/t3/` (frames-area, frame-preview, raster,
 * measure, measurement-plot, csv, import-dialog), adapted to runs: see
 * `src/features/t3/frames-area.tsx`. Foundation placeholder; slice D
 * replaces this file.
 */
import { PlaceholderPage } from "@/components/app/page"
import { SCREENS } from "@/app/screens"
import { groupPipeline, workingContent } from "@/domain/derive"
import { runSummary } from "@/domain/membership"
import { useStore } from "@/store/core"

export function ReviewStep({ runId }: { runId: string }) {
  const state = useStore((s) => s)
  const run = state.catalog.runs[runId]
  const content = run ? workingContent(run) : null
  const summary = content ? runSummary(state.disk, state.catalog, content) : null
  return (
    <PlaceholderPage
      screen={SCREENS.S6}
      level={2}
      facts={summary ? [{ label: "Frames", value: `${summary.included.frames} included · ${summary.unreviewed} unreviewed · ${summary.rejected} rejected · ${summary.excluded} excluded` }] : []}
    />
  )
}

export function GroupReviewStep({ groupId }: { groupId: string }) {
  const state = useStore((s) => s)
  const group = state.catalog.runGroups[groupId]
  const panels = group ? groupPipeline(state, group).panels.filter((p) => !p.trashed) : []
  return <PlaceholderPage screen={{ ...SCREENS.S6, title: "Review all" }} level={2} facts={[{ label: "Panels", value: `${panels.length} outside the Trash, with a Panel column and a Panel filter` }]} />
}
