/**
 * Catalogue entry (R9-COMPOSITION-PLAN §8.3; F4 prototype plan, unit V): the
 * shared F4 patterns. CalibrationDiagram, CalibrationChoices with its
 * CalibrationChoiceBadge, ViewFolderTree, PlaceLink, the session-row
 * badges (DuplicatesBadge, ReadinessBadge, MasterAgeBadge) and the rig pickers'
 * library (fixtures/calibration.ts, fixtures/view-tree.ts) and on a what-if
 * of it: a RedCat session pins the older dark version (mixed versions, darks
 * in the nights), a second flat set gets `NIGHT_…-2`, a session is set to No
 * bias and a pinned flat file changed on disk. The working CalibrationChoices
 * apply its callbacks to local rows. Captions are reviewer labels; Project
 * names are sample data.
 */
import { useState } from "react"
import { useMessages } from "@/app/preferences"
import { useFollowLink } from "@/components/app/links"
import { Section } from "@/components/app/page"
import { CalibrationChoices, type CalibrationChoiceRow, type CalibrationChoicesProps, calibrationSourceLink, choiceRowId } from "@/components/domain/calibration-choices"
import { CalibrationDiagram } from "@/components/domain/calibration-diagram"
import type { CalibrationChoice } from "@/components/domain/calibration-model"
import { DuplicatesBadge } from "@/components/domain/duplicates-badge"
import { MasterAgeBadge } from "@/components/domain/master-age-badge"
import { ReadinessBadge } from "@/components/domain/readiness-badge"
import { NoSavedRigs } from "@/components/domain/saved-rigs"
import { ViewFolderTree } from "@/components/domain/view-folder-tree"
import { Button } from "@/components/ui/button"
import { CHOICE_ROWS, DIAGRAM_GROUPS, DIAGRAM_MIXED, DIAGRAM_ONE_GROUP, DIAGRAM_PANELS, ONE_SESSION_ROWS, READ_ONLY_ROWS } from "./fixtures/calibration"
import { after, SUCCEEDED } from "./fixtures/results"
import { VIEW_EMPTY, VIEW_GROUPS, VIEW_MIXED, VIEW_ONE_GROUP, VIEW_PANELS } from "./fixtures/view-tree"
import { ComponentSection, Specimen } from "./specimen"

/** Rows after the host applied a change to the picked kinds, as the library would answer the next read. */
function applied(rows: CalibrationChoiceRow[], ids: ReadonlySet<string>, next: (row: CalibrationChoiceRow) => Pick<CalibrationChoiceRow, "choice" | "source" | "sourceLink">): CalibrationChoiceRow[] {
  return rows.map((row) => (ids.has(choiceRowId(row)) ? { ...row, ...next(row), revision: row.revision + 1 } : row))
}

const AT = "2026-10-13T12:00:00.000Z"
const ids = (picks: { sessionId: string; kind: CalibrationChoiceRow["kind"] }[]) => new Set(picks.map(choiceRowId))

/** The session actions on local rows: each answers after a short delay, as a library call does. */
function useLocalChoices(initial: CalibrationChoiceRow[]): [CalibrationChoiceRow[], Pick<CalibrationChoicesProps, "onConfirm" | "onPick" | "onNo">] {
  const [rows, setRows] = useState(initial)
  const settle = (change: (rows: CalibrationChoiceRow[]) => CalibrationChoiceRow[]) => {
    setRows(change)
    return after(300, SUCCEEDED)
  }
  const pinnedByUser = (row: CalibrationChoiceRow): CalibrationChoice => (row.choice.state === "suggested" ? { state: "pinned", source: row.choice.source, evidence: row.choice.evidence, at: AT, by: "user" } : row.choice)
  return [
    rows,
    {
      onConfirm: (picks) => settle((all) => applied(all, ids(picks), (row) => ({ choice: pinnedByUser(row), source: row.source, sourceLink: row.sourceLink }))),
      onNo: (picks) => settle((all) => applied(all, ids(picks), () => ({ choice: { state: "none", at: AT, by: "user" }, source: null, sourceLink: null }))),
      onPick: (pick) =>
        settle((all) =>
          applied(all, ids([pick]), (row) => {
            const offer = row.offers.find((o) => o.source === pick.source)
            if (!offer) return row
            return { choice: { state: "pinned", source: offer.source, evidence: offer.evidence, at: AT, by: "user" }, source: offer.label, sourceLink: calibrationSourceLink(offer.source) }
          }),
        ),
    },
  ]
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

function Diagrams() {
  const m = useMessages()
  const [sample, setSample] = useState<SampleState>("live")
  const error = useSampleError(sample, () => setSample("live"))
  return (
    <ComponentSection components={["CalibrationDiagram", "CalibrationChoiceBadge", "PlaceLink"]} description={m.catalogue_f4_diagram_desc()} level={3}>
      <div className="space-y-4">
        <Specimen caption={m.catalogue_f4_states()}>
          <div className="w-full space-y-2">
            <StateToggles value={sample} onChange={setSample} />
            <CalibrationDiagram level={4} groups={sample === "empty" ? [] : DIAGRAM_ONE_GROUP} loading={sample === "loading"} error={error} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_f4_diagram_groups()}>
          <div className="w-full">
            <CalibrationDiagram level={4} groups={DIAGRAM_GROUPS} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_f4_diagram_what_if()}>
          <div className="w-full">
            <CalibrationDiagram level={4} groups={DIAGRAM_MIXED} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_f4_diagram_mosaic()}>
          <div className="w-full">
            <CalibrationDiagram level={4} groups={DIAGRAM_PANELS} />
          </div>
        </Specimen>
      </div>
    </ComponentSection>
  )
}

function Choices() {
  const m = useMessages()
  const follow = useFollowLink()
  const [selected, setSelected] = useState<string[]>([])
  const [sample, setSample] = useState<SampleState>("live")
  const error = useSampleError(sample, () => setSample("live"))
  const [rows, actions] = useLocalChoices(CHOICE_ROWS)
  const [oneRows, oneActions] = useLocalChoices(ONE_SESSION_ROWS)
  const addFiles = () => follow({ to: "/import" })
  return (
    <ComponentSection components={["CalibrationChoices"]} description={m.catalogue_f4_choices_desc()} level={3}>
      <div className="space-y-4">
        <Specimen caption={m.catalogue_f4_choices_live()}>
          <div className="w-full space-y-2">
            <StateToggles value={sample} onChange={setSample} />
            <CalibrationChoices
              label={m.catalogue_f4_choices_live()}
              rows={sample === "empty" ? [] : rows}
              loading={sample === "loading"}
              error={error}
              selection={{ selected, onChange: setSelected }}
              onAddFiles={addFiles}
              {...actions}
            />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_f4_choices_one()}>
          <div className="w-full">
            <CalibrationChoices label={m.catalogue_f4_choices_one()} rows={oneRows} onAddFiles={addFiles} {...oneActions} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_f4_choices_read_only()}>
          <div className="w-full">
            <CalibrationChoices label={m.catalogue_f4_choices_read_only()} rows={READ_ONLY_ROWS} changeable={false} onConfirm={() => SUCCEEDED} onPick={() => SUCCEEDED} onNo={() => SUCCEEDED} />
          </div>
        </Specimen>
      </div>
    </ComponentSection>
  )
}

function Trees() {
  const m = useMessages()
  const [sample, setSample] = useState<SampleState>("live")
  const error = useSampleError(sample, () => setSample("live"))
  return (
    <ComponentSection components={["ViewFolderTree"]} description={m.catalogue_f4_tree_desc()} level={3}>
      <div className="space-y-4">
        <Specimen caption={m.catalogue_f4_states()}>
          <div className="w-full space-y-2">
            <StateToggles value={sample} onChange={setSample} />
            <ViewFolderTree label={m.catalogue_f4_tree_one_group()} tree={sample === "empty" ? VIEW_EMPTY : VIEW_ONE_GROUP} mode="copy" loading={sample === "loading"} error={error} />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_f4_tree_symlinks()}>
          <div className="w-full">
            <ViewFolderTree label={m.catalogue_f4_tree_symlinks()} tree={VIEW_GROUPS} mode="symlink" />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_f4_tree_mixed()}>
          <div className="w-full">
            <ViewFolderTree label={m.catalogue_f4_tree_mixed()} tree={VIEW_MIXED} mode="copy" />
          </div>
        </Specimen>
        <Specimen caption={m.catalogue_f4_tree_panels()}>
          <div className="w-full">
            <ViewFolderTree label={m.catalogue_f4_tree_panels()} tree={VIEW_PANELS} mode="symlink" />
          </div>
        </Specimen>
      </div>
    </ComponentSection>
  )
}

/** F5's duplicates badge on a session row: one extra copy, and several. */
function Duplicates() {
  const m = useMessages()
  return (
    <ComponentSection components={["DuplicatesBadge"]} description={m.catalogue_f4_duplicates_desc()} level={3}>
      <Specimen caption={m.catalogue_f4_duplicates_counts()}>
        <DuplicatesBadge count={1} />
        <DuplicatesBadge count={12} />
      </Specimen>
    </ComponentSection>
  )
}

/** A session row's readiness (C10, D-W100): Ready, each step it still needs, and Trashed. */
function Readiness() {
  const m = useMessages()
  return (
    <ComponentSection components={["ReadinessBadge"]} description={m.catalogue_f4_readiness_desc()} level={3}>
      <Specimen caption={m.catalogue_f4_readiness_states()}>
        <ReadinessBadge readiness="ready" unreviewed={0} trashed={false} />
        <ReadinessBadge readiness="needs_target" unreviewed={0} trashed={false} />
        <ReadinessBadge readiness="needs_rig" unreviewed={0} trashed={false} />
        <ReadinessBadge readiness="needs_review" unreviewed={1} trashed={false} />
        <ReadinessBadge readiness="ready" unreviewed={0} trashed />
      </Specimen>
    </ComponentSection>
  )
}

/** A detected master past the configured age threshold. */
function MasterAge() {
  const m = useMessages()
  return (
    <ComponentSection components={["MasterAgeBadge"]} description={m.catalogue_previews_master_old_only()} level={3}>
      <Specimen caption={m.flow_master_old({ n: 165 })}>
        <MasterAgeBadge ageDays={165} />
      </Specimen>
    </ComponentSection>
  )
}

/** A rig picker with no saved rig: where rigs are added, as text until Settings › Equipment is registered. */
function NoRigs() {
  const m = useMessages()
  return (
    <ComponentSection components={["NoSavedRigs"]} description={m.catalogue_f4_no_rigs_desc()} level={3}>
      <Specimen caption={m.catalogue_f4_no_rigs_state()}>
        <NoSavedRigs />
      </Specimen>
    </ComponentSection>
  )
}

export function F4Catalogue() {
  const m = useMessages()
  return (
    <Section title={m.catalogue_f4_title()}>
      <Diagrams />
      <Choices />
      <Trees />
      <Duplicates />
      <Readiness />
      <MasterAge />
      <NoRigs />
    </Section>
  )
}
