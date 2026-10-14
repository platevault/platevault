/**
 * Catalogue entry (R9-COMPOSITION-PLAN §8.3, C7): the goal fields in
 * components/domain/goal-fields.tsx. GoalKindsFields counts time, counts
 * frames, and has no amount (its error); GoalValuesEditor with goals and
 * "From template ▸", limited to a rig set's channels, and empty. Captions are
 * reviewer labels; channels are band names.
 */
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { DEFAULT_GOAL, type GoalKinds, GoalKindsFields, GoalValuesEditor } from "@/components/domain/goal-fields"
import { BUILT_IN_GOAL_TEMPLATES, qualityBarFor } from "@/domain/templates"
import type { GoalTemplateValue } from "@/domain/types"
import { ComponentSection, Specimen } from "./specimen"

const VALUES: GoalTemplateValue[] = [
  { channel: "Ha", integrationS: 10 * 3600, frameCount: null, qualityBar: qualityBarFor(2.5) },
  { channel: "OIII", integrationS: null, frameCount: 120, qualityBar: qualityBarFor(null) },
]

export function GoalFieldsCatalogue() {
  const m = useMessages()
  const [time, setTime] = useState<GoalKinds>(DEFAULT_GOAL)
  const [frames, setFrames] = useState<GoalKinds>({ integrationS: null, frameCount: 120, qualityBar: qualityBarFor(2) })
  const [missing, setMissing] = useState<GoalKinds>({ integrationS: null, frameCount: null, qualityBar: qualityBarFor(null) })
  const [values, setValues] = useState<GoalTemplateValue[]>(VALUES)
  const [narrow, setNarrow] = useState<GoalTemplateValue[]>([])
  const [empty, setEmpty] = useState<GoalTemplateValue[]>([])
  const templates = { items: BUILT_IN_GOAL_TEMPLATES.map((t) => ({ id: t.id, label: t.name })), apply: (id: string) => setValues(structuredClone(BUILT_IN_GOAL_TEMPLATES.find((t) => t.id === id)?.values ?? [])) }
  return (
    <ComponentSection components={["GoalKindsFields", "GoalValuesEditor"]} description={m.catalogue_goal_fields_desc()}>
      <div className="grid max-w-3xl gap-4">
        <Specimen caption={m.catalogue_goal_fields_time()}>
          <div className="grid w-80 gap-3">
            <GoalKindsFields value={time} onChange={(patch) => setTime((v) => ({ ...v, ...patch }))} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_goal_fields_frames()}>
          <div className="grid w-80 gap-3">
            <GoalKindsFields value={frames} onChange={(patch) => setFrames((v) => ({ ...v, ...patch }))} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_goal_fields_missing()}>
          <div className="grid w-80 gap-3">
            <GoalKindsFields value={missing} onChange={(patch) => setMissing((v) => ({ ...v, ...patch }))} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_goal_fields_values()}>
          <div className="w-full">
            <GoalValuesEditor values={values} channels={[]} onChange={setValues} templates={templates} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_goal_fields_channels()}>
          <div className="w-full">
            <GoalValuesEditor values={narrow} channels={["Ha", "OIII", "SII"]} onChange={setNarrow} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_goal_fields_empty()}>
          <div className="w-full">
            <GoalValuesEditor values={empty} channels={[]} onChange={setEmpty} />
          </div>
        </Specimen>
      </div>
    </ComponentSection>
  )
}
