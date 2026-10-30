/**
 * Home's criteria dialog (PLAN-FR-11/12): set or change the criteria Home's
 * Tonight and calendar are computed with. Home and Settings › Observing
 * sites open it; the host's `save` writes them over the revision the dialog
 * read (`planning_save_home_criteria`) through its own refresh. A stale
 * revision is refused as `conflict`, the criteria are read again and the
 * dialog stays open with the user's values, so the next Save names the
 * revision read now.
 */
import type { ActionResult, HomeCriteria, PlanCriteria } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { blockedByErrors, type FieldPaths, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { type CriteriaDraft, type CriteriaField, criteriaErrors, criteriaOf, draftOf } from "@/components/domain/plan-criteria"
import { PlanCriteriaFields } from "@/components/domain/plan-criteria-fields"

/** Maps PlanCriteria's stable refusal paths to the fields in its shared editor. */
const CRITERIA_PATHS: FieldPaths<CriteriaField> = {
  minAltitudeDeg: "minAltitudeDeg",
  darkness: "darkness",
  moon: "moon",
  minSeparationDeg: "moon.minSeparationDeg",
  minDurationMinutes: "minDurationMinutes",
}

export interface PlanCriteriaDialogProps {
  record: HomeCriteria
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Writes `criteria` over `record.revision`, through the host's refresh. */
  save: (criteria: PlanCriteria, expectedRevision: number) => Promise<ActionResult<unknown>>
}

export function PlanCriteriaDialog({ record, open, onOpenChange, save }: PlanCriteriaDialogProps) {
  const m = useMessages()
  const { values, set, shown, refusing } = useDialogForm<CriteriaDraft>(open, () => draftOf(record.criteria))
  const errors = criteriaErrors(m, values)
  const label = m.home_save_criteria()
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
          return refusing(save(criteria, record.revision), CRITERIA_PATHS)
        },
      }}
    >
      <PlanCriteriaFields values={values} set={set} errorOf={(field) => shown(errors, field)} />
    </FormDialog>
  )
}
