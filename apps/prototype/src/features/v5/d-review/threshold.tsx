/**
 * Select by threshold (PIX-FR-15): select the shown frames whose built-in
 * value of one metric is above or below a value, or add them to the
 * selection. Frames without that value are never selected, and selecting
 * never changes quality. While the dialog is open the session plots draw
 * the threshold on its metric.
 */
import { useMessages } from "@/app/preferences"
import type { Action } from "@/components/app/contracts"
import { KeyValueList } from "@/components/app/data"
import { NumberField, SelectField, SwitchField } from "@/components/app/fields"
import { FormDialog } from "@/components/app/form-dialog"
import type { MetricKey } from "@/domain/types"
import { formatCount } from "@/lib/format"
import { METRIC_LABEL } from "@/store/actions/measure"
import { PLOT_METRICS, type ReviewFrame } from "./model"

export interface Threshold {
  metric: MetricKey
  direction: "above" | "below"
  value: number | null
  /** Add the matches to the current selection instead of replacing it. */
  add: boolean
}

/** The frames a threshold matches among `frames`, and how many have no value for its metric. */
export function thresholdMatches(frames: readonly ReviewFrame[], t: Threshold): { matches: ReviewFrame[]; missing: number } {
  const missing = frames.filter((f) => f.builtIn[t.metric]?.value == null).length
  if (t.value === null) return { matches: [], missing }
  const value = t.value
  const matches = frames.filter((f) => {
    const v = f.builtIn[t.metric]?.value
    return v !== null && v !== undefined && (t.direction === "above" ? v > value : v < value)
  })
  return { matches, missing }
}

export function ThresholdDialog({
  threshold,
  onThreshold,
  frames,
  onApply,
  onClose,
}: {
  /** Open while non-null. */
  threshold: Threshold | null
  onThreshold: (threshold: Threshold) => void
  /** The frames shown: the matches come from these. */
  frames: readonly ReviewFrame[]
  onApply: (matches: ReviewFrame[], threshold: Threshold) => void
  onClose: () => void
}) {
  const m = useMessages()
  const t = threshold ?? { metric: "fwhm" as MetricKey, direction: "above" as const, value: null, add: false }
  const { matches, missing } = thresholdMatches(frames, t)
  const unit = frames.find((f) => f.builtIn[t.metric])?.builtIn[t.metric]?.unit ?? ""
  const confirm: Action = {
    id: "threshold-select",
    label: m.review_select_frames({ count: matches.length }),
    kind: "primary",
    unavailable: t.value === null ? { action: m.review_select_by_threshold(), reason: m.review_threshold_value_missing(), blockers: [] } : undefined,
    run: () => onApply(matches, t),
  }
  return (
    <FormDialog title={m.review_select_by_threshold()} size="sm" open={threshold !== null} onOpenChange={(open) => (open ? undefined : onClose())} confirm={confirm}>
      <SelectField label={m.review_threshold_metric()} value={t.metric} options={PLOT_METRICS.map((metric) => ({ value: metric, label: METRIC_LABEL[metric] }))} onChange={(metric) => onThreshold({ ...t, metric })} />
      <SelectField
        label={m.review_direction()}
        value={t.direction}
        options={[
          { value: "above", label: m.review_above() },
          { value: "below", label: m.review_below() },
        ]}
        onChange={(direction) => onThreshold({ ...t, direction })}
      />
      <NumberField label={m.review_threshold_value()} unit={unit || undefined} value={t.value} step={0.01} onChange={(value) => onThreshold({ ...t, value })} />
      <SwitchField label={m.review_add_to_selection()} checked={t.add} onChange={(add) => onThreshold({ ...t, add })} />
      <KeyValueList
        items={[
          { label: m.review_threshold_matches(), value: formatCount(matches.length) },
          ...(missing > 0 ? [{ label: m.review_threshold_not_measured(), value: formatCount(missing) }] : []),
        ]}
      />
    </FormDialog>
  )
}
