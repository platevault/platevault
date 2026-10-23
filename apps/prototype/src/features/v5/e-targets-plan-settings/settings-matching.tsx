/**
 * Settings › Matching, `/settings/matching` (slice E; D-W114, PRJ-FR-31,
 * CAL-FR-19 to CAL-FR-21; its own page beside Equipment, the owner's answer
 * of 2026-10-23): the framing tolerances that split sessions and group them
 * in a Project (the centre limit an angle in arcminutes; import review starts
 * from these and can override them for one import), and the flat, dark and
 * bias windows and warning levels calibration matching uses. The page is one
 * table, setting · value · unit, grouped by subject; its one Edit… opens one
 * dialog for all of them, so a half-typed number is never matched against.
 * Saving re-matches every kind still waiting or suggested; a pin or a No never
 * changes, and a lower bound past its upper one is refused
 * (`setMatchingSettings`).
 */
import { Pencil } from "lucide-react"
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import type { Action, Column } from "@/components/app/contracts"
import { DataTable } from "@/components/app/data-table"
import { FieldGroup, NumberField } from "@/components/app/fields"
import { blockedByErrors, type FieldErrors, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { SettingsPage } from "@/components/templates/settings-page"
import type { MatchingSettings } from "@/domain/types"
import { formatDecimal } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { setMatchingSettings } from "@/store/actions/settings"
import { useStore } from "@/store/core"

/** One number per threshold, null while the field is empty. */
interface MatchingForm {
  overlapPct: number | null
  centreArcmin: number | null
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
    centreArcmin: s.framing.centreArcmin,
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

/** What a threshold is about: the page's groups and the dialog's field groups, in this order. */
type Subject = "framing" | "flats" | "darks" | "bias"
const SUBJECTS: readonly Subject[] = ["framing", "flats", "darks", "bias"]

function subjectLabel(m: Messages, subject: Subject): string {
  if (subject === "framing") return m.equipment_matching_framing()
  if (subject === "flats") return m.calibration_heading_flats()
  if (subject === "darks") return m.calibration_heading_darks()
  return m.calibration_heading_bias()
}

/** One threshold as the table row and the dialog field both show it: its subject, label, unit and the field's step. */
interface Threshold {
  key: keyof MatchingForm
  subject: Subject
  label: (m: Messages) => string
  unit: (m: Messages) => string
  step: number
}

const percent = () => "%"
const arcmin = () => "′"
const degrees = () => "°"
const celsius = () => "°C"
const nights = (m: Messages) => m.equipment_unit_nights()
const days = (m: Messages) => m.calibration_unit_days()

const THRESHOLDS: readonly Threshold[] = [
  { key: "overlapPct", subject: "framing", label: (m) => m.equipment_matching_overlap(), unit: percent, step: 1 },
  { key: "centreArcmin", subject: "framing", label: (m) => m.equipment_matching_centre(), unit: arcmin, step: 0.5 },
  { key: "rotationDeg", subject: "framing", label: (m) => m.equipment_matching_rotation(), unit: degrees, step: 0.5 },
  { key: "panelOverlapMinPct", subject: "framing", label: (m) => m.equipment_matching_panel_min(), unit: percent, step: 1 },
  { key: "panelOverlapMaxPct", subject: "framing", label: (m) => m.equipment_matching_panel_max(), unit: percent, step: 1 },
  { key: "flatFineDeg", subject: "flats", label: (m) => m.equipment_matching_flat_fine(), unit: degrees, step: 0.5 },
  { key: "flatWarnDeg", subject: "flats", label: (m) => m.equipment_matching_flat_warn(), unit: degrees, step: 0.5 },
  { key: "flatWindowNights", subject: "flats", label: (m) => m.equipment_matching_window_nights(), unit: nights, step: 1 },
  { key: "darkWindowDays", subject: "darks", label: (m) => m.equipment_matching_window_days(), unit: days, step: 1 },
  { key: "darkTemperatureWarnC", subject: "darks", label: (m) => m.equipment_matching_temperature(), unit: celsius, step: 0.5 },
  { key: "biasWindowDays", subject: "bias", label: (m) => m.equipment_matching_window_days(), unit: days, step: 1 },
  { key: "biasTemperatureWarnC", subject: "bias", label: (m) => m.equipment_matching_temperature(), unit: celsius, step: 0.5 },
]

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
        framing: { overlapPct: values.overlapPct ?? undefined, centreArcmin: values.centreArcmin ?? undefined, rotationDeg: values.rotationDeg ?? undefined, panelOverlapMinPct: values.panelOverlapMinPct ?? undefined, panelOverlapMaxPct: values.panelOverlapMaxPct ?? undefined },
        flats: { fineDeg: values.flatFineDeg ?? undefined, warnDeg: values.flatWarnDeg ?? undefined, windowNights: values.flatWindowNights ?? undefined },
        darks: { windowDays: values.darkWindowDays ?? undefined, temperatureWarnC: values.darkTemperatureWarnC ?? undefined },
        bias: { windowDays: values.biasWindowDays ?? undefined, temperatureWarnC: values.biasTemperatureWarnC ?? undefined },
      }),
  }
  return (
    <FormDialog open={open} onOpenChange={(next) => !next && onClose()} title={m.settings_label_matching()} size="lg" confirm={confirm}>
      {SUBJECTS.map((subject) => (
        <FieldGroup key={subject} label={subjectLabel(m, subject)}>
          {THRESHOLDS.filter((t) => t.subject === subject).map((t) => (
            <NumberField key={t.key} label={t.label(m)} unit={t.unit(m)} value={values[t.key]} min={0} step={t.step} onChange={(value) => set({ [t.key]: value } as Partial<MatchingForm>)} error={shown(errors, t.key)} />
          ))}
        </FieldGroup>
      ))}
    </FormDialog>
  )
}

export function MatchingSettingsPage() {
  const m = useMessages()
  const matching = useStore((s) => s.settings.matching)
  const [editing, setEditing] = useState(false)
  const edit: Action = { id: "edit-matching", label: m.settings_edit(), icon: Pencil, opensDialog: true, run: () => setEditing(true) }
  const values = formOf(matching)
  const columns: Column<Threshold>[] = [
    { id: "setting", header: m.settings_matching_col_setting(), rowHeader: true, static: true, cell: (t) => t.label(m) },
    { id: "value", header: m.settings_matching_col_value(), align: "right", static: true, cell: (t) => num(values[t.key] ?? 0) },
    { id: "unit", header: m.settings_matching_col_unit(), static: true, cell: (t) => t.unit(m) },
  ]
  return (
    <SettingsPage title={m.settings_matching()} actions={<ActionButton action={edit} />}>
      <DataTable<Threshold>
        label={m.settings_label_matching()}
        rows={[...THRESHOLDS]}
        columns={columns}
        getRowId={(t) => t.key}
        scroll="none"
        groups={{ key: (t) => t.subject, label: (key) => subjectLabel(m, key as Subject), compare: (a, b) => SUBJECTS.indexOf(a as Subject) - SUBJECTS.indexOf(b as Subject) }}
      />
      <MatchingDialog open={editing} onClose={() => setEditing(false)} />
    </SettingsPage>
  )
}
