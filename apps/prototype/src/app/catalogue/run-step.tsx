/**
 * Catalogue entry (§3.3 P10/P11, §8.3): every gate glyph, a run's step rail
 * (full and compact) and the deprecated GateLabel.
 *
 * The rails take `RunStepState`s as the domain derives them: a fixed set
 * that shows every gate state, and, once the library has a run, that run's
 * own pipeline (`runPipeline`). Step statuses are MessageRefs, as on a real
 * run; "–" (`{ text: "–" }`) is the no-status word StepRail leaves out.
 */
import { useMessages } from "@/app/preferences"
import { GateLabel, StepGlyph, StepRail, gateWord } from "@/components/app/run-step"
import { type GateState, type RunStepState, runPipeline } from "@/domain/derive"
import { RUN_STEPS } from "@/domain/labels"
import { msg } from "@/lib/i18n"
import { useStore } from "@/store/core"
import { ComponentSection, Specimen } from "./specimen"

const STATES: GateState[] = ["done", "ready", "review", "blocked", "running", "partial", "idle"]

/** One step in each of the first gate states; Calibrate carries a status, the others the no-status word. */
const SAMPLE: RunStepState[] = RUN_STEPS.map((id, index) => ({
  id,
  n: index + 1,
  state: STATES[index % STATES.length]!,
  status: id === "calibrate" ? msg("status_partial") : { text: "–" },
  items: [],
  link: { to: "/design-system" },
  nextLabel: msg("stepflow_proceed"),
}))

export function RunStepCatalogue() {
  const m = useMessages()
  // The whole state, as the Project page reads it: runPipeline returns a new object, so it runs in render, not in the selector.
  const state = useStore((s) => s)
  const run = Object.values(state.catalog.runs).find((r) => !r.trashedAt)
  const live = run ? { name: run.name, pipeline: runPipeline(state, run) } : null

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
        <StepRail steps={SAMPLE} current="calibrate" label={m.stepflow_steps()} />
        <StepRail compact steps={SAMPLE} current="calibrate" label={m.stepflow_steps()} />
        <GateLabel state="blocked" />
      </Specimen>
      {live ? (
        <Specimen caption={live.name}>
          <StepRail steps={live.pipeline.steps} current={live.pipeline.current.id} label={m.catalogue_run_step_rail_of({ name: live.name })} />
        </Specimen>
      ) : null}
    </ComponentSection>
  )
}
