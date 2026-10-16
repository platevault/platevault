/**
 * Catalogue entry (R9-COMPOSITION-PLAN §8.3; F4 prototype plan, unit V): the
 * shared F4 patterns. CalibrationDiagram, CalibrationChoices with its
 * CalibrationChoiceBadge, ViewFolderTree and PlaceLink, on the live sample
 * library and on a what-if copy of it that is never written back: there a
 * RedCat session pins the older dark version (mixed versions, darks in the
 * nights), the Framing 2 session joins the RedCat group with another flat
 * version (a second flat set, `NIGHT_…-2`), a flat is only suggested with an
 * unknown rotation, a session is set to No bias and a pinned flat file
 * changed on disk. The live CalibrationChoices call the real session
 * actions. Captions are reviewer labels; Project names are sample data.
 */
import { useMemo, useState } from "react"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/components/app/links"
import { Section } from "@/components/app/page"
import { CalibrationChoices, type CalibrationChoicesProps, calibrationChoiceRows } from "@/components/domain/calibration-choices"
import { CalibrationDiagram, calibrationDiagram } from "@/components/domain/calibration-diagram"
import { ViewFolderTree } from "@/components/domain/view-folder-tree"
import { Button } from "@/components/ui/button"
import { calibrationSources, candidatesFor, noChoice, pickChoice } from "@/domain/calibration"
import { fakeSha256, fileAt, writeFiles } from "@/domain/disk"
import { applyPlan, viewPlan, viewTree } from "@/domain/project-view"
import type { CalibrationChoice, PinKind, SessionId } from "@/domain/types"
import { msg } from "@/lib/i18n"
import { confirmCalibration, pickCalibration, setNoCalibration } from "@/store/actions/calibration"
import { type PrototypeState, useStore } from "@/store/core"
import { ComponentSection, Specimen } from "./specimen"

const CYGNUS = "prj_cygnus"
const MOSAIC = "prj_ic5070"
const M31 = "prj_m31"
const CLOSED = "prj_ngc_oiii"

/** Light sessions whose kinds hold every state between them: a suggested flat, a waiting flat, No darks by the camera's default, automatic pins. */
const LIVE_SESSIONS: SessionId[] = ["ses_1v704nq", "ses_9ddkg4", "ses_573cbz", "ses_1oeln5l"]

/** The what-if sessions (Cygnus HOO 2026). */
const WHAT_IF = { olderDark: "ses_1xf1wax", secondFlat: "ses_tcxqb9", suggested: "ses_1863gio", changed: "ses_1oeln5l" } as const

/** A copy of the state with the what-if choices of this entry's header; the store is never written. */
function whatIfState(state: PrototypeState): PrototypeState {
  const at = "2026-10-10T12:00:00.000Z"
  const catalog = structuredClone(state.catalog)
  let disk = state.disk
  const sources = calibrationSources(catalog, disk)
  const setChoice = (sessionId: SessionId, kind: PinKind, choice: CalibrationChoice | null) => {
    const session = catalog.sessions[sessionId]
    if (session?.calibration && choice) session.calibration[kind] = choice
  }
  const pick = (sessionId: SessionId, kind: PinKind, versionId: string) => {
    const session = catalog.sessions[sessionId]
    const candidate = session ? candidatesFor(catalog, state.settings, session, kind, sources).find((c) => c.source.source.type === "master" && c.source.source.versionId === versionId) : undefined
    return candidate ? pickChoice(candidate, at) : null
  }
  const cygnus = catalog.projects[CYGNUS]
  if (cygnus) cygnus.inputs = cygnus.inputs.map((input) => (input.sessionId === WHAT_IF.secondFlat ? { ...input, groupId: "grp_cyg_redcat" } : input))
  setChoice(WHAT_IF.olderDark, "dark", pick(WHAT_IF.olderDark, "dark", "mv_49epv6"))
  setChoice(WHAT_IF.secondFlat, "flat", pick(WHAT_IF.secondFlat, "flat", "mv_bmjp84"))
  const flat = catalog.sessions[WHAT_IF.suggested]?.calibration?.flat
  if (flat?.state === "pinned") {
    const criteria = flat.evidence.criteria.filter((c) => c.name !== "rotation")
    setChoice(WHAT_IF.suggested, "flat", {
      state: "suggested",
      source: flat.source,
      evidence: { ...flat.evidence, rotationDeltaDeg: null, criteria: [...criteria, { name: "rotation", result: "unknown", lightValue: msg("domain_not_recorded"), calibrationValue: msg("domain_not_recorded") }] },
    })
  }
  setChoice(WHAT_IF.suggested, "bias", noChoice(at))
  const changed = catalog.sessions[WHAT_IF.changed]?.calibration?.flat
  const file = changed?.state === "pinned" && changed.evidence.files[0] ? fileAt(disk, changed.evidence.files[0].path) : undefined
  if (file) disk = writeFiles(disk, [{ ...file, sha256: fakeSha256(file.path, 9) }])
  return { ...state, catalog, disk }
}

type SampleState = "live" | "loading" | "empty" | "error"

/** Loading, Empty and Error: each press shows that state in place of the live one; a second press returns to it. */
function StateToggles({ value, onChange }: { value: SampleState; onChange: (next: SampleState) => void }) {
  const m = useMessages()
  const states: Array<[SampleState, string]> = [
    ["loading", m.catalogue_datatable_state_loading()],
    ["empty", m.catalogue_datatable_state_empty()],
    ["error", m.catalogue_datatable_state_error()],
  ]
  return (
    <div className="flex flex-wrap gap-1.5">
      {states.map(([state, label]) => (
        <Button key={state} size="sm" variant="outline" aria-pressed={value === state} onClick={() => onChange(value === state ? "live" : state)}>
          {label}
        </Button>
      ))}
    </div>
  )
}

function useSampleError(sample: SampleState, retry: () => void) {
  const m = useMessages()
  return sample === "error" ? { message: m.catalogue_f4_error_message(), onRetry: retry } : undefined
}

function Diagrams({ state, whatIf, now }: { state: PrototypeState; whatIf: PrototypeState; now: number }) {
  const m = useMessages()
  const [sample, setSample] = useState<SampleState>("live")
  const error = useSampleError(sample, () => setSample("live"))
  const of = (world: PrototypeState, id: string) => {
    const project = world.catalog.projects[id]
    return project ? calibrationDiagram(world, project, now) : []
  }
  return (
    <ComponentSection components={["CalibrationDiagram", "CalibrationChoiceBadge", "PlaceLink"]} description={m.catalogue_f4_diagram_desc()} level={3}>
      <div className="space-y-4">
        <Specimen caption={m.catalogue_f4_states()}>
          <div className="w-full space-y-2">
            <StateToggles value={sample} onChange={setSample} />
            <CalibrationDiagram level={4} groups={sample === "empty" ? [] : of(state, M31)} loading={sample === "loading"} error={error} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_f4_diagram_groups()}>
          <div className="w-full">
            <CalibrationDiagram level={4} groups={of(state, CYGNUS)} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_f4_diagram_what_if()}>
          <div className="w-full">
            <CalibrationDiagram level={4} groups={of(whatIf, CYGNUS)} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_f4_diagram_mosaic()}>
          <div className="w-full">
            <CalibrationDiagram level={4} groups={of(state, MOSAIC)} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_f4_diagram_closed()}>
          <div className="w-full">
            <CalibrationDiagram level={4} groups={of(state, CLOSED)} />
          </div>
        </Specimen>
      </div>
    </ComponentSection>
  )
}

function Choices({ state, whatIf }: { state: PrototypeState; whatIf: PrototypeState }) {
  const m = useMessages()
  const follow = useFollowLink()
  const [selected, setSelected] = useState<string[]>([])
  const [sample, setSample] = useState<SampleState>("live")
  const error = useSampleError(sample, () => setSample("live"))
  // The session actions, as a host passes them.
  const actions: Pick<CalibrationChoicesProps, "onConfirm" | "onPick" | "onNo" | "onAddFiles"> = {
    onConfirm: confirmCalibration,
    onPick: (p) => pickCalibration(p.sessionId, p.kind, p.source, p.expectRevision),
    onNo: setNoCalibration,
    onAddFiles: () => follow({ to: "/import" }),
  }
  return (
    <ComponentSection components={["CalibrationChoices"]} description={m.catalogue_f4_choices_desc()} level={3}>
      <div className="space-y-4">
        <Specimen caption={m.catalogue_f4_choices_live()}>
          <div className="w-full space-y-2">
            <StateToggles value={sample} onChange={setSample} />
            <CalibrationChoices
              label={m.catalogue_f4_choices_live()}
              rows={sample === "empty" ? [] : calibrationChoiceRows(state, LIVE_SESSIONS)}
              loading={sample === "loading"}
              error={error}
              selection={{ selected, onChange: setSelected }}
              {...actions}
            />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_f4_choices_one()}>
          <div className="w-full">
            <CalibrationChoices label={m.catalogue_f4_choices_one()} rows={calibrationChoiceRows(state, ["ses_1863gio"])} {...actions} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_f4_choices_read_only()}>
          <div className="w-full">
            <CalibrationChoices label={m.catalogue_f4_choices_read_only()} rows={calibrationChoiceRows(whatIf, [WHAT_IF.suggested, WHAT_IF.changed])} changeable={false} {...actions} />
          </div>
        </Specimen>
      </div>
    </ComponentSection>
  )
}

function Trees({ state, whatIf }: { state: PrototypeState; whatIf: PrototypeState }) {
  const m = useMessages()
  const [sample, setSample] = useState<SampleState>("live")
  const error = useSampleError(sample, () => setSample("live"))
  const planned = (world: PrototypeState, id: string) => {
    const project = world.catalog.projects[id]
    return project ? { tree: applyPlan(world, project).tree, mode: project.settings.mode } : null
  }
  const symlinks = planned(state, CYGNUS)
  const panels = planned(state, MOSAIC)
  const oneGroup = planned(state, M31)
  const mixedProject = whatIf.catalog.projects[CYGNUS]
  const mixed = mixedProject ? viewTree(viewPlan(whatIf, mixedProject).entries, "copy") : null
  return (
    <ComponentSection components={["ViewFolderTree"]} description={m.catalogue_f4_tree_desc()} level={3}>
      <div className="space-y-4">
        <Specimen caption={m.catalogue_f4_states()}>
          <div className="w-full space-y-2">
            <StateToggles value={sample} onChange={setSample} />
            {oneGroup ? (
              <ViewFolderTree
                label={m.catalogue_f4_tree_one_group()}
                tree={sample === "empty" ? { ...oneGroup.tree, entries: 0, children: [] } : oneGroup.tree}
                mode={oneGroup.mode}
                loading={sample === "loading"}
                error={error}
              />
            ) : null}
          </div>
        </Specimen>
        {symlinks ? (
          <Specimen caption={m.catalogue_f4_tree_symlinks()}>
            <div className="w-full">
              <ViewFolderTree label={m.catalogue_f4_tree_symlinks()} tree={symlinks.tree} mode={symlinks.mode} />
            </div>
          </Specimen>
        ) : null}
        {mixed ? (
          <Specimen caption={m.catalogue_f4_tree_mixed()}>
            <div className="w-full">
              <ViewFolderTree label={m.catalogue_f4_tree_mixed()} tree={mixed} mode="copy" />
            </div>
          </Specimen>
        ) : null}
        {panels ? (
          <Specimen caption={m.catalogue_f4_tree_panels()}>
            <div className="w-full">
              <ViewFolderTree label={m.catalogue_f4_tree_panels()} tree={panels.tree} mode={panels.mode} />
            </div>
          </Specimen>
        ) : null}
      </div>
    </ComponentSection>
  )
}

export function F4Catalogue() {
  const m = useMessages()
  const state = useStore((s) => s)
  const whatIf = useMemo(() => whatIfState(state), [state])
  const now = Date.now()
  return (
    <Section title={m.catalogue_f4_title()}>
      <Diagrams state={state} whatIf={whatIf} now={now} />
      <Choices state={state} whatIf={whatIf} />
      <Trees state={state} whatIf={whatIf} />
    </Section>
  )
}
