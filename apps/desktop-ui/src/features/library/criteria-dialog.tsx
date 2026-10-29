/**
 * Home's criteria dialog (PLAN-FR-11/12): set or change the criteria Home's
 * Tonight and calendar are computed with. Save writes them over the
 * revision the dialog read (`planning_save_home_criteria`); a stale revision
 * is refused as `conflict`, the criteria are read again and the dialog stays
 * open with the user's values, so the next Save names the revision read
 * now.
 */
import { useQueryClient } from "@tanstack/react-query"
import { type Darkness, type HomeCriteria, library } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { NumberField, SelectField } from "@/components/app/fields"
import { blockedByErrors, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { type CriteriaDraft, criteriaErrors, criteriaOf, draftOf, type MoonKind } from "./criteria"
import { homeWrite } from "./queries"

const DARKNESS: readonly Darkness[] = ["civil", "nautical", "astronomical"]
const MOON: readonly Exclude<MoonKind, "">[] = ["none", "below_horizon", "min_separation"]

export function HomeCriteriaDialog({ record, open, onOpenChange }: { record: HomeCriteria; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const { values, set, shown } = useDialogForm<CriteriaDraft>(open, () => draftOf(record.criteria))
  const errors = criteriaErrors(m, values)
  const label = m.home_save_criteria()
  const darkness: Record<Darkness, string> = { civil: m.criteria_darkness_civil(), nautical: m.criteria_darkness_nautical(), astronomical: m.criteria_darkness_astronomical() }
  const moon: Record<Exclude<MoonKind, "">, string> = { none: m.criteria_moon_none(), below_horizon: m.criteria_moon_below_horizon(), min_separation: m.criteria_moon_min_separation() }
  const choose = { value: "" as const, label: m.status_not_set(), disabled: true }
  return (
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
          return homeWrite(client, () => library.planningSaveHomeCriteria(criteria, record.revision))
        },
      }}
    >
      <NumberField label={m.criteria_min_altitude()} unit={m.criteria_unit_degrees()} min={0} max={89.9} step={1} value={values.minAltitudeDeg} onChange={(minAltitudeDeg) => set({ minAltitudeDeg })} error={shown(errors, "minAltitudeDeg")} />
      <SelectField
        label={m.criteria_darkness()}
        value={values.darkness}
        options={[choose, ...DARKNESS.map((value) => ({ value, label: darkness[value] }))]}
        onChange={(next) => set({ darkness: next })}
        error={shown(errors, "darkness")}
      />
      <SelectField
        label={m.criteria_moon()}
        description={m.criteria_moon_note()}
        value={values.moon}
        options={[choose, ...MOON.map((value) => ({ value, label: moon[value] }))]}
        onChange={(next) => set({ moon: next })}
        error={shown(errors, "moon")}
      />
      {values.moon === "min_separation" ? (
        <NumberField label={m.criteria_min_separation()} unit={m.criteria_unit_degrees()} min={1} max={179} step={1} value={values.minSeparationDeg} onChange={(minSeparationDeg) => set({ minSeparationDeg })} error={shown(errors, "minSeparationDeg")} />
      ) : null}
      <NumberField label={m.criteria_min_duration()} unit={m.criteria_unit_minutes()} min={1} max={1440} step={5} value={values.minDurationMinutes} onChange={(minDurationMinutes) => set({ minDurationMinutes })} error={shown(errors, "minDurationMinutes")} />
    </FormDialog>
  )
}
