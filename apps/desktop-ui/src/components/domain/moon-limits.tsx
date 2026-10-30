/**
 * Moon limits… (PLAN-FR-02, C6): one Moon-avoidance curve per filter. A
 * curve keeps the Moon its separation from the Target at full Moon, half
 * that `widthDays` before or after full, and less as it thins; the library
 * grades every band and computes Img time with these curves. Targets and
 * Settings › Matching open the dialog over the workflow settings they read;
 * the host's `save` writes the edited curves at that revision
 * (`workflow_settings_save`). A stale revision is refused as `conflict`, the
 * host reads the settings again, and the next Save names the revision read
 * now.
 */
import { useState } from "react"
import type { ActionResult, Band, MoonAvoidance, MoonAvoidanceCurve, WorkflowSettingsRecord_Serialize } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { KeyValueList } from "@/components/app/data"
import { NumberField, SelectField } from "@/components/app/fields"
import { type FieldErrors, type FieldPaths, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { numberText } from "@/lib/format"
import type { Messages } from "@/lib/i18n"

/** The bands the workflow settings hold a curve for, in `Band` order. */
export const MOON_BANDS = ["L", "R", "G", "B", "Ha", "SII", "OIII"] as const satisfies readonly (keyof MoonAvoidance & Band)[]

/**
 * The library's ranges for a curve, as `MoonAvoidanceCurve` validates them in
 * crates/platevault-model/src/workflow_settings.rs: distance in [0, 180]
 * degrees, width in [0.5, 30] days.
 */
const DISTANCE = { min: 0, max: 180 }
const WIDTH = { min: 0.5, max: 30 }

type CurveField = "distanceDeg" | "widthDays"
type MoonField = `${Band}.${CurveField}`

function curveErrors(m: Messages, curve: MoonAvoidanceCurve, prefix = ""): FieldErrors<CurveField | MoonField> {
  const { distanceDeg: d, widthDays: w } = curve
  return {
    [`${prefix}distanceDeg`]: d !== null && d >= DISTANCE.min && d <= DISTANCE.max ? undefined : m.targets_curve_distance_range(),
    [`${prefix}widthDays`]: w !== null && w >= WIDTH.min && w <= WIDTH.max ? undefined : m.targets_curve_width_range(),
  }
}

/** The first band whose curve is incomplete or out of range. */
function firstInvalid(m: Messages, curves: MoonAvoidance): Band | null {
  return MOON_BANDS.find((b) => Object.values(curveErrors(m, curves[b])).some(Boolean)) ?? null
}
export function curveText(m: Messages, curve: MoonAvoidanceCurve): string {
  if (curve.distanceDeg === null || curve.widthDays === null) return "–"
  return m.tonight_avoidance({ separation: numberText(curve.distanceDeg), width: numberText(curve.widthDays) })
}

export interface MoonLimitsDialogProps {
  record: WorkflowSettingsRecord_Serialize
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Writes the edited curves over `record`'s settings at its revision, through the host's refresh. */
  save: (moonAvoidance: MoonAvoidance) => Promise<ActionResult<unknown>>
}

export function MoonLimitsDialog({ record, open, onOpenChange, save }: MoonLimitsDialogProps) {
  const m = useMessages()
  const [band, setBand] = useState<Band>("L")
  const { values, set, shown, refusing } = useDialogForm<MoonAvoidance, MoonField>(open, () => record.settings.moonAvoidance)
  const current = values[band]
  const errors = curveErrors(m, current, `${band}.`)
  const invalid = firstInvalid(m, values)
  const label = m.settings_save()
  const edit = (patch: Partial<MoonAvoidanceCurve>) => set({ [band]: { ...current, ...patch } }, [`${band}.distanceDeg`, `${band}.widthDays`])
  const paths: FieldPaths<MoonField> = {
    "L.distanceDeg": "moonAvoidance.L.distanceDeg", "L.widthDays": "moonAvoidance.L.widthDays",
    "R.distanceDeg": "moonAvoidance.R.distanceDeg", "R.widthDays": "moonAvoidance.R.widthDays",
    "G.distanceDeg": "moonAvoidance.G.distanceDeg", "G.widthDays": "moonAvoidance.G.widthDays",
    "B.distanceDeg": "moonAvoidance.B.distanceDeg", "B.widthDays": "moonAvoidance.B.widthDays",
    "Ha.distanceDeg": "moonAvoidance.Ha.distanceDeg", "Ha.widthDays": "moonAvoidance.Ha.widthDays",
    "SII.distanceDeg": "moonAvoidance.SII.distanceDeg", "SII.widthDays": "moonAvoidance.SII.widthDays",
    "OIII.distanceDeg": "moonAvoidance.OIII.distanceDeg", "OIII.widthDays": "moonAvoidance.OIII.widthDays",
  }
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
        run: () => refusing(save(values), paths),
      }}
    >
      <SelectField label={m.tonight_filter()} value={band} options={MOON_BANDS.map((b) => ({ value: b, label: b }))} onChange={setBand} />
      <NumberField
        label={m.tonight_curve_separation()}
        unit={m.criteria_unit_degrees()}
        min={DISTANCE.min}
        max={DISTANCE.max}
        step={1}
        value={current.distanceDeg}
        onChange={(distanceDeg) => edit({ distanceDeg })}
        error={shown(errors, `${band}.distanceDeg`)}
      />
      <NumberField
        label={m.tonight_curve_width()}
        unit={m.tonight_curve_days_unit()}
        min={WIDTH.min}
        max={WIDTH.max}
        step={0.5}
        value={current.widthDays}
        onChange={(widthDays) => edit({ widthDays })}
        error={shown(errors, `${band}.widthDays`)}
      />
      <KeyValueList items={MOON_BANDS.map((b) => ({ label: b, value: curveText(m, values[b]) }))} />
    </FormDialog>
  )
}
