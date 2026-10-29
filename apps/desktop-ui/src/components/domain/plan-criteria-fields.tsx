/**
 * The fields of Home's planning criteria (PLAN-FR-11/12): minimum altitude,
 * darkness, the Moon rule and the shortest window. Home's criteria dialog,
 * setup's Index step and Settings › Sites edit the same `CriteriaDraft`
 * (plan-criteria.ts) through them; no field starts with a value.
 */
import type { Darkness } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { NumberField, SelectField } from "@/components/app/fields"
import type { CriteriaDraft, CriteriaField, MoonKind } from "./plan-criteria"

const DARKNESS: readonly Darkness[] = ["civil", "nautical", "astronomical"]
const MOON: readonly Exclude<MoonKind, "">[] = ["none", "below_horizon", "min_separation"]

<<<<<<< HEAD:apps/desktop-ui/src/components/domain/plan-criteria-fields.tsx
export interface PlanCriteriaFieldsProps {
  values: CriteriaDraft
  set: (patch: Partial<CriteriaDraft>) => void
  /** The message a field shows now: `useDialogForm`'s `shown` over `criteriaErrors`, so a field speaks once the user changed it. */
  errorOf: (field: CriteriaField) => string | undefined
}

export function PlanCriteriaFields({ values, set, errorOf }: PlanCriteriaFieldsProps) {
  const m = useMessages()
=======
/** Each field's path on `PlanCriteria`, the field a library refusal names (`PlanCriteria::validate`). */
const CRITERIA_PATHS: FieldPaths<CriteriaField> = {
  minAltitudeDeg: "minAltitudeDeg",
  darkness: "darkness",
  moon: "moon",
  minSeparationDeg: "moon.minSeparationDeg",
  minDurationMinutes: "minDurationMinutes",
}

export function HomeCriteriaDialog({ record, open, onOpenChange }: { record: HomeCriteria; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const { values, set, shown, refusing } = useDialogForm<CriteriaDraft>(open, () => draftOf(record.criteria))
  const errors = criteriaErrors(m, values)
  const label = m.home_save_criteria()
>>>>>>> 4d37f1364 (feat(library): ErrorResponse names the invalid input field):apps/desktop-ui/src/features/library/criteria-dialog.tsx
  const darkness: Record<Darkness, string> = { civil: m.criteria_darkness_civil(), nautical: m.criteria_darkness_nautical(), astronomical: m.criteria_darkness_astronomical() }
  const moon: Record<Exclude<MoonKind, "">, string> = { none: m.criteria_moon_none(), below_horizon: m.criteria_moon_below_horizon(), min_separation: m.criteria_moon_min_separation() }
  const choose = { value: "" as const, label: m.status_not_set(), disabled: true }
  return (
<<<<<<< HEAD:apps/desktop-ui/src/components/domain/plan-criteria-fields.tsx
    <>
      <NumberField label={m.criteria_min_altitude()} unit={m.criteria_unit_degrees()} min={0} max={89.9} step={1} value={values.minAltitudeDeg} onChange={(minAltitudeDeg) => set({ minAltitudeDeg })} error={errorOf("minAltitudeDeg")} />
=======
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.home_criteria_title()}
      confirm={{
        id: "save-home-criteria",
        label,
        kind: "primary",
        unavailable: blockedByErrors(m, label, errors),
        run: async () => {
          const criteria = criteriaOf(values)
          if (!criteria) return
          return refusing(
            homeWrite(client, () => library.planningSaveHomeCriteria(criteria, record.revision)),
            CRITERIA_PATHS,
          )
        },
      }}
    >
      <NumberField label={m.criteria_min_altitude()} unit={m.criteria_unit_degrees()} min={0} max={89.9} step={1} value={values.minAltitudeDeg} onChange={(minAltitudeDeg) => set({ minAltitudeDeg })} error={shown(errors, "minAltitudeDeg")} />
>>>>>>> 4d37f1364 (feat(library): ErrorResponse names the invalid input field):apps/desktop-ui/src/features/library/criteria-dialog.tsx
      <SelectField
        label={m.criteria_darkness()}
        value={values.darkness}
        options={[choose, ...DARKNESS.map((value) => ({ value, label: darkness[value] }))]}
        onChange={(next) => set({ darkness: next })}
        error={errorOf("darkness")}
      />
      <SelectField
        label={m.criteria_moon()}
        description={m.criteria_moon_note()}
        value={values.moon}
        options={[choose, ...MOON.map((value) => ({ value, label: moon[value] }))]}
        onChange={(next) => set({ moon: next })}
        error={errorOf("moon")}
      />
      {values.moon === "min_separation" ? (
        <NumberField label={m.criteria_min_separation()} unit={m.criteria_unit_degrees()} min={1} max={179} step={1} value={values.minSeparationDeg} onChange={(minSeparationDeg) => set({ minSeparationDeg })} error={errorOf("minSeparationDeg")} />
      ) : null}
      <NumberField label={m.criteria_min_duration()} unit={m.criteria_unit_minutes()} min={1} max={1440} step={5} value={values.minDurationMinutes} onChange={(minDurationMinutes) => set({ minDurationMinutes })} error={errorOf("minDurationMinutes")} />
    </>
  )
}
