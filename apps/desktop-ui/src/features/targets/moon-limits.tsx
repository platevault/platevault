/**
 * Moon limits… (PLAN-FR-02, C6): one Moon-avoidance curve per filter. A
 * curve keeps the Moon its separation from the Target at full Moon, half
 * that `widthDays` before or after full, and less as it thins; the library
 * grades every band and computes Img time with these curves. The dialog
 * edits the curves of the workflow settings at the revision it read
 * (`workflow_settings_save`); a stale revision is refused as `conflict`, the
 * settings and every planning read are read again, and the next Save names
 * the revision read now.
 */
import { useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { type Band, library, type MoonAvoidance, type MoonAvoidanceCurve, type WorkflowSettingsRecord_Serialize } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { KeyValueList } from "@/components/app/data"
import { NumberField, SelectField } from "@/components/app/fields"
import { type FieldErrors, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { numberText } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { targetsWrite } from "./queries"
import { BANDS } from "./targets-model"

/** The library's ranges for a curve (`MoonAvoidanceCurve`). */
const DISTANCE = { min: 0, max: 180 }
const WIDTH = { min: 0.5, max: 30 }

type CurveField = "distanceDeg" | "widthDays"

function curveErrors(m: Messages, curve: MoonAvoidanceCurve): FieldErrors<CurveField> {
  const { distanceDeg: d, widthDays: w } = curve
  return {
    distanceDeg: d !== null && d >= DISTANCE.min && d <= DISTANCE.max ? undefined : m.targets_curve_distance_range(),
    widthDays: w !== null && w >= WIDTH.min && w <= WIDTH.max ? undefined : m.targets_curve_width_range(),
  }
}

/** The first band whose curve is incomplete or out of range. */
function firstInvalid(m: Messages, curves: MoonAvoidance): Band | null {
  return BANDS.find((b) => Object.values(curveErrors(m, curves[b])).some(Boolean)) ?? null
}

/** "Moon ≥ 120° at full · 7 d", or "–" for an incomplete curve. */
function curveText(m: Messages, curve: MoonAvoidanceCurve): string {
  if (curve.distanceDeg === null || curve.widthDays === null) return "–"
  return m.tonight_avoidance({ separation: numberText(curve.distanceDeg), width: numberText(curve.widthDays) })
}

export function MoonLimitsDialog({ record, open, onOpenChange }: { record: WorkflowSettingsRecord_Serialize; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const [band, setBand] = useState<Band>("L")
  const { values, set } = useDialogForm<MoonAvoidance>(open, () => record.settings.moonAvoidance)
  const current = values[band]
  const errors = curveErrors(m, current)
  const invalid = firstInvalid(m, values)
  const label = m.settings_save()
  const edit = (patch: Partial<MoonAvoidanceCurve>) => set({ [band]: { ...current, ...patch } })
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.tonight_moon_limits()}
      confirm={{
        id: "moon-limits-save",
        label,
        kind: "primary",
        unavailable: invalid ? { action: m.actions_blocked({ action: label }), reason: m.tonight_curve_incomplete({ band: invalid }), blockers: [] } : undefined,
        run: () => targetsWrite(client, () => library.workflowSettingsSave({ ...record.settings, moonAvoidance: values }, record.revision)),
      }}
    >
      <SelectField label={m.tonight_filter()} value={band} options={BANDS.map((b) => ({ value: b, label: b }))} onChange={setBand} />
      <NumberField
        label={m.tonight_curve_separation()}
        unit={m.criteria_unit_degrees()}
        min={DISTANCE.min}
        max={DISTANCE.max}
        step={1}
        value={current.distanceDeg}
        onChange={(distanceDeg) => edit({ distanceDeg })}
        error={errors.distanceDeg}
      />
      <NumberField
        label={m.tonight_curve_width()}
        unit={m.tonight_curve_days_unit()}
        min={WIDTH.min}
        max={WIDTH.max}
        step={0.5}
        value={current.widthDays}
        onChange={(widthDays) => edit({ widthDays })}
        error={errors.widthDays}
      />
      <KeyValueList items={BANDS.map((b) => ({ label: b, value: curveText(m, values[b]) }))} />
    </FormDialog>
  )
}
