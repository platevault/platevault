/**
 * Settings › Equipment › Matching thresholds (slice E; D-W114, PRJ-FR-31,
 * CAL-FR-19 to CAL-FR-21): the framing tolerances that split sessions and
 * group them in a Project, and the flat, dark and bias windows and warning
 * levels calibration matching uses. The section reads the values; Edit…
 * opens one dialog for all of them, so a half-typed number is never matched
 * against. Saving re-matches every kind still waiting or suggested; a pin or
 * a No never changes (`setMatchingSettings`).
 */
import { Pencil } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action } from "@/components/app/contracts"
import { FieldGroup, NumberField } from "@/components/app/fields"
import { blockedByErrors, type FieldErrors, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { SettingsRow, SettingsSection } from "@/components/app/settings"
import type { MatchingSettings } from "@/domain/types"
import { formatDecimal } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { setMatchingSettings } from "@/store/actions/settings"
import { useStore } from "@/store/core"

/** One number per threshold, null while the field is empty. */
interface MatchingForm {
  overlapPct: number | null
  centrePct: number | null
  rotationDeg: number | null
  panelOverlapMinPct: number | null
  panelOverlapMaxPct: number | null
  flatFineDeg: number | null
  flatWarnDeg: number | null
  flatWindowNights: number | null
  darkWindowDays: number | null
  darkTemperatureWarnC: number | null
  biasWindowDays: number | null
  biasTemperatureWarnC: number | null
}

function formOf(s: MatchingSettings): MatchingForm {
  return {
    overlapPct: s.framing.overlapPct,
    centrePct: s.framing.centrePct,
    rotationDeg: s.framing.rotationDeg,
    panelOverlapMinPct: s.framing.panelOverlapMinPct,
    panelOverlapMaxPct: s.framing.panelOverlapMaxPct,
    flatFineDeg: s.flats.fineDeg,
    flatWarnDeg: s.flats.warnDeg,
    flatWindowNights: s.flats.windowNights,
    darkWindowDays: s.darks.windowDays,
    darkTemperatureWarnC: s.darks.temperatureWarnC,
    biasWindowDays: s.bias.windowDays,
    biasTemperatureWarnC: s.bias.temperatureWarnC,
  }
}

const num = (value: number) => formatDecimal(value, value % 1 === 0 ? 0 : 1)

function MatchingDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const m = useMessages()
  const current = useStore((s) => s.settings.matching)
  const { values, set, shown } = useDialogForm<MatchingForm>(open, () => formOf(current))
  const errors: FieldErrors<keyof MatchingForm> = Object.fromEntries(Object.entries(values).map(([key, value]) => [key, value === null ? m.common_enter_number() : undefined]))
  const label = m.settings_save()
  const confirm: Action = {
    id: "matching-save",
    label,
    kind: "primary",
    unavailable: blockedByErrors(label, errors),
    run: () =>
      setMatchingSettings({
        framing: { overlapPct: values.overlapPct ?? undefined, centrePct: values.centrePct ?? undefined, rotationDeg: values.rotationDeg ?? undefined, panelOverlapMinPct: values.panelOverlapMinPct ?? undefined, panelOverlapMaxPct: values.panelOverlapMaxPct ?? undefined },
        flats: { fineDeg: values.flatFineDeg ?? undefined, warnDeg: values.flatWarnDeg ?? undefined, windowNights: values.flatWindowNights ?? undefined },
        darks: { windowDays: values.darkWindowDays ?? undefined, temperatureWarnC: values.darkTemperatureWarnC ?? undefined },
        bias: { windowDays: values.biasWindowDays ?? undefined, temperatureWarnC: values.biasTemperatureWarnC ?? undefined },
      }),
  }
  const field = (key: keyof MatchingForm, fieldLabel: string, unit: string, step = 1) => (
    <NumberField key={key} label={fieldLabel} unit={unit} value={values[key]} min={0} step={step} onChange={(value) => set({ [key]: value } as Partial<MatchingForm>)} error={shown(errors, key)} />
  )
  const days = m.calibration_unit_days()
  return (
    <FormDialog open={open} onOpenChange={(next) => !next && onClose()} title={m.settings_label_matching()} size="lg" confirm={confirm}>
      <FieldGroup label={m.equipment_matching_framing()}>
        {field("overlapPct", m.equipment_matching_overlap(), "%")}
        {field("centrePct", m.equipment_matching_centre(), "%")}
        {field("rotationDeg", m.equipment_matching_rotation(), "°")}
        {field("panelOverlapMinPct", m.equipment_matching_panel_min(), "%")}
        {field("panelOverlapMaxPct", m.equipment_matching_panel_max(), "%")}
      </FieldGroup>
      <FieldGroup label={m.calibration_heading_flats()}>
        {field("flatFineDeg", m.equipment_matching_flat_fine(), "°", 0.5)}
        {field("flatWarnDeg", m.equipment_matching_flat_warn(), "°", 0.5)}
        {field("flatWindowNights", m.equipment_matching_window_nights(), m.equipment_unit_nights())}
      </FieldGroup>
      <FieldGroup label={m.calibration_heading_darks()}>
        {field("darkWindowDays", m.equipment_matching_window_days(), days)}
        {field("darkTemperatureWarnC", m.equipment_matching_temperature(), "°C", 0.5)}
      </FieldGroup>
      <FieldGroup label={m.calibration_heading_bias()}>
        {field("biasWindowDays", m.equipment_matching_window_days(), days)}
        {field("biasTemperatureWarnC", m.equipment_matching_temperature(), "°C", 0.5)}
      </FieldGroup>
    </FormDialog>
  )
}

/** The thresholds in effect, one row per kind of matching, each worded as the matcher applies it. */
function summary(m: Messages, s: MatchingSettings): Array<{ label: string; value: string }> {
  const darkLine = (d: MatchingSettings["darks"]) => m.equipment_matching_dark_line({ days: num(d.windowDays), temp: num(d.temperatureWarnC) })
  return [
    {
      label: m.equipment_matching_framing(),
      value: m.equipment_matching_framing_line({ overlap: num(s.framing.overlapPct), centre: num(s.framing.centrePct), rotation: num(s.framing.rotationDeg), min: num(s.framing.panelOverlapMinPct), max: num(s.framing.panelOverlapMaxPct) }),
    },
    { label: m.calibration_heading_flats(), value: m.equipment_matching_flats_line({ fine: num(s.flats.fineDeg), warn: num(s.flats.warnDeg), nights: num(s.flats.windowNights) }) },
    { label: m.calibration_heading_darks(), value: darkLine(s.darks) },
    { label: m.calibration_heading_bias(), value: darkLine(s.bias) },
  ]
}

export function MatchingSection() {
  const m = useMessages()
  const matching = useStore((s) => s.settings.matching)
  const [editing, setEditing] = useState(false)
  const edit: Action = { id: "edit-matching", label: m.settings_edit(), icon: Pencil, opensDialog: true, run: () => setEditing(true) }
  return (
    <>
      <SettingsSection title={m.settings_label_matching()} actions={<ActionButton action={edit} />}>
        {summary(m, matching).map((row) => (
          <SettingsRow key={row.label} label={row.label}>
            {row.value}
          </SettingsRow>
        ))}
      </SettingsSection>
      <MatchingDialog open={editing} onClose={() => setEditing(false)} />
    </>
  )
}
