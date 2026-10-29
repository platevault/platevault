/**
 * Home's criteria dialog (PLAN-FR-11/12): set or change the criteria Home's
 * Tonight and calendar are computed with. Save writes them over the
 * revision the dialog read (`planning_save_home_criteria`); a stale revision
 * is refused as `conflict`, the criteria are read again and the dialog stays
 * open with the user's values, so the next Save names the revision read
 * now.
 */
import { useQueryClient } from "@tanstack/react-query"
import { type HomeCriteria, library } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { blockedByErrors, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { type CriteriaDraft, criteriaErrors, criteriaOf, draftOf } from "@/components/domain/plan-criteria"
import { PlanCriteriaFields } from "@/components/domain/plan-criteria-fields"
import { homeWrite } from "./queries"

export function HomeCriteriaDialog({ record, open, onOpenChange }: { record: HomeCriteria; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const { values, set, shown } = useDialogForm<CriteriaDraft>(open, () => draftOf(record.criteria))
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
          return homeWrite(client, () => library.planningSaveHomeCriteria(criteria, record.revision))
        },
      }}
    >
      <PlanCriteriaFields values={values} set={set} errorOf={(field) => shown(errors, field)} />
    </FormDialog>
  )
}
