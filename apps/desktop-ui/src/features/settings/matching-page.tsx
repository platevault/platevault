/**
 * Settings › Matching (F4 workflow settings; CAL-FR-15, CAL-FR-19..23,
 * PRJ-FR-31, PLAN-FR-02): the framing margins intake splits sessions by,
 * the flat and dark/bias matching windows, what happens to raw calibration
 * frames and when a master reads Old, the View mode a new Project starts
 * with, and the Moon-avoidance curve per band. The library holds them as one
 * document under one revision (`workflow_settings_get`).
 *
 * Edit… and Moon limits… each save the whole document at the revision read
 * (`workflow_settings_save`). A refusal keeps the dialog open with the
 * user's values; a stale revision reads the settings again, so the next
 * Save names the revision read now.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query"
import { MoonStar, Pencil } from "lucide-react"
import { useState } from "react"
import { library, type ViewMode, type WorkflowSettings_Serialize, type WorkflowSettingsRecord_Serialize } from "@/api/ipc"
import { useMessages } from "@/app/preferences"
import { ActionButton } from "@/components/app/actions"
import { KeyValueList } from "@/components/app/data"
import { NumberField, SegmentedField, SwitchField } from "@/components/app/fields"
import { blockedByErrors, type FieldErrors, type FieldPaths, FormDialog, useDialogForm } from "@/components/app/form-dialog"
import { Section } from "@/components/app/page"
import { curveText, MOON_BANDS, MoonLimitsDialog } from "@/components/domain/moon-limits"
import { SettingsPage } from "@/components/templates/settings-page"
import { numberText } from "@/lib/format"
import type { Messages } from "@/lib/i18n"
import { Read } from "./parts"
import { settingsWrite, workflowQuery } from "./queries"

/** The document without the keywords (Naming edits those) and the curves (Moon limits…). */
type Matching = Pick<WorkflowSettings_Serialize, "framing" | "flats" | "darkBias" | "calibration" | "viewMode">

/** A setting's value in its unit's message, or "–" while it is not set. */
function amount(value: number | null, word: (value: number) => string): string {
  return value === null ? "–" : word(value)
}

function modeText(m: Messages, mode: ViewMode): string {
  return mode === "symlinks" ? m.domain_mode_symlink() : m.domain_mode_copy()
}

function MatchingValues({ record }: { record: WorkflowSettingsRecord_Serialize }) {
  const m = useMessages()
  const { framing, flats, darkBias, calibration, viewMode, moonAvoidance } = record.settings
  const deg = (value: number) => m.site_degrees_value({ degrees: numberText(value) })
  const arcmin = (value: number) => m.settings_value_arcmin({ value: numberText(value) })
  const percent = (value: number) => m.settings_value_percent({ value: numberText(value) })
  const days = (value: number) => m.settings_value_days({ count: value, n: numberText(value) })
  const nights = (value: number) => m.settings_value_nights({ count: value, n: numberText(value) })
  return (
    <>
      <Section title={m.equipment_matching_framing()} level={3}>
        <KeyValueList
          items={[
            { label: m.equipment_matching_centre(), value: amount(framing.maxCentreOffsetArcmin, arcmin) },
            { label: m.equipment_matching_rotation(), value: amount(framing.maxRotationDeg, deg) },
            { label: m.equipment_matching_overlap(), value: amount(framing.minOverlapPercent, percent) },
            { label: m.equipment_matching_panel_min(), value: amount(framing.panelOverlapPercent[0], percent) },
            { label: m.equipment_matching_panel_max(), value: amount(framing.panelOverlapPercent[1], percent) },
          ]}
        />
      </Section>
      <Section title={m.calibration_heading_flats()} level={3}>
        <KeyValueList
          items={[
            { label: m.equipment_matching_flat_fine(), value: amount(flats.fineWithinDeg, deg) },
            { label: m.equipment_matching_flat_warn(), value: amount(flats.offeredWithinDeg, deg) },
            { label: m.equipment_matching_window_nights(), value: amount(flats.windowNights, nights) },
          ]}
        />
      </Section>
      <Section title={m.settings_joined({ first: m.calibration_heading_darks(), second: m.calibration_heading_bias() })} level={3}>
        <KeyValueList items={[{ label: m.equipment_matching_window_days(), value: amount(darkBias.windowDays, days) }]} />
      </Section>
      <Section title={m.settings_raw_frames()} level={3}>
        <KeyValueList
          items={[
            { label: m.settings_keep_raws(), value: calibration.keepRawFrames ? m.equipment_rotator_yes() : m.equipment_rotator_no() },
            { label: m.settings_old_master_after(), value: amount(calibration.oldMasterAfterDays, days) },
            { label: m.settings_default_input_mode(), value: modeText(m, viewMode) },
          ]}
        />
      </Section>
      <Section title={m.tonight_moon_limits()} level={3}>
        <KeyValueList items={MOON_BANDS.map((band) => ({ label: band, value: curveText(m, moonAvoidance[band]) }))} />
      </Section>
    </>
  )
}

export function MatchingPage() {
  const m = useMessages()
  const client = useQueryClient()
  const workflow = useQuery(workflowQuery())
  const [dialog, setDialog] = useState<"edit" | "moon" | null>(null)
  const record = workflow.data
  const actions = record ? (
    <>
      <ActionButton action={{ id: "edit-matching", label: m.settings_edit(), icon: Pencil, opensDialog: true, run: () => setDialog("edit") }} />
      <ActionButton action={{ id: "moon-limits", label: m.tonight_moon_limits(), icon: MoonStar, opensDialog: true, run: () => setDialog("moon") }} />
    </>
  ) : undefined
  return (
    <SettingsPage title={m.settings_matching()} actions={actions}>
      <Read query={workflow} label={m.settings_label_matching()}>
        {(data) => <MatchingValues record={data} />}
      </Read>
      {record ? (
        <>
          <MatchingDialog record={record} open={dialog === "edit"} onOpenChange={(open) => setDialog(open ? "edit" : null)} />
          <MoonLimitsDialog
            record={record}
            open={dialog === "moon"}
            onOpenChange={(open) => setDialog(open ? "moon" : null)}
            save={(moonAvoidance) => settingsWrite(client, () => library.workflowSettingsSave({ ...record.settings, moonAvoidance }, record.revision))}
          />
        </>
      ) : null}
    </SettingsPage>
  )
}

type Field = "centre" | "rotation" | "overlap" | "panels" | "flatFine" | "flatOffered" | "windowNights" | "windowDays" | "oldAfter"

const atLeast = (value: number | null, min: number) => value === null || (Number.isFinite(value) && value >= min)

/** The checks the form can make itself; the library still refuses whatever else it validates (`invalid_input`). */
function matchingErrors(m: Messages, v: Matching): FieldErrors<Field> {
  const [low, high] = v.framing.panelOverlapPercent
  const percent = (value: number | null) => value === null || (value >= 0 && value <= 100)
  const whole = (value: number) => Number.isInteger(value) && value >= 0
  return {
    centre: atLeast(v.framing.maxCentreOffsetArcmin, 0) ? undefined : m.common_enter_number(),
    rotation: atLeast(v.framing.maxRotationDeg, 0) ? undefined : m.common_enter_number(),
    overlap: percent(v.framing.minOverlapPercent) ? undefined : m.common_enter_number(),
    panels: !percent(low) || !percent(high) ? m.common_enter_number() : low !== null && high !== null && low > high ? m.settings_matching_panel_overlap_order() : undefined,
    flatFine:
      !atLeast(v.flats.fineWithinDeg, 0) ? m.common_enter_number() : v.flats.fineWithinDeg !== null && v.flats.offeredWithinDeg !== null && v.flats.fineWithinDeg > v.flats.offeredWithinDeg ? m.settings_matching_flat_rotation_order() : undefined,
    flatOffered: atLeast(v.flats.offeredWithinDeg, 0) ? undefined : m.common_enter_number(),
    windowNights: whole(v.flats.windowNights) ? undefined : m.common_enter_number(),
    windowDays: whole(v.darkBias.windowDays) ? undefined : m.common_enter_number(),
    oldAfter: whole(v.calibration.oldMasterAfterDays) && v.calibration.oldMasterAfterDays > 0 ? undefined : m.common_enter_number(),
  }
}

const MATCHING_PATHS: FieldPaths<Field> = {
  centre: "framing.maxCentreOffsetArcmin",
  rotation: "framing.maxRotationDeg",
  overlap: "framing.minOverlapPercent",
  panels: "framing.panelOverlapPercent",
  flatFine: "flats.fineWithinDeg",
  flatOffered: "flats.offeredWithinDeg",
  oldAfter: "calibration.oldMasterAfterDays",
}

function MatchingDialog({ record, open, onOpenChange }: { record: WorkflowSettingsRecord_Serialize; open: boolean; onOpenChange: (open: boolean) => void }) {
  const m = useMessages()
  const client = useQueryClient()
  const { values, set, shown, refusing } = useDialogForm<Matching, Field>(open, () => {
    const { framing, flats, darkBias, calibration, viewMode } = record.settings
    return { framing, flats, darkBias, calibration, viewMode }
  })
  const errors = matchingErrors(m, values)
  const label = m.settings_save()
  const deg = m.criteria_unit_degrees()
  const pct = m.settings_unit_percent()
  const framing = (patch: Partial<Matching["framing"]>, affected: readonly Field[]) => set({ framing: { ...values.framing, ...patch } }, affected)
  const flats = (patch: Partial<Matching["flats"]>, affected: readonly Field[]) => set({ flats: { ...values.flats, ...patch } }, affected)
  const [low, high] = values.framing.panelOverlapPercent
  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={m.settings_label_matching()}
      size="lg"
      confirm={{
        id: "save-matching",
        label,
        kind: "primary",
        unavailable: blockedByErrors(m, label, errors),
        run: () => refusing(
          settingsWrite(client, () => library.workflowSettingsSave({ ...record.settings, ...values }, record.revision)),
          MATCHING_PATHS,
        ),
      }}
    >
      <NumberField label={m.equipment_matching_centre()} unit={m.settings_unit_arcmin()} min={0} step={1} value={values.framing.maxCentreOffsetArcmin} onChange={(maxCentreOffsetArcmin) => framing({ maxCentreOffsetArcmin }, ["centre"])} error={shown(errors, "centre")} />
      <NumberField label={m.equipment_matching_rotation()} unit={deg} min={0} max={180} step={1} value={values.framing.maxRotationDeg} onChange={(maxRotationDeg) => framing({ maxRotationDeg }, ["rotation"])} error={shown(errors, "rotation")} />
      <NumberField label={m.equipment_matching_overlap()} unit={pct} min={0} max={100} step={1} value={values.framing.minOverlapPercent} onChange={(minOverlapPercent) => framing({ minOverlapPercent }, ["overlap"])} error={shown(errors, "overlap")} />
      <NumberField label={m.equipment_matching_panel_min()} unit={pct} min={0} max={100} step={1} value={low} onChange={(next) => framing({ panelOverlapPercent: [next, high] }, ["panels"])} error={shown(errors, "panels")} />
      <NumberField label={m.equipment_matching_panel_max()} unit={pct} min={0} max={100} step={1} value={high} onChange={(next) => framing({ panelOverlapPercent: [low, next] }, ["panels"])} />
      <NumberField label={m.equipment_matching_flat_fine()} unit={deg} min={0} step={0.5} value={values.flats.fineWithinDeg} onChange={(fineWithinDeg) => flats({ fineWithinDeg }, ["flatFine"])} error={shown(errors, "flatFine")} />
      <NumberField label={m.equipment_matching_flat_warn()} unit={deg} min={0} step={0.5} value={values.flats.offeredWithinDeg} onChange={(offeredWithinDeg) => flats({ offeredWithinDeg }, ["flatOffered"])} error={shown(errors, "flatOffered")} />
      <NumberField
        label={m.equipment_matching_window_nights()}
        unit={m.equipment_unit_nights()}
        min={0}
        step={1}
        value={values.flats.windowNights}
        onChange={(windowNights) => flats({ windowNights: windowNights ?? Number.NaN }, ["windowNights"])}
        error={shown(errors, "windowNights")}
      />
      <NumberField
        label={m.equipment_matching_window_days()}
        unit={m.calibration_unit_days()}
        min={0}
        step={1}
        value={values.darkBias.windowDays}
        onChange={(windowDays) => set({ darkBias: { windowDays: windowDays ?? Number.NaN } }, ["windowDays"])}
        error={shown(errors, "windowDays")}
      />
      <SwitchField label={m.settings_keep_raws()} description={m.settings_keep_raws_help()} checked={values.calibration.keepRawFrames} onChange={(keepRawFrames) => set({ calibration: { ...values.calibration, keepRawFrames } })} />
      <NumberField
        label={m.settings_old_master_after()}
        description={m.calibration_old_after_help()}
        unit={m.calibration_unit_days()}
        min={1}
        step={1}
        value={values.calibration.oldMasterAfterDays}
        onChange={(oldMasterAfterDays) => set({ calibration: { ...values.calibration, oldMasterAfterDays: oldMasterAfterDays ?? Number.NaN } }, ["oldAfter"])}
        error={shown(errors, "oldAfter")}
      />
      <SegmentedField<ViewMode>
        label={m.settings_default_input_mode()}
        value={values.viewMode}
        options={[
          { value: "symlinks", label: m.domain_mode_symlink() },
          { value: "copies", label: m.domain_mode_copy() },
        ]}
        onChange={(viewMode) => set({ viewMode })}
      />
    </FormDialog>
  )
}
