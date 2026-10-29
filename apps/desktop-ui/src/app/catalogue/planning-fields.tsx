/**
 * Catalogue entry (R9-COMPOSITION-PLAN §8.3; PLAN-FR-02, PLAN-FR-11/12):
 * the planning fields in components/domain. PlanCriteriaFields empty, as
 * setup's Index step first shows it (no value filled in, D-W170), and
 * filled with a Moon separation; MoonLimitsDialog over one workflow
 * settings document, whose Save only resolves here. Captions are reviewer
 * labels; bands are band names.
 */
import { useState } from "react"
import type { WorkflowSettingsRecord_Serialize } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import type { FieldErrors } from "@/components/app/form-dialog"
import { MoonLimitsDialog } from "@/components/domain/moon-limits"
import { type CriteriaDraft, type CriteriaField, criteriaErrors, draftOf } from "@/components/domain/plan-criteria"
import { PlanCriteriaFields } from "@/components/domain/plan-criteria-fields"
import { Button } from "@/components/ui/button"
import { ComponentSection, Specimen } from "./specimen"

const CURVE = { distanceDeg: 120, widthDays: 7 }

const WORKFLOW: WorkflowSettingsRecord_Serialize = {
  revision: 3,
  settings: {
    framing: { minOverlapPercent: 80, panelOverlapPercent: [5, 40], maxCentreOffsetArcmin: 5, maxRotationDeg: 2 },
    flats: { fineWithinDeg: 1, offeredWithinDeg: 5, windowNights: 1 },
    darkBias: { windowDays: 90 },
    keywords: { group: "GROUP", panel: "PANEL" },
    viewMode: "symlinks",
    calibration: { keepRawFrames: false, oldMasterAfterDays: 180 },
    moonAvoidance: { L: CURVE, R: CURVE, G: CURVE, B: CURVE, Ha: { distanceDeg: 60, widthDays: 5 }, SII: { distanceDeg: 60, widthDays: 5 }, OIII: CURVE },
  },
}

function Criteria({ initial, showErrors }: { initial: CriteriaDraft; showErrors: boolean }) {
  const m = useMessages()
  const [values, setValues] = useState(initial)
  const errors: FieldErrors<CriteriaField> = showErrors ? criteriaErrors(m, values) : {}
  return (
    <div className="grid w-80 gap-3">
      <PlanCriteriaFields values={values} set={(patch) => setValues((v) => ({ ...v, ...patch }))} errorOf={(field) => errors[field]} />
    </div>
  )
}

export function PlanningFieldsCatalogue() {
  const m = useMessages()
  const [open, setOpen] = useState(false)
  return (
    <ComponentSection components={["PlanCriteriaFields", "MoonLimitsDialog"]} description={m.catalogue_planning_fields_desc()}>
      <div className="grid max-w-3xl gap-4">
        <Specimen caption={m.catalogue_planning_fields_empty()}>
          <Criteria initial={draftOf(null)} showErrors={false} />
        </Specimen>
        <Specimen caption={m.catalogue_planning_fields_set()}>
          <Criteria initial={draftOf({ minAltitudeDeg: 30, darkness: "astronomical", moon: { kind: "min_separation", minSeparationDeg: 45 }, minDurationMinutes: 60 })} showErrors />
        </Specimen>
        <Specimen caption={m.catalogue_planning_fields_moon()}>
          <Button variant="outline" onClick={() => setOpen(true)}>
            {m.tonight_moon_limits()}
          </Button>
          <MoonLimitsDialog record={WORKFLOW} open={open} onOpenChange={setOpen} save={async () => ({ ok: true, data: null })} />
        </Specimen>
      </div>
    </ComponentSection>
  )
}
