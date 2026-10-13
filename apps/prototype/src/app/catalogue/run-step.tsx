/**
 * Catalogue entry (§3.3 P10/P11, §8.3): every gate glyph, a run's step rail
 * (full and compact) and the deprecated GateLabel.
 */
import { useMessages } from "@/app/preferences"
import { GateLabel, StepGlyph, StepRail, gateWord } from "@/components/app/run-step"
import type { GateState, RunStepState } from "@/domain/derive"
import { ComponentSection, Specimen } from "./specimen"

const STATES: GateState[] = ["done", "ready", "review", "blocked", "running", "partial", "idle"]

export function RunStepCatalogue() {
  const m = useMessages()
  const steps = (["select", "review", "calibrate", "prepare", "results", "done"] as const).map((id, index) => ({ id, n: index + 1, state: STATES[index % STATES.length]!, status: "–" })) as unknown as RunStepState[]
  return (
    <ComponentSection components={["StepGlyph", "StepRail", "GateLabel", "CurrentLink", "useFollowLink", "gateWord", "stepName"]} description={m.catalogue_run_step_desc()}>
      <Specimen caption={m.catalogue_frame_wide()}>
        {STATES.map((state) => (
          <span key={state} className="inline-flex items-center gap-1 text-xs">
            <StepGlyph state={state} />
            {gateWord(m, state)}
          </span>
        ))}
      </Specimen>
      <Specimen caption={m.catalogue_frame_rail()}>
        <StepRail steps={steps} current="calibrate" label={m.stepflow_steps()} />
        <StepRail compact steps={steps} current="calibrate" label={m.stepflow_steps()} />
        <GateLabel state="blocked" />
      </Specimen>
    </ComponentSection>
  )
}
